/**
 * GET /api/chatbot/sessions/:userId
 *
 * Returns the user's last 10 ChatbotConversation rows with the first user
 * message as a preview so the UI can render a session list. Mounted at
 * `/api/chatbot/sessions`; the internal route is `/:userId`.
 *
 * The clear-cache endpoint lives in chat.routes.js because it's
 * semantically a chat operation (drop the active chat history) — keeping
 * it adjacent to the chat handlers means a change to the session store
 * surface touches one file, not two.
 */
const express = require('express');
const prisma = require('../../../lib/prisma');
const { asyncHandler } = require('../../../lib/errors');
const { requireAuth } = require('../../../lib/auth');

const router = express.Router();

router.get(
  '/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const conversations = await prisma.chatbotConversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1, // first user message as preview
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    res.json({ success: true, conversations });
  })
);

module.exports = router;
