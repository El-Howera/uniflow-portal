/**
 * Message operation routes for the chat server.
 *
 * Mounted at /api/chat in index.js.
 *
 * Endpoints (5):
 *   GET    /history/:sectionId            → last 100 messages (REST fallback)
 *   DELETE /messages/:messageId           → soft-delete a message
 *   PATCH  /messages/:messageId/pin       → toggle pin
 *   POST   /system-message                → broadcast a system announcement
 *   DELETE /groups/:groupId/messages      → clear all messages (paginated batch)
 *
 * Notes:
 *   - All writes broadcast socket events via getIo() so connected clients
 *     update without a refresh.
 *   - Soft-delete sets isDeleted=true; the document is never hard-deleted.
 *   - Clear-all paginates at 400 ops/batch to stay under Firestore's 500-op
 *     limit. It uses a single-field orderBy (no composite index required).
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../../../lib/auth');

const {
  groupRef,
  messagesRef,
  roomKey,
  serverTimestamp,
  db,
  isFirestoreNotFound,
  markFirestoreDown,
  getDocScoped,
  fetchGroupForTenant,
  isModerator,
  shapeMessage,
  timestampToMs,
} = require('../lib/firestore-helpers');
const { getIo } = require('../socket');

// ─── GET /history/:sectionId ──────────────────────────────────────────────────

/**
 * REST fallback for fetching the most recent 100 messages. The frontend
 * prefers the Socket.io chat:history payload but this lets the chatroom load
 * a thread before the socket connects.
 */
router.get('/history/:sectionId', requireAuth, async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { tenantId } = req.user;
    const groupSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!groupSnap) return res.status(404).json({ error: 'Group not found' });

    const snap = await messagesRef(sectionId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const messages = snap.docs
      .map((d) => shapeMessage(d))
      .filter((m) => !m.isDeleted && (!m.tenantId || m.tenantId === tenantId))
      .reverse();
    res.json(messages);
  } catch (err) {
    console.error('GET /api/chat/history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /messages/:messageId ─────────────────────────────────────────────

router.delete('/messages/:messageId', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { tenantId, userId } = req.user;
    const sectionId = (req.query.sectionId || req.body?.sectionId || '').toString();
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });

    const tenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, sectionId))) return res.status(403).json({ error: 'Forbidden' });

    const ref = messagesRef(sectionId).doc(messageId);
    const snap = await getDocScoped(ref, tenantId);
    if (!snap) return res.status(404).json({ error: 'Message not found' });

    await ref.set(
      { isDeleted: true, deletedById: userId, updatedAt: serverTimestamp() },
      { merge: true }
    );
    getIo().to(roomKey(tenantId, sectionId)).emit('chat:messageDeleted', { sectionId, messageId });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE message:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /messages/:messageId/pin ──────────────────────────────────────────

