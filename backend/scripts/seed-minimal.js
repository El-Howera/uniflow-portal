/**
 * UniFlow — Minimal seed
 *
 * Creates ONE user per role + the FCDS tenant + role permission matrix.
 * Nothing else. No courses, no sections, no invoices, no announcements,
 * no chat groups, no transcripts. Perfect for a fresh deploy where the
 * admin will manually populate the institution.
 *
 * Usage:
 *   node backend/scripts/seed-minimal.js
 *
 * Default credentials (all): Password123!
 * Users created (all in tenant `fcds`):
 *   - Elhowera@gmail.com           role=student   (the owner)
 *   - professor@uniflow.test       role=professor
 *   - ta@uniflow.test              role=ta
 *   - sa@uniflow.test              role=sa
 *   - admin@uniflow.test           role=admin
 *   - financial@uniflow.test       role=financial
 *   - it@uniflow.test              role=it
 *
 * The Tenant row is required for login (multi-tenant schema). The Role rows
 * are required for the permission cache lookup. seed-roles.js is spawned at
 * the end to build the canonical role-permission matrix + UserRoleAssignment
 * rows — exactly the same primitive used by the full seed.
 */

'use strict';

const { spawnSync } = require('child_process');
const path          = require('path');
const bcrypt        = require('bcryptjs');

// IMPORTANT: bootstrap mode required for Tenant create (Tenant model is
// exempt from the tenant extension's auto-injection). Without UNIFLOW_BOOTSTRAP
// the Prisma extension throws "tenant context required" on the tenant.create.
process.env.UNIFLOW_BOOTSTRAP = '1';

const prismaModule          = require('../lib/prisma');
const prisma                = prismaModule;            // tenant-extended client (auto-injects tenantId)
const { bootstrapPrisma }   = prismaModule;            // raw client for Tenant model + cross-tenant work
const { runWithTenant }     = require('../lib/tenant-context');

const PASSWORD       = 'Password123!';
const HASH           = bcrypt.hashSync(PASSWORD, 10);
const TENANT_CODE    = 'fcds';

const USERS = [
  // The owner. Email stored lowercase — login does `email.toLowerCase()`
  // before looking up by the (tenantId, email) composite unique. The
  // display name is preserved in firstName/lastName for the UI.
  {
    role: 'student',
    email: 'elhowera@gmail.com',
    firstName: 'Elfares',
    lastName: 'Howera',
    odId: 'FCDS20260001',
  },
  { role: 'professor', email: 'professor@uniflow.test', firstName: 'Demo', lastName: 'Professor', odId: 'FCDS-P-0001' },
  { role: 'ta',        email: 'ta@uniflow.test',        firstName: 'Demo', lastName: 'TA',        odId: 'FCDS-T-0001' },
  { role: 'sa',        email: 'sa@uniflow.test',        firstName: 'Demo', lastName: 'StudentAffairs', odId: 'FCDS-SA-0001' },
  { role: 'admin',     email: 'admin@uniflow.test',     firstName: 'Demo', lastName: 'Admin',     odId: 'FCDS-A-0001' },
  { role: 'financial', email: 'financial@uniflow.test', firstName: 'Demo', lastName: 'Financial', odId: 'FCDS-F-0001' },
  { role: 'it',        email: 'it@uniflow.test',        firstName: 'Demo', lastName: 'IT',        odId: 'FCDS-IT-0001' },
];

async function main() {
  console.log('');
  console.log('🌱 UniFlow MINIMAL Seed — only tenant + 1 user per role');
  console.log('');

  // ─── 1. Tenant (bootstrap; bypasses tenant extension) ──────────────────────
  console.log(`▸ Tenant: ${TENANT_CODE}`);
  const tenant = await bootstrapPrisma.tenant.upsert({
    where:  { code: TENANT_CODE },
    update: { name: 'UniFlow', shortName: 'UniFlow', isActive: true },
    create: { code: TENANT_CODE, name: 'UniFlow', shortName: 'UniFlow', isActive: true },
  });
  console.log(`  tenant.id = ${tenant.id}`);

  // ─── 2. Users (all inside the tenant scope) ────────────────────────────────
  // We exit bootstrap mode so the tenant extension auto-injects tenantId on
  // user creates. Without this, prisma.user.create would also need bootstrap.
  delete process.env.UNIFLOW_BOOTSTRAP;

  console.log('');
  console.log('▸ Users');
  await runWithTenant(tenant.id, async () => {
    for (const u of USERS) {
      const created = await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
        // Update existing row to clear soft-delete + suspension state, ensuring
        // re-seeds always produce a working login.
        update: {
          firstName: u.firstName,
          lastName:  u.lastName,
          odId:      u.odId,
          role:      u.role,
          status:    'Active',
          activated: true,
          emailVerified: true,
          deletedAt: null,
          suspendedAt: null,
          suspendedReason: null,
          password:  HASH,
        },
        create: {
          email:     u.email,
          firstName: u.firstName,
          lastName:  u.lastName,
          odId:      u.odId,
          role:      u.role,
          password:  HASH,
          status:    'Active',
          activated: true,
          emailVerified: true,
        },
      });
      console.log(`  ✓ ${u.role.padEnd(10)} → ${u.email.padEnd(34)} (id=${created.id.slice(0, 14)}…)`);
    }
  });

  console.log('');
  console.log('▸ Roles + permissions (delegating to seed-roles.js)');
  // seed-roles.js handles: Role table upserts, permission matrix sanitization,
  // UserRoleAssignment backfill. We spawn it as a subprocess to reuse the
  // exact same logic the full seed uses (avoids drift).
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'seed-roles.js')],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`seed-roles.js exited with code ${result.status}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ MINIMAL SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Sign in with any of these accounts (all password: Password123!):');
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(10)} → ${u.email}`);
  }
  console.log('');
  console.log('Owner account:   Elhowera@gmail.com (role=student)');
  console.log('Default tenant:  fcds');
  console.log('');
}

main()
  .catch((err) => {
    console.error('[seed-minimal] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await prisma.$disconnect(); }          catch { /* tolerate disconnect errors */ }
    try { await bootstrapPrisma.$disconnect(); } catch { /* ditto */ }
  });
