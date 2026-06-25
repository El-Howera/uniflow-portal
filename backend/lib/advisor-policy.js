/**
 * Academic advisor approval gate (FCDS Article 12 — Plan 4 Phase 8).
 *
 * Tunes the registration approval flow:
 *   - When `requireAdvisorApproval` is true, every student registration goes
 *     through the assigned advisor (sets `pendingReason='advisor_approval'`)
 *     unless the credit total falls under `autoApproveBelowCredits`.
 *   - `restrictPickerToFlaggedProfessors` is a UI hint: the admin "Assign
 *     Advisor" picker pre-filters to professors with isAcademicAdvisor=true.
 *     Admins can override; the flag is not load-bearing on enforcement.
 *   - `gracePeriodHours` lets a registration auto-approve after N hours
 *     without explicit advisor action. Stored but currently informational —
 *     no scheduled job sweeps the queue yet.
 *
 * Stored on SystemSettings.advisorPolicy (JSON). When null, defaults apply.
 */

const { z } = require('zod');

const DEFAULT_POLICY = Object.freeze({
  // Master toggle. When false, every student registration approves
  // automatically as far as the advisor gate is concerned (other gates —
  // window, credit cap, prereq — still run).
  requireAdvisorApproval:           true,
  // Credits at or below this value bypass the advisor gate. Default 0 means
  // every registration goes to the advisor; tenants who only want senior /
  // bigger loads gated can set e.g. 12.
  autoApproveBelowCredits:          0,
  // Reserved for future scheduled-sweep auto-approval. Not currently
  // enforced — surfaced in the policy admin card for visibility.
  gracePeriodHours:                 0,
  // UI hint only — pre-filters the admin's "Assign Advisor" dropdown.
  restrictPickerToFlaggedProfessors: true,
});

const advisorPolicySchema = z.object({
  requireAdvisorApproval:           z.boolean(),
  autoApproveBelowCredits:          z.number().int().min(0).max(60),
  gracePeriodHours:                 z.number().int().min(0).max(720),
  restrictPickerToFlaggedProfessors: z.boolean(),
});

function mergeWithDefaults(stored) {
  const out = { ...DEFAULT_POLICY };
  if (!stored || typeof stored !== 'object') return out;
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
  }
  return out;
}

async function getAdvisorPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT advisor_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through to defaults.
  }
  return { ...DEFAULT_POLICY };
}

/**
 * Decide whether a student's registration needs to go through the advisor
 * before it can be approved.
 *
 * @param {object} input
 * @param {boolean} input.hasAssignedAdvisor whether the student has an advisorId set
 * @param {number}  input.totalCredits       credits being registered (lecture + lab summed by caller)
 * @param {object} [policy=DEFAULT_POLICY]
 * @returns {{ requires: boolean, reason?: string }}
 *   requires=true means the registration row should be marked pending with
 *   `pendingReason='advisor_approval'`. reason explains the call when needed
 *   for the SA queue tooltip.
 */
function evaluateAdvisorGate(
  { hasAssignedAdvisor = false, totalCredits = 0 } = {},
  policy = DEFAULT_POLICY,
) {
  const cfg = { ...DEFAULT_POLICY, ...(policy || {}) };
  if (!cfg.requireAdvisorApproval) return { requires: false };
  if (Number(totalCredits) <= Number(cfg.autoApproveBelowCredits)) {
    return { requires: false, reason: 'below_credit_threshold' };
  }
  if (!hasAssignedAdvisor) {
    // Policy requires advisor approval but none assigned — caller decides
    // whether to fail closed (block) or route to SA. We just signal the
    // ambiguity here so the caller can choose.
    return { requires: true, reason: 'no_advisor_assigned' };
  }
  return { requires: true, reason: 'advisor_approval_required' };
}

module.exports = {
  DEFAULT_POLICY,
  advisorPolicySchema,
  getAdvisorPolicy,
  evaluateAdvisorGate,
};
