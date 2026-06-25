/**
 * user-profile / routes / admin-system.routes.js  (MVP build — trimmed)
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints (self-service + public only):
 *   GET    /api/notifications/:userId          (public read)
 *   POST   /api/notifications                  (authenticateToken)
 *   PATCH  /api/notifications/:id/read         (authenticateToken)
 *   PATCH  /api/notifications/mark-all-read/:userId (authenticateToken)
 *   DELETE /api/notifications/:id              (authenticateToken)
 *   POST   /api/users/me/fcm-token            (authenticateToken)
 *   DELETE /api/users/me/fcm-token            (authenticateToken)
 *   GET    /api/push/vapid-public-key         (public)
 *   POST   /api/users/me/push-subscription    (authenticateToken)
 *   DELETE /api/users/me/push-subscription    (authenticateToken)
 *   POST   /api/users/me/device               (authenticateToken)
 *   GET    /api/me/schedule-grid              (authenticateToken)
 *   GET    /api/me/permissions               (authenticateToken)
 *
 * MVP build notes:
 *   - The admin-guarded handlers (GET /api/admin/overview, /api/admin/analytics,
 *     POST /api/admin/users/:id/device/release, DELETE /api/admin/users/:id/device)
 *     have been removed — the MVP build keeps a real backend only for student &
 *     professor. There is intentionally no student self-unregister for devices
 *     (that was admin-only and is now gone), so a device, once bound, stays bound
 *     for the preview.
 *   - schedule-grid and me/permissions use authenticateToken (not requireScope)
 *     because they are self-service endpoints consumed by the frontend to gate
 *     UI panels.
 *   - Notification endpoints are a legacy bridge: the notification server (4009)
 *     is the canonical path, but these proxies remain for backwards compatibility
 *     with older frontend pages.
 */

'use strict';

const express = require('express');

const prisma = require('../../../lib/prisma');
const { getUserPermissions, getUserRoles } = require('../../../lib/permissions');
const { authenticateToken } = require('../lib/active-sessions');

const router = express.Router();

// ── Notification endpoints ────────────────────────────────────────────────────

router.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = '50' } = req.query;
    let user = await prisma.user.findFirst({ where: { email: userId } }).catch(() => null);
    if (!user) user = await prisma.user.findFirst({ where: { id: userId } }).catch(() => null);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });
    res.json(notifications.map((n) => ({
      id: n.id, title: n.title, content: n.content || '',
      type: n.type, isRead: n.isRead,
      timestamp: n.createdAt.toISOString(),
    })));
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const { userId, title, content, type } = req.body;
    if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });
    const notification = await prisma.notification.create({
      data: { userId, title, content, type: type || 'info' },
    });
    res.status(201).json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

router.patch('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.patch('/api/notifications/mark-all-read/:userId', authenticateToken, async (req, res) => {
  try {
    let user = await prisma.user.findFirst({ where: { email: req.params.userId } }).catch(() => null);
    if (!user) user = await prisma.user.findFirst({ where: { id: req.params.userId } }).catch(() => null);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

router.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// ── FCM token endpoints ───────────────────────────────────────────────────────

router.post('/api/users/me/fcm-token', authenticateToken, async (req, res) => {
  try {
    const token = (req.body?.token || req.body?.fcmToken || '').toString().trim();
    if (!token) return res.status(400).json({ error: 'token is required' });
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { fcmToken: token, fcmTokenAt: new Date() },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Save FCM token error:', error);
    res.status(500).json({ error: 'Failed to save FCM token' });
  }
});

router.delete('/api/users/me/fcm-token', authenticateToken, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.userId },
      data: { fcmToken: null, fcmTokenAt: null },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Clear FCM token error:', error);
    res.status(500).json({ error: 'Failed to clear FCM token' });
  }
});

// ── Web Push (VAPID) subscription endpoints ───────────────────────────────────
// Standard Web Push is the only background-push channel that reaches an
// installed iOS PWA (FCM's web SDK is unsupported on iOS Safari). One row per
// browser endpoint. Raw SQL because the PushSubscription model may not be in
// the generated Prisma client yet; tenant is scoped explicitly.

// Public key for the service worker's PushManager.subscribe() — public by
// design (the private key stays server-side). Unauthenticated so the SW can
// fetch it as part of the subscribe flow.
router.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/api/users/me/push-subscription', authenticateToken, async (req, res) => {
  try {
    const sub = req.body?.subscription || req.body || {};
    const endpoint = (sub.endpoint || '').toString();
    const p256dh = sub.keys?.p256dh ? String(sub.keys.p256dh) : '';
    const auth = sub.keys?.auth ? String(sub.keys.auth) : '';
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: 'invalid subscription (endpoint + keys.p256dh + keys.auth required)' });
    }
    const tenantId = req.user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenant_claim_missing' });
    const userAgent = (req.headers['user-agent'] || '').toString().slice(0, 255);
    // Upsert on (tenant_id, endpoint): a browser's push endpoint is stable; if
    // a different user signs into the same browser, reassign the row to them.
    await prisma.$executeRawUnsafe(
      `INSERT INTO push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (tenant_id, endpoint)
       DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
                     auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, updated_at = NOW()`,
      tenantId, req.user.userId, endpoint, p256dh, auth, userAgent,
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Save push subscription error:', error);
    res.status(500).json({ error: 'Failed to save push subscription' });
  }
});

