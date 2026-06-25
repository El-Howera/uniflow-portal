/**
 * routes/assignments.routes.js — Assignment CRUD + submission lifecycle
 *
 * Owns:
 *   GET  /api/users/:userId/submissions                               — all submissions for user
 *   POST /api/submissions                                             — submit an assignment
 *   POST /api/courses/:courseCode/assignments                         — create assignment (full path, mounted at /api)
 *   PATCH /api/courses/:courseCode/assignments/:assignmentId          — staff edit
 *   DELETE /api/courses/:courseCode/assignments/:assignmentId         — staff delete
 *   POST /api/courses/:courseCode/remarks                             — add remark
 *   GET  /api/courses/:courseCode/assignments/:assignmentId/submissions — submissions for grading
 *   PUT  /api/submissions/:submissionId/grade                         — grade a submission
 *   DELETE /api/submissions/:submissionId                             — staff delete submission
 *
 * Non-obvious decisions:
 *   - POST /api/submissions uses Zod for body validation (submissionSchema).
 *   - audience_user_ids is written via $executeRaw because the Prisma client
 *     artifact may not have the column typed (Windows DLL playbook).
 *   - Notifications are fire-and-forget via setImmediate so the HTTP response
 *     returns without waiting on the notification round-trip.
 */

'use strict';

const { Router } = require('express');
const fs = require('fs');
const { z } = require('zod');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const { writeAudit } = require('../../../lib/audit');
const { upload } = require('../lib/file-upload');
const storage = require('../../../lib/storage');
const { notifyUsers, notifyCourseStudents } = require('../../../lib/notify');

const router = Router();

// ── Zod schema ────────────────────────────────────────────────────────────────

const submissionSchema = z.object({
  assignmentId: z.string().min(1, 'assignmentId required'),
  content: z.string().optional(),
  userId: z.string().optional(),
});

// ── GET /api/users/:userId/submissions ────────────────────────────────────────

