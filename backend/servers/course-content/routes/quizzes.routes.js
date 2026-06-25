/**
 * routes/quizzes.routes.js — Quiz CRUD + student submission lifecycle
 *
 * Owns:
 *   GET  /api/quizzes                                             — list quizzes
 *   GET  /api/quizzes/submissions/me                              — caller's submissions
 *   GET  /api/quizzes/:quizId                                     — quiz detail
 *   POST /api/quizzes                                             — create quiz
 *   POST /api/quizzes/:quizId/start                               — start / resume attempt
 *   POST /api/quizzes/:quizId/submit                              — submit answers
 *   GET  /api/quizzes/:quizId/submissions                         — all submissions (staff)
 *   POST /api/quizzes/:quizId/submissions/:submissionId/grade     — grade written answers
 *   POST /api/quizzes/:quizId/submissions/:submissionId/override  — score override
 *   PATCH /api/quizzes/:quizId                                    — edit quiz
 *   DELETE /api/quizzes/:quizId                                   — delete quiz
 *
 * Non-obvious decisions:
 *   - startsAt, totalPoints, and audienceUserIds are persisted/read via $queryRaw /
 *     $executeRaw because the Prisma client may not have these columns typed
 *     (Windows DLL playbook).
 *   - /submissions/me MUST be declared before /:quizId so Express doesn't
 *     swallow "submissions" as a quizId param.
 *   - The /start endpoint uses a retry loop (up to 3 attempts) guarding against
 *     P2002 (unique constraint) from concurrent requests.
 *   - 30-second grace window on /submit so a client-side auto-submit fired at
 *     T=0 survives network latency without the server rejecting it as "Time is up".
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { notifyUsers, notifyCourseStudents } = require('../../../lib/notify');

const router = Router();

// ── GET /api/quizzes ──────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { courseCode, courseId, mine } = req.query;
    const callerId = req.user.userId;
    const callerRole = req.user.role;
    const where = {};

    if (courseId) where.courseId = courseId;
    if (courseCode) where.course = { code: courseCode.toUpperCase() };

    const wantsMine =
      mine === 'true' ||
      mine === '1' ||
      (callerRole === 'student' && !courseId && !courseCode);

    if (wantsMine) {
      const regs = await prisma.registration.findMany({
        where: {
          userId: callerId,
          isActive: true,
          status: { in: ['pending', 'approved'] },
        },
        select: { courseId: true },
      });
      const enrolledCourseIds = [...new Set(regs.map((r) => r.courseId))];
      where.courseId = enrolledCourseIds.length === 0
        ? '__none__'
        : where.courseId
          ? where.courseId
          : { in: enrolledCourseIds };
    }

    const quizzesAll = await prisma.quiz.findMany({
      where,
      include: {
        course: { select: { code: true, title: true } },
        _count: { select: { questions: true, submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tenantId = req.user?.tenantId || req.tenantId;
    const qMetaMap = new Map();
    try {
      const qIds = quizzesAll.map(q => q.id);
      if (qIds.length > 0) {
        const rows = await prisma.$queryRaw`
          SELECT "id", "audience_user_ids", "starts_at", "total_points"
            FROM "quizzes"
           WHERE "id" = ANY(${qIds}::text[])
             AND "tenant_id" = ${tenantId}
        `;
        for (const r of rows || []) {
          qMetaMap.set(r.id, {
            audience: Array.isArray(r.audience_user_ids) ? r.audience_user_ids : [],
            startsAt: r.starts_at,
            totalPoints: r.total_points != null ? parseFloat(r.total_points) : null,
          });
        }
      }
    } catch { /* columns missing */ }
    const qAudienceMap = new Map(
      Array.from(qMetaMap.entries()).map(([id, meta]) => [id, meta.audience])
    );

    const quizzes = callerRole === 'student'
      ? quizzesAll.filter((q) => {
          const aud = qAudienceMap.get(q.id) ?? q.audienceUserIds ?? [];
          return aud.length === 0 || aud.includes(callerId);
        })
      : quizzesAll;

    res.json(quizzes.map(q => {
      const meta = qMetaMap.get(q.id);
      return {
        id: q.id,
        courseId: q.courseId,
        courseCode: q.course.code,
        courseTitle: q.course.title,
        title: q.title,
        description: q.description,
        timeLimit: q.timeLimit,
        maxAttempts: q.maxAttempts,
        passingScore: q.passingScore,
        isPublished: q.isPublished,
        dueDate: q.dueDate,
        startsAt: meta?.startsAt ?? null,
        totalPoints: meta?.totalPoints ?? null,
        questionCount: q._count.questions,
        submissionCount: q._count.submissions,
        createdAt: q.createdAt,
      };
    }));
  })
);

