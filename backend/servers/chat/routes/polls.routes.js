/**
 * Poll endpoints for the chat server.
 *
 * Mounted at /api/chat in index.js.
 *
 * Endpoints (2):
 *   GET  /messages/:messageId/poll   → tally + caller's vote for a poll message
 *   POST /messages/:messageId/vote   → cast / update / retract vote
 *
 * Data layout:
 *   chatGroups/{sectionId}/messages/{msgId}/votes/{userId}
 *     { tenantId, optionIds: string[], votedAt: Timestamp }
 *
 * Vote tallies are computed server-side after each write (no GROUP BY in
 * Firestore). Live updates fan out via chat:pollVoted on the section room.
 *
 * Tenant scoping: group + message verified via fetchGroupForTenant /
 * getDocScoped before any read/write. Votes are filtered by tenantId at the
 * query level.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../../../lib/auth');

const {
  memberRef,
  messagesRef,
  roomKey,
  serverTimestamp,
  isFirestoreNotFound,
  markFirestoreDown,
  getDocScoped,
  fetchGroupForTenant,
} = require('../lib/firestore-helpers');
const { computeTallies } = require('../lib/poll');
const { getIo } = require('../socket');

// ─── GET /messages/:messageId/poll ────────────────────────────────────────────

router.get('/messages/:messageId/poll', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { tenantId, userId } = req.user;
    const sectionId = (req.query.sectionId || '').toString();
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });

    const groupTenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!groupTenantSnap) return res.status(404).json({ error: 'Poll not found' });

    const msgRef = messagesRef(sectionId).doc(messageId);
    const msgSnap = await getDocScoped(msgRef, tenantId);
    if (!msgSnap) return res.status(404).json({ error: 'Poll not found' });
    const att = msgSnap.get('attachment');
    if (!att || att.type !== 'poll' || !att.poll) {
      return res.status(404).json({ error: 'Message is not a poll' });
    }

    // Tally all votes; extract caller's selection separately.
    const votesSnap = await msgRef
      .collection('votes')
      .where('tenantId', '==', tenantId)
      .get();

    const tallies = Object.fromEntries(
      (att.poll.options || []).map((o) => [o.id, 0])
    );
    let totalVoters = 0;
    let myVote = null;
    votesSnap.forEach((v) => {
      const ids = Array.isArray(v.get('optionIds')) ? v.get('optionIds') : [];
      for (const id of ids) {
        if (id in tallies) tallies[id] += 1;
      }
      totalVoters += 1;
      if (v.id === userId) myVote = ids;
    });

    res.json({
      messageId,
      sectionId,
      question: att.poll.question,
      options: att.poll.options,
      multipleChoice: !!att.poll.multipleChoice,
      tallies,
      totalVoters,
      myVote,
    });
  } catch (err) {
    if (isFirestoreNotFound(err)) {
      markFirestoreDown(err);
      return res.status(503).json({
        error: 'chat_backend_unavailable',
        reason: 'firestore_not_enabled',
        detail: err.message,
      });
    }
    console.error('GET poll:', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /messages/:messageId/vote ──────────────────────────────────────────

router.post('/messages/:messageId/vote', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { tenantId, userId, role } = req.user;
    const { sectionId, optionIds } = req.body || {};
    if (!sectionId) return res.status(400).json({ error: 'sectionId required' });
    if (!Array.isArray(optionIds)) {
      return res.status(400).json({ error: 'optionIds (string[]) required' });
    }

    const groupTenantSnap = await fetchGroupForTenant(sectionId, tenantId);
    if (!groupTenantSnap) return res.status(404).json({ error: 'Poll not found' });

    // Non-staff must be a group member.
    if (!['professor', 'ta', 'admin'].includes(role)) {
      const memberSnap = await getDocScoped(memberRef(sectionId, userId), tenantId);
      if (!memberSnap) return res.status(403).json({ error: 'Not a member' });
    }

    const msgRef = messagesRef(sectionId).doc(messageId);
    const msgSnap = await getDocScoped(msgRef, tenantId);
    if (!msgSnap) return res.status(404).json({ error: 'Poll not found' });
    const att = msgSnap.get('attachment');
    if (!att || att.type !== 'poll' || !att.poll) {
      return res.status(404).json({ error: 'Message is not a poll' });
    }

    const validIds = new Set((att.poll.options || []).map((o) => o.id));
    const cleaned = [...new Set(optionIds.filter((id) => validIds.has(id)))];
    if (!att.poll.multipleChoice && cleaned.length > 1) {
      return res.status(400).json({ error: 'Single-choice poll allows one option' });
    }

    const voteRef = msgRef.collection('votes').doc(userId);
    if (cleaned.length === 0) {
      // Empty array = retract vote.
      const exists = await voteRef.get();
      if (exists.exists) {
        const stored = exists.get('tenantId');
        if (!stored || stored === tenantId) await voteRef.delete();
      }
    } else {
      await voteRef.set({
        tenantId,
        userId,
        optionIds: cleaned,
        votedAt: serverTimestamp(),
      });
    }

    // Recompute tallies after the write so the broadcast carries fresh numbers.
    const { tallies, totalVoters } = await computeTallies(msgRef, att, tenantId);

    getIo().to(roomKey(tenantId, sectionId)).emit('chat:pollVoted', {
      sectionId,
      messageId,
      tallies,
      totalVoters,
    });

    res.json({ success: true, tallies, totalVoters, myVote: cleaned });
  } catch (err) {
    if (isFirestoreNotFound(err)) {
      markFirestoreDown(err);
      return res.status(503).json({
        error: 'chat_backend_unavailable',
        reason: 'firestore_not_enabled',
        detail: err.message,
      });
    }
    console.error('POST vote:', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
