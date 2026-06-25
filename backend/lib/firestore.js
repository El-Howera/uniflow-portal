/**
 * Firestore wrapper — extends the existing firebase.js init policy so the
 * chat server (and any other consumer) can grab a Firestore handle without
 * each one re-initialising firebase-admin.
 *
 * Init reuses backend/lib/firebase.js's tryInit so service-account discovery
 * + lazy-init semantics stay identical (same env vars, same skip-when-not-
 * configured behaviour). When Firestore is needed for a server's core flow
 * — like the chat server — call `requireDb()` which throws a clear startup
 * error if Firebase isn't wired. For optional consumers, call `tryDb()`
 * instead and handle null.
 */

let _db = null;
let _attempted = false;
let _error = null;

function tryDb() {
  if (_attempted) return _db;
  _attempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    _error = new Error('FIREBASE_SERVICE_ACCOUNT_KEY not set');
    return null;
  }

  try {
    let json;
    if (raw.trim().startsWith('{')) {
      json = JSON.parse(raw);
    } else {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      json = JSON.parse(decoded);
    }

    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(json),
        projectId: process.env.FIREBASE_PROJECT_ID || json.project_id,
      });
    }
    _db = admin.firestore();
    // Settings: ignoreUndefinedProperties so optional fields like null
    // descriptions don't blow up writes.
    try {
      _db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Already set — Firestore throws if settings are applied twice.
    }
    console.log(`[firestore] client initialised (project=${json.project_id})`);
  } catch (err) {
    _error = err;
    console.warn('[firestore] init failed:', err.message);
  }
  return _db;
}

function requireDb() {
  const db = tryDb();
  if (!db) {
    throw new Error(
      `[firestore] Firebase service account is not configured. ` +
      `Set FIREBASE_SERVICE_ACCOUNT_KEY (base64 of the service-account JSON) ` +
      `in .env. Last init error: ${_error?.message ?? 'unknown'}`
    );
  }
  return db;
}

function isConfigured() {
  return !!tryDb();
}

/**
 * Server-side timestamp sentinel. Use for createdAt / updatedAt fields so
 * Firestore stamps the row from its own clock — avoids clock-skew between
 * the server process and Firebase.
 */
function serverTimestamp() {
  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  return admin.firestore.FieldValue.serverTimestamp();
}

function deleteField() {
  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  return admin.firestore.FieldValue.delete();
}

function increment(n) {
  // eslint-disable-next-line global-require
  const admin = require('firebase-admin');
  return admin.firestore.FieldValue.increment(n);
}

module.exports = {
  tryDb,
  requireDb,
  isConfigured,
  serverTimestamp,
  deleteField,
  increment,
};
