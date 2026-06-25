/**
 * Academic standing + Honors qualification (FCDS Articles 19, 22 — Plan 4 Phase 5).
 *
 * Two pure functions consumed by the transcript cascade:
 *   - evaluateStanding(semesters, standingPolicy) → 'good' | 'warning' | 'probation' | 'dismissed'
 *   - evaluateHonors(input, honorsPolicy)         → 'none' | 'honors' | 'high_honors' | 'disqualified'
 *
 * `standingPolicy` is the `gradingRules.academicStanding` JSON shape
 * (Phase 5 extended it with firstYearWarningGpa + dismissal counters +
 * probationMaxCredits). `honorsPolicy` is its own JSON column on
 * SystemSettings.honors_policy (added Phase 5).
 */

const { z } = require('zod');

// ── Honors policy: defaults + schema + loader ───────────────────────────────

const DEFAULT_HONORS_POLICY = Object.freeze({
  // Article 22b — graduation must finish within ≤ 9 main semesters.
  maxMainSemesters:      9,
  // Each main semester's earned GPA must clear this floor (FCDS = 3.333).
  perSemesterMinGpa:     3.333,
  // Final cumulative CGPA threshold for honors.
  cumulativeMinGpa:      3.666,
  // Threshold to upgrade from 'honors' to 'high_honors' — uses the existing
  // gradingRules.academicStanding.highHonorsGpaAbove default of 3.85 when
  // null/unset; a tenant can override here without editing grading rules.
  highHonorsCumMinGpa:   null,
  // Letter grades that disqualify a student from honors at any point in
  // their career. Article 22b: F, (F), FW, U.
  disqualifyingGrades:   ['F', '(F)', 'FW', 'U'],
  // Whether a single disciplinary penalty disqualifies — Article 22b says
  // yes; a stricter / lenient tenant can flip this to false.
  requireNoDisciplinary: true,
});

const honorsPolicySchema = z.object({
  maxMainSemesters:      z.number().int().min(1).max(20),
  perSemesterMinGpa:     z.number().min(0).max(5),
  cumulativeMinGpa:      z.number().min(0).max(5),
  highHonorsCumMinGpa:   z.union([z.number().min(0).max(5), z.null()]),
  disqualifyingGrades:   z.array(z.string().min(1).max(8)).max(20),
  requireNoDisciplinary: z.boolean(),
});

function mergeHonorsDefaults(stored) {
  const out = { ...DEFAULT_HONORS_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_HONORS_POLICY)) {
    if (stored[k] !== undefined) out[k] = stored[k];
  }
  if (!Array.isArray(out.disqualifyingGrades)) {
    out.disqualifyingGrades = DEFAULT_HONORS_POLICY.disqualifyingGrades;
  }
  return out;
}

async function getHonorsPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT honors_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeHonorsDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through to defaults.
  }
  return DEFAULT_HONORS_POLICY;
}

// ── Academic standing evaluator (FCDS Article 19) ───────────────────────────

const DEFAULT_STANDING = Object.freeze({
  probationGpaBelow:                2.0,
  dismissalGpaBelow:                1.5,
  firstYearWarningGpa:              1.666,
  dismissalConsecutiveSemesters:    3,
  dismissalNonConsecutiveSemesters: 4,
  probationMaxCredits:              12,
});

/**
 * Evaluate a student's current academic standing.
 *
 * Caller passes a chronologically-sorted array of per-semester records:
 *   [{ semesterIdx: 0, cumulativeGpa: 1.8, isMain: true }, …]
 *
 * Returns one of:
 *   - 'good'       — current cumulative ≥ probationGpaBelow (and 2nd-sem-special-case clear).
 *   - 'warning'    — first time the student is below the probation threshold.
 *   - 'probation'  — current cumulative < probationGpaBelow AND has happened more than once
 *                    (or 2nd semester < firstYearWarningGpa).
 *   - 'dismissed'  — counter triggered (3 consecutive OR 4 non-consecutive sub-2.0
 *                    cumulative semesters), OR cumulative < dismissalGpaBelow at any time.
 *
 * @param {Array<{semesterIdx:number,cumulativeGpa:number,isMain?:boolean}>} semesters
 * @param {object} [policy=DEFAULT_STANDING]
 */
