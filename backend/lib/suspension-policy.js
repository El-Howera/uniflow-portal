/**
 * Enrollment-workflow caps (FCDS Articles 20, 21 — Plan 4 Phase 6).
 *
 * Stored as JSON on SystemSettings.suspensionPolicy. When null, defaults
 * apply — they match the FCDS values:
 *   - Up to 4 main-semester suspensions over the student's whole career.
 *   - Up to 4 consecutive — the same number, but they must not all be in
 *     a row. The check happens at approval time.
 *   - Military withdrawal (`MW`) doesn't count against the cap by default.
 *   - Re-enrollment after cancellation must be requested within 4 main
 *     semesters of the cancellation date (Article 21).
 *
 * The handlers in backend/servers/student-affairs/index.js consume this
 * policy when a SA user approves a suspension or cancellation/re-enrollment.
 */

const { z } = require('zod');

const DEFAULT_POLICY = Object.freeze({
  maxSuspensionsTotal:                4,
  maxConsecutive:                     4,
  militaryWithdrawalCountsAgainstCap: false,
  reEnrollmentWithinSemesters:        4,
});

const suspensionPolicySchema = z.object({
  maxSuspensionsTotal:                z.number().int().min(0).max(20),
  maxConsecutive:                     z.number().int().min(0).max(20),
  militaryWithdrawalCountsAgainstCap: z.boolean(),
  reEnrollmentWithinSemesters:        z.number().int().min(0).max(20),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
  }
  return out;
}

async function getSuspensionPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT suspension_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

/**
 * Decide whether ONE more suspension can be approved for a user without
 * busting the policy cap. Caller passes the user's APPROVED suspensions so
 * far (sorted chronologically would be ideal but not required).
 *
 * Returns `{ ok, reason, details }`.
 */
function evaluateSuspensionCap(approvedSuspensions, policy = DEFAULT_POLICY, opts = {}) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  const isMilitary = !!opts.isMilitary;
  // If military withdrawal doesn't count, we exclude prior military rows
  // AND skip the new one when computing the total.
  const counted = approvedSuspensions.filter((s) => {
    if (cfg.militaryWithdrawalCountsAgainstCap) return true;
    return !s.isMilitary;
  });
  const semestersAlreadyUsed = counted.reduce((sum, s) => sum + (Number(s.semesters) || 1), 0);
  // Each new suspension consumes >=1 semester. Caller passes in semesters via opts.semesters.
  const semestersThisRequest = isMilitary && !cfg.militaryWithdrawalCountsAgainstCap
    ? 0
    : Math.max(1, Number(opts.semesters) || 1);
  const projected = semestersAlreadyUsed + semestersThisRequest;
  if (projected > cfg.maxSuspensionsTotal) {
    return {
      ok: false,
      reason: 'cap_exceeded',
      details: {
        used: semestersAlreadyUsed,
        requested: semestersThisRequest,
        cap: cfg.maxSuspensionsTotal,
        message:
          `Approving this would bring total suspensions to ${projected} ` +
          `semester(s); the cap is ${cfg.maxSuspensionsTotal} (FCDS Article 20a).`,
      },
    };
  }
  return { ok: true };
}

/**
 * Decide whether a re-enrollment request after cancellation is still
 * within the policy window. Article 21: must apply within 4 main semesters
 * of the cancellation.
 */
function evaluateReEnrollmentWindow(cancellation, policy = DEFAULT_POLICY) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  if (!cancellation?.reviewedAt) {
    return { ok: false, reason: 'cancellation_not_approved', details: { message: 'Cancellation must be approved before re-enrollment.' } };
  }
  if (cancellation.status !== 'approved') {
    return { ok: false, reason: 'cancellation_not_approved', details: { message: `Cancellation status is "${cancellation.status}".` } };
  }
  // Approximate "main semester" as ~120 days (a 15-week semester + breaks).
  // The exact rule wants count of semesters elapsed, but counting
  // SemesterGpa rows since cancellation requires more wiring; this is a
  // conservative time-based approximation that errs on the user's side.
  const elapsedDays = Math.floor(
    (Date.now() - new Date(cancellation.reviewedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const elapsedSemesters = Math.floor(elapsedDays / 120);
  if (elapsedSemesters > cfg.reEnrollmentWithinSemesters) {
    return {
      ok: false,
      reason: 'reenrollment_window_passed',
      details: {
        elapsedSemesters,
        cap: cfg.reEnrollmentWithinSemesters,
        message:
          `Re-enrollment window of ${cfg.reEnrollmentWithinSemesters} main semester(s) ` +
          `has passed (≈${elapsedSemesters} elapsed since cancellation).`,
      },
    };
  }
  return { ok: true };
}

module.exports = {
  DEFAULT_POLICY,
  suspensionPolicySchema,
  getSuspensionPolicy,
  evaluateSuspensionCap,
  evaluateReEnrollmentWindow,
};
