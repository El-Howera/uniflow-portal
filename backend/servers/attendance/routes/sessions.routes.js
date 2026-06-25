/**
 * Session staff-operation routes for the attendance service.
 *
 * Owns endpoints that create or mutate AttendanceSession rows (staff-only):
 *   POST   /api/attendance/session/start                      — start session (prof/ta/admin)
 *   POST   /api/attendance/sessions/:id/end                   — end session + auto-absent
 *   DELETE /api/attendance/sessions/:id                       — delete mistaken session
 *   GET    /api/attendance/sessions/:id/roster                — enrolled roster + mark status
 *   POST   /api/attendance/sessions/:id/mark-student          — manual student mark
 *   GET    /api/attendance/course/:courseCode/eligible-students — restricted-session picker
 *
 * Student-facing session reads (today, live-sessions, sessions list, QR,
 * professor/today, preview/create-session) live in records.routes.js alongside
 * the other student-read surfaces to keep this file within the 600-line ceiling.
 *
 * Non-obvious decisions:
 *   - Advisory-lock dedup in POST /session/start uses $executeRaw (not
 *     $queryRaw) because pg_advisory_xact_lock returns Postgres void, which
 *     Prisma 5 cannot deserialize from $queryRaw ("Failed to deserialize
 *     column of type 'void'").
 *   - restricted_to_user_ids is written via $executeRawUnsafe with a
 *     hand-built Postgres array literal because Prisma's tagged-template
 *     $executeRaw silently JSON-stringifies JS arrays, which Postgres
 *     cannot parse as text[].
 */

const express = require('express');
const crypto = require('crypto');

const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { generateQRToken, buildQrUrl } = require('../lib/qr');

const router = express.Router();

/**
 * Resolve the BSSID whitelist for a session being started by `userId` for
 * `courseId`. Anchors the session to the halls of every section this user
 * teaches (instructor or TA) in this course. Falls back to "all halls of
 * all sections of this course" when the user has no section assignment
 * (admin starting a session, preview/test path).
 *
 * Implements Attendance Documentation §3.5.2: each session's valid BSSID
 * set is the union of BSSIDs serving the hall(s) this session covers.
 *
 * @param {import('@prisma/client').PrismaClient | object} tx  Prisma client or $transaction client
 * @param {string} courseId
 * @param {string} userId
 * @returns {Promise<string[]>}  Deduped BSSID strings; empty array when no halls assignable.
 */
async function resolveValidBssidsForSession(tx, courseId, userId) {
  const ownSections = await tx.courseSection.findMany({
    where: { courseId, instructorId: userId, hallId: { not: null } },
    select: { hallId: true },
  });
  const taSections = await tx.courseSection.findMany({
    where: {
      courseId,
      hallId: { not: null },
      taAssignments: { some: { taId: userId } },
    },
    select: { hallId: true },
  });

  let hallIds = [...new Set([...ownSections, ...taSections].map((s) => s.hallId).filter(Boolean))];

  if (hallIds.length === 0) {
    const allSections = await tx.courseSection.findMany({
      where: { courseId, hallId: { not: null } },
      select: { hallId: true },
    });
    hallIds = [...new Set(allSections.map((s) => s.hallId).filter(Boolean))];
  }

  if (hallIds.length === 0) return [];

  const halls = await tx.bssidLocation.findMany({
    where: { id: { in: hallIds }, isActive: true },
    select: { bssid: true },
  });
  return [...new Set(halls.map((h) => h.bssid).filter(Boolean))];
}

