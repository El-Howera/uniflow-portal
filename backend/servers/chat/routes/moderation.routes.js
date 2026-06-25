/**
 * Moderation routes for the chat server.
 *
 * Mounted at /api/chat in index.js.
 *
 * Endpoints (3):
 *   PATCH /groups/:groupId/members/:memberUserId/role  → promote / demote a member
 *   PATCH /group/:groupId/readonly                     → toggle read-only lock
 *   GET   /group/:groupId/readonly                     → read current lock state
 *
 * Notes:
 *   - The read-only routes use the legacy /group/:groupId (singular) path to
 *     preserve back-compat with the existing frontend code that targets that
 *     shape. The groupId param is aliased to sectionId inside the handler.
 *   - Role change broadcasts chat:roleChanged so connected clients update
 *     their toolbar/lock state without a refresh.
 *   - Read-only toggle broadcasts chat:readonlyChanged for the same reason.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../../../lib/auth');

const {
  groupRef,
  memberRef,
  roomKey,
  serverTimestamp,
  getDocScoped,
  fetchGroupForTenant,
  isModerator,
} = require('../lib/firestore-helpers');
const { getIo } = require('../socket');

// ─── PATCH /groups/:groupId/members/:memberUserId/role ────────────────────────

router.patch(
  '/groups/:groupId/members/:memberUserId/role',
  requireAuth,
  async (req, res) => {
    try {
      const { groupId, memberUserId } = req.params;
      const { tenantId } = req.user;
      const { role } = req.body || {};
      const allowed = ['admin', 'student', 'ta'];
      if (!allowed.includes(role)) {
        return res.status(400).json({ error: `role must be one of ${allowed.join(', ')}` });
      }

      const tenantSnap = await fetchGroupForTenant(groupId, tenantId);
      if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
      if (!(await isModerator(req, groupId))) return res.status(403).json({ error: 'Forbidden' });

      const target = await getDocScoped(memberRef(groupId, memberUserId), tenantId);
      if (!target) return res.status(404).json({ error: 'Member not found' });
      if (target.get('role') === 'professor') {
        return res.status(400).json({ error: "Cannot change the instructor's role here" });
      }

      await target.ref.set({ role }, { merge: true });
      const fresh = (await target.ref.get()).data();

      // Broadcast so every connected client flips its moderator state
      // (toolbar visibility, lock toggle, info panel membership) without a
      // manual refresh.
      getIo().to(roomKey(tenantId, groupId)).emit('chat:roleChanged', {
        sectionId: groupId,
        userId: memberUserId,
        role,
      });
      res.json({ success: true, member: fresh });
    } catch (err) {
      console.error('PATCH role:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── PATCH /group/:groupId/readonly ──────────────────────────────────────────

/**
 * Toggle read-only lock on a group. Uses /group/:groupId (singular) for
 * back-compat; new callers should prefer /groups/:groupId but both are
 * equivalent here.
 */
router.patch('/group/:groupId/readonly', requireAuth, async (req, res) => {
  try {
    const sectionId = req.params.groupId;
    const { tenantId } = req.user;
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    const tenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, sectionId))) return res.status(403).json({ error: 'Forbidden' });

    await groupRef(sectionId).set(
      { readOnly: enabled, updatedAt: serverTimestamp() },
      { merge: true }
    );
    getIo().to(roomKey(tenantId, sectionId)).emit('chat:readonlyChanged', {
      sectionId,
      readOnly: enabled,
    });
    res.json({ success: true, readOnly: enabled });
  } catch (err) {
    console.error('PATCH readonly:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /group/:groupId/readonly ─────────────────────────────────────────────

router.get('/group/:groupId/readonly', requireAuth, async (req, res) => {
  try {
    const sectionId = req.params.groupId;
    const { tenantId } = req.user;
    const snap = await fetchGroupForTenant(sectionId, tenantId);
    res.json({ readOnly: snap ? !!snap.get('readOnly') : false });
  } catch (err) {
    console.error('GET readonly:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
