/**
 * registration/routes/advisor.routes.js
 *
 * Academic advisor endpoints (Plan 4 Phase 8 — FCDS Article 12):
 *
 *   GET   /api/professor/advisees                  — list advisees + pending regs
 *   PATCH /api/registrations/:id/advisor-approve   — advisor approves/rejects a reg
 *
 * The GET route allows professors and admins; the PATCH is for the assigned
 * advisor (or admin bypass).
 */

const express = require('express');
const router = express.Router();

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { writeAudit } = require('../../../lib/audit');
const { notifyStudent } = require('../lib/period-helpers');

// ── GET /api/professor/advisees ───────────────────────────────────────────────

/**
 * GET /api/professor/advisees
 * List students assigned to the requesting professor, with their pending
 * registrations attached so the Advisees page can render an actionable queue.
 *
 * No new role gate — professors are already authenticated, and the SQL
 * selector keys on `academic_advisor_id = req.user.userId`. A non-advisor
 * professor will simply see an empty list.
 */
router.get(
  '/advisees',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'professor' && req.user.role !== 'admin') {
      throw new AppError('Only professors can view advisees', 403);
    }

    const advisorId = req.user.userId;
    const tenantId = getCurrentTenant();
    const studentRows = await prisma.$queryRaw`
      SELECT id, first_name AS "firstName", last_name AS "lastName", email
      FROM users
      WHERE tenant_id = ${tenantId}
        AND academic_advisor_id = ${advisorId}
        AND deleted_at IS NULL
        AND role = 'student'
      ORDER BY first_name, last_name
    `;

    if (studentRows.length === 0) {
      return res.json({ advisees: [] });
    }

    const studentIds = studentRows.map((s) => s.id);
    const pendingRegs = await prisma.$queryRawUnsafe(
      `SELECT r.id, r.user_id AS "userId", r.section_id AS "sectionId",
              r.status, r.pending_reason AS "pendingReason",
              r.pending_note AS "pendingNote",
              r.advisor_approved AS "advisorApproved",
              r.advisor_approved_at AS "advisorApprovedAt",
              r.created_at AS "createdAt",
              c.code AS "courseCode", c.title AS "courseTitle", c.credits,
              cs.section_id AS "sectionLabel", cs.type AS "sectionType"
       FROM registrations r
       JOIN course_sections cs ON cs.id = r.section_id
       JOIN courses c ON c.id = r.course_id
       WHERE r.tenant_id = $1
         AND r.user_id = ANY($2::text[])
         AND r.status = 'pending'
       ORDER BY r.created_at DESC`,
      tenantId, studentIds,
    );

    const regsByStudent = new Map();
    for (const r of pendingRegs) {
      if (!regsByStudent.has(r.userId)) regsByStudent.set(r.userId, []);
      regsByStudent.get(r.userId).push(r);
    }

    const advisees = studentRows.map((s) => ({
      ...s,
      pendingRegistrations: regsByStudent.get(s.id) || [],
    }));

    res.json({ advisees });
  })
);

// ── PATCH /api/registrations/:id/advisor-approve ─────────────────────────────

/**
 * PATCH /api/registrations/:id/advisor-approve
 * Body: { action: 'approve' | 'reject', reviewNote? }
 * The assigned advisor flips `advisor_approved=true` (approve) or rejects the
 * registration outright. SA still does final approval after this — advisor
 * approval just clears the `advisor_approval` pending reason; SA's queue picks
 * up the row as a regular pending registration.
 */
router.patch(
  '/:id/advisor-approve',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'professor' && req.user.role !== 'admin') {
      throw new AppError('Only the assigned advisor can approve here', 403);
    }
    const { action = 'approve', reviewNote = null } = req.body || {};
    if (!['approve', 'reject'].includes(action)) {
      throw new AppError("action must be 'approve' or 'reject'", 400);
    }

    const reg = await prisma.registration.findFirst({
      where: { id: req.params.id },
      include: {
        course: { select: { code: true, title: true } },
      },
    });
    if (!reg) throw new AppError('Registration not found', 404);
    if (reg.status !== 'pending') {
      throw new AppError(`Registration is already ${reg.status}`, 409);
    }

    // Verify the requester is the student's assigned advisor (admin bypasses).
    if (req.user.role === 'professor') {
      const ownerTenantId = getCurrentTenant();
      const ownerRows = await prisma.$queryRaw`
        SELECT academic_advisor_id AS "academicAdvisorId" FROM users WHERE tenant_id = ${ownerTenantId} AND id = ${reg.userId} LIMIT 1
      `;
      const advisorId = ownerRows?.[0]?.academicAdvisorId;
      if (advisorId !== req.user.userId) {
        throw new AppError('You are not this student\'s assigned advisor', 403);
      }
    }

    if (action === 'approve') {
      const approveTenantId = getCurrentTenant();
      await prisma.$executeRaw`
        UPDATE registrations
        SET advisor_approved = true,
            advisor_approved_at = NOW(),
            advisor_approved_by_id = ${req.user.userId},
            updated_at = NOW()
        WHERE tenant_id = ${approveTenantId} AND id = ${reg.id}
      `;
      // Clear the advisor_approval pending reason so SA sees a clean queue.
      await prisma.$executeRaw`
        UPDATE registrations
        SET pending_reason = NULL, pending_note = NULL
        WHERE tenant_id = ${approveTenantId} AND id = ${reg.id} AND pending_reason = 'advisor_approval'
      `;
    } else {
      // Reject — flip the registration to rejected outright.
      await prisma.$transaction(async (tx) => {
        await tx.registration.update({
          where: { id: reg.id },
          data: {
            status: 'rejected',
            isActive: false,
            droppedAt: new Date(),
          },
        });
        await tx.courseSection.update({
          where: { id: reg.sectionId },
          data: { enrolled: { decrement: 1 } },
        });
        const otherActive = await tx.registration.count({
          where: {
            userId: reg.userId,
            courseId: reg.courseId,
            isActive: true,
            status: { in: ['pending', 'approved'] },
            id: { not: reg.id },
          },
        });
        if (otherActive === 0) {
          await tx.studentEnrollment.deleteMany({
            where: { userId: reg.userId, courseId: reg.courseId },
          });
        }
      });
      const note = reviewNote || 'Rejected by academic advisor.';
      const rejectTenantId = getCurrentTenant();
      await prisma.$executeRawUnsafe(
        'UPDATE registrations SET pending_reason = $1, pending_note = $2 WHERE tenant_id = $3 AND id = $4',
        'advisor_rejected',
        note,
        rejectTenantId,
        reg.id,
      );
    }

    await writeAudit(prisma, {
      action: `advisor.${action}`,
      entityType: 'Registration',
      entityId: reg.id,
      details: {
        studentId: reg.userId,
        courseCode: reg.course.code,
        reviewNote,
      },
      performedById: req.user.userId,
    }, {
      authHeader: req.headers.authorization,
      summary: `${action === 'approve' ? 'Approved' : 'Rejected'} advisor gate for ${reg.course.code}`,
    });

    await notifyStudent(req.headers.authorization, {
      userId: reg.userId,
      title: action === 'approve' ? 'Advisor Approved Registration' : 'Advisor Rejected Registration',
      content:
        action === 'approve'
          ? `Your academic advisor has approved your registration for ${reg.course.code} — ${reg.course.title}. Final approval pending Student Affairs.`
          : `Your academic advisor rejected your registration for ${reg.course.code} — ${reg.course.title}.${reviewNote ? ' Note: ' + reviewNote : ''}`,
      type: action === 'approve' ? 'info' : 'critical',
    });

    res.json({ success: true });
  })
);

module.exports = router;
