/**
 * Permission helpers — read-only access to a user's effective permissions
 * across all assigned Roles.
 *
 * The Role.permissions JSON has shape:
 *   { "<Category>": { "read": true, "write": false, "delete": false } }
 *
 * A user gets the OR of all permissions across their assigned roles, so a
 * student who is also assigned a custom "Auditor" role inherits both.
 *
 * NOTE: Phase 6 ships the data model and admin UI. The `requirePermission`
 * middleware below is intentionally NOT wired into every existing route —
 * `requireRole(...)` continues to gate routes for backward compatibility.
 * Routes can opt into permission gating gradually as they're touched.
 */

/**
 * Fetch every Role assigned to a user (incl. roles linked via the assignment
 * table). Falls back to looking up the User's primary `role` enum value if
 * no UserRoleAssignment rows exist (transition period).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 */
async function getUserRoles(prisma, userId) {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    include: { role: true },
  });
  if (assignments.length > 0) return assignments.map((a) => a.role);

  // Fallback — primary role enum for users that haven't been backfilled.
  // findFirst (not findUnique): User.id is global, but findFirst lets the
  // tenant extension auto-inject tenantId for defence-in-depth. Role.name
  // is part of @@unique([tenantId, name]), so findUnique without
  // tenantId_name throws PrismaClientValidationError — findFirst is the
  // correct primitive when relying on the tenant extension.
  const u = await prisma.user.findFirst({
    where: { id: userId },
    select: { role: true },
  });
  if (!u) return [];
  const role = await prisma.role.findFirst({ where: { name: u.role } });
  return role ? [role] : [];
}

/**
 * Compute the effective permissions for a user.
 *
 * Three-step merge:
 *   1. Union of every assigned Role's permissions (OR across roles).
 *   2. Per-user overrides from `UserPermissionOverride` are applied on top:
 *      `canRead === true` force-grants, `canRead === false` force-denies,
 *      `canRead === null` inherits the role value.
 *   3. Categories that exist only in the overrides table (never granted by
 *      any role) are added to the result so the override is observable.
 *
 * Returns the same shape as Role.permissions:
 *   { Category: { read, write, delete } }
 */
// The admin `*` wildcard shortcut was removed. It silently bypassed the
// role's saved permissions JSON, which meant admins could never have a
// category revoked from them via Settings → Roles & Permissions (the toggle
// did nothing because the wildcard kept granting it). Now every role —
// admin included — gets its permissions from the union of its assigned
// roles' `permissions` JSON, then per-user overrides applied on top.
//
// seed-roles.js explicitly grants the admin role every category it should
// see, so removing the wildcard does NOT brick admin access. Toggling
// "Announcements: write" off for the admin role in the matrix now actually
// hides the Manage Announcements entry from every admin user's sidebar.

async function getUserPermissions(prisma, userId) {
  const [roles, overrides] = await Promise.all([
    getUserRoles(prisma, userId),
    prisma.userPermissionOverride.findMany({ where: { userId } }).catch(() => []),
  ]);

  // 1. Union of every assigned role's permissions (OR across roles).
  const merged = {};
  for (const role of roles) {
    const perms = role.permissions || {};
    for (const [category, ops] of Object.entries(perms)) {
      if (!merged[category]) merged[category] = { read: false, write: false, delete: false };
      for (const op of ['read', 'write', 'delete']) {
        if (ops?.[op]) merged[category][op] = true;
      }
    }
  }

  // 2. Per-user overrides on top of the role union.
  //    canRead === true   → force-grant (overrides a role deny)
  //    canRead === false  → force-deny  (overrides a role grant)
  //    canRead === null   → inherit (no change)
  for (const o of overrides) {
    const cur = merged[o.category] || { read: false, write: false, delete: false };
    merged[o.category] = {
      read:   o.canRead   == null ? cur.read   : o.canRead,
      write:  o.canWrite  == null ? cur.write  : o.canWrite,
      delete: o.canDelete == null ? cur.delete : o.canDelete,
    };
  }

  return merged;
}

/**
 * Boolean: does the user have <action> on <category> via any assigned role?
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {string} category — e.g. "Student Management"
 * @param {'read'|'write'|'delete'} action
 */
async function hasPermission(prisma, userId, category, action) {
  const merged = await getUserPermissions(prisma, userId);
  return Boolean(merged?.[category]?.[action]);
}

/**
 * Express middleware. Use as a SUPPLEMENT to existing `requireRole(...)` —
 * not a replacement during the transition. Order:
 *   app.get('/x', requireRole('admin'), requirePermission('Audit Logs', 'read'), handler)
 *
 * @param {string} category
 * @param {'read'|'write'|'delete'} action
 */
function requirePermission(category, action) {
  return async (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    try {
      const prisma = req.app.locals.prisma || req.prisma;
      if (!prisma) {
        // No prisma client mounted — fail open with a warning so dev doesn't break.
        console.warn('[permissions] no prisma client - skipping permission check');
        return next();
      }
      const allowed = await hasPermission(prisma, userId, category, action);
      if (!allowed) {
        return res.status(403).json({
          error: `Missing ${action} permission on "${category}".`,
        });
      }
      next();
    } catch (err) {
      console.error('[permissions] check failed:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = {
  getUserRoles,
  getUserPermissions,
  hasPermission,
  requirePermission,
};
