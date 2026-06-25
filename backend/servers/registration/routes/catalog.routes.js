/**
 * registration/routes/catalog.routes.js
 *
 * Public course catalog endpoints.
 *
 *   GET  /api/courses          — list active courses (eligibility-filtered for students)
 *   GET  /api/courses/:code    — single course detail
 *   GET  /api/departments      — list all departments (public)
 *   GET  /api/registration/status       — is registration open?
 *   GET  /api/registration/current-term — active term info
 *
 * Student callers receive an eligibility-filtered view; staff bypass all gates.
 */

const express = require('express');
const router = express.Router();

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { evaluateCourse, precomputeContext } = require('../../../lib/course-eligibility');
const { dedupeSlots } = require('../lib/section-helpers');
const { findActivePeriod } = require('../lib/period-helpers');

// ── GET /api/courses ──────────────────────────────────────────────────────────

/**
 * GET /api/courses
 * List all active courses.
 * Query: ?department=<name>  ?search=<text>
 *
 * Auth required. Students get the eligibility-filtered view: courses with
 * unmet prereqs or a semester mismatch are removed entirely; level-gated
 * courses are kept and annotated with `levelGateActive: true` so the UI
 * can badge them ("Sent to SA on register"). Non-student callers (admin,
 * professor, ta, sa) get the full catalog with no filter and no annotation.
 */
router.get('/courses', requireAuth, asyncHandler(async (req, res) => {
  const { department, search } = req.query;

  const where = { isActive: true };

  if (department) {
    where.department = { name: department };
  }

  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
    ];
  }

  const courses = await prisma.course.findMany({
    where,
    include: {
      department: true,
      sections: {
        include: { slots: true },
      },
      // `prereqFor` = rows where this course is the REQUIRER (its outgoing
      // prereq edges, i.e. "courses I need to pass before taking this one").
      // The misleadingly-named `prerequisites` relation returns dependents
      // (courses that require this one) and must NOT be used here.
      prereqFor: {
        include: { prerequisiteCourse: { select: { code: true, title: true } } },
      },
    },
    orderBy: { code: 'asc' },
  });

  // Build the eligibility context once for student callers; staff bypass.
  const isStudent = req.user.role === 'student';
  const ctx = isStudent ? await precomputeContext(prisma, req.user.userId) : null;

  // Plan 4 Phase 2 — language / category are not on the generated Prisma
  // client yet on Windows DLL-locked envs. Pull with raw SQL once, then
  // merge by code. (programCode was removed in the consolidation follow-up
  // — programs are now departments.)
  const tenantId = getCurrentTenant();
  const newFieldRows = await prisma.$queryRaw`
    SELECT code, language, category FROM courses WHERE tenant_id = ${tenantId}
  `;
  const newFieldsByCode = new Map(newFieldRows.map((r) => [r.code, r]));

  // Cross-listed departments via raw SQL (same DLL-lock-tolerant pattern
  // as the admin endpoint above). The eligibility helper needs them too
  // — splice them onto each Course row in-memory so `evaluateCourse`
  // can read `course.crossListedDepartments[*].departmentId` without
  // depending on a Prisma include that may not be regen'd yet.
  const crossListByCourseId = new Map();
  try {
    const rows = await prisma.$queryRaw`
      SELECT cd.course_id   AS "courseId",
             cd.department_id AS "departmentId",
             d.code         AS "code",
             d.name         AS "name"
        FROM course_departments cd
        JOIN departments d ON d.id = cd.department_id
       WHERE cd.tenant_id = ${tenantId}
    `;
    for (const r of rows || []) {
      if (!crossListByCourseId.has(r.courseId)) crossListByCourseId.set(r.courseId, []);
      crossListByCourseId.get(r.courseId).push({
        departmentId: r.departmentId,
        department: { id: r.departmentId, code: r.code, name: r.name },
      });
    }
  } catch (err) {
    console.warn('[courses] cross-listed query skipped:', err.message);
  }
  for (const c of courses) {
    c.crossListedDepartments = crossListByCourseId.get(c.id) || [];
  }

  const mapped = [];
  for (const c of courses) {
    let levelGateActive = false;
    if (isStudent) {
      const verdict = await evaluateCourse(prisma, req.user.userId, c, ctx);
      // Hide invisible courses entirely. Hidden = unmet prereqs OR semester locked.
      if (!verdict.visible) continue;
      levelGateActive = verdict.levelGate;
    }

    const extra = newFieldsByCode.get(c.code) || {};

    mapped.push({
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits,
      level: c.level,
      lectureOnly: c.lectureOnly,
      description: c.description,
      department: c.department?.name ?? null,
      departmentId: c.departmentId,
      // Cross-listed departments — surfaced as a chip set on admin UIs +
      // used by the student catalog to render "also offered to X" notes
      // when a course is shared between programs.
      crossListedDepartments: (c.crossListedDepartments || []).map((cd) => ({
        id: cd.department.id,
        code: cd.department.code,
        name: cd.department.name,
      })),
      maxStudents: c.maxStudents,
      semester: c.semester,
      status: c.sections.some((s) => s.enrolled < s.capacity) ? 'Open' : 'Full',
      // Annotation only meaningful for students; staff always get false.
      levelGateActive,
      // Plan 4 Phase 2 — language flag + category.
      language: extra.language ?? 'en',
      category: extra.category ?? null,
      // The response field is named `prerequisites` (consumer-facing semantic
      // name) but it sources from the `prereqFor` relation — see the include
      // above for why.
      prerequisites: c.prereqFor.map((p) => ({
        code: p.prerequisiteCourse.code,
        title: p.prerequisiteCourse.title,
        minGrade: p.minGrade,
      })),
      sections: c.sections.map((s) => ({
        id: s.id,
        sectionId: s.sectionId,
        type: s.type,
        instructorId: s.instructorId,
        instructor: s.instructorName,
        location: s.location,
        room: s.room,
        capacity: s.capacity,
        enrolled: s.enrolled,
        available: s.capacity - s.enrolled,
        isFull: s.enrolled >= s.capacity,
        slots: dedupeSlots(s.slots).map((sl) => ({
          id: sl.id,
          day: sl.day,
          start: sl.startTime,
          end: sl.endTime,
          startTime: sl.startTime,
          endTime: sl.endTime,
          room: sl.room,
        })),
      })),
    });
  }

  res.json({ success: true, courses: mapped });
}));

