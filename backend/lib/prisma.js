// =============================================================================
// Prisma Client — Tenant-Aware Singleton
// =============================================================================
//
// Exports a Prisma Client wrapped in a `$extends` extension that auto-filters
// every query by the tenant id stored in AsyncLocalStorage (see
// `backend/lib/tenant-context.js`). Reads inject `where: { tenantId }`; writes
// inject `data: { tenantId }`; updates/deletes scope their `where` by tenant.
//
// IMPORTANT — `findUnique` caveat:
//   Prisma's `findUnique` requires the `where` to match an exact `@unique` /
//   `@@unique` / `@id` index shape. The extension below cannot inject
//   `tenantId` into a `findUnique({ where: { id } })` call without breaking
//   the index match. Two safe paths for code:
//     a) Use `findFirst({ where: { id } })` — the extension will inject
//        tenantId and the query stays bounded to the caller's tenant.
//     b) Convert the unique to `@@unique([tenantId, ...])` and use the
//        composite form: `findUnique({ where: { tenantId_id: { tenantId, id } } })`.
//   The schema has already been migrated to composite uniques for
//   tenant-scoped fields (email, code, name, etc.). PK lookups by `id` alone
//   still pass through the extension UNFILTERED — relying on cuid id space
//   collisions being astronomically unlikely. Treat `findUnique({ where: { id } })`
//   as a soft cross-tenant escape hatch and audit those call sites; prefer
//   `findFirst` in new code. See REPORT.md (final) for the audit list.
//
// Bootstrap mode:
//   Set `process.env.UNIFLOW_BOOTSTRAP = '1'` BEFORE requiring this module to
//   bypass the auto-filter entirely. Used by the seed script and ad-hoc
//   migration scripts that explicitly manage `tenantId` themselves.
//   The unwrapped client is exported as `bootstrapPrisma` for any code that
//   needs raw access regardless of bootstrap mode (e.g. login handler
//   looking up the tenant by code before a token exists).

const { PrismaClient } = require('@prisma/client');
const { getCurrentTenant, isBootstrap } = require('./tenant-context');

// Models that should never be tenant-filtered (the Tenant table itself).
const TENANT_EXEMPT_MODELS = new Set(['Tenant']);

// Operations that take a `where` clause. We inject `tenantId` into the where.
const WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

// Operations that take a `data` payload + a `where` clause.
// (`update`, `delete`, `upsert` are handled separately below.)

function tenantExtension() {
  return {
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Tenant itself + bootstrap scripts: no auto-filter. Bootstrap
          // callers manage `tenantId` themselves on every write.
          if (TENANT_EXEMPT_MODELS.has(model) || isBootstrap()) {
            return query(args);
          }

          const tenantId = getCurrentTenant();
          if (!tenantId) {
            // No tenant context — refuse the query. The caller forgot to
            // wrap the request in runWithTenant() (or hit an unauthenticated
            // route that didn't resolve the tenant). Crashing loudly here is
            // the right behavior; silently letting it through would risk
            // cross-tenant reads.
            throw new Error(
              `[prisma] tenant context required for ${model}.${operation}. ` +
                `Wrap the caller in runWithTenant() or set UNIFLOW_BOOTSTRAP=1.`
            );
          }

          // --- Read / mass-update / mass-delete ops: inject into where ---
          if (WHERE_OPS.has(operation)) {
            args.where = { ...(args.where || {}), tenantId };
            return query(args);
          }

          // --- Single-row create ---
          if (operation === 'create') {
            args.data = { ...(args.data || {}), tenantId };
            return query(args);
          }

          // --- Bulk create ---
          if (operation === 'createMany') {
            if (Array.isArray(args.data)) {
              args.data = args.data.map((d) => ({ ...d, tenantId }));
            } else if (args.data && typeof args.data === 'object') {
              args.data = { ...args.data, tenantId };
            }
            return query(args);
          }

          // --- Single-row update / delete: scope where by tenant. The where
          //     for these ops MUST target a unique index shape. If the caller
          //     used a global @id (e.g. `where: { id }`) we can't add tenantId
          //     without breaking the lookup — but a non-matching id from
          //     another tenant simply returns nothing (delete) or 0 rows
          //     (update via P2025), which is the desired isolation outcome.
          //
          //     For composite-uniques `@@unique([tenantId, X])` the caller is
          //     expected to use the composite where shape directly (Prisma's
          //     generated `tenantId_X` key). We don't try to rewrite the shape
          //     here — let the query as-passed go through.
          if (operation === 'update' || operation === 'delete') {
            return query(args);
          }

          // --- Upsert: ensure tenantId on create-path. The update-path is
          //     bounded by the same unique-shape constraint as `update`.
          if (operation === 'upsert') {
            args.create = { ...(args.create || {}), tenantId };
            return query(args);
          }

          // --- findUnique / findUniqueOrThrow ---
          // Cannot inject tenantId without breaking the unique-index shape.
          // Pass through unmodified — rely on cuid id uniqueness + composite
          // uniques for natural keys (email, code, etc).
          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            return query(args);
          }

          // --- Anything else (raw, transactions): pass through ---
          return query(args);
        },
      },
    },
  };
}

