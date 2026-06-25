/**
 * user-profile / routes / profile.routes.js
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints:
 *   GET   /api/profile/:userId
 *   PATCH /api/profile/:userId
 *   POST  /api/profile/:userId/picture      (multipart OR JSON legacy)
 *   POST  /api/profile/name-change-request
 *   GET   /api/profile/name-change-requests/:userId
 *
 * Non-obvious decisions:
 *   - The picture endpoint checks content-type at runtime and conditionally
 *     applies multer (multipart) vs falls through (JSON legacy), exactly
 *     as in the original.
 *   - AVATAR_DIR is resolved relative to the service root (__dirname/..)
 *     because this file lives one level deeper than in the original.
 *   - restoreTenantContext is applied after the multer gate because the
 *     multer boundary can lose the AsyncLocalStorage context.
 */

'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const prisma  = require('../../../lib/prisma');
const { resolveUser } = require('../../../lib/users');
const { restoreTenantContext, getCurrentTenant } = require('../../../lib/tenant-context');

const { authenticateToken } = require('../lib/active-sessions');
const storage = require('../../../lib/storage');

const router = express.Router();

// ── Avatar upload (multer) ────────────────────────────────────────────────────
// On Fly.io the volume is mounted at /app/uploads (see fly.toml [[mounts]]).
// Setting UPLOAD_ROOT=/app/uploads routes the avatars onto that persistent
// volume so they survive container restarts + redeploys, and the URL
// `/uploads/avatars/<file>` resolves through nginx's alias to the same
// disk path. Without the env var (dev) the original __dirname relative
// path keeps working as before.

const AVATAR_DIR = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'avatars')
  : path.join(__dirname, '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// memoryStorage — handler saves under the `avatars/` key via storage.
const avatarUpload = storage.memoryUpload({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Only PNG, JPEG, GIF, or WebP images are allowed.'), ok);
  },
});

// ── GET /api/profile/:userId ──────────────────────────────────────────────────