// ── POST /api/attendance/session/start ───────────────────────────────────
// Start (or reuse) an attendance session. Prof/TA/Admin only.
// Advisory lock on (courseId, instructorId) prevents duplicate sessions from
// race conditions (double-click, page double-mount).
router.post('/session/start', requireAuth, async (req, res) => {
  if (!['professor', 'ta', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const tenantId = req.user?.tenantId || req.tenantId;
  const { courseCode, durationMinutes, restrictedToUserIds } = req.body;
  console.log(
    `[attendance] start request: course=${courseCode} ` +
      `restrictedToUserIds=${JSON.stringify(restrictedToUserIds)}`,
  );
  try {
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const restrictedList = Array.isArray(restrictedToUserIds)
      ? restrictedToUserIds.map((s) => String(s)).filter(Boolean)
      : [];

    // Build a Postgres array literal. Prisma's tagged-template array binding
    // JSON-stringifies JS arrays, which Postgres text[] can't parse. Building
    // the literal ourselves avoids that serialization issue entirely.
    const escapeArrayElement = (s) =>
      `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const arrayLiteral = `{${restrictedList.map(escapeArrayElement).join(',')}}`;

    const minutes = Math.max(
      1,
      Math.min(120, Number.parseInt(durationMinutes, 10) || 10),
    );
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

    const now = new Date();
    const keyMaterial = `attendance-start:${course.id}:${req.user.userId}`;
    const lockKey =
      parseInt(crypto.createHash('sha1').update(keyMaterial).digest('hex').slice(0, 15), 16) || 1;

    const { session, isReused, validBssids } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

      // Resolve the hall BSSID whitelist BEFORE the create/update so we can
      // write it atomically with the session row. Phase-1 hall isolation.
      const validBssids = await resolveValidBssidsForSession(tx, course.id, req.user.userId);

      const existing = await tx.attendanceSession.findFirst({
        where: {
          courseId: course.id,
          instructorId: req.user.userId,
          isActive: true,
          status: 'active',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) {
        // Refresh validBssids on reuse so admin hall changes since the
        // session opened take effect on the next mark attempt.
        const updated = await tx.attendanceSession.update({
          where: { id: existing.id },
          data: { expiresAt, validBssids },
        });
        await tx.$executeRawUnsafe(
          `UPDATE "attendance_sessions" SET "restricted_to_user_ids" = $1::text[] WHERE id = $2 AND tenant_id = $3`,
          arrayLiteral,
          existing.id,
          tenantId,
        );
        return { session: updated, isReused: true, validBssids };
      }
      const created = await tx.attendanceSession.create({
        data: {
          courseId: course.id,
          courseCode: courseCode.toUpperCase(),
          courseName: course.title,
          instructorId: req.user.userId,
          isActive: true,
          status: 'active',
          expiresAt,
          validBssids,
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "attendance_sessions" SET "restricted_to_user_ids" = $1::text[] WHERE id = $2 AND tenant_id = $3`,
        arrayLiteral,
        created.id,
        tenantId,
      );
      return { session: created, isReused: false, validBssids };
    });

    const verify = await prisma.$queryRaw`
        SELECT "restricted_to_user_ids" AS ids
          FROM "attendance_sessions"
         WHERE id = ${session.id}
           AND tenant_id = ${tenantId}
    `;
    const persistedIds = Array.isArray(verify?.[0]?.ids) ? verify[0].ids : [];
    console.log(
      `[attendance] session ${isReused ? 'reused' : 'created'}: ${session.id} ` +
        `requested=[${restrictedList.join(',')}] ` +
        `persisted=[${persistedIds.join(',')}] ` +
        `match=${JSON.stringify(restrictedList) === JSON.stringify(persistedIds)} ` +
        `validBssids=${validBssids.length}`,
    );

    const qrToken = generateQRToken(session.id, courseCode);
    const qrUrl = buildQrUrl(req, session.id, qrToken);

    // Fire-and-forget: notify enrolled students that a session has started.
    setImmediate(async () => {
      try {
        const registrations = await prisma.registration.findMany({
          where: {
            section: { course: { code: courseCode.toUpperCase() } },
            status: 'approved',
            isActive: true,
          },
          select: { userId: true },
        });
        const userIds = [...new Set(registrations.map((r) => r.userId))];
        if (userIds.length > 0) {
          const r = await fetch(
            `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/broadcast`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: req.headers['authorization'] || '',
                Cookie: req.headers['cookie'] || '',
              },
              body: JSON.stringify({
                userIds,
                title: `Attendance open — ${courseCode.toUpperCase()}`,
                content: `Your instructor just started attendance for ${courseCode.toUpperCase()}. Open Mark Attendance to scan the QR.`,
                type: 'critical',
                priority: 'high',
                referenceType: 'AttendanceSession',
                referenceId: session.id,
              }),
            }
          );
          console.log(
            `[attendance] session-start fan-out → ${courseCode.toUpperCase()} ` +
              `recipients=${userIds.length} status=${r.status}`,
          );
        }
      } catch (e) {
        console.warn('[attendance] notification fan-out failed:', e.message);
      }
    });

    res.json({ session, qrToken, qrUrl, reused: isReused });
  } catch (e) {
    console.error('[attendance] start failed:', e);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// ── POST /api/attendance/sessions/:sessionId/end ──────────────────────────
// Explicitly close a session; auto-files absent rows for no-shows.
// Idempotent: re-calling on an already-ended session is a no-op.
router.post(
  '/sessions/:sessionId/end',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { sessionId } = req.params;
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
      select: { id: true, isActive: true, courseCode: true, courseId: true, date: true },
    });
    if (!session) throw new AppError('Session not found', 404);

    if (!session.isActive) {
      return res.json({ success: true, alreadyEnded: true });
    }

    const restrictRows = await prisma.$queryRaw`
      SELECT "restricted_to_user_ids" AS ids FROM "attendance_sessions" WHERE id = ${sessionId} AND tenant_id = ${tenantId}
    `;
    const restrictedIds = Array.isArray(restrictRows?.[0]?.ids) ? restrictRows[0].ids : [];

    console.log(
      `[attendance] end: session=${sessionId} ` +
        `restriction=${restrictedIds.length > 0 ? '[' + restrictedIds.join(',') + ']' : 'none'}`,
    );

    const updated = await prisma.$transaction(async (tx) => {
      const eligibleUserIds = await (async () => {
        if (restrictedIds.length > 0) return restrictedIds;
        const regs = await tx.registration.findMany({
          where: { courseId: session.courseId, status: 'approved', isActive: true },
          select: { userId: true },
        });
        return [...new Set(regs.map((r) => r.userId))];
      })();

      const marked = await tx.attendanceRecord.findMany({
        where: { sessionId },
        select: { userId: true },
      });
      const markedSet = new Set(marked.map((m) => m.userId));
      const toAbsent = eligibleUserIds.filter((uid) => !markedSet.has(uid));

      if (toAbsent.length > 0) {
        await tx.attendanceRecord.createMany({
          data: toAbsent.map((uid) => ({
            userId: uid,
            sessionId,
            courseId: session.courseId,
            courseCode: session.courseCode,
            status: 'absent',
            date: session.date || new Date(),
            verificationMethod: 'manual',
            markedAt: null,
          })),
          skipDuplicates: true,
        });
      }

      const u = await tx.attendanceSession.update({
        where: { id: sessionId },
        data: { isActive: false, status: 'ended', endedAt: new Date() },
      });
      return { session: u, absentFiled: toAbsent.length };
    });

    console.log(
      `[attendance] session ended: ${updated.session.courseCode} (${updated.session.id}) ` +
        `— filed ${updated.absentFiled} absent record(s)` +
        (restrictedIds.length > 0 ? ` [restricted to ${restrictedIds.length} students]` : ''),
    );
    res.json({ success: true, session: updated.session, absentFiled: updated.absentFiled });
  })
);

