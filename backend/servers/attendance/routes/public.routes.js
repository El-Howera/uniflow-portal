/**
 * Public (no requireAuth) student-lookup routes for the attendance service.
 *
 * These endpoints accept a userId path param, resolve the user via
 * resolveUser(), and return attendance data. They have no JWT requirement
 * (preserved from the original monolith — they are called from internal
 * service-to-service paths that don't carry a bearer token).
 *
 *   GET /api/attendance/today/:userId    — today's class schedule
 *   GET /api/attendance/history/:userId  — full attendance history
 *   GET /api/attendance/summary/:userId  — per-course summary + totalExpected
 *   GET /api/attendance/flags/:userId    — cheating flags
 *
 * Non-obvious decisions:
 *   - /summary/:userId implements the holiday-aware, semester-duration-based
 *     totalExpected denominator (Plan 6 Phase 2). Excused counts as attended.
 *   - These four endpoints were extracted to public.routes.js from
 *     records.routes.js solely to keep records.routes.js under the 600-line
 *     hard ceiling. Behaviour is identical to the original monolith.
 */

const express = require('express');

const prisma = require('../../../lib/prisma');
const { resolveUser } = require('../../../lib/users');
const { getHolidays } = require('../../../lib/attendance-rules');
const { getSemesterDurations } = require('../../../lib/graduation-policy');
const { extractTermName } = require('../../../lib/course-eligibility');
const { getFinalizedCourseIds } = require('../../../lib/finalized-courses');

const NODE_ENV = process.env.NODE_ENV || 'development';

const router = express.Router();

// ── GET /api/attendance/today/:userId ─────────────────────────────────────
// Today's class schedule for a given student (no auth).
router.get('/today/:userId', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userId = user.id;
    const now = new Date();
    const today = now.toLocaleDateString('en-US', { weekday: 'long' });

    const [registrations, finalizedCourseIds] = await Promise.all([
      prisma.registration.findMany({
        where: { userId, status: 'confirmed' },
        include: {
          course: true,
          section: {
            include: {
              slots: { where: { day: today } },
            },
          },
        },
      }),
      getFinalizedCourseIds(prisma, userId),
    ]);

    const classes = registrations
      .filter((reg) => reg.section && reg.section.slots.length > 0)
      .filter((reg) => !finalizedCourseIds.has(reg.courseId))
      .map((reg) => {
        const slot = reg.section.slots[0];
        return {
          courseCode: reg.course.code,
          courseName: reg.course.title,
          instructor: '',
          day: today,
          startTime: slot.startTime
            ? new Date(slot.startTime).toISOString().split('T')[1].substring(0, 5)
            : '',
          endTime: slot.endTime
            ? new Date(slot.endTime).toISOString().split('T')[1].substring(0, 5)
            : '',
          room: reg.section.location || '',
          isCurrentlyActive: false,
          hasActiveSession: false,
          alreadyMarked: false,
          attendanceStatus: null,
        };
      });

    res.json({
      date: now.toISOString().split('T')[0],
      day: today,
      currentTime: now.toTimeString().substring(0, 5),
      classes,
    });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] today/:userId error', e);
    res.status(500).json({ error: "Failed to fetch today's schedule" });
  }
});

// ── GET /api/attendance/history/:userId ───────────────────────────────────
// Full attendance history for a student (no auth).
router.get('/history/:userId', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userId = user.id;
    const { courseCode, startDate, endDate, limit } = req.query;
    const take = Math.min(parseInt(limit) || 50, 200);

    const where = { userId };
    if (courseCode) where.courseCode = courseCode;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [rawRecords, finalizedCourseIds] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where,
        include: {
          session: {
            include: {
              course: { select: { code: true, title: true } },
            },
          },
          course: { select: { code: true, title: true } },
        },
        orderBy: { markedAt: 'desc' },
        take,
      }),
      getFinalizedCourseIds(prisma, userId),
    ]);

    const records = rawRecords
      .filter((r) => !finalizedCourseIds.has(r.courseId))
      .map((r) => ({
        id: r.id,
        courseCode: r.courseCode || r.course?.code || r.session?.course?.code || '',
        courseName: r.courseName || r.course?.title || r.session?.course?.title || '',
        date: (r.date || r.markedAt || r.createdAt).toISOString(),
        status: r.status,
        sessionId: r.sessionId,
        markedAt: (r.markedAt || r.createdAt).toISOString(),
        verificationMethod: r.verificationMethod,
        bssidVerified: r.bssidVerified,
      }));

    const total = records.length;
    const present = records.filter((r) => r.status === 'present').length;
    const late = records.filter((r) => r.status === 'late').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    const excused = records.filter((r) => r.status === 'excused').length;

    res.json({
      records,
      stats: {
        total,
        present,
        late,
        absent,
        excused,
        attendanceRate: total > 0 ? Math.round(((present + late + excused) / total) * 100) : 0,
      },
    });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] history/:userId error', e);
    res.status(500).json({ error: 'Failed to fetch attendance history' });
  }
});

