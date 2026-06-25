/**
 * routes/complaints.routes.js — Complaint CRUD.
 *
 * Owns:
 *   POST   /api/complaints                — student files a complaint (multipart OK)
 *   PATCH  /api/complaints/:id            — student edits pending complaint; withdraw=true
 *   GET    /api/complaints/me             — student fetches own complaints
 *   GET    /api/sa/complaints             — SA/admin full complaint queue
 *   PATCH  /api/sa/complaints/:id         — SA/admin status/resolution update
 *
 * Hydrates `processedBy` for the "Being processed by …" banner. Status
 * aliases bridged via STATUS_ALIAS / STATUS_TO_FRIENDLY from lib/status-map.
 *
 * Mounted at app.use('/api', complaintsRoutes) in index.js.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const multer  = require('multer');
const path    = require('path');
const storage = require('../../../lib/storage');
const fs      = require('fs');

const prisma           = require('../../../lib/prisma');
const { requireAuth }  = require('../../../lib/auth');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const {
  STATUS_TO_FRIENDLY,
  isStaff,
  loadProcessorMap,
} = require('../lib/status-map');

// Complaint attachments share the same upload directory and file-filter
// rules as request attachments. Honours UPLOAD_ROOT (Fly volume).
const COMPLAINT_UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'requests')
  : path.join(__dirname, '../uploads/requests');
if (!fs.existsSync(COMPLAINT_UPLOAD_DIR)) fs.mkdirSync(COMPLAINT_UPLOAD_DIR, { recursive: true });

const complaintUpload = storage.memoryUpload({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    cb(allowedTypes.includes(file.mimetype) ? null : new Error('Invalid file type'), allowedTypes.includes(file.mimetype));
  },
});

// NOTE: complaint attachments are parsed by multer but not persisted anywhere
// (the Complaint model has no attachments field) — they were orphaned on disk
// before and are now simply discarded from memory. Kept the .array() middleware
// so the multipart form still parses without erroring.

// ── Student: file a complaint ──────────────────────────────────────────────

// Mirrors the request flow so the StudentAffairs form can route to either
// endpoint based on the type-toggle.
router.post('/complaints', requireAuth, complaintUpload.array('attachments', 5), restoreTenantContext, async (req, res) => {
  try {
    const { category, subject, message, severity, targetUserId } = req.body;
    const userId = req.user.userId;

    if (!subject || !message) {
      return res.status(400).json({ error: 'Subject and description are required' });
    }

    const severityValue = ['low', 'medium', 'high', 'urgent'].includes(severity)
      ? severity
      : 'medium';

    const newComplaint = await prisma.complaint.create({
      data: {
        complainantId: userId,
        targetUserId: targetUserId || null,
        category: category || 'general',
        severity: severityValue,
        subject,
        description: message,
        status: 'pending',
      },
    });

    res.status(201).json({ success: true, complaint: newComplaint });
  } catch (error) {
    console.error('Error creating complaint:', error);
    res.status(500).json({ error: 'Failed to submit complaint' });
  }
});

// ── Student: edit pending complaint ───────────────────────────────────────

// PATCH /api/complaints/:id — locked once SA marks it in_progress.
// Supports withdraw=true to rescind.
router.patch('/complaints/:id', requireAuth, complaintUpload.array('attachments', 5), restoreTenantContext, async (req, res) => {
  try {
    const row = await prisma.complaint.findFirst({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Complaint not found' });
    if (row.complainantId !== req.user.userId && !isStaff(req)) {
      return res.status(403).json({ error: 'Cannot edit another student\'s complaint' });
    }
    if (row.status !== 'pending') {
      return res.status(409).json({
        error: `Complaint is already ${STATUS_TO_FRIENDLY[row.status] || row.status} — editing is locked.`,
      });
    }

    const { subject, message, category, severity, withdraw } = req.body;
    if (withdraw === true || withdraw === 'true') {
      const withdrawn = await prisma.complaint.update({
        where: { id: req.params.id },
        data: { status: 'rejected', resolutionNotes: 'Withdrawn by student' },
      });
      return res.json({ success: true, complaint: withdrawn, withdrawn: true });
    }

    const data = {};
    if (subject !== undefined) data.subject = String(subject).trim();
    if (message !== undefined) data.description = String(message).trim();
    if (category !== undefined) data.category = String(category).trim();
    if (severity !== undefined && ['low', 'medium', 'high', 'urgent'].includes(severity)) {
      data.severity = severity;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updated = await prisma.complaint.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, complaint: updated });
  } catch (error) {
    console.error('Edit complaint error:', error);
    res.status(500).json({ error: 'Failed to update complaint' });
  }
});

// ── Student: fetch own complaints ──────────────────────────────────────────

// GET /api/complaints/me — same envelope shape as /api/requests/:studentId
// so the unified UI can render both lists from one component.
router.get('/complaints/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const rows = await prisma.complaint.findMany({
      where: { complainantId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const procMap = await loadProcessorMap('complaints', rows.map(r => r.id));

    const hydrated = rows.map((r) => {
      const proc = procMap.get(r.id);
      return {
        ...r,
        message: r.description,
        type: r.category,
        typeName: r.category,
        priority: r.severity,
        status: STATUS_TO_FRIENDLY[r.status] || r.status,
        statusRaw: r.status,
        resolution: r.resolutionNotes,
        kind: 'complaint',
        processedBy: proc || null,
      };
    });

    res.json({
      complaints: hydrated,
      summary: {
        total: rows.length,
        pending: rows.filter(r => r.status === 'pending').length,
        inProgress: rows.filter(r => r.status === 'in_progress').length,
        completed: rows.filter(r => r.status === 'completed').length,
      },
    });
  } catch (error) {
    console.error('Fetch my complaints error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// MVP build: the SA/admin complaint queue (GET /api/sa/complaints) and the
// SA/admin status-update handler (PATCH /api/sa/complaints/:id) have been
// removed — the MVP build keeps a real backend only for student & professor.

module.exports = router;
