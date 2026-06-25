/**
 * registration/lib/period-helpers.js
 *
 * Helpers for RegistrationPeriod resolution and cascade operations.
 *
 * Exports:
 *   findActivePeriod(prisma, select?)     — returns the active period or date-window fallback
 *   resolvePeriodSemesterName(period)     — canonical semester string from a period row
 *   syncActivePeriodToSystem(period)      — cascades active period → CurrentTerm pointer
 *   notifyStudent(authHeader, opts)       — fire-and-forget student notification
 */

const axios = require('axios');
const prisma = require('../../../lib/prisma');

// ── Active period resolution ──────────────────────────────────────────────────

/**
 * findActivePeriod — prefers a row explicitly flagged `isActive: true`, but
 * falls back to any RegistrationPeriod whose [startDate, endDate] window
 * covers today. The fallback is forgiving by design: the schema defaults
 * `isActive` to `false`, so an admin can set the calendar dates correctly
 * yet still hit "Registration is not currently open" because the toggle
 * wasn't flipped. Walking the fallback path lets the dates alone be
 * sufficient. If both lookups miss, callers get null and surface a
 * targeted error message that points at the admin Registration Control.
 */
async function findActivePeriod(select) {
  const queryArg = select ? { select } : {};
  const explicit = await prisma.registrationPeriod.findFirst({
    where: { isActive: true },
    ...queryArg,
  });
  if (explicit) return explicit;
  const now = new Date();
  return prisma.registrationPeriod.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    orderBy: { startDate: 'desc' },
    ...queryArg,
  });
}

// ── Semester name resolution ──────────────────────────────────────────────────

/**
 * Resolve a RegistrationPeriod row to a canonical semester string the rest
 * of the system uses (Course.semester, SystemSettings.currentSemester):
 *   1. `period.semester` free-text (admin's direct intent).
 *   2. Derived from `period.name` ("Spring 2026 Registration" → "Spring 2026").
 *   3. `semesterRef.name` ("Spring 2026") when the period is linked to a Semester row.
 *   4. null if nothing matches — caller should leave the field untouched.
 */
async function resolvePeriodSemesterName(period) {
  if (!period) return null;
  if (period.semester) return period.semester;
  const stripped = (period.name || '').replace(/\s*(Registration|Add[\s-]?Drop|Late Registration|Withdrawal).*$/i, '').trim();
  if (stripped) return stripped;
  if (period.semesterId) {
    const sem = await prisma.semester.findFirst({
      where: { id: period.semesterId },
      select: { name: true },
    });
    if (sem?.name) return sem.name;
  }
  return null;
}

// ── System cascade ─────────────────────────────────────────────────────────────

/**
 * Cascade the "this period is now active" decision: update CurrentTerm.semesterId
 * so the current-term UI tiles + dashboard hooks see the new term.
 *
 * IMPORTANT: does NOT overwrite SystemSettings.currentSemester — the
 * "Semester Cycle" form on Registration Control is the canonical source for
 * that field.
 */
async function syncActivePeriodToSystem(period) {
  if (period.semesterId) {
    try {
      await prisma.currentTerm.deleteMany({});
      await prisma.currentTerm.create({
        data: { semesterId: period.semesterId, setAt: new Date() },
      });
    } catch (err) {
      console.warn('[registration-period] currentTerm sync skipped:', err.message);
    }
  }
}

// ── Student notification ──────────────────────────────────────────────────────

/**
 * Notify a student via notification-server (fire-and-forget).
 * Never throws — registration ops must not fail because of notification failure.
 */
async function notifyStudent(authHeader, { userId, title, content, type = 'info' }) {
  try {
    await axios.post(
      `http://localhost:${process.env.NOTIFICATION_PORT || 4009}/api/notifications/send`,
      { userId, title, content, type },
      { headers: { Authorization: authHeader }, timeout: 4000 }
    );
  } catch (err) {
    console.warn('[registration] notification fire failed:', err.message);
  }
}

module.exports = {
  findActivePeriod,
  resolvePeriodSemesterName,
  syncActivePeriodToSystem,
  notifyStudent,
};
