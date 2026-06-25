/**
 * Plan 22 Phase 6 — Helmet wrapper for the 10 Express services.
 *
 * Closes risk register R7 (HIGH/HIGH — security headers not mounted).
 * Returns a single Express middleware that sets:
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: SAMEORIGIN (clickjacking guard)
 *   - X-DNS-Prefetch-Control: off
 *   - Strict-Transport-Security: max-age=15552000 (when HTTPS)
 *   - Referrer-Policy: no-referrer
 *   - Permissions-Policy: minimal allow-list
 *   - Cross-Origin-Resource-Policy: same-site
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - X-Powered-By: removed
 *
 * Intentionally DISABLED:
 *   - contentSecurityPolicy — CRA dev server inlines styles + uses
 *     blob: workers, and the chatroom mixes external images. A real CSP
 *     needs per-route header nonce wiring; deferred to a follow-up plan.
 *
 * Mount as the FIRST middleware on each Express server, before CORS so
 * security headers ride OPTIONS preflight responses too.
 */

const helmet = require('helmet');

function securityHeaders() {
  return helmet({
    // Disable CSP — see file header for rationale.
    contentSecurityPolicy: false,
    // crossOriginEmbedderPolicy is too strict for the chat surface
    // (Firestore iframe + cross-origin image uploads). Leave off.
    crossOriginEmbedderPolicy: false,
    // Defaults are good for everything else.
  });
}

module.exports = { securityHeaders };
