// =============================================================================
// Tenant Resolver Middleware
// =============================================================================
//
// `requireAuth` in backend/lib/auth.js wraps authenticated requests in
// `runWithTenant(req.user.tenantId, ...)` so every downstream Prisma query is
// auto-filtered by tenant. But UNauthenticated routes — login, refresh,
// forgot-password, /api/public-settings, chatbot endpoints (when unauth'd),
// health checks — don't go through `requireAuth`, so any `prisma.*` call from
// those handlers will throw "tenant context required" because the extension
// can't find a tenant in AsyncLocalStorage.
//
// This middleware resolves the tenant for EVERY request (auth or not) and
// runs the request in `runWithTenant(...)`, so:
//   - Authenticated routes still get the JWT-claim-based tenant (via
//     requireAuth, which re-runs runWithTenant with the JWT value — harmless
//     because AsyncLocalStorage.run nests cleanly).
//   - Unauthenticated routes that touch Prisma now have a valid tenant scope
//     resolved from the request (header / subdomain / query / env default).
//
// Resolution order:
//   1. `X-Tenant-Code` HTTP header (explicit; API clients)
//   2. Subdomain of req.hostname (e.g. fcds.uniflow.app → 'fcds')
//   3. `?tenant=fcds` query param
//   4. DEFAULT_TENANT_CODE env var (falls back to 'fcds' for dev)
//
// Lookups are cached in-memory for 5 minutes to avoid hitting the DB on every
// request. `invalidateTenantCache(code?)` clears one entry or the whole map.

const { runWithTenant } = require('./tenant-context');
const { bootstrapPrisma } = require('./prisma');

const _tenantIdCache = new Map();
const TENANT_CACHE_TTL = 5 * 60 * 1000;

function readTenantCode(req) {
  // Header (most explicit) → subdomain → query → env default.
  const fromHeader = req.headers?.['x-tenant-code'];
  if (fromHeader) return String(fromHeader).toLowerCase().trim();

  const hostname = req.hostname || '';
  // Treat anything with at least 3 dot-separated parts as having a tenant
  // subdomain. Bare 'localhost' and IPv4 hosts skip this branch.
  if (hostname.includes('.') && !/^(localhost|\d+\.\d+\.\d+\.\d+)/i.test(hostname)) {
    const parts = hostname.split('.');
    if (parts.length >= 3 && parts[0] !== 'www') {
      return parts[0].toLowerCase().trim();
    }
  }

  const fromQuery = req.query?.tenant;
  if (fromQuery) return String(fromQuery).toLowerCase().trim();

  return (process.env.DEFAULT_TENANT_CODE || 'fcds').toLowerCase().trim();
}

// Same source-ordered resolver as auth.routes.js — when subdomain doesn't
// match a real tenant, fall through to env default. Used by tenantResolver
// middleware below so unauthenticated routes don't crash on `*.fly.dev`.
async function readTenantCodeWithFallback(req) {
  const tries = [];
  const fromHeader = req.headers?.['x-tenant-code'];
  if (fromHeader) tries.push({ code: String(fromHeader).toLowerCase().trim(), strict: true });

  const hostname = req.hostname || '';
  if (hostname.includes('.') && !/^(localhost|\d+\.\d+\.\d+\.\d+)/i.test(hostname)) {
    const parts = hostname.split('.');
    if (parts.length >= 3 && parts[0] !== 'www') {
      tries.push({ code: parts[0].toLowerCase().trim(), strict: false });
    }
  }
  const fromQuery = req.query?.tenant;
  if (fromQuery) tries.push({ code: String(fromQuery).toLowerCase().trim(), strict: true });

  tries.push({ code: (process.env.DEFAULT_TENANT_CODE || 'fcds').toLowerCase().trim(), strict: true });

  for (const { code, strict } of tries) {
    const id = await resolveTenantId(code);
    if (id) return { code, id };
    if (strict) return { code, id: null, strict: true };
    // non-strict: try next source
  }
  return { code: tries[tries.length - 1].code, id: null, strict: true };
}

async function resolveTenantId(code) {
  const cached = _tenantIdCache.get(code);
  if (cached && cached.expires > Date.now()) return cached.id;

  // bootstrapPrisma bypasses the tenant extension — required here because
  // we have no tenant scope yet (the very thing we're about to resolve).
  // The Tenant model is also in TENANT_EXEMPT_MODELS so even the extended
  // client would pass this through, but using the bootstrap client makes
  // the intent explicit and avoids any future change to the exempt list
  // affecting this path.
  const tenant = await bootstrapPrisma.tenant.findUnique({ where: { code } });
  if (!tenant || !tenant.isActive) return null;

  _tenantIdCache.set(code, { id: tenant.id, expires: Date.now() + TENANT_CACHE_TTL });
  return tenant.id;
}

/**
 * Express middleware: resolves tenant from request headers/subdomain/query/env
 * and runs the request inside a tenant context. Mount as one of the FIRST
 * middlewares (after cors/body-parser/cookie-parser) so every route handler
 * — authenticated or not — sees the context.
 *
 * Auth-gated requests still run `requireAuth` afterwards, which calls
 * `runWithTenant(req.user.tenantId, ...)` again — AsyncLocalStorage.run nests
 * cleanly and the JWT claim takes precedence inside the auth handler scope.
 *
 * @param {object} [options]
 * @param {boolean} [options.strict=false]  When true, refuse requests that
 *   don't resolve to a valid tenant with HTTP 404. When false (default), pass
 *   the request through without a tenant scope — appropriate for health checks
 *   and static-file routes that don't touch Prisma.
 */
function tenantResolver(options = {}) {
  const { strict = false } = options;
  return async (req, res, next) => {
    try {
      const { code, id: tenantId } = await readTenantCodeWithFallback(req);
      if (!tenantId) {
        if (strict) {
          return res.status(404).json({ error: 'unknown_tenant', code });
        }
        return next();
      }
      req.tenantCode = code;
      req.tenantId = tenantId;
      runWithTenant(tenantId, () => next());
    } catch (err) {
      console.error('[tenant-resolver]', err.message);
      if (strict) return res.status(500).json({ error: 'tenant_resolution_failed' });
      next();
    }
  };
}

function invalidateTenantCache(code) {
  if (code) _tenantIdCache.delete(code);
  else _tenantIdCache.clear();
}

module.exports = {
  tenantResolver,
  invalidateTenantCache,
  readTenantCode,
  resolveTenantId,
};