// ── GET /api/attendance/course/:courseCode/eligible-students ──────────────
// Approved+active roster for restricted-session student picker.
router.get(
  '/course/:courseCode/eligible-students',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const code = req.params.courseCode.toUpperCase();
    const course = await prisma.course.findFirst({
      where: { code },
      select: { id: true, code: true, title: true },
    });
    if (!course) throw new AppError('Course not found', 404);

    const regs = await prisma.registration.findMany({
      where: { courseId: course.id, status: 'approved', isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    const seen = new Set();
    const students = [];
    for (const r of regs) {
      const u = r.user;
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      students.push({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
      });
    }
    students.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ courseCode: course.code, students });
  })
);

// ── DELETE /api/attendance/sessions/:sessionId ────────────────────────────
// Hard-delete a session + linked records. Owner or admin required.
// Excuses + cheating flags have their sessionId nulled so the history stays intact.
router.delete(
  '/sessions/:sessionId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
      select: { id: true, instructorId: true, courseCode: true },
    });
    if (!session) throw new AppError('Session not found', 404);

    const isOwner = !!session.instructorId && session.instructorId === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    const isOrphan = !session.instructorId;
    if (!isOwner && !isAdmin && !isOrphan) {
      throw new AppError(
        'This session was started by another instructor. ' +
          'Ask them to delete it, or have an admin do it.',
        403,
      );
    }

    await prisma.$transaction([
      prisma.attendanceExcuse.updateMany({
        where: { sessionId },
        data: { sessionId: null },
      }),
      prisma.cheatingFlag.updateMany({
        where: { sessionId },
        data: { sessionId: null },
      }),
      prisma.attendanceRecord.deleteMany({ where: { sessionId } }),
      prisma.attendanceSession.delete({ where: { id: sessionId } }),
    ]);

    console.log(`[attendance] session deleted: ${session.courseCode} (${session.id})`);
    res.json({ success: true });
  })
);

