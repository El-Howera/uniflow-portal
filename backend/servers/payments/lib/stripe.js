/**
 * payments/lib/stripe.js
 *
 * Stripe SDK wrapper. Same fail-soft pattern as backend/lib/firebase.js and
 * backend/lib/redis.js — when STRIPE_SECRET_KEY is missing, `getStripe()`
 * returns null and every endpoint that depends on Stripe returns a clear
 * structured 503. The rest of the payments service keeps working (invoice
 * listing, financial reports, payroll). This is critical because a fresh
 * clone of the repo without keys must still boot.
 *
 * Exports:
 *   getStripe()             — returns the lazy-initialised Stripe client or null
 *   isStripeConfigured()    — true iff STRIPE_SECRET_KEY is set
 *   stripeWebhookSecret()   — returns STRIPE_WEBHOOK_SECRET or null
 *   resolveSuccessUrl(req)  — picks STRIPE_SUCCESS_URL with sane fallback
 *   resolveCancelUrl(req)   — picks STRIPE_CANCEL_URL with sane fallback
 *   stripeCheckoutSchema    — Zod schema for POST /api/payments/stripe/checkout body
 */

'use strict';

const { z } = require('zod');

let cached = null;

/**
 * Lazy-initialises the Stripe Node client. Returns null when STRIPE_SECRET_KEY
 * is not configured, so callers can short-circuit instead of crashing.
 */
function getStripe() {
  if (cached !== null) return cached;
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) {
    cached = false;
    return null;
  }
  try {
    // Require lazily so a missing `stripe` package doesn't crash boot either.
    const Stripe = require('stripe');
    cached = new Stripe(key, {
      // Pin a stable API version to avoid silent behaviour drift when Stripe
      // ships new defaults. Update intentionally when you re-test.
      apiVersion: '2024-12-18.acacia',
      maxNetworkRetries: 2,
      timeout: 30_000,
    });
    return cached;
  } catch (err) {
    console.warn('[stripe] init failed:', err.message);
    cached = false;
    return null;
  }
}

function isStripeConfigured() {
  return !!getStripe();
}

function stripeWebhookSecret() {
  const s = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  return s || null;
}

function resolveSuccessUrl() {
  return (process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/student/payments/success').trim();
}

function resolveCancelUrl() {
  return (process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/student/payments').trim();
}

const stripeCheckoutSchema = z.object({
  invoiceId: z.string().min(1, 'invoiceId required'),
});

module.exports = {
  getStripe,
  isStripeConfigured,
  stripeWebhookSecret,
  resolveSuccessUrl,
  resolveCancelUrl,
  stripeCheckoutSchema,
};
