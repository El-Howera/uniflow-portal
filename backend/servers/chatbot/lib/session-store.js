/**
 * Chatbot session store — Redis-first with in-memory fallback.
 *
 * Why both layers:
 *   - Redis lets multiple chatbot workers share history so a follow-up
 *     question routed to a different process keeps context.
 *   - The in-memory Map is the per-process fallback for dev with no
 *     REDIS_URL AND a 2nd-tier cache so a Redis hiccup mid-request
 *     doesn't lose continuity within the same process.
 *
 * Capacity / TTL:
 *   - SESSION_TIMEOUT_MS: 30 min sliding (refreshed on every read+write).
 *   - MAX_HISTORY_TURNS:  last 10 Q&A turns per session.
 *
 * The in-memory eviction interval runs every 60s and trims any session
 * whose lastActive timestamp is older than SESSION_TIMEOUT_MS. The interval
 * is .unref()'d so it doesn't keep the process alive.
 */

const {
  namespace,
  getJSON,
  setJSON,
  del,
  delByPrefix,
} = require('../../../lib/redis');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_TIMEOUT_SEC = 30 * 60;
const MAX_HISTORY_TURNS = 10;

const sessions = new Map();

function sessionKey(id) {
  return namespace('chatbot', 'session', id);
}

async function getSession(id) {
  // Try Redis first.
  const fromRedis = await getJSON(sessionKey(id));
  if (fromRedis) {
    const session = { history: fromRedis.history || [], lastActive: Date.now() };
    // Mirror into the in-memory Map so subsequent same-process reads stay
    // cheap and survive a Redis hiccup.
    sessions.set(id, session);
    return session;
  }

  // Fall back to in-memory Map.
  let session = sessions.get(id);
  if (!session) {
    session = { history: [], lastActive: Date.now() };
    sessions.set(id, session);
  }
  session.lastActive = Date.now();
  return session;
}

async function saveSession(id, session) {
  session.lastActive = Date.now();
  // Write to both stores. Redis errors are caught inside setJSON (returns
  // false); the in-memory Map is the authoritative same-process record.
  sessions.set(id, session);
  await setJSON(sessionKey(id), session, SESSION_TIMEOUT_SEC);
}

async function clearSession(id) {
  sessions.delete(id);
  await del(sessionKey(id));
}

async function clearAllSessions() {
  sessions.clear();
  await delByPrefix(namespace('chatbot', 'session'));
}

/**
 * Trim a session's history to the last N turns. Returns nothing — mutates
 * in place. Caller must `await saveSession` afterwards.
 */
function trimHistory(session) {
  if (session.history.length > MAX_HISTORY_TURNS) {
    session.history.splice(0, session.history.length - MAX_HISTORY_TURNS);
  }
}

/**
 * Start the in-memory eviction interval. Returns the timer handle so the
 * caller (typically index.js bootstrap) can store it if they want — the
 * interval is .unref()'d so it never blocks process exit.
 *
 * Redis enforces its own TTL via EX, so this is only relevant for the
 * local Map when no Redis is configured.
 */
function startEvictionInterval(intervalMs = 60 * 1000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActive > SESSION_TIMEOUT_MS) sessions.delete(id);
    }
  }, intervalMs).unref();
}

module.exports = {
  SESSION_TIMEOUT_MS,
  SESSION_TIMEOUT_SEC,
  MAX_HISTORY_TURNS,
  getSession,
  saveSession,
  clearSession,
  clearAllSessions,
  trimHistory,
  startEvictionInterval,
};
