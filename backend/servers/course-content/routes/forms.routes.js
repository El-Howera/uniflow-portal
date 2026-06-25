/**
 * routes/forms.routes.js — Plan 7 Phase 4: Form Composer
 *
 * Owns:
 *   GET    /api/forms                     — list forms visible to caller
 *   GET    /api/forms/:id                 — form detail with questions
 *   POST   /api/forms                     — create form (staff only)
 *   PUT    /api/forms/:id                 — edit form metadata + questions
 *   DELETE /api/forms/:id                 — hard-delete form
 *   POST   /api/forms/:id/publish         — flip isPublished=true
 *   POST   /api/forms/:id/responses       — submit or update a response
 *   GET    /api/forms/:id/responses       — list all responses (creator/admin)
 *   GET    /api/forms/:id/responses/:userId — single response detail
 *   GET    /api/forms/:id/export.csv      — CSV export of all responses
 *   POST   /api/forms/:id/upload          — file upload for file-upload questions
 *
 * Non-obvious decisions:
 *   - Visibility is checked via `isFormVisibleTo(form, req.user)` before any
 *     response is written or read. This function queries AcademicProfile when
 *     targetLevels is set so a single caller object is enough to evaluate targeting.
 *   - PUT replaces the entire questions array (delete-then-recreate) to avoid
 *     ordering conflicts. This is blocked after publish (isPublished=true) for
 *     question-structure changes; metadata (title, dates, targeting) can still
 *     be edited after publish.
 *   - CSV export streams a synchronously-built string; at typical survey scales
 *     (< 5 000 rows) this is fine. Large exports would need a streaming approach.
 *   - formFileUpload uses its own multer instance from lib/file-upload.js (25 MB
 *     cap, allow-listed MIME types). restoreTenantContext is applied after multer.
 */

'use strict';

const { Router } = require('express');
const { z } = require('zod');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const { writeAudit } = require('../../../lib/audit');
const { formFileUpload } = require('../lib/file-upload');
const storage = require('../../../lib/storage');
const { notifyUsers } = require('../../../lib/notify');

/**
 * Resolve the audience for a form into a flat userId list.
 * Precedence: targetUserIds → targetLevels → targetRoles.
 */
