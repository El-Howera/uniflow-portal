/**
 * Graduation policy + semester durations.
 *
 * Plan 4 Phase 1 — closes Articles 5 (Study System) and 8 (Graduation
 * Requirements) of the FCDS regulations. Both shapes are admin-tunable JSON
 * blobs on SystemSettings, mirroring the level-progression / credit-limits
 * pattern. When either column is null the FCDS defaults apply.
 *
 * Storage:
 *   • SystemSettings.graduationPolicy   = { minTotalCredits, minMainSemesters, minCgpa }
 *   • SystemSettings.semesterDurations  = { fallWeeks, springWeeks, summerWeeks }
 *
 * Why two policies in one file: they're edited together (Academic Settings
 * sidebar puts them adjacent), they're cheap to load, and keeping them
 * paired avoids a second cache layer in the public-settings endpoint.
 */

const { z } = require('zod');

// ── Defaults (FCDS, Alexandria University) ──────────────────────────────────

const DEFAULT_GRADUATION_POLICY = Object.freeze({
  minTotalCredits:  140, // Article 8 — minimum credit hours to graduate
  minMainSemesters: 7,   // Article 8 — minimum main semesters before graduation
  minCgpa:          2.0, // Article 8 — minimum CGPA at graduation
});

const DEFAULT_SEMESTER_DURATIONS = Object.freeze({
  fallWeeks:   15, // Article 5 — Fall semester length
  springWeeks: 15, // Article 5 — Spring semester length
  summerWeeks: 8,  // Article 5 — Optional Summer semester length
});

// ── Zod schemas for PATCH validation ────────────────────────────────────────

const graduationPolicySchema = z.object({
  minTotalCredits:  z.number().int().min(30).max(300),
  minMainSemesters: z.number().int().min(1).max(20),
  minCgpa:          z.number().min(0).max(5),
});

const semesterDurationsSchema = z.object({
  fallWeeks:   z.number().int().min(1).max(52),
  springWeeks: z.number().int().min(1).max(52),
  summerWeeks: z.number().int().min(1).max(52),
});

// ── Defensive merge helpers ─────────────────────────────────────────────────

function mergeGraduationDefaults(stored) {
  const out = { ...DEFAULT_GRADUATION_POLICY };
  for (const k of Object.keys(DEFAULT_GRADUATION_POLICY)) {
    if (typeof stored[k] === 'number' && Number.isFinite(stored[k])) {
      out[k] = stored[k];
    }
  }
  return out;
}

function mergeSemesterDefaults(stored) {
  const out = { ...DEFAULT_SEMESTER_DURATIONS };
  for (const k of Object.keys(DEFAULT_SEMESTER_DURATIONS)) {
    if (Number.isInteger(stored[k]) && stored[k] > 0) {
      out[k] = stored[k];
    }
  }
  return out;
}

// ── Loaders ─────────────────────────────────────────────────────────────────

/**
 * Read the active graduation policy from SystemSettings; falls back to
 * DEFAULT_GRADUATION_POLICY when the column is null or DB is unreachable.
 *
 * Uses $queryRaw so the call works even when the Prisma client artifact
 * hasn't been regenerated yet (Windows DLL lock during dev).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getGraduationPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT graduation_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored && typeof stored === 'object') return mergeGraduationDefaults(stored);
  } catch {
    // Column missing (older deploy) or DB unavailable — fall through.
  }
  return DEFAULT_GRADUATION_POLICY;
}

/**
 * Read the active semester durations from SystemSettings; falls back to
 * DEFAULT_SEMESTER_DURATIONS when the column is null or DB is unreachable.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getSemesterDurations(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT semester_durations AS durations FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.durations;
    if (stored && typeof stored === 'object') return mergeSemesterDefaults(stored);
  } catch {
    // Column missing (older deploy) or DB unavailable — fall through.
  }
  return DEFAULT_SEMESTER_DURATIONS;
}

// ── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Decide whether a student meets the graduation policy.
 *
 * Each criterion is reported individually so the UI can show "you're 12
 * credits short" or "your CGPA is 0.10 below the minimum" — not just a
 * yes/no.
 *
 * @param {object} input
 * @param {number} [input.totalCredits]   credits earned (passing grades only)
 * @param {number} [input.cgpa]           cumulative GPA, 0–4
 * @param {number} [input.mainSemesters]  count of completed main (non-summer) semesters
 * @param {object} [policy]               full graduation policy, defaults to DEFAULT
 * @returns {{ eligible: boolean, criteria: Array<{ key: string, ok: boolean, current: number, required: number, label: string }> }}
 */
function evaluateGraduationEligibility(
  { totalCredits = 0, cgpa = 0, mainSemesters = 0 } = {},
  policy = DEFAULT_GRADUATION_POLICY,
) {
  const cfg = { ...DEFAULT_GRADUATION_POLICY, ...(policy || {}) };
  const criteria = [
    {
      key: 'credits',
      ok: totalCredits >= cfg.minTotalCredits,
      current: Number(totalCredits) || 0,
      required: cfg.minTotalCredits,
      label: 'Total credit hours',
    },
    {
      key: 'cgpa',
      ok: (Number(cgpa) || 0) >= cfg.minCgpa,
      current: Number(cgpa) || 0,
      required: cfg.minCgpa,
      label: 'Cumulative GPA',
    },
    {
      key: 'semesters',
      ok: mainSemesters >= cfg.minMainSemesters,
      current: Number(mainSemesters) || 0,
      required: cfg.minMainSemesters,
      label: 'Main semesters completed',
    },
  ];
  return {
    eligible: criteria.every((c) => c.ok),
    criteria,
  };
}

module.exports = {
  DEFAULT_GRADUATION_POLICY,
  DEFAULT_SEMESTER_DURATIONS,
  graduationPolicySchema,
  semesterDurationsSchema,
  getGraduationPolicy,
  getSemesterDurations,
  evaluateGraduationEligibility,
};
