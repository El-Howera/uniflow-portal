/**
 * Registration / Add-Drop / Withdrawal windows policy.
 *
 * Plan 4 Phase 3 — closes FCDS Articles 13, 14, 15. Windows are encoded as
 * start-week + end-week per main / summer term so colleges with different
 * calendars (week 4–8 vs week 4–12 for withdrawal etc.) can configure
 * without code changes.
 *
 * Stored on SystemSettings.windowsPolicy (JSON). When the column is null
 * (fresh DB or first-run), DEFAULT_POLICY applies — the FCDS defaults.
 *
 * Shape on the wire:
 *   {
 *     lateRegistration: { main: { startWeek, endWeek }, summer: { startWeek, endWeek } },
 *     addDrop:          { main: { startWeek, endWeek }, summer: { startWeek, endWeek } },
 *     withdrawal:       { main: { startWeek, endWeek }, summer: { startWeek, endWeek } },
 *   }
 *
 * The window's start/end DATE is derived per request from the active
 * RegistrationPeriod's startDate. Concretely:
 *   start = period.startDate + (window.startWeek - 1) × 7 days
 *   end   = period.startDate + window.endWeek × 7 days - 1 ms
 *
 * That means changing the policy weeks instantly shifts every active window
 * without any per-period bookkeeping.
 */

const { z } = require('zod');

// ── Defaults (FCDS, Alexandria University — Articles 13–15) ──────────────────

const DEFAULT_POLICY = Object.freeze({
  lateRegistration: {
    main:   { startWeek: 2, endWeek: 2 },  // Article 13b — second week only.
    summer: { startWeek: 1, endWeek: 1 },
  },
  addDrop: {
    main:   { startWeek: 2, endWeek: 3 },  // Article 14 — week 2–3 of main.
    summer: { startWeek: 1, endWeek: 1 },  // First week of summer.
  },
  withdrawal: {
    main:   { startWeek: 4, endWeek: 12 }, // Article 15 — week 4–12 of main.
    summer: { startWeek: 6, endWeek: 6 },  // Sixth week of summer.
  },
});

// ── Zod schema ──────────────────────────────────────────────────────────────

const weekRangeSchema = z.object({
  startWeek: z.number().int().min(1).max(20),
  endWeek:   z.number().int().min(1).max(20),
}).superRefine((v, ctx) => {
  if (v.endWeek < v.startWeek) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endWeek'],
      message: `endWeek (${v.endWeek}) must be >= startWeek (${v.startWeek})`,
    });
  }
});

const termWindowSchema = z.object({
  main:   weekRangeSchema,
  summer: weekRangeSchema,
});

const windowsPolicySchema = z.object({
  lateRegistration: termWindowSchema,
  addDrop:          termWindowSchema,
  withdrawal:       termWindowSchema,
}).superRefine((v, ctx) => {
  // Cross-window sanity: addDrop must end before withdrawal starts in BOTH
  // term variants — overlapping windows are conceptually broken (can't both
  // add/drop and withdraw on the same day; the action set is different).
  for (const term of /** @type {const} */ (['main', 'summer'])) {
    if (v.addDrop[term].endWeek > v.withdrawal[term].startWeek) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withdrawal', term, 'startWeek'],
        message: `${term}: withdrawal window must start after the add-drop window ends (addDrop ends week ${v.addDrop[term].endWeek}, withdrawal starts week ${v.withdrawal[term].startWeek})`,
      });
    }
  }
});

// ── Defensive merge (handles partial JSON from older deployments) ───────────

function mergeRange(stored, fallback) {
  const out = { ...fallback };
  if (Number.isInteger(stored?.startWeek) && stored.startWeek > 0) out.startWeek = stored.startWeek;
  if (Number.isInteger(stored?.endWeek)   && stored.endWeek   > 0) out.endWeek   = stored.endWeek;
  return out;
}
function mergeTerm(stored, fallback) {
  return {
    main:   mergeRange(stored?.main,   fallback.main),
    summer: mergeRange(stored?.summer, fallback.summer),
  };
}
function mergeWithDefaults(stored) {
  if (!stored || typeof stored !== 'object') return DEFAULT_POLICY;
  return {
    lateRegistration: mergeTerm(stored.lateRegistration, DEFAULT_POLICY.lateRegistration),
    addDrop:          mergeTerm(stored.addDrop,          DEFAULT_POLICY.addDrop),
    withdrawal:       mergeTerm(stored.withdrawal,       DEFAULT_POLICY.withdrawal),
  };
}

// ── Loader ──────────────────────────────────────────────────────────────────

/**
 * Read the active windows policy from SystemSettings; falls back to
 * DEFAULT_POLICY when the column is null or DB is unreachable. Uses
 * $queryRaw so the call works pre-`prisma generate` (Windows DLL lock).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 */
