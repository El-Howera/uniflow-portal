/**
 * Grading rules — single source of truth for how percentages map to letter
 * grades, how letters map to GPA quality points, what credit limits apply,
 * and where the academic-standing thresholds sit.
 *
 * Stored at SystemSettings.gradingRules (JSON). When null, DEFAULT_RULES is
 * used. The admin Settings UI edits the JSON; consumers (transcript writes,
 * the GPA recompute job, the student GpaCalculator) read it through
 * `getGradingRules(prisma)`.
 *
 * The defaults match the FCDS (Alexandria University) scale that the project
 * was originally built around. Any tenant deploying UniFlow can override
 * them via the admin UI without code changes.
 */

const { z } = require('zod');

// ── Defaults (FCDS 11-letter scale) ──────────────────────────────────────────

const DEFAULT_RULES = Object.freeze({
  scale: [
    // Scoring grades — minPercent → letter on the standard FCDS curve.
    { letter: 'A',  minPercent: 90, qualityPoints: 4.000 },
    { letter: 'A-', minPercent: 85, qualityPoints: 3.666 },
    { letter: 'B+', minPercent: 80, qualityPoints: 3.333 },
    { letter: 'B',  minPercent: 75, qualityPoints: 3.000 },
    { letter: 'B-', minPercent: 70, qualityPoints: 2.666 },
    { letter: 'C+', minPercent: 65, qualityPoints: 2.333 },
    { letter: 'C',  minPercent: 60, qualityPoints: 2.000 },
    { letter: 'C-', minPercent: 55, qualityPoints: 1.666 },
    { letter: 'D+', minPercent: 52, qualityPoints: 1.333 },
    { letter: 'D',  minPercent: 50, qualityPoints: 1.000 },
    { letter: 'F',  minPercent: 0,  qualityPoints: 0.000 },
    // Non-scoring administrative codes — these don't represent a percentage
    // band; they're transcript markers (Withdrawal, Incomplete, Audit, S/U,
    // etc.). nonScoring=true means percentToLetter() and the
    // strictly-decreasing validator skip them, so multiple can co-exist at
    // minPercent=0 without conflicting with F.
    { letter: 'W',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal' },
    { letter: 'FW', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal — Forced' },
    { letter: 'MW', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal — Military' },
    { letter: 'I',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Incomplete' },
    { letter: 'IP', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'In Progress' },
    { letter: 'S',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Satisfactory' },
    { letter: 'U',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Unsatisfactory' },
    { letter: 'AU', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Audit' },
  ],
  academicStanding: {
    probationGpaBelow:    2.0,
    dismissalGpaBelow:    1.5,
    honorsGpaAbove:       3.5,
    highHonorsGpaAbove:   3.85,
    // Plan 4 Phase 5 — Article 19a special-case for the 2nd-semester
    // warning (CGPA < 1.666 at end of 2nd semester triggers monitoring
    // even if the post-2nd threshold is 2.0).
    firstYearWarningGpa:  1.666,
    // Plan 4 Phase 5 — dismissal counter (Article 19e). 3 consecutive OR
    // 4 non-consecutive sub-2.0 cumulative semesters → dismissed.
    dismissalConsecutiveSemesters:    3,
    dismissalNonConsecutiveSemesters: 4,
    // Plan 4 Phase 5 — registered-credits cap when on probation (Article 19b).
    // The credit-limit policy already covers this for the registration
    // handler; storing it here too keeps Settings → Grading Rules a
    // single source for academic-standing knobs.
    probationMaxCredits:  12,
  },
  credits: {
    min: 12,
    max: 21,
    // @deprecated Plan 4 Phase 1 — superseded by
    // SystemSettings.graduationPolicy.minTotalCredits. The field stays in the
    // default for backward compatibility with stored gradingRules JSON; new
    // code should call getGraduationPolicy(prisma) and read minTotalCredits.
    graduationTotal: 140,
  },
});

// ── Zod schema for PATCH validation ──────────────────────────────────────────

const scaleEntrySchema = z.object({
  letter: z.string().min(1).max(4),
  minPercent: z.number().min(0).max(100),
  qualityPoints: z.number().min(0).max(5),
  // Non-scoring administrative codes (W, FW, MW, I, IP, S, U, AU). When
  // true, the entry is exempt from the strictly-decreasing minPercent rule
  // and percentToLetter() ignores it.
  nonScoring: z.boolean().optional(),
  // Human-readable description shown in the admin scale editor.
  label: z.string().max(60).optional(),
});

const gradingRulesSchema = z.object({
  scale: z.array(scaleEntrySchema)
    .min(2, 'At least two letter grades are required')
    .max(20, 'Too many letter grades'),
  academicStanding: z.object({
    probationGpaBelow:  z.number().min(0).max(5),
    dismissalGpaBelow:  z.number().min(0).max(5),
    honorsGpaAbove:     z.number().min(0).max(5),
    highHonorsGpaAbove: z.number().min(0).max(5),
    // Plan 4 Phase 5 — optional so older clients PATCHing the legacy 4
    // fields still validate.
    firstYearWarningGpa:              z.number().min(0).max(5).optional(),
    dismissalConsecutiveSemesters:    z.number().int().min(1).max(20).optional(),
    dismissalNonConsecutiveSemesters: z.number().int().min(1).max(20).optional(),
    probationMaxCredits:              z.number().int().min(1).max(60).optional(),
  }),
  credits: z.object({
    min: z.number().int().min(1).max(60),
    max: z.number().int().min(1).max(60),
    // @deprecated — kept optional so older clients can still PATCH the field
    // without 400ing, but the canonical source for graduation credits is now
    // SystemSettings.graduationPolicy.minTotalCredits.
    graduationTotal: z.number().int().min(30).max(300).optional(),
  }),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the current grading rules from SystemSettings; falls back to defaults.
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getGradingRules(prisma) {
  try {
    const s = await prisma.systemSettings.findFirst({ select: { gradingRules: true } });
    if (s?.gradingRules) return mergeWithDefaults(s.gradingRules);
  } catch {
    // DB unavailable — fall through to defaults so the system stays usable.
  }
  return DEFAULT_RULES;
}

/**
 * Defensive merge: if a stored rules object is missing any top-level field
 * (older row from before a future schema extension), borrow the default for
 * that field. Caller never has to null-check the shape.
 */
function mergeWithDefaults(stored) {
  return {
    scale: Array.isArray(stored.scale) && stored.scale.length > 0
      ? stored.scale
      : DEFAULT_RULES.scale,
    academicStanding: {
      ...DEFAULT_RULES.academicStanding,
      ...(stored.academicStanding || {}),
    },
    credits: {
      ...DEFAULT_RULES.credits,
      ...(stored.credits || {}),
    },
  };
}

/**
 * Map a 0-100 percentage to its letter grade per the active scale.
 * Walks the scoring entries in descending minPercent order so the first
 * match wins. Non-scoring administrative codes (W, FW, I, etc.) are
 * skipped — those letters are assigned manually by the registrar, not by
 * percentage.
 */
function percentToLetter(percent, rules = DEFAULT_RULES) {
  const scoring = rules.scale.filter((r) => !r.nonScoring);
  const sorted = [...scoring].sort((a, b) => b.minPercent - a.minPercent);
  for (const row of sorted) {
    if (percent >= row.minPercent) return row.letter;
  }
  return sorted[sorted.length - 1]?.letter ?? 'F';
}

/**
 * Map a letter grade to its quality points. Returns 0 if the letter isn't
 * in the active scale (which shouldn't happen for stored grades but can if
 * an admin edits the scale and a transcript still references an old letter).
 */
function letterToPoints(letter, rules = DEFAULT_RULES) {
  const row = rules.scale.find((r) => r.letter === letter);
  return row ? row.qualityPoints : 0;
}

/**
 * Classify a GPA into an academic-standing band. Used for student dashboard
 * badges and admin reporting.
 * Returns one of: 'high_honors' | 'honors' | 'good' | 'probation' | 'dismissal'.
 */
function classifyStanding(gpa, rules = DEFAULT_RULES) {
  const t = rules.academicStanding;
  if (gpa >= t.highHonorsGpaAbove) return 'high_honors';
  if (gpa >= t.honorsGpaAbove)     return 'honors';
  if (gpa <  t.dismissalGpaBelow)  return 'dismissal';
  if (gpa <  t.probationGpaBelow)  return 'probation';
  return 'good';
}

module.exports = {
  DEFAULT_RULES,
  gradingRulesSchema,
  getGradingRules,
  percentToLetter,
  letterToPoints,
  classifyStanding,
};
