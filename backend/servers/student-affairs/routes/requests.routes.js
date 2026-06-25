/**
 * routes/requests.routes.js — Support request CRUD.
 *
 * Owns:
 *   GET    /api/sa/all-requests             — SA/admin full queue
 *   GET    /api/requests/:studentId         — student own list (or SA/admin any student)
 *   POST   /api/requests                    — student submits a request (multipart OK)
 *   PATCH  /api/requests/:id                — student edits pending request; supports withdraw=true
 *   PATCH  /api/requests/:requestId/status  — SA/admin status update
 *
 * Hydrates `processedBy` via `loadProcessorMap` for the "Being processed by …"
 * student-card banner. Status aliases (`processing` / `resolved`) are
 * translated at the boundary via STATUS_ALIAS / STATUS_TO_FRIENDLY.
 *
 * Mounted at app.use('/api', requestsRoutes) in index.js so:
 *   GET /api/sa/all-requests → router.get('/sa/all-requests', …)
 *   GET /api/requests/:id    → router.get('/requests/:id', …)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma           = require('../../../lib/prisma');
const { requireAuth }  = require('../../../lib/auth');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const {
  STATUS_ALIAS,
  STATUS_TO_FRIENDLY,
  isStaff,
  loadProcessorMap,
} = require('../lib/status-map');

// Multer is configured in index.js and injected into the module-level
// `upload` variable that index.js passes to the route handlers. However,
// because routers are plain Express objects, we duplicate the lightweight
// Multer config here (same options as the original) so the router is
// self-contained and can be required directly without factory wrappers.
const multer = require('multer');
const path   = require('path');
const storage = require('../../../lib/storage');
const fs     = require('fs');

// Honours UPLOAD_ROOT (Fly volume at /app/uploads). The subfolder
// `requests` matches the URL nginx serves via its /uploads/ alias on Fly.
// Dev keeps the original per-service `__dirname/../uploads/requests` path
// and the express.static mount in index.js serves it the same way.
const REQUEST_UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'requests')
  : path.join(__dirname, '../uploads/requests');
if (!fs.existsSync(REQUEST_UPLOAD_DIR)) fs.mkdirSync(REQUEST_UPLOAD_DIR, { recursive: true });

const requestUpload = storage.memoryUpload({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    cb(allowedTypes.includes(file.mimetype) ? null : new Error('Invalid file type. Allowed: PDF, JPEG, PNG, DOC, DOCX'), allowedTypes.includes(file.mimetype));
  },
});

// Save an array of multer memory files under requests/ and return their
// filenames (the DB stores filenames; URLs are /uploads/requests/<filename>).
async function saveRequestFiles(files) {
  const names = [];
  for (const f of files) {
    const { filename } = await storage.saveUpload('requests', f);
    names.push(filename);
  }
  return names;
}

// MVP build: the SA/admin queue (GET /api/sa/all-requests) has been removed.

// ── Student own list ───────────────────────────────────────────────────────

router.get('/requests/:studentId', requireAuth, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { status, type } = req.query;

    const targetUserId = studentId === 'current' ? req.user.userId : studentId;

    if (req.user.role === 'student' && targetUserId !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const where = { userId: targetUserId };
    if (status) where.status = STATUS_ALIAS[status] || status;
    if (type) where.type = type;

    const requests = await prisma.supportRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const procMap = await loadProcessorMap('support_requests', requests.map(r => r.id));

    const hydrated = requests.map(r => {
      const proc = procMap.get(r.id);
      return {
        ...r,
        status: STATUS_TO_FRIENDLY[r.status] || r.status,
        statusRaw: r.status,
        processedBy: proc || null,
      };
    });

    res.json({
      requests: hydrated,
      summary: {
        total: requests.length,
        pending: requests.filter(r => r.status === 'pending').length,
        inProgress: requests.filter(r => r.status === 'in_progress').length,
        completed: requests.filter(r => r.status === 'completed').length,
      },
    });
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Submit new request ─────────────────────────────────────────────────────

router.post('/requests', requireAuth, requestUpload.array('attachments', 5), restoreTenantContext, async (req, res) => {
  try {
    const { type, subject, message, priority } = req.body;
    const files = req.files || [];
    const userId = req.user.userId;

    if (!type || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const attachmentNames = await saveRequestFiles(files);
    const typeInfo = await prisma.requestType.findFirst({ where: { typeKey: type } });

    const newRequest = await prisma.supportRequest.create({
      data: {
        userId,
        ...(typeInfo ? { typeId: typeInfo.id } : {}),
        type,
        typeName: typeInfo?.name || type,
        subject,
        description: message,
        message,
        status: 'pending',
        priority: priority || 'medium',
        notes: typeInfo?.department ? `Routed to: ${typeInfo.department}` : null,
        attachments: attachmentNames,
        estimatedDays: typeInfo?.estimatedDays || 5,
      },
    });

    // Notify reviewers (admins + SAs in this tenant) of the new request.
    // Best-effort fan-out; broadcast is requireAuth-only + tenant-scoped.
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
            title:         'New Student Request',
            content:       `A student submitted a "${typeInfo?.name || type}" request awaiting review.`,
            priority:      'normal',
            type:          'info',
            senderId:      req.user.userId,
            referenceId:   newRequest.id,
            referenceType: 'SupportRequest',
          }),
        }).catch((e) => console.warn('[sa-requests] staff notify failed:', e.message));
      });
    });

    res.status(201).json({ success: true, request: newRequest });
  } catch (error) {
    console.error('Error creating request:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// ── Student edits pending request ─────────────────────────────────────────

// PATCH /api/requests/:id — student edits subject/message on their own
// pending request. Locked once SA marks it as in_progress. Supports
// `withdraw=true` to let the student rescind a pending request.
router.patch('/requests/:id', requireAuth, requestUpload.array('attachments', 5), restoreTenantContext, async (req, res) => {
  try {
    const row = await prisma.supportRequest.findFirst({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.userId !== req.user.userId && !isStaff(req)) {
      return res.status(403).json({ error: 'Cannot edit another student\'s request' });
    }
    if (row.status !== 'pending') {
      return res.status(409).json({
        error: `Request is already ${STATUS_TO_FRIENDLY[row.status] || row.status} — editing is locked.`,
      });
    }

    const { subject, message, type, priority, withdraw } = req.body;
    if (withdraw === true || withdraw === 'true') {
      const withdrawn = await prisma.supportRequest.update({
        where: { id: req.params.id },
        data: { status: 'rejected', resolution: 'Withdrawn by student' },
      });
      return res.json({ success: true, request: withdrawn, withdrawn: true });
    }

    const data = {};
    if (subject !== undefined) data.subject = String(subject).trim();
    if (message !== undefined) {
      data.message = String(message).trim();
      data.description = String(message).trim();
    }
    if (priority !== undefined && ['low', 'medium', 'high'].includes(priority)) {
      data.priority = priority;
    }
    if (type !== undefined && type !== row.type) {
      const typeInfo = await prisma.requestType.findFirst({ where: { typeKey: String(type) } });
      data.type = String(type);
      if (typeInfo) {
        data.typeId = typeInfo.id;
        data.typeName = typeInfo.name;
        data.estimatedDays = typeInfo.estimatedDays;
      }
    }
    const files = req.files || [];
    if (files.length > 0) {
      data.attachments = [...(row.attachments || []), ...(await saveRequestFiles(files))];
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await prisma.supportRequest.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, request: updated });
  } catch (error) {
    console.error('Edit request error:', error);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// MVP build: the SA/admin status-update handler
// (PATCH /api/requests/:requestId/status) has been removed.

module.exports = router;
