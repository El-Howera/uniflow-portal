/**
 * Shared helpers for the notification service.
 *
 * - safeNotificationType coerces an incoming `type` string to a value the
 *   Prisma client artifact accepts as NotificationType. The DB enum was
 *   extended (migration 20260503400000) to include `success` and `warning`,
 *   but until every dev environment has run `prisma generate` the compiled
 *   client may still reject those values up-front.
 *
 * - createNotificationRow wraps prisma.notification.create with a retry
 *   path: if the requested type is rejected by an older Prisma artifact,
 *   it falls back through the NOTIFICATION_TYPE_FALLBACKS map, and as a
 *   last resort drops to plain `info` so the row at least lands.
 */
const prisma = require('../../../lib/prisma');

const NOTIFICATION_TYPE_FALLBACKS = {
  success: 'info',
  warning: 'critical',
};

const VALID_NOTIFICATION_TYPES = new Set([
  'announcement', 'message', 'critical', 'info', 'success', 'warning', 'system',
]);

const BROADCAST_ALLOWED_TYPES = ['announcement', 'message', 'critical', 'info', 'system'];

function safeNotificationType(rawType) {
  const t = (rawType || 'info').toString();
  if (!VALID_NOTIFICATION_TYPES.has(t)) return 'info';
  return t;
}

async function createNotificationRow(data) {
  try {
    return await prisma.notification.create({ data });
  } catch (e) {
    const fallback = NOTIFICATION_TYPE_FALLBACKS[data.type];
    if (fallback && data.type !== fallback) {
      try {
        return await prisma.notification.create({ data: { ...data, type: fallback } });
      } catch (e2) {
        return prisma.notification.create({ data: { ...data, type: 'info' } });
      }
    }
    throw e;
  }
}

module.exports = {
  safeNotificationType,
  createNotificationRow,
  BROADCAST_ALLOWED_TYPES,
};