function evaluateStanding(semesters, policy = DEFAULT_STANDING) {
  if (!Array.isArray(semesters) || semesters.length === 0) return 'good';
  const cfg = { ...DEFAULT_STANDING, ...(policy || {}) };

  // Walk chronologically; track consecutive + total sub-2.0 semesters.
  let consecutiveBelow = 0;
  let maxConsecutive = 0;
  let totalBelow = 0;
  let everImmediateDismiss = false;
  for (const s of semesters) {
    const cum = Number(s.cumulativeGpa) || 0;
    if (cum < cfg.dismissalGpaBelow) {
      everImmediateDismiss = true;
    }
    if (cum < cfg.probationGpaBelow) {
      consecutiveBelow++;
      totalBelow++;
      if (consecutiveBelow > maxConsecutive) maxConsecutive = consecutiveBelow;
    } else {
      consecutiveBelow = 0;
    }
  }

  if (everImmediateDismiss) return 'dismissed';
  if (maxConsecutive >= cfg.dismissalConsecutiveSemesters) return 'dismissed';
  if (totalBelow      >= cfg.dismissalNonConsecutiveSemesters) return 'dismissed';

  // Current state — look at the latest semester's cumulative.
  const last = semesters[semesters.length - 1];
  const cumNow = Number(last.cumulativeGpa) || 0;
  if (cumNow >= cfg.probationGpaBelow) {
    // Currently fine. If they were ever below and recovered, still 'good'.
    return 'good';
  }

  // Below threshold. Distinguish 'warning' (first dip) vs 'probation' (sustained).
  if (totalBelow === 1) {
    // First-ever sub-threshold semester:
    //   - At end of 2nd main semester (idx=1) AND below firstYearWarningGpa
    //     → straight to 'probation' per Article 19a's stricter floor.
    //   - Otherwise (first dip, idx>=2) → 'warning'.
    if (last.semesterIdx === 1 && cumNow < cfg.firstYearWarningGpa) return 'probation';
    return 'warning';
  }
  return 'probation';
}

// ── Honors qualification (FCDS Article 22) ──────────────────────────────────

/**
 * Decide a student's honors eligibility against the policy.
 *
 * `input`:
 *   semesters          [{ semesterIdx, perSemesterGpa, cumulativeGpa, isMain }]
 *   allLetters         array of every transcript letter the student has earned
 *   hasDisciplinary    boolean (caller passes from disciplinary_flag if it exists)
 *   highHonorsFromRules optional — falls back to gradingRules.academicStanding.highHonorsGpaAbove
 *
 * Returns:
 *   'none'         — does not currently qualify but isn't disqualified.
 *   'honors'       — meets the cumulative + per-semester floors, no disqualifying grades, on time.
 *   'high_honors'  — same as honors plus cumulative ≥ highHonors floor.
 *   'disqualified' — has at least one disqualifying grade OR a disciplinary
 *                    penalty when policy.requireNoDisciplinary is true.
 */
function evaluateHonors(input, policy = DEFAULT_HONORS_POLICY) {
  const cfg = { ...DEFAULT_HONORS_POLICY, ...(policy || {}) };
  const { semesters = [], allLetters = [], hasDisciplinary = false, highHonorsFromRules = 3.85 } = input || {};

  // Step 1: hard-disqualifying grades anywhere in the transcript.
  const disqSet = new Set(cfg.disqualifyingGrades || []);
  for (const l of allLetters) {
    if (disqSet.has(l)) return 'disqualified';
  }
  if (cfg.requireNoDisciplinary && hasDisciplinary) return 'disqualified';

  if (semesters.length === 0) return 'none';

  // Step 2: must be on track to graduate within maxMainSemesters.
  const mainCount = semesters.filter((s) => s.isMain !== false).length;
  if (mainCount > cfg.maxMainSemesters) return 'none';

  // Step 3: every main semester must clear the per-semester floor.
  const mainSemesters = semesters.filter((s) => s.isMain !== false);
  for (const s of mainSemesters) {
    if ((Number(s.perSemesterGpa) || 0) < cfg.perSemesterMinGpa) return 'none';
  }

  // Step 4: final cumulative must clear the cumulative floor.
  const last = semesters[semesters.length - 1];
  const cum = Number(last.cumulativeGpa) || 0;
  if (cum < cfg.cumulativeMinGpa) return 'none';

  // Step 5: is it high honors?
  const highHonorsFloor = cfg.highHonorsCumMinGpa ?? highHonorsFromRules;
  if (cum >= highHonorsFloor) return 'high_honors';
  return 'honors';
}

module.exports = {
  // Standing
  DEFAULT_STANDING,
  evaluateStanding,
  // Honors
  DEFAULT_HONORS_POLICY,
  honorsPolicySchema,
  getHonorsPolicy,
  evaluateHonors,
};
