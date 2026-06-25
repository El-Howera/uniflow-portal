/**
 * routes/group.routes.js — Group-aware (section ChatGroup) endpoints.
 *
 * Owns:
 *   GET    /api/chat/groups/me                               — list caller's groups
 *   GET    /api/chat/groups/:groupId                         — group detail + members
 *   PATCH  /api/chat/groups/:groupId                         — update name/description
 *   POST   /api/chat/groups/:groupId/photo                   — upload group photo
 *   PATCH  /api/chat/groups/:groupId/members/:userId/role    — promote/demote member
 *   PATCH  /api/chat/groups/:groupId/mute                    — self-mute toggle
 *   DELETE /api/chat/groups/:groupId/messages                — clear all messages
 *
 * These endpoints key on the section's ChatGroup id directly — unlike the
 * legacy moderation endpoints in moderation.routes.js which key on
 * courseCode. This is the "new" per-section model the frontend expects.
 *
 * Photo upload: stored under uploads/photos/ inside the service folder;
 * served as static files at /chat-photos/ by index.js.
 *
 * DELETE /messages emits chat:clearAll over the section room so connected
 * clients wipe their local list without a page refresh.
 */

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const multer = require('multer');
const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const storage = require('../../../lib/storage');
const { getIo } = require('../socket');
const { tenantRoom, userIsModeratorForGroup } = require('../lib/chat-helpers');

const router = Router();

// ── Group photo multer storage ────────────────────────────────────────────────
// Shared with chat:4010 — on Fly both servers write to the same
// /app/uploads/chat-photos/ on the persistent volume.
const photosDir = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'chat-photos')
  : path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const photoUpload = storage.memoryUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── GET /api/chat/groups/me ───────────────────────────────────────────────────
