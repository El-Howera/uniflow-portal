/**
 * QR token helpers for the attendance service.
 *
 * Owns:
 *   - generateQRToken(sessionId, courseCode): signs a short-lived JWT
 *     (15 s) to be embedded in the QR code displayed by the instructor.
 *   - buildQrUrl(req, sessionId, token): constructs the deep-link URL
 *     that the QR encodes so native camera apps present an "Open in
 *     browser" prompt rather than a raw JWT string.
 *
 * URL resolution priority (buildQrUrl):
 *   1. WEB_APP_URL env var  — explicit prod override
 *   2. Origin / Referer header  — reliable in browser dev sessions
 *   3. req.headers.host with proto fallback  — last resort
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';

/**
 * @param {string} sessionId
 * @param {string} courseCode
 * @returns {string} signed JWT valid for 15 seconds
 */
function generateQRToken(sessionId, courseCode) {
  return jwt.sign(
    { sessionId, courseCode, iat: Date.now() },
    JWT_SECRET,
    { expiresIn: '15s' },
  );
}

/**
 * @param {import('express').Request} req
 * @param {string} sessionId
 * @param {string} token  QR JWT returned by generateQRToken
 * @returns {string} full deep-link URL
 */
function buildQrUrl(req, sessionId, token) {
  const explicit = (process.env.WEB_APP_URL || '').trim().replace(/\/+$/, '');
  if (explicit) {
    return `${explicit}/student/mark-attendance?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
  }
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const u = new URL(origin);
      return `${u.protocol}//${u.host}/student/mark-attendance?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
    } catch {
      /* fallthrough */
    }
  }
  const host = req.headers.host || 'localhost:3000';
  const proto = req.secure ? 'https' : 'http';
  return `${proto}://${host}/student/mark-attendance?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}

module.exports = { generateQRToken, buildQrUrl, JWT_SECRET };
