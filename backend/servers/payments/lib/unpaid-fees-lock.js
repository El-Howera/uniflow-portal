/**
 * payments/lib/unpaid-fees-lock.js
 *
 * Automatic sign-in lock for students with overdue invoices. Two entry points:
 *
 *   scanAndCreateLocks(prisma)
 *     Cron entry point. Walks every tenant + every student with a non-paid
 *     invoice past `UNPAID_LOCK_GRACE_DAYS` (default 14) and creates a
 *     LoginLock row (targetKind='user', reason='unpaid_fees', isTimeWindow=false)
 *     if one doesn't already exist. Idempotent — re-running the cron is safe.
 *
 *   releaseLockIfBalanceClear(prisma, userId, tenantId)
 *     Webhook entry point. After a successful payment, checks whether the
 *     user still has any overdue invoices. If not, marks every active
 *     unpaid-fees lock for that user as released.
 *
 * The lock reason is the literal string 'unpaid_fees' so the admin UI can
 * filter on it without parsing free-text reasons (the Sign-In Locks page
 * Phase 2c).
 *
 * Tenant scope: scanAndCreateLocks runs OUTSIDE a tenant scope (cron has
 * none) and walks tenants explicitly, wrapping each tenant's work in
 * runWithTenant(). releaseLockIfBalanceClear assumes the caller has already
 * established a tenant scope (the webhook handler does this).
 */

'use strict';

const { runWithTenant } = require('../../../lib/tenant-context');

const LOCK_REASON = 'unpaid_fees';
const TARGET_KIND = 'user';

function graceDays() {
  const raw = process.env.UNPAID_LOCK_GRACE_DAYS;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return 14;
}

/**
 * Scans every tenant for students with overdue invoices and creates locks
 * for those that don't already have one. Returns a summary object for the
 * cron log line.
 */
async function scanAndCreateLocks(prisma) {
  const grace = graceDays();
  const cutoff = new Date(Date.now() - grace * 24 * 60 * 60 * 1000);

  const summary = { tenants: 0, scanned: 0, locked: 0, alreadyLocked: 0, errors: 0 };

  let tenants;
  try {
    // bootstrap query — Tenant model is exempt from the tenant extension.
    tenants = await prisma.tenant.findMany({ select: { id: true, code: true } });
  } catch (err) {
    console.error('[unpaid-lock] could not list tenants:', err.message);
    return { ...summary, errors: 1 };
  }

  for (const tenant of tenants) {
    summary.tenants += 1;
    try {
      await runWithTenant(tenant.id, async () => {
        // Find every student with an unpaid+overdue invoice. We group by
        // userId so each student only gets one lock even with multiple
        // overdue invoices.
        const overdue = await prisma.invoice.findMany({
          where: {
            dueDate: { lt: cutoff },
            balance: { gt: 0 },
            status:  { in: ['pending', 'partial', 'overdue'] },
          },
          select: { userId: true },
          distinct: ['userId'],
        });

        for (const row of overdue) {
          summary.scanned += 1;
          const userId = row.userId;

          // Skip if user already has an active unpaid-fees lock.
          const existing = await prisma.loginLock.findFirst({
            where: {
              targetKind: TARGET_KIND,
              targetId:   userId,
              reason:     LOCK_REASON,
              releasedAt: null,
            },
            select: { id: true },
          });
          if (existing) {
            summary.alreadyLocked += 1;
            continue;
          }

          try {
            await prisma.loginLock.create({
              data: {
                targetKind:   TARGET_KIND,
                targetId:     userId,
                reason:       LOCK_REASON,
                isTimeWindow: false,
                createdBy:    null, // system-created — no human actor
              },
            });
            summary.locked += 1;
          } catch (err) {
            summary.errors += 1;
            console.warn('[unpaid-lock] failed to create lock for', userId, ':', err.message);
          }
        }
      });
    } catch (err) {
      summary.errors += 1;
      console.warn(`[unpaid-lock] tenant ${tenant.code} scan failed:`, err.message);
    }
  }

  return summary;
}

/**
 * Releases every active unpaid-fees lock for `userId` if the user no longer
 * has any overdue invoices with a balance. Called from the Stripe webhook
 * on payment success.
 *
 * MUST be called inside a runWithTenant() block — does not establish one
 * itself because the caller already has the scope.
 */
async function releaseLockIfBalanceClear(prisma, userId, _tenantId) {
  if (!userId) return { released: 0, reason: 'no_user' };

  const grace = graceDays();
  const cutoff = new Date(Date.now() - grace * 24 * 60 * 60 * 1000);

  // Are there still overdue invoices for this user?
  const stillOverdue = await prisma.invoice.count({
    where: {
      userId,
      dueDate: { lt: cutoff },
      balance: { gt: 0 },
      status:  { in: ['pending', 'partial', 'overdue'] },
    },
  });
  if (stillOverdue > 0) {
    return { released: 0, reason: 'still_overdue', remaining: stillOverdue };
  }

  const result = await prisma.loginLock.updateMany({
    where: {
      targetKind: TARGET_KIND,
      targetId:   userId,
      reason:     LOCK_REASON,
      releasedAt: null,
    },
    data: {
      releasedAt: new Date(),
      // releasedBy stays null — this is a system release, no human actor.
    },
  });
  return { released: result.count, reason: 'cleared' };
}

module.exports = {
  scanAndCreateLocks,
  releaseLockIfBalanceClear,
  LOCK_REASON,
  TARGET_KIND,
};
