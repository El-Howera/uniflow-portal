/**
 * payments/routes/stripe-webhook.routes.js
 *
 * Stripe webhook endpoint. Mounted at /api/payments/stripe/webhook by
 * index.js BEFORE the global express.json() middleware so the raw request
 * body is preserved for signature verification (Stripe signs the byte-exact
 * payload, not the parsed JSON).
 *
 * Events handled:
 *   - checkout.session.completed         — primary success path. Creates the
 *                                          Transaction, updates Invoice +
 *                                          StudentAccount, releases any
 *                                          unpaid-fees lock for the user.
 *   - payment_intent.payment_failed      — logs the failure and records a
 *                                          `status='failed'` Transaction row
 *                                          so the student's history shows it.
 *   - charge.refunded                    — future: refund flow. Currently
 *                                          logged + ignored.
 *
 * Idempotency: every successful event upserts on
 * (tenantId, stripePaymentIntentId). Stripe's at-least-once delivery means
 * we WILL see the same event multiple times; the unique index guarantees
 * a duplicate insert raises P2002 which we catch and treat as success.
 *
 * Tenant scoping: the webhook arrives with no tenant header. We extract
 * the tenant ID from the Checkout Session metadata (set during checkout
 * creation) and wrap all Prisma writes in runWithTenant().
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma  = require('../../../lib/prisma');
const { runWithTenant } = require('../../../lib/tenant-context');
const log     = require('../../../lib/logger')('payments/stripe-webhook');
const {
  getStripe,
  isStripeConfigured,
  stripeWebhookSecret,
} = require('../lib/stripe');
const { generateReceiptNumber } = require('../lib/account');

// Route-level raw-body middleware is set up in index.js so it sits ahead of
// express.json(). This router only receives requests that already carry
// req.body as a Buffer.

router.post('/', async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'stripe_not_configured' });
  }
  const secret = stripeWebhookSecret();
  if (!secret) {
    log.warn('[stripe webhook] STRIPE_WEBHOOK_SECRET not set — refusing event');
    return res.status(503).json({ error: 'stripe_webhook_secret_missing' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'missing_signature' });
  if (!Buffer.isBuffer(req.body)) {
    // Wrong middleware order. Fail loud so we don't silently drop events.
    return res.status(500).json({
      error: 'webhook_body_not_raw',
      hint: 'Ensure express.raw() runs for /api/payments/stripe/webhook before express.json()',
    });
  }

  const stripe = getStripe();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    log.warn('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object, stripe);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      case 'charge.refunded':
        // TODO: future refund handling — for now just log.
        log.info('[stripe webhook] charge.refunded received (ignored):', event.data.object.id);
        break;

      default:
        // Acknowledge unknown event types so Stripe stops retrying. We could
        // log them but the dashboard already shows them.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // Returning a non-2xx tells Stripe to retry. We log and rethrow only
    // when we're confident the retry will succeed — otherwise we ack and
    // log to avoid an infinite retry loop.
    log.error('[stripe webhook] handler error:', err);
    res.status(500).json({ error: 'handler_failure' });
  }
});

// ── Event handlers ──────────────────────────────────────────────────────────

/**
 * Successful checkout. Creates the Transaction, marks the Invoice paid (or
 * partial), credits the StudentAccount, and releases any unpaid-fees lock
 * for the user if their balance is now clear.
 */
