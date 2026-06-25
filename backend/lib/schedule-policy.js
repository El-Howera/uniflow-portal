// Schedule Policy — admin-configurable working days + slot grid for the
// timetable scheduler.
//
// Stored as a JSON blob on system_settings.schedule_policy (added by the
// Phase E migration). Same pattern as level-progression / credit-limits /
// graduation-policy: defaults if column is null, raw-SQL read until the
// Prisma client is regenerated.

const { z } = require('zod');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// FCDS / Egyptian academic week: Sunday-Thursday working, Friday-Saturday weekend.
// 60-minute slots from 08:00 to 20:00 — 12 slots/day, 60 slots/week.
const DEFAULT_POLICY = Object.freeze({
  workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
  slotMinutes: 60,
  dayStart: '08:00',
  dayEnd: '20:00',
});

// Per-(department, level) overrides for the slot length. Most-specific wins:
// (deptId, level) > (deptId, null) > (null, level) > policy.slotMinutes.
const slotOverrideSchema = z.object({
  departmentId: z.string().nullable().optional(),
  level: z.number().int().min(1).max(10).nullable().optional(),
  slotMinutes: z.number().int().min(30).max(240),
});

const schedulePolicySchema = z
  .object({
    workingDays: z
      .array(z.enum(DAYS))
      .min(1, 'at least one working day is required')
      .max(7),
    slotMinutes: z.number().int().min(30).max(240),
    dayStart: z.string().regex(HHMM, 'dayStart must be HH:MM'),
    dayEnd: z.string().regex(HHMM, 'dayEnd must be HH:MM'),
    overrides: z.array(slotOverrideSchema).optional().default([]),
  })
  .superRefine((p, ctx) => {
    if (toMinutes(p.dayStart) >= toMinutes(p.dayEnd)) {
      ctx.addIssue({ code: 'custom', path: ['dayEnd'], message: 'dayEnd must be strictly after dayStart' });
    }
    const span = toMinutes(p.dayEnd) - toMinutes(p.dayStart);
    if (span % p.slotMinutes !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['slotMinutes'],
        message: `Day span (${span}m) is not divisible by slot length (${p.slotMinutes}m). Adjust dayEnd or slotMinutes.`,
      });
    }
    // Dedupe sanity — Zod doesn't catch ['Sunday','Sunday'].
    const set = new Set(p.workingDays);
    if (set.size !== p.workingDays.length) {
      ctx.addIssue({ code: 'custom', path: ['workingDays'], message: 'workingDays must not contain duplicates' });
    }
  });

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

let cached = null;
let cachedAt = 0;
const TTL_MS = 5_000;

async function getSchedulePolicy(prisma) {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT schedule_policy AS "schedulePolicy" FROM system_settings LIMIT 1`,
    );
    const raw = rows?.[0]?.schedulePolicy;
    cached = mergePolicy(raw);
  } catch {
    cached = { ...DEFAULT_POLICY };
  }
  cachedAt = Date.now();
  return cached;
}

function invalidatePolicyCache() {
  cached = null;
  cachedAt = 0;
}

function mergePolicy(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_POLICY, overrides: [] };
  const merged = { ...DEFAULT_POLICY, overrides: [], ...raw };
  // Sanity-fall-back per field — bad data shouldn't crash the scheduler.
  if (!Array.isArray(merged.workingDays) || merged.workingDays.length === 0) merged.workingDays = DEFAULT_POLICY.workingDays;
  merged.workingDays = merged.workingDays.filter((d) => DAYS.includes(d));
  if (!Number.isInteger(merged.slotMinutes) || merged.slotMinutes < 30 || merged.slotMinutes > 240) merged.slotMinutes = DEFAULT_POLICY.slotMinutes;
  if (!HHMM.test(merged.dayStart || '')) merged.dayStart = DEFAULT_POLICY.dayStart;
  if (!HHMM.test(merged.dayEnd || '')) merged.dayEnd = DEFAULT_POLICY.dayEnd;
  if (!Array.isArray(merged.overrides)) merged.overrides = [];
  // Drop malformed override entries silently.
  merged.overrides = merged.overrides.filter((o) =>
    o && typeof o === 'object' &&
    Number.isInteger(o.slotMinutes) && o.slotMinutes >= 30 && o.slotMinutes <= 240
  ).map((o) => ({
    departmentId: o.departmentId ?? null,
    level: Number.isInteger(o.level) ? o.level : null,
    slotMinutes: o.slotMinutes,
  }));
  return merged;
}

/**
 * Pick the slot length for a (department, level) pair. Most-specific match
 * wins. Returns the policy's top-level slotMinutes when nothing matches.
 */
function effectiveSlotMinutes(policy, { departmentId = null, level = null } = {}) {
  const overrides = policy.overrides || [];
  const exact = overrides.find((o) => o.departmentId === departmentId && o.level === level);
  if (exact) return exact.slotMinutes;
  if (departmentId) {
    const deptOnly = overrides.find((o) => o.departmentId === departmentId && o.level === null);
    if (deptOnly) return deptOnly.slotMinutes;
  }
  if (level !== null) {
    const levelOnly = overrides.find((o) => o.departmentId === null && o.level === level);
    if (levelOnly) return levelOnly.slotMinutes;
  }
  return policy.slotMinutes;
}

/**
 * Read the override slot length for the given scope, returning null when no
 * exact override exists. Distinguishes "no override" from "override matches
 * the policy default" so the UI can show an appropriate state.
 */
function findExactOverride(policy, { departmentId = null, level = null } = {}) {
  const overrides = policy.overrides || [];
  return overrides.find((o) => o.departmentId === departmentId && o.level === level) || null;
}

/**
 * Build the slot grid for a policy: every (day, startTime, endTime) the
 * scheduler may assign. Returns N × M slots where N = working days,
 * M = (dayEnd - dayStart) / slotMinutes.
 */
function buildSlotGrid(policy) {
  const slots = [];
  const startMin = toMinutes(policy.dayStart);
  const endMin = toMinutes(policy.dayEnd);
  for (const day of policy.workingDays) {
    for (let t = startMin; t + policy.slotMinutes <= endMin; t += policy.slotMinutes) {
      slots.push({
        day,
        startTime: fromMinutes(t),
        endTime: fromMinutes(t + policy.slotMinutes),
      });
    }
  }
  return slots;
}

module.exports = {
  DAYS,
  DEFAULT_POLICY,
  schedulePolicySchema,
  slotOverrideSchema,
  getSchedulePolicy,
  invalidatePolicyCache,
  buildSlotGrid,
  toMinutes,
  fromMinutes,
  effectiveSlotMinutes,
  findExactOverride,
};
