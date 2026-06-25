/**
 * Audit log helper.
 *
 * Wraps `prisma.auditLog.create` and additionally fans out a `system`-typed
 * Notification to every admin user when the action is in SENSITIVE_ACTIONS.
 * Notifications go through the notification server's broadcast endpoint
 * (POST /api/notifications/broadcast) so admins get them live via Socket.io
 * AND persistently in the DB.
 *
 * Usage:
 *   const { writeAudit } = require('../../lib/audit');
 *   await writeAudit(prisma, {
 *     action: 'admin_user_deleted',
 *     entityType: 'User',
 *     entityId: user.id,
 *     targetUserId: user.id,
 *     details: { email: user.email },
 *     performedById: req.user.userId,
 *   }, {
 *     authHeader: req.headers.authorization,
 *     summary: `Deleted user ${user.email}`,
 *     // optional — defaults to action prefix → /admin/audit-logs
 *   });
 *
 * The audit-row write is the contract — it always happens. The notification
 * fan-out is opportunistic: failure is logged but does not affect the caller.
 */

const axios = require('axios');

// Actions that should trigger an admin notification. Keep this list focused —
// every entry in it produces a Notification row per admin per occurrence,
// which becomes noise if too broad. Pure-data CRUD that admins don't need to
// react to in real time should NOT be here.
const SENSITIVE_ACTIONS = new Set([
  'admin_user_deleted',
  'admin_user_created',
  'admin_user_updated',
  'grade_override',
  'force_enroll',
  'system_settings_updated',
  'role_permissions_updated',
  'registration_period_toggled',
  'registration_period_created',
  'registration_period_deleted',
  'grading_rules_updated',
  'grading_rules_recompute',
  'role_created',
  'role_deleted',
  'user_role_assigned',
  'user_role_unassigned',
  'course_hard_deleted',
  'course_disabled',
  'course_enabled',
  'assignment_submission_deleted',
  'backup_failed',
]);

/**
 * Write an audit log + optionally fan out a notification to all admins.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {object} data Audit log row data.
 * @param {string} data.action — required
 * @param {string} [data.entityType]
 * @param {string} [data.entityId]
 * @param {string} [data.targetUserId]
 * @param {object|string} [data.details]
 * @param {string} [data.performedById]
 * @param {string} [data.ipAddress]
 * @param {string} [data.userAgent]
 * @param {object} [opts]
 * @param {string} [opts.authHeader] Authorization header to forward to the
 *   notification server. The broadcast endpoint requires admin/sa/professor/ta.
 *   Most sensitive actions are by admin, so passing through req.headers
 *   .authorization works.
 * @param {string} [opts.summary] Human-readable text shown in the notification
 *   body. Defaults to a slug of the action name.
 * @param {string} [opts.title] Notification title. Defaults to "System Event".
 * @returns {Promise<object|null>} The created audit log row, or null on failure.
 */
async function writeAudit(prisma, data, opts = {}) {
  if (!data?.action) {
    console.warn('[audit] writeAudit called without action - skipping');
    return null;
  }

  let log = null;
  try {
    log = await prisma.auditLog.create({ data });
  } catch (err) {
    console.error('[audit] failed to write audit log:', err.message);
    return null;
  }

  if (!SENSITIVE_ACTIONS.has(data.action)) return log;

  const NOTIF_URL = process.env.NOTIFICATION_URL || 'http://localhost:4009';
  const summary = opts.summary || data.action.replace(/_/g, ' ');
  const title = opts.title || 'System Event';

  // Fire-and-forget: the audit log is already persisted; notification fan-out
  // is best-effort. setImmediate so the calling HTTP handler returns first.
  //
  // No retry: a slow primary that times out (no HTTP status) was previously
  // retried with a fallback type, but the broadcast often had already
  // succeeded server-side, producing a duplicate notification of a different
  // type. The audit row is the source of truth; a missed in-app notification
  // is acceptable, a duplicate one is not.
  setImmediate(() => {
    axios
      .post(
        `${NOTIF_URL}/api/notifications/broadcast`,
        {
          targetRole: 'admin',
          title,
          content: summary,
          type: 'system',
          priority: 'high',
          referenceType: 'AuditLog',
          referenceId: log.id,
        },
        {
          headers: opts.authHeader ? { Authorization: opts.authHeader } : {},
          timeout: 15000,
        }
      )
      .catch((err) => {
        const status = err.response?.status;
        const body = err.response?.data;
        console.warn(
          '[audit] admin notification fan-out failed for',
          data.action,
          status ? `→ HTTP ${status} body=${JSON.stringify(body)}` : `→ ${err.message}`
        );
      });
  });

  return log;
}

module.exports = { writeAudit, SENSITIVE_ACTIONS };
