/**
 * UniFlow Registration Server — bootstrap only (Plan 11 Phase 8 modularisation)
 * Port: 4002
 *
 * Middleware chain → route mounts → error handler.
 * All business logic lives in routes/ and lib/.
 *
 * Mount map:
 *   /api                  ← catalog.routes.js              (courses, departments, reg status)
 *   /api/registrations    ← registration-query.routes.js   (GET /:userId)
 *   /api/registrations    ← registration-register.routes.js (POST /register)
 *   /api/registrations    ← registration-drop.routes.js    (POST /drop /withdraw /check-conflicts /swap-section)
 *   /api/registrations    ← advisor.routes.js              (PATCH /:id/advisor-approve)
 *   /api/schedule         ← schedule.routes.js   (GET /:userId)
 *   /api/professor        ← advisor.routes.js    (GET /advisees)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const express = require('express');
const cookieParser = require('cookie-parser');

const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');
const { errorHandler } = require('../../lib/errors');

// ── Route modules ─────────────────────────────────────────────────────────────

const catalogRouter              = require('./routes/catalog.routes');
const registrationQueryRouter    = require('./routes/registration-query.routes');
const registrationRegisterRouter = require('./routes/registration-register.routes');
const registrationDropRouter     = require('./routes/registration-drop.routes');
const scheduleRouter             = require('./routes/schedule.routes');
const advisorRouter         = require('./routes/advisor.routes');

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.REG_PORT || 4002;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(tenantResolver({ strict: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check — unauthenticated, no tenant required.
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'registration', port: PORT });
});

app.use('/api',                   catalogRouter);
// Three routers share the /api/registrations prefix; Express chains in mount order.
app.use('/api/registrations',     registrationQueryRouter);    // GET /:userId
app.use('/api/registrations',     registrationRegisterRouter); // POST /register
app.use('/api/registrations',     registrationDropRouter);     // POST /drop /withdraw /check-conflicts /swap-section
// Advisor PATCH /:id/advisor-approve also lives under /api/registrations.
app.use('/api/registrations',     advisorRouter);
app.use('/api/schedule',          scheduleRouter);
app.use('/api/professor',         advisorRouter);

// ── Error handler (must be last) ──────────────────────────────────────────────

app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────

// Plan 21 Phase 2 — gate on require.main so supertest can require() this
// module without binding the port.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[registration] listening on :${PORT}`);
    }
  });
}

// `prisma` is lazy-imported inside individual route files; tests that need
// it can import directly from `backend/lib/prisma`.
module.exports = { app };