router.get(
  '/users/:userId/submissions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetUserId =
      req.params.userId === 'current' ? req.user.userId : req.params.userId;
    const { courseCode } = req.query;

    const where = { userId: targetUserId };
    if (courseCode) {
      where.course = { code: courseCode.toUpperCase() };
    }

    const subs = await prisma.assignmentSubmission.findMany({
      where,
      include: {
        assignment: { include: { course: { select: { id: true, code: true, title: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    res.json(subs.map(s => ({
      id: s.id,
      assignmentId: s.assignmentId,
      assignmentTitle: s.assignment.title,
      courseId: s.assignment.course.id,
      courseCode: s.assignment.course.code,
      courseTitle: s.assignment.course.title,
      filePath: s.filePath,
      fileName: s.fileName,
      originalFileName: s.originalFileName,
      content: s.content,
      submittedAt: s.submittedAt,
      isLate: s.isLate,
      attemptNumber: s.attemptNumber,
      status: s.status,
      score: s.score,
      feedback: s.feedback,
      gradedAt: s.gradedAt,
      maxScore: s.assignment.maxScore,
    })));
  })
);

// ── POST /api/submissions ─────────────────────────────────────────────────────

router.post(
  '/submissions',
  requireAuth,
  upload.single('file'),
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { assignmentId, content } = parsed.data;
    const userId = req.user.userId;

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId },
      include: { course: { select: { id: true, code: true, title: true } } },
    });
    if (!assignment) throw new AppError('Assignment not found', 404);

    const now = new Date();
    const isLate = now > new Date(assignment.dueDate);
    if (isLate && !assignment.allowLate) {
      throw new AppError('Assignment deadline has passed', 400);
    }

    const existingCount = await prisma.assignmentSubmission.count({
      where: { assignmentId, userId },
    });
    if (existingCount >= assignment.maxSubmissions) {
      throw new AppError(
        `Maximum submissions (${assignment.maxSubmissions}) already reached`,
        400
      );
    }

    // Persist the upload via storage (S3 or disk). filePath holds the key.
    const savedFile = req.file ? await storage.saveUpload('content', req.file) : null;

    const sub = await prisma.assignmentSubmission.upsert({
      where: { assignmentId_userId: { assignmentId, userId } },
      update: {
        filePath: savedFile ? savedFile.key : undefined,
        fileName: savedFile ? savedFile.filename : undefined,
        originalFileName: req.file ? req.file.originalname : undefined,
        content: content ?? undefined,
        isLate,
        attemptNumber: existingCount + 1,
        status: 'submitted',
        submittedAt: now,
      },
      create: {
        assignmentId,
        userId,
        courseId: assignment.course.id,
        filePath: savedFile?.key ?? null,
        fileName: savedFile?.filename ?? null,
        originalFileName: req.file?.originalname ?? null,
        content: content ?? null,
        isLate,
        attemptNumber: existingCount + 1,
        status: 'submitted',
      },
    });

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/system`;
      const fetchFn = global.fetch || require('node-fetch');
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify({
          userId,
          title: `Submission received — ${assignment.title}`,
          content: isLate
            ? `Your late submission for "${assignment.title}" is in. Late penalty may apply.`
            : `Your submission for "${assignment.title}" is in. You'll be notified when it's graded.`,
          type: isLate ? 'warning' : 'info',
          referenceType: 'Assignment',
          referenceId: assignment.id,
        }),
      }).catch(() => { /* best-effort */ });
    });

    res.json({
      success: true,
      submission: {
        id: sub.id,
        assignmentId: sub.assignmentId,
        courseCode: assignment.course.code,
        courseTitle: assignment.course.title,
        assignmentTitle: assignment.title,
        submittedAt: sub.submittedAt,
        isLate: sub.isLate,
        attemptNumber: sub.attemptNumber,
        status: sub.status,
        maxScore: assignment.maxScore,
      },
    });
  })
);

// ── POST /api/courses/:courseCode/assignments ─────────────────────────────────

router.post(
  '/courses/:courseCode/assignments',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 10 },
  ]),
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const {
      title,
      dueDate,
      maxScore,
      weight,
      description,
      sectionId,
      allowLate,
      latePenalty,
      missingAfterHours,
      materialCategory,
      audienceUserIds,
    } = req.body;

    let audienceIds = [];
    if (Array.isArray(audienceUserIds)) {
      audienceIds = audienceUserIds.filter(Boolean).map(String);
    } else if (typeof audienceUserIds === 'string' && audienceUserIds.trim()) {
      try {
        const parsed = JSON.parse(audienceUserIds);
        audienceIds = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        audienceIds = audienceUserIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    if (!title || !dueDate) {
      throw new AppError('title and dueDate are required', 400);
    }

    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });
    if (!course) throw new AppError('Course not found', 404);

    const fileList = [
      ...(req.files?.file ?? []),
      ...(req.files?.files ?? []),
    ];

    const attachments = [];
    for (const f of fileList) {
      const fileSize = `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
      const { key, filename } = await storage.saveUpload('content', f);
      const url = `/files/${filename}`;
      attachments.push(url);
      await prisma.courseMaterial.create({
        data: {
          courseId: course.id,
          sectionId: sectionId ?? null,
          title: title,
          type: (() => {
            const ext = (f.originalname || '').split('.').pop()?.toLowerCase() || '';
            if (ext === 'pdf') return 'pdf';
            if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
            if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video';
            return 'document';
          })(),
          category: materialCategory === 'final-project' ? 'final-project' : 'assignments',
          filePath: key,
          fileName: filename,
          originalName: f.originalname,
          url,
          size: fileSize,
          uploadedById: req.user.userId,
          isPublished: true,
        },
      });
    }

    const assignment = await prisma.assignment.create({
      data: {
        courseId: course.id,
        title,
        description: description ?? null,
        dueDate: new Date(dueDate),
        maxScore: maxScore != null && !Number.isNaN(parseFloat(maxScore))
          ? parseFloat(maxScore)
          : 100,
        weight: weight != null && !Number.isNaN(parseFloat(weight))
          ? parseFloat(weight)
          : null,
        allowLate: allowLate === 'true' || allowLate === true,
        latePenalty: latePenalty != null && !Number.isNaN(parseFloat(latePenalty))
          ? parseFloat(latePenalty)
          : -2,
        missingAfterHours: missingAfterHours != null && !Number.isNaN(parseInt(missingAfterHours, 10))
          ? Math.max(0, Math.min(168, parseInt(missingAfterHours, 10)))
          : 0,
        attachments,
      },
    });

    if (audienceIds.length > 0) {
      try {
        const tenantId = req.user?.tenantId || req.tenantId;
        await prisma.$executeRaw`
          UPDATE "assignments"
             SET "audience_user_ids" = ${audienceIds}::text[]
           WHERE "id" = ${assignment.id}
             AND "tenant_id" = ${tenantId}
        `;
      } catch (e) {
        console.warn('[assignment.create] audience write failed', e?.message);
      }
    }

    // Fan-out: notify either the explicit audience or all enrolled students.
    const dueText = ` Due ${new Date(assignment.dueDate).toLocaleDateString()}.`;
    if (Array.isArray(audienceIds) && audienceIds.length > 0) {
      notifyUsers(req, {
        userIds: audienceIds,
        title: `New assignment: ${assignment.title}`,
        content: `A new assignment "${assignment.title}" was posted in ${courseCode.toUpperCase()}.${dueText}`,
        type: 'info',
        priority: 'normal',
        referenceType: 'Assignment',
        referenceId: assignment.id,
      });
    } else {
      notifyCourseStudents(prisma, req, courseCode, {
        title: `New assignment: ${assignment.title}`,
        content: `A new assignment "${assignment.title}" was posted in ${courseCode.toUpperCase()}.${dueText}`,
        type: 'info',
        priority: 'normal',
        referenceType: 'Assignment',
        referenceId: assignment.id,
      });
    }

    res.status(201).json({ success: true, assignment: { ...assignment, audienceUserIds: audienceIds } });
  })
);

