const cors = require('cors');

// CORS origin policy.
//
// Production (NODE_ENV === 'production'):
//   Only origins listed in CORS_ORIGIN are allowed. Comma-separated; no
//   wildcard, no LAN escape hatch.
//
// Development (anything else):
//   Always allows localhost + every RFC-1918 LAN IP on any port — this
//   covers the dev machine, a phone on the same Wi-Fi (e.g. 192.168.1.6),
//   another laptop, etc. Any origin in CORS_ORIGIN is layered on top
//   (so a production-shaped CORS_ORIGIN doesn't cripple LAN dev).
//
// A wildcard ('*') is intentionally avoided everywhere because credentialed
// requests (cookies) require a concrete origin — browsers reject
// 'Access-Control-Allow-Origin: *' when credentials: true is set.

const LAN_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|10(?:\.\d+){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|192\.168(?:\.\d+){2})(?::\d+)?$/;

const buildOriginAllowlist = () => {
  const env = process.env.CORS_ORIGIN;
  if (!env) return null;
  const list = env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : null;
};

const explicitAllow = buildOriginAllowlist();
const isProd = process.env.NODE_ENV === 'production';

const isAllowed = (origin) => {
  // No-origin requests (server-to-server, curl, same-origin) are always
  // allowed — `cors` expects us to call cb(null, true) for these.
  if (!origin) return true;

  // Electron desktop app — BrowserWindow.loadFile uses the file:// scheme,
  // and browsers send Origin: 'null' for cross-origin fetches from
  // file:// URIs (some Electron versions send 'file://' literally). The
  // shipped Electron build also rewrites Origin to the configured API
  // base via session.webRequest.onBeforeSendHeaders, so this branch is
  // belt-and-suspenders for any code path that bypasses the rewriter
  // (background fetch, service worker, etc.). Safe in prod because the
  // API still requires JWT auth — a malicious local file:// page would
  // need stolen credentials to do anything.
  if (origin === 'null' || origin.startsWith('file://')) return true;

  // Production: strict list-only.
  if (isProd) return explicitAllow ? explicitAllow.includes(origin) : false;

  // Development: env list (if any) PLUS the LAN regex. The two are
  // unioned, not either-or — having CORS_ORIGIN set in the dev .env
  // shouldn't break the LAN escape hatch. This was the trap before:
  // CORS_ORIGIN=http://localhost:3000 was silently rejecting phones on
  // the same Wi-Fi.
  if (explicitAllow && explicitAllow.includes(origin)) return true;
  return LAN_ORIGIN_RE.test(origin);
};

const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (isAllowed(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
});

module.exports = corsMiddleware;