router.patch('/messages/:messageId/pin', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { tenantId } = req.user;
    const sectionId = (req.query.sectionId || req.body?.sectionId || '').toString();
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });

    const tenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, sectionId))) return res.status(403).json({ error: 'Forbidden' });

    const ref = messagesRef(sectionId).doc(messageId);
    const snap = await getDocScoped(ref, tenantId);
    if (!snap) return res.status(404).json({ error: 'Message not found' });

    const newPinned = !snap.get('pinned');
    await ref.set({ pinned: newPinned, updatedAt: serverTimestamp() }, { merge: true });
    await groupRef(sectionId).set(
      { pinnedMessageId: newPinned ? messageId : null, updatedAt: serverTimestamp() },
      { merge: true }
    );
    getIo().to(roomKey(tenantId, sectionId)).emit('chat:messagePinned', {
      sectionId,
      messageId,
      pinned: newPinned,
    });
    res.json({ success: true, pinned: newPinned });
  } catch (err) {
    console.error('PATCH pin:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /system-message ─────────────────────────────────────────────────────

router.post('/system-message', requireAuth, async (req, res) => {
  try {
    const { sectionId, content } = req.body || {};
    const { tenantId, userId } = req.user;
    if (!sectionId || !content) {
      return res.status(400).json({ error: 'sectionId and content are required' });
    }
    const groupSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!groupSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, sectionId))) return res.status(403).json({ error: 'Forbidden' });

    const groupData = groupSnap.data();
    const docRef = await messagesRef(sectionId).add({
      tenantId,
      userId,
      senderName: 'System',
      senderAvatar: null,
      senderRole: 'system',
      message: String(content),
      sectionId,
      courseCode: groupData.courseCode ?? null,
      status: 'sent',
      pinned: false,
      system: true,
      isDeleted: false,
      deletedById: null,
      attachment: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await groupRef(sectionId).set({ lastMessageAt: serverTimestamp() }, { merge: true });

    const saved = await docRef.get();
    getIo().to(roomKey(tenantId, sectionId)).emit('chat:newMessage', {
      sectionId,
      message: shapeMessage(saved),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/chat/system-message:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /groups/:groupId/messages ────────────────────────────────────────

/**
 * Soft-delete all messages in a group. Paginates at 400 docs/batch to stay
 * under Firestore's 500-op-per-batch limit. Uses single-field orderBy so no
 * composite index is required in fresh projects.
 */
router.delete('/groups/:groupId/messages', requireAuth, async (req, res) => {
  try {
    const sectionId = req.params.groupId;
    const { tenantId, userId } = req.user;

    const tenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, sectionId))) return res.status(403).json({ error: 'Forbidden' });

    let cleared = 0;
    let scanned = 0;
    let lastDoc = null;
    while (true) {
      // Single-field orderBy ONLY — combining .where('tenantId', '==', X)
      // with .orderBy('createdAt') would require a Firestore composite index
      // and throws FAILED_PRECONDITION in fresh projects (which the catch
      // below doesn't trap — `isFirestoreNotFound` only matches NOT_FOUND).
      // The parent group is already tenant-verified above via
      // fetchGroupForTenant(); the per-doc in-memory check below is
      // defence-in-depth for any stray legacy doc.
      let q = messagesRef(sectionId).orderBy('createdAt').limit(400);
      if (lastDoc) q = q.startAfter(lastDoc);
      const page = await q.get();
      if (page.empty) break;

      // db is a lazy accessor (function-not-object) so the chat server
      // can boot without Firestore credentials. Call it to get the
      // Firestore instance, then create the batch on that. Calling
      // `db.batch()` directly raised "db.batch is not a function" and
      // 500'd the entire clear-all endpoint.
      const batch = db().batch();
      let dirty = 0;
      page.docs.forEach((d) => {
        scanned += 1;
        if (d.get('isDeleted')) return;
        // Legacy docs without tenantId are treated as visible to this tenant
        // (parent group already passed fetchGroupForTenant). Cross-tenant
        // docs (legacy ID collisions) are skipped silently.
        const docTenant = d.get('tenantId');
        if (docTenant && docTenant !== tenantId) return;
        batch.set(
          d.ref,
          { isDeleted: true, deletedById: userId, updatedAt: serverTimestamp() },
          { merge: true }
        );
        dirty += 1;
      });
      if (dirty > 0) {
        await batch.commit();
        cleared += dirty;
      }
      lastDoc = page.docs[page.docs.length - 1];
      if (page.size < 400) break;
    }

    await groupRef(sectionId).set(
      { pinnedMessageId: null, updatedAt: serverTimestamp() },
      { merge: true }
    );
    getIo().to(roomKey(tenantId, sectionId)).emit('chat:clearAll', {
      sectionId,
      groupId: sectionId,
    });
    res.json({ success: true, cleared, scanned });
  } catch (err) {
    if (isFirestoreNotFound(err)) {
      markFirestoreDown(err);
      return res.status(503).json({
        error: 'chat_backend_unavailable',
        reason: 'firestore_not_enabled',
        detail: err.message,
      });
    }
    console.error('DELETE clear-all:', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