// ── GET /api/quizzes/submissions/me ───────────────────────────────────────────
// Must be declared BEFORE /:quizId to avoid "submissions" being treated as a param.

router.get(
  '/submissions/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const submissions = await prisma.quizSubmission.findMany({
      where: { userId: req.user.userId },
      include: { quiz: { select: { id: true, title: true, courseId: true } } },
      orderBy: { startedAt: 'desc' },
    });
    res.json(submissions);
  })
);

// ── GET /api/quizzes/:quizId ──────────────────────────────────────────────────

router.get(
  '/:quizId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const quiz = await prisma.quiz.findFirst({
      where: { id: req.params.quizId },
      include: {
        questions: { orderBy: { sortOrder: 'asc' } },
        course: { select: { code: true, title: true } },
      },
    });
    if (!quiz) throw new AppError('Quiz not found', 404);

    const isStudent = req.user.role === 'student';
    const tenantId = req.user?.tenantId || req.tenantId;
    let startsAt = null;
    let totalPoints = null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT "starts_at", "total_points"
          FROM "quizzes"
         WHERE "id" = ${req.params.quizId}
           AND "tenant_id" = ${tenantId}
         LIMIT 1
      `;
      if (Array.isArray(rows) && rows[0]) {
        startsAt = rows[0].starts_at;
        totalPoints = rows[0].total_points != null ? parseFloat(rows[0].total_points) : null;
      }
    } catch { /* columns missing */ }

    let submissionState = null;
    if (isStudent) {
      const own = await prisma.quizSubmission.findFirst({
        where: { quizId: quiz.id, userId: req.user.userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, startedAt: true, status: true, score: true },
      });
      submissionState = own;
    }

    res.json({
      ...quiz,
      startsAt,
      totalPoints,
      questions: quiz.questions.map(q => {
        if (isStudent) {
          const { correctAnswer: _stripped, ...rest } = q;
          return rest;
        }
        return q;
      }),
      serverNow: new Date(),
      submissionState,
    });
  })
);

// ── POST /api/quizzes ─────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const {
      courseId,
      courseCode,
      title,
      description,
      timeLimit,
      maxAttempts,
      passingScore,
      dueDate,
      startsAt,
      totalPoints,
      isPublished,
      questions,
      audienceUserIds,
    } = req.body;

    if (!title || !title.trim()) throw new AppError('title is required', 400);
    if (!description || !String(description).trim()) {
      throw new AppError('description is required', 400);
    }
    if (!timeLimit || parseInt(timeLimit) < 1) {
      throw new AppError('timeLimit (minutes) is required', 400);
    }
    if (!dueDate) throw new AppError('dueDate is required', 400);
    if (!startsAt) throw new AppError('startsAt is required', 400);
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      throw new AppError('at least one question is required', 400);
    }
    const audienceIds = Array.isArray(audienceUserIds)
      ? audienceUserIds.filter(Boolean).map(String)
      : [];
    const summedPoints = questions.reduce(
      (acc, q) => acc + (q.points ? parseFloat(q.points) : 1),
      0
    );
    const parsedTotalPoints =
      totalPoints != null && totalPoints !== '' && parseFloat(totalPoints) > 0
        ? parseFloat(totalPoints)
        : summedPoints;
    if (!(parsedTotalPoints > 0)) {
      throw new AppError('Total marks must be > 0 (set per-question points)', 400);
    }
    const parsedStartsAt = new Date(startsAt);
    if (Number.isNaN(parsedStartsAt.getTime())) {
      throw new AppError('startsAt is not a valid date', 400);
    }
    const parsedDueDate = new Date(dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      throw new AppError('dueDate is not a valid date', 400);
    }
    if (parsedStartsAt.getTime() > parsedDueDate.getTime()) {
      throw new AppError('startsAt must be on or before dueDate', 400);
    }

    let resolvedCourseId = courseId;
    if (!resolvedCourseId && courseCode) {
      const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
      if (!course) throw new AppError('Course not found', 404);
      resolvedCourseId = course.id;
    }
    if (!resolvedCourseId) throw new AppError('courseId or courseCode required', 400);

    // The Prisma tenant extension (backend/lib/prisma.js) only injects tenantId
    // on the TOP-LEVEL operation — nested writes like `questions: { create: [] }`
    // are part of the same SQL statement and do NOT get re-intercepted. Since
    // QuizQuestion / QuizAnswer have tenantId NOT NULL, we must thread it in
    // explicitly on every nested item in this file.
    const tenantIdForNested = req.user.tenantId;

    const quiz = await prisma.quiz.create({
      data: {
        courseId: resolvedCourseId,
        title: title.trim(),
        description: String(description).trim(),
        timeLimit: parseInt(timeLimit),
        maxAttempts: maxAttempts ? parseInt(maxAttempts) : 1,
        passingScore: passingScore ? parseFloat(passingScore) : null,
        dueDate: parsedDueDate,
        isPublished: isPublished ?? true,
        createdById: req.user.userId,
        questions: {
          create: questions.map((q, idx) => ({
            tenantId: tenantIdForNested,
            type: q.type ?? 'mcq',
            text: q.text,
            points: q.points ? parseFloat(q.points) : 1,
            options: q.options ?? null,
            correctAnswer: q.correctAnswer ?? null,
            sortOrder: idx,
          })),
        },
      },
      include: { questions: true },
    });

    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      await prisma.$executeRaw`
        UPDATE "quizzes"
           SET "audience_user_ids" = ${audienceIds}::text[],
               "starts_at" = ${parsedStartsAt},
               "total_points" = ${parsedTotalPoints}
         WHERE "id" = ${quiz.id}
           AND "tenant_id" = ${tenantId}
      `;
    } catch (e) {
      console.warn('[quiz.create] audience/schedule write failed', e?.message);
    }

    // Notify students about the new quiz. When audienceIds is set, notify
    // only those students; otherwise fan out to every enrolled student.
    const courseRow = await prisma.course.findFirst({
      where: { id: resolvedCourseId },
      select: { code: true },
    }).catch(() => null);
    const resolvedCourseCode = (courseRow?.code || courseCode || '').toString();
    const due = parsedDueDate
      ? ` Due ${new Date(parsedDueDate).toLocaleDateString()}.`
      : '';
    if (Array.isArray(audienceIds) && audienceIds.length > 0) {
      notifyUsers(req, {
        userIds: audienceIds,
        title: `New quiz: ${quiz.title}`,
        content: `A new quiz "${quiz.title}" was posted${resolvedCourseCode ? ` in ${resolvedCourseCode}` : ''}.${due}`,
        type: 'info',
        priority: 'normal',
        referenceType: 'Quiz',
        referenceId: quiz.id,
      });
    } else if (resolvedCourseCode) {
      notifyCourseStudents(prisma, req, resolvedCourseCode, {
        title: `New quiz: ${quiz.title}`,
        content: `A new quiz "${quiz.title}" was posted in ${resolvedCourseCode}.${due}`,
        type: 'info',
        priority: 'normal',
        referenceType: 'Quiz',
        referenceId: quiz.id,
      });
    }

    res.status(201).json({
      ...quiz,
      audienceUserIds: audienceIds,
      startsAt: parsedStartsAt,
      totalPoints: parsedTotalPoints,
    });
  })
);

// ── POST /api/quizzes/:quizId/start ──────────────────────────────────────────

router.post(
  '/:quizId/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { quizId } = req.params;
    const userId = req.user.userId;

    const quiz = await prisma.quiz.findFirst({ where: { id: quizId } });
    if (!quiz) throw new AppError('Quiz not found', 404);

    const tenantId = req.user?.tenantId || req.tenantId;
    let startsAt = null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT "starts_at" FROM "quizzes" WHERE "id" = ${quizId} AND "tenant_id" = ${tenantId} LIMIT 1
      `;
      if (Array.isArray(rows) && rows[0]) startsAt = rows[0].starts_at;
    } catch { /* column missing */ }

    const now = new Date();

    if (startsAt && new Date(startsAt) > now) {
      throw new AppError('This quiz has not started yet.', 403);
    }

    const timeLimitMs = (quiz.timeLimit || 30) * 60 * 1000;
    if (startsAt) {
      const endAt = new Date(new Date(startsAt).getTime() + timeLimitMs);
      if (now > endAt) {
        throw new AppError('The quiz window has closed.', 403);
      }
    }

    const existing = await prisma.quizSubmission.findFirst({
      where: { quizId, userId, status: 'in_progress' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return res.json({
        success: true,
        submission: {
          id: existing.id,
          startedAt: existing.startedAt,
          status: existing.status,
        },
        startsAt,
        timeLimit: quiz.timeLimit,
        serverNow: now,
      });
    }

    let created = null;
    let lastErr = null;
    for (let i = 0; i < 3 && !created; i++) {
      const lastRow = await prisma.quizSubmission.findFirst({
        where: { quizId, userId },
        orderBy: { attempt: 'desc' },
        select: { attempt: true },
      });
      const nextAttempt = (lastRow?.attempt ?? 0) + 1;
      if (nextAttempt > quiz.maxAttempts) {
        throw new AppError(`Maximum attempts (${quiz.maxAttempts}) reached`, 400);
      }
      try {
        created = await prisma.quizSubmission.create({
          data: {
            quizId,
            userId,
            courseId: quiz.courseId,
            startedAt: startsAt ? new Date(startsAt) : now,
            status: 'in_progress',
            attempt: nextAttempt,
            maxPoints: 0,
          },
        });
      } catch (err) {
        lastErr = err;
        if (err?.code !== 'P2002') throw err;
      }
    }
    if (!created) {
      console.error('[quiz/start] giving up after 3 attempts', lastErr);
      throw new AppError('Could not allocate a quiz attempt — please retry.', 500);
    }

    res.json({
      success: true,
      submission: { id: created.id, startedAt: created.startedAt, status: created.status },
      startsAt,
      timeLimit: quiz.timeLimit,
      serverNow: now,
    });
  })
);

