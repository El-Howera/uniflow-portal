/**
 * routes/professor-views.routes.js — Professor dashboard aggregates
 *
 * Owns:
 *   GET /api/professor/overview/:email          — dashboard stats + schedule + activity
 *   GET /api/professor/courses-detailed/:email  — per-course breakdown with metrics
 *   GET /api/professor/all-students/:email      — every student across prof's courses (deduped)
 *   GET /api/professor/course-students/:courseCode — full student roster with grades
 *   GET /api/professor/submissions/:email       — all submissions across prof's courses
 *
 * Non-obvious decisions:
 *   - Both overview and courses-detailed fall back to `default_instructor_id` on the
 *     courses table via raw SQL ($queryRaw) because the column is present in the DB
 *     but may not be in the Prisma client artifact on Windows DLL-locked dev envs.
 *   - advisees count is also raw SQL (`academic_advisor_id` column) for the same reason.
 *   - The overview's `schedule` array merges recurring section slots (todaySections) with
 *     ad-hoc LiveSessions (todayLiveSessions) so the dashboard renders both in one list.
 *   - professor/course-students does N+1 queries per student (attendance + assignments).
 *     This is intentional: the roster is bounded by course enrollment (typically < 200)
 *     and this mirrors the original monolith behaviour exactly.
 *   - `timeAgo` and `toLetterGrade` are imported from lib/grading.js.
 *   - `_gradingHelpers` (getGradingRules) is loaded from backend/lib/grading-rules.js
 *     for the letter-grade derivation in course-students.
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { resolveUser } = require('../../../lib/users');
const { timeAgo, toLetterGrade } = require('../lib/grading');
const _gradingHelpers = require('../../../lib/grading-rules');

const router = Router();

// ── GET /api/professor/overview/:email ────────────────────────────────────────

router.get(
  '/professor/overview/:email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ident = req.params.email === 'me' ? req.user.userId : req.params.email;
    const professor = await resolveUser(ident);
    if (!professor || !['professor', 'admin'].includes(professor.role)) {
      throw new AppError('Professor not found', 404);
    }

    const sections = await prisma.courseSection.findMany({
      where: { instructorId: professor.id },
      include: {
        course: { select: { id: true, code: true, title: true } },
        slots: true,
        _count: { select: { registrations: true } },
      },
    });

    const courseIdSet = new Set(sections.map((s) => s.course.id));
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const rows = await prisma.$queryRaw`
        SELECT id FROM courses
         WHERE default_instructor_id = ${professor.id}
           AND is_active = true
           AND tenant_id = ${tenantId}
      `;
      for (const r of rows || []) courseIdSet.add(r.id);
    } catch (err) {
      console.warn('[prof overview] default_instructor lookup skipped:', err.message);
    }
    const courseIds = [...courseIdSet];

    const pendingSubmissions = await prisma.assignmentSubmission.count({
      where: {
        courseId: { in: courseIds },
        status: 'submitted',
      },
    });

    const activeSessions = await prisma.liveSession.count({
      where: {
        hostId: professor.id,
        status: { in: ['scheduled', 'live'] },
      },
    });

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = days[new Date().getDay()];
    const todaySections = sections.filter(s =>
      s.slots.some(slot => slot.day === today)
    );

    const sectionIds = sections.map(s => s.id);
    const enrolledRows = sectionIds.length === 0
      ? []
      : await prisma.registration.findMany({
          where: {
            sectionId: { in: sectionIds },
            status: 'approved',
            isActive: true,
          },
          select: { userId: true },
        });
    const totalStudents = new Set(enrolledRows.map(r => r.userId)).size;

    let adviseesCount = 0;
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const adviseeRows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS "count"
          FROM users
         WHERE academic_advisor_id = ${professor.id}
           AND deleted_at IS NULL
           AND tenant_id = ${tenantId}
      `;
      adviseesCount = Number(adviseeRows?.[0]?.count ?? 0);
    } catch (err) {
      console.warn('[prof-overview] advisees count failed:', err.message);
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1);
    const todayLiveSessions = await prisma.liveSession.findMany({
      where: {
        hostId: professor.id,
        scheduledFor: { gte: todayStart, lt: todayEnd },
        status: { in: ['scheduled', 'live'] },
      },
      include: { course: { select: { code: true, title: true } } },
      orderBy: { scheduledFor: 'asc' },
    });

    const recentSubs = await prisma.assignmentSubmission.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        user: { select: { firstName: true, lastName: true } },
        assignment: { select: { title: true } },
        course: { select: { code: true } },
      },
    });

    const profActivityTypeMap = {
      submitted: 'submission',
      pending_review: 'submission',
      graded: 'attendance',
    };
    const profActivityTextMap = {
      submitted:      (s) => `${s.user.firstName} ${s.user.lastName} submitted ${s.assignment.title}`,
      pending_review: (s) => `TA proposed grade for ${s.user.firstName} ${s.user.lastName} on ${s.assignment.title}`,
      graded:         (s) => `${s.user.firstName} ${s.user.lastName} received grade for ${s.assignment.title}`,
    };
    const profActivityIconMap = {
      submitted: 'ph-clipboard-text',
      pending_review: 'ph-hourglass-medium',
      graded: 'ph-check-circle',
    };

    const recentActivity = recentSubs.map((s, i) => ({
      id: i + 1,
      icon: profActivityIconMap[s.status] ?? 'ph-circle',
      text: (profActivityTextMap[s.status] ?? ((sub) => `Activity in ${sub.course.code}`))(s),
      time: timeAgo(s.updatedAt),
      type: profActivityTypeMap[s.status] ?? 'submission',
      courseCode: s.course?.code ?? null,
    }));

    res.json({
      professorName: `${professor.firstName} ${professor.lastName}`,
      stats: {
        courses: courseIds.length,
        students: totalStudents,
        pending: pendingSubmissions,
        sessions: activeSessions,
        advisees: adviseesCount,
      },
      schedule: [
        ...todaySections.map(s => ({
          course: s.course.title,
          code: s.course.code,
          sectionId: s.sectionId,
          time: s.slots
            .filter(slot => slot.day === today)
            .map(slot => `${slot.startTime} - ${slot.endTime}`)
            .join(', '),
          room: s.location ?? s.room ?? 'TBD',
          students: s._count.registrations,
        })),
        ...todayLiveSessions.map(ls => ({
          course: ls.title || ls.course?.title || 'Live Session',
          code: ls.course?.code || ls.courseCode || '—',
          sessionId: ls.id,
          time: ls.scheduledFor
            ? new Date(ls.scheduledFor).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
            : 'TBA',
          room: ls.status === 'live' ? 'Live now — in room' : 'Online (live session)',
          students: 0,
          kind: 'live-session',
          status: ls.status,
        })),
      ],
      recentActivity,
    });
  })
);

// ── GET /api/professor/courses-detailed/:email ────────────────────────────────

router.get(
  '/professor/courses-detailed/:email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ident = req.params.email === 'me' ? req.user.userId : req.params.email;
    const professor = await resolveUser(ident);
    if (!professor || !['professor', 'admin'].includes(professor.role)) {
      throw new AppError('Professor not found', 404);
    }

    const sections = await prisma.courseSection.findMany({
      where: { instructorId: professor.id },
      include: {
        course: {
          include: {
            department: { select: { name: true } },
            _count: { select: { materials: true } },
          },
        },
        slots: true,
        _count: { select: { registrations: true } },
      },
    });

    let defaultCourseIds = [];
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const rows = await prisma.$queryRaw`
        SELECT id FROM courses
         WHERE default_instructor_id = ${professor.id}
           AND is_active = true
           AND tenant_id = ${tenantId}
      `;
      defaultCourseIds = (rows || []).map((r) => r.id);
    } catch (err) {
      console.warn('[prof courses-detailed] default_instructor lookup skipped:', err.message);
    }
    const sectionCourseIds = new Set(sections.map((s) => s.course.id));
    const extraCourseIds = defaultCourseIds.filter((id) => !sectionCourseIds.has(id));
    const extraCourses = extraCourseIds.length > 0
      ? await prisma.course.findMany({
          where: { id: { in: extraCourseIds } },
          include: {
            department: { select: { name: true } },
            sections: { include: { slots: true, _count: { select: { registrations: true } } } },
            _count: { select: { materials: true } },
          },
        })
      : [];

    const courseMap = new Map();
    for (const section of sections) {
      const code = section.course.code;
      if (!courseMap.has(code)) {
        courseMap.set(code, { course: section.course, sections: [] });
      }
      courseMap.get(code).sections.push(section);
    }
    for (const c of extraCourses) {
      if (!courseMap.has(c.code)) {
        courseMap.set(c.code, { course: c, sections: c.sections || [] });
      }
    }

    const detailedCourses = await Promise.all(
      [...courseMap.values()].map(async ({ course, sections: courseSections }) => {
        const courseId = course.id;

        const [totalAttendance, presentAttendance] = await Promise.all([
          prisma.attendanceRecord.count({ where: { courseId } }),
          prisma.attendanceRecord.count({
            where: { courseId, status: { in: ['present', 'late'] } },
          }),
        ]);
        const attendanceRate = totalAttendance > 0
          ? Math.round((presentAttendance / totalAttendance) * 100)
          : null;

        const gradeAgg = await prisma.gradebookEntry.aggregate({
          where: { courseId },
          _avg: { score: true },
        });
        const avgGrade = gradeAgg._avg.score != null
          ? Math.round(parseFloat(gradeAgg._avg.score.toString()))
          : null;

        const [totalGraded, passCount] = await Promise.all([
          prisma.gradebookEntry.count({ where: { courseId, score: { not: null } } }),
          prisma.gradebookEntry.count({ where: { courseId, score: { gte: 60 } } }),
        ]);
        const passRate = totalGraded > 0
          ? Math.round((passCount / totalGraded) * 100)
          : null;

        const announcements = await prisma.announcement.findMany({
          take: 3,
          orderBy: { createdAt: 'desc' },
          where: { isPublished: true },
          select: { title: true, priority: true, createdAt: true },
        });

        let objectives = [];
        let modules = [];
        if (course.syllabus && typeof course.syllabus === 'object') {
          const syl = course.syllabus;
          if (Array.isArray(syl.objectives)) objectives = syl.objectives;
          if (Array.isArray(syl.modules)) modules = syl.modules;
        }

        const lectureCount = await prisma.lecture.count({ where: { courseId, isPublished: true } });

        const mainSection = courseSections[0];
        const schedule = mainSection?.slots.map(
          slot => `${slot.day} ${slot.startTime}`
        ).join(', ') || 'TBD';

        const enrolled = courseSections.reduce((sum, s) => sum + s._count.registrations, 0);

        return {
          id: course.id,
          name: course.title,
          code: course.code,
          semester: course.semester ?? 'Current',
          credits: course.credits,
          department: course.department?.name ?? null,
          enrolled,
          capacity: mainSection?.capacity ?? 50,
          schedule,
          room: mainSection?.location ?? mainSection?.room ?? 'TBD',
          description: course.description ?? '',
          objectives,
          modules,
          attendanceRate,
          avgGrade,
          passRate,
          materialCount: course._count.materials,
          lectureCount,
          announcements: announcements.map(a => ({
            title: a.title,
            date: new Date(a.createdAt).toLocaleDateString(),
            urgent: a.priority === 'high',
          })),
        };
      })
    );

    res.json(detailedCourses);
  })
);

// ── GET /api/professor/all-students/:email ────────────────────────────────────

router.get(
  '/professor/all-students/:email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ident = req.params.email === 'me' ? req.user.userId : req.params.email;
    const professor = await resolveUser(ident);
    if (!professor || !['professor', 'admin'].includes(professor.role)) {
      throw new AppError('Professor not found', 404);
    }

    if (professor.id !== req.user.userId && req.user.role !== 'admin') {
      throw new AppError('Forbidden', 403);
    }

    const sections = await prisma.courseSection.findMany({
      where: { instructorId: professor.id },
      select: { courseId: true, course: { select: { id: true, code: true, title: true } } },
    });
    const courseIds = new Set(sections.map((s) => s.courseId));
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const rows = await prisma.$queryRaw`
        SELECT id, code, title FROM courses
         WHERE default_instructor_id = ${professor.id}
           AND is_active = true
           AND tenant_id = ${tenantId}
      `;
      for (const r of rows || []) courseIds.add(r.id);
    } catch (err) {
      console.warn('[prof all-students] default_instructor lookup skipped:', err.message);
    }
    const courseIdsArr = [...courseIds];
    if (courseIdsArr.length === 0) return res.json({ students: [], courses: [] });

    const courseMeta = new Map();
    for (const s of sections) {
      if (!courseMeta.has(s.courseId)) {
        courseMeta.set(s.courseId, { code: s.course.code, title: s.course.title });
      }
    }
    const missingMeta = courseIdsArr.filter((id) => !courseMeta.has(id));
    if (missingMeta.length > 0) {
      const extraCourses = await prisma.course.findMany({
        where: { id: { in: missingMeta } },
        select: { id: true, code: true, title: true },
      });
      for (const c of extraCourses) courseMeta.set(c.id, { code: c.code, title: c.title });
    }

    const registrations = await prisma.registration.findMany({
      where: {
        courseId: { in: courseIdsArr },
        status: 'approved',
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            odId: true,
            profilePicture: true,
          },
        },
      },
    });

    const byId = new Map();
    for (const reg of registrations) {
      const u = reg.user;
      if (!byId.has(u.id)) {
        byId.set(u.id, {
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email,
          odId: u.odId,
          profilePicture: u.profilePicture ?? null,
          courseCodes: [],
        });
      }
      const meta = courseMeta.get(reg.courseId);
      if (meta && !byId.get(u.id).courseCodes.includes(meta.code)) {
        byId.get(u.id).courseCodes.push(meta.code);
      }
    }

    const students = [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const courses = [...courseMeta.values()];
    res.json({ students, courses });
  })
);

// ── GET /api/professor/course-students/:courseCode ────────────────────────────

router.get(
  '/professor/course-students/:courseCode',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;

    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
      include: {
        assignments: { select: { id: true, title: true, maxScore: true } },
      },
    });
    if (!course) throw new AppError('Course not found', 404);

    const registrations = await prisma.registration.findMany({
      where: {
        courseId: course.id,
        status: 'approved',
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            odId: true,
          },
        },
      },
    });
    const seenStudentIds = new Set();
    const uniqueRegistrations = registrations.filter((r) => {
      if (!r.user || seenStudentIds.has(r.user.id)) return false;
      seenStudentIds.add(r.user.id);
      return true;
    });

    const courseStudentsRules = await _gradingHelpers
      .getGradingRules(prisma)
      .catch(() => undefined);

    const students = await Promise.all(uniqueRegistrations.map(async reg => {
      const student = reg.user;

      const gradebookEntry = await prisma.gradebookEntry.findFirst({
        where: { courseId: course.id, studentId: student.id, isFinal: true },
      });

      const [totalAtt, presentAtt] = await Promise.all([
        prisma.attendanceRecord.count({ where: { courseId: course.id, userId: student.id } }),
        prisma.attendanceRecord.count({
          where: { courseId: course.id, userId: student.id, status: { in: ['present', 'late'] } },
        }),
      ]);
      const attendanceRate = totalAtt > 0
        ? Math.round((presentAtt / totalAtt) * 100)
        : null;

      const assignmentGrades = await Promise.all(course.assignments.map(async a => {
        const sub = await prisma.assignmentSubmission.findFirst({
          where: { assignmentId: a.id, userId: student.id },
        });
        return {
          name: a.title,
          score: sub?.score ?? null,
          max: a.maxScore,
        };
      }));

      const finalScore = gradebookEntry?.score != null
        ? parseFloat(gradebookEntry.score.toString())
        : null;
      const letterGrade = gradebookEntry?.letterGrade ?? toLetterGrade(
        finalScore,
        gradebookEntry?.maxScore,
        courseStudentsRules,
      );

      let status = 'passing';
      if (finalScore != null) {
        if (finalScore < 50) status = 'failing';
        else if (finalScore < 60) status = 'at-risk';
      }

      return {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        email: student.email,
        odId: student.odId,
        avatar: `https://i.pravatar.cc/150?u=${student.email}`,
        grades: assignmentGrades,
        finalScore,
        letterGrade,
        attendanceRate,
        status,
      };
    }));

    res.json(students);
  })
);

// ── GET /api/professor/submissions/:email ─────────────────────────────────────

router.get(
  '/professor/submissions/:email',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const professor = await resolveUser(req.params.email);
    if (!professor || !['professor', 'admin'].includes(professor.role)) {
      throw new AppError('Professor not found', 404);
    }

    if (professor.id !== req.user.userId && req.user.role !== 'admin') {
      throw new AppError('Forbidden', 403);
    }

    const sections = await prisma.courseSection.findMany({
      where: { instructorId: professor.id },
      select: { courseId: true },
    });
    const courseIds = [...new Set(sections.map((s) => s.courseId))];
    if (courseIds.length === 0) return res.json([]);

    const submissions = await prisma.assignmentSubmission.findMany({
      where: { courseId: { in: courseIds } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignment: { select: { id: true, title: true, dueDate: true, maxScore: true } },
        course: { select: { code: true, title: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    res.json(
      submissions.map((s) => ({
        id: s.id,
        studentId: s.userId,
        studentName: `${s.user.firstName} ${s.user.lastName}`,
        studentEmail: s.user.email,
        courseCode: s.course.code,
        courseName: s.course.title,
        assignmentId: s.assignmentId,
        assignmentTitle: s.assignment.title,
        dueDate: s.assignment.dueDate,
        maxScore: s.assignment.maxScore ? parseFloat(s.assignment.maxScore.toString()) : 100,
        submittedAt: s.submittedAt,
        isLate: s.isLate,
        status: s.status,
        score: s.score != null ? parseFloat(s.score.toString()) : null,
        proposedScore: s.proposedScore != null ? parseFloat(s.proposedScore.toString()) : null,
        feedback: s.feedback ?? '',
        filePath: s.filePath ?? null,
        originalFileName: s.originalFileName ?? null,
      })),
    );
  })
);

module.exports = router;
