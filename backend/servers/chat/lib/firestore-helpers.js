/**
 * Firestore helper utilities shared across chat route files and socket.js.
 *
 * Exports:
 *   - groupRef(sectionId)        → DocumentReference for chatGroups/{sectionId}
 *   - memberRef(sectionId, uid)  → DocumentReference for …/members/{uid}
 *   - messagesRef(sectionId)     → CollectionReference for …/messages
 *   - roomKey(tenantId, sectionId) → tenant-prefixed Socket.io room name
 *   - getDocScoped(ref, tenantId)  → tenant-aware doc read (null if wrong tenant)
 *   - fetchGroupForTenant(sid, tenantId) → group doc scoped to tenant
 *   - getCallerGroupRole(req, sid) → caller's chat role (admin bypass included)
 *   - isModerator(req, sid)       → true if caller may moderate
 *   - timestampToMs(value)        → Firestore/Date → ms integer
 *   - shapeMessage(snap, extras)  → wire format for a message snapshot
 *
 * Firestore availability tracking:
 *   - firestoreReachable         → live flag (true = ok, false = 5/NOT_FOUND)
 *   - firestoreUnreachableReason → last error message or null
 *   - isFirestoreNotFound(err)   → error code-5 predicate
 *   - markFirestoreDown(err)     → flip flag + print setup banner (idempotent)
 *   - probeFirestore()           → single benign doc read on startup
 */

const { requireDb, tryDb, serverTimestamp } = require('../../../lib/firestore');
const { requireAuth } = require('../../../lib/auth'); // eslint-disable-line no-unused-vars

// Lazy db access — DO NOT call requireDb() at module load. If Firebase isn't
// configured, the chat server should still BOOT (so it can answer health
// checks and surface a structured 503 per endpoint) instead of crash-looping.
// Per-call requireDb() throws at request time only.
function db() {
  return requireDb();
}

// ─── Firestore ref helpers ────────────────────────────────────────────────────

const groupRef = (sectionId) => db().collection('chatGroups').doc(sectionId);
const memberRef = (sectionId, userId) =>
  groupRef(sectionId).collection('members').doc(userId);
const messagesRef = (sectionId) => groupRef(sectionId).collection('messages');

// ─── Room-key helper ──────────────────────────────────────────────────────────

/**
 * Tenant-prefixed Socket.io room key. Every room in this server is namespaced
 * `t:<tenantId>:section:<sectionId>` so two tenants with the same sectionId
 * (impossible with cuids in practice, but defence-in-depth) never bleed.
 */
function roomKey(tenantId, sectionId) {
  if (!tenantId) throw new Error('roomKey: tenantId required');
  return `t:${tenantId}:section:${sectionId}`;
}

// ─── Firestore reachability ───────────────────────────────────────────────────

let firestoreReachable = true;
let firestoreUnreachableReason = null;

function isFirestoreNotFound(err) {
  return err && err.code === 5;
}

function markFirestoreDown(err) {
  if (firestoreReachable) {
    firestoreReachable = false;
    firestoreUnreachableReason = err.message || 'NOT_FOUND';
    const projectId = process.env.FIREBASE_PROJECT_ID || '<your-project-id>';
    console.error('='.repeat(74));
    console.error(' [chat] Firestore database not reachable');
    console.error('='.repeat(74));
    console.error(' Error: 5 NOT_FOUND from Firestore.');
    console.error('');
    console.error(' This means Firestore is NOT yet enabled for your Firebase project.');
    console.error(' (FCM works without Firestore - they are separate products.)');
    console.error('');
    console.error(' To enable it:');
    console.error('   1. Visit  https://console.firebase.google.com/project/' + projectId + '/firestore');
    console.error('   2. Click "Create database"');
    console.error('   3. Pick a location (e.g. nam5 / us-central)');
    console.error('   4. Choose Native mode (recommended), Production rules');
    console.error('   5. Restart this chat-server - groups will populate on the next');
    console.error('      /api/chat/groups/me request.');
    console.error('');
    console.error(' Until then, chat will return 503 with a hint so the UI can');
    console.error(' surface the issue rather than silently showing an empty list.');
    console.error('='.repeat(74));
  }
}

