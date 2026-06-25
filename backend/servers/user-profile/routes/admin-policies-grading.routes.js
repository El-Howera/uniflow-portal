/**
 * user-profile / routes / admin-policies-grading.routes.js  (MVP build — trimmed)
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints (1):
 *   GET   /api/grading-rules   (public)
 *
 * MVP build notes:
 *   - All admin-guarded handlers (honors/suspension/mobility/advisor/credit-hour
 *     policy GET+PATCH, admin grading-rules GET+PATCH, and the recompute-
 *     transcripts trigger) have been removed — the MVP build keeps a real
 *     backend only for student & professor.
 *   - The public GET /api/grading-rules read remains: it is consumed by the
 *     student GpaCalculator and transcript views.
 */

'use strict';

const express = require('express');

const prisma = require('../../../lib/prisma');
const { getGradingRules } = require('../../../lib/grading-rules');

const router = express.Router();

// ── GET /api/grading-rules ────────────────────────────────────────────────────
// Public read — no auth required. Consumed by student GpaCalculator + transcript
// views.

router.get('/api/grading-rules', async (req, res) => {
  try {
    const rules = await getGradingRules(prisma);
    res.json({ rules });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load grading rules' });
  }
});

module.exports = router;
