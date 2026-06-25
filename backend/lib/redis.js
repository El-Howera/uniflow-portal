// ============================================================================
// UniFlow — Redis lazy singleton
// ============================================================================
//
// Why lazy: importing this file should never throw or open a connection. The
// connection is opened on first `getRedis()` call, and only if REDIS_URL is
// set. This means a missing Redis never breaks dev — every consumer falls
// back to its in-memory behaviour silently.
//
// API:
//   getRedis()           → ioredis client OR null if not configured
//   isRedisEnabled()     → boolean
//   getJSON(key)         → parsed value or null
//   setJSON(key, val, ttlSec)
//   del(key)
//   namespace(...parts)  → joins with 'uniflow:' prefix
//   incr(key, ttlSec)    → integer (atomic increment + first-write TTL)
//
// Fail-soft: every helper catches connection errors, logs once per minute,
// returns null. Callers MUST handle null as a cache miss.

let _client = null;
let _enabled = null; // tri-state: null = unprobed, true/false after first call
let _lastErrorLog = 0;

const PREFIX = 'uniflow';

function logErrorThrottled(scope, err) {
  const now = Date.now();
  if (now - _lastErrorLog > 60_000) {
    console.warn(`[redis:${scope}] ${err.message} (errors throttled to 1/min)`);
    _lastErrorLog = now;
  }
}

function getRedis() {
  if (_enabled === false) return null;
  if (_client) return _client;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (_enabled === null) {
      console.warn('[redis] REDIS_URL not set - running with in-memory fallbacks. Set REDIS_URL in .env to enable shared caching.');
    }
    _enabled = false;
    return null;
  }

  try {
    const IORedis = require('ioredis');
    _client = new IORedis(url, {
      // Don't block event loop on initial connect — return ops fail fast and
      // fall back to in-memory.
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        // Exponential backoff, capped at 5s. Never give up entirely.
        return Math.min(times * 200, 5000);
      },
    });

    _client.on('error', (err) => logErrorThrottled('client', err));
    _client.on('connect', () => console.log(`[redis] connected -> ${url.replace(/\/\/.*@/, '//***@')}`));
    _client.on('ready', () => console.log('[redis] ready'));

    _enabled = true;
    return _client;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('[redis] ioredis not installed. Run: npm install ioredis');
    } else {
      console.warn(`[redis] init failed: ${err.message}`);
    }
    _enabled = false;
    return null;
  }
}

function isRedisEnabled() {
  if (_enabled !== null) return _enabled;
  getRedis();
  return _enabled === true;
}

function namespace(...parts) {
  return [PREFIX, ...parts].filter(Boolean).join(':');
}

async function getJSON(key) {
  const client = getRedis();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    return raw == null ? null : JSON.parse(raw);
  } catch (err) {
    logErrorThrottled('getJSON', err);
    return null;
  }
}

async function setJSON(key, value, ttlSec) {
  const client = getRedis();
  if (!client) return false;
  try {
    const serialised = JSON.stringify(value);
    if (ttlSec && ttlSec > 0) {
      await client.set(key, serialised, 'EX', Math.ceil(ttlSec));
    } else {
      await client.set(key, serialised);
    }
    return true;
  } catch (err) {
    logErrorThrottled('setJSON', err);
    return false;
  }
}

async function del(key) {
  const client = getRedis();
  if (!client) return false;
  try {
    await client.del(key);
    return true;
  } catch (err) {
    logErrorThrottled('del', err);
    return false;
  }
}

/**
 * Atomically increment a counter and (only on the first increment) set a TTL.
 * Returns the post-increment integer, or null on failure.
 *
 * Used by rate limiters that want their own counters without pulling
 * `rate-limit-redis` in.
 */
async function incr(key, ttlSec) {
  const client = getRedis();
  if (!client) return null;
  try {
    const pipeline = client.multi();
    pipeline.incr(key);
    if (ttlSec && ttlSec > 0) pipeline.expire(key, Math.ceil(ttlSec), 'NX');
    const results = await pipeline.exec();
    if (!results || !results[0]) return null;
    const [err, value] = results[0];
    if (err) throw err;
    return Number(value);
  } catch (err) {
    logErrorThrottled('incr', err);
    return null;
  }
}

/**
 * Best-effort scan + delete for a key prefix. Used by cache-invalidation paths
 * (e.g. invalidating all permission cache entries for one tenant). Uses SCAN
 * not KEYS to avoid blocking the server on large keyspaces.
 */
async function delByPrefix(prefix) {
  const client = getRedis();
  if (!client) return 0;
  try {
    let cursor = '0';
    let total = 0;
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (batch.length > 0) {
        await client.del(...batch);
        total += batch.length;
      }
    } while (cursor !== '0');
    return total;
  } catch (err) {
    logErrorThrottled('delByPrefix', err);
    return 0;
  }
}

module.exports = {
  getRedis,
  isRedisEnabled,
  namespace,
  getJSON,
  setJSON,
  del,
  delByPrefix,
  incr,
};
