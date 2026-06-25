/**
 * routes/materials.routes.js — CourseMaterial upload, delete + user progress
 *
 * Owns:
 *   GET  /api/users/:userId/progress                       — all progress for a user
 *   POST /api/courses/:courseCode/materials/upload         — upload one or many files
 *   DELETE /api/courses/:courseCode/materials/:materialId  — delete material + file
 *
 * Non-obvious decisions:
 *   - All three routes use full paths (mounted at /api in index.js).
 *   - Material upload uses upload.fields([{name:'file',maxCount:1},{name:'files',maxCount:20}])
 *     to accept both the legacy single-file field and the newer multi-file field.
 *   - inferType is a local helper (extension → MaterialType enum); not lifted to lib
 *     because it's only used in this handler.
 *   - restoreTenantContext is applied after the multer middleware on upload so the
 *     tenant context survives the multipart body parse.
 */

'use strict';

const { Router } = require('express');
const fs = require('fs');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const { upload } = require('../lib/file-upload');
const storage = require('../../../lib/storage');
const { notifyCourseStudents } = require('../../../lib/notify');

const router = Router();

// ── GET /api/users/:userId/progress ──────────────────────────────────────────

router.get(
  '/users/:userId/progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = req.params;

    const progressRows = await prisma.studentProgress.findMany({
      where: { userId },
      include: {
        course: { select: { id: true, code: true, title: true } },
        material: { select: { id: true, title: true, type: true, category: true } },
      },
      orderBy: { lastViewedAt: 'desc' },
    });

    const byCourse = {};
    for (const row of progressRows) {
      const key = row.course.code;
      if (!byCourse[key]) {
        byCourse[key] = {
          courseId: row.course.id,
          courseCode: key,
          courseTitle: row.course.title,
          completedItems: 0,
          items: [],
        };
      }
      byCourse[key].items.push(row);
      if (row.completed) byCourse[key].completedItems += 1;
    }

    res.json(byCourse);
  })
);

// ── POST /api/courses/:courseCode/materials/upload ────────────────────────────

router.post(
  '/courses/:courseCode/materials/upload',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 20 },
  ]),
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const { title, type, category, sectionId, isPublished } = req.body;

    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    const fileList = [
      ...(req.files?.file ?? []),
      ...(req.files?.files ?? []),
    ];

    if (fileList.length === 0 && !req.body.url) {
      throw new AppError('file(s) or url required', 400);
    }

    if (fileList.length === 0 && req.body.url) {
      const URL_ALLOWED = new Set(['pdf', 'slides', 'video', 'link', 'document']);
      const safeType = type && URL_ALLOWED.has(type) ? type : 'link';
      const material = await prisma.courseMaterial.create({
        data: {
          courseId: course.id,
          sectionId: sectionId ?? null,
          title: title || 'External Link',
          type: safeType,
          category: category ?? 'lectures',
          url: req.body.url,
          uploadedById: req.user.userId,
          isPublished: isPublished !== undefined ? isPublished === 'true' || isPublished === true : true,
        },
      });
      notifyCourseStudents(prisma, req, courseCode, {
        title: `New material: ${material.title}`,
        content: `${material.category || 'Link'} added to ${courseCode.toUpperCase()}.`,
        type: 'info',
        priority: 'normal',
        referenceType: 'CourseMaterial',
        referenceId: material.id,
      });
      return res.status(201).json({ success: true, materials: [material] });
    }

    const inferType = (filename = '') => {
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (ext === 'pdf') return 'pdf';
      if (['ppt', 'pptx', 'key'].includes(ext)) return 'slides';
      if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video';
      const ALLOWED = new Set(['pdf', 'slides', 'video', 'link', 'document']);
      if (type && ALLOWED.has(type)) return type;
      return 'document';
    };

    const created = [];
    for (const f of fileList) {
      const fileSize = `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
      // Persist via storage (S3 or disk). Key is content/<filename>; the public
      // URL stays /files/<filename> (the /files handler maps it back to content/).
      const { key, filename } = await storage.saveUpload('content', f);
      const material = await prisma.courseMaterial.create({
        data: {
          courseId: course.id,
          sectionId: sectionId ?? null,
          title: title || f.originalname || 'Untitled',
          type: inferType(f.originalname),
          category: category ?? 'lectures',
          filePath: key,
          fileName: filename,
          originalName: f.originalname,
          url: `/files/${filename}`,
          size: fileSize,
          uploadedById: req.user.userId,
          isPublished:
            isPublished !== undefined
              ? isPublished === 'true' || isPublished === true
              : true,
        },
      });
      created.push(material);
    }

    // Notify enrolled students about the new material(s).
    if (created.length > 0) {
      const head = created[0];
      const titleText = created.length === 1
        ? `New material: ${head.title}`
        : `${created.length} new materials posted in ${courseCode.toUpperCase()}`;
      const contentText = created.length === 1
        ? `${head.category || 'Material'} added to ${courseCode.toUpperCase()}.`
        : `${created.length} new ${head.category || 'materials'} added to ${courseCode.toUpperCase()}.`;
      notifyCourseStudents(prisma, req, courseCode, {
        title: titleText,
        content: contentText,
        type: 'info',
        priority: 'normal',
        referenceType: 'CourseMaterial',
        referenceId: head.id,
      });
    }

    res.status(201).json({
      success: true,
      material: created[0] ?? null,
      materials: created,
    });
  })
);

// ── DELETE /api/courses/:courseCode/materials/:materialId ─────────────────────

router.delete(
  '/courses/:courseCode/materials/:materialId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, materialId } = req.params;

    const material = await prisma.courseMaterial.findFirst({
      where: { id: materialId, course: { code: courseCode.toUpperCase() } },
    });
    if (!material) throw new AppError('Material not found', 404);

    if (material.filePath) {
      // filePath is the storage key (content/<file>) for new rows, or a legacy
      // absolute disk path for old rows — normalise to a key either way.
      const key = material.filePath.includes('/uploads/')
        ? material.filePath.split('/uploads/').pop()
        : material.filePath;
      await storage.deleteObject(key);
    }

    await prisma.courseMaterial.delete({ where: { id: materialId } });
    res.json({ success: true });
  })
);

module.exports = router;
