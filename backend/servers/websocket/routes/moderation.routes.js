/**
 * routes/moderation.routes.js — Legacy course-wide chat moderation.
 *
 * Owns:
 *   DELETE /api/chat/messages/:id          — soft-delete a message
 *   PATCH  /api/chat/messages/:id/pin      — toggle pin on a message
 *   POST   /api/chat/system-message        — broadcast a system announcement
 *   PATCH  /api/chat/group/:courseCode/readonly  — set read-only flag
 *   GET    /api/chat/group/:courseCode/readonly  — query read-only flag
 *
 * These endpoints key on courseCode (the broadcast model) rather than on a
 * ChatGroup id. They are "legacy" in the sense that the newer group-aware
 * endpoints in group.routes.js supersede them for per-section operations,
 * but they remain in use and must be preserved exactly.
 *
 * Emits Socket.io events via getIo() from socket.js:
 *   chat:messageDeleted, chat:messagePinned, chat:newMessage,
 *   chat:readonlyChanged
 *
 * Non-obvious: system-message uses the same Prisma-client-stale-artifact
 * dodge as the chat:message socket handler — typed create skips sectionId,
 * raw UPDATE writes it.
 */

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { getIo } = require('../socket');
const {
  tenantRoom,
  roomForMessage,
  readOnlyChannels,
  userIsModeratorForCourse,
} = require('../lib/chat-helpers');

const router = Router();

// ── DELETE /api/chat/messages/:id ────────────────────────────────────────────
// Soft-delete a message. Allowed for system roles (professor / ta / admin)
// AND for group-admins promoted on the message's course.
router.delete('/messages/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.chatMessage.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Message not found' });

    if (
      !(await userIsModeratorForCourse(
        req.user.userId,
        req.user.role,
        existing.courseCode || ''
      ))
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.chatMessage.update({
      where: { id },
      data: { isDeleted: true, deletedById: req.user.userId },
    });

    const room = tenantRoom(req.user.tenantId, roomForMessage(existing));
    const io = getIo();
    if (room && io) io.to(room).emit('chat:messageDeleted', { messageId: id });
    return res.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/chat/messages/:id/pin ─────────────────────────────────────────
// Toggle pin on a message.
router.patch('/messages/:id/pin', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.chatMessage.findFirst({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (
      !(await userIsModeratorForCourse(
        req.user.userId,
        req.user.role,
        existing.courseCode || ''
      ))
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const newPinned = !existing.pinned;
    await prisma.chatMessage.update({
      where: { id },
      data: { pinned: newPinned },
    });

    const room = tenantRoom(req.user.tenantId, roomForMessage(existing));
    const io = getIo();
    if (room && io) {
      io.to(room).emit('chat:messagePinned', { messageId: id, pinned: newPinned });
    }
    return res.json({ success: true, pinned: newPinned });
  } catch (error) {
    console.error('Pin message error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/chat/system-message ─────────────────────────────────────────────
// Broadcast a system announcement.
// Body: { courseCode, sectionId?, content }.
// When sectionId is provided the message is scoped to that section's chat.
// Without sectionId falls back to the legacy course-wide broadcast.
router.post('/system-message', requireAuth, async (req, res) => {
  const { courseCode, sectionId, content } = req.body;
  if (!courseCode || !content) {
    return res.status(400).json({ error: 'courseCode and content are required' });
  }
  if (
    !(await userIsModeratorForCourse(req.user.userId, req.user.role, courseCode))
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    // Same Prisma-client-stale-artifact dodge as the regular message path:
    // typed create skips sectionId, raw UPDATE writes it.
    const savedMsg = await prisma.chatMessage.create({
      data: {
        courseCode: courseCode.toUpperCase(),
        userId: req.user.userId,
        senderName: 'System',
        message: content,
        system: true,
        status: 'sent',
      },
    });
    if (sectionId) {
      try {
        await prisma.$executeRaw`
          UPDATE "chat_messages" SET "section_id" = ${sectionId} WHERE id = ${savedMsg.id} AND "tenant_id" = ${req.user.tenantId}
        `;
        savedMsg.sectionId = sectionId;
      } catch (e) {
        console.warn('[chat] system-msg sectionId write failed:', e.message);
      }
    }

    const inner = sectionId ? `section:${sectionId}` : courseCode.toUpperCase();
    const room = tenantRoom(req.user.tenantId, inner);
    const io = getIo();
    if (io) {
      io.to(room).emit('chat:newMessage', {
        courseCode: courseCode.toUpperCase(),
        sectionId: sectionId ?? null,
        message: savedMsg,
      });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('System message error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/chat/group/:courseCode/readonly ────────────────────────────────
// Toggle read-only for a course room. Body may include { sectionId } to scope
// to a specific section instead of the whole course (per-section locking).
router.patch('/group/:courseCode/readonly', requireAuth, async (req, res) => {
  const { courseCode } = req.params;
  const { enabled, sectionId } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  if (
    !(await userIsModeratorForCourse(req.user.userId, req.user.role, courseCode))
  ) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Key the lock by the live room — section-scoped when sectionId is sent,
  // course-wide otherwise. The lock map is tenant-prefixed so two tenants
  // can both lock CS101 independently.
  const inner = sectionId ? `section:${sectionId}` : courseCode.toUpperCase();
  const room = tenantRoom(req.user.tenantId, inner);
  readOnlyChannels.set(room, enabled);
  const io = getIo();
  if (io) {
    io.to(room).emit('chat:readonlyChanged', {
      courseCode: courseCode.toUpperCase(),
      sectionId: sectionId ?? null,
      readOnly: enabled,
    });
  }
  return res.json({ success: true, readOnly: enabled });
});

// ── GET /api/chat/group/:courseCode/readonly ──────────────────────────────────
// Query the current read-only state. Accepts ?sectionId= to read the
// per-section lock; falls back to the legacy course-wide flag.
router.get('/group/:courseCode/readonly', requireAuth, async (req, res) => {
  const sectionId = (req.query.sectionId || '').toString();
  const inner = sectionId
    ? `section:${sectionId}`
    : req.params.courseCode.toUpperCase();
  const room = tenantRoom(req.user.tenantId, inner);
  const readOnly = readOnlyChannels.get(room) ?? false;
  return res.json({ readOnly });
});

module.exports = router;