async function getWindowsPolicy(prisma) {
  try {
    const rows = await prisma.$queryRaw`SELECT windows_policy AS policy FROM system_settings LIMIT 1`;
    const stored = rows?.[0]?.policy;
    if (stored) return mergeWithDefaults(stored);
  } catch {
    // Column missing or DB unavailable — fall through.
  }
  return DEFAULT_POLICY;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the period name / type indicates a Summer term.
 * RegistrationPeriod has `semester` and `type` fields — both can hint.
 */
function isSummerPeriod(period) {
  if (!period) return false;
  const s = `${period.semester || ''} ${period.type || ''} ${period.name || ''}`.toLowerCase();
  return /summer/.test(s);
}

/**
 * Resolve a single named window (`'lateRegistration' | 'addDrop' | 'withdrawal'`)
 * to concrete `{ start, end, isOpen }` Date objects, anchored to the active
 * RegistrationPeriod's startDate.
 *
 * @param {{startDate: Date|string, semester?: string, type?: string, name?: string}} period
 * @param {object} policy   full windows policy (use getWindowsPolicy first)
 * @param {'lateRegistration'|'addDrop'|'withdrawal'} kind
 * @param {Date} [today]    defaults to now
 * @returns {{ start: Date, end: Date, isOpen: boolean }}
 */
function resolveWindow(period, policy, kind, today = new Date()) {
  const term = isSummerPeriod(period) ? 'summer' : 'main';
  const range = policy?.[kind]?.[term] ?? DEFAULT_POLICY[kind][term];
  const periodStart = new Date(period.startDate);
  const start = new Date(periodStart.getTime() + (range.startWeek - 1) * 7 * 24 * 60 * 60 * 1000);
  // End is end-of-day on the last day of the endWeek — `endWeek` is INCLUSIVE,
  // so we add endWeek×7 days minus 1ms to land on the last instant of that week.
  const end = new Date(periodStart.getTime() + range.endWeek * 7 * 24 * 60 * 60 * 1000 - 1);
  const t = today.getTime();
  return { start, end, isOpen: t >= start.getTime() && t <= end.getTime() };
}

/**
 * Pick the SINGLE window that applies right now in priority order:
 *   late registration → add/drop → withdrawal.
 *
 * Returns:
 *   'register'   — inside the period, BEFORE the late-registration window
 *                  starts (i.e. week 1 / pre-semester registration).
 *   'late'       — inside the lateRegistration window.
 *   'add_drop'   — inside the addDrop window.
 *   'withdrawal' — inside the withdrawal window.
 *   'closed'     — outside the period, OR inside the period but past the
 *                  last configured window (e.g. weeks 13+ of the semester).
 */
function getCurrentWindow(period, policy, today = new Date()) {
  if (!period) return 'closed';
  const t = today.getTime();
  const periodStart = new Date(period.startDate).getTime();
  const periodEnd   = new Date(period.endDate).getTime();
  // Outside the registration period entirely.
  if (t < periodStart || t > periodEnd) return 'closed';

  const late       = resolveWindow(period, policy, 'lateRegistration', today);
  const addDrop    = resolveWindow(period, policy, 'addDrop',          today);
  const withdrawal = resolveWindow(period, policy, 'withdrawal',       today);

  if (late.isOpen)       return 'late';
  if (addDrop.isOpen)    return 'add_drop';
  if (withdrawal.isOpen) return 'withdrawal';

  // No specific window is open. If we're BEFORE the earliest window starts,
  // we're in the regular registration phase (week 1 etc.). After the last
  // window ends, return 'closed' — there's nothing meaningful a student can
  // do action-wise, even though the course is still running.
  const earliestStart = Math.min(
    late.start.getTime(),
    addDrop.start.getTime(),
    withdrawal.start.getTime(),
  );
  if (t < earliestStart) return 'register';
  return 'closed';
}

/**
 * Throw an AppError when the requested action's window is closed. Used by
 * registration / drop / withdraw handlers as the gate. Caller is expected to
 * have looked up the active period and the policy already.
 *
 * `kind`: the window the action requires to be OPEN.
 *
 * @param {string} action      human-readable action name for the error
 * @param {'lateRegistration'|'addDrop'|'withdrawal'} kind
 * @param {object} period
 * @param {object} policy
 * @param {Date} [today]
 */
function enforceWindow(action, kind, period, policy, today = new Date()) {
  const { start, end, isOpen } = resolveWindow(period, policy, kind, today);
  if (isOpen) return;
  const fmt = (d) => d.toISOString().slice(0, 10);
  const msg = today.getTime() < start.getTime()
    ? `${action} not open yet — opens ${fmt(start)}`
    : `${action} window closed — ended ${fmt(end)}`;
  const err = new Error(msg);
  err.statusCode = 403;
  err.details = { window: kind, opensAt: start.toISOString(), closesAt: end.toISOString() };
  throw err;
}

module.exports = {
  DEFAULT_POLICY,
  windowsPolicySchema,
  getWindowsPolicy,
  isSummerPeriod,
  resolveWindow,
  getCurrentWindow,
  enforceWindow,
};