async function resolveFormAudience(form) {
  if (Array.isArray(form.targetUserIds) && form.targetUserIds.length > 0) {
    return form.targetUserIds;
  }
  if (Array.isArray(form.targetLevels) && form.targetLevels.length > 0) {
    const rows = await prisma.user.findMany({
      where: {
        academicProfile: { level: { in: form.targetLevels } },
        ...(Array.isArray(form.targetRoles) && form.targetRoles.length > 0
          ? { role: { in: form.targetRoles } }
          : { role: 'student' }),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  if (Array.isArray(form.targetRoles) && form.targetRoles.length > 0) {
    const rows = await prisma.user.findMany({
      where: { role: { in: form.targetRoles } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  return [];
}

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const QUESTION_KINDS = ['text', 'textarea', 'multiple-choice', 'checkboxes', 'dropdown', 'date', 'image-upload', 'file-upload'];

const formQuestionSchema = z.object({
  kind: z.enum(QUESTION_KINDS),
  label: z.string().min(1).max(500),
  required: z.boolean().optional().default(false),
  options: z.array(z.string()).optional().default([]),
  maxLength: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

const formCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  bannerImage: z.string().optional().nullable(),
  startDate: z.string().or(z.date()),
  dueDate: z.string().or(z.date()),
  targetRoles: z.array(z.string()).optional().default([]),
  targetLevels: z.array(z.number().int()).optional().default([]),
  targetUserIds: z.array(z.string()).optional().default([]),
  questions: z.array(formQuestionSchema).optional().default([]),
});

const formUpdateSchema = formCreateSchema.partial();

const formResponseSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1),
    textValue: z.string().optional().nullable(),
    choiceValues: z.array(z.string()).optional().default([]),
    fileUrl: z.string().optional().nullable(),
  })),
});

// ── Visibility helper ─────────────────────────────────────────────────────────

async function isFormVisibleTo(form, callerUser) {
  if (!callerUser) return false;
  const role = callerUser.role;
  const userId = callerUser.userId;

  if (role === 'admin') return true;
  if (form.createdById === userId) return true;
  if (!form.isPublished) return false;

  if (Array.isArray(form.targetUserIds) && form.targetUserIds.length > 0) {
    return form.targetUserIds.includes(userId);
  }
  if (Array.isArray(form.targetLevels) && form.targetLevels.length > 0) {
    const ap = await prisma.academicProfile
      .findUnique({ where: { userId }, select: { level: true } })
      .catch(() => null);
    if (ap?.level == null) return false;
    if (!form.targetLevels.includes(ap.level)) return false;
    if (Array.isArray(form.targetRoles) && form.targetRoles.length > 0) {
      return form.targetRoles.includes(role);
    }
    return true;
  }
  if (Array.isArray(form.targetRoles) && form.targetRoles.length > 0) {
    return form.targetRoles.includes(role);
  }
  return true;
}

// ── CSV helper ────────────────────────────────────────────────────────────────

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── GET /api/forms ────────────────────────────────────────────────────────────

router.get('/forms',
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = req.user.role;
    const userId = req.user.userId;
    const isStaff = ['professor', 'ta', 'sa', 'admin'].includes(role);

    let forms;
    if (role === 'admin') {
      forms = await prisma.form.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
          _count: { select: { responses: true, questions: true } },
        },
      });
    } else if (isStaff) {
      forms = await prisma.form.findMany({
        where: {
          OR: [
            { createdById: userId },
            { isPublished: true },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
          _count: { select: { responses: true, questions: true } },
        },
      });
    } else {
      const candidates = await prisma.form.findMany({
        where: { isPublished: true },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { firstName: true, lastName: true } },
          _count: { select: { responses: true, questions: true } },
        },
      });
      const visible = [];
      for (const f of candidates) {
        if (await isFormVisibleTo(f, req.user)) visible.push(f);
      }
      forms = visible;
    }

    let respondedSet = new Set();
    if (role === 'student') {
      const formIds = forms.map((f) => f.id);
      if (formIds.length > 0) {
        const responses = await prisma.formResponse.findMany({
          where: { formId: { in: formIds }, respondentId: userId },
          select: { formId: true },
        });
        respondedSet = new Set(responses.map((r) => r.formId));
      }
    }

    res.json({
      forms: forms.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        bannerImage: f.bannerImage,
        startDate: f.startDate,
        dueDate: f.dueDate,
        isPublished: f.isPublished,
        targetRoles: f.targetRoles,
        targetLevels: f.targetLevels,
        targetUserIds: f.targetUserIds,
        createdBy: f.createdBy,
        createdAt: f.createdAt,
        responseCount: f._count?.responses ?? 0,
        questionCount: f._count?.questions ?? 0,
        ...(role === 'student' ? { hasResponded: respondedSet.has(f.id) } : {}),
      })),
    });
  })
);

// ── GET /api/forms/:id ────────────────────────────────────────────────────────

router.get('/forms/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        questions: { orderBy: { order: 'asc' } },
        _count: { select: { responses: true } },
      },
    });
    if (!form) throw new AppError('Form not found', 404);
    const allowed = await isFormVisibleTo(form, req.user);
    if (!allowed) throw new AppError('Form not visible', 403);

    let hasResponded = false;
    if (req.user.role === 'student') {
      const r = await prisma.formResponse.findFirst({
        where: { formId: form.id, respondentId: req.user.userId },
        select: { id: true },
      }).catch(() => null);
      hasResponded = !!r;
    }

    res.json({
      form: {
        id: form.id,
        title: form.title,
        description: form.description,
        bannerImage: form.bannerImage,
        startDate: form.startDate,
        dueDate: form.dueDate,
        isPublished: form.isPublished,
        targetRoles: form.targetRoles,
        targetLevels: form.targetLevels,
        targetUserIds: form.targetUserIds,
        createdBy: form.createdBy,
        questions: form.questions,
        responseCount: form._count?.responses ?? 0,
        hasResponded,
      },
    });
  })
);

