/**
 * Seed/backfill the 5 system roles and assign them to every existing user.
 *
 * Idempotent — safe to re-run. The seed is ADDITIVE on existing roles:
 *   - Categories not yet on the role are added with the role-specific default.
 *   - Categories already present are preserved as-is (admin edits are sacred).
 * This means re-running the seed after extending PERMISSION_CATEGORY_CATALOG
 * fills in the gaps without rewriting anyone's saved permission sets.
 *
 * Usage: node backend/scripts/seed-roles.js
 */

// Use the tenant-extended client so role.upsert / role.findFirst / etc. honour
// the AsyncLocalStorage tenant scope automatically. `bootstrapPrisma` is the
// raw client used to enumerate tenants up-front (Tenant model is exempt from
// the extension's auto-tenant injection).
const prismaModule = require('../lib/prisma');
const prisma = prismaModule;
const { bootstrapPrisma } = prismaModule;
const { runWithTenant } = require('../lib/tenant-context');

// Catalog of every permission category the system understands, paired with:
//   - surfaces: which UI/API areas the permission gates
//   - supports: which ops the backend actually implements (read-only
//     categories like Audit Logs only support `read`)
// Mirrors the frontend PERMISSION_CATEGORY_CATALOG in Settings.tsx — keep
// them in sync.
const CATEGORY_META = {
  'Student Management':   { surfaces: ['admin', 'sa'],                       supports: { read: true, write: true,  delete: true  } },
  'Faculty Management':   { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  'Course Management':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  'Course Catalog':       { surfaces: ['student'],                           supports: { read: true, write: false, delete: false } },
  'Registration':         { surfaces: ['student'],                           supports: { read: true, write: true,  delete: false } },
  'Financial Management': { surfaces: ['admin', 'sa'],                       supports: { read: true, write: true,  delete: true  } },
  'Payments':             { surfaces: ['student'],                           supports: { read: true, write: true,  delete: false } },
  'Analytics Dashboard':  { surfaces: ['admin'],                             supports: { read: true, write: false, delete: false } },
  'Announcements':        { surfaces: ['admin', 'sa', 'staff', 'student'],   supports: { read: true, write: true,  delete: true  } },
  'System Settings':      { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Academic Settings':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  // Plan 4 follow-up — fine-grained categories for the new admin pages.
  'Graduation Policy':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Semester Calendar':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Departments':          { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  // Plan 4 Phase 3 — registration / add-drop / withdrawal windows.
  'Registration Windows': { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  // Plan 4 Phase 4 — incomplete grade + repetition policies.
  'Incomplete Policy':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Repetition Policy':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  // Plan 4 Phase 5 — graduation honors policy.
  'Honors Policy':        { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  // Plan 4 Phase 6 — enrollment workflows (suspension/cancellation/prog change).
  'Enrollment Workflows': { surfaces: ['admin', 'sa'],                       supports: { read: true, write: true,  delete: false } },
  // Plan 4 Phase 7 — mobility / exchange + auditor enrollments.
  'Mobility Policy':      { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'External Credits':     { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  'Auditors':             { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  // Plan 4 Phase 8 — academic advisor approval gate.
  'Advisor Policy':       { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Advisees':             { surfaces: ['staff'],                             supports: { read: true, write: true,  delete: false } },
  // Plan 4 Phase 9 — credit-hour definition (Article 6).
  'Credit Hour Definition': { surfaces: ['admin'],                           supports: { read: true, write: true,  delete: false } },
  'Audit Logs':           { surfaces: ['admin'],                             supports: { read: true, write: false, delete: false } },
  'Grading':              { surfaces: ['staff', 'admin'],                    supports: { read: true, write: true,  delete: false } },
  'Attendance':           { surfaces: ['staff', 'admin', 'sa', 'student'],  supports: { read: true, write: true,  delete: false } },
  'Materials':            { surfaces: ['staff', 'student'],                  supports: { read: true, write: true,  delete: true  } },
  'Grades':               { surfaces: ['student'],                           supports: { read: true, write: false, delete: false } },
  'Complaints':           { surfaces: ['sa', 'admin', 'student'],            supports: { read: true, write: true,  delete: false } },
  'Name Change Requests': { surfaces: ['sa', 'admin'],                       supports: { read: true, write: true,  delete: false } },
  'Reports':              { surfaces: ['admin', 'sa', 'financial', 'it'],    supports: { read: true, write: false, delete: false } },
  // Plan 5 — admin power tool categories.
  'Sign-In Locks':        { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  'Manual Enrollment':    { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  'Per-User Permissions': { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  'Staff Chat':           { surfaces: ['admin', 'financial', 'it'],          supports: { read: true, write: true,  delete: false } },
  'Impersonation':        { surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
};

/** Drop unsupported ops from a permission entry. */
function sanitizeOps(ops, supports) {
  return {
    read:   supports.read   ? Boolean(ops?.read)   : false,
    write:  supports.write  ? Boolean(ops?.write)  : false,
    delete: supports.delete ? Boolean(ops?.delete) : false,
  };
}

// Map each system role to its surface. The matrix on the role only includes
// categories whose surfaces include the role's surface — irrelevant ones are
// hidden completely instead of cluttering the UI with dead entries.
//
// Plan 5 adds two admin sub-scope roles (Plan 22: `superuser` removed). They
// all sit on the 'admin' surface — each one gets a focused subset of admin's
// category list (see ROLE_OVERRIDES).
const ROLE_SURFACE = {
  admin:     'admin',
  financial: 'admin',
  it:        'admin',
  professor: 'staff',
  ta:        'staff',
  sa:        'sa',
  student:   'student',
};

// Plan 5 — Role.scope discriminator used by backend/lib/auth.js requireScope().
// Mirrors the SCOPE_INCLUSION map: admin is the implicit superset of the two
// admin sub-scopes. Custom roles fall back to 'custom'.
const ROLE_SCOPE = {
  admin:     'admin',
  financial: 'financial',
  it:        'it',
  professor: 'professor',
  ta:        'ta',
  sa:        'sa',
  student:   'student',
};

const blank = () => ({ read: false, write: false, delete: false });

// For each role, list the categories they should see ENABLED by default. Any
// category not listed here is included in the matrix but disabled — so admins
// see every option but a junior role doesn't accidentally start with broad
// access.
const ROLE_OVERRIDES = {
  admin: {
    'Student Management':   { read: true, write: true,  delete: true  },
    'Faculty Management':   { read: true, write: true,  delete: true  },
    'Course Management':    { read: true, write: true,  delete: true  },
    'Financial Management': { read: true, write: true,  delete: true  },
    'Analytics Dashboard':  { read: true, write: false, delete: false },
    'Announcements':        { read: true, write: true,  delete: true  },
    'System Settings':      { read: true, write: true,  delete: false },
    'Academic Settings':    { read: true, write: true,  delete: true  },
    // Plan 4 follow-up — fine-grained academic page categories.
    'Graduation Policy':    { read: true, write: true,  delete: false },
    'Semester Calendar':    { read: true, write: true,  delete: false },
    'Departments':          { read: true, write: true,  delete: true  },
    // Plan 4 Phase 3.
    'Registration Windows': { read: true, write: true,  delete: false },
    // Plan 4 Phase 4.
    'Incomplete Policy':    { read: true, write: true,  delete: false },
    'Repetition Policy':    { read: true, write: true,  delete: false },
    // Plan 4 Phase 5.
    'Honors Policy':        { read: true, write: true,  delete: false },
    // Plan 4 Phase 6 — admin sees the queue + sets the policy.
    'Enrollment Workflows': { read: true, write: true,  delete: false },
    // Plan 4 Phase 7.
    'Mobility Policy':      { read: true, write: true,  delete: false },
    'External Credits':     { read: true, write: true,  delete: true  },
    'Auditors':             { read: true, write: true,  delete: true  },
    // Plan 4 Phase 8.
    'Advisor Policy':       { read: true, write: true,  delete: false },
    // Plan 4 Phase 9.
    'Credit Hour Definition': { read: true, write: true, delete: false },
    'Audit Logs':           { read: true, write: false, delete: false },
    'Reports':              { read: true, write: false, delete: false },
    'Attendance':           { read: true, write: false, delete: false },
    'Grading':              { read: true, write: false, delete: false },
    'Complaints':           { read: true, write: true,  delete: false },
    'Name Change Requests': { read: true, write: true,  delete: false },
    // Plan 5 — admin power tools.
    'Sign-In Locks':        { read: true, write: true,  delete: true  },
    'Manual Enrollment':    { read: true, write: true,  delete: false },
    'Per-User Permissions': { read: true, write: true,  delete: true  },
    'Staff Chat':           { read: true, write: true,  delete: false },
    'Impersonation':        { read: true, write: true,  delete: false },
  },
  professor: {
    'Course Management': { read: true, write: false, delete: false },
    'Student Management': { read: true, write: false, delete: false },
    'Grading':           { read: true, write: true,  delete: false },
    'Attendance':        { read: true, write: true,  delete: false },
    'Materials':         { read: true, write: true,  delete: true  },
    'Announcements':     { read: true, write: true,  delete: true  },
    // Plan 4 Phase 8 — only professors flagged as advisors will see actual
    // advisees, but the menu entry is granted to every professor so they
    // can land on the page (which will show an empty queue otherwise).
    'Advisees':          { read: true, write: true,  delete: false },
  },
  ta: {
    'Course Management':  { read: true, write: false, delete: false },
    'Student Management': { read: true, write: false, delete: false },
    'Grading':            { read: true, write: true,  delete: false },
    'Attendance':         { read: true, write: true,  delete: false },
    'Materials':          { read: true, write: true,  delete: false },
  },
  sa: {
    'Student Management':   { read: true, write: true,  delete: true  },
    'Course Management':    { read: true, write: false, delete: false },
    'Financial Management': { read: true, write: true,  delete: false },
    'Financial Aid':        { read: true, write: true,  delete: false },
    'Announcements':        { read: true, write: true,  delete: true  },
    'Complaints':           { read: true, write: true,  delete: false },
    'Name Change Requests': { read: true, write: true,  delete: false },
    // Plan 4 Phase 6 — SA reviews enrollment workflow requests.
    'Enrollment Workflows': { read: true, write: true,  delete: false },
    // SA reviews student attendance excuses (Plan 9 follow-up).
    'Attendance':           { read: true, write: true,  delete: false },
    // SA consolidated student dossier search.
    'Reports':              { read: true, write: false, delete: false },
  },
  student: {
    'Course Catalog':  { read: true, write: false, delete: false },
    'Registration':    { read: true, write: true,  delete: false },
    'Materials':       { read: true, write: false, delete: false },
    'Grades':          { read: true, write: false, delete: false },
    'Payments':        { read: true, write: true,  delete: false },
    'Announcements':   { read: true, write: false, delete: false },
    // Extended surfaces — student views own attendance + files complaints.
    'Attendance':      { read: true, write: false, delete: false },
    'Complaints':      { read: true, write: true,  delete: false },
  },
  // Plan 5 admin sub-scopes (Plan 22: `superuser` removed — academic governance
  // is now wholly under the admin role). Each remaining sub-scope gets a
  // focused-remit category subset:
  //   - financial → money flow (financials, fees, payroll, invoices)
  //   - it        → operational tools (audit, system, roles, backups)
  // The Admin role retains the union (its overrides above still apply).
  financial: {
    'Financial Management': { read: true, write: true,  delete: true  },
    'Analytics Dashboard':  { read: true, write: false, delete: false },
    'Reports':              { read: true, write: false, delete: false },
    'Payroll':              { read: true, write: true,  delete: false },
    'Financial Aid':        { read: true, write: true,  delete: false },
    'Announcements':        { read: true, write: false, delete: false },
    'Staff Chat':           { read: true, write: true,  delete: false },
  },
  it: {
    'System Settings':      { read: true, write: true,  delete: false },
    'Audit Logs':           { read: true, write: false, delete: false },
    'Analytics Dashboard':  { read: true, write: false, delete: false },
    'Reports':              { read: true, write: false, delete: false },
    'Sign-In Locks':        { read: true, write: true,  delete: true  },
    'Per-User Permissions': { read: true, write: true,  delete: true  },
    'Announcements':        { read: true, write: false, delete: false },
    'Staff Chat':           { read: true, write: true,  delete: false },
  },
};

const DESCRIPTIONS = {
  admin:     'System administrator with full institutional access.',
  financial: 'Financial dashboard — fees, invoices, payroll, defaulters, financial reports.',
  it:        'IT dashboard — audit logs, system health, roles & permissions, backups, technical settings.',
  professor: 'Teaching faculty — courses, grades, attendance, materials.',
  ta:        'Teaching assistant — supports a course under a professor.',
  sa:        'Student affairs — manages requests, complaints, announcements.',
  student:   'Enrolled student — registration, attendance, payments, grades.',
};

/**
 * Build the default permission matrix for a role. Only includes categories
 * whose surfaces include the role's surface — admin doesn't see "Course
 * Catalog" (student-only), student doesn't see "System Settings" (admin-only),
 * etc. Each included category gets its role-specific override (sanitized
 * against the category's supported ops) or all-false.
 */
function buildDefaults(roleName) {
  const surface = ROLE_SURFACE[roleName];
  const overrides = ROLE_OVERRIDES[roleName] || {};
  const out = {};
  for (const [cat, meta] of Object.entries(CATEGORY_META)) {
    if (!surface || !meta.surfaces.includes(surface)) continue;
    out[cat] = sanitizeOps(overrides[cat] ?? blank(), meta.supports);
  }
  return out;
}

/**
 * Merge defaults INTO existing permissions:
 *   - Categories in defaults: keep stored values where the op is supported,
 *     otherwise drop. Unknown stored values are dropped entirely.
 *   - Categories stored but NOT in defaults: dropped (cleanup of off-surface
 *     entries from earlier seed runs that loaded everything).
 * This means re-running the seed adds new categories, prunes ones that no
 * longer belong on the role, AND strips ops that aren't backed by enforcement
 * (e.g. write/delete on Audit Logs).
 */
function mergeWithStored(stored, defaults) {
  const out = { ...defaults };
  if (stored && typeof stored === 'object') {
    for (const [cat, val] of Object.entries(stored)) {
      const meta = CATEGORY_META[cat];
      if (!(cat in defaults) || !meta || !val || typeof val !== 'object') continue;
      out[cat] = sanitizeOps(val, meta.supports);
    }
  }
  return out;
}

async function seedTenant(tenantId, tenantCode) {
  console.log(`\n[seed-roles] Tenant ${tenantCode} (${tenantId.slice(0, 12)}…)`);

  // 1. Pull legacy SystemSettings.rolePermissions JSON if any (one-time import).
  const settings = await prisma.systemSettings.findFirst({ select: { rolePermissions: true } });
  const legacy = settings?.rolePermissions || {};
  const aliasMap = {
    admin:     ['admin', 'Administrator'],
    professor: ['professor', 'Professor'],
    ta:        ['ta', 'Teaching Assistant', 'TA'],
    sa:        ['sa', 'Student Affairs', 'SA'],
    student:   ['student', 'Student'],
  };

  // 2. Upsert each system role with full-catalog defaults merged with anything stored.
  const roles = ['admin', 'financial', 'it', 'professor', 'ta', 'sa', 'student'];
  for (const name of roles) {
    const defaults = buildDefaults(name);

    // Look for an existing role row first. Composite `@@unique([tenantId, name])`
    // means we either use `findFirst` (extension auto-injects tenantId) or the
    // explicit `tenantId_name` compound key. `findFirst` is simpler.
    const existing = await prisma.role.findFirst({ where: { name } });

    let initialPermissions = defaults;
    if (existing?.permissions) {
      initialPermissions = mergeWithStored(existing.permissions, defaults);
    } else {
      // First-ever creation: import any legacy JSON for this role's name aliases.
      const aliases = aliasMap[name] || [];
      for (const alias of aliases) {
        if (legacy[alias]) {
          initialPermissions = mergeWithStored(legacy[alias], defaults);
          break;
        }
      }
    }

    const scope = ROLE_SCOPE[name] || 'custom';

    const role = await prisma.role.upsert({
      // Composite unique requires tenantId_name on the where clause.
      where: { tenantId_name: { tenantId, name } },
      update: { isSystem: true, permissions: initialPermissions, scope },
      create: {
        name,
        scope,
        description: DESCRIPTIONS[name],
        isSystem: true,
        permissions: initialPermissions,
      },
    });
    console.log(
      `  ✓ ${role.name.padEnd(10)} (${scope.padEnd(9)}) → ${Object.keys(initialPermissions).length} categories`
    );
  }

  // 3. Backfill UserRoleAssignment from User.role for any user without one.
  const allRoles = await prisma.role.findMany({ select: { id: true, name: true } });
  const roleByName = new Map(allRoles.map((r) => [r.name, r.id]));

  const users = await prisma.user.findMany({ select: { id: true, role: true, deletedAt: true } });
  let touched = 0;
  let skipped = 0;
  for (const u of users) {
    if (u.deletedAt) continue;
    const roleId = roleByName.get(u.role);
    if (!roleId) {
      skipped++;
      continue;
    }
    const result = await prisma.userRoleAssignment.upsert({
      where: { userId_roleId: { userId: u.id, roleId } },
      update: {},
      create: { userId: u.id, roleId },
    }).catch(() => null);
    if (result) touched++;
  }
  console.log(`  ✓ Assignments: ${touched} touched, ${skipped} skipped (unknown role).`);
}

async function main() {
  console.log('\n[seed-roles] Starting…');

  // Enumerate all tenants up-front (bootstrap mode — Tenant model is exempt
  // from the tenant extension). Then seed roles per-tenant inside runWithTenant.
  const tenants = await bootstrapPrisma.tenant.findMany({
    select: { id: true, code: true },
    orderBy: { createdAt: 'asc' },
  });
  if (tenants.length === 0) {
    console.warn('[seed-roles] No tenants found — run seed-minimal or seed first to create one.');
    return;
  }
  for (const t of tenants) {
    await runWithTenant(t.id, () => seedTenant(t.id, t.code));
  }
  console.log('\n[seed-roles] Done.\n');
}

main()
  .catch((err) => {
    console.error('[seed-roles] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
