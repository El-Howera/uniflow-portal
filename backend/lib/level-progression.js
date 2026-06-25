/**
 * Level progression policy.
 *
 * Drives a student's academic level from earned credit hours. Configured by
 * admins on the Academic Settings → Level Progression page; consumed by the
 * course-eligibility gate (so a student with 30 completed credits is treated
 * as Level 2 even if AcademicProfile.level hasn't been recomputed yet).
 *
 * Stored on SystemSettings.levelProgression (JSON). When the column is null
 * (fresh DB or first-run), DEFAULT_POLICY applies — FCDS-style thresholds.
 *
 * Shape on the wire:
 *   {
 *     thresholds: [
 *       { level: 2, minCredits: 28 },
 *       { level: 3, minCredits: 64 },
 *       { level: 4, minCredits: 96 }
 *     ]
 *   }
 *
 * Level 1 is implicit at 0 credits — no row needed. The first threshold is
 * Level 2 because that's the first promotion the student can earn.
 */

const { z } = require('zod');

// ── Default (FCDS, Alexandria University) ────────────────────────────────────

const DEFAULT_POLICY = Object.freeze({
  thresholds: [
    { level: 2, minCredits: 28 },
    { level: 3, minCredits: 64 },
    { level: 4, minCredits: 96 },
  ],
});

// ── Zod schema for PATCH validation ──────────────────────────────────────────

const thresholdSchema = z.object({
  level:      z.number().int().min(2).max(10),
  minCredits: z.number().int().min(1).max(500),
});

const levelProgressionSchema = z.object({
  thresholds: z.array(thresholdSchema).min(0).max(9),
}).superRefine((data, ctx) => {
  // Levels must be unique and strictly increasing — sort by level and verify.
  const sorted = [...data.thresholds].sort((a, b) => a.level - b.level);
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].level <= sorted[i - 1].level) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds'],
        message: `Level ${sorted[i].level} appears more than once or is out of order.`,
      });
      return;
    }
    if (sorted[i].level < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds'],
        message: 'Level 1 is implicit at 0 credits — first configurable level is 2.',
      });
      return;
    }
  }
  // minCredits must be strictly increasing as level increases.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minCredits <= sorted[i - 1].minCredits) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['thresholds'],
        message: `Level ${sorted[i].level} must require more credits than level ${sorted[i - 1].level}.`,
      });
      return;
    }
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the active level-progression policy from SystemSettings; falls back to
 * DEFAULT_POLICY if the column is null or the DB is unreachable.
 *
 * Uses $queryRaw so the call works even when the Prisma client artifact
 * hasn't been regenerated yet (Windows DLL lock during dev).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getLevelProgression(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT level_progression AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored && typeof stored === 'object' && Array.isArray(stored.thresholds)) {
      return mergeWithDefaults(stored);
    }
  } catch {
    // Column missing (older deploy) or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

function mergeWithDefaults(stored) {
  // Sanitise — drop malformed rows, sort by level, deduplicate.
  const thresholds = (stored.thresholds || [])
    .filter(
      (t) =>
        t &&
        Number.isInteger(t.level) &&
        Number.isInteger(t.minCredits) &&
        t.level >= 2 &&
        t.minCredits >= 0,
    )
    .sort((a, b) => a.level - b.level);
  // If sanitisation killed everything, fall back to defaults rather than
  // returning an empty policy that would lock everyone at Level 1.
  if (thresholds.length === 0) return DEFAULT_POLICY;
  return { thresholds };
}

/**
 * Compute a student's academic level from their earned credit hours and the
 * active level-progression policy.
 *
 * Returns the highest level whose minCredits is ≤ the student's credits.
 * Level 1 is the floor (returned when no threshold matches or credits is 0/null).
 *
 * @param {number|null|undefined} credits     student's earned credit hours
 * @param {object} [policy]                   full policy, defaults to DEFAULT_POLICY
 * @returns {number}                          academic level, ≥ 1
 */
function computeLevel(credits, policy = DEFAULT_POLICY) {
  const c = Number(credits) || 0;
  const thresholds = (policy?.thresholds || []).slice().sort((a, b) => a.level - b.level);
  let level = 1;
  for (const t of thresholds) {
    if (c >= t.minCredits) {
      level = t.level;
    } else {
      break;
    }
  }
  return level;
}

module.exports = {
  DEFAULT_POLICY,
  levelProgressionSchema,
  getLevelProgression,
  computeLevel,
};
