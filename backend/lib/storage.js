// backend/lib/storage.js
//
// Unified file storage abstraction. Two backends, selected by UPLOADS_BACKEND:
//   - 'local' (default) → disk under UPLOAD_ROOT (the persistent /app/uploads
//     volume in prod). Identical to the legacy multer-diskStorage behaviour.
//   - 's3'             → Amazon S3 (private bucket; objects streamed back
//     through the app, never public). Set AWS_REGION + S3_BUCKET +
//     AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.
//
// The KEY scheme mirrors the on-disk layout under UPLOAD_ROOT exactly
// (e.g. 'avatars/123.png', 'chat-photos/x.jpg', 'content/y.pdf'), so the
// public URLs the frontend already stores (/uploads/avatars/123.png,
// /chat-photos/x.jpg, /files/content/y.pdf) keep working unchanged — the
// serving layer maps URL → key 1:1.
//
// Large live-session recordings (up to 1 GB) deliberately do NOT use this
// layer — they stay on the local volume (memoryStorage can't buffer 1 GB and
// they'd blow the S3 free tier). See course-content/lib/file-upload.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const BACKEND = (process.env.UPLOADS_BACKEND || 'local').toLowerCase();
const isS3 = BACKEND === 's3';
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, '..', 'uploads');
const BUCKET = process.env.S3_BUCKET || '';

let s3 = null;
let Cmd = null;
if (isS3) {
  // Lazy-require so the SDK is only loaded when S3 mode is active.
  const sdk = require('@aws-sdk/client-s3');
  Cmd = sdk;
  s3 = new sdk.S3Client({
    region: process.env.AWS_REGION || 'eu-central-1',
    // Explicit creds when provided; otherwise fall back to the default
    // provider chain (e.g. an EC2 instance role).
    credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
  if (!BUCKET) console.warn('[storage] UPLOADS_BACKEND=s3 but S3_BUCKET is unset');
}

// Strip leading slashes and neutralise any traversal sequences.
function normKey(key) {
  return String(key || '').replace(/^\/+/, '').replace(/\.\.+/g, '.');
}

// Extension → MIME, so local-disk reads (and S3 objects missing a stored
// ContentType) get the right header — matching the old nginx-alias behaviour.
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
function guessType(key) {
  const dot = String(key).lastIndexOf('.');
  return (dot >= 0 && MIME[key.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

// Write a buffer (or string). Returns the normalised key.
async function putObject(key, body, contentType) {
  key = normKey(key);
  if (isS3) {
    await s3.send(new Cmd.PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }));
  } else {
    const full = path.join(UPLOAD_ROOT, key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, body);
  }
  return key;
}

// Fetch an object. Returns { stream, contentType, contentLength } or null when
// the object doesn't exist.
async function getObject(key) {
  key = normKey(key);
  if (isS3) {
    try {
      const out = await s3.send(new Cmd.GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return { stream: out.Body, contentType: out.ContentType, contentLength: out.ContentLength };
    } catch (e) {
      const code = e?.$metadata?.httpStatusCode;
      if (code === 404 || e?.name === 'NoSuchKey' || e?.name === 'NotFound') return null;
      throw e;
    }
  }
  const full = path.join(UPLOAD_ROOT, key);
  if (!fs.existsSync(full)) return null;
  const stat = await fs.promises.stat(full);
  return { stream: fs.createReadStream(full), contentType: undefined, contentLength: stat.size };
}

// Delete an object (best-effort; never throws on "not found").
async function deleteObject(key) {
  key = normKey(key);
  try {
    if (isS3) {
      await s3.send(new Cmd.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } else {
      await fs.promises.rm(path.join(UPLOAD_ROOT, key), { force: true });
    }
  } catch (e) {
    console.warn('[storage] delete failed for', key, e?.message);
  }
}

// ── Upload helpers (shared so per-site conversion is one-liners) ──────────────

// multer instance backed by memory (buffer in req.file.buffer) so the handler
// can hand the buffer straight to putObject. Pass the same { limits, fileFilter }
// options the legacy diskStorage configs used.
function memoryUpload(opts = {}) {
  return multer({ storage: multer.memoryStorage(), ...opts });
}

// Deterministic, collision-resistant filename mirroring the legacy diskStorage
// `filename` callbacks (timestamp + short random + sanitised original name).
function genFilename(originalname) {
  const safe = String(originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`;
}

// Persist a multer memory file under `<subdir>/<filename>`. Returns the key +
// filename so the caller can build the public URL it stores in the DB.
async function saveUpload(subdir, file, fixedFilename) {
  const filename = fixedFilename || genFilename(file.originalname);
  const key = subdir ? `${normKey(subdir)}/${filename}` : filename;
  await putObject(key, file.buffer, file.mimetype);
  return { key, filename };
}

// Express handler factory: streams `<keyPrefix><req.params[0]>` from storage.
// Used for the /uploads/* and /chat-photos/* serving routes.
function serveHandler(keyPrefix = '') {
  return async (req, res) => {
    try {
      const rest = req.params[0] || '';
      const fullKey = `${keyPrefix}${rest}`;
      const obj = await getObject(fullKey);
      if (!obj) return res.status(404).end();
      res.setHeader('Content-Type', obj.contentType || guessType(fullKey));
      if (obj.contentLength != null) res.setHeader('Content-Length', obj.contentLength);
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30d
      obj.stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
      obj.stream.pipe(res);
    } catch (e) {
      console.warn('[storage] serve error', e?.message);
      if (!res.headersSent) res.status(500).end();
    }
  };
}

module.exports = {
  putObject, getObject, deleteObject, normKey, guessType,
  memoryUpload, genFilename, saveUpload, serveHandler,
  isS3, BACKEND, BUCKET, UPLOAD_ROOT,
};
