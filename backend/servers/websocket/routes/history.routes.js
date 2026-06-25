/**
 * routes/history.routes.js — Chat history REST endpoint.
 *
 * Owns:
 *   GET /api/chat/history/:courseCode
 *     Returns the last 100 messages for a course (legacy course-wide
 *     model). Authenticated; any role may call.
 *
 * Note: the socket-side history fetch (chat:join handler) is more capable —
 * it supports per-section scoping via sectionId. This REST endpoint is the
 * simpler course-wide fallback used by non-socket callers.
 */

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');

const router = Router();

// GET /api/chat/history/:courseCode — last 100 messages for a course room.
router.get('/:courseCode', requireAuth, async (req, res) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { courseCode: req.params.courseCode.toUpperCase() },
      take: 100,
      orderBy: { createdAt: 'asc' },
      include: { attachments: true },
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
