/**
 * UniFlow Attendance Server
 * Port: 4003
 *
 * Bootstrap-only. All route logic lives in:
 *   routes/sessions.routes.js — staff session ops (start/end/delete/roster/mark-student)
 *   routes/records.routes.js  — student/session reads + mark + QR + preview
 *   routes/public.routes.js   — no-auth userId lookups (today/:userId, history, summary, flags)
 *   routes/excuses.routes.js  — absence excuse CRUD + SA review queue
 *   routes/admin.routes.js    — admin stats, CSV export, weekly/session charts
 *
 * Service-specific helpers in:
 *   lib/qr.js           — generateQRToken + buildQrUrl
 *   lib/restrictions.js — BSSID campus-WiFi validation (checkBssid)
 *
 * Modularised in Plan 11 phase 7. No Socket.io — all real-time updates go
 * through notification server (port 4009) via fire-and-forget fetch calls.
 *
 * Note: There are no admin BSSID CRUD endpoints in this service.
 * BssidLocation records are managed via the user-profile server (port 4007).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const prisma = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { errorHandler } = require('../../lib/errors');
const { tenantResolver } = require('../../lib/tenant-resolver');

const sessionsRoutes = require('./routes/sessions.routes');
const recordsRoutes  = require('./routes/records.routes');
const publicRoutes   = require('./routes/public.routes');
const excusesRoutes  = require('./routes/excuses.routes');
const adminRoutes    = require('./routes/admin.routes');

const PORT = 4003;
const app = express();

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// Serve uploaded excuse evidence files.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route mounts — one prefix per router so URL → file is readable at a glance.
//
// sessions: /api/attendance/session/start, /sessions/:id/end,
//           /course/:code/eligible-students, /sessions/:id (DELETE),
//           /sessions/:id/roster, /sessions/:id/mark-student
app.use('/api/attendance', sessionsRoutes);

// records: /api/attendance/today (auth), /live-sessions, /mark, /professor/today,
//          /session/:id/qr, /sessions, /preview/create-session, /student/:id/summary
app.use('/api/attendance', recordsRoutes);

// public: /api/attendance/today/:userId, /history/:userId, /summary/:userId, /flags/:userId
app.use('/api/attendance', publicRoutes);

// excuses: /api/attendance/excuse, /api/attendance/excuses/:userId,
//          /api/sa/attendance-excuses (GET + PATCH /:id)
app.use('/api', excusesRoutes);

// admin: /api/attendance/admin/stats, /api/attendance/export.csv,
//        /api/attendance/course/:code/weekly, /api/attendance/course/:code/sessions-stats
app.use('/api/attendance', adminRoutes);

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'attendance' }));

app.use(errorHandler);

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[attendance] listening on :${PORT}`);
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, prisma };