// ── PATCH /api/courses/:courseCode/assignments/:assignmentId ──────────────────

router.patch(
  '/courses/:courseCode/assignments/:assignmentId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, assignmentId } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });
    if (!course) throw new AppError('Course not found', 404);

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.courseId !== course.id) {
      throw new AppError('Assignment not found', 404);
    }

    const data = {};
    const b = req.body || {};
    if (typeof b.title === 'string' && b.title.trim()) data.title = b.title.trim();
    if (typeof b.description === 'string') data.description = b.description;
    if (b.dueDate) data.dueDate = new Date(b.dueDate);
    if (b.maxScore != null && !Number.isNaN(parseFloat(b.maxScore))) {
      data.maxScore = parseFloat(b.maxScore);
    }
    if (b.weight != null && !Number.isNaN(parseFloat(b.weight))) {
      data.weight = parseFloat(b.weight);
    }
    if (b.allowLate !== undefined) {
      data.allowLate = b.allowLate === true || b.allowLate === 'true';
    }
    if (b.latePenalty != null && !Number.isNaN(parseFloat(b.latePenalty))) {
      data.latePenalty = parseFloat(b.latePenalty);
    }
    if (b.missingAfterHours != null && !Number.isNaN(parseInt(b.missingAfterHours, 10))) {
      data.missingAfterHours = Math.max(0, Math.min(168, parseInt(b.missingAfterHours, 10)));
    }
    if (Object.keys(data).length === 0) {
      throw new AppError('No editable fields supplied', 400);
    }

    const updated = await prisma.assignment.update({
      where: { id: assignmentId },
      data,
    });
    res.json({ success: true, assignment: updated });
  })
);

// ── DELETE /api/courses/:courseCode/assignments/:assignmentId ─────────────────

router.delete(
  '/courses/:courseCode/assignments/:assignmentId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, assignmentId } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
    });
    if (!course) throw new AppError('Course not found', 404);

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.courseId !== course.id) {
      throw new AppError('Assignment not found', 404);
    }

    await prisma.assignment.delete({ where: { id: assignmentId } });
    res.json({ success: true });
  })
);

// ── POST /api/courses/:courseCode/remarks ─────────────────────────────────────

router.post(
  '/courses/:courseCode/remarks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const { title, content, important } = req.body;

    if (!title || !content) throw new AppError('title and content required', 400);

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const remark = await prisma.courseRemark.create({
      data: {
        courseId: course.id,
        userId: req.user.userId,
        title,
        content,
        important: important ?? false,
      },
    });

    res.status(201).json({ success: true, remark });
  })
);

