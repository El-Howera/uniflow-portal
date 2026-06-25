/**
 * Credit Hour Definition (FCDS Article 6 — Plan 4 Phase 9).
 *
 * One credit hour = one of:
 *   - 1  lecture hour per week
 *   - 2  practical / lab hours per week
 *   - 3  applied-training hours per week
 *   - 4  field-training hours per week
 *
 * Defaults match FCDS Article 6 verbatim. Stored on
 * SystemSettings.creditHourDefinition (JSON). Reads route via the same
 * cached-loader pattern used by every other Plan-4 policy.
 *
 * Phase 9 surfaces this as an admin-editable card; downstream features
 * (capacity / load calculations) will read it as the canonical ratio. The
 * value is informational at the point of saving — no server-side enforcement
 * yet — so changing it is safe.
 */

const { z } = require('zod');

const DEFAULT_DEFINITION = Object.freeze({
  lectureHoursPerCredit:         1,
  practicalHoursPerCredit:       2,
  appliedTrainingHoursPerCredit: 3,
  fieldTrainingHoursPerCredit:   4,
});

const creditHourDefinitionSchema = z.object({
  lectureHoursPerCredit:         z.number().min(0.25).max(20),
  practicalHoursPerCredit:       z.number().min(0.25).max(20),
  appliedTrainingHoursPerCredit: z.number().min(0.25).max(20),
  fieldTrainingHoursPerCredit:   z.number().min(0.25).max(20),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_DEFINITION };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_DEFINITION)) {
    if (typeof stored[k] === 'number' && stored[k] > 0) out[k] = stored[k];
  }
  return out;
}

async function getCreditHourDefinition(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT credit_hour_definition AS def FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.def;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through to defaults.
  }
  return { ...DEFAULT_DEFINITION };
}

module.exports = {
  DEFAULT_DEFINITION,
  creditHourDefinitionSchema,
  getCreditHourDefinition,
};
