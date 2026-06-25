/**
 * lib/file-upload.js — Multer upload instances for course-content
 *
 * Owns three distinct upload configurations:
 *   - upload           — general course-content files (50 MB, any type)
 *   - recordingUpload  — session recording blobs (1 GB, video only)
 *   - formFileUpload   — form question attachments (25 MB, allowed types only)
 *
 * Also exports:
 *   - uploadDir        — base uploads folder path (used by index.js for static serving)
 *   - RECORDINGS_DIR   — recordings sub-folder path
 *   - FORM_UPLOAD_ROOT — forms sub-folder path
 *
 * Non-obvious decisions:
 *   - recordingUpload's fileFilter accepts by mimetype OR filename extension because
 *     some browsers set mimetype to 'text/plain' on MediaRecorder blobs.
 *   - Directories are created at module-load time so the first request never races
 *     a mkdirSync.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AppError } = require('../../../lib/errors');
const storage = require('../../../lib/storage');

// ── Base upload directory ─────────────────────────────────────────────────────
// On Fly the volume is mounted at /app/uploads — `content` is the per-server
// subfolder. course-content's /files/* static mount in index.js reads from
// the same path so recordings/materials/forms URLs resolve through the
// volume on prod and through __dirname/uploads in dev.

const uploadDir = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'content')
  : path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── General upload (materials, assignment files, submissions) ─────────────────
// memoryStorage so handlers hand the buffer to storage.saveUpload('content', f).
// Files land under the `content/` key prefix (served at /files/<filename>).

const upload = storage.memoryUpload({ limits: { fileSize: 50 * 1024 * 1024 } });

// ── Recording upload ──────────────────────────────────────────────────────────

const RECORDINGS_DIR = path.join(uploadDir, 'recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const recordingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || 'recording').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  },
});

const recordingUpload = multer({
  storage: recordingStorage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimeOk = /^video\//i.test(file.mimetype || '');
    const nameOk = /\.(webm|mp4|mkv|ogg|ogv|mov|m4v)$/i.test(file.originalname || '');
    if (!mimeOk && !nameOk) {
      return cb(new AppError(
        `Only video uploads are allowed (received mimetype=${file.mimetype}, name=${file.originalname}).`,
        400,
      ));
    }
    cb(null, true);
  },
});

// ── Form file upload ──────────────────────────────────────────────────────────

const FORM_UPLOAD_ROOT = path.join(uploadDir, 'forms');
if (!fs.existsSync(FORM_UPLOAD_ROOT)) fs.mkdirSync(FORM_UPLOAD_ROOT, { recursive: true });

const FORM_ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

// memoryStorage — handler saves under `content/forms/<formId>/` via storage.
const formFileUpload = storage.memoryUpload({
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (FORM_ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'), false);
  },
});

module.exports = {
  upload,
  recordingUpload,
  formFileUpload,
  uploadDir,
  RECORDINGS_DIR,
  FORM_UPLOAD_ROOT,
};
