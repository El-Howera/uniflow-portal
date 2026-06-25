/**
 * UniFlow Chat Server (Firestore + Socket.io)
 * Port: 4010
 *
 * Bootstrap-only. All route logic lives in:
 *   - routes/groups.routes.js      (GET/PATCH/POST /api/chat/groups/*)
 *   - routes/messages.routes.js    (GET history, DELETE, PATCH pin, POST system-message, DELETE clear-all)
 *   - routes/polls.routes.js       (GET poll tally, POST vote)
 *   - routes/moderation.routes.js  (PATCH member role, PATCH/GET readonly)
 *
 * Socket.io setup is in socket.js (chat:join, chat:message, chat:markRead).
 * Shared Firestore helpers (refs, tenant-scoped reads, shapeMessage, etc.)
 * live in lib/firestore-helpers.js. Postgres section-membership helpers are
 * in lib/staff-groups.js. Poll tally machinery is in lib/poll.js.
 *
 * Photo uploads land on local disk (uploads/photos/) and are served at
 * /chat-photos. Migrating to Firebase Storage is a future cleanup task.
 *
 * Modularised in Plan 11, phase 4.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const express = require('express');
const http = require('http');
const path = require('path');

const prisma = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');
const cookieParser = require('cookie-parser');

const { attachSocketIo } = require('./socket');
const { probeFirestore } = require('./lib/firestore-helpers');

const groupsRoutes = require('./routes/groups.routes');
const messagesRoutes = require('./routes/messages.routes');
const pollsRoutes = require('./routes/polls.routes');
const moderationRoutes = require('./routes/moderation.routes');

const PORT = process.env.CHAT_PORT || 4010;

const app = express();
app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(tenantResolver({ strict: false }));

// Static serving for group photos uploaded via the REST endpoint. Honours
// UPLOAD_ROOT (Fly volume) so the multer write target and the static
// serve target stay in sync.
const photosDir = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'chat-photos')
  : path.join(__dirname, 'uploads', 'photos');
app.use('/chat-photos', express.static(photosDir));

// Socket.io owns its auth middleware; getIo() is used by route files that
// need to broadcast after a write.
const server = http.createServer(app);
attachSocketIo(server);

// One mount prefix per router — URL → file mapping is readable at a glance.
app.use('/api/chat', groupsRoutes);
app.use('/api/chat', messagesRoutes);
app.use('/api/chat', pollsRoutes);
app.use('/api/chat', moderationRoutes);

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'chat', backend: 'firestore' }));

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[chat] listening on :${PORT} (backing store: Firestore)`);
    // Fire the Firestore probe in the background — startup completes either
    // way; a NOT_FOUND failure prints a multi-line setup banner instead of
    // letting the first user request hit the grpc retry path.
    probeFirestore();
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, server, prisma };
