/**
 * UniFlow Payments & Financial API Server
 * Port: 4004
 *
 * Bootstrap only. All route logic lives in:
 *   - routes/account.routes.js        (/api/payments/* — account, methods, service-fees)
 *   - routes/invoices.routes.js       (/api/payments/* — pay, invoice(s), transactions)
 *   - routes/financial-aid.routes.js  (/api/financial-aid/* and /api/admin/financial-aid/*)
 *   - routes/me.routes.js             (/api/me/* — self-service payslips)
 *
 * Shared helpers and Zod schemas live in lib/account.js.
 *
 * Modularised in Plan 11 phase 5.
 */

'use strict';

const express      = require('express');
const cookieParser = require('cookie-parser');

const prisma          = require('../../lib/prisma');
const corsMiddleware  = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { tenantResolver } = require('../../lib/tenant-resolver');
const { FIN_AID_UPLOAD_DIR } = require('./lib/account');

const accountRoutes        = require('./routes/account.routes');
const invoicesRoutes       = require('./routes/invoices.routes');
const financialAidRoutes   = require('./routes/financial-aid.routes');
const meRoutes             = require('./routes/me.routes');
const stripeRoutes         = require('./routes/stripe.routes');
const stripeWebhookRoutes  = require('./routes/stripe-webhook.routes');

const PORT = 4004;
const app  = express();

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());

// Stripe webhook MUST be mounted BEFORE express.json() so the raw body is
// preserved for signature verification. tenantResolver is also skipped here
// because the webhook arrives from Stripe with no auth/tenant headers — the
// route handler extracts the tenant from the event metadata and wraps Prisma
// writes in runWithTenant() itself.
// NOTE: The router's POST / handler is mounted directly here, so we explicitly
// set up the raw body middleware for this one endpoint before the main json().
const webhookRouter = express.Router();
webhookRouter.post(
  '/',
  express.raw({ type: 'application/json', limit: '2mb' }),
  stripeWebhookRoutes,
);
app.use('/api/payments/stripe/webhook', webhookRouter);

app.use(express.json({ limit: '10mb' }));
app.use(tenantResolver({ strict: false }));

// Serve financial-aid uploaded documents before auth so the admin review UI
// can render attachments without bearer-token constraints on static files.
app.use('/uploads/financial-aid', express.static(FIN_AID_UPLOAD_DIR));

// ── Route mounts ───────────────────────────────────────────────────────────────
//
// One mount prefix per router where possible. The financial-aid router is
// mounted twice (student prefix + admin prefix) because its paths use role
// middleware to disambiguate callers on the same HTTP method+path.

app.use('/api/payments/stripe',     stripeRoutes);   // /checkout, /session/:id
app.use('/api/payments',            accountRoutes);
app.use('/api/payments',            invoicesRoutes);
app.use('/api/financial-aid',       financialAidRoutes);
app.use('/api/admin/financial-aid', financialAidRoutes);
app.use('/api/me',                  meRoutes);

app.get('/', (_req, res) => res.json({ status: 'ok', service: 'payments' }));

// ── Unpaid-fees auto-lock cron ────────────────────────────────────────────────
// Runs every day at 03:00 server time (configurable via UNPAID_LOCK_CRON).
// Gated on UNPAID_LOCK_ENABLED so dev/CI can opt out by setting it to "false".
// Skipped entirely under supertest (require.main !== module).
function startUnpaidFeesLockCron() {
  const enabled = (process.env.UNPAID_LOCK_ENABLED || 'true').toLowerCase() !== 'false';
  if (!enabled) {
    console.log('[unpaid-lock] cron disabled via UNPAID_LOCK_ENABLED=false');
    return;
  }
  let cron;
  try {
    cron = require('node-cron');
  } catch {
    console.warn('[unpaid-lock] node-cron not installed; auto-lock disabled');
    return;
  }
  const { scanAndCreateLocks } = require('./lib/unpaid-fees-lock');
  const schedule = (process.env.UNPAID_LOCK_CRON || '0 3 * * *').trim();
  if (!cron.validate(schedule)) {
    console.warn(`[unpaid-lock] invalid UNPAID_LOCK_CRON "${schedule}", using default 0 3 * * *`);
  }
  const finalSchedule = cron.validate(schedule) ? schedule : '0 3 * * *';
  cron.schedule(finalSchedule, async () => {
    const startedAt = Date.now();
    try {
      const summary = await scanAndCreateLocks(prisma);
      const ms = Date.now() - startedAt;
      console.log(
        `[unpaid-lock] cron complete in ${ms}ms — tenants=${summary.tenants} scanned=${summary.scanned} ` +
        `locked=${summary.locked} alreadyLocked=${summary.alreadyLocked} errors=${summary.errors}`,
      );
    } catch (err) {
      console.error('[unpaid-lock] cron failure:', err);
    }
  });
  console.log(`[unpaid-lock] cron scheduled "${finalSchedule}" (grace=${process.env.UNPAID_LOCK_GRACE_DAYS || 14}d)`);
}

// ── Start ──────────────────────────────────────────────────────────────────────

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[payments] listening on :${PORT}`);
    startUnpaidFeesLockCron();
  });

  process.on('SIGINT',  async () => { await prisma.$disconnect(); process.exit(0); });
  process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
}

module.exports = { app, prisma };
