const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { runWithTenant } = require('./tenant-context');

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET env var not set - using insecure default. Set JWT_SECRET in .env before deploying.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function requireAuth(req, res, next) {
  // Prefer httpOnly cookie (XSS-safe); fall back to Authorization header for
  // multi-port dev (10 separate servers where browsers don't share cookies).
  const cookieToken = req.cookies?.token;
  const headerToken = req.headers['authorization']?.startsWith('Bearer ')
    ? req.headers['authorization'].split(' ')[1]
    : null;
  const token = cookieToken || headerToken;
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // TokenExpiredError → 401 so the silent-refresh interceptor (apiFetch) can retry
      // Other errors (bad signature, malformed) → 403, no refresh possible
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;

    // Plan 5 Phase 6 — block writes during view-as impersonation. The single
    // allowed write is the explicit exit endpoint so the admin can record the
    // session-end audit event.
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

    // Multi-tenant — every authenticated request runs inside an
    // AsyncLocalStorage scope bound to the JWT's `tenantId` claim. The
    // Prisma extension (backend/lib/prisma.js) reads this scope on every
    // query to enforce per-tenant data isolation. Tokens issued before the
    // multi-tenant migration won't have a `tenantId` claim — force them to
    // re-authenticate rather than silently allowing cross-tenant reads.
    const tenantId = user?.tenantId;
    if (!tenantId) {
      return res.status(403).json({
        error: 'tenant_claim_missing',
        message: 'Your session predates the multi-tenant migration. Please log in again.',
      });
    }
    runWithTenant(tenantId, () => next());
  });
}

function requireRole(...allowedRoles) {
  // Flatten so both requireRole('ta','admin') and requireRole(['ta','admin']) work
  const roles = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ============================================================================
// Plan 5 — Role-scope enforcement (Plan 22: superuser removed)
// ============================================================================
//
// Scopes split the existing Admin role into two focused-remit dashboards:
//   financial — money flow (fees, invoices, payroll, defaulters)
//   it        — operational tools (audit, system, roles, backups)
//
// Admin is the IMPLICIT SUPERSET — requireScope('financial') passes for an
// admin user. The other roles (professor/ta/sa/student) only match their own
// scope name.
//
// Note: the `superuser` sub-role was removed in Plan 22 (2026-05-26). Any
// legacy references to it in route files have been collapsed to admin scope.

const SCOPE_INCLUSION = {
  admin:     ['admin', 'financial', 'it'],
  financial: ['financial'],
  it:        ['it'],
  professor: ['professor'],
  ta:        ['ta'],
  sa:        ['sa'],
  student:   ['student'],
};

/**
 * Require the caller's role to include one of the listed scopes.
 * Admin is the implicit superset of (financial, it).
 */
function requireScope(...scopes) {
  const allowed = scopes.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const role = req.user.role;
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
  };
}

// ============================================================================
// Plan 5 — Per-user effective permissions (role ⊕ overrides)
// ============================================================================
//
// `getEffectivePermissions(prisma, userId, role)` returns the merged permission
// matrix for a user: role baseline overridden by `UserPermissionOverride` rows.
// Cached for 5 minutes per userId to keep the cost amortised across requests.
// Call `invalidatePermCache(userId)` when role / overrides change or on logout.
//
// Two-tier cache:
//   Tier 1: Redis (shared across processes; key uniflow:perm:<userId>, TTL 5m).
//   Tier 2: in-memory Map (per-process; serves as fallback when Redis is
//           unavailable AND as a 2nd cache so a Redis hiccup mid-request
//           doesn't force a DB round-trip).
// Both tiers are written on compute and cleared on invalidate.

const _redis = require('./redis');

const _permCache = new Map(); // userId -> { perms, expiresAt }
const PERM_CACHE_TTL_MS = 5 * 60 * 1000;
const PERM_CACHE_TTL_SEC = 5 * 60;

function _permCacheKey(userId) {
  return _redis.namespace('perm', userId);
}

async function getEffectivePermissions(prismaArg, userId, role) {
  // Tier 1: Redis.
  const fromRedis = await _redis.getJSON(_permCacheKey(userId));
  if (fromRedis) {
    // Warm the local Map too so subsequent same-process reads skip Redis.
    _permCache.set(userId, { perms: fromRedis, expiresAt: Date.now() + PERM_CACHE_TTL_MS });
    return fromRedis;
  }

  // Tier 2: in-memory Map.
  const cached = _permCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.perms;

  // 1. Role baseline. Role.name is part of composite @@unique([tenantId, name])
  //    so we use findFirst here — the Prisma tenant extension auto-injects
  //    tenantId from AsyncLocalStorage, scoping the lookup to the right tenant.
  const roleRow = await prismaArg.role.findFirst({ where: { name: role } }).catch(() => null);
  const base = (roleRow?.permissions && typeof roleRow.permissions === 'object') ? roleRow.permissions : {};

  // 2. User-level overrides. NULL means "inherit from role" — leave the
  //    corresponding op alone.
  const overrides = await prismaArg.userPermissionOverride.findMany({ where: { userId } }).catch(() => []);
  const merged = { ...base };
  for (const o of overrides) {
    const cur = merged[o.category] || { read: false, write: false, delete: false };
    merged[o.category] = {
      read:   o.canRead   == null ? cur.read   : o.canRead,
      write:  o.canWrite  == null ? cur.write  : o.canWrite,
      delete: o.canDelete == null ? cur.delete : o.canDelete,
    };
  }

  // Write through to both tiers. Redis write is best-effort (setJSON returns
  // false on failure but won't throw).
  _permCache.set(userId, { perms: merged, expiresAt: Date.now() + PERM_CACHE_TTL_MS });
  await _redis.setJSON(_permCacheKey(userId), merged, PERM_CACHE_TTL_SEC);
  return merged;
}

function invalidatePermCache(userId) {
  if (userId) {
    _permCache.delete(userId);
    // Fire-and-forget — the call-sites are sync and we don't want to
    // block them on a Redis round-trip. del() is fail-soft internally.
    _redis.del(_permCacheKey(userId)).catch(() => {});
  } else {
    _permCache.clear();
    _redis.delByPrefix(_redis.namespace('perm')).catch(() => {});
  }
}

/**
 * Require the caller to have `action` on `category`. Used for fine-grained
 * page-level gates (e.g. `requirePermission('Grade Override', 'write')`).
 */
function requirePermission(category, action /* 'read'|'write'|'delete' */) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    try {
      const prisma = require('./prisma');
      const perms = await getEffectivePermissions(prisma, req.user.userId, req.user.role);
      if (!perms?.[category]?.[action]) {
        return res.status(403).json({
          error: 'Permission denied',
          category,
          action,
        });
      }
      next();
    } catch (err) {
      console.error('[auth] requirePermission failed:', err.message);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// ============================================================================
// Plan 5 Phase 6 — Impersonation read-only guard
// ============================================================================
//
// When an admin uses "View as user", the JWT carries `mode: 'view-as'` and
// `impersonatorId`. We block every write under that token. Mount on POST/PUT/
// PATCH/DELETE routes.

function requireNoImpersonation(req, res, next) {
  if (req.user?.mode === 'view-as') {
    return res.status(403).json({
      error: 'impersonation_read_only',
      message: 'Writes are blocked during view-as session.',
    });
  }
  next();
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = {
  requireAuth,
  requireRole,
  requireScope,
  requirePermission,
  requireNoImpersonation,
  getEffectivePermissions,
  invalidatePermCache,
  signToken,
  verifyToken,
  hashPassword,
  comparePassword,
  JWT_SECRET,
  SCOPE_INCLUSION,
};