async function probeFirestore() {
  // If Firebase isn't configured, mark Firestore as unreachable instead of
  // crashing the server. Every Firestore-touching endpoint will surface a
  // structured 503 (`chat_backend_unavailable`).
  if (!tryDb()) {
    firestoreReachable = false;
    firestoreUnreachableReason = 'FIREBASE_SERVICE_ACCOUNT_KEY not set';
    console.warn('[chat] Firestore not configured — chat will return 503 until FIREBASE_SERVICE_ACCOUNT_KEY is set.');
    return;
  }
  try {
    // Firestore rejects doc IDs starting/ending with double underscores
    // (reserved namespace), so use a single-underscore probe.
    await db().collection('chatGroups').doc('_probe_').get();
    if (!firestoreReachable) {
      firestoreReachable = true;
      firestoreUnreachableReason = null;
      console.log('[chat] Firestore reachable');
    }
  } catch (err) {
    if (isFirestoreNotFound(err)) {
      markFirestoreDown(err);
    } else {
      console.warn('[chat] Firestore probe non-NOT_FOUND error:', err.message);
    }
  }
}

// ─── Tenant-scoped document reads ────────────────────────────────────────────

/**
 * Read a doc, returning null if it doesn't exist OR if its `tenantId` field
 * doesn't match the caller's tenant. Legacy docs without a tenantId field are
 * treated as visible to every tenant until backfilled.
 */
async function getDocScoped(ref, tenantId) {
  const snap = await ref.get();
  if (!snap.exists) return null;
  const stored = snap.get('tenantId');
  if (stored && stored !== tenantId) return null;
  return snap;
}

async function fetchGroupForTenant(sectionId, tenantId) {
  return getDocScoped(groupRef(sectionId), tenantId);
}

// ─── Caller role helpers ──────────────────────────────────────────────────────

async function getCallerGroupRole(req, sectionId) {
  if (req.user.role === 'admin') return 'admin';
  const snap = await getDocScoped(memberRef(sectionId, req.user.userId), req.user.tenantId);
  return snap ? snap.get('role') : null;
}

async function isModerator(req, sectionId) {
  if (['professor', 'ta', 'admin'].includes(req.user.role)) return true;
  const role = await getCallerGroupRole(req, sectionId);
  return ['admin', 'professor', 'ta'].includes(role);
}

// ─── Serialisation helpers ────────────────────────────────────────────────────

function timestampToMs(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

function shapeMessage(snap, extras = {}) {
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    userId: data.userId,
    senderName: data.senderName,
    senderAvatar: data.senderAvatar ?? null,
    senderRole: data.senderRole ?? null,
    message: data.message ?? '',
    sectionId: data.sectionId ?? null,
    courseCode: data.courseCode ?? null,
    status: data.status ?? 'sent',
    pinned: !!data.pinned,
    system: !!data.system,
    isDeleted: !!data.isDeleted,
    deletedById: data.deletedById ?? null,
    attachment: data.attachment ?? null,
    mentions: data.mentions ?? { userIds: [], hasAll: false },
    createdAt: timestampToMs(data.createdAt) ?? Date.now(),
    updatedAt: timestampToMs(data.updatedAt) ?? null,
    ...extras,
  };
}

module.exports = {
  db,
  groupRef,
  memberRef,
  messagesRef,
  roomKey,
  serverTimestamp,
  // reachability
  get firestoreReachable() { return firestoreReachable; },
  get firestoreUnreachableReason() { return firestoreUnreachableReason; },
  isFirestoreNotFound,
  markFirestoreDown,
  probeFirestore,
  // scoped reads
  getDocScoped,
  fetchGroupForTenant,
  // role helpers
  getCallerGroupRole,
  isModerator,
  // serialisation
  timestampToMs,
  shapeMessage,
};
