/**
 * UniFlow Course Content Server — bootstrap
 * Port: 4005
 *
 * Responsibilities:
 *   - Initialise Express + middleware stack (CORS, cookie-parser, JSON, tenant resolver).
 *   - Serve uploaded files via express.static under /files (recordings + forms are
 *     subdirectories; one mount covers them all).
 *   - Mount all route modules under their respective prefixes.
 *   - Boot-time: call ensureCourseGradebookConfigTable() so the lazily-created
 *     `course_gradebook_config` table exists before the first request can SELECT
 *     from it (avoids noisy Prisma raw-SQL errors on cold boot).
 *   - Graceful shutdown on SIGINT.
 *
 * Mount table (one prefix per router):
 *   /api/courses        → courses.routes.js      (catalog, materials listing, lectures)
 *   /api/courses        → materials.routes.js     (upload, delete; shares prefix)
 *   /api                → assignments.routes.js   (mixed prefix: /users, /submissions, /courses, /grades)
 *   /api/quizzes        → quizzes.routes.js
 *   /api                → gradebook.routes.js     (mixed prefix: /gradebook, /me, /admin/users, /courses, /grades)
 *   /api                → grade-confirmation.routes.js  (/grades/:courseCode/...)
 *   /api                → live-sessions.routes.js (mixed prefix: /live-sessions, /sessions)
 *   /api                → forms.routes.js         (/forms)
 *   /api                → professor-views.routes.js (/professor/*)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const prisma = require('../../lib/prisma');
const { errorHandler } = require('../../lib/errors');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');
const { uploadDir } = require('./lib/file-upload');

// ── Route modules ─────────────────────────────────────────────────────────────
const coursesRouter           = require('./routes/courses.routes');
const materialsRouter         = require('./routes/materials.routes');
const assignmentsRouter       = require('./routes/assignments.routes');
const quizzesRouter           = require('./routes/quizzes.routes');
const gradebookRouter         = require('./routes/gradebook.routes');
const gradeConfirmationRouter = require('./routes/grade-confirmation.routes');
const liveSessionsRouter      = require('./routes/live-sessions.routes');
const formsRouter             = require('./routes/forms.routes');
const professorViewsRouter    = require('./routes/professor-views.routes');

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.CONTENT_PORT || 4005;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// ── Static file serving ───────────────────────────────────────────────────────
// /files/* maps to the `content/` storage prefix (S3 or local disk, per
// UPLOADS_BACKEND). Recordings are the exception — they live only on the local
// volume (too large for S3) and are served straight from disk.
const storage = require('../../lib/storage');
app.get('/files/*', async (req, res) => {
  try {
    const rest = req.params[0] || '';
    if (rest.startsWith('recordings/')) {
      const p = path.join(uploadDir, rest);
      if (!fs.existsSync(p)) return res.status(404).end();
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(p);
    }
    const obj = await storage.getObject(`content/${rest}`);
    if (!obj) return res.status(404).end();
    res.setHeader('Content-Type', obj.contentType || storage.guessType(rest));
    if (obj.contentLength != null) res.setHeader('Content-Length', obj.contentLength);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    obj.stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    obj.stream.pipe(res);
  } catch (e) {
    console.warn('[content] /files serve error:', e?.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Courses prefix — catalog, materials listing, lectures, progress, remarks.
app.use('/api/courses', coursesRouter);

// All other routers use full paths internally and are mounted at /api.
// This includes routes under /api/courses/... (materials upload, assignments CRUD),
// /api/users/..., /api/submissions/..., /api/gradebook/..., /api/me/...,
// /api/admin/..., /api/ta/..., /api/professor/..., /api/live-sessions/...,
// /api/sessions/..., /api/forms/..., /api/grades/...
app.use('/api', materialsRouter);
app.use('/api', assignmentsRouter);
app.use('/api', gradebookRouter);
app.use('/api', gradeConfirmationRouter);
app.use('/api', liveSessionsRouter);
app.use('/api', formsRouter);
app.use('/api', professorViewsRouter);

// Quizzes — dedicated prefix (router uses relative paths like /, /:quizId, etc.).
app.use('/api/quizzes', quizzesRouter);

// ── File download (single filename under content/) ────────────────────────────
app.get('/api/files/:fileName', async (req, res) => {
  try {
    const obj = await storage.getObject(`content/${req.params.fileName}`);
    if (!obj) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.fileName}"`);
    if (obj.contentType) res.setHeader('Content-Type', obj.contentType);
    obj.stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    obj.stream.pipe(res);
  } catch (e) {
    console.warn('[content] /api/files error:', e?.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────

// Ensure the lazily-created `course_gradebook_config` table exists before any
// request can SELECT from it. Two read paths use a swallowed try/catch but
// Prisma still logs the raw SQL error to the console on a cold boot without
// the table — creating it up-front eliminates that noise.
async function ensureCourseGradebookConfigTable() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "course_gradebook_config" (
        "course_id"   TEXT NOT NULL,
        "tenant_id"   TEXT NOT NULL DEFAULT '',
        "midterm_max" INTEGER NOT NULL DEFAULT 30,
        "final_max"   INTEGER NOT NULL DEFAULT 60,
        "updated_at"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("tenant_id", "course_id")
      )
    `);
    // Legacy DBs may have the table without tenant_id — backfill safely.
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "course_gradebook_config"
        ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT ''
    `);
  } catch (err) {
    console.warn('[course-content] ensureCourseGradebookConfigTable failed:', err.message);
  }
}

// Bind to 0.0.0.0 so a phone on the same LAN can reach the dev server.
// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', async () => {
    await ensureCourseGradebookConfigTable();
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[course-content] listening on :${PORT}`);
    }
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

module.exports = { app, prisma, ensureCourseGradebookConfigTable };