// ── GET /api/attendance/summary/:userId ───────────────────────────────────
// Per-course summary with totalExpected (holiday-aware, Plan 6 Phase 2).
// Returns a raw array (getAttendanceSummary in the frontend calls .json() directly).
router.get('/summary/:userId', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userId = user.id;

    const [records, holidays, regs, durations, settings, finalizedCourseIds] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { userId },
        include: {
          session: {
            include: {
              course: { select: { code: true, title: true } },
            },
          },
          course: { select: { code: true, title: true } },
        },
      }),
      getHolidays(prisma),
      prisma.registration.findMany({
        where: { userId, status: 'approved', isActive: true },
        select: {
          courseId: true,
          section: { select: { slots: { select: { id: true } } } },
        },
      }),
      getSemesterDurations(prisma),
      prisma.systemSettings.findFirst({ select: { currentSemester: true } }),
      getFinalizedCourseIds(prisma, userId),
    ]);

    const holidaySet = new Set((holidays || []).map((h) => h.date));

    const termName = extractTermName(settings?.currentSemester || null);
    const weeks =
      termName === 'Summer' ? (durations.summerWeeks || 8) :
      termName === 'Spring' ? (durations.springWeeks || 15) :
      termName === 'Fall'   ? (durations.fallWeeks   || 15) :
      Math.max(durations.fallWeeks || 15, durations.springWeeks || 15);

    const slotsByCourse = {};
    for (const r of regs) {
      const slotCount = (r.section && Array.isArray(r.section.slots)) ? r.section.slots.length : 0;
      slotsByCourse[r.courseId] = (slotsByCourse[r.courseId] || 0) + slotCount;
    }

    const grouped = {};
    for (const r of records) {
      const iso = (r.date instanceof Date ? r.date : new Date(r.date || r.createdAt || Date.now()))
        .toISOString().slice(0, 10);
      if (holidaySet.has(iso)) continue;
      if (finalizedCourseIds.has(r.courseId)) continue;
      const key = r.courseId;
      if (!grouped[key]) {
        grouped[key] = {
          courseCode: r.courseCode || r.course?.code || r.session?.course?.code || key,
          courseName: r.courseName || r.course?.title || r.session?.course?.title || '',
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          total: 0,
          totalExpected: (slotsByCourse[key] || 0) * weeks,
        };
      }
      grouped[key].total++;
      if (r.status === 'present') grouped[key].present++;
      else if (r.status === 'late') grouped[key].late++;
      else if (r.status === 'absent') grouped[key].absent++;
      else if (r.status === 'excused') grouped[key].excused++;
    }

    const summary = Object.values(grouped).map((g) => ({
      ...g,
      attendanceRate: g.total > 0 ? Math.round(((g.present + g.late + g.excused) / g.total) * 100) : 0,
    }));

    res.json(summary);
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] summary/:userId error', e);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
});

// ── GET /api/attendance/flags/:userId ─────────────────────────────────────
// Cheating flags for a user (no auth).
router.get('/flags/:userId', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const userId = user.id;

    const flags = await prisma.cheatingFlag.findMany({
      where: { userId },
      orderBy: { flaggedAt: 'desc' },
    });

    res.json({ flagCount: flags.length, flags });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] flags/:userId error', e);
    res.status(500).json({ error: 'Failed to fetch cheating flags' });
  }
});

module.exports = router;
