/**
 * User resolution helper.
 * Accepts a userId that may be: a DB CUID, an email address, or an odId (od_id).
 * Returns the full User row or null.
 */

const prisma = require('./prisma');

/**
 * Resolve a user by id, email, or odId.
 * @param {string} idOrEmail
 * @returns {Promise<object|null>}
 */
async function resolveUser(idOrEmail) {
  if (!idOrEmail) return null;

  // Try CUID (starts with 'c' or similar, no '@')
  if (!idOrEmail.includes('@') && !idOrEmail.includes(' ')) {
    // `id` is a global @id — findUnique is fine here.
    const byId = await prisma.user.findUnique({ where: { id: idOrEmail } }).catch(() => null);
    if (byId) return byId;
    // `odId` is part of @@unique([tenantId, odId]) under multi-tenant — findUnique
    // requires the composite key shape. findFirst lets the tenant extension
    // auto-inject tenantId from the AsyncLocalStorage scope.
    const byOdId = await prisma.user.findFirst({ where: { odId: idOrEmail } }).catch(() => null);
    if (byOdId) return byOdId;
  }

  // Try email — case-insensitive. Without `mode: 'insensitive'` the
  // `findUnique` is a strict equality match against the DB row, which
  // misses "Prof1@uniflow.test" vs the stored "prof1@uniflow.test" and
  // surfaced as "Could not load roster" + 404s on the per-prof dashboard
  // endpoints. `findFirst` is the case-insensitive equivalent.
  const byEmail = await prisma.user
    .findFirst({ where: { email: { equals: idOrEmail, mode: 'insensitive' } } })
    .catch(() => null);
  return byEmail || null;
}

module.exports = { resolveUser };
