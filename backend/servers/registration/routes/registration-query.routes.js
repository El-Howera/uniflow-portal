/**
 * registration/routes/registration-query.routes.js
 *
 * Read-only registration endpoint:
 *
 *   GET /api/registrations/:userId — list active registrations for a user
 *
 * The handler hydrates pending_reason / pending_note via raw SQL (columns not
 * yet on the typed Prisma client), resolves hall info per section, and filters
 * out courses whose final grade has been confirmed and written to the transcript.
 */

const express = require('express');
const router = express.Router();

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { resolveUser } = require('../../../lib/users');

const { dedupeSlots } = require('../lib/section-helpers');

// ── GET /api/registrations/:userId ───────────────────────────────────────────

/**
 * GET /api/registrations/:userId
 * Get all active registrations for a user.
 * The token userId overrides if the param is 'current'.
 */
router.get('/:userId', requireAuth, asyncHandler(async (req, res) => {
  // The frontend often passes email or odId here, not the cuid — resolve it.
  const rawParam = req.params.userId === 'current' ? req.user.userId : req.params.userId;
  const resolvedUser = await resolveUser(rawParam);
  if (!resolvedUser) throw new AppError('User not found', 404);
  const targetUserId = resolvedUser.id;

  // Non-admin/sa users may only see their own registrations
  if (
    targetUserId !== req.user.userId &&
    !['sa', 'admin'].includes(req.user.role)
  ) {
    throw new AppError('Access denied', 403);
  }

  const registrations = await prisma.registration.findMany({
    where: { userId: targetUserId, isActive: true },
    include: {
      course: {
        include: { department: true },
      },
      section: {
        include: { slots: true },
      },
    },
    orderBy: { registeredAt: 'desc' },
  });

  // Hydrate pending_reason / pending_note via raw SQL (columns may not be
  // typed on the Prisma client yet — see migration 20260430030000).
  let reasonMap = new Map();
  if (registrations.length > 0) {
    try {
      const ids = registrations.map((p) => p.id);
      const tenantId = getCurrentTenant();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, pending_reason AS "pendingReason", pending_note AS "pendingNote"
         FROM registrations WHERE tenant_id = $1 AND id = ANY($2::text[])`,
        tenantId, ids,
      );
      reasonMap = new Map(rows.map((r) => [r.id, { pendingReason: r.pendingReason, pendingNote: r.pendingNote }]));
    } catch (err) {
      console.warn('[registration] pending_reason hydrate failed:', err.message);
    }
  }

  // Resolve each section's assigned hall (course_sections.hall_id → bssid_locations.name)
  const sectionIds = registrations.map((r) => r.section.id);
  const hallBySection = new Map();
  if (sectionIds.length > 0) {
    const tenantId = getCurrentTenant();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT cs.id AS "sectionId",
              bl.name AS "hallName",
              bl.building AS "hallBuilding",
              bl.room AS "hallRoom"
         FROM course_sections cs
         LEFT JOIN bssid_locations bl ON bl.id = cs.hall_id
        WHERE cs.tenant_id = $1 AND cs.id = ANY($2::text[])`,
      tenantId, sectionIds,
    );
    for (const row of rows) hallBySection.set(row.sectionId, row);
  }

  // Owner directive (2026-05-19): once the prof confirms a final AND the
  // cascade has written a TranscriptCourse row, the course is "done" — it
  // belongs on the transcript, not in any "Current Enrollments" view.
  const finalizedCourseIds = new Set();
  if (registrations.length > 0) {
    const courseIds = [...new Set(registrations.map((r) => r.courseId))];
    try {
      const [confirmedFinals, transcriptRows] = await Promise.all([
        prisma.gradebookEntry.findMany({
          where: {
            studentId: targetUserId,
            courseId: { in: courseIds },
            component: 'final',
            confirmedById: { not: null },
          },
          select: { courseId: true },
        }),
        prisma.transcriptCourse.findMany({
          where: {
            userId: targetUserId,
            courseCode: { in: registrations.map((r) => (r.course?.code || '').toUpperCase()) },
          },
          select: { courseCode: true },
        }),
      ]);
      const transcriptedCodes = new Set(transcriptRows.map((r) => (r.courseCode || '').toUpperCase()));
      const confirmedFinalIds = new Set(confirmedFinals.map((r) => r.courseId));
      for (const r of registrations) {
        const code = (r.course?.code || '').toUpperCase();
        if (confirmedFinalIds.has(r.courseId) && transcriptedCodes.has(code)) {
          finalizedCourseIds.add(r.courseId);
        }
      }
    } catch (err) {
      console.warn('[registrations] finalized-course filter skipped:', err.message);
    }
  }

  const enriched = registrations
    .filter((r) => !finalizedCourseIds.has(r.courseId))
    .map((r) => {
    const hall = hallBySection.get(r.section.id);
    const displayLocation =
      (hall?.hallName ? hall.hallName : null) ||
      r.section.location ||
      r.section.room ||
      null;
    return {
      id: r.id,
      status: r.status,
      registeredAt: r.registeredAt,
      courseId: r.courseId,
      courseCode: r.course.code,
      courseName: r.course.title,
      credits: r.course.credits,
      department: r.course.department?.name ?? null,
      pendingReason: reasonMap.get(r.id)?.pendingReason ?? null,
      pendingNote: reasonMap.get(r.id)?.pendingNote ?? null,
      section: {
        id: r.section.id,
        sectionId: r.section.sectionId,
        type: r.section.type,
        instructor: r.section.instructorName,
        location: displayLocation,
        room: r.section.room,
        hallName: hall?.hallName ?? null,
        hallBuilding: hall?.hallBuilding ?? null,
        hallRoom: hall?.hallRoom ?? null,
        capacity: r.section.capacity,
        enrolled: r.section.enrolled,
        slots: dedupeSlots(r.section.slots).map((sl) => ({
          day: sl.day,
          start: sl.startTime,
          end: sl.endTime,
          startTime: sl.startTime,
          endTime: sl.endTime,
        })),
      },
    };
  });

  // Dedupe credits by courseId — lecture + lab share one course → count once.
  const seenCourseIds = new Set();
  let activeCredits = 0;
  for (const r of enriched) {
    if (r.status === 'dropped' || r.status === 'rejected') continue;
    if (seenCourseIds.has(r.courseId)) continue;
    seenCourseIds.add(r.courseId);
    activeCredits += r.credits || 0;
  }

  res.json({
    success: true,
    registrations: enriched,
    totalCredits: activeCredits,
    courseCount: seenCourseIds.size,
  });
}));

module.exports = router;
