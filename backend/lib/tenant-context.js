// =============================================================================
// Tenant Context (AsyncLocalStorage)
// =============================================================================
//
// Provides per-request tenant id storage that propagates automatically through
// every awaited call inside a Node async chain. The Prisma Client Extension in
// `backend/lib/prisma.js` reads this store on every query to auto-filter rows
// by `tenantId`, eliminating cross-tenant data leakage at the data-layer level.
//
// Flow:
//   1. `requireAuth` middleware extracts `tenantId` from the JWT claim and
//      calls `runWithTenant(tenantId, () => next())`.
//   2. Every downstream middleware + the route handler + every `await prisma.*`
//      call inside that handler has the tenant id available via
//      `getCurrentTenant()` — no plumbing required.
//   3. Bootstrap callers (login handler, tenant CRUD, seed scripts) resolve
//      the tenant from `req.hostname` / `X-Tenant-Code` header / query param
//      and wrap their critical section in `runWithTenant(...)`.
//
// Scripts that need to bypass tenant filtering (seed, migrations) should set
// `process.env.UNIFLOW_BOOTSTRAP = '1'` before requiring this module — the
// Prisma extension then no-ops the filter and trusts the script's explicit
// `tenantId` writes.

const { AsyncLocalStorage } = require('async_hooks');

const tenantContext = new AsyncLocalStorage();

/**
 * Run `fn` with `tenantId` bound to the current async context.
 * Every awaited call inside `fn` will see the same id via
 * `getCurrentTenant()`.
 *
 * @param {string} tenantId  Tenant.id (cuid). Required.
 * @param {() => any} fn     Function (sync or async) to run.
 */
function runWithTenant(tenantId, fn) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('runWithTenant: tenantId is required and must be a string');
  }
  return tenantContext.run({ tenantId }, fn);
}

/**
 * Returns the tenant id bound to the current async context, or `null`
 * when called outside a `runWithTenant` block (e.g. server startup, top
 * of a fresh Express request before middleware runs).
 *
 * Prefer `requireCurrentTenant()` when you genuinely require the value.
 */
function getCurrentTenant() {
  const store = tenantContext.getStore();
  return store ? store.tenantId : null;
}

/**
 * Returns the tenant id, throwing if absent.
 * Use inside business logic that must not run without a tenant scope.
 */
function requireCurrentTenant() {
  const id = getCurrentTenant();
  if (!id) {
    throw new Error(
      '[tenant-context] No tenant in scope. Wrap the caller in runWithTenant() ' +
        'or set UNIFLOW_BOOTSTRAP=1 for one-off scripts.'
    );
  }
  return id;
}

/**
 * Check if the current process is running in bootstrap mode (seed scripts,
 * migrations) — the Prisma extension uses this to bypass auto-filtering
 * and trust explicit `data.tenantId` writes from the caller.
 */
function isBootstrap() {
  return process.env.UNIFLOW_BOOTSTRAP === '1';
}

/**
 * Express middleware: restores the tenant scope from `req.user.tenantId`
 * (set by requireAuth) or `req.tenantId` (set by tenantResolver) if
 * the current AsyncLocalStorage scope is missing.
 *
 * WHY THIS EXISTS: AsyncLocalStorage propagation can be silently lost
 * across certain async boundaries. Common culprits:
 *   - `multer` parses multipart uploads using busboy's stream events;
 *     when busboy fires `finish` and calls `next()`, the AsyncLocalStorage
 *     context that was active when the request first entered the chain
 *     can be detached depending on Node version + libuv internals.
 *   - `jsonwebtoken.verify(token, secret, cb)` uses libuv worker threads
 *     for signature verification on some versions; the callback fires
 *     outside the original async scope.
 *   - Any third-party middleware that uses raw `setImmediate` without
 *     proper async_hooks integration.
 *
 * Mount this RIGHT BEFORE the asyncHandler on any route where the
 * tenant scope might be lost. Safe to mount everywhere — it's a no-op
 * when the scope is already present.
 */
function restoreTenantContext(req, res, next) {
  if (getCurrentTenant()) {
    // Scope intact — no-op.
    next();
    return;
  }
  const tenantId = req.user?.tenantId || req.tenantId;
  if (!tenantId) {
    // No way to restore — let the downstream handler decide (it'll throw
    // the "tenant context required" error from the Prisma extension,
    // which is the right failure mode).
    next();
    return;
  }
  runWithTenant(tenantId, () => next());
}

module.exports = {
  runWithTenant,
  getCurrentTenant,
  requireCurrentTenant,
  isBootstrap,
  restoreTenantContext,
};
