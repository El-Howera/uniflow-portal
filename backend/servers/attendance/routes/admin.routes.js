/**
 * Professor / TA course-attendance analytics routes for the attendance service.
 *
 * Owns (MVP build — professor/TA charts only):
 *   GET /api/attendance/course/:courseCode/weekly          — weekly % chart (prof/ta/admin)
 *   GET /api/attendance/course/:courseCode/sessions-stats  — per-session bars (prof/ta/admin)
 *
 * MVP build notes:
 *   - The admin-only institution-wide heatmap (GET /api/attendance/admin/stats)
 *     and the staff CSV export (GET /api/attendance/export.csv) have been
 *     removed — the MVP build keeps a real backend only for student &
 *     professor.
 *   - Holiday-aware logic (Plan 6 Phase 2): records whose `date` matches a
 *     configured holiday are excluded from the weekly chart denominator.
 *     Excused records count toward the attendance numerator.
 */

const express = require('express');

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { getHolidays } = require('../../../lib/attendance-rules');

const NODE_ENV = process.env.NODE_ENV || 'development';

const router = express.Router();

// MVP build: GET /api/attendance/admin/stats (admin-only institution-wide
// heatmap) and GET /api/attendance/export.csv (staff CSV export) have been
// removed. The professor/TA course charts below remain.

// ── GET /api/attendance/course/:courseCode/weekly ─────────────────────────
// Weekly attendance % for a course. Holiday-aware (Plan 6 Phase 2).
router.get('/course/:courseCode/weekly', requireAuth, async (req, res) => {
  if (!['professor', 'ta', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { courseCode } = req.params;
  try {
    const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000);
    const [records, holidays] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          courseCode: courseCode.toUpperCase(),
          createdAt: { gte: eightWeeksAgo },
        },
        select: { createdAt: true, date: true, status: true, userId: true },
      }),
      getHolidays(prisma),
    ]);

    const holidaySet = new Set((holidays || []).map((h) => h.date));

    const weekMap = {};
    records.forEach((r) => {
      const recordDateIso = (r.date instanceof Date ? r.date : new Date(r.date || r.createdAt))
        .toISOString().slice(0, 10);
      if (holidaySet.has(recordDateIso)) return;
      const d = new Date(r.createdAt);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(d);
      weekStart.setDate(diff);
      weekStart.setHours(0, 0, 0, 0);
      const key = weekStart.toISOString().split('T')[0];
      if (!weekMap[key]) weekMap[key] = { present: 0, total: 0 };
      weekMap[key].total++;
      // Excused counts as attended.
      if (['present', 'late', 'excused'].includes(r.status)) weekMap[key].present++;
    });

    const result = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([, data], i) => ({
        week: `Week ${i + 1}`,
        percentage: data.total > 0 ? Math.round((data.present / data.total) * 100) : 0,
      }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch weekly data' });
  }
});

// ── GET /api/attendance/course/:courseCode/sessions-stats ─────────────────
// Per-session bar chart data (present/late/absent/excused + %).
router.get('/course/:courseCode/sessions-stats', requireAuth, async (req, res) => {
  if (!['professor', 'ta', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { courseCode } = req.params;
  const take = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  try {
    const sessions = await prisma.attendanceSession.findMany({
      where: { courseCode: courseCode.toUpperCase() },
      orderBy: { date: 'asc' },
      take,
      select: {
        id: true,
        date: true,
        startedAt: true,
        records: { select: { status: true } },
      },
    });
    const stats = sessions.map((s, i) => {
      const records = s.records || [];
      const present = records.filter((r) => r.status === 'present').length;
      const late    = records.filter((r) => r.status === 'late').length;
      const absent  = records.filter((r) => r.status === 'absent').length;
      const excused = records.filter((r) => r.status === 'excused').length;
      const denom = present + late + absent + excused;
      // Excused counts as attended (SA-approved absence excuse).
      const percentage = denom > 0 ? Math.round(((present + late + excused) / denom) * 100) : 0;
      const dateIso = (s.startedAt || s.date || new Date()).toISOString();
      return {
        sessionId: s.id,
        index: i + 1,
        date: dateIso,
        present,
        late,
        absent,
        excused,
        total: denom,
        percentage,
      };
    });
    res.json({ sessions: stats });
  } catch (e) {
    if (NODE_ENV === 'development') console.error('[attendance] sessions-stats error', e);
    res.status(500).json({ error: 'Failed to fetch per-session stats' });
  }
});

module.exports = router;
