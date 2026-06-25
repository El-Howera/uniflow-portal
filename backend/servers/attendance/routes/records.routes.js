/**
 * Attendance record and session-query routes for the attendance service.
 *
 * Owns authenticated endpoints for reading/writing AttendanceRecord rows
 * and the student/public session-query surfaces that require auth:
 *   POST /api/attendance/mark              — student QR scan self-mark
 *   GET  /api/attendance/today             — today's classes (student, auth)
 *   GET  /api/attendance/live-sessions     — live scan cards (student, auth)
 *   GET  /api/attendance/sessions          — active session list (no auth)
 *   GET  /api/attendance/session/:id/qr    — current QR token (no auth)
 *   GET  /api/attendance/professor/today   — prof's today sessions (auth)
 *   POST /api/attendance/preview/create-session — preview/testing (no auth)
 *   GET  /api/attendance/student/:id/summary — per-course summary (auth)
 *
 * No-auth public endpoints (/today/:userId, /history/:userId, /summary/:userId,
 * /flags/:userId) live in public.routes.js to keep this file under 600 lines.
 *
 * Non-obvious decisions:
 *   - BSSID validation is delegated to lib/restrictions.js checkBssid() so
 *     the mark handler stays readable.
 *   - The preview endpoint is auth-optional: stamps instructorId when a valid
 *     JWT is present but never rejects unauthenticated callers.
 */

const express = require('express');
const jwt = require('jsonwebtoken');

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler } = require('../../../lib/errors');
const { getHolidays } = require('../../../lib/attendance-rules');
const { getFinalizedCourseIds } = require('../../../lib/finalized-courses');
const { checkBssid } = require('../lib/restrictions');
const { generateQRToken, buildQrUrl, JWT_SECRET } = require('../lib/qr');

const NODE_ENV = process.env.NODE_ENV || 'development';

const router = express.Router();

// ── GET /api/attendance/today ─────────────────────────────────────────────
// Today's classes for the authenticated student. Hides finalized courses.
router.get('/today', requireAuth, async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

    const [registrations, finalizedCourseIds] = await Promise.all([
      prisma.registration.findMany({
        where: { userId: req.user.userId, status: 'approved', isActive: true },
        include: {
          course: true,
          section: {
            include: {
              slots: { where: { day: today } },
            },
          },
        },
      }),
      getFinalizedCourseIds(prisma, req.user.userId),
    ]);

    const activeClasses = registrations
      .filter((reg) => reg.section.slots.length > 0)
      .filter((reg) => !finalizedCourseIds.has(reg.courseId))
      .map((reg) => ({
        courseCode: reg.course.code,
        courseTitle: reg.course.title,
        location: reg.section.location,
        time: reg.section.slots[0].startTime
          .toISOString()
          .split('T')[1]
          .substring(0, 5),
      }));

    res.json(activeClasses);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch today's classes" });
  }
});

// ── GET /api/attendance/live-sessions ─────────────────────────────────────
// Active, un-marked sessions for the student's enrolled courses.
router.get('/live-sessions', requireAuth, async (req, res) => {
  try {
    const regs = await prisma.registration.findMany({
      where: { userId: req.user.userId, status: 'approved', isActive: true },
      select: { courseId: true },
    });
    const allCourseIds = [...new Set(regs.map((r) => r.courseId))];
    if (allCourseIds.length === 0) return res.json([]);
    const finalizedCourseIds = await getFinalizedCourseIds(prisma, req.user.userId, allCourseIds);
    const courseIds = allCourseIds.filter((id) => !finalizedCourseIds.has(id));
    if (courseIds.length === 0) return res.json([]);

    const now = new Date();
    const sessions = await prisma.attendanceSession.findMany({
      where: {
        courseId: { in: courseIds },
        isActive: true,
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        course: { select: { code: true, title: true } },
        instructor: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startedAt: 'desc' },
    });

    const sessionIds = sessions.map((s) => s.id);
    const alreadyMarked = await prisma.attendanceRecord.findMany({
      where: { sessionId: { in: sessionIds }, userId: req.user.userId },
      select: { sessionId: true, status: true },
    });
    const markedSet = new Set(alreadyMarked.map((r) => r.sessionId));

    const live = sessions
      .filter((s) => !markedSet.has(s.id))
      .map((s) => ({
        sessionId: s.id,
        courseCode: s.course.code,
        courseTitle: s.course.title,
        instructorName: s.instructor
          ? `${s.instructor.firstName} ${s.instructor.lastName}`.trim()
          : null,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        room: s.roomOverride ?? null,
      }));

    res.json(live);
  } catch (e) {
    console.error('[attendance] live-sessions error:', e);
    res.status(500).json({ error: 'Failed to fetch live sessions' });
  }
});

