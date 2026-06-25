/**
 * routes/gradebook.routes.js — Gradebook CRUD + live view + config
 *
 * Owns:
 *   GET  /api/gradebook/:courseCode              — full gradebook for course
 *   GET  /api/gradebook/:courseCode/live         — dynamic per-column live view (staff)
 *   POST /api/gradebook/:courseCode/cell         — save single cell (assignment/quiz)
 *   PATCH /api/gradebook/:courseCode/midterm-final-config — set midtermMax/finalMax
 *   POST /api/gradebook/:courseCode             — upsert a grade entry
 *   GET  /api/me/gradebook/current-semester     — student's current-semester view
 *   GET  /api/admin/users/:userId/gradebook/current-semester — admin cross-user view
 *   GET  /api/courses/:courseCode/grades/:studentId — student grades for a course
 *   PUT  /api/grades/:courseCode/:studentId      — update grade (assignment/quiz)
 *   PUT  /api/grades/:courseCode/:studentId/propose  — TA proposes a grade
 *   POST /api/grades/:courseCode/:studentId/approve  — professor approves TA proposal
 *
 * Non-obvious decisions:
 *   - confirmGradeEntry is in grade-confirmation.routes.js (Plan 7 Phase 1 surface).
 *   - midterm-final-config uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
 *     at write time so a fresh DB works without a prior migration (the table is
 *     ephemeral/idempotent from Prisma's perspective).
 *   - toLetterGrade and buildCurrentSemesterGradebook are imported from lib/grading.js.
 *   - getCurrentTenant() call is inside the handler (per-request ALS context).
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { toLetterGrade, buildCurrentSemesterGradebook } = require('../lib/grading');
const _gradingHelpers = require('../../../lib/grading-rules');
const { notifyUser } = require('../../../lib/notify');

const router = Router();

// ── GET /api/gradebook/:courseCode ────────────────────────────────────────────

router.get(
  '/gradebook/:courseCode',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const [entries, gbRules] = await Promise.all([
      prisma.gradebookEntry.findMany({
        where: { courseId: course.id },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, email: true, odId: true } },
          confirmedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      _gradingHelpers.getGradingRules(prisma).catch(() => undefined),
    ]);

    res.json({
      courseCode,
      courseTitle: course.title,
      entries: entries.map(e => ({
        id: e.id,
        studentId: e.studentId,
        studentName: `${e.student.firstName} ${e.student.lastName}`,
        email: e.student.email,
        odId: e.student.odId,
        component: e.component,
        score: e.score != null ? parseFloat(e.score.toString()) : null,
        maxScore: parseFloat(e.maxScore.toString()),
        letterGrade: e.letterGrade ?? toLetterGrade(e.score, e.maxScore, gbRules),
        gradePoints: e.gradePoints,
        isFinal: e.isFinal,
        comments: e.comments,
        gradedById: e.gradedById,
        confirmedById: e.confirmedById ?? null,
        confirmedAt: e.confirmedAt ?? null,
        confirmedBy: e.confirmedBy ? {
          id: e.confirmedBy.id,
          firstName: e.confirmedBy.firstName,
          lastName: e.confirmedBy.lastName,
        } : null,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    });
  })
);

// ── GET /api/me/gradebook/current-semester ────────────────────────────────────

router.get(
  '/me/gradebook/current-semester',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = await buildCurrentSemesterGradebook(prisma, req.user.userId);
    res.json(data);
  }),
);

// ── GET /api/admin/users/:userId/gradebook/current-semester ───────────────────

router.get(
  '/admin/users/:userId/gradebook/current-semester',
  requireAuth,
  requireRole(['admin', 'sa']),
  asyncHandler(async (req, res) => {
    const data = await buildCurrentSemesterGradebook(prisma, req.params.userId);
    res.json(data);
  }),
);

// ── GET /api/gradebook/:courseCode/live ───────────────────────────────────────

router.get(
  '/gradebook/:courseCode/live',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const regs = await prisma.registration.findMany({
      where: { courseId: course.id, status: 'approved', isActive: true },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, odId: true } },
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
        odId: r.user.odId,
      });
    }
    students.sort((a, b) => a.firstName.localeCompare(b.firstName));

    const [assignments, quizzes] = await Promise.all([
      prisma.assignment.findMany({ where: { courseId: course.id }, orderBy: { createdAt: 'asc' } }),
      prisma.quiz.findMany({
        where: { courseId: course.id },
        orderBy: { createdAt: 'asc' },
        include: { questions: { select: { points: true } } },
      }),
    ]);

    const tenantId = req.user?.tenantId || req.tenantId;
    const quizMetaMap = new Map();
    if (quizzes.length > 0) {
      try {
        const rows = await prisma.$queryRaw`
          SELECT "id", "total_points"
            FROM "quizzes"
           WHERE "id" = ANY(${quizzes.map(q => q.id)}::text[])
             AND "tenant_id" = ${tenantId}
        `;
        for (const r of rows || []) {
          quizMetaMap.set(r.id, {
            totalPoints: r.total_points != null ? parseFloat(r.total_points) : null,
          });
        }
      } catch { /* column missing */ }
    }

    let midtermMax = 30;
    let finalMax = 60;
    try {
      const cfgRows = await prisma.$queryRaw`
        SELECT "midterm_max", "final_max"
          FROM "course_gradebook_config"
         WHERE "course_id" = ${course.id}
           AND "tenant_id" = ${tenantId}
         LIMIT 1
      `;
      if (Array.isArray(cfgRows) && cfgRows.length > 0) {
        midtermMax = cfgRows[0].midterm_max ?? 30;
        finalMax = cfgRows[0].final_max ?? 60;
      }
    } catch { /* table may not exist yet */ }

    const columns = [
      ...assignments.map(a => ({
        key: `asg:${a.id}`,
        label: a.title.length > 24 ? a.title.slice(0, 22) + '…' : a.title,
        type: 'assignment',
        maxScore: parseFloat(a.maxScore.toString()),
        refId: a.id,
      })),
      ...quizzes.map(q => {
        const summed = (q.questions || []).reduce(
          (acc, qq) => acc + (qq.points != null ? parseFloat(qq.points.toString()) : 0),
          0
        );
        const overrideTotal = quizMetaMap.get(q.id)?.totalPoints ?? null;
        return {
          key: `quiz:${q.id}`,
          label: q.title.length > 24 ? q.title.slice(0, 22) + '…' : q.title,
          type: 'quiz',
          maxScore: overrideTotal != null ? overrideTotal : (summed > 0 ? summed : 100),
          refId: q.id,
        };
      }),
      { key: 'midterm', label: 'Midterm', type: 'midterm', maxScore: midtermMax },
      { key: 'final', label: 'Final', type: 'final', maxScore: finalMax },
    ];

    const [asgSubs, quizSubs, gbEntries] = await Promise.all([
      assignments.length > 0
        ? prisma.assignmentSubmission.findMany({
            where: { assignmentId: { in: assignments.map(a => a.id) } },
            select: { assignmentId: true, userId: true, score: true },
          })
        : [],
      quizzes.length > 0
        ? prisma.quizSubmission.findMany({
            where: { quizId: { in: quizzes.map(q => q.id) } },
            select: { quizId: true, userId: true, score: true, maxPoints: true },
          })
        : [],
      prisma.gradebookEntry.findMany({
        where: { courseId: course.id, component: { in: ['midterm', 'final'] } },
        select: {
          studentId: true, component: true, score: true,
          isFinal: true, confirmedById: true, confirmedAt: true,
          confirmedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    const asgIdx = new Map();
    for (const s of asgSubs) asgIdx.set(`${s.assignmentId}:${s.userId}`, s.score != null ? parseFloat(s.score.toString()) : null);
    const quizIdx = new Map();
    for (const s of quizSubs) quizIdx.set(`${s.quizId}:${s.userId}`, s.score != null ? parseFloat(s.score.toString()) : null);
    const gbIdx = new Map();
    for (const e of gbEntries) gbIdx.set(`${e.component}:${e.studentId}`, e.score != null ? parseFloat(e.score.toString()) : null);
    const finalConfirmIdx = new Map();
    const midtermConfirmIdx = new Map();
    for (const e of gbEntries) {
      const payload = {
        isFinal: e.isFinal,
        confirmedById: e.confirmedById ?? null,
        confirmedAt: e.confirmedAt ?? null,
        confirmedBy: e.confirmedBy
          ? { id: e.confirmedBy.id, firstName: e.confirmedBy.firstName, lastName: e.confirmedBy.lastName }
          : null,
      };
      if (e.component === 'final') finalConfirmIdx.set(e.studentId, payload);
      else if (e.component === 'midterm') midtermConfirmIdx.set(e.studentId, payload);
    }

    const studentRows = students.map(s => {
      const scores = {};
      for (const a of assignments) scores[`asg:${a.id}`] = asgIdx.get(`${a.id}:${s.id}`) ?? null;
      for (const q of quizzes) scores[`quiz:${q.id}`] = quizIdx.get(`${q.id}:${s.id}`) ?? null;
      scores['midterm'] = gbIdx.get(`midterm:${s.id}`) ?? null;
      scores['final'] = gbIdx.get(`final:${s.id}`) ?? null;
      const fc = finalConfirmIdx.get(s.id) || null;
      const mc = midtermConfirmIdx.get(s.id) || null;
      return { ...s, scores, finalConfirmation: fc, midtermConfirmation: mc };
    });

    res.json({
      courseCode,
      courseTitle: course.title,
      columns,
      students: studentRows,
      midtermFinal: { midtermMax, finalMax, midtermRange: [20, 30], finalRange: [40, 60], step: 5 },
    });
  })
);

// ── POST /api/gradebook/:courseCode/cell ──────────────────────────────────────

router.post(
  '/gradebook/:courseCode/cell',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const { studentId, type, refId, score } = req.body;

    if (!studentId || !type || !refId) {
      throw new AppError('studentId, type and refId are required', 400);
    }
    const numeric = score == null || score === '' ? null : parseFloat(score);
    if (numeric != null && (Number.isNaN(numeric) || numeric < 0)) {
      throw new AppError('score must be a non-negative number or null', 400);
    }

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    if (type === 'assignment') {
      const assignment = await prisma.assignment.findFirst({ where: { id: refId, courseId: course.id } });
      if (!assignment) throw new AppError('Assignment not found', 404);
      if (numeric != null && numeric > parseFloat(assignment.maxScore.toString())) {
        throw new AppError(`score must be ≤ ${assignment.maxScore}`, 400);
      }
      const sub = await prisma.assignmentSubmission.upsert({
        where: { assignmentId_userId: { assignmentId: refId, userId: studentId } },
        create: {
          assignmentId: refId, userId: studentId, courseId: course.id, score: numeric,
          status: numeric != null ? 'graded' : 'submitted',
          gradedById: numeric != null ? req.user.userId : null,
          gradedAt: numeric != null ? new Date() : null,
        },
        update: {
          score: numeric,
          status: numeric != null ? 'graded' : 'submitted',
          gradedById: numeric != null ? req.user.userId : null,
          gradedAt: numeric != null ? new Date() : null,
        },
      });
      // Notify the student that their assignment was graded. Skip when the
      // grader cleared the score (numeric === null) — that's an un-grade.
      if (numeric != null) {
        notifyUser(req, studentId, {
          title: `Grade updated: ${assignment.title}`,
          content: `Your assignment "${assignment.title}" in ${courseCode.toUpperCase()} was graded ${numeric}/${assignment.maxScore}.`,
          type: 'info',
          priority: 'normal',
          referenceType: 'Assignment',
          referenceId: assignment.id,
        });
      }
      return res.json({ success: true, submission: sub });
    }

    if (type === 'quiz') {
      const quiz = await prisma.quiz.findFirst({ where: { id: refId, courseId: course.id } });
      if (!quiz) throw new AppError('Quiz not found', 404);
      const existing = await prisma.quizSubmission.findFirst({
        where: { quizId: refId, userId: studentId },
        orderBy: { createdAt: 'desc' },
      });
      let result;
      if (existing) {
        result = await prisma.quizSubmission.update({
          where: { id: existing.id },
          data: { score: numeric, status: numeric != null ? 'graded' : existing.status },
        });
      } else {
        result = await prisma.quizSubmission.create({
          data: {
            quizId: refId, userId: studentId, courseId: course.id, score: numeric,
            status: numeric != null ? 'graded' : 'submitted', submittedAt: new Date(),
          },
        });
      }
      if (numeric != null) {
        notifyUser(req, studentId, {
          title: `Grade updated: ${quiz.title}`,
          content: `Your quiz "${quiz.title}" in ${courseCode.toUpperCase()} was graded ${numeric}.`,
          type: 'info',
          priority: 'normal',
          referenceType: 'Quiz',
          referenceId: quiz.id,
        });
      }
      return res.json({ success: true, submission: result });
    }

    throw new AppError('type must be "assignment" or "quiz"', 400);
  })
);

