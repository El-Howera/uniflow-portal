/**
 * Unified push fan-out — sends one payload over BOTH channels:
 *   - FCM (lib/firebase.js)   → native Capacitor device tokens + FCM-capable
 *                               browsers (Chrome/Edge/Firefox/Android PWA).
 *   - Web Push (lib/webpush.js) → standard VAPID Web Push, the only channel
 *                               that reaches an installed iOS PWA.
 *
 * The two channels are mutually exclusive PER DEVICE: a device registers EITHER
 * an `fcmToken` (FCM-capable) OR a `push_subscriptions` row (iOS PWA / web push
 * fallback), never both — so a single device never gets duplicate pushes. A
 * user signed in on multiple devices correctly gets one push per device.
 *
 * Drop-in replacement for `lib/firebase.js`'s `sendPushToUsers` — same
 * signature — so call sites only change their require path. Never throws.
 */

'use strict';

const { sendPushToUsers: sendFcmToUsers } = require('./firebase');
const { sendWebPushToUsers } = require('./webpush');

/**
 * @param {object} prisma
 * @param {string|string[]} userIds
 * @param {{ title: string, body: string, data?: Record<string, any> }} payload
 * @returns {Promise<{ fcm: object, web: object }>}
 */
async function sendPushToUsers(prisma, userIds, payload) {
  const [fcm, web] = await Promise.all([
    sendFcmToUsers(prisma, userIds, payload).catch((e) => ({ error: e.message })),
    sendWebPushToUsers(prisma, userIds, payload).catch((e) => ({ error: e.message })),
  ]);
  return { fcm, web };
}

module.exports = { sendPushToUsers };
