/**
 * Single-recipient notification routes.
 *
 *   POST /api/notifications/system  — backend-service originated notify
 *     (e.g. course-content firing "quiz graded" to the student who took
 *     it). Bypasses the self-send guard because the recipient and the
 *     authenticated caller are intentionally the same person.
 *
 *   POST /api/notifications/send    — human-originated single-recipient
 *     notify with a self-send guard. The sender is the authenticated
 *     caller; the recipient is `req.body.userId`.
 *
 * Both paths: persist a DB row → emit via Socket.io if recipient is
 * online → fire FCM push (fire-and-forget). FCM no-ops gracefully when
 * Firebase isn't configured.
 */
const express = require('express');
const prisma = require('../../../lib/prisma');
const { sendPushToUsers } = require('../../../lib/push');
const { requireAuth } = require('../../../lib/auth');
const { safeNotificationType, createNotificationRow } = require('../lib/notification-helpers');
const { emitToUser, kickStaleSessions } = require('../socket');

const router = express.Router();

// POST /api/notifications/kick-stale — used by the auth login handler to
// boot any older browser sessions for the just-logged-in user. Auth-gated
// (requireAuth) so only the user themselves (or admin/internal) can call
// this. Caller must pass `minIat` — the iat (seconds-since-epoch) of the
// fresh JWT that just got issued. We kick any socket whose own JWT iat
// is strictly less than minIat, so the new login's brand-new socket
// (which connects a beat later) is never affected.
router.post('/kick-stale', requireAuth, (req, res) => {
  const tenantId = req.user.tenantId;
  const userId = req.user.userId;
  const minIat = Number(req.body?.minIat);
  if (!Number.isFinite(minIat) || minIat <= 0) {
    return res.status(400).json({ error: 'minIat (numeric) is required' });
  }
  const kicked = kickStaleSessions(tenantId, userId, minIat);
  res.json({ success: true, kicked });
});

/**
 * Resolve sender display info (name + role + avatar) so the live toast can
 * render the correct face / initials / role badge without an extra round-trip
 * to the user-profile endpoint. Returns null when senderId is missing or the
 * lookup fails — the toast falls back to its type icon in that case.
 *
 * Without this hydration the live emit carries only `senderId`, so the toast
 * sees neither a name (no initials fallback) nor an avatar URL (no image),
 * and the recipient sees an "empty circle" (icon-on-tinted-bg with no name
 * line) — matching the user-reported bug.
 */
async function resolveSender(senderId) {
  if (!senderId) return { name: null, role: null, avatar: null };
  try {
    const u = await prisma.user.findUnique({
      where: { id: senderId },
      select: { firstName: true, lastName: true, role: true, profilePicture: true },
    });
    if (!u) return { name: null, role: null, avatar: null };
    return {
      name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null,
      role: u.role ?? null,
      avatar: u.profilePicture ?? null,
    };
  } catch {
    return { name: null, role: null, avatar: null };
  }
}

router.post('/system', requireAuth, async (req, res) => {
  const { userId, title, content, type, referenceType, referenceId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    // /system notifications may carry an originating user (e.g. SA approves
    // a request — the system emits a notification on behalf of the SA staffer
    // so the student sees their face). When req.user is a service-actor
    // (no human originator), the sender stays null and the toast renders
    // its type icon instead.
    const senderId = req.user?.userId ?? null;
    const sender = await resolveSender(senderId);

    const notification = await createNotificationRow({
      userId,
      title: title || 'UniFlow',
      content: content || '',
      type: safeNotificationType(type),
      ...(senderId ? { senderId } : {}),
      ...(referenceType ? { referenceType } : {}),
      ...(referenceId ? { referenceId } : {}),
    });

    // /system requires authentication so req.user.tenantId is always present.
    // Recipients in OTHER tenants are unreachable by design — a service in
    // tenant A cannot notify a user in tenant B.
    emitToUser(req.user.tenantId, userId, 'new_notification', {
      ...notification,
      senderName: sender.name,
      senderRole: sender.role,
      senderAvatar: sender.avatar,
    });

    setImmediate(() => {
      sendPushToUsers(prisma, userId, {
        title: title || 'UniFlow',
        body: content || '',
        data: {
          type: type || 'info',
          notificationId: notification.id,
          ...(referenceType ? { referenceType } : {}),
          ...(referenceId ? { referenceId: String(referenceId) } : {}),
        },
      }).catch((e) => console.warn('[fcm] system send failed:', e.message));
    });

    res.status(201).json({ success: true, notification });
  } catch (error) {
    console.error('Error sending system notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/send', requireAuth, async (req, res) => {
  const { userId, title, content, type } = req.body;
  const senderId = req.user?.userId;

  // Refuse self-sends — they're always a bug at the call-site (e.g. caller
  // resolved sender as recipient by mistake) and would trigger a toast sound
  // on the sender's own client.
  if (userId && senderId && userId === senderId) {
    return res.status(400).json({ error: 'Cannot notify yourself' });
  }

  try {
    const sender = await resolveSender(senderId);

    const notification = await createNotificationRow({
      userId,
      title,
      content,
      type: safeNotificationType(type),
      ...(senderId ? { senderId } : {}),
    });

    // Tenant-bounded: sender and recipient must share a tenant. Cross-tenant
    // sends are blocked by Prisma at write time anyway (row created in the
    // sender's tenant, recipient can't read across tenants), but the live
    // socket also keys on tenantId so a delivery never strays.
    const emitted = emitToUser(req.user.tenantId, userId, 'new_notification', {
      ...notification,
      senderName: sender.name,
      senderRole: sender.role,
      senderAvatar: sender.avatar,
    });
    if (emitted) {
      console.log(`[notification] sent to ${userId} t=${req.user.tenantId}`);
    }

    setImmediate(() => {
      sendPushToUsers(prisma, userId, {
        title: title || 'UniFlow',
        body: content || '',
        data: { type: type || 'info', notificationId: notification.id },
      }).catch((e) => console.warn('[fcm] send failed:', e.message));
    });

    res.status(201).json({ success: true, notification });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