// ── GET /api/attendance/sessions/:sessionId/roster ────────────────────────
// Enrolled student list + each student's record status for a session.
router.get(
  '/sessions/:sessionId/roster',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const tenantId = req.user?.tenantId || req.tenantId;
    const { sessionId } = req.params;

    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
      select: { id: true, courseId: true, courseCode: true },
    });
    if (!session) throw new AppError('Session not found', 404);

    const restrictRows = await prisma.$queryRaw`
      SELECT "restricted_to_user_ids" AS ids FROM "attendance_sessions" WHERE id = ${sessionId} AND tenant_id = ${tenantId}
    `;
    const restrictedIds = Array.isArray(restrictRows?.[0]?.ids) ? restrictRows[0].ids : [];
    console.log(
      `[attendance] roster: session=${sessionId} restriction=` +
        (restrictedIds.length > 0 ? `[${restrictedIds.join(',')}]` : 'none'),
    );

    const regs = await prisma.registration.findMany({
      where: {
        courseId: session.courseId,
        status: 'approved',
        isActive: true,
        ...(restrictedIds.length > 0 ? { userId: { in: restrictedIds } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            odId: true,
            profilePicture: true,
          },
        },
      },
    });

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId },
      select: { userId: true, status: true, verificationMethod: true, markedAt: true },
    });
    const byUserId = new Map(records.map((r) => [r.userId, r]));

    const seen = new Set();
    const roster = [];
    for (const r of regs) {
      const u = r.user;
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const rec = byUserId.get(u.id) || null;
      roster.push({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        odId: u.odId,
        profilePicture: u.profilePicture ?? null,
        status: rec?.status ?? null,
        verificationMethod: rec?.verificationMethod ?? null,
        markedAt: rec?.markedAt ?? null,
      });
    }

    roster.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      sessionId: session.id,
      courseCode: session.courseCode,
      roster,
      restrictedToUserIds: restrictedIds,
    });
  })
);

// ── POST /api/attendance/sessions/:sessionId/mark-student ─────────────────
// Staff manual mark — bypasses QR + BSSID. Idempotent upsert.
// Body: { userId: string, status: 'present'|'late'|'absent'|'excused' }
router.post(
  '/sessions/:sessionId/mark-student',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { userId, status } = req.body || {};
    const ALLOWED = ['present', 'late', 'absent', 'excused'];
    if (!userId || !ALLOWED.includes(status)) {
      throw new AppError(
        `userId and a valid status (${ALLOWED.join(' | ')}) are required`,
        400,
      );
    }

    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
      select: { id: true, courseId: true, courseCode: true, courseName: true },
    });
    if (!session) throw new AppError('Session not found', 404);

    const enrolled = await prisma.registration.findFirst({
      where: { userId, courseId: session.courseId, status: 'approved', isActive: true },
      select: { id: true },
    });
    if (!enrolled) throw new AppError('Student is not enrolled in this course', 403);

    const existing = await prisma.attendanceRecord.findFirst({
      where: { userId, sessionId },
      select: { id: true },
    });

    let record;
    if (existing) {
      record = await prisma.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          status,
          verificationMethod: 'manual',
          markedAt: new Date(),
          overridden: true,
          overrideReason: `Marked manually by ${req.user.role} (${req.user.userId})`,
        },
      });
    } else {
      record = await prisma.attendanceRecord.create({
        data: {
          userId,
          sessionId,
          courseId: session.courseId,
          courseCode: session.courseCode ?? null,
          courseName: session.courseName ?? null,
          status,
          verificationMethod: 'manual',
          markedAt: new Date(),
          bssidVerified: false,
        },
      });
    }

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
      const fetchFn = global.fetch || require('node-fetch');
      const courseLabel = session.courseCode || session.courseName || 'class';
      const niceStatus =
        status === 'present' ? 'Present' :
        status === 'late' ? 'Late' :
        status === 'excused' ? 'Excused' : 'Absent';
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify({
          userId,
          title: `Attendance updated — ${courseLabel}`,
          content: `You were marked "${niceStatus}" for ${courseLabel}.`,
          type: status === 'absent' ? 'warning' : 'info',
          referenceType: 'AttendanceSession',
          referenceId: session.id,
        }),
      }).catch(() => { /* best-effort */ });
    });

    res.json({ success: true, record });
  })
);

module.exports = router;
