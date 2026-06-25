/**
 * payments/routes/stripe.routes.js
 *
 * Stripe Checkout Session creation + post-payment status lookup. Mounted at
 * /api/payments/stripe by index.js using the normal JSON middleware.
 *
 * Endpoints:
 *   POST /api/payments/stripe/checkout
 *     Body: { invoiceId }
 *     Auth: requireAuth (student must own the invoice; admin/sa can charge any)
 *     Returns: { url, sessionId } — frontend redirects user to `url`
 *
 *   GET /api/payments/stripe/session/:sessionId
 *     Auth: requireAuth (must be the user who created the session)
 *     Returns: { status, paymentStatus, transaction? }
 *     The success page polls this to confirm the payment landed and to fetch
 *     the resulting Transaction row (created by the webhook).
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma  = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { requireCurrentTenant } = require('../../../lib/tenant-context');
const {
  getStripe,
  isStripeConfigured,
  resolveSuccessUrl,
  resolveCancelUrl,
  stripeCheckoutSchema,
} = require('../lib/stripe');

// ── Create Checkout Session ──────────────────────────────────────────────────

router.post('/checkout', requireAuth, async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      error: 'stripe_not_configured',
      hint: 'Set STRIPE_SECRET_KEY in the backend env',
    });
  }

  const parsed = stripeCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  const { invoiceId } = parsed.data;
  const userId = req.user.userId;

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true } },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Authorization: student can only pay their own invoices. Staff
    // (sa/admin/financial) can charge any.
    const role = req.user.role;
    const isStaff = ['admin', 'sa', 'financial'].includes(role);
    if (!isStaff && invoice.userId !== userId) {
      return res.status(403).json({ error: 'Cannot pay another user\'s invoice' });
    }

    const balance = Number(invoice.balance);
    if (balance <= 0) {
      return res.status(400).json({ error: 'Invoice already paid' });
    }

    const tenantId = requireCurrentTenant();
    const stripe   = getStripe();

    // Ensure a Stripe Customer exists for this user so future Saved-Card flows
    // can attach to them. Created lazily; the customer ID is persisted on User.
    let customerId = invoice.user?.stripeCustomerId || null;
    if (!customerId && invoice.user?.email) {
      const customer = await stripe.customers.create({
        email: invoice.user.email,
        name:  `${invoice.user.firstName || ''} ${invoice.user.lastName || ''}`.trim() || undefined,
        metadata: { tenantId, userId: invoice.user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: invoice.user.id },
        data:  { stripeCustomerId: customerId },
      });
    }

    // Stripe wants amounts in the smallest currency unit. EGP uses piastres
    // (1 EGP = 100 piastres). All UniFlow invoices are EGP today.
    const amountInPiastres = Math.round(balance * 100);

    const session = await stripe.checkout.sessions.create({
      mode:                 'payment',
      payment_method_types: ['card'],
      customer:             customerId || undefined,
      customer_email:       !customerId ? (invoice.user?.email || undefined) : undefined,
      line_items: [{
        price_data: {
          currency:     'egp',
          product_data: {
            name:        invoice.title || 'University fee',
            description: invoice.description || undefined,
          },
          unit_amount: amountInPiastres,
        },
        quantity: 1,
      }],
      success_url: `${resolveSuccessUrl()}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  resolveCancelUrl(),
      // Metadata is the bridge from Stripe back to our DB. The webhook reads
      // tenantId/invoiceId/userId out of session.metadata to scope writes.
      // We also stamp it on the PaymentIntent so the payment_failed path
      // (which only carries the PI, not the session) has the same context.
      metadata: { tenantId, invoiceId, userId: invoice.userId },
      payment_intent_data: {
        metadata: { tenantId, invoiceId, userId: invoice.userId },
        description: `UniFlow: ${invoice.title}`,
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[stripe checkout] failed:', err);
    res.status(500).json({ error: 'Failed to create checkout session', message: err.message });
  }
});

// ── Lookup session status (success page polls this) ──────────────────────────

router.get('/session/:sessionId', requireAuth, async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'stripe_not_configured' });
  }

  const { sessionId } = req.params;
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Authorisation: only the user who started the session (or staff) can read it.
    const role     = req.user.role;
    const isStaff  = ['admin', 'sa', 'financial'].includes(role);
    const ownerId  = session.metadata?.userId;
    if (!isStaff && ownerId && ownerId !== req.user.userId) {
      return res.status(403).json({ error: 'Cannot view another user\'s session' });
    }

    // Look up the Transaction the webhook should have created.
    const tx = await prisma.transaction.findFirst({
      where: { stripeSessionId: sessionId },
    });

    res.json({
      status:        session.status,         // 'open' | 'complete' | 'expired'
      paymentStatus: session.payment_status, // 'unpaid' | 'paid' | 'no_payment_required'
      transaction:   tx,
    });
  } catch (err) {
    console.error('[stripe session lookup] failed:', err);
    res.status(500).json({ error: 'Failed to look up session', message: err.message });
  }
});

module.exports = router;