router.get('/api/profile/:userId', async (req, res) => {
  try {
    const resolved = await resolveUser(req.params.userId);
    if (!resolved) return res.status(404).json({ error: 'User not found' });

    const user = await prisma.user.findFirst({
      where: { id: resolved.id },
      include: { academicProfile: true, address: true, emergencyContact: true },
    });

    let advisorRow = null;
    try {
      const tenantId = req.user?.tenantId || req.tenantId || getCurrentTenant();
      const rows = await prisma.$queryRaw`
        SELECT is_academic_advisor AS "isAcademicAdvisor",
               academic_advisor_id AS "academicAdvisorId",
               requires_advisor_approval AS "requiresAdvisorApproval"
        FROM users WHERE id = ${user.id} AND tenant_id = ${tenantId} LIMIT 1
      `;
      advisorRow = rows?.[0] || null;
    } catch { /* fall through */ }

    const { password: _pw, academicProfile, address, emergencyContact, ...baseUser } = user;

    const profile = {
      ...baseUser,
      ...(advisorRow || {}),
      id: user.id,
      odID: user.odId,
      profilePicture: user.profilePicture || null,
      address: address ? {
        street: address.street || '', city: address.city || '',
        state: address.state || '', zipCode: address.zipCode || '', country: address.country || '',
      } : undefined,
      emergencyContact: emergencyContact ? {
        name: emergencyContact.name || '', relationship: emergencyContact.relationship || '',
        phone: emergencyContact.phone || '', email: emergencyContact.email || '',
      } : undefined,
      academic: {
        program: academicProfile?.program || 'Undeclared',
        major: academicProfile?.major || 'Undeclared',
        minor: academicProfile?.minor || '',
        enrollmentDate: academicProfile?.enrollmentDate || user.createdAt?.toISOString?.() || '',
        expectedGraduation: academicProfile?.expectedGraduation || '',
        standing: academicProfile?.standing || 'Freshman',
        level: academicProfile?.level ?? null,
        status: user.activated ? 'Active' : 'Inactive',
        advisor: academicProfile?.advisor || '',
        advisorEmail: academicProfile?.advisorEmail || '',
        gpa: parseFloat(academicProfile?.gpa) || 0,
        totalCredits: parseInt(academicProfile?.totalCredits) || 0,
        creditsThisSemester: parseInt(academicProfile?.creditsThisSemester) || 0,
      },
    };

    res.json(profile);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PATCH /api/profile/:userId ────────────────────────────────────────────────

router.patch('/api/profile/:userId', authenticateToken, async (req, res) => {
  const { firstName, lastName, phone, dateOfBirth, address, emergencyContact, profilePicture } = req.body;

  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const callerIsSelf  = req.user?.userId === user.id;
    const callerIsStaff = ['admin', 'sa'].includes(req.user?.role);
    if (!callerIsSelf && !callerIsStaff) {
      return res.status(403).json({ error: 'Cannot modify another user\'s profile' });
    }

    const userData = {};
    if (firstName !== undefined)    userData.firstName = firstName;
    if (lastName !== undefined)     userData.lastName = lastName;
    if (phone !== undefined)        userData.phone = phone;
    if (profilePicture !== undefined) userData.profilePicture = profilePicture;
    if (dateOfBirth !== undefined) {
      if (dateOfBirth === null || dateOfBirth === '') {
        userData.dateOfBirth = null;
      } else {
        const parsed = new Date(dateOfBirth);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid dateOfBirth' });
        }
        userData.dateOfBirth = parsed;
      }
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: userData });

    if (address) {
      await prisma.userAddress.upsert({
        where: { userId: user.id }, create: { userId: user.id, ...address }, update: address,
      });
    }

    if (emergencyContact) {
      await prisma.emergencyContact.upsert({
        where: { userId: user.id }, create: { userId: user.id, ...emergencyContact }, update: emergencyContact,
      });
    }

    const { password: _pw, ...safeUser } = updated;
    res.json({ success: true, message: 'Profile updated successfully', profile: safeUser });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── POST /api/profile/:userId/picture ────────────────────────────────────────

router.post(
  '/api/profile/:userId/picture',
  authenticateToken,
  (req, res, next) => {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('multipart/form-data')) {
      avatarUpload.single('picture')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
      });
    } else {
      next();
    }
  },
  restoreTenantContext,
  async (req, res) => {
    try {
      const user = await resolveUser(req.params.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const callerIsSelf  = req.user?.userId === user.id;
      const callerIsStaff = ['admin', 'sa'].includes(req.user?.role);
      if (!callerIsSelf && !callerIsStaff) {
        return res.status(403).json({ error: 'Cannot modify another user\'s profile picture' });
      }

      let newPicture;
      if (req.file) {
        const ext = path.extname(req.file.originalname || '').toLowerCase().slice(0, 8) || '.jpg';
        const { filename } = await storage.saveUpload('avatars', req.file, `${user.id}-${Date.now()}${ext}`);
        const host  = req.headers['x-forwarded-host'] || req.headers.host;
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        // Behind a single-origin reverse proxy (Fly nginx, Caddy mobile-dev),
        // requests to this service arrive via the /profile/ path prefix. The
        // returned URL needs the same prefix so the <img> render hits the proxy
        // route and gets forwarded back here. In direct-port dev (frontend on
        // :3000 hitting :4007), no proxy header → no prefix → URL served by
        // express.static below.
        const pathPrefix = req.headers['x-forwarded-host'] ? '/profile' : '';
        newPicture = `${proto}://${host}${pathPrefix}/uploads/avatars/${filename}`;
      } else if (req.body?.pictureUrl) {
        newPicture = req.body.pictureUrl;
      } else {
        return res.status(400).json({ error: 'No picture file or pictureUrl supplied' });
      }

      await prisma.user.update({ where: { id: user.id }, data: { profilePicture: newPicture } });
      res.json({ success: true, message: 'Profile picture updated', pictureUrl: newPicture });
    } catch (error) {
      console.error('Error updating profile picture:', error);
      res.status(500).json({ error: 'Failed to update profile picture' });
    }
  }
);

// ── POST /api/profile/name-change-request ─────────────────────────────────────

router.post('/api/profile/name-change-request', authenticateToken, async (req, res) => {
  const { requestedFirstName, requestedLastName } = req.body;
  const userId = req.user.userId;

  if (!requestedFirstName || !requestedLastName) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  try {
    const existing = await prisma.nameChangeRequest.findFirst({ where: { userId, status: 'pending' } });
    if (existing) return res.status(409).json({ error: 'A name-change request is already pending' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const request = await prisma.nameChangeRequest.create({
      data: {
        userId, requestedFirstName, requestedLastName,
        currentFirstName: user.firstName, currentLastName: user.lastName, status: 'pending',
      },
    });

    res.status(201).json({ success: true, request });
  } catch (error) {
    console.error('Error creating name change request:', error);
    res.status(500).json({ error: 'Failed to submit name change request' });
  }
});

// ── GET /api/profile/name-change-requests/:userId ─────────────────────────────

router.get('/api/profile/name-change-requests/:userId', authenticateToken, async (req, res) => {
  if (req.params.userId !== req.user.userId && req.user.role !== 'admin' && req.user.role !== 'sa') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const requests = await prisma.nameChangeRequest.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (error) {
    console.error('Error fetching name change requests:', error);
    res.status(500).json({ error: 'Failed to fetch name change requests' });
  }
});

module.exports = router;