// ── PATCH /api/gradebook/:courseCode/midterm-final-config ─────────────────────

router.patch(
  '/gradebook/:courseCode/midterm-final-config',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const { midtermMax, finalMax } = req.body;
    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const m = Number(midtermMax);
    const f = Number(finalMax);
    if (!Number.isFinite(m) || m < 20 || m > 30 || m % 5 !== 0) {
      throw new AppError('midtermMax must be 20, 25, or 30', 400);
    }
    if (!Number.isFinite(f) || f < 40 || f > 60 || f % 5 !== 0) {
      throw new AppError('finalMax must be 40, 45, 50, 55, or 60', 400);
    }

    const tenantId = req.user?.tenantId || req.tenantId;
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "course_gradebook_config" (
        "course_id" TEXT NOT NULL,
        "tenant_id" TEXT NOT NULL DEFAULT '',
        "midterm_max" INTEGER NOT NULL DEFAULT 30,
        "final_max" INTEGER NOT NULL DEFAULT 60,
        "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("tenant_id", "course_id")
      )
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "course_gradebook_config"
        ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT ''
    `);
    await prisma.$executeRaw`
      INSERT INTO "course_gradebook_config" ("course_id", "tenant_id", "midterm_max", "final_max", "updated_at")
      VALUES (${course.id}, ${tenantId}, ${m}, ${f}, NOW())
      ON CONFLICT ("tenant_id", "course_id") DO UPDATE
        SET "midterm_max" = ${m}, "final_max" = ${f}, "updated_at" = NOW()
    `;

    res.json({ success: true, midtermMax: m, finalMax: f });
  })
);

// ── POST /api/gradebook/:courseCode ──────────────────────────────────────────

router.post(
  '/gradebook/:courseCode',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const { studentId, component, score, letterGrade, gradePoints, isFinal, comments } = req.body;

    if (!studentId) throw new AppError('studentId required', 400);

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    let resolvedMaxScore = null;
    try {
      const existing = await prisma.gradebookEntry.findFirst({
        where: { courseId: course.id, studentId, component: component ?? 'final' },
        select: { maxScore: true },
      });
      if (existing?.maxScore != null) {
        resolvedMaxScore = parseFloat(existing.maxScore.toString());
      } else {
        const tenantId = getCurrentTenant();
        const cfgRows = await prisma.$queryRaw`
          SELECT "midterm_max", "final_max" FROM "course_gradebook_config"
           WHERE "course_id" = ${course.id}
             AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
           ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
           LIMIT 1
        `.catch(() => []);
        const isMid = (component ?? '').toLowerCase().includes('mid');
        const isFin = (component ?? '').toLowerCase().includes('final');
        if (isMid && cfgRows?.[0]?.midterm_max != null) resolvedMaxScore = parseFloat(cfgRows[0].midterm_max);
        else if (isFin && cfgRows?.[0]?.final_max != null) resolvedMaxScore = parseFloat(cfgRows[0].final_max);
      }
    } catch { /* fall through */ }
    const upsertRules = await _gradingHelpers.getGradingRules(prisma).catch(() => undefined);
    const resolvedLetter = letterGrade ?? toLetterGrade(
      score != null ? parseFloat(score) : null,
      resolvedMaxScore,
      upsertRules,
    );

    // Plan 7 Phase 1 — auto-reopen confirmation on breakdown edit.
    let reopenedFinalId = null;
    if (component && component !== 'final') {
      const finalEntry = await prisma.gradebookEntry.findFirst({
        where: { courseId: course.id, studentId, component: 'final' },
        select: { id: true, confirmedById: true, isFinal: true },
      }).catch(() => null);
      if (finalEntry?.isFinal && finalEntry.confirmedById) {
        await prisma.gradebookEntry.update({
          where: { id: finalEntry.id },
          data: { confirmedById: null, confirmedAt: null },
        });
        reopenedFinalId = finalEntry.id;
      }
    }

    const entry = await prisma.gradebookEntry.upsert({
      where: {
        courseId_studentId_component: {
          courseId: course.id,
          studentId,
          component: component ?? 'final',
        },
      },
      update: {
        score: score != null ? parseFloat(score) : undefined,
        letterGrade: resolvedLetter,
        gradePoints: gradePoints != null ? parseFloat(gradePoints) : undefined,
        isFinal: isFinal ?? undefined,
        comments: comments ?? undefined,
        gradedById: req.user.userId,
      },
      create: {
        courseId: course.id,
        studentId,
        component: component ?? 'final',
        score: score != null ? parseFloat(score) : null,
        letterGrade: resolvedLetter,
        gradePoints: gradePoints != null ? parseFloat(gradePoints) : null,
        isFinal: isFinal ?? false,
        comments: comments ?? null,
        gradedById: req.user.userId,
      },
    });

    // Transcript ripple is GATED on confirmation (Plan 7 Phase 1).
    if (isFinal && score != null && resolvedLetter && entry.confirmedById) {
      const currentTermRecord = await prisma.currentTerm.findFirst({
        include: { semester: true },
      }).catch(() => null);
      const currentSemester = currentTermRecord?.semester ?? null;

      if (currentSemester) {
        // Unique key is now (userId, semesterId, courseCode, attemptNumber).
        // Edit the latest attempt for this (user, semester, course); create
        // attempt 1 if none exists. (Retake rows are created by the release
        // cascade, not here.)
        try {
          const existingTc = await prisma.transcriptCourse.findFirst({
            where: { userId: studentId, semesterId: currentSemester.id, courseCode: courseCode.toUpperCase() },
            orderBy: { attemptNumber: 'desc' },
            select: { id: true },
          });
          if (existingTc) {
            await prisma.transcriptCourse.update({
              where: { id: existingTc.id },
              data: { grade: resolvedLetter, qualityPoints: gradePoints ?? 0 },
            });
          } else {
            await prisma.transcriptCourse.create({
              data: {
                userId: studentId,
                semesterId: currentSemester.id,
                courseCode: courseCode.toUpperCase(),
                courseTitle: course.title,
                credits: course.credits,
                grade: resolvedLetter,
                qualityPoints: gradePoints ?? 0,
                attemptNumber: 1,
              },
            });
          }
        } catch (err) {
          console.warn('[gradebook] transcript write skipped:', err.message);
        }
      }
    }

    if (reopenedFinalId) {
      setImmediate(async () => {
        try {
          const reopened = await prisma.gradebookEntry.findFirst({
            where: { id: reopenedFinalId },
            include: { course: { select: { code: true, title: true } }, student: { select: { firstName: true, lastName: true } } },
          });
          const notifyUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
          const recipient = reopened?.gradedById;
          if (recipient) {
            await fetch(`${notifyUrl}/api/notifications/broadcast`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: req.headers.authorization || '',
              },
              body: JSON.stringify({
                targetUserIds: [recipient],
                title: 'Grade reopened for re-confirmation',
                content: `${reopened.course?.code || courseCode} — ${reopened.student?.firstName || 'student'} ${reopened.student?.lastName || ''}: a breakdown component was edited after confirmation. Re-confirm when ready.`,
                type: 'info',
              }),
            }).catch(() => {});
          }
        } catch { /* swallow */ }
      });
    }

    res.json({ success: true, entry, reopened: !!reopenedFinalId });
  })
);

// ── GET /api/courses/:courseCode/grades/:studentId ────────────────────────────

router.get(
  '/courses/:courseCode/grades/:studentId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const entries = await prisma.gradebookEntry.findMany({
      where: { courseId: course.id, studentId },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ courseCode, studentId, entries });
  })
);

// ── PUT /api/grades/:courseCode/:studentId ────────────────────────────────────

router.put(
  '/grades/:courseCode/:studentId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { studentId, courseCode } = req.params;
    const { type, id, grade, feedback } = req.body;

    if (type === 'assignment') {
      const sub = await prisma.assignmentSubmission.findFirst({
        where: { assignmentId: id, userId: studentId },
      });

      if (sub) {
        await prisma.assignmentSubmission.update({
          where: { id: sub.id },
          data: {
            score: parseFloat(grade),
            feedback: feedback ?? undefined,
            status: 'graded',
            gradedById: req.user.userId,
            gradedAt: new Date(),
          },
        });
      } else {
        const assignment = await prisma.assignment.findFirst({ where: { id } });
        if (!assignment) throw new AppError('Assignment not found', 404);
        const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
        if (!course) throw new AppError('Course not found', 404);

        await prisma.assignmentSubmission.create({
          data: {
            assignmentId: id,
            userId: studentId,
            courseId: course.id,
            score: parseFloat(grade),
            feedback: feedback ?? null,
            status: 'graded',
            gradedById: req.user.userId,
            gradedAt: new Date(),
          },
        });
      }
    } else if (type === 'quiz') {
      const sub = await prisma.quizSubmission.findFirst({
        where: { quizId: id, userId: studentId },
        orderBy: { attempt: 'desc' },
      });
      if (!sub) throw new AppError('Quiz submission not found', 404);

      await prisma.quizSubmission.update({
        where: { id: sub.id },
        data: { score: parseFloat(grade), status: 'graded' },
      });
    } else {
      throw new AppError('type must be assignment or quiz', 400);
    }

    res.json({ success: true });
  })
);

// ── PUT /api/grades/:courseCode/:studentId/propose ────────────────────────────

router.put(
  '/grades/:courseCode/:studentId/propose',
  requireAuth,
  requireRole(['ta']),
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;
    const { score, assignmentId, comments } = req.body;

    if (!assignmentId) throw new AppError('assignmentId required', 400);
    if (score == null) throw new AppError('score required', 400);

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId: course.id },
    });
    if (!assignment) throw new AppError('Assignment not found', 404);

    const existing = await prisma.assignmentSubmission.findFirst({
      where: { assignmentId, userId: studentId },
    });

    if (existing) {
      await prisma.assignmentSubmission.update({
        where: { id: existing.id },
        data: {
          proposedScore: parseFloat(score),
          proposedById: req.user.userId,
          status: 'pending_review',
          feedback: comments ?? existing.feedback,
        },
      });
    } else {
      await prisma.assignmentSubmission.create({
        data: {
          assignmentId,
          userId: studentId,
          courseId: course.id,
          proposedScore: parseFloat(score),
          proposedById: req.user.userId,
          status: 'pending_review',
          feedback: comments ?? null,
        },
      });
    }

    res.json({ success: true, message: 'Grade proposal submitted for professor review' });
  })
);

// ── POST /api/grades/:courseCode/:studentId/approve ───────────────────────────

router.post(
  '/grades/:courseCode/:studentId/approve',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;
    const { assignmentId, score } = req.body;

    if (!assignmentId) throw new AppError('assignmentId required', 400);

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const sub = await prisma.assignmentSubmission.findFirst({
      where: { assignmentId, userId: studentId },
    });
    if (!sub) throw new AppError('Submission not found', 404);

    const finalScore = score != null ? parseFloat(score) : (sub.proposedScore ?? null);
    if (finalScore == null) throw new AppError('No score to approve — provide score or ensure proposedScore exists', 400);

    await prisma.assignmentSubmission.update({
      where: { id: sub.id },
      data: {
        score: finalScore,
        approvedById: req.user.userId,
        approvedAt: new Date(),
        status: 'graded',
        gradedById: req.user.userId,
        gradedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'Grade approved' });
  })
);

module.exports = router;