// List every chat group the caller is a member of, with their per-group role
// + mute state. Powers the chat sidebar and badge counts.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const memberships = await prisma.chatMember.findMany({
      where: { userId: req.user.userId },
      include: {
        chatGroup: {
          include: {
            section: {
              include: {
                course: { select: { code: true, title: true } },
                slots: { select: { day: true, startTime: true, endTime: true } },
              },
            },
            _count: { select: { members: true, messages: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    res.json(
      memberships.map((m) => ({
        groupId: m.chatGroupId,
        myRole: m.role,
        muted: m.muted ?? false,
        mutedUntil: m.mutedUntil,
        name: m.chatGroup.name,
        description: m.chatGroup.description ?? null,
        photoUrl: m.chatGroup.photoUrl ?? null,
        memberCount: m.chatGroup._count.members,
        messageCount: m.chatGroup._count.messages,
        sectionId: m.chatGroup.sectionId,
        courseCode: m.chatGroup.section?.course?.code ?? null,
        courseTitle: m.chatGroup.section?.course?.title ?? null,
        sectionType: m.chatGroup.section?.type ?? null,
        sectionLabel: m.chatGroup.section?.sectionId ?? null,
        slots: m.chatGroup.section?.slots ?? [],
      }))
    );
  } catch (err) {
    console.error('GET chat/groups/me:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/chat/groups/:groupId ─────────────────────────────────────────────
// Group detail with full member list. Admins (system role) can peek without
// membership; everyone else needs a member row.
router.get('/:groupId', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const me = await prisma.chatMember.findFirst({
      where: { userId: req.user.userId, chatGroupId: groupId },
      select: { role: true, muted: true, mutedUntil: true },
    });
    if (!me && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    const group = await prisma.chatGroup.findFirst({
      where: { id: groupId },
      include: {
        section: {
          include: {
            course: { select: { code: true, title: true } },
            slots: { select: { day: true, startTime: true, endTime: true } },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                profilePicture: true,
                role: true,
              },
            },
          },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    res.json({
      id: group.id,
      name: group.name,
      description: group.description ?? null,
      photoUrl: group.photoUrl ?? null,
      sectionId: group.sectionId,
      courseCode: group.section?.course?.code ?? null,
      courseTitle: group.section?.course?.title ?? null,
      sectionType: group.section?.type ?? null,
      sectionLabel: group.section?.sectionId ?? null,
      slots: group.section?.slots ?? [],
      myRole: me?.role ?? null,
      muted: me?.muted ?? false,
      mutedUntil: me?.mutedUntil ?? null,
      members: group.members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        phone: m.user.phone ?? null,
        profilePicture: m.user.profilePicture ?? null,
        systemRole: m.user.role,
      })),
    });
  } catch (err) {
    console.error('GET chat/groups/:groupId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/chat/groups/:groupId ──────────────────────────────────────────
// Admin updates name + description. Group-admin or system staff only.
router.patch('/:groupId', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!(await userIsModeratorForGroup(req.user.userId, req.user.role, groupId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { name, description } = req.body || {};
    const data = {};
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = trimmed;
    }
    if (description !== undefined) {
      data.description = description == null ? null : String(description).trim() || null;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const group = await prisma.chatGroup.update({ where: { id: groupId }, data });
    res.json({ success: true, group });
  } catch (err) {
    console.error('PATCH chat/groups/:groupId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/chat/groups/:groupId/photo ─────────────────────────────────────
// Multipart photo upload. Group-admin / system staff only. Stores under
// uploads/photos/, returns the public URL the frontend can render.
router.post(
  '/:groupId/photo',
  requireAuth,
  photoUpload.single('photo'),
  restoreTenantContext,
  async (req, res) => {
    try {
      const { groupId } = req.params;
      if (!(await userIsModeratorForGroup(req.user.userId, req.user.role, groupId))) {
        // memoryStorage — nothing written yet, so no temp file to clean up.
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!req.file) return res.status(400).json({ error: 'photo file required' });
      const { filename } = await storage.saveUpload('chat-photos', req.file);
      const url = `/chat-photos/${filename}`;
      const group = await prisma.chatGroup.update({
        where: { id: groupId },
        data: { photoUrl: url },
      });
      res.json({ success: true, photoUrl: group.photoUrl });
    } catch (err) {
      console.error('POST chat/groups/:groupId/photo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── PATCH /api/chat/groups/:groupId/members/:memberUserId/role ────────────────
// Promote / demote a chat-group member. Body: { role: 'admin' | 'student' | 'ta' }.
// Only group-admins / system staff can call. Refuses to demote the section's
// primary instructor (their `professor` role is structural).
router.patch('/:groupId/members/:memberUserId/role', requireAuth, async (req, res) => {
  try {
    const { groupId, memberUserId } = req.params;
    const { role } = req.body || {};
    const allowed = ['admin', 'student', 'ta'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${allowed.join(', ')}` });
    }
    if (!(await userIsModeratorForGroup(req.user.userId, req.user.role, groupId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const target = await prisma.chatMember.findFirst({
      where: { chatGroupId: groupId, userId: memberUserId },
    });
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'professor') {
      return res.status(400).json({ error: "Cannot change the instructor's role here" });
    }
    const updated = await prisma.chatMember.update({
      where: { id: target.id },
      data: { role },
    });
    res.json({ success: true, member: updated });
  } catch (err) {
    console.error('PATCH chat/groups/:groupId/members/:userId/role:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/chat/groups/:groupId/mute ─────────────────────────────────────
// Caller toggles their own mute. Body: { muted: boolean }.
// Self-only; affects the toast / FCM badge, not the messages themselves.
router.patch('/:groupId/mute', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { muted } = req.body || {};
    if (typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'muted (boolean) is required' });
    }
    const member = await prisma.chatMember.findFirst({
      where: { chatGroupId: groupId, userId: req.user.userId },
    });
    if (!member) return res.status(403).json({ error: 'Not a member of this group' });
    const updated = await prisma.chatMember.update({
      where: { id: member.id },
      data: { muted },
    });
    res.json({ success: true, muted: updated.muted });
  } catch (err) {
    console.error('PATCH chat/groups/:groupId/mute:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/chat/groups/:groupId/messages ─────────────────────────────────
// Clear every message in the section's chat. Restricted to moderators.
// Soft-deletes all messages (sets is_deleted=true) so audit history is
// preserved but the thread renders empty. Broadcasts chat:clearAll to the
// section room so connected clients wipe their local list without a refresh.
router.delete('/:groupId/messages', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!(await userIsModeratorForGroup(req.user.userId, req.user.role, groupId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Find the group's section + courseCode so we know which messages to wipe.
    const group = await prisma.chatGroup.findFirst({
      where: { id: groupId },
      select: {
        sectionId: true,
        section: { select: { course: { select: { code: true } } } },
      },
    });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Soft-delete by sectionId (new) and courseCode (legacy fallback so
    // pre-section messages get cleared too). is_deleted suppresses the
    // bubble in history fetches without losing the audit trail.
    let updated = 0;
    try {
      const r = await prisma.$executeRaw`
        UPDATE "chat_messages"
           SET "is_deleted" = true,
               "deleted_by_id" = ${req.user.userId}
         WHERE "tenant_id" = ${req.user.tenantId}
           AND (("section_id" = ${group.sectionId})
            OR ("section_id" IS NULL AND "course_code" = ${group.section?.course?.code ?? ''}))
      `;
      updated = Number(r);
    } catch (e) {
      console.warn('[chat] clear-all SQL failed:', e.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Wipe the pinned-message marker on the group too — its target row is
    // now soft-deleted.
    try {
      await prisma.chatGroup.update({
        where: { id: groupId },
        data: { pinnedMessageId: null },
      });
    } catch { /* noop */ }

    const room = tenantRoom(req.user.tenantId, `section:${group.sectionId}`);
    const io = getIo();
    if (io) io.to(room).emit('chat:clearAll', { groupId, sectionId: group.sectionId });
    return res.json({ success: true, cleared: updated });
  } catch (err) {
    console.error('DELETE chat/groups/:groupId/messages:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