// ── POST /api/forms ───────────────────────────────────────────────────────────

router.post('/forms',
  requireAuth,
  requireRole(['professor', 'ta', 'sa', 'admin']),
  asyncHandler(async (req, res) => {
    const parsed = formCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(JSON.stringify({ error: 'validation', details: parsed.error.flatten() }), 400);
    }
    const data = parsed.data;
    const form = await prisma.$transaction(async (tx) => {
      const f = await tx.form.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          bannerImage: data.bannerImage ?? null,
          startDate: new Date(data.startDate),
          dueDate: new Date(data.dueDate),
          targetRoles: data.targetRoles,
          targetLevels: data.targetLevels,
          targetUserIds: data.targetUserIds,
          isPublished: false,
          createdById: req.user.userId,
        },
      });
      if (data.questions.length > 0) {
        await tx.formQuestion.createMany({
          data: data.questions.map((q, idx) => ({
            formId: f.id,
            order: idx,
            kind: q.kind,
            label: q.label,
            required: q.required ?? false,
            options: q.options ?? [],
            maxLength: q.maxLength ?? null,
            imageUrl: q.imageUrl ?? null,
          })),
        });
      }
      return f;
    });
    res.status(201).json({ ok: true, form });
  })
);

// ── PUT /api/forms/:id ────────────────────────────────────────────────────────

router.put('/forms/:id',
  requireAuth,
  requireRole(['professor', 'ta', 'sa', 'admin']),
  asyncHandler(async (req, res) => {
    const existing = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Form not found', 404);
    const isOwner = existing.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    if (!isOwner && !isAdmin) throw new AppError('Only creator or admin may edit', 403);

    const parsed = formUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(JSON.stringify({ error: 'validation', details: parsed.error.flatten() }), 400);
    }
    const data = parsed.data;
    const wantsStructureChange = Array.isArray(data.questions);

    if (existing.isPublished && wantsStructureChange) {
      throw new AppError('Cannot change question structure after publish — only metadata edits allowed', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const patch = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.description !== undefined) patch.description = data.description;
      if (data.bannerImage !== undefined) patch.bannerImage = data.bannerImage;
      if (data.startDate !== undefined) patch.startDate = new Date(data.startDate);
      if (data.dueDate !== undefined) patch.dueDate = new Date(data.dueDate);
      if (data.targetRoles !== undefined) patch.targetRoles = data.targetRoles;
      if (data.targetLevels !== undefined) patch.targetLevels = data.targetLevels;
      if (data.targetUserIds !== undefined) patch.targetUserIds = data.targetUserIds;

      const f = await tx.form.update({ where: { id: existing.id }, data: patch });

      if (wantsStructureChange) {
        await tx.formResponseAnswer.deleteMany({
          where: { question: { formId: existing.id } },
        });
        await tx.formQuestion.deleteMany({ where: { formId: existing.id } });
        if (data.questions.length > 0) {
          await tx.formQuestion.createMany({
            data: data.questions.map((q, idx) => ({
              formId: existing.id,
              order: idx,
              kind: q.kind,
              label: q.label,
              required: q.required ?? false,
              options: q.options ?? [],
              maxLength: q.maxLength ?? null,
              imageUrl: q.imageUrl ?? null,
            })),
          });
        }
      }
      return f;
    });

    res.json({ ok: true, form: updated });
  })
);

// ── DELETE /api/forms/:id ─────────────────────────────────────────────────────