// ── POST /api/quizzes/:quizId/submit ─────────────────────────────────────────

router.post(
  '/:quizId/submit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { quizId } = req.params;
    const { answers } = req.body;
    const userId = req.user.userId;

    if (!answers) throw new AppError('answers required', 400);

    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId },
      include: { questions: true },
    });
    if (!quiz) throw new AppError('Quiz not found', 404);

    const tenantId = req.user?.tenantId || req.tenantId;
    let startsAt = null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT "starts_at" FROM "quizzes" WHERE "id" = ${quizId} AND "tenant_id" = ${tenantId} LIMIT 1
      `;
      if (Array.isArray(rows) && rows[0]) startsAt = rows[0].starts_at;
    } catch { /* column missing */ }

    const now = new Date();
    const timeLimitMs = (quiz.timeLimit || 30) * 60 * 1000;
    const GRACE_MS = 30 * 1000;

    if (startsAt) {
      const endAt = new Date(new Date(startsAt).getTime() + timeLimitMs);
      if (now.getTime() > endAt.getTime() + GRACE_MS) throw new AppError('The quiz window has closed.', 403);
      if (new Date(startsAt) > now) throw new AppError('Quiz has not started.', 403);
    } else {
      const existing = await prisma.quizSubmission.findFirst({
        where: { quizId, userId, status: 'in_progress' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const endAt = new Date(new Date(existing.startedAt).getTime() + timeLimitMs);
        if (now.getTime() > endAt.getTime() + GRACE_MS) throw new AppError('Time is up.', 403);
      }
    }

    const lastSubmittedRow = await prisma.quizSubmission.findFirst({
      where: { quizId, userId },
      orderBy: { attempt: 'desc' },
      select: { attempt: true },
    });
    const submittedCount = await prisma.quizSubmission.count({
      where: { quizId, userId, status: { not: 'in_progress' } },
    });
    if (submittedCount >= quiz.maxAttempts) {
      throw new AppError(`Maximum attempts (${quiz.maxAttempts}) already reached`, 400);
    }
    const nextAttempt = (lastSubmittedRow?.attempt ?? 0) + 1;

    const answerMap = Array.isArray(answers)
      ? Object.fromEntries(answers.map(a => [a.questionId, a.answer]))
      : answers;

    let totalScore = 0;
    let maxPoints = 0;
    let pendingReview = false;

    const answerData = quiz.questions.map(q => {
      maxPoints += q.points;
      const userAnswer = answerMap[q.id] ?? null;
      let pointsEarned = 0;
      let isCorrect = null;

      if (q.type === 'mcq') {
        isCorrect = userAnswer === q.correctAnswer;
        if (isCorrect) {
          pointsEarned = q.points;
          totalScore += pointsEarned;
        }
      } else {
        pendingReview = true;
      }

      return { questionId: q.id, answer: userAnswer, isCorrect, pointsEarned };
    });

    const inProgress = await prisma.quizSubmission.findFirst({
      where: { quizId, userId, status: 'in_progress' },
      orderBy: { createdAt: 'desc' },
    });

    // Tenant extension does NOT inject tenantId on nested writes (see /POST /
    // above). Thread it into each QuizAnswer manually.
    const tenantIdForNested = req.user.tenantId;
    const answerDataWithTenant = answerData.map((a) => ({ tenantId: tenantIdForNested, ...a }));

    let submission;
    if (inProgress) {
      submission = await prisma.$transaction(async (tx) => {
        await tx.quizAnswer.deleteMany({ where: { submissionId: inProgress.id } });
        return tx.quizSubmission.update({
          where: { id: inProgress.id },
          data: {
            score: pendingReview ? null : totalScore,
            maxPoints,
            status: pendingReview ? 'pending_review' : 'graded',
            submittedAt: now,
            answers: { create: answerDataWithTenant },
          },
          include: { answers: true },
        });
      });
    } else {
      submission = await prisma.quizSubmission.create({
        data: {
          quizId,
          userId,
          courseId: quiz.courseId,
          score: pendingReview ? null : totalScore,
          maxPoints,
          status: pendingReview ? 'pending_review' : 'graded',
          attempt: nextAttempt,
          submittedAt: now,
          startedAt: startsAt ? new Date(startsAt) : now,
          answers: { create: answerDataWithTenant },
        },
        include: { answers: true },
      });
    }

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/system`;
      const fetchFn = global.fetch || require('node-fetch');
      const body = pendingReview
        ? {
            userId,
            title: `Quiz submitted — ${quiz.title}`,
            content: `Your answers for "${quiz.title}" are in. Written-answer scoring is pending review.`,
            type: 'info',
            referenceType: 'Quiz',
            referenceId: quiz.id,
          }
        : {
            userId,
            title: `Quiz graded — ${quiz.title}`,
            content: `You scored ${totalScore} / ${maxPoints} on "${quiz.title}".`,
            type: 'success',
            referenceType: 'Quiz',
            referenceId: quiz.id,
          };
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify(body),
      }).catch(() => { /* best-effort */ });
    });

    res.json({
      success: true,
      submission: { ...submission, totalScore: submission.score },
    });
  })
);

