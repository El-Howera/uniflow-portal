/**
 * routes/courses.routes.js — Public course catalog + student progress
 *
 * Owns:
 *   GET  /api/courses                                         — list all active courses
 *   GET  /api/courses/:courseCode                             — single course detail
 *   GET  /api/courses/:courseCode/materials                   — grouped materials list
 *   GET  /api/courses/:courseCode/lectures                    — lectures (with optional progress)
 *   GET  /api/courses/:courseCode/assignments                 — assignments (with student status)
 *   GET  /api/courses/:courseCode/assignments/:assignmentId   — single assignment detail
 *   POST /api/courses/:courseCode/lectures/:lectureId/progress  — mark lecture watched
 *   POST /api/courses/:courseCode/materials/download/:materialId — increment download count
 *   POST /api/courses/:courseCode/progress/:materialId         — mark material complete
 *   GET  /api/users/:userId/progress                          — all progress for a user
 *   POST /api/courses/:courseCode/remarks                     — add remark
 *   GET  /api/courses/:courseCode/enrolled-students           — lightweight roster for pickers
 *
 * Non-obvious decisions:
 *   - /api/courses/:courseCode/assignments reads audience_user_ids via $queryRaw
 *     because the column exists in the DB but the Prisma client artifact may not
 *     be regenerated (Windows DLL playbook).
 *   - The assignments listing computes 'missing'/'pending'/'submitted'/'graded' status
 *     inline for student-side fetches (userId query param).
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const path = require('path');

const router = Router();

// ── GET /api/courses ──────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  const courses = await prisma.course.findMany({
    where: { isActive: true },
    include: {
      department: { select: { code: true, name: true } },
      _count: { select: { sections: true, materials: true, assignments: true, quizzes: true } },
    },
    orderBy: { code: 'asc' },
  });

  res.json(courses.map(c => ({
    id: c.id,
    code: c.code,
    title: c.title,
    credits: c.credits,
    semester: c.semester,
    description: c.description,
    department: c.department,
    sectionCount: c._count.sections,
    materialCount: c._count.materials,
    assignmentCount: c._count.assignments,
    quizCount: c._count.quizzes,
  })));
}));

// ── GET /api/courses/:courseCode ──────────────────────────────────────────────

router.get('/:courseCode', asyncHandler(async (req, res) => {
  const { courseCode } = req.params;

  const course = await prisma.course.findFirst({
    where: { code: courseCode.toUpperCase() },
    include: {
      department: { select: { code: true, name: true } },
      sections: { include: { slots: true } },
      _count: { select: { materials: true, assignments: true, quizzes: true } },
    },
  });

  if (!course) throw new AppError('Course not found', 404);

  res.json({
    ...course,
    materialCount: course._count.materials,
    assignmentCount: course._count.assignments,
    quizCount: course._count.quizzes,
  });
}));

// ── GET /api/courses/:courseCode/materials ────────────────────────────────────

router.get('/:courseCode/materials', asyncHandler(async (req, res) => {
  const { courseCode } = req.params;
  const { sectionId } = req.query;

  const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
  if (!course) throw new AppError('Course not found', 404);

  const where = { courseId: course.id };
  if (sectionId) where.sectionId = sectionId;

  const materials = await prisma.courseMaterial.findMany({
    where,
    orderBy: { uploadedAt: 'desc' },
  });

  const grouped = {
    lectures: materials.filter(m => m.category === 'lectures' || m.category === 'lecture'),
    readings: materials.filter(m => m.category === 'readings' || m.category === 'reading'),
    assignments: materials.filter(m => m.category === 'assignments' || m.category === 'assignment'),
    finalProject: materials.filter(m => m.category === 'final-project' || m.category === 'finalProject'),
    labs: materials.filter(m => m.category === 'labs' || m.category === 'lab'),
    references: materials.filter(m => m.category === 'references' || m.category === 'reference'),
    assessments: materials.filter(m => m.category === 'assessments' || m.category === 'assessment'),
    other: materials.filter(m =>
      ![
        'lectures', 'lecture', 'readings', 'reading',
        'assignments', 'assignment', 'final-project', 'finalProject',
        'labs', 'lab', 'references', 'reference', 'assessments', 'assessment',
      ].includes(m.category)
    ),
  };

  res.json(grouped);
}));

// ── GET /api/courses/:courseCode/lectures ─────────────────────────────────────

router.get('/:courseCode/lectures', asyncHandler(async (req, res) => {
  const { courseCode } = req.params;
  const { userId } = req.query;

  const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
  if (!course) throw new AppError('Course not found', 404);

  const lectures = await prisma.lecture.findMany({
    where: { courseId: course.id, isPublished: true },
    include: userId
      ? { progress: { where: { userId }, take: 1 } }
      : undefined,
    orderBy: { lectureNumber: 'asc' },
  });

  res.json(lectures.map(l => ({
    id: l.id,
    courseId: l.courseId,
    sectionId: l.sectionId,
    lectureNumber: l.lectureNumber,
    title: l.title,
    topic: l.topic,
    scheduledFor: l.scheduledFor,
    recordingUrl: l.recordingUrl,
    slidesUrl: l.slidesUrl,
    notes: l.notes,
    isPublished: l.isPublished,
    createdAt: l.createdAt,
    watched: userId ? (l.progress?.[0]?.completed ?? false) : undefined,
    watchedSeconds: userId ? (l.progress?.[0]?.watchedSeconds ?? 0) : undefined,
  })));
}));

// ── GET /api/courses/:courseCode/assignments ──────────────────────────────────

router.get('/:courseCode/assignments', asyncHandler(async (req, res) => {
  const { courseCode } = req.params;
  const { userId } = req.query;

  const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
  if (!course) throw new AppError('Course not found', 404);

  const assignments = await prisma.assignment.findMany({
    where: { courseId: course.id },
    orderBy: { dueDate: 'asc' },
  });

  const tenantId = req.user?.tenantId || req.tenantId;
  let audienceMap = new Map();
  try {
    const aIds = assignments.map(a => a.id);
    if (aIds.length > 0) {
      const rows = await prisma.$queryRaw`
        SELECT "id", "audience_user_ids"
          FROM "assignments"
         WHERE "id" = ANY(${aIds}::text[])
           AND "tenant_id" = ${tenantId}
      `;
      audienceMap = new Map((rows || []).map(r => [r.id, Array.isArray(r.audience_user_ids) ? r.audience_user_ids : []]));
    }
  } catch (e) {
    audienceMap = new Map();
  }

  const visibleAssignments = userId
    ? assignments.filter((a) => {
        const aud = audienceMap.get(a.id) ?? a.audienceUserIds ?? [];
        return aud.length === 0 || aud.includes(userId);
      })
    : assignments.map(a => ({ ...a, audienceUserIds: audienceMap.get(a.id) ?? a.audienceUserIds ?? [] }));

  if (!userId) return res.json(visibleAssignments);
  const assignmentsToEnrich = visibleAssignments;

  const now = new Date();
  const enriched = await Promise.all(assignmentsToEnrich.map(async a => {
    const sub = await prisma.assignmentSubmission.findFirst({
      where: { assignmentId: a.id, userId },
    });
    let computedStatus;
    if (sub) {
      computedStatus = sub.score != null ? 'graded' : 'submitted';
    } else {
      const due = new Date(a.dueDate);
      const graceMs = (a.missingAfterHours ?? 0) * 60 * 60 * 1000;
      const flagsAt = new Date(due.getTime() + graceMs);
      computedStatus = flagsAt < now ? 'missing' : 'pending';
    }
    return {
      ...a,
      status: computedStatus,
      submissionId: sub?.id ?? null,
      score: sub?.score ?? null,
      latePenalty: a.latePenalty ?? -2,
      missingAfterHours: a.missingAfterHours ?? 0,
    };
  }));

  res.json(enriched);
}));

// ── GET /api/courses/:courseCode/assignments/:assignmentId ────────────────────

router.get('/:courseCode/assignments/:assignmentId', asyncHandler(async (req, res) => {
  const { courseCode, assignmentId } = req.params;
  const { userId } = req.query;

  const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
  if (!course) throw new AppError('Course not found', 404);

  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, courseId: course.id },
  });
  if (!assignment) throw new AppError('Assignment not found', 404);

  if (!userId) return res.json(assignment);

  const submissions = await prisma.assignmentSubmission.findMany({
    where: { assignmentId, userId },
    orderBy: { attemptNumber: 'asc' },
  });

  res.json({
    ...assignment,
    status: submissions.length === 0
      ? 'pending'
      : submissions.some(s => s.score != null) ? 'graded' : 'submitted',
    submissions,
    submissionsRemaining: Math.max(0, assignment.maxSubmissions - submissions.length),
  });
}));

// ── POST /api/courses/:courseCode/lectures/:lectureId/progress ────────────────

router.post(
  '/:courseCode/lectures/:lectureId/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { lectureId } = req.params;
    const { watchedSeconds, completed } = req.body;
    const userId = req.user.userId;

    const lecture = await prisma.lecture.findFirst({ where: { id: lectureId } });
    if (!lecture) throw new AppError('Lecture not found', 404);

    const progress = await prisma.lectureProgress.upsert({
      where: { userId_lectureId: { userId, lectureId } },
      update: {
        watchedSeconds: watchedSeconds ?? undefined,
        completed: completed ?? undefined,
        lastWatchedAt: new Date(),
      },
      create: {
        userId,
        lectureId,
        watchedSeconds: watchedSeconds ?? 0,
        completed: completed ?? false,
        lastWatchedAt: new Date(),
      },
    });

    res.json({ success: true, progress });
  })
);

// ── POST /api/courses/:courseCode/materials/download/:materialId ──────────────

router.post(
  '/:courseCode/materials/download/:materialId',
  asyncHandler(async (req, res) => {
    const { courseCode, materialId } = req.params;
    const userId = req.body.userId;

    const material = await prisma.courseMaterial.findFirst({
      where: { id: materialId, course: { code: courseCode.toUpperCase() } },
    });
    if (!material) throw new AppError('Material not found', 404);

    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: { downloadCount: { increment: 1 }, views: { increment: 1 } },
    });

    if (userId) {
      const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
      if (course) {
        await prisma.studentProgress.upsert({
          where: { userId_materialId: { userId, materialId } },
          update: { lastViewedAt: new Date() },
          create: {
            userId,
            courseId: course.id,
            materialId,
            materialType: material.type,
            lastViewedAt: new Date(),
          },
        });
      }
    }

    const downloadUrl = material.filePath
      ? `/files/${path.basename(material.filePath)}`
      : material.url ?? null;

    res.json({
      success: true,
      material: { id: material.id, title: material.title, type: material.type, downloadUrl },
    });
  })
);

// ── POST /api/courses/:courseCode/progress/:materialId ────────────────────────

router.post(
  '/:courseCode/progress/:materialId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { courseCode, materialId } = req.params;
    const userId = req.user.userId;

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const material = await prisma.courseMaterial.findFirst({
      where: { id: materialId, courseId: course.id },
    });
    if (!material) throw new AppError('Material not found', 404);

    const progress = await prisma.studentProgress.upsert({
      where: { userId_materialId: { userId, materialId } },
      update: { completed: true, completedAt: new Date() },
      create: {
        userId,
        courseId: course.id,
        materialId,
        materialType: material.type,
        completed: true,
        completedAt: new Date(),
      },
    });

    res.json({ success: true, progress });
  })
);

// ── GET /api/courses/:courseCode/enrolled-students ────────────────────────────

router.get(
  '/:courseCode/enrolled-students',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });
    if (!course) throw new AppError('Course not found', 404);

    const regs = await prisma.registration.findMany({
      where: { courseId: course.id, status: 'approved', isActive: true },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    const seen = new Set();
    const students = [];
    for (const r of regs) {
      if (!r.user || seen.has(r.user.id)) continue;
      seen.add(r.user.id);
      students.push({
        id: r.user.id,
        firstName: r.user.firstName,
        lastName: r.user.lastName,
        email: r.user.email,
      });
    }
    students.sort((a, b) => a.firstName.localeCompare(b.firstName));
    res.json(students);
  })
);

module.exports = router;
