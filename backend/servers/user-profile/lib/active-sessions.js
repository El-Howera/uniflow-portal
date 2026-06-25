/**
 * user-profile / lib / active-sessions.js
 *
 * Owns the in-process presence map used to track online users.
 *
 * This module exists as a deliberate separation from backend/lib/auth.js:
 *   - backend/lib/auth.js owns JWT verification (requireAuth / requireRole).
 *   - THIS file owns the markPresent() side effect that updates the presence
 *     map on every successful authentication.
 *
 * The inline authenticateToken in the original user-profile/index.js called
 * markPresent(user?.userId) inside the jwt.verify callback. That side effect
 * MUST be preserved here — it must NOT be dropped by simply swapping in
 * requireAuth from backend/lib/auth.js, which has no awareness of this map.
 *
 * Exports:
 *   markPresent(userId)                — record a heartbeat for a user
 *   getPresenceMap()                   — returns the live Map (for the active-sessions endpoint)
 *   ONLINE_WINDOW_MIN                  — window in minutes (3 min, slightly above 60s heartbeat)
 *
 * The authenticateToken middleware exported here is the local version that
 * performs JWT verification AND calls markPresent(). Route files MUST import
 * authenticateToken and requireScope/requireRole from this module, not from
 * backend/lib/auth.js, to preserve the side effect.
 *
 * Non-obvious decisions:
 *   - The map is cleared on server restart. This is intentional — clients
 *     re-establish presence on their next authenticated call.
 *   - The impersonation guard (mode==='view-as' blocks writes) is also
 *     preserved inside authenticateToken below, exactly as in the original.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { runWithTenant } = require('../../../lib/tenant-context');

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';

// ── Presence map ──────────────────────────────────────────────────────────────

/** In-memory map: userId → last-seen timestamp (epoch ms) */
const presence = new Map();

/** Duration after which a user is considered offline (3 min) */
const ONLINE_WINDOW_MIN = 3;

/**
 * Record a heartbeat for a user. Called on every successful auth check.
 * @param {string|undefined} userId
 */
const markPresent = (userId) => {
  if (userId) presence.set(userId, Date.now());
};

/**
 * Returns the live presence Map. The active-sessions endpoint reads this
 * directly; no copy is made to avoid allocating a second map on every poll.
 * @returns {Map<string, number>}
 */
const getPresenceMap = () => presence;

// ── Scope inclusion table (mirrors the original in index.js) ─────────────────

const SCOPE_INCLUSION = {
  admin:     ['admin', 'financial', 'it'],
  financial: ['financial'],
  it:        ['it'],
  professor: ['professor'],
  ta:        ['ta'],
  sa:        ['sa'],
  student:   ['student'],
};

// ── authenticateToken middleware ──────────────────────────────────────────────

/**
 * Express middleware — verifies JWT (cookie-first, then Authorization header),
 * records a presence heartbeat, guards against impersonation writes, and
 * re-establishes tenant scope in the AsyncLocalStorage.
 *
 * Mirrors the original inline authenticateToken from index.js exactly.
 */
const authenticateToken = (req, res, next) => {
  const cookieToken = req.cookies?.token;
  const headerToken = req.headers['authorization']?.startsWith('Bearer ')
    ? req.headers['authorization'].split(' ')[1]
    : null;
  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    markPresent(user?.userId);

    // Plan 5 Phase 6 — block writes during impersonation (mode='view-as').
    if (
      user?.mode === 'view-as' &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      req.path !== '/api/admin/sessions/impersonate/exit'
    ) {
      return res.status(403).json({
        error: 'impersonation_read_only',
        message: 'Writes are blocked during view-as session. Exit impersonation to make changes.',
      });
    }

    // Re-establish tenant scope from JWT claim.
    const tenantId = user?.tenantId;
    if (!tenantId) {
      return res.status(403).json({
        error: 'tenant_claim_missing',
        message: 'Your session predates the multi-tenant migration. Please log in again.',
      });
    }
    runWithTenant(tenantId, () => next());
  });
};

// ── requireRole factory ───────────────────────────────────────────────────────

/**
 * Role-gate factory. Composes authenticateToken so the silent-refresh
 * 401/403 split keeps working.
 * @param {...string} allowedRoles
 */
const requireRole = (...allowedRoles) => {
  const roles = allowedRoles.flat();
  return [
    authenticateToken,
    (req, res, next) => {
      if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    },
  ];
};

// ── requireScope factory ──────────────────────────────────────────────────────

/**
 * Scope-gate factory. Admin is the implicit superset of (financial, it).
 * @param {...string} scopes
 */
const requireScope = (...scopes) => {
  const allowed = scopes.flat();
  return [
    authenticateToken,
    (req, res, next) => {
      const role = req.user?.role;
      const inclusions = SCOPE_INCLUSION[role] || [role];
      const ok = inclusions.some((s) => allowed.includes(s));
      if (!ok) {
        return res.status(403).json({
          error: 'Insufficient scope',
          required: allowed,
          held: inclusions,
        });
      }
      next();
    },
  ];
};

module.exports = {
  markPresent,
  getPresenceMap,
  ONLINE_WINDOW_MIN,
  authenticateToken,
  requireRole,
  requireScope,
};
