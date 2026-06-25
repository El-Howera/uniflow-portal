/**
 * Multi-recipient broadcast route.
 *
 *   POST /api/notifications/broadcast
 *
 * Body (one of the four resolvers must produce a non-empty recipient list):
 *   - userIds[]   — explicit list (highest priority)
 *   - sectionId   — all approved+active registrations of one CourseSection
 *   - courseCode  — all approved+active registrations of every section for
 *                   the course
 *   - targetRole  — every non-deleted, email-verified user with that role
 *
 * Allowed callers: professor, ta, sa, admin.
 *
 * Flow: resolve recipients → de-dupe + exclude sender (so a "broadcast to
 * my role" doesn't ring the sender's own toast) → createMany → re-fetch
 * (so each row has an id) → emit one Socket.io event per recipient →
 * fan-out FCM in parallel (fire-and-forget).
 */
const express = require('express');
const prisma = require('../../../lib/prisma');
const { sendPushToUsers } = require('../../../lib/push');
const { requireAuth } = require('../../../lib/auth');
const { BROADCAST_ALLOWED_TYPES } = require('../lib/notification-helpers');
const { emitToUser } = require('../socket');

const router = express.Router();

router.post('/broadcast', requireAuth, async (req, res) => {
  const { role, userId: senderId } = req.user;
  if (!['professor', 'ta', 'sa', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const {
    courseCode,
    sectionId,
    userIds,
    targetRole,
    title,
    content,
    priority = 'normal',
    // Optional NotificationType — defaults to 'info' for generic blasts.
    // Callers (e.g. student-affairs announcement publish) pass 'announcement'
    // so the student UI can show a "Open" button that jumps to the feed.
    type: notifType,
    referenceId,
    referenceType,
  } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const safeType = BROADCAST_ALLOWED_TYPES.includes(notifType) ? notifType : 'info';

  try {
    let recipientIds = [];

    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      recipientIds = userIds;
    } else if (sectionId) {
      const regs = await prisma.registration.findMany({
        where: { sectionId, status: 'approved', isActive: true },
        select: { userId: true },
      });
      recipientIds = regs.map(r => r.userId);
    } else if (courseCode) {
      const course = await prisma.course.findFirst({
        where: { code: courseCode },
        select: { id: true },
      });
      if (course) {
        const regs = await prisma.registration.findMany({
          where: { courseId: course.id, status: 'approved', isActive: true },
          select: { userId: true },
        });
        recipientIds = regs.map(r => r.userId);
      }
    } else if (targetRole) {
      // User has no `isActive` flag — that field exists on Course/ServiceFee.
      // For users, the equivalent filter is `deletedAt: null` (soft-delete).
      // emailVerified also enforced so unactivated accounts are skipped.
      const users = await prisma.user.findMany({
        where: { role: targetRole, deletedAt: null, emailVerified: true },
        select: { id: true },
      });
      recipientIds = users.map(u => u.id);
    }

    if (recipientIds.length === 0) {
      return res.status(400).json({ error: 'No recipients resolved' });
    }

    // Remove duplicates and exclude the sender — a professor broadcasting to
    // their own role would otherwise self-notify and hear the toast for their
    // own message.
    const unique = [...new Set(recipientIds)].filter(uid => uid !== senderId);

    if (unique.length === 0) {
      return res.status(400).json({ error: 'No recipients resolved' });
    }

    const notifData = unique.map(uid => ({
      userId: uid,
      title,
      content,
      type: safeType,
      priority,
      senderId,
      ...(courseCode ? { courseCode } : {}),
      ...(referenceId ? { referenceId } : {}),
      ...(referenceType ? { referenceType } : {}),
    }));

    await prisma.notification.createMany({ data: notifData });

    // Fetch created notifications to emit via socket — createMany doesn't
    // return rows, and each emit needs the row id so the client can mark
    // it read.
    const created = await prisma.notification.findMany({
      where: {
        userId: { in: unique },
        title,
        senderId,
        createdAt: { gte: new Date(Date.now() - 5000) },
      },
      orderBy: { createdAt: 'desc' },
      take: unique.length,
    });

    // Resolve sender info once so every emitted payload carries the sender
    // avatar + name. Without this the live toast falls back to a generic
    // icon while the GET endpoint shows the avatar after a refresh.
    let senderInfo = null;
    if (senderId) {
      senderInfo = await prisma.user.findUnique({
        where: { id: senderId },
        select: { firstName: true, lastName: true, role: true, profilePicture: true },
      }).catch(() => null);
    }
    const senderName = senderInfo
      ? `${senderInfo.firstName} ${senderInfo.lastName}`.trim()
      : null;

    let emittedCount = 0;
    for (const notif of created) {
      // Broadcast is tenant-scoped — req.user.tenantId is the only valid
      // tenant for these recipients (Prisma created the rows in this
      // tenant; recipients in another tenant wouldn't have a row to read).
      const success = emitToUser(req.user.tenantId, notif.userId, 'new_notification', {
        ...notif,
        senderName,
        senderRole: senderInfo?.role ?? null,
        senderAvatar: senderInfo?.profilePicture ?? null,
      });
      if (success) emittedCount++;
    }
    console.log(
      `[notification] broadcast complete: created=${created.length} ` +
      `emitted=${emittedCount} title="${title}" referenceType="${referenceType}"`
    );

    // Fan-out to FCM in parallel — fire-and-forget so the HTTP response
    // doesn't wait on Firebase. No-ops gracefully when not configured.
    // Logs the result so the operator can see how many devices got a push
    // vs. how many were skipped (no-token / not-configured).
    setImmediate(async () => {
      try {
        const r = await sendPushToUsers(prisma, unique, {
          title,
          body: content,
          data: {
            type: safeType,
            priority,
            ...(courseCode ? { courseCode } : {}),
            ...(referenceId ? { referenceId } : {}),
            ...(referenceType ? { referenceType } : {}),
          },
        });
        console.log(
          `[fcm] broadcast -> recipients=${unique.length} ` +
            `sent=${r.sent} skipped=${r.skipped} errors=${r.errors}`
        );
      } catch (e) {
        console.warn('[fcm] broadcast send failed:', e.message);
      }
    });

    res.status(201).json({ success: true, sent: unique.length });
  } catch (error) {
    console.error('Broadcast error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