// ── POST /api/attendance/mark ─────────────────────────────────────────────
// Student QR scan. Validates token, BSSID gate, restriction list, idempotent upsert.
router.post('/mark', requireAuth, async (req, res) => {
  const tenantId = req.user?.tenantId || req.tenantId;
  const { sessionId, qrToken, bssid, deviceId } = req.body || {};
  if (!sessionId || !qrToken) {
    return res.status(400).json({ error: 'sessionId and qrToken are required' });
  }
  // Device-binding + BSSID enforcement (Attendance Documentation §3.5). Gated
  // off by default so the PWA — which can't read the Wi-Fi BSSID or do native
  // device crypto — keeps working. Flip DEVICE_BINDING_ENFORCED=true once the
  // native Capacitor app ships. The full logic is wired below either way.
  const DEVICE_ENFORCED = process.env.DEVICE_BINDING_ENFORCED === 'true';

  try {
    let decoded;
    try {
      decoded = jwt.verify(qrToken, JWT_SECRET);
    } catch {
      return res.status(403).json({ error: 'Invalid or expired QR code. Ask your instructor to refresh it and rescan.' });
    }
    if (decoded.sessionId !== sessionId) {
      return res.status(400).json({ error: 'QR code does not match this session' });
    }

    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
      select: {
        id: true, courseId: true, courseCode: true, courseName: true,
        isActive: true, expiresAt: true, bssidRequired: true,
        validBssids: true,
      },
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.isActive || (session.expiresAt && session.expiresAt < new Date())) {
      return res.status(403).json({ error: 'This attendance session is closed' });
    }

    const restrictRows = await prisma.$queryRaw`
        SELECT "restricted_to_user_ids" AS ids FROM "attendance_sessions" WHERE id = ${sessionId} AND tenant_id = ${tenantId}
    `;
    const restrictedIds = Array.isArray(restrictRows?.[0]?.ids) ? restrictRows[0].ids : [];
    if (restrictedIds.length > 0 && !restrictedIds.includes(req.user.userId)) {
      return res.status(403).json({
        error: 'This session is restricted to specific students. You\'re not on the list.',
      });
    }

    // ── Device-binding gate (§3.5.3 Cryptographic Device Binding) ────────────
    // A student must have a device registered, and the scan must come from THAT
    // device. Enforced only when DEVICE_BINDING_ENFORCED=true (native app).
    if (DEVICE_ENFORCED) {
      const me = await prisma.user.findFirst({
        where: { id: req.user.userId },
        select: { registeredDeviceId: true, deviceReleaseAt: true },
      });
      if (!me?.registeredDeviceId) {
        const locked = me?.deviceReleaseAt && new Date(me.deviceReleaseAt) > new Date();
        return res.status(403).json({
          error: locked
            ? 'Your device release is in cooldown. Ask your instructor to record attendance manually until it clears.'
            : 'Register your device in your profile before marking attendance.',
          reason: locked ? 'device_release_cooldown' : 'no_registered_device',
          releaseAt: me?.deviceReleaseAt || null,
        });
      }
      if (deviceId && deviceId !== me.registeredDeviceId) {
        return res.status(403).json({
          error: 'This is not your registered device. Attendance can only be marked from your bound device.',
          reason: 'device_mismatch',
        });
      }
    }

    // ── BSSID gate (§3.5.2 Wi-Fi BSSID Verification) ─────────────────────────
    // Verifies the scan came from inside the lecture hall (hall-scoped AP MAC).
    // Enforced only under DEVICE_BINDING_ENFORCED; the PWA can't read BSSIDs so
    // the result is logged but non-blocking when the flag is off.
    let bssidResult = { ok: true, verified: false };
    if (DEVICE_ENFORCED) {
      bssidResult = await checkBssid(
        prisma,
        bssid,
        NODE_ENV,
        session.bssidRequired,
        session.validBssids,
      );
      if (!bssidResult.ok) {
        return res
          .status(bssidResult.errorCode === 'bssid_missing' ? 400 : 403)
          .json({ error: bssidResult.error, reason: bssidResult.errorCode });
      }
    }

    const existing = await prisma.attendanceRecord.findFirst({
      where: { userId: req.user.userId, sessionId },
      select: { id: true },
    });
    const data = {
      userId: req.user.userId,
      sessionId,
      courseId: session.courseId,
      courseCode: session.courseCode ?? decoded.courseCode ?? null,
      courseName: session.courseName ?? null,
      status: 'present',
      bssidVerified: bssidResult.verified,
      bssid: bssid ?? null,
      verificationMethod: 'qr_code',
      markedAt: new Date(),
    };

    const record = existing
      ? await prisma.attendanceRecord.update({ where: { id: existing.id }, data })
      : await prisma.attendanceRecord.create({ data });

    if (!existing) {
      setImmediate(() => {
        const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/system`;
        const fetchFn = global.fetch || require('node-fetch');
        const courseLabel = session.courseCode || session.courseName || 'class';
        fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization || '',
          },
          body: JSON.stringify({
            userId: req.user.userId,
            title: `Checked in — ${courseLabel}`,
            content: `Your attendance for ${courseLabel} is recorded.`,
            type: 'success',
            referenceType: 'AttendanceSession',
            referenceId: session.id,
          }),
        }).catch(() => { /* best-effort */ });
      });
    }

    res.json({ success: true, record });
  } catch (e) {
    console.error('[attendance] mark error:', e);
    res.status(500).json({ error: 'Attendance verification failed' });
  }
});

// ── GET /api/attendance/professor/today ───────────────────────────────────
// Today's sessions for the authenticated instructor.
router.get('/professor/today', requireAuth, asyncHandler(async (req, res) => {
  const instructorId = req.user.userId;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const sessions = await prisma.attendanceSession.findMany({
    where: {
      instructorId,
      date: { gte: today, lt: tomorrow },
    },
    include: {
      course: { select: { code: true, title: true } },
      _count: { select: { records: true } },
    },
    orderBy: { date: 'asc' },
  });

  res.json({ success: true, sessions });
}));

// ── GET /api/attendance/session/:sessionId/qr ─────────────────────────────
// Current QR token for an active session (unauthenticated — prof polls this).
router.get('/session/:sessionId/qr', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (!session.isActive) {
      return res.status(400).json({ error: 'Session is not active' });
    }

    const now = Date.now();
    const expiresAt = now + 15000;
    const token = generateQRToken(session.id, session.courseCode);
    const qrUrl = buildQrUrl(req, session.id, token);
    const qrData = {
      qrId: session.id,
      token,
      timestamp: now,
      expiresAt,
      qrData: qrUrl,
      qrUrl,
    };

    res.json({ currentQR: qrData });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] session/:sessionId/qr error', e);
    res.status(500).json({ error: 'Failed to generate QR token' });
  }
});

// ── GET /api/attendance/sessions ──────────────────────────────────────────
// List active sessions (unauthenticated). Returns both `id` and `sessionId`
// alias for frontend compatibility (prof live-polling loop keys on sessionId).
router.get('/sessions', async (req, res) => {
  try {
    const sessions = await prisma.attendanceSession.findMany({
      where: { isActive: true },
      include: {
        course: { select: { code: true, title: true } },
        records: { select: { status: true } },
      },
      orderBy: { date: 'desc' },
      take: 20,
    });

    res.json(
      sessions.map((s) => {
        const markedCount = (s.records || []).filter(
          (r) => r.status === 'present' || r.status === 'late' || r.status === 'excused'
        ).length;
        return {
          id: s.id,
          sessionId: s.id,
          courseCode: s.courseCode || s.course?.code,
          courseName: s.courseName || s.course?.title,
          date: s.date,
          status: s.status,
          isActive: s.isActive,
          startedAt: s.startedAt,
          instructorId: s.instructorId,
          markedCount,
          totalStudents: (s.records || []).length,
        };
      })
    );
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] sessions error', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ── POST /api/attendance/preview/create-session ──────────────────────────────
// Preview/testing endpoint. Auth-optional — stamps instructorId when a valid
// JWT is present but never rejects unauthenticated callers.
router.post('/preview/create-session', async (req, res) => {
  try {
    const { courseCode, location } = req.body;
    if (!courseCode) {
      return res.status(400).json({ success: false, message: 'courseCode is required' });
    }

    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });

    if (!course) {
      return res.status(404).json({ success: false, message: `Course ${courseCode} not found` });
    }

    let instructorId = null;
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded?.userId) instructorId = decoded.userId;
      }
    } catch { /* unauthenticated preview session — leave instructorId null */ }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const session = await prisma.attendanceSession.create({
      data: {
        courseId: course.id,
        courseCode: course.code,
        courseName: course.title,
        roomOverride: location || null,
        ...(instructorId ? { instructorId } : {}),
        expiresAt,
        isActive: true,
        status: 'active',
      },
    });

    const now = Date.now();
    const tokenExpiry = now + 15000;
    const token = generateQRToken(session.id, session.courseCode);

    res.json({
      success: true,
      message: 'Preview session created',
      sessionId: session.id,
      courseCode: session.courseCode,
      currentQR: {
        qrId: session.id,
        token,
        timestamp: now,
        expiresAt: tokenExpiry,
        qrData: token,
      },
      expiresAt: expiresAt.toISOString(),
      securityFeatures: {
        dynamicQR: true,
        refreshInterval: '15s',
        bssidValidation: false,
        duplicateDetection: true,
        validBSSIDs: [],
      },
    });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] preview/create-session error', e);
    res.status(500).json({ success: false, message: 'Failed to create preview session' });
  }
});

// ── GET /api/attendance/student/:id/summary ───────────────────────────────
// Per-course attendance summary (holiday-aware). Requires auth.
router.get('/student/:id/summary', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [records, holidays, finalizedCourseIds] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { userId: id },
      include: {
        session: {
          include: {
            course: { select: { code: true, title: true } },
          },
        },
      },
    }),
    getHolidays(prisma),
    getFinalizedCourseIds(prisma, id),
  ]);

  const holidaySet = new Set((holidays || []).map((h) => h.date));
  const isOnHoliday = (r) => {
    const d = r?.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r?.date || '').slice(0, 10);
    return d && holidaySet.has(d);
  };

  const grouped = {};
  for (const r of records) {
    if (isOnHoliday(r)) continue;
    if (finalizedCourseIds.has(r.courseId)) continue;
    const courseId = r.courseId;
    if (!grouped[courseId]) {
      grouped[courseId] = {
        courseId,
        courseCode: r.session?.course?.code || courseId,
        courseTitle: r.session?.course?.title || '',
        present: 0,
        late: 0,
        absent: 0,
        excused: 0,
        total: 0,
      };
    }
    grouped[courseId].total++;
    if (r.status === 'present') grouped[courseId].present++;
    else if (r.status === 'late') grouped[courseId].late++;
    else if (r.status === 'absent') grouped[courseId].absent++;
    else if (r.status === 'excused') grouped[courseId].excused++;
  }

  const summary = Object.values(grouped).map((g) => ({
    ...g,
    percentage: g.total > 0 ? Math.round(((g.present + g.late + g.excused) / g.total) * 100) : 0,
  }));

  res.json({ success: true, summary });
}));

module.exports = router;
