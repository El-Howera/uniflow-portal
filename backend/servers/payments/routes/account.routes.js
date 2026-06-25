/**
 * payments/routes/account.routes.js
 *
 * Student-facing account management endpoints. Prefix: /api/payments
 * Also handles:
 *   - /api/sa/all-financials  (SA / admin overview)
 *
 * Endpoints (13):
 *   GET  /api/payments/account/:odID              — account summary + invoices
 *   GET  /api/payments/dashboard/:odID            — full dashboard aggregate
 *   GET  /api/payments/methods/:odID              — list saved payment methods
 *   POST /api/payments/methods/:odID              — add payment method
 *   PATCH/api/payments/methods/:odID/:methodId    — update method (set default)
 *   DELETE /api/payments/methods/:odID/:methodId  — remove method
 *   GET  /api/payments/service-fees               — list active service fees
 *   POST /api/payments/service-fees               — admin: create service fee
 *   PUT  /api/payments/service-fees/:id           — admin: update service fee
 *   PATCH/api/payments/service-fees/:id/active    — admin: toggle active flag
 *   DELETE /api/payments/service-fees/:id         — admin: hard-delete fee
 *   POST /api/payments/service-request            — student: submit service request
 *   GET  /api/payments/service-requests/:odID     — list user service requests
 *   GET  /api/payments/receipt/:receiptNumber      — receipt lookup
 *   GET  /api/sa/all-financials                   — SA/admin student summaries
 */

'use strict';

const express     = require('express');
const router      = express.Router();
const prisma      = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { hasPermission }            = require('../../../lib/permissions');
const { resolveUser }              = require('../../../lib/users');
const {
  serviceFeeCreateSchema,
  serviceFeeUpdateSchema,
} = require('../lib/account');

// ── Account summary ───────────────────────────────────────────────────────────

router.get('/account/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'Student not found' });

    const account = await prisma.studentAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0, totalPaid: 0 },
    });

    const [invoices, recentInvoices] = await prisma.$transaction([
      prisma.invoice.findMany({ where: { userId: user.id } }),
      prisma.invoice.findMany({
        where: { userId: user.id },
        orderBy: { dueDate: 'desc' },
        take: 10,
      }),
    ]);

    const totalPaidFromInvoices = invoices.reduce((s, i) => s + parseFloat(i.paid || 0), 0);
    const outstandingFromInvoices = invoices
      .filter(i => ['pending', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + parseFloat(i.balance || 0), 0);

    const summary = {
      totalBilled:        invoices.reduce((s, i) => s + parseFloat(i.amount), 0),
      totalPaid:          totalPaidFromInvoices || parseFloat(account.totalPaid),
      totalAid:           parseFloat(account.financialAidApplied),
      outstandingBalance: outstandingFromInvoices,
      overdueAmount:      invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.balance), 0),
      invoiceCount:       invoices.length,
      paidInvoices:       invoices.filter(i => i.status === 'paid').length,
      pendingInvoices:    invoices.filter(i => ['pending', 'partial'].includes(i.status)).length,
      overdueInvoices:    invoices.filter(i => i.status === 'overdue').length,
    };

    res.json({ account, summary, invoices: recentInvoices });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Payment dashboard ─────────────────────────────────────────────────────────