router.delete('/forms/:id',
  requireAuth,
  requireRole(['professor', 'ta', 'sa', 'admin']),
  asyncHandler(async (req, res) => {
    const existing = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Form not found', 404);
    const isOwner = existing.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    if (!isOwner && !isAdmin) throw new AppError('Only creator or admin may delete', 403);

    await prisma.form.delete({ where: { id: existing.id } });
    try {
      await writeAudit(prisma, {
        action: 'form_deleted',
        entityType: 'Form',
        entityId: existing.id,
        details: { title: existing.title },
        performedById: req.user.userId,
      });
    } catch (e) {
      console.warn('[form.delete] audit failed:', e?.message);
    }
    res.json({ ok: true });
  })
);

// ── POST /api/forms/:id/publish ───────────────────────────────────────────────

router.post('/forms/:id/publish',
  requireAuth,
  requireRole(['professor', 'ta', 'sa', 'admin']),
  asyncHandler(async (req, res) => {
    const existing = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Form not found', 404);
    const isOwner = existing.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    if (!isOwner && !isAdmin) throw new AppError('Only creator or admin may publish', 403);

    const updated = await prisma.form.update({
      where: { id: existing.id },
      data: { isPublished: true },
    });

    // Notify the target audience on publish.
    try {
      const audience = await resolveFormAudience(updated);
      if (audience.length > 0) {
        const due = updated.dueAt
          ? ` Due ${new Date(updated.dueAt).toLocaleDateString()}.`
          : '';
        notifyUsers(req, {
          userIds: audience,
          title: `New form: ${updated.title}`,
          content: `A new form "${updated.title}" was published for you to respond to.${due}`,
          type: 'info',
          priority: 'normal',
          referenceType: 'Form',
          referenceId: updated.id,
        });
      }
    } catch (err) {
      console.warn('[forms.publish] fan-out failed:', err.message);
    }

    res.json({ ok: true, form: updated });
  })
);

// ── POST /api/forms/:id/responses ─────────────────────────────────────────────

router.post('/forms/:id/responses',
  requireAuth,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({
      where: { id: req.params.id },
      include: { questions: { select: { id: true, required: true, label: true } } },
    });
    if (!form) throw new AppError('Form not found', 404);
    if (!form.isPublished) throw new AppError('Form is not yet published', 400);
    const allowed = await isFormVisibleTo(form, req.user);
    if (!allowed) throw new AppError('Form not visible', 403);

    if (new Date(form.dueDate).getTime() < Date.now()) {
      throw new AppError('Response window has closed', 400);
    }

    const parsed = formResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(JSON.stringify({ error: 'validation', details: parsed.error.flatten() }), 400);
    }
    const { answers } = parsed.data;

    const validQids = new Set(form.questions.map((q) => q.id));
    for (const a of answers) {
      if (!validQids.has(a.questionId)) {
        throw new AppError(`Unknown question id: ${a.questionId}`, 400);
      }
    }

    const answeredQids = new Set(answers.map((a) => a.questionId));
    for (const q of form.questions) {
      if (q.required && !answeredQids.has(q.id)) {
        throw new AppError(`Required question not answered: ${q.label}`, 400);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const response = await tx.formResponse.upsert({
        where: { formId_respondentId: { formId: form.id, respondentId: req.user.userId } },
        update: {},
        create: { formId: form.id, respondentId: req.user.userId },
      });
      for (const a of answers) {
        await tx.formResponseAnswer.upsert({
          where: { responseId_questionId: { responseId: response.id, questionId: a.questionId } },
          update: {
            textValue: a.textValue ?? null,
            choiceValues: a.choiceValues ?? [],
            fileUrl: a.fileUrl ?? null,
          },
          create: {
            responseId: response.id,
            questionId: a.questionId,
            textValue: a.textValue ?? null,
            choiceValues: a.choiceValues ?? [],
            fileUrl: a.fileUrl ?? null,
          },
        });
      }
      return response;
    });

    res.status(201).json({ ok: true, response: result });
  })
);

// ── GET /api/forms/:id/responses ──────────────────────────────────────────────

