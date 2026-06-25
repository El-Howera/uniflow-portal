/**
 * Mobility / exchange policy (FCDS Articles 24, 25 — Plan 4 Phase 7).
 *
 * Drives two related but distinct rules:
 *   1. External credit transfer cap (Article 25a) — when an FCDS student
 *      brings credits from another faculty / university, they can count up
 *      to `maxExternalPercentOfTotal` of the graduation credit total. With
 *      the FCDS default (140 cr × 25%) that's 35 credits.
 *   2. Visiting student per-term limit (Article 25b) — non-FCDS students
 *      visiting from outside can register for up to `visitingMaxPerMain` cr
 *      in a main semester or `visitingMaxPerSummer` in a summer semester.
 *      (The Article 24 audit-system shares the visiting flow but doesn't
 *      need a credit cap — auditors don't earn credits.)
 *
 * Stored on SystemSettings.mobilityPolicy (JSON). When null, defaults apply.
 */

const { z } = require('zod');

const DEFAULT_POLICY = Object.freeze({
  // Hard cap on accepted external credits as a fraction of the graduation
  // total. FCDS Article 25a: 25%. Set to 0 to disable transfers entirely.
  maxExternalPercentOfTotal: 0.25,
  // Whether approved external credits feed into the cumulative GPA. FCDS
  // Article 25a says yes; some tenants prefer "transfer credit, not GPA".
  includeInCgpa:             true,
  // Per-term cap on registered credits for visiting students (Article 25b).
  visitingMaxPerMain:        12,
  visitingMaxPerSummer:      9,
});

const mobilityPolicySchema = z.object({
  maxExternalPercentOfTotal: z.number().min(0).max(1),
  includeInCgpa:             z.boolean(),
  visitingMaxPerMain:        z.number().int().min(0).max(60),
  visitingMaxPerSummer:      z.number().int().min(0).max(60),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
  }
  return out;
}

async function getMobilityPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT mobility_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

/**
 * Evaluate whether ONE more external-credit transfer can be approved without
 * busting the policy cap.
 *
 * @param {object} input
 * @param {number} input.graduationTotal      total credits required (FCDS = 140)
 * @param {number} input.alreadyApprovedCredits sum of credit_hours across approved transfers
 * @param {number} input.requestedCredits     credit_hours of the row about to be approved
 * @param {object} [policy=DEFAULT_POLICY]
 * @returns {{ ok: boolean, reason?: string, current: number, limit: number, projected: number }}
 */
function evaluateExternalCap(
  { graduationTotal = 140, alreadyApprovedCredits = 0, requestedCredits = 0 } = {},
  policy = DEFAULT_POLICY,
) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  const limit = Math.floor(graduationTotal * cfg.maxExternalPercentOfTotal);
  const projected = (Number(alreadyApprovedCredits) || 0) + (Number(requestedCredits) || 0);
  if (projected > limit) {
    return {
      ok: false,
      reason: 'cap_exceeded',
      current: alreadyApprovedCredits,
      limit,
      projected,
    };
  }
  return { ok: true, current: alreadyApprovedCredits, limit, projected };
}

module.exports = {
  DEFAULT_POLICY,
  mobilityPolicySchema,
  getMobilityPolicy,
  evaluateExternalCap,
};
