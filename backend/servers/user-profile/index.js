/**
 * user-profile / index.js  (bootstrap only)
 *
 * Port 4007.  Mounts all route modules and starts the server.
 * No business logic lives here — see routes/ and lib/.
 *
 * Mount order:
 *   1. authRouter           — /api/auth/*  + /api/verify* + /api/reset*
 *   2. profileRouter        — /api/profile/*
 *   3. settingsRouter       — /api/settings/*
 *   4. academicRouter       — /api/academic/*
 *   5. adminUsersRouter     — /api/admin/users + /api/admin/batch-*
 *   6. adminPowerRouter     — /api/admin/users/:id/{suspend,reset-password,…}
 *   7. adminPermRouter      — /api/admin/users/:id/permissions
 *   8. adminLocksRouter     — /api/admin/sign-in-locks
 *   9. adminExtCredRouter   — /api/admin/external-credits
 *  10. adminAuditorsRouter  — /api/admin/auditors
 *  11. adminReportsRouter   — /api/admin/reports/*
 *  12. adminSystemSettingsRouter — /api/public-settings + /api/admin/system-settings + roles
 *  13. adminSystemRouter    — /api/admin/overview + analytics + notifications + devices + me/*
 *  14. adminAuditRouter     — /api/admin/audit-logs + backups + health + …
 *  15. adminPoliciesRouter  — /api/admin/credit-limit-policy through repetition-policy (12 ep)
 *  16. adminPoliciesGradingRouter — /api/admin/honors-policy through grading-rules + recompute
 *
 * Non-obvious decisions:
 *   - All routers declare their full /api/... paths internally; app.use() here
 *     passes no prefix so paths are not doubled.
 *   - The original index.js had no errorHandler registration — routes handle
 *     their own errors with try/catch.  We preserve that here.
 *   - JWT_SECRET warning is emitted once at startup (same as original).
 *   - backup.restartScheduler is called inside the listen callback so it runs
 *     after the DB connection pool is ready.
 *   - process.on('SIGINT') is registered inside the listen callback (same as
 *     original) so it only fires after a successful bind.
 */

'use strict';

require('dotenv').config({ quiet: true });

const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');

const corsMiddleware          = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const prisma                  = require('../../lib/prisma');
const { tenantResolver }      = require('../../lib/tenant-resolver');
const backup                  = require('../../lib/backup');

// ── Route modules ─────────────────────────────────────────────────────────────
const authRouter                       = require('./routes/auth.routes');
const profileRouter                    = require('./routes/profile.routes');
const settingsRouter                   = require('./routes/settings.routes');
const academicRouter                   = require('./routes/academic.routes');
const adminSystemSettingsRouter        = require('./routes/admin-system-settings.routes');
const adminSystemRouter                = require('./routes/admin-system.routes');
const adminPoliciesGradingRouter       = require('./routes/admin-policies-grading.routes');

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT_PROFILE || 4007;

if (!process.env.JWT_SECRET) {
  console.warn('[user-profile] WARNING: JWT_SECRET env var not set - using insecure default. Set JWT_SECRET in .env before deploying.');
}

// Ensure avatar upload directory exists (multer does not create parent dirs).
const AVATAR_DIR = path.join(__dirname, 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// ── Global middleware ─────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// Serve uploaded files (avatars, announcements, requests, excuses,
// financial-aid) and chat photos through the storage layer — local disk or S3
// per UPLOADS_BACKEND. In prod, nginx proxies /uploads/* and /chat-photos/*
// here; in dev (no nginx) these routes serve directly. Keys mirror the on-disk
// layout under UPLOAD_ROOT, so the URLs the frontend stores never change.
const storage = require('../../lib/storage');
app.get('/uploads/*', storage.serveHandler(''));
app.get('/chat-photos/*', storage.serveHandler('chat-photos/'));

// ── Route mounts ──────────────────────────────────────────────────────────────
// All routers declare their full /api/... paths; no prefix needed here.
app.use(authRouter);
app.use(profileRouter);
app.use(settingsRouter);
app.use(academicRouter);
app.use(adminSystemSettingsRouter);
app.use(adminSystemRouter);
app.use(adminPoliciesGradingRouter);

// ── Start server ──────────────────────────────────────────────────────────────
// Gate on `require.main === module` so this file can be `require()`'d by
// supertest-based integration tests (Plan 21 Phase 2) without binding the port
// or starting the cron scheduler. When invoked directly via `node index.js`,
// the listen + scheduler boot still fire as before.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    // Boot the backup scheduler. Reads SystemSettings.backupFrequency.
    backup.restartScheduler({ prisma }).catch((e) => {
      console.warn('[backup] scheduler boot failed:', e.message);
    });

    console.log(`[user-profile] listening on :${PORT}`);

    process.on('SIGINT', async () => {
      console.log('[user-profile] shutting down');
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}

module.exports = { app, prisma };
