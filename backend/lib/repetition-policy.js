/**
 * Course-repetition policy (FCDS Article 18 — Plan 4 Phase 4).
 *
 * Drives how the cumulative GPA treats retaken courses. Per FCDS Article 18:
 *   - Up to 8 retakes (= 9 total attempts of the same course): only the
 *     passing grade counts. If the student fails repeatedly, only ONE
 *     failure counts. (Article 18d, 18e.)
 *   - Beyond 8 retakes: every attempt's grade counts in the CGPA — both
 *     passes and failures.
 *
 * The user feedback during plan-mode added two more knobs admins commonly
 * need:
 *   - `maxGradeAfterRetake` — cap the recorded grade letter on retake
 *     attempts (e.g. cap at B+ even if the student earned an A on retake).
 *   - `maxGradeAppliesToFirstRetakeOnly` — if true, only retake #2 caps;
 *     subsequent attempts uncapped.
 *   - `preserveOriginalIfHigher` — safety: if a retake is WORSE than the
 *     original, keep the original (retakes don't lower a student's record).
 *
 * The pure `applyRetakePolicy(attempts, policy, gradingRules)` function is
 * the single decider. Caller (transcript-cascade.js) groups TranscriptCourse
 * rows by courseCode, sorts chronologically, runs them through this fn, and
 * sums the returned "effective" rows for the cumulative GPA.
 *
 * Per-semester GPA does NOT apply the policy — a student's Fall 2025 GPA
 * always reflects what they earned in Fall 2025. The policy only re-shapes
 * the CUMULATIVE GPA across semesters where the same course was retaken.
 */

const { z } = require('zod');

const DEFAULT_POLICY = Object.freeze({
  // Number of RETAKES (not total attempts) over which only the passing grade
  // counts in CGPA. FCDS = 8. Set to 0 to count every attempt always.
  retakesCountedForGpa:           8,
  // Beyond the cap: count every attempt? FCDS Article 18d says yes; admins
  // can flip this to false if they want CGPA to keep ignoring failures.
  countAllAttemptsBeyond:         true,
  // Article 18c: students on probation may repeat to improve. Informational
  // — currently always allowed; this flag exists so a future admission
  // restriction can plug in.
  allowImprovementForProbation:   true,
  // Cap retakes at this letter — set null to leave retakes uncapped. Must be
  // a letter present in the configured grading-rules scale.
  maxGradeAfterRetake:            null,
  // If true, only retake #2 (the FIRST retake — index 1) is capped; later
  // retakes are uncapped. Some institutions treat the first retake as
  // "remediation" and uncap further attempts.
  maxGradeAppliesToFirstRetakeOnly: false,
  // If true and a retake is WORSE than the original, the original keeps its
  // qp contribution. Retakes never lower the record.
  preserveOriginalIfHigher:       true,
});

const repetitionPolicySchema = z.object({
  retakesCountedForGpa:             z.number().int().min(0).max(50),
  countAllAttemptsBeyond:           z.boolean(),
  allowImprovementForProbation:     z.boolean(),
  // Letter values are validated separately by the caller against the active
  // grading scale (the schema can't know the scale at parse time).
  maxGradeAfterRetake:              z.union([z.string().min(1).max(4), z.null()]),
  maxGradeAppliesToFirstRetakeOnly: z.boolean(),
  preserveOriginalIfHigher:         z.boolean(),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
    else if (stored[k] === null && k === 'maxGradeAfterRetake') out[k] = null;
  }
  return out;
}

async function getRepetitionPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT repetition_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Look up a grading-scale row by letter; returns the row or undefined. */
function findScaleRow(letter, gradingRules) {
  return gradingRules?.scale?.find((r) => r.letter === letter);
}

/** Per-credit qualityPoints for a letter; falls back to 0. */
function qpPerCredit(letter, gradingRules) {
  const row = findScaleRow(letter, gradingRules);
  return row ? Number(row.qualityPoints) : 0;
}

/** TOTAL qualityPoints stored on a TranscriptCourse row = qpPerCredit × credits. */
function totalQp(letter, credits, gradingRules) {
  return Math.round(qpPerCredit(letter, gradingRules) * credits * 10) / 10;
}

/** Is this letter passing (D or higher in FCDS, non-scoring excluded)? */
function isPassing(letter, gradingRules) {
  const row = findScaleRow(letter, gradingRules);
  if (!row || row.nonScoring) return false;
  const dRow = findScaleRow('D', gradingRules);
  const minPassQp = dRow ? Number(dRow.qualityPoints) : 1.0;
  return Number(row.qualityPoints) >= minPassQp;
}

/**
 * Cap a letter at `capLetter`: if the original is HIGHER than the cap, return
 * the cap; otherwise return the original. "Higher" = larger qp_per_credit.
 * Returns the original letter untouched if `capLetter` is null/undefined.
 */
