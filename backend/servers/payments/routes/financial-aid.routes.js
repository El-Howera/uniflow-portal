/**
 * payments/routes/financial-aid.routes.js
 *
 * Financial aid request lifecycle: student submission, document upload,
 * and admin/SA review (approve / reject).
 *
 * Mount points in index.js (two prefixes, same router — paths don't collide):
 *   app.use('/api/financial-aid',       financialAidRoutes)
 *   app.use('/api/admin/financial-aid', financialAidRoutes)
 *
 * Effective URL → handler mapping:
 *   POST  /api/financial-aid                        — student: submit aid request
 *   GET   /api/financial-aid/me                     — student: list own requests
 *   PATCH /api/financial-aid/me/:id/withdraw        — student: withdraw pending request
 *   POST  /api/financial-aid/upload                 — student: upload supporting doc
 *   GET   /api/admin/financial-aid                  — admin/SA: list all (filter by status)
 *   GET   /api/admin/financial-aid/:id              — admin/SA: single request detail
 *   PATCH /api/admin/financial-aid/:id              — admin/SA: approve or reject
 *
 * Two-prefix mount trick: student routes match on /api/financial-aid/*
 * (short paths). Admin routes match on /api/admin/financial-aid/* which maps
 * to the same router paths — but those paths (/  and /:id) can't collide with
 * /me or /me/:id/withdraw because the literal "me" segment disambiguates.
 * requireRole('student') on student routes rejects admin callers even if path
 * overlaps.
 *
 * Static: /uploads/financial-aid → served from index.js before auth.
 *
 * Decision: cross-service notification calls use best-effort setImmediate so
 * HTTP errors in port 4009 never fail the primary response.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const prisma  = require('../../../lib/prisma');
const storage = require('../../../lib/storage');
const { requireAuth, requireRole, requireScope } = require('../../../lib/auth');
const { writeAudit }               = require('../../../lib/audit');
const {
  finAidCreateSchema,
  finAidDecisionSchema,
  finAidUpload,
} = require('../lib/account');

// ── Student: submit ───────────────────────────────────────────────────────────

router.post('/', requireAuth, requireRole('student'), async (req, res) => {
  const parsed = finAidCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  try {
    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const recentApproved = await prisma.financialAidRequest.findFirst({
      where: {
        userId:     req.user.userId,
        status:     'approved',
        reviewedAt: { gte: yearAgo },
      },
      select: { id: true, reviewedAt: true },
    });
    if (recentApproved) {
      return res.status(409).json({
        error:      'already_approved_this_year',
        message:    'You already have an approved financial aid request within the last 12 months.',
        previousId: recentApproved.id,
        reviewedAt: recentApproved.reviewedAt,
      });
    }

    const created = await prisma.financialAidRequest.create({
      data: {
        userId:          req.user.userId,
        requestedAmount: data.requestedAmount,
        justification:   data.justification,
        applicantIncome: data.applicantIncome ?? null,
        dependents:      data.dependents      ?? null,
        supportingDocs:  data.supportingDocs  ?? [],
        status:          'pending',
      },
    });

    // Notify reviewers (admins + SAs in this tenant) that a request is waiting.
    // Best-effort: broadcast is requireAuth-only so the student's token works;
    // the targetRole query is tenant-scoped by the Prisma extension.
    const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
    setImmediate(() => {
      ['admin', 'sa'].forEach((role) => {
        fetch(`${notifUrl}/api/notifications/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers['authorization'] || '',
            Cookie:        req.headers['cookie']        || '',
          },
          body: JSON.stringify({
            targetRole:    role,
            title:         'New Financial Aid Request',
            content:       'A student submitted a financial aid request awaiting review.',
            priority:      'normal',
            type:          'info',
            senderId:      req.user.userId,
            referenceId:   created.id,
            referenceType: 'FinancialAidRequest',
          }),
        }).catch((e) => console.warn('[financial-aid] staff notify failed:', e.message));
      });
    });

    return res.status(201).json({ ok: true, request: created });
  } catch (error) {
    console.error('Financial aid create error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Student: list own requests ────────────────────────────────────────────────

router.get('/me', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const requests = await prisma.financialAidRequest.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ requests });
  } catch (error) {
    console.error('Financial aid me error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Student: withdraw ─────────────────────────────────────────────────────────

router.patch('/me/:id/withdraw', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const existing = await prisma.financialAidRequest.findFirst({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.userId !== req.user.userId) return res.status(403).json({ error: 'Not your request' });
    if (existing.status !== 'pending') {
      return res.status(400).json({
        error:   'invalid_state',
        message: `Cannot withdraw a request in status '${existing.status}'`,
      });
    }
    const updated = await prisma.financialAidRequest.update({
      where: { id: existing.id },
      data:  { status: 'withdrawn' },
    });
    return res.json({ ok: true, request: updated });
  } catch (error) {
    console.error('Financial aid withdraw error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Student: upload supporting doc ────────────────────────────────────────────

router.post('/upload', requireAuth, requireRole('student'), (req, res) => {
  finAidUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large (max 10 MB)'
        : err.message || 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    try {
      const { filename } = await storage.saveUpload('financial-aid', req.file);
      return res.status(201).json({
        ok:        true,
        url:       `/uploads/financial-aid/${filename}`,
        name:      req.file.originalname,
        sizeBytes: req.file.size,
      });
    } catch (e) {
      console.error('[financial-aid] upload save error:', e?.message);
      return res.status(500).json({ error: 'Failed to store upload' });
    }
  });
});

// ── Admin/SA: list all requests ───────────────────────────────────────────────
// Mounted at /api/admin/financial-aid in index.js → GET /api/admin/financial-aid

router.get('/', requireAuth, requireScope('financial', 'sa'), async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status && ['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
      where.status = status;
    }
    const requests = await prisma.financialAidRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user:     { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return res.json({ requests });
  } catch (error) {
    console.error('Admin financial aid list error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin/SA: single request detail ──────────────────────────────────────────

router.get('/:id', requireAuth, requireScope('financial', 'sa'), async (req, res) => {
  try {
    const request = await prisma.financialAidRequest.findFirst({
      where: { id: req.params.id },
      include: {
        user:     { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    return res.json({ request });
  } catch (error) {
    console.error('Admin financial aid detail error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin/SA: approve or reject ───────────────────────────────────────────────

router.patch('/:id', requireAuth, requireScope('financial', 'sa'), async (req, res) => {
  const parsed = finAidDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'validation', details: parsed.error.flatten() });
  }
  const { action, awardedAmount, reviewNote } = parsed.data;

  try {
    const existing = await prisma.financialAidRequest.findFirst({
      where: { id: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Request not found' });
    if (existing.status !== 'pending') {
      return res.status(400).json({
        error:   'invalid_state',
        message: `Request is in status '${existing.status}'`,
      });
    }

    const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';

    if (action === 'reject') {
      const updated = await prisma.financialAidRequest.update({
        where: { id: existing.id },
        data: {
          status:       'rejected',
          reviewedById: req.user.userId,
          reviewedAt:   new Date(),
          reviewNote:   reviewNote ?? null,
        },
      });
      setImmediate(() => {
        fetch(`${notifUrl}/api/notifications/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers['authorization'] || '',
            Cookie:         req.headers['cookie']        || '',
          },
          body: JSON.stringify({
            userIds:       [existing.userId],
            title:         'Financial Aid Decision',
            content:       'Your financial aid request was not approved.' + (reviewNote ? ` Note: ${reviewNote}` : ''),
            priority:      'high',
            type:          'info',
            referenceId:   existing.id,
            referenceType: 'FinancialAidRequest',
          }),
        }).catch((e) => console.warn('[financial-aid] notify failed:', e.message));
      });
      try {
        await writeAudit(prisma, {
          action:        'financial_aid_rejected',
          entityType:    'FinancialAidRequest',
          entityId:      existing.id,
          targetUserId:  existing.userId,
          details:       { reviewNote: reviewNote ?? null },
          performedById: req.user.userId,
        }, { authHeader: req.headers.authorization });
      } catch (e) {
        console.warn('[financial-aid] audit failed:', e?.message);
      }
      return res.json({ ok: true, request: updated });
    }

    // approve path
    if (!awardedAmount || Number(awardedAmount) <= 0) {
      return res.status(400).json({
        error:   'validation',
        details: { awardedAmount: 'required and > 0 for approve' },
      });
    }

    const targetInvoice = await prisma.invoice.findFirst({
      where: {
        userId: existing.userId,
        status: { in: ['pending', 'partial', 'overdue'] },
      },
      orderBy: { dueDate: 'asc' },
    });
    if (!targetInvoice) {
      return res.status(400).json({
        error:   'no_open_invoice',
        message: 'Applicant has no open invoice to apply the aid against.',
      });
    }

    const awardNum   = Number(awardedAmount);
    const balanceNum = Number(targetInvoice.balance);
    const paidNum    = Number(targetInvoice.paid);
    const applied    = Math.min(awardNum, balanceNum);
    const newBalance = +(balanceNum - applied).toFixed(2);
    const newPaid    = +(paidNum + applied).toFixed(2);
    const newStatus  = newBalance <= 0 ? 'paid' : 'partial';

    const result = await prisma.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          userId:      existing.userId,
          invoiceId:   targetInvoice.id,
          type:        'financial_aid',
          method:      'scholarship',
          amount:      -Math.abs(applied),
          description: `Financial aid award (request ${existing.id})`,
          status:      'applied',
        },
      });
      const inv = await tx.invoice.update({
        where: { id: targetInvoice.id },
        data: {
          balance: newBalance,
          paid:    newPaid,
          status:  newStatus,
          paidAt:  newStatus === 'paid' ? new Date() : targetInvoice.paidAt,
        },
      });
      const updated = await tx.financialAidRequest.update({
        where: { id: existing.id },
        data: {
          status:           'approved',
          reviewedById:     req.user.userId,
          reviewedAt:       new Date(),
          reviewNote:       reviewNote ?? null,
          awardedAmount:    awardNum,
          awardedInvoiceId: targetInvoice.id,
        },
      });
      return { txn, inv, updated };
    });

    setImmediate(() => {
      fetch(`${notifUrl}/api/notifications/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers['authorization'] || '',
          Cookie:         req.headers['cookie']        || '',
        },
        body: JSON.stringify({
          userIds:       [existing.userId],
          title:         'Financial Aid Approved',
          content:       `Your financial aid request was approved. ${applied.toFixed(2)} has been applied to your invoice "${targetInvoice.title}".`,
          priority:      'high',
          type:          'success',
          referenceId:   existing.id,
          referenceType: 'FinancialAidRequest',
        }),
      }).catch((e) => console.warn('[financial-aid] notify failed:', e.message));
    });

    try {
      await writeAudit(prisma, {
        action:        'financial_aid_approved',
        entityType:    'FinancialAidRequest',
        entityId:      existing.id,
        targetUserId:  existing.userId,
        details: {
          awardedAmount: awardNum,
          appliedAmount: applied,
          invoiceId:     targetInvoice.id,
          reviewNote:    reviewNote ?? null,
        },
        performedById: req.user.userId,
      }, { authHeader: req.headers.authorization });
    } catch (e) {
      console.warn('[financial-aid] audit failed:', e?.message);
    }

    return res.json({
      ok:            true,
      request:       result.updated,
      invoice:       result.inv,
      transaction:   result.txn,
      appliedAmount: applied,
    });
  } catch (error) {
    console.error('Financial aid decision error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

module.exports = router;
