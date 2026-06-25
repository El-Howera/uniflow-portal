/**
 * Firebase Admin SDK wrapper.
 *
 * Init policy: lazy + tolerant.
 *   - The SDK is initialised the first time `sendPushToUsers()` is called.
 *   - If `FIREBASE_SERVICE_ACCOUNT_KEY` (base64 of the service-account JSON)
 *     is not set, every call is a silent no-op and returns
 *     `{ skipped: true, reason: 'firebase-not-configured' }`.
 *   - If init fails (malformed key, etc.), the error is logged once and the
 *     same skipped-shape response is returned afterwards.
 *
 * This means dropping FCM into the fan-out paths can never break the
 * notification flow — Socket.io + DB writes still happen even when Firebase
 * isn't configured at all.
 *
 * Env vars:
 *   FIREBASE_SERVICE_ACCOUNT_KEY   base64-encoded contents of the
 *                                  Firebase service-account JSON. Required.
 *   FIREBASE_PROJECT_ID            optional explicit override
 */

let _admin = null;
let _initAttempted = false;
let _initError = null;

function tryInit() {
  if (_initAttempted) return _admin;
  _initAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    // Silent — most dev environments won't have FCM wired up.
    return null;
  }

  try {
    let json;
    if (raw.trim().startsWith('{')) {
      // Allow plain JSON in the env var for dev convenience.
      json = JSON.parse(raw);
    } else {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      json = JSON.parse(decoded);
    }

    // Lazy-require so production deployments without firebase-admin
    // installed don't crash on file import.
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(json),
        projectId: process.env.FIREBASE_PROJECT_ID || json.project_id,
      });
    }
    _admin = admin;
    console.log(`[firebase] admin SDK initialised (project=${json.project_id})`);
  } catch (err) {
    _initError = err;
    console.warn('[firebase] init failed - push notifications disabled:', err.message);
  }
  return _admin;
}

/**
 * Send a single push notification to one user's device.
 * @param {string|null|undefined} fcmToken
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 * @returns {Promise<{ ok?: true, messageId?: string, skipped?: true, reason?: string, error?: string }>}
 */
async function sendPushToToken(fcmToken, payload) {
  if (!fcmToken) return { skipped: true, reason: 'no-token' };
  const admin = tryInit();
  if (!admin) return { skipped: true, reason: 'firebase-not-configured' };

  try {
    const messaging = admin.messaging();
    const messageId = await messaging.send({
      token: fcmToken,
      notification: {
        title: payload.title || 'UniFlow',
        body: payload.body || '',
      },
      data: payload.data
        ? Object.fromEntries(
            Object.entries(payload.data).map(([k, v]) => [k, String(v)])
          )
        : undefined,
    });
    return { ok: true, messageId };
  } catch (err) {
    return { skipped: false, error: err.message || String(err) };
  }
}

/**
 * Send the same push payload to many users by userId. Looks up `User.fcmToken`
 * for each, skips users without a registered token, and returns a per-user
 * result map. Never throws — always resolves.
 *
 * @param {object} prisma         a PrismaClient instance (so this lib doesn't
 *                                pull in its own client)
 * @param {string|string[]} userIds
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 * @returns {Promise<{ sent: number, skipped: number, errors: number, results: Record<string,object> }>}
 */
async function sendPushToUsers(prisma, userIds, payload) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const summary = { sent: 0, skipped: 0, errors: 0, results: {} };
  if (ids.length === 0) return summary;

  // Cheap pre-check — if firebase isn't configured we don't need the DB query.
  if (!tryInit() && !_admin) {
    for (const id of ids) summary.results[id] = { skipped: true, reason: 'firebase-not-configured' };
    summary.skipped = ids.length;
    return summary;
  }

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fcmToken: true },
  });

  await Promise.all(
    users.map(async (u) => {
      const r = await sendPushToToken(u.fcmToken, payload);
      summary.results[u.id] = r;
      if (r.ok) summary.sent++;
      else if (r.skipped) summary.skipped++;
      else summary.errors++;
    })
  );

  return summary;
}

function isConfigured() {
  return !!tryInit();
}

module.exports = { sendPushToToken, sendPushToUsers, isConfigured };
