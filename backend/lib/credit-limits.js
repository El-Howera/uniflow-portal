/**
 * Credit-hour limit policy.
 *
 * Source-of-truth document: docs/credit-limit-policy.md
 *
 * Returns the maximum credits a student may register for in a given term,
 * based on GPA, academic standing, and whether the term is summer.
 *
 * The policy is stored on `SystemSettings.creditLimitPolicy` (JSON) so the
 * admin UI can edit every cap and threshold without a code change. When the
 * column is null (fresh DB or first-run), DEFAULT_POLICY applies — the values
 * mirror the FCDS, Alexandria University regulations.
 */

const { z } = require('zod');

// ── Defaults (FCDS, Alexandria University) ──────────────────────────────────

const DEFAULT_POLICY = Object.freeze({
  // Universal summer cap — overrides everything else
  summer: 9,

  // Senior / final-2-semesters bonus (good-standing seniors get this even at gpa 2.00)
  seniorBonus: 21,

  // First-year second chance: Freshman with goodStandingThreshold > gpa >= freshmanSecondChanceMinGpa
  freshmanSecondChance: 19,
  freshmanSecondChanceMinGpa: 1.66,

  // Standard caps by GPA bucket (regular fall/spring term)
  highGpa: 21,        // gpa > highGpaThreshold
  normal: 19,         // goodStandingThreshold <= gpa <= highGpaThreshold
  probation: 12,      // gpa < goodStandingThreshold

  // GPA breakpoints
  highGpaThreshold: 3.33,
  goodStandingThreshold: 2.0,
});

// ── Zod schema for PATCH validation ──────────────────────────────────────────

const creditLimitPolicySchema = z.object({
  summer:                     z.number().int().min(1).max(60),
  seniorBonus:                z.number().int().min(1).max(60),
  freshmanSecondChance:       z.number().int().min(1).max(60),
  freshmanSecondChanceMinGpa: z.number().min(0).max(5),
  highGpa:                    z.number().int().min(1).max(60),
  normal:                     z.number().int().min(1).max(60),
  probation:                  z.number().int().min(1).max(60),
  highGpaThreshold:           z.number().min(0).max(5),
  goodStandingThreshold:      z.number().min(0).max(5),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the active credit-limit policy from SystemSettings; falls back to
 * DEFAULT_POLICY if the column is null or the DB is unreachable. Defensive
 * merge handles partial JSON (older row missing a field after a future
 * extension).
 *
 * Uses $queryRaw so the call works even when the Prisma client artifact
 * hasn't been regenerated yet (Windows DLL lock during dev).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getCreditLimitPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT credit_limit_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored && typeof stored === 'object') return mergeWithDefaults(stored);
  } catch {
    // Column missing (older deploy) or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (typeof stored[k] === 'number' && Number.isFinite(stored[k])) {
      out[k] = stored[k];
    }
  }
  return out;
}

/**
 * Detect whether the named term is a summer term (case-insensitive substring match).
 * @param {string|null|undefined} currentSemester e.g. "Fall 2025", "Summer 2026"
 */
function isSummerTerm(currentSemester) {
  if (!currentSemester || typeof currentSemester !== 'string') return false;
  return /summer/i.test(currentSemester);
}

/**
 * Decide max credit hours for a student/term.
 *
 * Rules are evaluated top-to-bottom; the first match wins. See
 * docs/credit-limit-policy.md for the canonical description.
 *
 * @param {object} input
 * @param {number|string} [input.gpa]              0.00–4.00. null/undefined → 0.
 * @param {string} [input.standing]                'Freshman' | 'Sophomore' | 'Junior' | 'Senior' | 'Graduate' | 'Alumni'
 * @param {string} [input.currentSemester]         e.g. "Fall 2025", "Summer 2026"
 * @param {object} [policy]                        full policy object, defaults to DEFAULT_POLICY
 * @returns {{ maxCredits: number, reason: string, rule: string }}
 */
function getCreditLimit(
  { gpa = 0, standing = 'Freshman', currentSemester = '' } = {},
  policy = DEFAULT_POLICY,
) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  const g = Number(gpa) || 0;

  // Rule 1 — Summer term (universal)
  if (isSummerTerm(currentSemester)) {
    return {
      maxCredits: cfg.summer,
      reason: 'summer term',
      rule: 'summer',
    };
  }

  // Rule 2 — Senior / final-2-semesters bonus (good-standing seniors only)
  if (standing === 'Senior' && g >= cfg.goodStandingThreshold) {
    return {
      maxCredits: cfg.seniorBonus,
      reason: `senior — final 2 semesters (gpa ≥ ${cfg.goodStandingThreshold})`,
      rule: 'senior_bonus',
    };
  }

  // Rule 3 — First-year second chance
  if (
    standing === 'Freshman' &&
    g < cfg.goodStandingThreshold &&
    g >= cfg.freshmanSecondChanceMinGpa
  ) {
    return {
      maxCredits: cfg.freshmanSecondChance,
      reason: `first-year second chance (gpa ${cfg.freshmanSecondChanceMinGpa}–${cfg.goodStandingThreshold})`,
      rule: 'freshman_second_chance',
    };
  }

  // Rule 4 — High GPA
  if (g > cfg.highGpaThreshold) {
    return {
      maxCredits: cfg.highGpa,
      reason: `high gpa (> ${cfg.highGpaThreshold})`,
      rule: 'high_gpa',
    };
  }

  // Rule 5 — Good standing
  if (g >= cfg.goodStandingThreshold) {
    return {
      maxCredits: cfg.normal,
      reason: `good standing (gpa ${cfg.goodStandingThreshold}–${cfg.highGpaThreshold})`,
      rule: 'good_standing',
    };
  }

  // Rule 6 — Academic probation (fallback)
  return {
    maxCredits: cfg.probation,
    reason: `academic probation (gpa < ${cfg.goodStandingThreshold})`,
    rule: 'probation',
  };
}

module.exports = {
  DEFAULT_POLICY,
  creditLimitPolicySchema,
  getCreditLimit,
  getCreditLimitPolicy,
  isSummerTerm,
};
