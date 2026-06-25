/**
 * Plan 22 Phase 6 — Structured logger via pino.
 *
 * Closes risk register R4 (HIGH/MED — ~65 unconditional console.log
 * calls across backend/servers/*) by introducing a single shared
 * logger that:
 *   - Emits JSON in production (LOG_LEVEL=info default) for log
 *     shippers (Datadog, Loki, etc.).
 *   - Emits pretty-printed lines in dev (LOG_LEVEL=debug) via
 *     pino-pretty when available, falling back to JSON when not.
 *   - Adds a service-name field so multi-service log streams can be
 *     filtered: logger('attendance').info(...).
 *
 * Migration path:
 *   - DON'T sweep all 65 console.log calls in this commit — that's a
 *     mechanical pass best done file-by-file. The lib exists; route
 *     handlers opt in over time.
 *   - boot banners stay on console.log for now because they're stripped
 *     by stack:up's container log capture anyway.
 *
 * Usage:
 *   const log = require('../../lib/logger')('user-profile');
 *   log.info({ userId }, 'login successful');
 *   log.warn({ ip }, 'rate limit hit');
 *   log.error({ err: e }, 'unhandled');
 */

const pino = require('pino');

const LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const PRETTY = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false';

let transport;
if (PRETTY) {
  try {
    // pino-pretty is a devDep — fail-soft if missing.
    require.resolve('pino-pretty');
    transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    /* pino-pretty not installed — fall through to JSON */
  }
}

const root = pino({
  level: LEVEL,
  base: { service: process.env.SERVICE_NAME || 'uniflow' },
  redact: {
    paths: [
      'password',
      '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.refreshToken',
    ],
    remove: true,
  },
  transport,
});

/**
 * Return a child logger pre-tagged with the service name. Use this at
 * the top of each route file or server bootstrap:
 *
 *   const log = require('../../lib/logger')('attendance');
 */
function logger(service) {
  return service ? root.child({ service }) : root;
}

module.exports = logger;
module.exports.root = root;
