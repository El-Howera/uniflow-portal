/**
 * Socket.io setup for the notification service.
 *
 * Exports:
 *   - attachSocketIo(server): wires Socket.io to the given HTTP server,
 *     installs the JWT auth middleware, and tracks live sockets in
 *     userSockets: Map<`${tenantId}:${userId}`, socketId>.
 *   - emitToUser(tenantId, userId, event, payload): convenience for routes
 *     that need to push a live event to a specific user (returns true if
 *     a socket was found, false otherwise).
 *   - getIo(): the raw Server instance for advanced callers (rarely needed).
 *
 * Tenant scoping rationale: keying userSockets by `${tenantId}:${userId}`
 * defends against a future user-id collision across tenants (effectively
 * impossible with cuids but cheap defence). Every emit goes through
 * userSocketKey to read the right entry.
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { attachRedisAdapter } = require('../../lib/socket-adapter');
const log = require('../../lib/logger')('notification');

const JWT_SECRET = process.env.JWT_SECRET || 'uniflow-jwt-secret-key-2024';

const userSockets = new Map();
let io = null;

function userSocketKey(tenantId, userId) {
  if (!tenantId) throw new Error('userSocketKey: tenantId required');
  return `${tenantId}:${userId}`;
}

function attachSocketIo(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  log.info('[notification] Socket.io initialized on port 4009');

  // Multi-replica Pub/Sub bridge (no-op when REDIS_URL is unset).
  // Fire-and-forget — adapter attachment is best-effort; the server still
  // boots if Redis is unreachable, just without cross-replica relaying.
  attachRedisAdapter(io, 'notification').catch((err) => {
    log.warn('[notification] redis adapter attach error:', err.message);
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        if (process.env.LOG_LEVEL === 'debug') {
          log.warn('[notification] socket auth failed: jwt error:', err.message);
        }
        return next(new Error('Authentication error'));
      }
      // Refuse sockets without a tenantId claim (multi-tenant guard). Tokens
      // issued before the multi-tenant migration would otherwise sit in an
      // undefined-tenant slot and receive cross-tenant notifications.
      if (!decoded.tenantId) {
        return next(new Error('tenant_claim_missing'));
      }
      socket.user = decoded;
      socket.tenantId = decoded.tenantId;
      next();
    });
  });

  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    const tenantId = socket.tenantId;
    userSockets.set(userSocketKey(tenantId, userId), socket.id);
    log.info(`[notification] connected: ${userId} t=${tenantId} (${socket.id})`);

    socket.on('disconnect', () => {
      userSockets.delete(userSocketKey(tenantId, userId));
      log.info(`[notification] disconnected: ${userId} t=${tenantId}`);
    });
  });

  return io;
}

function emitToUser(tenantId, userId, event, payload) {
  if (!io) return false;
  const socketId = userSockets.get(userSocketKey(tenantId, userId));
  if (!socketId) return false;
  io.to(socketId).emit(event, payload);
  return true;
}

/**
 * Kick all sockets for a given (tenantId, userId) whose JWT `iat` is
 * strictly less than `minIat`. Used by the cross-browser session-revoke
 * path: when the user re-logs-in elsewhere we fire this from the login
 * handler so any older browser tab/window gets `session:revoked` and
 * disconnects immediately instead of waiting for its 15-min access-token
 * expiry to roll over. iat-based filtering means the new login's own
 * brand-new socket (which connects a beat later) is never kicked.
 *
 * Iterates every active socket because userSockets is a single-slot
 * Map keyed by user — multiple browser instances each have their own
 * underlying Socket.io connection but only the most recent one is in
 * the Map. The full iteration is O(N) but N is total live sockets, so
 * acceptable up to our deployment scale.
 */
function kickStaleSessions(tenantId, userId, minIat) {
  if (!io) return 0;
  let kicked = 0;
  for (const [, socket] of io.sockets.sockets) {
    if (!socket.user) continue;
    if (socket.user.userId !== userId) continue;
    if (socket.tenantId !== tenantId) continue;
    const iat = Number(socket.user.iat || 0);
    if (iat >= Number(minIat)) continue;
    try {
      socket.emit('session:revoked', { reason: 'signed_in_elsewhere' });
      // Small delay so the client has a chance to receive the event
      // before the socket closes — disconnect() is racy with emit().
      setTimeout(() => { try { socket.disconnect(true); } catch { /* ignore */ } }, 50);
      kicked += 1;
    } catch { /* ignore individual failures */ }
  }
  return kicked;
}

function getIo() {
  return io;
}

module.exports = {
  attachSocketIo,
  emitToUser,
  kickStaleSessions,
  getIo,
  userSocketKey,
};
