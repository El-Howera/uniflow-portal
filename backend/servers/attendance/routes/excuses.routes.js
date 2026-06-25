/**
 * Absence excuse routes for the attendance service.
 *
 * Owns (MVP build — student submit + student-self view):
 *   POST  /api/attendance/excuse               — student submits excuse (JSON or multipart)
 *   GET   /api/attendance/excuses/:userId      — student/staff views excuses
 *
 * MVP build notes:
 *   - The SA review queue (GET /api/sa/attendance-excuses) and the SA
 *     approve/reject decision handler (PATCH /api/sa/attendance-excuses/:id)
 *     have been removed — the MVP build keeps a real backend only for student
 *     & professor.
 *   - The multer middleware (excuseUpload) and handleExcuseUpload wrapper are
 *     defined locally here because they are only needed by the excuse submit
 *     endpoint. The upload directory is shared with the static /uploads mount
 *     in index.js (backend/servers/attendance/uploads/excuses/).
 *   - Fan-out notifications fire via setImmediate so the HTTP response is never
 *     delayed by the notification server's latency.
 */

const express = require('express');
const path = require('path');
const storage = require('../../../lib/storage');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { restoreTenantContext } = require('../../../lib/tenant-context');

// ── Multer setup ──────────────────────────────────────────────────────────
// Honours UPLOAD_ROOT (Fly volume at /app/uploads). Files written under
// `excuses/` are served via nginx /uploads/ alias on Fly and via the
// attendance server's express.static mount in dev.
const EXCUSE_UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'excuses')
  : path.join(__dirname, '..', 'uploads', 'excuses');
fs.mkdirSync(EXCUSE_UPLOAD_DIR, { recursive: true });

const excuseUpload = storage.memoryUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf|png|jpg|jpeg|webp|doc|docx/i;
    cb(null, allowed.test(file.mimetype) || allowed.test(path.extname(file.originalname)));
  },
});

// Wrap multer so size/type errors return clean 400s instead of crashing.
const handleExcuseUpload = (req, res, next) => {
  excuseUpload.single('evidence')(req, res, (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 5 MB)'
        : err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Unexpected file field'
        : err.message || 'Upload failed';
      return res.status(400).json({ error: code });
    }
    next();
  });
};

const router = express.Router();