// ── GET /api/quizzes/:quizId/submissions ──────────────────────────────────────

router.get(
  '/:quizId/submissions',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const submissions = await prisma.quizSubmission.findMany({
      where: { quizId: req.params.quizId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        answers: true,
        quiz: { include: { questions: { select: { id: true, type: true } } } },
      },
      orderBy: { startedAt: 'desc' },
    });
    res.json(
      submissions.map((s) => {
        const typeByQuestion = new Map(
          (s.quiz?.questions ?? []).map((q) => [q.id, q.type])
        );
        return {
          ...s,
          studentName: s.user
            ? `${s.user.firstName} ${s.user.lastName}`.trim()
            : '(unknown student)',
          studentEmail: s.user?.email ?? null,
          totalScore: s.score,
          answers: (s.answers ?? []).map((a) => ({
            ...a,
            userAnswer: a.answer,
            pointsAwarded: a.pointsEarned,
            type: typeByQuestion.get(a.questionId) ?? null,
          })),
        };
      })
    );
  })
);

// ── POST /api/quizzes/:quizId/submissions/:submissionId/grade ─────────────────

router.post(
  '/:quizId/submissions/:submissionId/grade',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { quizId, submissionId } = req.params;
    const { grades } = req.body || {};
    if (!grades || typeof grades !== 'object' || Array.isArray(grades)) {
      throw new AppError('grades must be an object keyed by questionId', 400);
    }

    const submission = await prisma.quizSubmission.findFirst({
      where: { id: submissionId },
      include: { answers: true, quiz: { include: { questions: true } } },
    });
    if (!submission) throw new AppError('Submission not found', 404);
    if (submission.quizId !== quizId) {
      throw new AppError('Submission does not belong to this quiz', 400);
    }

    const maxByQuestion = new Map();
    for (const q of submission.quiz.questions) {
      maxByQuestion.set(q.id, parseFloat(q.points?.toString() ?? '0'));
    }

    for (const [questionId, raw] of Object.entries(grades)) {
      if (!maxByQuestion.has(questionId)) {
        throw new AppError(`Unknown questionId: ${questionId}`, 400);
      }
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        throw new AppError(`Score for question ${questionId} is not numeric`, 400);
      }
      if (numeric < 0) {
        throw new AppError(`Score for question ${questionId} cannot be negative`, 400);
      }
      const max = maxByQuestion.get(questionId);
      if (max > 0 && numeric > max) {
        throw new AppError(`Score for question ${questionId} exceeds max (${max})`, 400);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      for (const [questionId, raw] of Object.entries(grades)) {
        const numeric = Number(raw);
        const max = maxByQuestion.get(questionId);
        const existingAnswer = submission.answers.find((a) => a.questionId === questionId);
        if (existingAnswer) {
          await tx.quizAnswer.update({
            where: { id: existingAnswer.id },
            data: {
              pointsEarned: numeric,
              isCorrect: max > 0 ? numeric >= max : null,
            },
          });
        } else {
          await tx.quizAnswer.create({
            data: {
              submissionId,
              questionId,
              answer: null,
              pointsEarned: numeric,
              isCorrect: max > 0 ? numeric >= max : null,
            },
          });
        }
      }

      const fresh = await tx.quizAnswer.findMany({ where: { submissionId } });
      const totalScore = fresh.reduce((s, a) => s + parseFloat(a.pointsEarned?.toString() ?? '0'), 0);

      return tx.quizSubmission.update({
        where: { id: submissionId },
        data: { score: totalScore, status: 'graded' },
        include: { answers: true },
      });
    });

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
      const fetchFn = global.fetch || require('node-fetch');
      const quizTitle = submission.quiz?.title ?? 'Quiz';
      const max = updated.maxPoints != null ? parseFloat(updated.maxPoints.toString()) : null;
      const score = updated.score != null ? parseFloat(updated.score.toString()) : null;
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify({
          userId: submission.userId,
          title: `Quiz graded — ${quizTitle}`,
          content: max != null && score != null
            ? `You scored ${score} / ${max} on "${quizTitle}".`
            : `Your "${quizTitle}" submission has been graded.`,
          type: 'success',
          referenceType: 'Quiz',
          referenceId: submission.quizId,
        }),
      }).catch(() => { /* best-effort */ });
    });

    res.json({ success: true, submission: updated });
  })
);