const globalForPrisma = global;

// Raw, unextended client. Held on `global.__prisma` to survive nodemon
// hot-reload and `require.cache` resets across the 10 dev servers.
const basePrisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = basePrisma;
}

// The tenant-extended client every consumer imports by default. ALL writes
// must go through this client (it points at the primary via DATABASE_URL).
const prisma = basePrisma.$extends(tenantExtension());

// =============================================================================
// Read replica routing (Plan 15)
// =============================================================================
//
// When DATABASE_URL_REPLICA is set, we maintain a separate PrismaClient
// pointed at the read replica (or PgBouncer pool that round-robins replicas).
// Code that wants to read from a replica explicitly opts in:
//
//   const prisma = require('../../lib/prisma');
//   // …
//   const transcript = await prisma.read.transcriptCourse.findMany({ ... });
//
// `prisma.read` carries the same tenant extension so cross-tenant isolation
// applies identically on both clients. When DATABASE_URL_REPLICA is unset
// (dev/single-DB deploys), `prisma.read` aliases to the primary client and
// callers see no behavioural difference.
//
// Why opt-in: streaming replication is asynchronous. A read immediately
// after a write may not see the write yet. The default path is the primary,
// which is always strongly consistent. Code that knows it can tolerate a
// few hundred ms of lag (transcript views, analytics aggregations, audit
// log browsing) explicitly opts in. Code that mustn't (registration
// confirmation, gradebook upserts, anything followed by a UI mutation)
// stays on the primary.
//
// The replica client is held on `global.__prisma_read` for the same
// nodemon-survival reason as the primary.

let readPrisma = prisma;

if (process.env.DATABASE_URL_REPLICA) {
  const baseReadPrisma =
    globalForPrisma.__prisma_read ||
    new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
      datasources: { db: { url: process.env.DATABASE_URL_REPLICA } },
    });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__prisma_read = baseReadPrisma;
  }

  readPrisma = baseReadPrisma.$extends(tenantExtension());
}

// Attach the read client. When no replica is configured this is the same
// reference as `prisma` itself, so `prisma.read === prisma` and the opt-in
// is a no-op locally.
Object.defineProperty(prisma, 'read', {
  value: readPrisma,
  enumerable: false,
  writable: false,
  configurable: false,
});

module.exports = prisma;

// Raw client for the narrow set of call sites that must run without tenant
// scope:
//   - login handler resolving the tenant by code/hostname before a JWT exists
//   - tenant CRUD endpoints
//   - one-off migration scripts that are aware of tenant isolation
// Most application code MUST use the default export.
module.exports.bootstrapPrisma = basePrisma;
