/**
 * routes/enrollment-workflows.routes.js — Enrollment lifecycle workflows.
 *
 * Implements FCDS Articles 20, 21, 23. All three review queues use raw SQL
 * because the Prisma client artifact predates the new models on Windows
 * DLL-locked envs. Matches the pattern used in registration-server.
 *
 * Owns:
 *   Suspensions (Article 20):
 *     POST   /api/sa/suspensions            — student submits
 *     GET    /api/sa/suspensions            — SA/admin sees queue; student sees own
 *     PATCH  /api/sa/suspensions/:id        — approve/reject (SA/admin) or withdraw (student)
 *
 *   Cancellations (Article 21):
 *     POST   /api/sa/cancellations
 *     GET    /api/sa/cancellations
 *     PATCH  /api/sa/cancellations/:id
 *     POST   /api/sa/cancellations/:id/re-enrollment
 *     PATCH  /api/sa/cancellations/:id/re-enrollment
 *
 *   Programme changes (Article 23):
 *     POST   /api/sa/programme-changes
 *     GET    /api/sa/programme-changes
 *     PATCH  /api/sa/programme-changes/:id
 *
 * Mounted at app.use('/api', enrollmentWorkflowsRoutes) in index.js.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma          = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const {
  getSuspensionPolicy,
  evaluateSuspensionCap,
  evaluateReEnrollmentWindow,
} = require('../../../lib/suspension-policy');
const { isSaOrAdmin, notifyStudent, cuid } = require('../lib/status-map');

// ── Suspensions (Article 20) ───────────────────────────────────────────────

router.post('/sa/suspensions', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reason = '', semesters = 1, isMilitary = false } = req.body || {};
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    }
    const sem = Math.max(1, Math.min(20, parseInt(semesters, 10) || 1));
    const id = cuid();
    const tenantId = req.user?.tenantId || req.tenantId;
    await prisma.$executeRaw`
      INSERT INTO enrollment_suspensions (id, tenant_id, user_id, reason, semesters, status, is_military, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${userId}, ${reason}, ${sem}, 'pending', ${!!isMilitary}, NOW(), NOW())
    `;
    res.status(201).json({ id, success: true });
  } catch (err) {
    console.error('POST suspension error:', err);
    res.status(500).json({ error: 'Failed to submit suspension request' });
  }
});

router.get('/sa/suspensions', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const tenantId = req.user?.tenantId || req.tenantId;
    let rows;
    if (isSaOrAdmin(req)) {
      rows = status
        ? await prisma.$queryRaw`
            SELECT s.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM enrollment_suspensions s
            JOIN users u ON u.id = s.user_id
            WHERE s.status = ${status}::"SuspensionStatus"
              AND s.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY s.created_at DESC
          `
        : await prisma.$queryRaw`
            SELECT s.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM enrollment_suspensions s
            JOIN users u ON u.id = s.user_id
            WHERE s.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY s.created_at DESC
          `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT * FROM enrollment_suspensions
         WHERE user_id = ${req.user.userId}
           AND tenant_id = ${tenantId}
         ORDER BY created_at DESC
      `;
    }
    res.json({ suspensions: rows });
  } catch (err) {
    console.error('GET suspensions error:', err);
    res.status(500).json({ error: 'Failed to fetch suspensions' });
  }
});

router.patch('/sa/suspensions/:id', requireAuth, async (req, res) => {
  try {
    const { action, reviewNote = null } = req.body || {};
    if (!['approve', 'reject', 'withdraw'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve | reject | withdraw' });
    }
    const tenantId = req.user?.tenantId || req.tenantId;
    const rows = await prisma.$queryRaw`
      SELECT * FROM enrollment_suspensions
       WHERE id = ${req.params.id}
         AND tenant_id = ${tenantId}
       LIMIT 1
    `;
    const susp = rows?.[0];
    if (!susp) return res.status(404).json({ error: 'Suspension not found' });

    if (action === 'withdraw') {
      if (susp.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
      if (susp.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be withdrawn' });
      await prisma.$executeRaw`
        UPDATE enrollment_suspensions SET status = 'withdrawn', updated_at = NOW()
         WHERE id = ${susp.id}
           AND tenant_id = ${tenantId}
      `;
      return res.json({ success: true });
    }

    if (!isSaOrAdmin(req)) return res.status(403).json({ error: 'Unauthorized access' });
    if (susp.status !== 'pending') return res.status(409).json({ error: `Already ${susp.status}` });

    if (action === 'approve') {
      const policy = await getSuspensionPolicy(prisma);
      const approved = await prisma.$queryRaw`
        SELECT semesters, is_military AS "isMilitary"
        FROM enrollment_suspensions
        WHERE user_id = ${susp.user_id}
          AND status = 'approved'
          AND tenant_id = ${tenantId}
      `;
      const verdict = evaluateSuspensionCap(approved, policy, {
        isMilitary: !!susp.is_military,
        semesters: susp.semesters,
      });
      if (!verdict.ok) {
        return res.status(409).json({ error: verdict.details?.message || 'Cap exceeded', details: verdict });
      }
      await prisma.$executeRaw`
        UPDATE enrollment_suspensions
        SET status = 'approved', reviewed_by_id = ${req.user.userId},
            reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
        WHERE id = ${susp.id}
          AND tenant_id = ${tenantId}
      `;
      notifyStudent(req.headers.authorization, {
        recipientId: susp.user_id,
        title: 'Suspension approved',
        message: `Your enrollment suspension (${susp.semesters} semester${susp.semesters === 1 ? '' : 's'}) has been approved.`,
      });
      return res.json({ success: true });
    }

    // reject
    await prisma.$executeRaw`
      UPDATE enrollment_suspensions
      SET status = 'rejected', reviewed_by_id = ${req.user.userId},
          reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
      WHERE id = ${susp.id}
        AND tenant_id = ${tenantId}
    `;
    notifyStudent(req.headers.authorization, {
      recipientId: susp.user_id,
      title: 'Suspension rejected',
      message: reviewNote || 'Your suspension request has been rejected.',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH suspension error:', err);
    res.status(500).json({ error: 'Failed to update suspension' });
  }
});

// ── Cancellations (Article 21) ─────────────────────────────────────────────

router.post('/sa/cancellations', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reason = '' } = req.body || {};
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    }
    const id = cuid();
    const tenantId = req.user?.tenantId || req.tenantId;
    await prisma.$executeRaw`
      INSERT INTO enrollment_cancellations (id, tenant_id, user_id, reason, status, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${userId}, ${reason}, 'pending', NOW(), NOW())
    `;
    res.status(201).json({ id, success: true });
  } catch (err) {
    console.error('POST cancellation error:', err);
    res.status(500).json({ error: 'Failed to submit cancellation request' });
  }
});

router.get('/sa/cancellations', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const tenantId = req.user?.tenantId || req.tenantId;
    let rows;
    if (isSaOrAdmin(req)) {
      rows = status
        ? await prisma.$queryRaw`
            SELECT c.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM enrollment_cancellations c
            JOIN users u ON u.id = c.user_id
            WHERE c.status = ${status}::"SuspensionStatus"
              AND c.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY c.created_at DESC
          `
        : await prisma.$queryRaw`
            SELECT c.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM enrollment_cancellations c
            JOIN users u ON u.id = c.user_id
            WHERE c.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY c.created_at DESC
          `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT * FROM enrollment_cancellations
         WHERE user_id = ${req.user.userId}
           AND tenant_id = ${tenantId}
         ORDER BY created_at DESC
      `;
    }
    res.json({ cancellations: rows });
  } catch (err) {
    console.error('GET cancellations error:', err);
    res.status(500).json({ error: 'Failed to fetch cancellations' });
  }
});

router.patch('/sa/cancellations/:id', requireAuth, async (req, res) => {
  try {
    const { action, reviewNote = null } = req.body || {};
    if (!['approve', 'reject', 'withdraw'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve | reject | withdraw' });
    }
    const tenantId = req.user?.tenantId || req.tenantId;
    const rows = await prisma.$queryRaw`
      SELECT * FROM enrollment_cancellations
       WHERE id = ${req.params.id}
         AND tenant_id = ${tenantId}
       LIMIT 1
    `;
    const cancel = rows?.[0];
    if (!cancel) return res.status(404).json({ error: 'Cancellation not found' });

    if (action === 'withdraw') {
      if (cancel.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
      if (cancel.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be withdrawn' });
      await prisma.$executeRaw`
        UPDATE enrollment_cancellations SET status = 'withdrawn', updated_at = NOW()
         WHERE id = ${cancel.id}
           AND tenant_id = ${tenantId}
      `;
      return res.json({ success: true });
    }

    if (!isSaOrAdmin(req)) return res.status(403).json({ error: 'Unauthorized access' });
    if (cancel.status !== 'pending') return res.status(409).json({ error: `Already ${cancel.status}` });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await prisma.$executeRaw`
      UPDATE enrollment_cancellations
      SET status = ${newStatus}::"SuspensionStatus", reviewed_by_id = ${req.user.userId},
          reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
      WHERE id = ${cancel.id}
        AND tenant_id = ${tenantId}
    `;
    notifyStudent(req.headers.authorization, {
      recipientId: cancel.user_id,
      title: action === 'approve' ? 'Cancellation approved' : 'Cancellation rejected',
      message: reviewNote || (action === 'approve'
        ? 'Your enrollment cancellation has been approved. You may apply for re-enrollment within the policy window.'
        : 'Your cancellation request has been rejected.'),
    });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH cancellation error:', err);
    res.status(500).json({ error: 'Failed to update cancellation' });
  }
});

// Re-enrollment after cancellation (Article 21: must apply within policy window).

router.post('/sa/cancellations/:id/re-enrollment', requireAuth, async (req, res) => {
  try {
    const { reason = '' } = req.body || {};
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    }
    const tenantId = req.user?.tenantId || req.tenantId;
    const rows = await prisma.$queryRaw`
      SELECT * FROM enrollment_cancellations
       WHERE id = ${req.params.id}
         AND tenant_id = ${tenantId}
       LIMIT 1
    `;
    const cancel = rows?.[0];
    if (!cancel) return res.status(404).json({ error: 'Cancellation not found' });
    if (cancel.user_id !== req.user.userId && !isSaOrAdmin(req)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const policy = await getSuspensionPolicy(prisma);
    const verdict = evaluateReEnrollmentWindow(
      { status: cancel.status, reviewedAt: cancel.reviewed_at },
      policy,
    );
    if (!verdict.ok) {
      return res.status(409).json({ error: verdict.details?.message || 'Re-enrollment denied', details: verdict });
    }

    await prisma.$executeRaw`
      UPDATE enrollment_cancellations
      SET re_enrollment_requested_at = NOW(),
          re_enrollment_reason = ${reason},
          updated_at = NOW()
      WHERE id = ${cancel.id}
        AND tenant_id = ${tenantId}
    `;
    res.json({ success: true });
  } catch (err) {
    console.error('POST re-enrollment error:', err);
    res.status(500).json({ error: 'Failed to submit re-enrollment request' });
  }
});

// MVP build: PATCH /api/sa/cancellations/:id/re-enrollment was an
// SA/admin-only review handler (first line hard-gated to isSaOrAdmin with no
// student path) — it has been removed. Students still submit re-enrollment via
// POST /api/sa/cancellations/:id/re-enrollment above.

// ── Programme Changes (Article 23) ────────────────────────────────────────

router.post('/sa/programme-changes', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { toProgramCode, reason = '' } = req.body || {};
    if (!toProgramCode || String(toProgramCode).trim().length === 0) {
      return res.status(400).json({ error: 'toProgramCode is required.' });
    }
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ error: 'A reason of at least 3 characters is required.' });
    }
    const tenantId = req.user?.tenantId || req.tenantId;
    const depRows = await prisma.$queryRaw`
      SELECT id, code FROM departments
       WHERE code = ${toProgramCode}
         AND is_active = true
         AND tenant_id = ${tenantId}
       LIMIT 1
    `;
    if (!depRows?.[0]) {
      return res.status(400).json({ error: `Unknown or inactive department code "${toProgramCode}".` });
    }
    const profile = await prisma.academicProfile.findUnique({
      where: { userId },
      select: { program: true },
    });
    const fromProgramCode = profile?.program || null;

    const id = cuid();
    await prisma.$executeRaw`
      INSERT INTO programme_changes (id, tenant_id, user_id, from_program_code, to_program_code, reason, status, created_at, updated_at)
      VALUES (${id}, ${tenantId}, ${userId}, ${fromProgramCode}, ${toProgramCode}, ${reason}, 'pending', NOW(), NOW())
    `;
    res.status(201).json({ id, success: true });
  } catch (err) {
    console.error('POST programme-change error:', err);
    res.status(500).json({ error: 'Failed to submit programme-change request' });
  }
});

router.get('/sa/programme-changes', requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const tenantId = req.user?.tenantId || req.tenantId;
    let rows;
    if (isSaOrAdmin(req)) {
      rows = status
        ? await prisma.$queryRaw`
            SELECT p.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM programme_changes p
            JOIN users u ON u.id = p.user_id
            WHERE p.status = ${status}::"SuspensionStatus"
              AND p.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY p.created_at DESC
          `
        : await prisma.$queryRaw`
            SELECT p.*, u.first_name AS "userFirstName", u.last_name AS "userLastName", u.email AS "userEmail"
            FROM programme_changes p
            JOIN users u ON u.id = p.user_id
            WHERE p.tenant_id = ${tenantId}
              AND u.tenant_id = ${tenantId}
            ORDER BY p.created_at DESC
          `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT * FROM programme_changes
         WHERE user_id = ${req.user.userId}
           AND tenant_id = ${tenantId}
         ORDER BY created_at DESC
      `;
    }
    res.json({ programmeChanges: rows });
  } catch (err) {
    console.error('GET programme-changes error:', err);
    res.status(500).json({ error: 'Failed to fetch programme changes' });
  }
});

router.patch('/sa/programme-changes/:id', requireAuth, async (req, res) => {
  try {
    const { action, reviewNote = null } = req.body || {};
    if (!['approve', 'reject', 'withdraw'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve | reject | withdraw' });
    }
    const tenantId = req.user?.tenantId || req.tenantId;
    const rows = await prisma.$queryRaw`
      SELECT * FROM programme_changes
       WHERE id = ${req.params.id}
         AND tenant_id = ${tenantId}
       LIMIT 1
    `;
    const pc = rows?.[0];
    if (!pc) return res.status(404).json({ error: 'Programme change not found' });

    if (action === 'withdraw') {
      if (pc.user_id !== req.user.userId) return res.status(403).json({ error: 'Access denied' });
      if (pc.status !== 'pending') return res.status(409).json({ error: 'Only pending requests can be withdrawn' });
      await prisma.$executeRaw`
        UPDATE programme_changes SET status = 'withdrawn', updated_at = NOW()
         WHERE id = ${pc.id}
           AND tenant_id = ${tenantId}
      `;
      return res.json({ success: true });
    }

    if (!isSaOrAdmin(req)) return res.status(403).json({ error: 'Unauthorized access' });
    if (pc.status !== 'pending') return res.status(409).json({ error: `Already ${pc.status}` });

    if (action === 'approve') {
      await prisma.$transaction([
        prisma.$executeRaw`
          UPDATE programme_changes
          SET status = 'approved', reviewed_by_id = ${req.user.userId},
              reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
          WHERE id = ${pc.id}
            AND tenant_id = ${tenantId}
        `,
        prisma.academicProfile.updateMany({
          where: { userId: pc.user_id },
          data:  { program: pc.to_program_code },
        }),
      ]);
      notifyStudent(req.headers.authorization, {
        recipientId: pc.user_id,
        title: 'Programme change approved',
        message: `Your programme change to "${pc.to_program_code}" has been approved.`,
      });
      return res.json({ success: true });
    }

    // reject
    await prisma.$executeRaw`
      UPDATE programme_changes
      SET status = 'rejected', reviewed_by_id = ${req.user.userId},
          reviewed_at = NOW(), review_note = ${reviewNote}, updated_at = NOW()
      WHERE id = ${pc.id}
        AND tenant_id = ${tenantId}
    `;
    notifyStudent(req.headers.authorization, {
      recipientId: pc.user_id,
      title: 'Programme change rejected',
      message: reviewNote || 'Your programme-change request has been rejected.',
    });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH programme-change error:', err);
    res.status(500).json({ error: 'Failed to update programme change' });
  }
});

module.exports = router;
