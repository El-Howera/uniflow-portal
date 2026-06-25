/**
 * Standard Web Push (VAPID) sender — peer of lib/firebase.js (FCM).
 *
 * Why this exists: FCM's web SDK does not work on iOS Safari, so an installed
 * iOS PWA (iOS 16.4+) cannot receive background pushes via FCM. The W3C Web
 * Push protocol (VAPID) does work there — and on Chrome/Edge/Firefox too. We
 * store one `push_subscriptions` row per browser endpoint and fan out here.
 *
 * Init policy: lazy + tolerant. If VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are
 * unset (or the `web-push` package is missing), every call is a no-op that
 * returns a skipped summary — exactly like the FCM wrapper. So dropping this
 * into the notification flow can never break notifications.
 *
 * Tenant scoping: subscription reads/writes go through raw SQL (the Prisma
 * client artifact may not yet have the PushSubscription model generated), so
 * we filter on tenant_id explicitly via getCurrentTenant() for defense in
 * depth. The notification send flow runs inside a runWithTenant() scope (the
 * AsyncLocalStorage context survives the setImmediate the callers schedule).
 *
 * Env:
 *   VAPID_PUBLIC_KEY    base64url public key (also served to the frontend)
 *   VAPID_PRIVATE_KEY   base64url private key (server-only)
 *   VAPID_SUBJECT       mailto: or https: contact URL (default mailto:admin@uni-flow.tech)
 */

'use strict';

const { getCurrentTenant } = require('./tenant-context');

let _wp = null;
let _configured = null; // null = not attempted, true/false after first check

function tryInit() {
  if (_configured !== null) return _configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    _configured = false;
    return false;
  }
  try {
    // eslint-disable-next-line global-require
    const wp = require('web-push');
    wp.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@uni-flow.tech',
      publicKey,
      privateKey,
    );
    _wp = wp;
    _configured = true;
    console.log('[webpush] VAPID configured — standard Web Push enabled');
  } catch (err) {
    console.warn('[webpush] init failed — web push disabled:', err.message);
    _configured = false;
  }
  return _configured;
}

function isConfigured() {
  return tryInit();
}

function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send the same payload to every push subscription owned by the given users.
 * Expired subscriptions (HTTP 404/410) are pruned. Never throws.
 *
 * @param {object} prisma  PrismaClient (used for $queryRaw / $executeRaw)
 * @param {string|string[]} userIds
 * @param {{ title: string, body: string, data?: Record<string, any> }} payload
 * @returns {Promise<{ sent: number, skipped: number, errors: number, pruned: number }>}
 */
async function sendWebPushToUsers(prisma, userIds, payload) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const summary = { sent: 0, skipped: 0, errors: 0, pruned: 0 };
  if (ids.length === 0) return summary;
  if (!tryInit()) {
    summary.skipped = ids.length;
    return summary;
  }

  const tenantId = getCurrentTenant();

  let subs;
  try {
    // Raw SQL: the Prisma client may not have the PushSubscription model
    // generated yet. ANY($1::text[]) matches the user id list; tenant filter
    // is applied explicitly (raw SQL bypasses the tenant extension).
    if (tenantId) {
      subs = await prisma.$queryRawUnsafe(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
           WHERE user_id = ANY($1::text[]) AND tenant_id = $2`,
        ids,
        tenantId,
      );
    } else {
      subs = await prisma.$queryRawUnsafe(
        `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
           WHERE user_id = ANY($1::text[])`,
        ids,
      );
    }
  } catch (err) {
    console.warn('[webpush] subscription lookup failed:', err.message);
    return summary;
  }

  if (!subs || subs.length === 0) {
    summary.skipped = ids.length;
    return summary;
  }

  const body = JSON.stringify({
    title: payload.title || 'UniFlow',
    body: payload.body || '',
    data: payload.data || {},
  });

  await Promise.all(
    subs.map(async (s) => {
      const subscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await _wp.sendNotification(subscription, body, { TTL: 600 });
        summary.sent++;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) {
          // Subscription is dead (user cleared site data / uninstalled PWA).
          await prisma
            .$executeRawUnsafe(`DELETE FROM push_subscriptions WHERE id = $1`, s.id)
            .catch(() => {});
          summary.pruned++;
        } else {
          summary.errors++;
        }
      }
    }),
  );

  return summary;
}

module.exports = { sendWebPushToUsers, isConfigured, publicKey };