// ── GET /api/courses/:code ────────────────────────────────────────────────────

/**
 * GET /api/courses/:code
 * Single course detail.
 *
 * Students get a 403 with `{ error, reason }` when the course is not visible
 * to them (semester mismatch or unmet prereqs). Staff bypass the gate.
 */
router.get('/courses/:code', requireAuth, asyncHandler(async (req, res) => {
  const course = await prisma.course.findFirst({
    where: { code: req.params.code.toUpperCase() },
    include: {
      department: true,
      sections: {
        include: {
          slots: true,
          instructor: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      },
      // See the catalog handler above for why this is `prereqFor`, not `prerequisites`.
      prereqFor: {
        include: { prerequisiteCourse: { select: { code: true, title: true } } },
      },
    },
  });

  if (!course) throw new AppError('Course not found', 404);

  // Cross-listed departments — fetched via raw SQL for the same DLL-lock
  // tolerance reason described in the catalog handler.
  try {
    const tenantId = getCurrentTenant();
    const rows = await prisma.$queryRaw`
      SELECT cd.department_id AS "departmentId",
             d.code           AS "code",
             d.name           AS "name"
        FROM course_departments cd
        JOIN departments d ON d.id = cd.department_id
       WHERE cd.course_id = ${course.id} AND cd.tenant_id = ${tenantId}
    `;
    course.crossListedDepartments = (rows || []).map((r) => ({
      departmentId: r.departmentId,
      department: { id: r.departmentId, code: r.code, name: r.name },
    }));
  } catch {
    course.crossListedDepartments = [];
  }

  // Eligibility gate — students only.
  let levelGateActive = false;
  if (req.user.role === 'student') {
    const verdict = await evaluateCourse(prisma, req.user.userId, course);
    if (!verdict.visible) {
      let reason = 'Course not available';
      if (verdict.departmentLocked) {
        reason = 'This course is not offered to your department.';
      } else if (verdict.semesterLocked) {
        reason = `This course is offered in ${course.semester} only.`;
      } else if (verdict.missingPrereqs.length > 0) {
        reason = 'Missing prerequisite(s): ' +
          verdict.missingPrereqs.map((p) => `${p.code} (min ${p.minGrade})`).join(', ');
      }
      return res.status(403).json({ error: 'Course not available', reason });
    }
    levelGateActive = verdict.levelGate;
  }

  res.json({
    success: true,
    course: {
      id: course.id,
      code: course.code,
      title: course.title,
      credits: course.credits,
      level: course.level,
      lectureOnly: course.lectureOnly,
      description: course.description,
      syllabus: course.syllabus,
      maxStudents: course.maxStudents,
      isActive: course.isActive,
      semester: course.semester,
      levelGateActive,
      department: course.department?.name ?? null,
      departmentId: course.departmentId,
      crossListedDepartments: (course.crossListedDepartments || []).map((cd) => ({
        id: cd.department.id,
        code: cd.department.code,
        name: cd.department.name,
      })),
      // Response field name retained for the consumer; sources from `prereqFor`.
      prerequisites: course.prereqFor.map((p) => ({
        code: p.prerequisiteCourse.code,
        title: p.prerequisiteCourse.title,
        minGrade: p.minGrade,
      })),
      sections: course.sections.map((s) => ({
        id: s.id,
        sectionId: s.sectionId,
        type: s.type,
        instructor: s.instructor
          ? {
              id: s.instructor.id,
              name: `${s.instructor.firstName} ${s.instructor.lastName}`,
              email: s.instructor.email,
            }
          : { name: s.instructorName ?? 'TBA' },
        location: s.location,
        room: s.room,
        capacity: s.capacity,
        enrolled: s.enrolled,
        available: s.capacity - s.enrolled,
        isFull: s.enrolled >= s.capacity,
        slots: dedupeSlots(s.slots).map((sl) => ({
          id: sl.id,
          day: sl.day,
          start: sl.startTime,
          end: sl.endTime,
          startTime: sl.startTime,
          endTime: sl.endTime,
          room: sl.room,
        })),
      })),
    },
  });
}));

// ── GET /api/departments ──────────────────────────────────────────────────────

/**
 * GET /api/departments
 * List all departments (public — no auth required).
 */
router.get('/departments', asyncHandler(async (_req, res) => {
  const departments = await prisma.department.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, description: true },
  });
  res.json({ success: true, departments });
}));