// ── GET /api/courses/:courseCode/assignments/:assignmentId/submissions ─────────

router.get(
  '/courses/:courseCode/assignments/:assignmentId/submissions',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, assignmentId } = req.params;

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const submissions = await prisma.assignmentSubmission.findMany({
      where: { assignmentId, courseId: course.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, odId: true } },
        assignment: { select: { id: true, title: true, maxScore: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });

    res.json(submissions);
  })
);

// ── PUT /api/submissions/:submissionId/grade ──────────────────────────────────

router.put(
  '/submissions/:submissionId/grade',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { submissionId } = req.params;
    const { score, feedback } = req.body;

    if (score == null) throw new AppError('score required', 400);

    const sub = await prisma.assignmentSubmission.findFirst({
      where: { id: submissionId },
      include: { assignment: { select: { id: true, title: true, maxScore: true } } },
    });
    if (!sub) throw new AppError('Submission not found', 404);

    const updated = await prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        score: parseFloat(score),
        feedback: feedback ?? null,
        status: 'graded',
        gradedById: req.user.userId,
        gradedAt: new Date(),
      },
    });

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
      const fetchFn = global.fetch || require('node-fetch');
      const title = sub.assignment?.title ?? 'Assignment';
      const max = sub.assignment?.maxScore != null ? parseFloat(sub.assignment.maxScore.toString()) : null;
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: JSON.stringify({
          userId: sub.userId,
          title: `Assignment graded — ${title}`,
          content: max != null
            ? `You scored ${parseFloat(score)} / ${max} on "${title}".`
            : `Your "${title}" submission has been graded: ${parseFloat(score)}.`,
          type: 'success',
          referenceType: 'Assignment',
          referenceId: sub.assignment?.id,
        }),
      }).catch(() => { /* best-effort */ });
    });

    res.json({ success: true, submission: updated });
  })
);

// ── DELETE /api/submissions/:submissionId ─────────────────────────────────────

router.delete(
  '/submissions/:submissionId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { submissionId } = req.params;
    const { reason } = req.body || {};

    const sub = await prisma.assignmentSubmission.findFirst({
      where: { id: submissionId },
      include: {
        assignment: { select: { id: true, title: true, courseId: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!sub) throw new AppError('Submission not found', 404);

    const studentId = sub.user.id;
    const studentName = `${sub.user.firstName} ${sub.user.lastName}`;
    const assignmentTitle = sub.assignment?.title ?? '(removed assignment)';
    const courseId = sub.assignment?.courseId;

    if (sub.filePath) {
      const key = sub.filePath.includes('/uploads/')
        ? sub.filePath.split('/uploads/').pop()
        : sub.filePath;
      await storage.deleteObject(key);
    }

    await prisma.assignmentSubmission.delete({ where: { id: submissionId } });

    try {
      await writeAudit(prisma, {
        performedById: req.user.userId,
        action: 'assignment_submission_deleted',
        resourceType: 'AssignmentSubmission',
        resourceId: submissionId,
        details: {
          studentId,
          studentName,
          assignmentTitle,
          assignmentId: sub.assignment?.id,
          courseId,
          reason: reason ?? null,
        },
      }, {
        title: 'Submission deleted',
        summary: `${assignmentTitle} — ${studentName}`,
      });
    } catch (e) {
      console.warn('[submission.delete] audit failed:', e?.message);
    }

    setImmediate(() => {
      const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
      const fetchFn = global.fetch || require('node-fetch');
      const senderId = req.user.userId;
      const senderRole = req.user.role || 'professor';
      const body = {
        userId: studentId,
        title: 'Submission removed',
        content: reason
          ? `Your submission for "${assignmentTitle}" was removed by staff. Reason: ${reason}`
          : `Your submission for "${assignmentTitle}" was removed by staff. Please contact the course staff for details.`,
        type: 'warning',
        senderId,
        senderRole,
        referenceType: 'Assignment',
        referenceId: sub.assignment?.id,
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

    res.json({ success: true });
  })
);

module.exports = router;
