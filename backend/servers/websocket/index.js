/**
 * UniFlow WebSocket Server — bootstrap only.
 * Port: 4001
 *
 * Route / module map:
 *   socket.js                    — Socket.io connection, JWT auth middleware,
 *                                  chat:join / chat:message / chat:markRead handlers
 *   lib/chat-helpers.js          — tenantRoom(), roomForMessage(), readOnlyChannels,
 *                                  userIsModeratorForGroup/Course helpers
 *   routes/history.routes.js     — GET  /api/chat/history/:courseCode
 *   routes/moderation.routes.js  — DELETE/PATCH/POST legacy course-wide moderation
 *                                  + GET/PATCH readonly flags
 *   routes/group.routes.js       — Group-aware CRUD (groups/me, groups/:id,
 *                                  photo upload, member role, mute, clear-all)
 *
 * Static files:
 *   /chat-photos  →  uploads/photos/  (group photo uploads)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cookieParser = require('cookie-parser');

const prisma = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');

const { attachSocketIo } = require('./socket');
const historyRoutes = require('./routes/history.routes');
const moderationRoutes = require('./routes/moderation.routes');
const groupRoutes = require('./routes/group.routes');

const PORT = process.env.WS_PORT || 4001;

const app = express();
const server = http.createServer(app);

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// Serve uploaded group photos as static files. Shares the chat-photos
// directory with chat:4010 — on Fly both servers point at the volume.
const photosDir = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'chat-photos')
  : path.join(__dirname, 'uploads', 'photos');
app.use('/chat-photos', express.static(photosDir));

// Socket.io owns its auth middleware, onlineUsers map, and all chat events.
attachSocketIo(server);

// One mount prefix per router — URL → file mapping readable at a glance.
app.use('/api/chat/history', historyRoutes);
app.use('/api/chat', moderationRoutes);
app.use('/api/chat/groups', groupRoutes);

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'websocket' }));

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[websocket] listening on :${PORT}`);
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, server, prisma };