// ── Registration status + current term ───────────────────────────────────────

/**
 * GET /api/registration/status
 * Returns { open: boolean, reason: string|null, activePeriod, registrationEnabled }.
 */
router.get('/registration/status', asyncHandler(async (_req, res) => {
  const [settings, activePeriod] = await Promise.all([
    prisma.systemSettings.findFirst({ select: { registrationEnabled: true } }),
    findActivePeriod({
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      addDropDeadline: true,
      lateDeadline: true,
    }),
  ]);
  const flagOn = settings ? settings.registrationEnabled !== false : true;
  const periodOpen = Boolean(activePeriod);
  let reason = null;
  if (!flagOn) reason = 'Registration is currently disabled by the administrator.';
  else if (!periodOpen) reason = 'No registration period is currently open.';
  res.json({
    open: flagOn && periodOpen,
    reason,
    registrationEnabled: flagOn,
    activePeriod,
  });
}));

/**
 * GET /api/registration/current-term
 * Return the current term row with semester details.
 */
router.get('/registration/current-term', asyncHandler(async (_req, res) => {
  // Source-of-truth priority:
  //   1. Active RegistrationPeriod — admins toggling a period in
  //      Registration Control IS the act of declaring "this is the new
  //      term". Read straight from there so the display flips immediately
  //      without needing a separate CurrentTerm sync to land.
  //   2. CurrentTerm pointer — fallback when no period is active (e.g.
  //      between terms).
  //   3. 404 otherwise.
  const activePeriod = await prisma.registrationPeriod.findFirst({
    where: { isActive: true },
    include: {
      semesterRef: {
        select: { id: true, name: true, code: true, academicYear: true, startDate: true, endDate: true },
      },
    },
  });

  if (activePeriod) {
    const stripped = (activePeriod.name || '')
      .replace(/\s*(Registration|Add[\s-]?Drop|Late Registration|Withdrawal).*$/i, '')
      .trim();
    const displayName =
      activePeriod.semesterRef?.name
      || activePeriod.semester
      || stripped
      || activePeriod.name
      || 'Current term';
    const semester = activePeriod.semesterRef ?? {
      id: null,
      name: displayName,
      code: null,
      academicYear: null,
      startDate: activePeriod.startDate,
      endDate: activePeriod.endDate,
    };
    return res.json({
      success: true,
      term: {
        semesterId: semester.id,
        semester: { ...semester, name: displayName },
        source: 'registration_period',
        periodId: activePeriod.id,
        periodName: activePeriod.name,
      },
    });
  }

  // Fallback — read CurrentTerm pointer (between terms).
  const term = await prisma.currentTerm.findFirst({
    include: {
      semester: {
        select: { id: true, name: true, code: true, academicYear: true, startDate: true, endDate: true },
      },
    },
  });
  if (!term) throw new AppError('No current term configured', 404);
  res.json({ success: true, term: { ...term, source: 'current_term' } });
}));

module.exports = router;
