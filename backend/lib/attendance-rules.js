/**
 * Attendance regulations — single source of truth for the percentage
 * thresholds that drive the warning / barred logic.
 *
 * Stored at SystemSettings.attendanceRules (JSON). When null, DEFAULT_RULES
 * is used. The admin Settings UI edits the JSON; consumers (student
 * attendance page, professor barring logic, and any future automated
 * "FW" grade issuance) read it through `getAttendanceRules(prisma)`.
 *
 * The defaults match the FCDS regulations corpus (Article 16):
 *   • Required attendance ≥ 75% of practical sessions
 *   • Warnings issued at 15% and 20% absence
 *   • At 25% absence the student is barred and earns "FW" (Fail due to absence)
 *
 * Any tenant deploying UniFlow can override via the admin UI without code
 * changes. The percentages are absence percentages (15% absent, 20% absent…)
 * to match the regulations directly.
 */

const { z } = require('zod');

const DEFAULT_RULES = Object.freeze({
  // Minimum REQUIRED attendance (i.e. floor of `attendedPct`). 75% means
  // "must attend at least 75% of sessions", and the implied absence
  // threshold for being barred is 100 - 75 = 25%.
  minAttendancePercent: 75,
  // Absence percentages at which warnings fire. Sorted ascending.
  warnAbsencePercents: [15, 20],
  // Absence percentage at which the student is barred from the course
  // and an FW (Fail due to absence) grade is issued. By default this is
  // 100 - minAttendancePercent.
  failAbsencePercent: 25,
  // Letter grade assigned when barred. Editable so tenants using a
  // different scale (e.g. "FA", "WF") can override.
  barredGradeLetter: 'FW',
  // Whether the rules apply to all sessions or only practical sessions.
  // FCDS regs distinguish; many tenants don't.
  practicalOnly: false,
});

const attendanceRulesSchema = z.object({
  minAttendancePercent: z.number().min(0).max(100),
  warnAbsencePercents: z.array(z.number().min(0).max(100)).min(0).max(5),
  failAbsencePercent: z.number().min(0).max(100),
  barredGradeLetter: z.string().min(1).max(4),
  practicalOnly: z.boolean(),
});

async function getAttendanceRules(prisma) {
  try {
    const s = await prisma.systemSettings.findFirst({ select: { attendanceRules: true } });
    if (s?.attendanceRules && typeof s.attendanceRules === 'object') {
      return mergeWithDefaults(s.attendanceRules);
    }
  } catch { /* fall through */ }
  return DEFAULT_RULES;
}

function mergeWithDefaults(stored) {
  return {
    minAttendancePercent: typeof stored.minAttendancePercent === 'number'
      ? stored.minAttendancePercent
      : DEFAULT_RULES.minAttendancePercent,
    warnAbsencePercents: Array.isArray(stored.warnAbsencePercents)
      ? [...stored.warnAbsencePercents].sort((a, b) => a - b)
      : DEFAULT_RULES.warnAbsencePercents,
    failAbsencePercent: typeof stored.failAbsencePercent === 'number'
      ? stored.failAbsencePercent
      : DEFAULT_RULES.failAbsencePercent,
    barredGradeLetter: typeof stored.barredGradeLetter === 'string'
      ? stored.barredGradeLetter
      : DEFAULT_RULES.barredGradeLetter,
    practicalOnly: typeof stored.practicalOnly === 'boolean'
      ? stored.practicalOnly
      : DEFAULT_RULES.practicalOnly,
  };
}

/**
 * Classify a student's standing relative to the active rules. Returns one of:
 *   'good' | 'warned' | 'final_warning' | 'barred'
 *
 * Used by the student attendance page to colour the per-course tile and by
 * any cron job that wants to issue automated warnings.
 */
function classifyAttendance(absencePercent, rules = DEFAULT_RULES) {
  const warns = [...rules.warnAbsencePercents].sort((a, b) => a - b);
  if (absencePercent >= rules.failAbsencePercent) return 'barred';
  if (warns.length >= 2 && absencePercent >= warns[warns.length - 1]) return 'final_warning';
  if (warns.length >= 1 && absencePercent >= warns[0]) return 'warned';
  return 'good';
}

/**
 * Plan 6 Phase 2 — read the institution's holiday list from SystemSettings.holidays.
 * Shape: [{ date: 'YYYY-MM-DD', label: string }]. Returns [] on any error so
 * callers never have to handle a null.
 */
async function getHolidays(prisma) {
  try {
    const s = await prisma.systemSettings.findFirst({ select: { holidays: true } });
    if (Array.isArray(s?.holidays)) {
      return s.holidays.filter((h) => h && typeof h.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.date));
    }
  } catch { /* fall through */ }
  return [];
}

/**
 * Plan 6 Phase 2 — derive the working-day count for an attendance denominator,
 * skipping any meeting date that falls on a configured holiday.
 *
 * `meetings` is any array of objects carrying a `date` field (Date or ISO
 * string). The return value is the count of meetings whose date is NOT in
 * the holiday set. Existing meeting records are NOT deleted — only the
 * denominator drops when computing percent.
 */
function effectiveMeetingCount(meetings, holidays) {
  if (!Array.isArray(meetings)) return 0;
  if (!Array.isArray(holidays) || holidays.length === 0) return meetings.length;
  const holidayDates = new Set(holidays.map((h) => h.date));
  return meetings.filter((m) => {
    const raw = m && m.date != null ? m.date : null;
    if (!raw) return true;
    const iso = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
    return !holidayDates.has(iso);
  }).length;
}

/**
 * Plan 6 Phase 2 — quickly check if a single ISO date is a configured holiday.
 * Convenience for the AttendanceHeatmap "Daily" tile renderer.
 */
function isHoliday(isoDate, holidays) {
  if (!isoDate || !Array.isArray(holidays)) return false;
  return holidays.some((h) => h.date === isoDate);
}

module.exports = {
  DEFAULT_RULES,
  attendanceRulesSchema,
  getAttendanceRules,
  classifyAttendance,
  getHolidays,
  effectiveMeetingCount,
  isHoliday,
};
