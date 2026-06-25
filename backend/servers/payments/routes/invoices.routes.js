/**
 * payments/routes/invoices.routes.js
 *
 * Invoice retrieval + transaction history. Prefix: /api/payments
 * Also handles /api/sa/all-financials (SA/admin student summaries).
 *
 * Endpoints (4):
 *   GET  /api/payments/invoice/:invoiceId   — single invoice detail with transactions
 *   GET  /api/payments/invoices/:odID?      — paginated invoice list for a user
 *   GET  /api/payments/transactions/:odID   — paginated transaction history for a user
 *   GET  /api/sa/all-financials             — SA/admin: all student financial summaries
 *
 * The /api/sa/all-financials route is mounted via the /api/sa prefix in index.js
 * and therefore lives in this router under the path /all-financials. The router
 * is mounted at two prefixes in index.js to keep the URL mapping transparent.
 *
 * NOTE: the legacy POST /api/payments/pay endpoint was REMOVED — all payments
 * now flow through Stripe Checkout. See routes/stripe.routes.js for the
 * replacement (POST /api/payments/stripe/checkout returns a redirect URL).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const prisma  = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { resolveUser }              = require('../../../lib/users');

// ── Single invoice detail ─────────────────────────────────────────────────────

router.get('/invoice/:invoiceId', requireAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId },
      include: { transactions: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ data: invoice });
  } catch (error) {
    console.error('Invoice detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Paginated invoice list ────────────────────────────────────────────────────

router.get('/invoices/:odID?', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const { userId, status, limit = '20', offset = '0' } = req.query;
    const take = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = parseInt(offset, 10) || 0;

    const where = {};

    if (odID) {
      const lookupKey = odID === 'current' ? req.user.userId : odID;
      const user = await resolveUser(lookupKey);
      if (!user) return res.status(404).json({ error: 'User not found' });
      where.userId = user.id;
    } else if (userId) {
      where.userId = userId;
    }

    if (status) where.status = status;

    const [invoices, total] = await prisma.$transaction([
      prisma.invoice.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        take,
        skip,
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ data: invoices, total, limit: take, offset: skip });
  } catch (error) {
    console.error('Invoice list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Transaction history for a user ───────────────────────────────────────────

router.get('/transactions/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const { limit = '20', offset = '0' } = req.query;
    const take = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = parseInt(offset, 10) || 0;

    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.transaction.count({ where: { userId: user.id } }),
    ]);

    res.json({ data: transactions, total, limit: take, offset: skip });
  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

module.exports = router;