router.get('/forms/:id/responses',
  requireAuth,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!form) throw new AppError('Form not found', 404);
    const isOwner = form.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    if (!isOwner && !isAdmin) throw new AppError('Only creator or admin may view responses', 403);

    const responses = await prisma.formResponse.findMany({
      where: { formId: form.id },
      orderBy: { submittedAt: 'desc' },
      include: {
        respondent: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { answers: true } },
      },
    });

    res.json({
      responses: responses.map((r) => ({
        id: r.id,
        respondent: r.respondent,
        submittedAt: r.submittedAt,
        updatedAt: r.updatedAt,
        answerCount: r._count?.answers ?? 0,
      })),
    });
  })
);

// ── GET /api/forms/:id/responses/:userId ──────────────────────────────────────

router.get('/forms/:id/responses/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!form) throw new AppError('Form not found', 404);
    const isOwner = form.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    const isSelf = req.params.userId === req.user.userId;
    if (!isOwner && !isAdmin && !isSelf) throw new AppError('Forbidden', 403);

    const response = await prisma.formResponse.findFirst({
      where: { formId: form.id, respondentId: req.params.userId },
      include: {
        respondent: { select: { id: true, firstName: true, lastName: true, email: true } },
        answers: {
          include: { question: true },
        },
      },
    });
    if (!response) throw new AppError('Response not found', 404);

    res.json({ response });
  })
);

// ── GET /api/forms/:id/export.csv ─────────────────────────────────────────────

router.get('/forms/:id/export.csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({
      where: { id: req.params.id },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!form) throw new AppError('Form not found', 404);
    const isOwner = form.createdById === req.user.userId;
    const isAdmin = ['admin'].includes(req.user.role);
    if (!isOwner && !isAdmin) throw new AppError('Only creator or admin may export', 403);

    const responses = await prisma.formResponse.findMany({
      where: { formId: form.id },
      orderBy: { submittedAt: 'desc' },
      include: {
        respondent: { select: { email: true, firstName: true, lastName: true } },
        answers: true,
      },
    });

    const header = ['submitted_at', 'respondent_email', 'respondent_name'];
    for (const q of form.questions) header.push(q.label);

    const rows = [header.map(csvEscape).join(',')];
    for (const r of responses) {
      const answerByQid = new Map(r.answers.map((a) => [a.questionId, a]));
      const row = [
        new Date(r.submittedAt).toISOString(),
        r.respondent?.email ?? '',
        `${r.respondent?.firstName ?? ''} ${r.respondent?.lastName ?? ''}`.trim(),
      ];
      for (const q of form.questions) {
        const a = answerByQid.get(q.id);
        if (!a) {
          row.push('');
          continue;
        }
        if (a.choiceValues && a.choiceValues.length > 0) {
          row.push(a.choiceValues.join('; '));
        } else if (a.fileUrl) {
          row.push(a.fileUrl);
        } else {
          row.push(a.textValue ?? '');
        }
      }
      rows.push(row.map(csvEscape).join(','));
    }

    const csv = rows.join('\n');
    const safeTitle = form.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="form_${safeTitle}_${form.id}.csv"`);
    res.send(csv);
  })
);

// ── POST /api/forms/:id/upload ────────────────────────────────────────────────

router.post('/forms/:id/upload',
  requireAuth,
  (req, res, next) => {
    formFileUpload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? 'File too large (max 25 MB)'
          : err.message || 'Upload failed';
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    const form = await prisma.form.findFirst({ where: { id: req.params.id } });
    if (!form) throw new AppError('Form not found', 404);
    const allowed = await isFormVisibleTo(form, req.user);
    if (!allowed) throw new AppError('Form not visible', 403);
    if (!req.file) throw new AppError('file field required', 400);

    // Persist under content/forms/<formId>/<filename> via storage (S3 or disk).
    const { filename } = await storage.saveUpload(`content/forms/${form.id}`, req.file);
    const url = `/files/forms/${form.id}/${filename}`;
    res.status(201).json({
      ok: true,
      url,
      name: req.file.originalname,
      sizeBytes: req.file.size,
    });
  })
);

module.exports = router;
