/**
 * BSSID-based location restriction helpers for the attendance service.
 *
 * Owns:
 *   - checkBssid(prisma, bssid, NODE_ENV, sessionBssidRequired, sessionValidBssids?):
 *     Validates whether the student's reported BSSID is a known campus
 *     location. Returns { ok, error?, errorCode?, verified }.
 *     Enforcement only fires in production AND when the session's own
 *     bssidRequired flag is not explicitly false.
 *
 *     When `sessionValidBssids` is a non-empty array, the submitted BSSID
 *     must match one of those values (hall-scoped: the session is anchored
 *     to its course section's hall). When empty/missing, falls back to the
 *     global BssidLocation table for backward-compat with legacy sessions
 *     created before the hall→attendance linkage landed.
 *
 * Note: There are no admin BSSID CRUD endpoints in this service. The
 * BssidLocation records are managed via the user-profile server's admin
 * surface. This module exists purely as the validation boundary so the
 * mark route stays thin.
 */

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string|undefined} bssid
 * @param {string} nodeEnv  process.env.NODE_ENV (or 'development' default)
 * @param {boolean|null|undefined} sessionBssidRequired
 * @param {string[]|null|undefined} sessionValidBssids  Per-session BSSID
 *   whitelist resolved from CourseSection.hallId at session-start time.
 *   When non-empty, isolates this session to its own hall (rejects BSSIDs
 *   from other halls even if they're registered in the global table).
 * @returns {{ ok: boolean, error?: string, errorCode?: string, verified: boolean }}
 */
async function checkBssid(prisma, bssid, nodeEnv, sessionBssidRequired, sessionValidBssids) {
  // In development, or when the session explicitly opts out, skip entirely.
  if (nodeEnv !== 'production' || sessionBssidRequired === false) {
    return { ok: true, verified: false };
  }

  if (!bssid) {
    return {
      ok: false,
      error: 'WiFi BSSID required for this session',
      errorCode: 'bssid_missing',
      verified: false,
    };
  }

  // Session-scoped enforcement: when the session carries its own hall BSSID
  // whitelist, the submitted BSSID must match one of those. This is the
  // post-Phase-1 hall isolation contract (Attendance Documentation §3.5.2).
  if (Array.isArray(sessionValidBssids) && sessionValidBssids.length > 0) {
    if (sessionValidBssids.includes(bssid)) {
      return { ok: true, verified: true };
    }
    return {
      ok: false,
      error: 'You are not in the correct hall for this session',
      errorCode: 'bssid_mismatch',
      verified: false,
    };
  }

  // Legacy fallback: pre-Phase-1 sessions have empty validBssids; check the
  // global table so already-running sessions keep working.
  const validLocation = await prisma.bssidLocation.findFirst({ where: { bssid } });
  if (!validLocation) {
    return {
      ok: false,
      error: 'Not connected to authorized campus WiFi',
      errorCode: 'bssid_unknown',
      verified: false,
    };
  }

  return { ok: true, verified: true };
}

module.exports = { checkBssid };
