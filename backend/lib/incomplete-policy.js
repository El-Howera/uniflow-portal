/**
 * Incomplete-grade policy (FCDS Article 17 — Plan 4 Phase 4).
 *
 * When a final exam is missed with an accepted excuse, the registrar files
 * an Incomplete (`I`) letter on the student's transcript. FCDS Article 17
 * specifies three constraints we let admins tune per institution:
 *   1. minTermWorkPercent — the term-work bar a student must clear to
 *      qualify for an `I` (default 60%).
 *   2. maxIncompletesPerStudent — across the student's whole career
 *      (default 3 per Article 17d).
 *   3. makeupExamWindowDays — informational only; the make-up exam happens
 *      "during the first week of the immediately following semester"
 *      (default 7 days). Used by admin UI hints; not enforced server-side.
 *
 * Stored on SystemSettings.incompletePolicy (JSON). Null → DEFAULT_POLICY.
 */

const { z } = require('zod');

const DEFAULT_POLICY = Object.freeze({
  minTermWorkPercent:        60,
  maxIncompletesPerStudent:  3,
  makeupExamWindowDays:      7,
});

const incompletePolicySchema = z.object({
  minTermWorkPercent:        z.number().min(0).max(100),
  maxIncompletesPerStudent:  z.number().int().min(0).max(20),
  makeupExamWindowDays:      z.number().int().min(1).max(60),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (typeof stored[k] === 'number' && Number.isFinite(stored[k])) out[k] = stored[k];
  }
  return out;
}

/**
 * Read the active incomplete policy from SystemSettings; falls back to
 * DEFAULT_POLICY when the column is null. Raw SQL so it works pre-`prisma generate`.
 */
async function getIncompletePolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT incomplete_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through to defaults.
  }
  return DEFAULT_POLICY;
}

/**
 * Compute the term-work earned/max from a TranscriptCourse's GradeBreakdown
 * rows. The "Final Exam" / "Final" / "Override" categories are excluded —
 * Article 17 talks about the term-work component specifically.
 *
 * Each GradeBreakdown row stores:
 *   grade  = earned points     (e.g. "4.5")
 *   weight = max points        (e.g. "5")
 *   contribution = "<pct>%"    (computed; not used here)
 *
 * Returns { earned, max, percent } or null when no parseable rows exist
 * (caller treats null as "data unavailable, can't validate").
 */
function computeTermWorkFromBreakdowns(breakdowns) {
  if (!Array.isArray(breakdowns) || breakdowns.length === 0) return null;
  const EXCLUDE_CATEGORIES = new Set(['Final Exam', 'Final', 'Override']);
  let earned = 0;
  let max = 0;
  let parsedAny = false;
  for (const row of breakdowns) {
    const cat = String(row.categoryTitle || '');
    if (EXCLUDE_CATEGORIES.has(cat)) continue;
    const e = parseFloat(row.grade);
    const m = parseFloat(row.weight);
    if (!Number.isFinite(e) || !Number.isFinite(m) || m <= 0) continue;
    earned += e;
    max += m;
    parsedAny = true;
  }
  if (!parsedAny || max <= 0) return null;
  return { earned, max, percent: (earned / max) * 100 };
}

/**
 * Validate an "I" filing against the policy. Returns `{ ok: true }` on pass,
 * or `{ ok: false, reason, details }` on rejection. Caller (transcript
 * cascade) translates ok=false into an HTTP 400.
 *
 * @param {object} input
 * @param {object[]} [input.breakdowns]      GradeBreakdown rows for the TranscriptCourse
 * @param {number}   [input.existingIncompletes] count of the user's existing 'I' rows
 * @param {object}   [policy]
 */
function validateIncompleteFiling(input, policy = DEFAULT_POLICY) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  const { breakdowns, existingIncompletes = 0 } = input || {};

  if (existingIncompletes >= cfg.maxIncompletesPerStudent) {
    return {
      ok: false,
      reason: 'max_incompletes_reached',
      details: {
        existingIncompletes,
        cap: cfg.maxIncompletesPerStudent,
        message:
          `Student already has ${existingIncompletes} incomplete grade(s); ` +
          `the policy cap is ${cfg.maxIncompletesPerStudent} (FCDS Article 17d).`,
      },
    };
  }

  const tw = computeTermWorkFromBreakdowns(breakdowns);
  if (tw && tw.percent < cfg.minTermWorkPercent) {
    return {
      ok: false,
      reason: 'term_work_below_threshold',
      details: {
        earned: tw.earned,
        max: tw.max,
        percent: Math.round(tw.percent * 10) / 10,
        threshold: cfg.minTermWorkPercent,
        message:
          `Term-work earned is ${Math.round(tw.percent)}% (${tw.earned}/${tw.max}), ` +
          `below the ${cfg.minTermWorkPercent}% threshold required for an Incomplete (FCDS Article 17a).`,
      },
    };
  }

  return { ok: true };
}

module.exports = {
  DEFAULT_POLICY,
  incompletePolicySchema,
  getIncompletePolicy,
  computeTermWorkFromBreakdowns,
  validateIncompleteFiling,
};