router.get('/dashboard/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const account = await prisma.studentAccount.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0, totalPaid: 0 },
    });

    const [allInvoices, recentInvoices, recentTransactions, paymentMethods] = await prisma.$transaction([
      prisma.invoice.findMany({ where: { userId: user.id } }),
      prisma.invoice.findMany({
        where: { userId: user.id },
        orderBy: { dueDate: 'desc' },
        take: 5,
      }),
      prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.paymentMethod.findMany({
        where: { userId: user.id, isActive: true },
        orderBy: { isDefault: 'desc' },
      }),
    ]);

    const totalPaidFromInvoices = allInvoices.reduce((s, i) => s + parseFloat(i.paid || 0), 0);
    const outstandingFromInvoices = allInvoices
      .filter(i => ['pending', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + parseFloat(i.balance || 0), 0);

    const summary = {
      totalBilled:        allInvoices.reduce((s, i) => s + parseFloat(i.amount), 0),
      totalPaid:          totalPaidFromInvoices || parseFloat(account.totalPaid),
      totalAid:           parseFloat(account.financialAidApplied),
      outstandingBalance: outstandingFromInvoices,
      overdueAmount:      allInvoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.balance), 0),
      invoiceCount:       allInvoices.length,
      paidInvoices:       allInvoices.filter(i => i.status === 'paid').length,
      pendingInvoices:    allInvoices.filter(i => ['pending', 'partial'].includes(i.status)).length,
      overdueInvoices:    allInvoices.filter(i => i.status === 'overdue').length,
    };

    res.json({ account, summary, recentInvoices, recentTransactions, paymentMethods });
  } catch (error) {
    console.error('Payment dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Payment methods ───────────────────────────────────────────────────────────

router.get('/methods/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const methods = await prisma.paymentMethod.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { isDefault: 'desc' },
    });
    res.json({ data: methods });
  } catch (error) {
    console.error('Payment methods error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/methods/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const {
      type,
      brand,
      last4,
      expiryMonth,
      expiryYear,
      expiryDate,
      holderName,
      nickname,
      isDefault = false,
      setDefault,
    } = req.body || {};

    if (!type) return res.status(400).json({ error: 'type is required' });

    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const wantDefault = Boolean(isDefault || setDefault);

    if (wantDefault) {
      await prisma.paymentMethod.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const monthNum = Number.isFinite(Number(expiryMonth)) ? Number(expiryMonth) : null;
    const yearNum  = Number.isFinite(Number(expiryYear))  ? Number(expiryYear)  : null;
    const normalizedExpiryDate =
      expiryDate ||
      (monthNum && yearNum
        ? `${String(monthNum).padStart(2, '0')}/${String(yearNum).slice(-2)}`
        : null);

    const method = await prisma.paymentMethod.create({
      data: {
        userId: user.id,
        type,
        brand:          brand         || null,
        last4:          last4         || null,
        expiryMonth:    monthNum,
        expiryYear:     yearNum,
        expiryDate:     normalizedExpiryDate,
        holderName:     holderName    || null,
        nickname:       nickname      || null,
        isDefault:      wantDefault,
        isActive:       true,
      },
    });

    res.status(201).json({ success: true, data: method, method });
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/methods/:odID/:methodId', requireAuth, async (req, res) => {
  try {
    const { odID, methodId } = req.params;
    const { isDefault } = req.body || {};

    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = await prisma.paymentMethod.findFirst({ where: { id: methodId } });
    if (!existing || existing.userId !== user.id) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    if (isDefault === true) {
      await prisma.$transaction([
        prisma.paymentMethod.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        }),
        prisma.paymentMethod.update({
          where: { id: methodId },
          data: { isDefault: true },
        }),
      ]);
    } else if (isDefault === false) {
      await prisma.paymentMethod.update({
        where: { id: methodId },
        data: { isDefault: false },
      });
    }

    const fresh = await prisma.paymentMethod.findFirst({ where: { id: methodId } });
    res.json({ success: true, data: fresh });
  } catch (error) {
    console.error('Update payment method error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/methods/:odID/:methodId', requireAuth, async (req, res) => {
  try {
    const { odID, methodId } = req.params;
    const lookupKey = odID === 'current' ? req.user.userId : odID;
    const user = await resolveUser(lookupKey);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const method = await prisma.paymentMethod.findFirst({ where: { id: methodId } });
    if (!method || method.userId !== user.id) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    await prisma.paymentMethod.delete({ where: { id: methodId } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Service fees ──────────────────────────────────────────────────────────────

router.get('/service-fees', requireAuth, async (req, res) => {
  try {
    const fees = await prisma.serviceFee.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: fees });
  } catch (error) {
    console.error('Service fees error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/service-fees', requireAuth, async (req, res) => {
  if (!['admin', 'sa'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const parsed = serviceFeeCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
  }
  try {
    const created = await prisma.serviceFee.create({
      data: {
        name:        parsed.data.name,
        description: parsed.data.description ?? null,
        amount:      parsed.data.amount,
        category:    parsed.data.category,
        ...(parsed.data.processingDays !== undefined ? { processingDays: parsed.data.processingDays } : {}),
        ...(parsed.data.variable       !== undefined ? { variable:       parsed.data.variable       } : {}),
        isActive: true,
      },
    });
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    console.error('Create service fee error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.put('/service-fees/:id', requireAuth, async (req, res) => {
  if (!['admin', 'sa'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const parsed = serviceFeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
  }
  try {
    const data = {};
    const { name, description, amount, category, processingDays, variable, isActive } = parsed.data;
    if (name          !== undefined) data.name          = name;
    if (description   !== undefined) data.description   = description;
    if (amount        !== undefined) data.amount        = amount;
    if (category      !== undefined) data.category      = category;
    if (processingDays !== undefined) data.processingDays = processingDays;
    if (variable      !== undefined) data.variable      = variable;
    if (isActive      !== undefined) data.isActive      = isActive;

    const updated = await prisma.serviceFee.update({ where: { id: req.params.id }, data });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Update service fee error:', error);
    res.status(error.code === 'P2025' ? 404 : 500).json({
      error: error.code === 'P2025' ? 'Service fee not found' : (error.message || 'Internal server error'),
    });
  }
});

router.patch('/service-fees/:id/active', requireAuth, async (req, res) => {
  if (!['admin', 'sa'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const allowed = await hasPermission(prisma, req.user.userId, 'Financial Management', 'write');
  if (!allowed) {
    return res.status(403).json({
      error: 'Your role does not grant Financial Management:write. Update Settings → Roles & Permissions.',
    });
  }
  const next = req.body?.isActive === true || req.body?.isActive === 'true';
  try {
    const updated = await prisma.serviceFee.update({
      where: { id: req.params.id },
      data: { isActive: next },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(error.code === 'P2025' ? 404 : 500).json({
      error: error.code === 'P2025' ? 'Service fee not found' : (error.message || 'Internal server error'),
    });
  }
});

router.delete('/service-fees/:id', requireAuth, async (req, res) => {
  if (!['admin', 'sa'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const allowed = await hasPermission(prisma, req.user.userId, 'Financial Management', 'delete');
  if (!allowed) {
    return res.status(403).json({
      error: 'Your role does not grant Financial Management:delete. Update Settings → Roles & Permissions.',
    });
  }
  const force = req.query.force === 'true';
  try {
    const dependentCount = await prisma.serviceRequest.count({
      where: { serviceFeeId: req.params.id },
    });
    if (dependentCount > 0 && !force) {
      return res.status(409).json({
        error: `This fee has ${dependentCount} historical service request(s). ` +
          'Disable instead, or pass ?force=true to permanently delete (request history is kept; FK is nulled).',
      });
    }
    await prisma.$transaction(async (tx) => {
      if (dependentCount > 0) {
        await tx.serviceRequest.updateMany({
          where: { serviceFeeId: req.params.id },
          data: { serviceFeeId: null },
        });
      }
      await tx.serviceFee.delete({ where: { id: req.params.id } });
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Hard-delete service fee error:', error);
    res.status(error.code === 'P2025' ? 404 : 500).json({
      error: error.code === 'P2025' ? 'Service fee not found' : (error.message || 'Internal server error'),
    });
  }
});

// ── Service requests ──────────────────────────────────────────────────────────

router.post('/service-request', requireAuth, async (req, res) => {
  try {
    const { odID, serviceId, notes } = req.body;
    if (!odID || !serviceId) {
      return res.status(400).json({ error: 'odID and serviceId are required' });
    }

    const user = await prisma.user.findFirst({ where: { odId: odID } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let serviceFeeId = null;
    let serviceName  = serviceId;
    const fee = await prisma.serviceFee.findFirst({ where: { id: serviceId } }).catch(() => null);
    if (fee) {
      serviceFeeId = fee.id;
      serviceName  = fee.name;
    }

    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        userId: user.id,
        serviceFeeId,
        serviceName,
        notes:  notes || null,
        status: 'pending',
      },
    });

    res.json({ success: true, requestId: serviceRequest.id, data: serviceRequest });
  } catch (error) {
    console.error('Service request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/service-requests/:odID', requireAuth, async (req, res) => {
  try {
    const { odID } = req.params;
    const user = await resolveUser(odID);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const requests = await prisma.serviceRequest.findMany({
      where: { userId: user.id },
      include: { serviceFee: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: requests });
  } catch (error) {
    console.error('Service requests list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Receipt lookup ────────────────────────────────────────────────────────────

router.get('/receipt/:receiptNumber', requireAuth, async (req, res) => {
  try {
    const { receiptNumber } = req.params;
    const transaction = await prisma.transaction.findFirst({
      where: { referenceNumber: receiptNumber },
      include: { invoice: true },
    });
    if (!transaction) return res.status(404).json({ error: 'Receipt not found' });
    res.json({ data: transaction });
  } catch (error) {
    console.error('Receipt lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

module.exports = router;
