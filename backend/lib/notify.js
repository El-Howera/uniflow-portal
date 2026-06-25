/**
 * Notification fan-out helper
 * ----------------------------------------------------------------------------
 * Single source of truth for "this just happened, push it to N users". Used
 * by every endpoint where a state change should notify someone (course
 * material uploaded, quiz created, assignment posted, grade changed, etc.).
 *
 * Three modes:
 *   - notifyUsers(req, { userIds, title, content, ... }) — explicit list
 *   - notifyCourseStudents(prisma, req, courseCode, { title, content, ... })
 *     resolves all approved+active student registrations for that course
 *     and pushes to each of them.
 *   - notifyUser(req, userId, { title, content, ... }) — convenience for
 *     single-recipient push (grade-change-for-student-X pattern).
 *
 * Each call is fire-and-forget via setImmediate so the originating
 * request response is not delayed by the cross-service HTTP round-trip.
 * All errors are caught and logged at warn level — broadcasts never
 * throw out of the caller's request lifecycle.
 *
 * The fan-out delegates to the notification server's
 * POST /api/notifications/broadcast endpoint which:
 *   - creates one Notification row per recipient
 *   - emits new_notification via Socket.io (port 4009) per online user
 *   - fans out FCM push (when configured)
 */

'use strict';

const NOTIF_URL = () => process.env.NOTIFICATION_URL || 'http://localhost:4009';

/**
 * Forward the broadcast HTTP call. Captures auth headers from the
 * originating request so the notification server can re-authenticate the
 * caller (requireAuth gate on the broadcast route).
 *
 * @param {import('express').Request} req — the originating request
 * @param {object} payload — { userIds, title, content, type, priority,
 *                              referenceType, referenceId }
 */
async function _post(req, payload) {
  if (!Array.isArray(payload.userIds) || payload.userIds.length === 0) {
    return { skipped: true, reason: 'no-recipients' };
  }
  try {
    const res = await fetch(`${NOTIF_URL()}/api/notifications/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers['authorization'] || '',
        Cookie: req.headers['cookie'] || '',
      },
      body: JSON.stringify(payload),
    });
    return { status: res.status };
  } catch (err) {
    console.warn('[notify] broadcast call failed:', err.message);
    return { error: err.message };
  }
}

/**
 * Fire-and-forget broadcast to an explicit user list.
 */
function notifyUsers(req, { userIds, title, content, type = 'info', priority = 'normal', referenceType, referenceId }) {
  setImmediate(async () => {
    const r = await _post(req, { userIds, title, content, type, priority, referenceType, referenceId });
    if (r?.status && r.status >= 400) {
      console.warn(`[notify] broadcast non-2xx: status=${r.status} title="${title}"`);
    }
  });
}

/**
 * Fire-and-forget broadcast to one recipient.
 */
function notifyUser(req, userId, opts) {
  if (!userId) return;
  notifyUsers(req, { ...opts, userIds: [userId] });
}

/**
 * Resolve a course's approved+active student userIds (dedup'd) then
 * broadcast. Saves the caller from writing the same query 5 times.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('express').Request} req
 * @param {string} courseCode
 * @param {object} opts — title, content, type, priority, referenceType, referenceId
 */
function notifyCourseStudents(prisma, req, courseCode, opts) {
  setImmediate(async () => {
    try {
      const registrations = await prisma.registration.findMany({
        where: {
          section: { course: { code: courseCode.toUpperCase() } },
          status: 'approved',
          isActive: true,
        },
        select: { userId: true },
      });
      const userIds = [...new Set(registrations.map((r) => r.userId))];
      if (userIds.length === 0) return;
      const r = await _post(req, { userIds, ...opts });
      if (r?.status && r.status >= 400) {
        console.warn(
          `[notify] course fan-out non-2xx course=${courseCode} ` +
          `status=${r.status} title="${opts.title}"`
        );
      }
    } catch (err) {
      console.warn(`[notify] course-student fan-out failed:`, err.message);
    }
  });
}

module.exports = {
  notifyUsers,
  notifyUser,
  notifyCourseStudents,
};