// ── POST /api/quizzes/:quizId/submissions/:submissionId/override ──────────────

router.post(
  '/:quizId/submissions/:submissionId/override',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { submissionId } = req.params;
    const { score } = req.body;
    if (score == null || score === '' || !Number.isFinite(Number(score))) {
      throw new AppError('score (numeric) is required', 400);
    }
    const numeric = Number(score);
    if (numeric < 0) throw new AppError('score must be ≥ 0', 400);

    const sub = await prisma.quizSubmission.findFirst({
      where: { id: submissionId },
      include: { quiz: { select: { id: true, title: true } } },
    });
    if (!sub) throw new AppError('Submission not found', 404);
    if (sub.maxPoints && numeric > parseFloat(sub.maxPoints.toString())) {
      throw new AppError(`score must be ≤ ${sub.maxPoints}`, 400);
    }

    const updated = await prisma.quizSubmission.update({
      where: { id: submissionId },
      data: { score: numeric, status: 'graded' },
    });

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
      const fetchFn = global.fetch || require('node-fetch');
      const quizTitle = sub.quiz?.title ?? 'Quiz';
      const max = updated.maxPoints != null ? parseFloat(updated.maxPoints.toString()) : null;
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify({
          userId: sub.userId,
          title: `Quiz graded — ${quizTitle}`,
          content: max != null
            ? `Your "${quizTitle}" score has been updated to ${numeric} / ${max}.`
            : `Your "${quizTitle}" score has been updated to ${numeric}.`,
          type: 'success',
          referenceType: 'Quiz',
          referenceId: sub.quizId,
        }),
      }).catch(() => { /* best-effort */ });
    });

    res.json({ success: true, submission: updated });
  })
);