async function handleCheckoutSessionCompleted(session, stripe) {
  const tenantId  = session.metadata?.tenantId;
  const invoiceId = session.metadata?.invoiceId;
  const userId    = session.metadata?.userId;
  if (!tenantId || !invoiceId || !userId) {
    log.warn('[stripe webhook] session missing metadata; skipping:', session.id);
    return;
  }

  // Pull the PaymentIntent for canonical IDs. The session has `payment_intent`
  // as a string ID; we expand it for charge IDs + card details.
  const piId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id;
  if (!piId) {
    log.warn('[stripe webhook] session has no payment_intent:', session.id);
    return;
  }

  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ['latest_charge'],
  });
  const charge   = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const last4    = charge?.payment_method_details?.card?.last4 || null;
  const chargeId = charge?.id || null;

  // Stripe amounts are in the smallest currency unit (piastres for EGP).
  // session.amount_total is the total charged in piastres; convert to EGP.
  const amountPaid = (session.amount_total || 0) / 100;

  await runWithTenant(tenantId, async () => {
    // Idempotency: bail if we've already recorded this PaymentIntent.
    const existing = await prisma.transaction.findFirst({
      where: { stripePaymentIntentId: piId },
      select: { id: true },
    });
    if (existing) {
      log.info('[stripe webhook] duplicate event for PI', piId, '— skipping');
      return;
    }

    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId } });
    if (!invoice || invoice.userId !== userId) {
      log.warn('[stripe webhook] invoice mismatch:', { invoiceId, userId });
      return;
    }

    const newPaid    = Number(invoice.paid) + amountPaid;
    const newBalance = Math.max(0, Number(invoice.totalAmount) - newPaid);
    const fullyPaid  = newBalance <= 0.0001;

    try {
      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            paid:    newPaid,
            balance: fullyPaid ? 0 : newBalance,
            status:  fullyPaid ? 'paid' : 'partial',
            paidAt:  fullyPaid ? new Date() : null,
          },
        }),
        prisma.transaction.create({
          data: {
            userId,
            invoiceId,
            type:                  'payment',
            method:                'stripe',
            status:                'completed',
            amount:                amountPaid,
            description:           `Stripe payment for ${invoice.title}`,
            referenceNumber:       generateReceiptNumber(),
            cardLast4:             last4,
            stripeSessionId:       session.id,
            stripePaymentIntentId: piId,
            stripeChargeId:        chargeId,
          },
        }),
        prisma.studentAccount.update({
          where: { userId },
          data: {
            balance:         { decrement: amountPaid },
            totalPaid:       { increment: amountPaid },
            lastPaymentDate: new Date(),
          },
        }),
      ]);
    } catch (err) {
      // P2002 = unique constraint, meaning another webhook delivery raced us
      // and already inserted the Transaction. Safe to ignore.
      if (err && err.code === 'P2002') {
        log.info('[stripe webhook] race lost on PI', piId, '— other worker won');
        return;
      }
      throw err;
    }

    // Phase 2b — auto-release unpaid-fees lock if balance is now clear.
    try {
      const { releaseLockIfBalanceClear } = require('../lib/unpaid-fees-lock');
      await releaseLockIfBalanceClear(prisma, userId, tenantId);
    } catch (err) {
      // Module may not exist yet during Phase 1; log and move on. Phase 2 fills it in.
      if (err && err.code !== 'MODULE_NOT_FOUND') {
        log.warn('[stripe webhook] lock release failed:', err.message);
      }
    }
  });
}

/**
 * Records a failed payment so the student's transaction history shows the
 * attempt. Doesn't change the invoice or account balance.
 */
async function handlePaymentFailed(pi) {
  const tenantId  = pi.metadata?.tenantId;
  const invoiceId = pi.metadata?.invoiceId;
  const userId    = pi.metadata?.userId;
  if (!tenantId || !userId) return; // no scope to write into

  const amount = (pi.amount || 0) / 100;
  const reason = pi.last_payment_error?.message || 'Payment failed';

  await runWithTenant(tenantId, async () => {
    try {
      await prisma.transaction.create({
        data: {
          userId,
          invoiceId: invoiceId || null,
          type:                  'payment',
          method:                'stripe',
          status:                'failed',
          amount,
          description:           reason,
          referenceNumber:       generateReceiptNumber(),
          stripePaymentIntentId: pi.id,
        },
      });
    } catch (err) {
      if (err && err.code === 'P2002') return; // duplicate, fine
      throw err;
    }
  });
}

module.exports = router;
