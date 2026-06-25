/**
 * UniFlow Notification & Event Server
 * Port: 4009
 *
 * Bootstrap-only. All route logic lives in:
 *   - routes/send.routes.js       (POST /system, /send)
 *   - routes/inbox.routes.js      (GET, PATCH read/read-all, DELETE)
 *   - routes/broadcast.routes.js  (POST /broadcast)
 *
 * Socket.io setup is in socket.js; service-specific helpers in
 * lib/notification-helpers.js. Modularised in Plan 11 (smallest server
 * first; pattern template for the remaining 9 services).
 */
const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');

const prisma = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');

const { attachSocketIo } = require('./socket');
const sendRoutes = require('./routes/send.routes');
const inboxRoutes = require('./routes/inbox.routes');
const broadcastRoutes = require('./routes/broadcast.routes');

const PORT = 4009;
const app = express();
const server = http.createServer(app);

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// Socket.io owns its auth middleware and userSockets map.
attachSocketIo(server);

// All three routers share the /api/notifications prefix. Route patterns
// across the routers don't collide (distinct method+path combinations).
app.use('/api/notifications', sendRoutes);
app.use('/api/notifications', inboxRoutes);
app.use('/api/notifications', broadcastRoutes);

app.get('/', (req, res) => res.json({ status: 'ok', service: 'notification' }));

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[notification] listening on :${PORT} (socket.io enabled)`);
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, server, prisma };