// ── PATCH /api/quizzes/:quizId ────────────────────────────────────────────────

router.patch(
  '/:quizId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { quizId } = req.params;
    const {
      title, description, timeLimit, maxAttempts, passingScore,
      dueDate, startsAt, totalPoints, isPublished, audienceUserIds, questions,
    } = req.body;

    const quiz = await prisma.quiz.findFirst({ where: { id: quizId } });
    if (!quiz) throw new AppError('Quiz not found', 404);

    const data = {};
    if (title != null) data.title = String(title).trim();
    if (description != null) data.description = String(description).trim() || null;
    if (timeLimit != null) {
      const tl = parseInt(timeLimit);
      if (!Number.isFinite(tl) || tl < 1) throw new AppError('timeLimit must be ≥ 1', 400);
      data.timeLimit = tl;
    }
    if (maxAttempts != null) data.maxAttempts = parseInt(maxAttempts) || 1;
    if (passingScore != null) {
      data.passingScore = passingScore === '' ? null : parseFloat(passingScore);
    }
    if (dueDate != null) {
      const d = new Date(dueDate);
      if (Number.isNaN(d.getTime())) throw new AppError('dueDate invalid', 400);
      data.dueDate = d;
    }
    if (isPublished != null) data.isPublished = !!isPublished;

    const replaceQuestions = Array.isArray(questions);
    if (replaceQuestions && questions.length === 0) {
      throw new AppError('At least one question is required', 400);
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.quiz.update({ where: { id: quizId }, data });
      }
      if (replaceQuestions) {
        await tx.quizAnswer.deleteMany({ where: { question: { quizId } } });
        await tx.quizQuestion.deleteMany({ where: { quizId } });
        await tx.quizQuestion.createMany({
          data: questions.map((q, idx) => ({
            quizId,
            type: q.type ?? 'mcq',
            text: q.text,
            points: q.points ? parseFloat(q.points) : 1,
            options: q.options ?? null,
            correctAnswer: q.correctAnswer ?? null,
            sortOrder: idx,
          })),
        });
      }
    });

    const updates = [];
    const params = [];
    if (startsAt !== undefined) {
      const dt = startsAt ? new Date(startsAt) : null;
      if (dt && Number.isNaN(dt.getTime())) throw new AppError('startsAt invalid', 400);
      updates.push(`"starts_at" = $${params.length + 1}`);
      params.push(dt);
    }
    if (totalPoints !== undefined) {
      const tp = totalPoints == null || totalPoints === '' ? null : parseFloat(totalPoints);
      updates.push(`"total_points" = $${params.length + 1}`);
      params.push(tp);
    }
    if (audienceUserIds !== undefined) {
      const ids = Array.isArray(audienceUserIds) ? audienceUserIds.filter(Boolean).map(String) : [];
      updates.push(`"audience_user_ids" = $${params.length + 1}::text[]`);
      params.push(ids);
    }
    if (updates.length > 0) {
      const tenantId = req.user?.tenantId || req.tenantId;
      params.push(quizId);
      params.push(tenantId);
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "quizzes" SET ${updates.join(', ')} WHERE "id" = $${params.length - 1} AND "tenant_id" = $${params.length}`,
          ...params
        );
      } catch (e) {
        console.warn('[quiz.patch] raw write failed:', e?.message);
      }
    }

    const fresh = await prisma.quiz.findFirst({
      where: { id: quizId },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    let extras = {};
    try {
      const tenantId = req.user?.tenantId || req.tenantId;
      const rows = await prisma.$queryRaw`
        SELECT "starts_at", "total_points", "audience_user_ids"
          FROM "quizzes"
         WHERE "id" = ${quizId}
           AND "tenant_id" = ${tenantId}
         LIMIT 1
      `;
      if (Array.isArray(rows) && rows[0]) {
        extras = {
          startsAt: rows[0].starts_at,
          totalPoints: rows[0].total_points != null ? parseFloat(rows[0].total_points) : null,
          audienceUserIds: Array.isArray(rows[0].audience_user_ids) ? rows[0].audience_user_ids : [],
        };
      }
    } catch { /* columns missing */ }

    res.json({ success: true, quiz: { ...fresh, ...extras } });
  })
);

// ── DELETE /api/quizzes/:quizId ───────────────────────────────────────────────

router.delete(
  '/:quizId',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    await prisma.quiz.delete({ where: { id: req.params.quizId } });
    res.json({ success: true });
  })
);

module.exports = router;
