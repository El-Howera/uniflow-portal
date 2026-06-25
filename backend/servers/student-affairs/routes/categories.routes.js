/**
 * routes/categories.routes.js — Request type + complaint category taxonomy.
 *
 * Owns (MVP build — public reads only):
 *   GET  /api/requests/types            — active request types for the student form
 *   GET  /api/complaints/categories     — active complaint categories
 *
 * MVP build notes:
 *   - All SA/admin CRUD handlers (request-type + complaint-category create /
 *     update / delete, guarded by requireAuth + isStaff) have been removed —
 *     the MVP build keeps a real backend only for student & professor.
 *   - The two public student-facing reads remain so the student request /
 *     complaint forms can render their pickers.
 *
 * Mounted at two prefixes from index.js:
 *   app.use('/api/requests',  categoriesRoutes)   — for /types
 *   app.use('/api/complaints', categoriesRoutes)  — for /categories
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma = require('../../../lib/prisma');
const { getCurrentTenant } = require('../../../lib/tenant-context');

// ── Public student-facing reads ────────────────────────────────────────────

// Active request types — used by the student form's type-picker.
router.get('/types', async (req, res) => {
  try {
    const types = await prisma.requestType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(types.map(t => ({
      id: t.typeKey,
      name: t.name,
      department: t.department,
      estimatedDays: t.estimatedDays,
      description: t.description,
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch request types' });
  }
});

// Active complaint categories — same shape so the student form can render
// either with the same picker. Inactive hidden.
router.get('/categories', async (req, res) => {
  try {
    const tenantId = req.tenantId || getCurrentTenant();
    const rows = await prisma.$queryRaw`
      SELECT id, category_key AS "categoryKey", name, description, icon,
             default_severity AS "defaultSeverity", is_active AS "isActive"
        FROM complaint_categories
       WHERE tenant_id = ${tenantId}
         AND is_active = true
       ORDER BY name ASC
    `;
    res.json(rows);
  } catch (error) {
    console.error('Fetch complaint categories error:', error);
    res.status(500).json({ error: 'Failed to fetch complaint categories' });
  }
});

module.exports = router;