router.delete('/api/users/me/push-subscription', authenticateToken, async (req, res) => {
  try {
    const endpoint = (req.body?.endpoint || req.query?.endpoint || '').toString();
    const tenantId = req.user.tenantId;
    if (endpoint) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND user_id = $2 AND endpoint = $3`,
        tenantId, req.user.userId, endpoint,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND user_id = $2`,
        tenantId, req.user.userId,
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Clear push subscription error:', error);
    res.status(500).json({ error: 'Failed to clear push subscription' });
  }
});

// ── Device registration endpoint (self-service) ───────────────────────────────

// Register (bind) the student's current device for attendance.
// First registration is free. Re-registration requires an admin-granted
// release — but the admin release/revoke endpoints have been removed in the
// MVP build, so for the preview a device, once bound, stays bound.
router.post('/api/users/me/device', authenticateToken, async (req, res) => {
  try {
    const deviceId = (req.body?.deviceId || '').toString().trim();
    const deviceLabel = (req.body?.deviceLabel || '').toString().trim().slice(0, 120);
    // Public key from device-side crypto binding (ECDSA P-256). PWA sends a
    // mock value; native app sends the real Secure Enclave / StrongBox key.
    const devicePublicKey = (req.body?.devicePublicKey || '').toString().trim().slice(0, 1024);
    if (!deviceId || deviceId.length > 256) {
      return res.status(400).json({ error: 'Valid deviceId required (1–256 chars)' });
    }

    const me = await prisma.user.findFirst({
      where: { id: req.user.userId },
      select: { registeredDeviceId: true, deviceReleaseAt: true },
    });

    // Already bound to a device → must request an admin release first.
    if (me?.registeredDeviceId) {
      return res.status(409).json({
        error: 'A device is already registered. Request a release from Student Affairs to register a new one.',
        reason: 'device_already_registered',
      });
    }

    // Release granted but the cooldown window hasn't elapsed yet (normal release).
    if (me?.deviceReleaseAt && new Date(me.deviceReleaseAt) > new Date()) {
      return res.status(409).json({
        error: 'Device registration is locked during the release cooldown.',
        reason: 'release_cooldown_active',
        releaseAt: me.deviceReleaseAt,
      });
    }

    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        registeredDeviceId: deviceId,
        registeredDeviceLabel: deviceLabel || 'This device',
        deviceRegisteredAt: new Date(),
        registeredDevicePublicKey: devicePublicKey || null,
        // Consume any release window now that a device is bound.
        deviceReleaseAt: null,
        deviceReleaseType: null,
        deviceReleasedById: null,
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Save device error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// ── GET /api/me/schedule-grid ─────────────────────────────────────────────────

router.get('/api/me/schedule-grid', authenticateToken, async (req, res) => {
  try {
    const {
      getSchedulePolicy: getSchedPolicy,
      effectiveSlotMinutes: effSlotMin,
      DEFAULT_POLICY: SCHED_FALLBACK,
    } = require('../../../lib/schedule-policy');

    const policy = await getSchedPolicy(prisma).catch(() => ({ ...SCHED_FALLBACK }));

    const profile = await prisma.academicProfile.findUnique({
      where: { userId: req.user.userId },
      select: { department: true, level: true },
    }).catch(() => null);

    let departmentId = null;
    if (profile?.department) {
      const dept = await prisma.department.findFirst({
        where: { code: profile.department },
        select: { id: true },
      }).catch(() => null);
      if (dept) departmentId = dept.id;
    }
    const level = Number.isInteger(profile?.level) ? profile.level : null;
    const slotMinutes = effSlotMin(policy, { departmentId, level });

    res.json({
      success: true,
      grid: {
        workingDays: policy.workingDays, slotMinutes,
        dayStart: policy.dayStart, dayEnd: policy.dayEnd,
      },
      scope: {
        departmentId, level,
        appliedOverride: slotMinutes !== policy.slotMinutes,
      },
    });
  } catch (err) {
    console.error('me/schedule-grid error:', err);
    res.status(500).json({ error: 'Failed to load schedule grid' });
  }
});

// ── GET /api/me/permissions ───────────────────────────────────────────────────

router.get('/api/me/permissions', authenticateToken, async (req, res) => {
  try {
    const [permissions, roles] = await Promise.all([
      getUserPermissions(prisma, req.user.userId),
      getUserRoles(prisma, req.user.userId),
    ]);
    res.json({
      permissions,
      roles: roles.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem })),
    });
  } catch (err) {
    console.error('me/permissions error:', err);
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

module.exports = router;