function capLetter(letter, capValue, gradingRules) {
  if (!capValue) return letter;
  const lh = qpPerCredit(letter, gradingRules);
  const ch = qpPerCredit(capValue, gradingRules);
  return lh > ch ? capValue : letter;
}

// ── Core: applyRetakePolicy ────────────────────────────────────────────────

/**
 * Apply the repetition policy to a chronologically-sorted attempt list.
 *
 * Each `attempt` MUST carry { id, semesterId, grade, credits } (+ any extra
 * fields the caller wants — they're echoed through). The function never
 * mutates the input; it returns the SUBSET of attempts that count toward
 * cumulative GPA, with `grade` and `qualityPoints` reflecting any cap.
 *
 * Rules (top-down — first match wins per attempt):
 *   1. Single attempt → counts as-is, no cap (cap only applies to retakes).
 *   2. Within `retakesCountedForGpa` retakes (= retakesCountedForGpa + 1
 *      attempts including the original):
 *        a. Apply the maxGradeAfterRetake cap to retake attempts (i > 0).
 *        b. If at least one passing attempt exists, the BEST passing one
 *           counts (ties broken by latest). `preserveOriginalIfHigher`
 *           causes the original to win if it's higher than the best retake.
 *        c. If no passing attempt exists, the LAST failure counts (FCDS
 *           18e: only one failure recorded across multi-fail retakes).
 *   3. Beyond cap: every attempt counts (subject to `countAllAttemptsBeyond`).
 *      Caps applied per-attempt.
 *
 * @param {Array}  attempts
 * @param {object} [policy=DEFAULT_POLICY]
 * @param {object} gradingRules           required — defaults are unsafe here
 * @returns {Array} subset of input rows; each has .grade + .qualityPoints set
 */
function applyRetakePolicy(attempts, policy = DEFAULT_POLICY, gradingRules) {
  if (!Array.isArray(attempts) || attempts.length === 0) return [];
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };

  // Step A: copy + cap. Caps only apply to retakes (i > 0); when
  // `maxGradeAppliesToFirstRetakeOnly` is true, only retake #2 (i === 1) caps.
  const processed = attempts.map((a, i) => {
    const isRetake = i > 0;
    const shouldCap =
      isRetake &&
      cfg.maxGradeAfterRetake &&
      (!cfg.maxGradeAppliesToFirstRetakeOnly || i === 1);
    const newGrade = shouldCap
      ? capLetter(a.grade, cfg.maxGradeAfterRetake, gradingRules)
      : a.grade;
    return {
      ...a,
      grade:         newGrade,
      qualityPoints: totalQp(newGrade, a.credits, gradingRules),
      originalGrade: a.grade,
      capped:        newGrade !== a.grade,
    };
  });

  // Step B: split into "within cap" + "beyond cap".
  const cap = Math.max(0, cfg.retakesCountedForGpa);
  const withinCap = processed.slice(0, Math.min(processed.length, cap + 1));
  const beyondCap = processed.slice(cap + 1);

  // Step C: pick the counted attempt(s) within cap.
  let countedWithin;
  if (withinCap.length === 1) {
    countedWithin = [withinCap[0]];
  } else {
    const passing = withinCap.filter((a) => isPassing(a.grade, gradingRules));
    if (passing.length > 0) {
      // Best passing — break ties by latest (largest index in withinCap).
      let best = passing[0];
      for (let j = 1; j < passing.length; j++) {
        const cmp = qpPerCredit(passing[j].grade, gradingRules) - qpPerCredit(best.grade, gradingRules);
        if (cmp > 0) {
          best = passing[j];
        } else if (cmp === 0) {
          best = passing[j]; // tie → latest by ordering
        }
      }
      // preserveOriginalIfHigher: if original (passing) is higher, keep original.
      const original = withinCap[0];
      if (
        cfg.preserveOriginalIfHigher &&
        isPassing(original.grade, gradingRules) &&
        qpPerCredit(original.grade, gradingRules) > qpPerCredit(best.grade, gradingRules)
      ) {
        countedWithin = [original];
      } else {
        countedWithin = [best];
      }
    } else {
      // All failures — FCDS 18e: only ONE failure counts. Use the latest
      // (the most recent attempt) so the student isn't double-penalised.
      countedWithin = [withinCap[withinCap.length - 1]];
    }
  }

  // Step D: beyond cap — every attempt counts when policy says so.
  const countedBeyond = cfg.countAllAttemptsBeyond ? beyondCap : [];

  return [...countedWithin, ...countedBeyond];
}

module.exports = {
  DEFAULT_POLICY,
  repetitionPolicySchema,
  getRepetitionPolicy,
  applyRetakePolicy,
  isPassing,
  qpPerCredit,
  totalQp,
  capLetter,
};
