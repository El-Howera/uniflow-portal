/**
 * routes/announcements.routes.js — Announcement CRUD + recipient picker.
 *
 * Owns (MVP build):
 *   GET    /api/announcements             — filtered feed (best-effort auth)
 *   POST   /api/sa/announcements          — create + notification fan-out (requireAuth)
 *   GET    /api/sa/recipient-options      — slim picker for the composer
 *
 * MVP build notes:
 *   - The SA/admin-only management delete (DELETE /api/sa/announcements/:id)
 *     and the SA/admin student directory (GET /api/sa/students) have been
 *     removed.
 *   - POST /api/sa/announcements is requireAuth-only: SA/admin compose here,
 *     and a student holding the `Announcements:write` per-user override may
 *     also post (limited to specific-user / specific-level targeting). The
 *     recipient picker is its companion and is kept for the same callers.
 *
 * Fan-out delegates to the notification server's /api/notifications/broadcast
 * endpoint (fire-and-forget via setImmediate). Recipient resolution is
 * extracted into lib/recipients.js.
 *
 * Mounted at app.use('/api', announcementsRoutes) in index.js.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const multer  = require('multer');
const path    = require('path');
const storage = require('../../../lib/storage');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');

const prisma                  = require('../../../lib/prisma');
const { requireAuth }         = require('../../../lib/auth');
const { hasPermission }       = require('../../../lib/permissions');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const log                     = require('../../../lib/logger')('student-affairs/announcements');

const { resolveRecipients } = require('../lib/recipients');

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';

// ── Announcement image upload ──────────────────────────────────────────────
//
// On Fly.io, the single persistent volume is mounted at /app/uploads (see
// fly.toml [[mounts]]). Prefers the unified UPLOAD_ROOT env var; falls back
// to the legacy ANNOUNCEMENT_UPLOAD_DIR for backward compatibility; then
// dev __dirname path.

const ANNOUNCEMENT_BASE =
  process.env.UPLOAD_ROOT || process.env.ANNOUNCEMENT_UPLOAD_DIR;
const ANNOUNCEMENT_UPLOAD_DIR = ANNOUNCEMENT_BASE
  ? path.join(ANNOUNCEMENT_BASE, 'announcements')
  : path.join(__dirname, '../uploads/announcements');
fs.mkdirSync(ANNOUNCEMENT_UPLOAD_DIR, { recursive: true });

const announcementImageUpload = storage.memoryUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|gif)/i.test(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WEBP/GIF images allowed'), ok);
  },
});

// Converts multer upload errors into clean 400 JSON. Logs the writable-state
// probe once per process boot so operators can spot a misconfigured upload
// directory without spamming a log line on every request.
let _announcementDirProbed = false;
const handleAnnouncementImage = (req, res, next) => {
  if (!_announcementDirProbed) {
    _announcementDirProbed = true;
    try {
      fs.accessSync(ANNOUNCEMENT_UPLOAD_DIR, fs.constants.W_OK);
    } catch (e) {
      log.warn(
        `[announcements] upload dir not writable: ${ANNOUNCEMENT_UPLOAD_DIR} - ${e.message}`
      );
    }
  }
  announcementImageUpload.single('image')(req, res, (err) => {
    if (err) {
      log.warn(
        `[announcements] multer rejected upload: code=${err.code || 'n/a'} msg=${err.message}`
      );
      const code = err.code === 'LIMIT_FILE_SIZE'
        ? 'Image too large (max 5 MB)'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Unexpected file field (use `image`)'
        : err.message || 'Upload failed';
      return res.status(400).json({ error: code });
    }
    next();
  });
};

// ── GET /api/announcements ─────────────────────────────────────────────────

// Best-effort auth: privileged roles see all; students get filtered output.
router.get('/announcements', async (req, res) => {
  try {
    const { category, priority, limit } = req.query;

    let caller = null;
    try {
      const cookieToken = req.cookies?.token;
      const headerToken = req.headers['authorization']?.startsWith('Bearer ')
        ? req.headers['authorization'].split(' ')[1]
        : null;
      const token = cookieToken || headerToken;
      if (token) {
        caller = jwt.verify(token, JWT_SECRET);
      }
    } catch { /* unauthenticated — caller stays null */ }

    // Multi-tenant: filter announcements by the current tenant context
    const tenantId = caller?.tenantId || req.tenantId || 'tenant_fcds_seed';
    const where = { tenantId };
    if (category) where.category = category;
    if (priority) where.priority = priority;

    const all = await prisma.announcement.findMany({
      where,
      orderBy: { date: 'desc' },
      take: limit ? parseInt(limit) : undefined,
    });

    const privileged = caller && ['admin', 'sa'].includes(caller.role);
    let filtered;
    if (privileged) {
      filtered = all;
    } else {
      let callerLevel = null;
      if (caller?.userId) {
        const ap = await prisma.academicProfile
          .findUnique({ where: { userId: caller.userId }, select: { level: true } })
          .catch(() => null);
        callerLevel = ap?.level ?? null;
      }
      filtered = all.filter((a) => {
        if (Array.isArray(a.targetUserIds) && a.targetUserIds.length > 0) {
          return caller?.userId && a.targetUserIds.includes(caller.userId);
        }
        if (Array.isArray(a.targetLevels) && a.targetLevels.length > 0) {
          if (callerLevel == null) return false;
          if (!a.targetLevels.includes(callerLevel)) return false;
          if (a.targetRoles.length > 0 && caller?.role && !a.targetRoles.includes(caller.role)) return false;
          return true;
        }
        if (Array.isArray(a.targetRoles) && a.targetRoles.length > 0) {
          if (!caller?.role) return false;
          return a.targetRoles.includes(caller.role);
        }
        return true;
      });
    }

    res.json({
      announcements: filtered,
      categories: ['events', 'academic', 'financial', 'health', 'general', 'student_affairs'],
    });
  } catch (error) {
    log.error('Get announcements error:', error);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// MVP build: DELETE /api/sa/announcements/:id (SA/admin-only management
// delete) has been removed.

// ── POST /api/sa/announcements ─────────────────────────────────────────────
// Kept: requireAuth-only. SA/admin compose announcements here, and a student
// who holds the `Announcements:write` per-user override may also post (limited
// to specific-user / specific-level targeting).

router.post('/sa/announcements', requireAuth, handleAnnouncementImage, restoreTenantContext, async (req, res) => {
  const isPrivileged = ['sa', 'admin'].includes(req.user.role);
  if (!isPrivileged) {
    const allowed = await hasPermission(prisma, req.user.userId, 'Announcements', 'write').catch(() => false);
    if (!allowed) return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const {
      title,
      content,
      fullContent,
      audience,
      urgency,
      category,
      targetRoles,
      targetUserIds,
      targetLevels,
      mode,
    } = req.body || {};

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const sendMode = mode === 'notification' ? 'notification' : 'announcement';

    const ALLOWED_CATEGORIES = ['events', 'academic', 'financial', 'health', 'general', 'student_affairs'];
    const safeCategory = ALLOWED_CATEGORIES.includes(category) ? category : 'general';

    const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'normal'];
    const URGENCY_MAP = { normal: 'normal', important: 'high', critical: 'high' };
    const rawPriority = req.body?.priority;
    const priority =
      URGENCY_MAP[urgency] ||
      (ALLOWED_PRIORITIES.includes(rawPriority) ? rawPriority : null) ||
      (ALLOWED_PRIORITIES.includes(urgency) ? urgency : 'normal');

    let imageUrl = null;
    if (req.file) {
      const { filename } = await storage.saveUpload('announcements', req.file);
      imageUrl = `/uploads/announcements/${filename}`;
    } else if (req.body?.imageUrl) {
      imageUrl = req.body.imageUrl;
    }

    const parseArrayField = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw !== 'string' || !raw.trim()) return [];
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j)) return j;
      } catch { /* fall through */ }
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    };

    const parsedTargetRoles = parseArrayField(targetRoles)
      .map((r) => String(r || '').trim().toLowerCase())
      .filter(Boolean);

    const parsedTargetUserIds = parseArrayField(targetUserIds)
      .map((u) => String(u || '').trim())
      .filter(Boolean);

    const parsedTargetLevels = parseArrayField(targetLevels)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);

    // Non-privileged callers may only target specific users or specific levels.
    if (!isPrivileged) {
      const hasUserTargets = parsedTargetUserIds.length > 0;
      const hasLevelTargets = parsedTargetLevels.length > 0;
      if (!hasUserTargets && !hasLevelTargets) {
        return res.status(403).json({
          error: 'Students with the announcement override may only target specific users or specific levels.',
        });
      }
      parsedTargetRoles.length = 0;
    }

    const effectiveRoles = parsedTargetRoles.length > 0 ? parsedTargetRoles : ['student'];
    const tenantId = req.user?.tenantId || req.tenantId || process.env.DEFAULT_TENANT_CODE || 'tenant_fcds_seed';
    const recipientIds = await resolveRecipients(prisma, {
      parsedTargetUserIds,
      parsedTargetLevels,
      effectiveRoles,
      tenantId,
    });

    let announcement = null;
    if (sendMode === 'announcement') {
      announcement = await prisma.announcement.create({
        data: {
          tenantId,
          title,
          content,
          fullContent,
          priority,
          category: safeCategory,
          audience: audience || 'all-students',
          imageUrl,
          source: req.user.role,
          author: req.user.email,
          authorId: req.user.userId,
          targetRoles: effectiveRoles,
          targetUserIds: parsedTargetUserIds,
          targetLevels: parsedTargetLevels,
        },
      });
    }

    // Delegate fan-out to the notification server. Fire-and-forget.
    const notifTitle = sendMode === 'announcement' ? `New Announcement: ${title}` : title;
    const notifBody = String(content || '').substring(0, 240);
    if (recipientIds.length > 0) {
      const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
      setImmediate(() => {
        fetch(`${notifUrl}/api/notifications/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers['authorization'] || '',
            Cookie: req.headers['cookie'] || '',
          },
          body: JSON.stringify({
            userIds: recipientIds,
            title: notifTitle,
            content: notifBody,
            priority: priority === 'high' ? 'high' : 'normal',
            type: sendMode === 'announcement' ? 'announcement' : 'info',
            ...(announcement
              ? { referenceId: announcement.id, referenceType: 'Announcement' }
              : {}),
          }),
        })
          .then((r) => r.json().catch(() => ({})))
          .catch((e) => log.warn('[announcements] broadcast call failed:', e.message));
      });
    }

    res.status(201).json({
      success: true,
      mode: sendMode,
      announcement,
      recipientCount: recipientIds.length,
    });
  } catch (error) {
    log.error('[SA] Create announcement error:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      hasFile: !!req.file,
      fileName: req.file?.filename,
      bodyKeys: Object.keys(req.body || {}),
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MVP build: GET /api/sa/students (SA/admin-only student directory for the
// compose UI) has been removed.

// ── GET /api/sa/recipient-options ─────────────────────────────────────────

// Slim picker for the admin/SA announcement compose UI.
router.get('/sa/recipient-options', requireAuth, async (req, res) => {
  if (!['admin', 'sa'].includes(req.user.role)) {
    const allowed = await hasPermission(prisma, req.user.userId, 'Announcements', 'write').catch(() => false);
    if (!allowed) return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const { search, role } = req.query;
    const where = { status: 'Active' };
    if (role && typeof role === 'string') where.role = role;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        profilePicture: true,
        academicProfile: { select: { level: true, program: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
    });
    const users = rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      role: u.role,
      profilePicture: u.profilePicture ?? null,
      level: u.academicProfile?.level ?? null,
      program: u.academicProfile?.program ?? null,
    }));
    const levels = [
      ...new Set(
        users
          .filter((u) => u.role === 'student')
          .map((s) => s.level)
          .filter((n) => Number.isFinite(n))
      ),
    ].sort((a, b) => a - b);
    res.json({ users, students: users, levels });
  } catch (err) {
    log.error('Recipient options error:', err);
    res.status(500).json({ error: 'Failed to fetch recipient options' });
  }
});

module.exports = router;
