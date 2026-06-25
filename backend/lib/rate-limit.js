// ============================================================================
// UniFlow — Shared rate-limiter factory
// ============================================================================
//
// Wraps express-rate-limit. When Redis is configured, uses rate-limit-redis so
// counters are shared across processes (a clustered deploy with N chatbot
// workers stays inside the 30/min cap globally, not 30/min PER worker).
// When Redis is unavailable, falls back to the default in-memory store — no
// behaviour change for single-process dev.
//
// Usage:
//   const { buildLimiter } = require('../../lib/rate-limit');
//   const authLimiter = buildLimiter({
//     windowMs: 60 * 1000,
//     max: 10,
//     keyPrefix: 'auth',
//     message: { error: 'Too many requests, please try again later.' },
//   });
//
// `keyPrefix` namespaces counters per-limiter so the auth limiter and the
// chatbot limiter don't share buckets. Keys land under
// `uniflow:ratelimit:<keyPrefix>:<ip>`.

const rateLimit = require('express-rate-limit');
const { getRedis, isRedisEnabled } = require('./redis');

function buildLimiter(opts) {
  const { keyPrefix = 'default', ...rest } = opts;
  const config = {
    standardHeaders: true,
    legacyHeaders: false,
    ...rest,
  };

  if (isRedisEnabled()) {
    try {
      const { RedisStore } = require('rate-limit-redis');
      const client = getRedis();
      if (client) {
        config.store = new RedisStore({
          // rate-limit-redis v4 contract: pass-through to ioredis via .call().
          sendCommand: (...args) => client.call(...args),
          prefix: `uniflow:ratelimit:${keyPrefix}:`,
        });
      }
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        console.warn('[rate-limit] rate-limit-redis not installed - falling back to in-memory. Run: npm install rate-limit-redis');
      } else {
        console.warn(`[rate-limit] RedisStore init failed (${err.message}) - falling back to in-memory.`);
      }
      // Drop the store key entirely so express-rate-limit uses its default.
      delete config.store;
    }
  }

  return rateLimit(config);
}

module.exports = { buildLimiter };