// ── POST /api/attendance/excuse ───────────────────────────────────────────
// Student submits an absence excuse. Accepts JSON or multipart/form-data.
// Multi-course path: body.courseCodes[] creates one excuse row per code.
// Single-row path: body.attendanceRecordId or body.sessionId.
router.post(
  '/attendance/excuse',
  requireAuth,
  handleExcuseUpload,
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const reason = (req.body?.reason || '').toString().trim();

    if (!reason) throw new AppError('Reason is required', 400);

    let courseCodes = req.body?.courseCodes;
    if (typeof courseCodes === 'string') {
      try {
        const parsed = JSON.parse(courseCodes);
        if (Array.isArray(parsed)) courseCodes = parsed;
        else courseCodes = courseCodes.split(',');
      } catch {
        courseCodes = courseCodes.split(',');
      }
    }
    if (Array.isArray(courseCodes)) {
      courseCodes = courseCodes
        .map((c) => String(c || '').trim().toUpperCase())
        .filter(Boolean);
    } else {
      courseCodes = null;
    }

    const evidenceUrl = req.file
      ? `/uploads/excuses/${(await storage.saveUpload('excuses', req.file)).filename}`
      : (req.body?.evidenceUrl || null);

    // ── Path 1: multi-course ──────────────────────────────────────────────
    if (courseCodes && courseCodes.length > 0) {
      const regs = await prisma.registration.findMany({
        where: {
          userId,
          isActive: true,
          status: { in: ['pending', 'approved'] },
          course: { code: { in: courseCodes } },
        },
        include: { course: { select: { id: true, code: true } } },
      });

      const allowedCodes = new Set(regs.map((r) => r.course.code));
      const unknown = courseCodes.filter((c) => !allowedCodes.has(c));
      if (unknown.length > 0) {
        throw new AppError(
          `You are not registered for: ${unknown.join(', ')}. ` +
            `Excuses can only be submitted for your enrolled courses.`,
          400
        );
      }

      const codeToCourseId = new Map();
      for (const r of regs) {
        if (!codeToCourseId.has(r.course.code)) {
          codeToCourseId.set(r.course.code, r.course.id);
        }
      }

      const courseIds = [...codeToCourseId.values()];
      const recentSessions = await prisma.attendanceSession.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, courseId: true },
      });
      const latestByCourseId = new Map();
      for (const s of recentSessions) {
        if (!latestByCourseId.has(s.courseId)) latestByCourseId.set(s.courseId, s.id);
      }

      const created = await prisma.$transaction(
        [...codeToCourseId.entries()].map(([code, courseId]) =>
          prisma.attendanceExcuse.create({
            data: {
              userId,
              sessionId: latestByCourseId.get(courseId) || null,
              attendanceRecordId: null,
              reason: `[${code}] ${reason}`,
              evidenceUrl,
              status: 'pending',
            },
          })
        )
      );

      setImmediate(async () => {
        try {
          const [saUsers, sections, student] = await Promise.all([
            prisma.user.findMany({
              where: { role: 'sa', deletedAt: null, emailVerified: true },
              select: { id: true },
            }),
            prisma.courseSection.findMany({
              where: { courseId: { in: courseIds } },
              select: { instructorId: true },
            }),
            prisma.user.findUnique({
              where: { id: userId },
              select: { firstName: true, lastName: true },
            }),
          ]);
          const studentName = student
            ? `${student.firstName} ${student.lastName}`.trim()
            : 'A student';
          const professorIds = [...new Set(sections.map((s) => s.instructorId).filter(Boolean))];
          const recipientIds = [...new Set([...saUsers.map((u) => u.id), ...professorIds])];
          if (recipientIds.length === 0) return;

          const courseListStr = [...codeToCourseId.keys()].join(', ');
          const title = `Absence excuse — ${studentName}`;
          const content = `${studentName} submitted an absence excuse for ${courseListStr}. Open Student Affairs queue to review.`;
          const referenceId = created[0]?.id || null;

          const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/system`;
          const fetchFn = global.fetch || require('node-fetch');
          await Promise.all(
            recipientIds.map((rid) =>
              fetchFn(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: req.headers.authorization || '',
                  Cookie: req.headers.cookie || '',
                },
                body: JSON.stringify({
                  userId: rid,
                  title,
                  content,
                  type: 'info',
                  referenceType: 'AttendanceExcuse',
                  ...(referenceId ? { referenceId } : {}),
                }),
              }).catch(() => { /* best-effort */ })
            )
          );
          console.log(
            `[attendance] excuse fan-out → student=${userId} ` +
              `courses=${courseListStr} recipients=${recipientIds.length}`,
          );
        } catch (e) {
          console.warn('[attendance] excuse notification fan-out failed:', e.message);
        }
      });

      return res.json({
        success: true,
        message: `Submitted ${created.length} excuse${created.length === 1 ? '' : 's'} for review.`,
        excuses: created,
      });
    }

    // ── Path 2: single-row (record-linked appeal or session-linked excuse) ──
    const { sessionId, attendanceRecordId } = req.body || {};
    let validatedCourseId = null;
    if (attendanceRecordId) {
      const rec = await prisma.attendanceRecord.findFirst({
        where: { id: attendanceRecordId },
        select: { id: true, userId: true, courseId: true },
      });
      if (!rec || rec.userId !== userId) {
        throw new AppError('Not allowed to appeal this attendance record', 403);
      }
      validatedCourseId = rec.courseId;
    } else if (sessionId) {
      const sess = await prisma.attendanceSession.findFirst({
        where: { id: sessionId },
        select: { id: true, courseId: true },
      });
      if (!sess) throw new AppError('Session not found', 404);
      const reg = await prisma.registration.findFirst({
        where: { userId, courseId: sess.courseId, status: 'approved', isActive: true },
        select: { id: true },
      });
      if (!reg) throw new AppError('Not allowed to file an excuse for this session', 403);
      validatedCourseId = sess.courseId;
    }

    const excuse = await prisma.attendanceExcuse.create({
      data: {
        userId,
        sessionId: sessionId || null,
        attendanceRecordId: attendanceRecordId || null,
        reason,
        evidenceUrl,
        status: 'pending',
      },
    });

    setImmediate(async () => {
      try {
        const courseIds = validatedCourseId ? [validatedCourseId] : [];
        const [saUsers, sections, student, course] = await Promise.all([
          prisma.user.findMany({
            where: { role: 'sa', deletedAt: null, emailVerified: true },
            select: { id: true },
          }),
          courseIds.length
            ? prisma.courseSection.findMany({
                where: { courseId: { in: courseIds } },
                select: { instructorId: true },
              })
            : Promise.resolve([]),
          prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, lastName: true },
          }),
          courseIds.length
            ? prisma.course.findFirst({
                where: { id: courseIds[0] },
                select: { code: true },
              })
            : Promise.resolve(null),
        ]);
        const studentName = student
          ? `${student.firstName} ${student.lastName}`.trim()
          : 'A student';
        const professorIds = [...new Set(sections.map((s) => s.instructorId).filter(Boolean))];
        const recipientIds = [...new Set([...saUsers.map((u) => u.id), ...professorIds])];
        if (recipientIds.length === 0) return;

        const courseLabel = course?.code || 'attendance';
        const title = `Absence appeal — ${studentName}`;
        const content = `${studentName} filed an absence appeal for ${courseLabel}. Open Student Affairs queue to review.`;
        const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/system`;
        const fetchFn = global.fetch || require('node-fetch');
        await Promise.all(
          recipientIds.map((rid) =>
            fetchFn(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: req.headers.authorization || '',
                Cookie: req.headers.cookie || '',
              },
              body: JSON.stringify({
                userId: rid,
                title,
                content,
                type: 'info',
                referenceType: 'AttendanceExcuse',
                referenceId: excuse.id,
              }),
            }).catch(() => { /* best-effort */ })
          )
        );
      } catch (e) {
        console.warn('[attendance] appeal notification fan-out failed:', e.message);
      }
    });

    res.json({ success: true, excuse, excuses: [excuse] });
  })
);

// ── GET /api/attendance/excuses/:userId ───────────────────────────────────
// Fetch all excuses for a student. Own record or staff.
router.get('/attendance/excuses/:userId', requireAuth, asyncHandler(async (req, res) => {
  if (req.params.userId !== req.user.userId && !['admin', 'sa', 'professor', 'ta'].includes(req.user.role)) {
    throw new AppError('Forbidden', 403);
  }
  const excuses = await prisma.attendanceExcuse.findMany({
    where: { userId: req.params.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ excuses });
}));

// MVP build: the SA review queue (GET /api/sa/attendance-excuses) and the
// SA approve/reject decision handler (PATCH /api/sa/attendance-excuses/:id)
// have been removed — the MVP build keeps a real backend only for student &
// professor. Students still submit excuses via POST /api/attendance/excuse and
// view their own via GET /api/attendance/excuses/:userId above.

module.exports = router;
