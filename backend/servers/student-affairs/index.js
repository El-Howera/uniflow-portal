/**
 * UniFlow Student Affairs Server
 * Port: 4006
 *
 * Bootstrap-only. All route logic lives in:
 *   routes/categories.routes.js          — request types + complaint categories (public + SA CRUD)
 *   routes/requests.routes.js            — support request CRUD
 *   routes/complaints.routes.js          — complaint CRUD
 *   routes/announcements.routes.js       — announcement feed + compose + recipient picker
 *   routes/name-changes.routes.js        — name-change approval queue (SA)
 *   routes/enrollment-workflows.routes.js — suspensions / cancellations / programme changes
 *   routes/sa-overview.routes.js         — SA dashboard overview + contacts
 *
 * Shared helpers live in:
 *   lib/recipients.js   — announcement recipient resolution
 *   lib/status-map.js   — status alias maps + shared utilities
 *
 * Modularised in Plan 11 phase 6.
 */

'use strict';

const express    = require('express');
const http       = require('http');
const cookieParser = require('cookie-parser');
const path       = require('path');

const prisma         = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { errorHandler } = require('../../lib/errors');
const { tenantResolver } = require('../../lib/tenant-resolver');

const categoriesRoutes        = require('./routes/categories.routes');
const requestsRoutes          = require('./routes/requests.routes');
const complaintsRoutes        = require('./routes/complaints.routes');
const announcementsRoutes     = require('./routes/announcements.routes');
const enrollmentWorkflowsRoutes = require('./routes/enrollment-workflows.routes');
const saOverviewRoutes        = require('./routes/sa-overview.routes');

const PORT = 4006;
const app  = express();

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// Serve uploaded files (request attachments + announcement images). In dev,
// uploads land in __dirname/uploads/{requests,announcements}/. On Fly,
// nginx's /uploads/ alias serves directly from /app/uploads/ (the volume)
// so this mount is dev-only — but we keep it so the dev path matches the
// prod URL shape exactly (`/uploads/requests/x.pdf`).
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Route mounts ───────────────────────────────────────────────────────────
// categories.routes.js serves endpoints under three prefixes:
//   /api/requests  → /types
//   /api/complaints → /categories
//   /api/sa        → /request-types, /complaint-categories
app.use('/api/requests',   categoriesRoutes);
app.use('/api/complaints', categoriesRoutes);
app.use('/api/sa',         categoriesRoutes);

// Remaining routes are all prefixed /api — routers use the full sub-path.
app.use('/api', requestsRoutes);
app.use('/api', complaintsRoutes);
app.use('/api', announcementsRoutes);
app.use('/api', enrollmentWorkflowsRoutes);
app.use('/api', saOverviewRoutes);

app.get('/', (req, res) => res.json({ status: 'ok', service: 'student-affairs' }));

app.use(errorHandler);

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[student-affairs] listening on :${PORT}`);
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, prisma };
