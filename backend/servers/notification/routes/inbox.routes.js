/**
 * Inbox routes — the recipient's view of their own notifications.
 *
 *   GET    /api/notifications/:userId             — list (default 50, max 200)
 *   PATCH  /api/notifications/:id/read            — mark one read
 *   PATCH  /api/notifications/:userId/read-all    — mark all unread read
 *   DELETE /api/notifications/:id                 — dismiss permanently
 *   DELETE /api/notifications/me/all              — bulk dismiss own
 *
 * Authorization:
 *   - read-all and DELETE :id require ownership OR admin role.
 *   - GET resolves :userId via the cuid/email/odID helper and accepts
 *     the magic string `current` to mean req.user.userId.
 *
 * Sender hydration on GET is a separate fetch (not a Prisma include)
 * because Notification.senderId is a soft FK with no relation declared
 * in schema.prisma.
 */
const express = require('express');
const prisma = require('../../../lib/prisma');
const { resolveUser } = require('../../../lib/users');
const { requireAuth } = require('../../../lib/auth');

const router = express.Router();

router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const lookupKey = userId === 'current' ? req.user.userId : userId;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requested = parseInt(req.query.limit, 10);
    const take = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, 200)
      : 50;

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take,
    });

    console.log(`[notification] fetch for user ${user.id}: found ${notifications.length} notifications`);

    const senderIds = [...new Set(notifications.map(n => n.senderId).filter(Boolean))];
    let senderMap = new Map();
    if (senderIds.length) {
      const senders = await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, firstName: true, lastName: true, role: true, profilePicture: true },
      });
      senderMap = new Map(senders.map(s => [s.id, s]));
    }

    const hydrated = notifications.map(n => {
      const s = n.senderId ? senderMap.get(n.senderId) : null;
      return {
        ...n,
        senderName: s ? `${s.firstName} ${s.lastName}`.trim() : null,
        senderRole: s?.role ?? null,
        senderAvatar: s?.profilePicture ?? null,
      };
    });

    res.json(hydrated);
  } catch (error) {
    console.error('GET notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:userId/read-all', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const lookupKey = userId === 'current' ? req.user.userId : userId;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true, count: result.count });
  } catch (error) {
    console.error('read-all error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk dismiss must be declared BEFORE DELETE /:id so the literal path
// "me/all" doesn't get captured by the :id wildcard.
router.delete('/me/all', requireAuth, async (req, res) => {
  try {
    const result = await prisma.notification.deleteMany({
      where: { userId: req.user.userId },
    });
    res.json({ success: true, count: result.count });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await prisma.notification.findFirst({
      where: { id: req.params.id },
      select: { userId: true },
    });
    if (!existing) return res.status(404).json({ error: 'Notification not found' });
    if (existing.userId !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.notification.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
