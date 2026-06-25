/**
 * registration/lib/course-helpers.js
 *
 * Helpers for course admin operations:
 *   - persistCourseDefaultStaff  — validate + write default prof/TA columns
 *   - syncCrossListedDepartments — replace the CourseDepartment M:N set
 *
 * Both use raw SQL because the new columns (default_instructor_id,
 * default_ta_id, course_departments) landed after the last `prisma generate`
 * run on Windows DLL-locked dev envs.
 */

const prisma = require('../../../lib/prisma');
const { AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');

/**
 * Validate + persist course-level default professor / TA. Roles must match —
 * professor for the instructor slot, TA for the TA slot.
 *
 * Side effect: when a default is set, any existing section of the matching
 * type with `instructor_id IS NULL` is back-filled with the default. The
 * `CourseSectionTA` join row is also created for back-filled Labs so the
 * TA's dashboards (grading, attendance) pick them up. Sections that have
 * an explicit instructor are left alone — those are deliberate overrides.
 *
 * Uses raw SQL because the new columns aren't on the typed Prisma client
 * yet (Windows DLL playbook).
 */
async function persistCourseDefaultStaff({ courseId, defaultInstructorId, defaultTaId, performedById }) {
  // Resolve users + validate roles.
  let instructorUser = null;
  if (defaultInstructorId !== undefined && defaultInstructorId !== null && defaultInstructorId !== '') {
    instructorUser = await prisma.user.findFirst({
      where: { id: defaultInstructorId },
      select: { id: true, firstName: true, lastName: true, role: true, deletedAt: true },
    });
    if (!instructorUser || instructorUser.deletedAt) throw new AppError('Default professor not found.', 400);
    if (instructorUser.role !== 'professor') {
      throw new AppError(`Default professor slot needs a professor user (got "${instructorUser.role}").`, 400);
    }
  }
  let taUser = null;
  if (defaultTaId !== undefined && defaultTaId !== null && defaultTaId !== '') {
    taUser = await prisma.user.findFirst({
      where: { id: defaultTaId },
      select: { id: true, firstName: true, lastName: true, role: true, deletedAt: true },
    });
    if (!taUser || taUser.deletedAt) throw new AppError('Default TA not found.', 400);
    if (taUser.role !== 'ta') {
      throw new AppError(`Default TA slot needs a teaching-assistant user (got "${taUser.role}").`, 400);
    }
  }

  const tenantId = getCurrentTenant();
  // Persist the default columns on the course row.
  if (defaultInstructorId !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE courses SET default_instructor_id = $1 WHERE tenant_id = $2 AND id = $3`,
      defaultInstructorId || null,
      tenantId,
      courseId,
    );
  }
  if (defaultTaId !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE courses SET default_ta_id = $1 WHERE tenant_id = $2 AND id = $3`,
      defaultTaId || null,
      tenantId,
      courseId,
    );
  }

  // Back-fill instructor-less Lecture sections with the new default professor.
  if (instructorUser) {
    const fullName = `${instructorUser.firstName} ${instructorUser.lastName}`.trim();
    await prisma.$executeRawUnsafe(
      `UPDATE course_sections
          SET instructor_id = $1, instructor_name = $2
        WHERE tenant_id = $3 AND course_id = $4 AND type = 'Lecture' AND instructor_id IS NULL`,
      instructorUser.id,
      fullName,
      tenantId,
      courseId,
    );
  }

  // Back-fill instructor-less Lab sections with the new default TA, AND
  // create the CourseSectionTA join rows.
  if (taUser) {
    const fullName = `${taUser.firstName} ${taUser.lastName}`.trim();
    await prisma.$executeRawUnsafe(
      `UPDATE course_sections
          SET instructor_id = $1, instructor_name = $2
        WHERE tenant_id = $3 AND course_id = $4 AND type = 'Lab' AND instructor_id IS NULL`,
      taUser.id,
      fullName,
      tenantId,
      courseId,
    );
    // Find the labs we just touched (have this TA + course id) and ensure
    // the join row exists. Idempotent — upsert on the unique pair.
    const labs = await prisma.courseSection.findMany({
      where: { courseId, type: 'Lab', instructorId: taUser.id },
      select: { id: true },
    });
    for (const lab of labs) {
      await prisma.courseSectionTA.upsert({
        where: { sectionId_taId: { sectionId: lab.id, taId: taUser.id } },
        update: {},
        create: { sectionId: lab.id, taId: taUser.id, assignedById: performedById || null },
      }).catch(() => {});
    }
  }
}

/**
 * Sync the cross-listed-departments set for a course. Called from both
 * POST and PUT so the M:N rows stay in lockstep with whatever the admin
 * sent. Strategy: delete every row for the course, then insert the new
 * set (skipping the primary department since membership there is already
 * implied by `Course.departmentId`). Safe to call with `null` / `[]` —
 * just clears the cross-list.
 */
async function syncCrossListedDepartments(courseId, primaryDepartmentId, ids) {
  if (!Array.isArray(ids)) return; // undefined = "don't touch"; null = "clear"
  // De-dup + drop the primary (it's implicit) + drop empties.
  const clean = Array.from(new Set(ids.filter((d) => typeof d === 'string' && d.trim())))
    .filter((d) => d !== primaryDepartmentId);

  await prisma.courseDepartment.deleteMany({ where: { courseId } });
  if (clean.length === 0) return;
  // createMany skipDuplicates guards against an admin sending two depts
  // whose IDs differ only by trailing whitespace.
  await prisma.courseDepartment.createMany({
    data: clean.map((departmentId) => ({ courseId, departmentId })),
    skipDuplicates: true,
  });
}

module.exports = {
  persistCourseDefaultStaff,
  syncCrossListedDepartments,
};
