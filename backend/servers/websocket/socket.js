/**
 * socket.js — Socket.io setup for the websocket (chatroom) service.
 *
 * Owns:
 *   - attachSocketIo(httpServer): wires Socket.io, installs JWT auth
 *     middleware, and registers all chat event handlers.
 *   - getIo(): the raw Server instance for route handlers that need to
 *     broadcast (e.g. moderation routes that emit chat:messageDeleted).
 *
 * Socket events handled:
 *   user:join        — register user, broadcast online count
 *   chat:join        — join section/course room, replay last 50 messages
 *   chat:message     — persist + broadcast a new message
 *   chat:markRead    — mark message ids as read, broadcast confirmation
 *   disconnect       — remove from onlineUsers, update online count
 *
 * Tenant scoping: every socket carries socket.tenantId (from JWT). Room
 * names are tenant-prefixed via tenantRoom() from lib/chat-helpers.js so
 * two tenants with the same sectionId get distinct rooms.
 *
 * Non-obvious: the Prisma client artifact may be stale on Windows (DLL lock
 * blocks `prisma generate`). For the sectionId column the playbook is:
 * typed create (skips sectionId) + raw UPDATE to write it. This matches
 * what Plan-4 phases used on chat:message and system-message paths.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const prisma = require('../../lib/prisma');
const { runWithTenant } = require('../../lib/tenant-context');
const { attachRedisAdapter } = require('../../lib/socket-adapter');
const { tenantRoom } = require('./lib/chat-helpers');

// Active connections: socketId → arbitrary user data supplied by user:join.
const onlineUsers = new Map();

let io = null;

/**
 * Attach Socket.io to the given HTTP server. Returns the Server instance.
 * Must be called once during bootstrap before the server starts listening.
 *
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function attachSocketIo(httpServer) {
  // Socket.io uses wildcard origin intentionally — socket auth is
  // token-based via handshake.auth.token, not cookies.
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Multi-replica Pub/Sub bridge (no-op when REDIS_URL is unset). Without
  // this, two students on different replicas of the chatroom server can't
  // see each other's messages in the same section room.
  attachRedisAdapter(io, 'websocket').catch((err) => {
    console.warn('[websocket] redis adapter attach error:', err.message);
  });

  // ── JWT auth middleware ──────────────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      // Plan 11 / Phase 2 — every socket must carry a tenantId so room
      // names, history queries, and broadcasts are tenant-scoped. Tokens
      // issued before the multi-tenant migration won't have one — refuse
      // rather than open a tenant-undefined socket.
      if (!decoded.tenantId) return next(new Error('tenant_claim_missing'));
      socket.tenantId = decoded.tenantId;
      next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[websocket] socket connected: ${socket.id}`);

    // ── user:join ──────────────────────────────────────────────────────────
    socket.on('user:join', (userData) => {
      onlineUsers.set(socket.id, userData);
      io.emit('users:online', { count: onlineUsers.size });
      console.log(`[websocket] user joined: ${userData.name}`);
    });

    // Room key resolver — every chat operation routes to a section-specific
    // room so messages on Lec01 don't bleed into Sec01 of the same course.
    // Falls back to courseCode for callers that haven't migrated yet.
    // Plan 11 / Phase 2: every key is then tenant-prefixed by tenantRoom().
    const resolveRoomKey = ({ sectionId, courseCode }) => {
      if (sectionId) return `section:${sectionId}`;
      if (courseCode) return courseCode.toUpperCase();
      return null;
    };

    // ── chat:join ──────────────────────────────────────────────────────────
    // Join section chat room (preferred) or course-wide fallback.
    // Every handler runs inside runWithTenant() so the Prisma extension's
    // auto-filter fires on raw and typed reads alike.
    socket.on('chat:join', async (data) =>
      runWithTenant(socket.tenantId, async () => {
        const { courseCode, sectionId, userName } = data;
        const inner = resolveRoomKey({ sectionId, courseCode });
        const room = tenantRoom(socket.tenantId, inner);
        if (!room) return;
        socket.join(room);

        try {
          // Fetch last 50 messages — scoped to sectionId when present so each
          // section sees only its own history. Prisma client may not have the
          // section_id column typed yet (Windows DLL lock); when present we
          // use a raw SQL prefilter to ids.
          let history = [];
          if (sectionId) {
            const idRows = await prisma.$queryRaw`
              SELECT id FROM "chat_messages"
               WHERE "section_id" = ${sectionId}
                 AND "tenant_id" = ${socket.tenantId}
               ORDER BY "created_at" ASC
               LIMIT 50
            `;
            const ids = (idRows || []).map((r) => r.id);
            if (ids.length > 0) {
              history = await prisma.chatMessage.findMany({
                where: { id: { in: ids } },
                orderBy: { createdAt: 'asc' },
                include: { attachments: true },
              });
            }
          } else {
            history = await prisma.chatMessage.findMany({
              where: { courseCode: (courseCode || '').toUpperCase() },
              take: 50,
              orderBy: { createdAt: 'asc' },
              include: { attachments: true },
            });
          }
          socket.emit('chat:history', { courseCode, sectionId, messages: history });
          console.log(
            `[websocket] ${userName} joined ${room} (history: ${history.length})`
          );
        } catch (e) {
          console.error('Failed to fetch chat history:', e);
        }
      })
    );

    // ── chat:message ───────────────────────────────────────────────────────
    // Send a regular message. The room key is sectionId-aware so the legacy
    // course-wide broadcast (where Lec01 saw Sec01 messages) is gone. The
    // sectionId column was added in migration 20260503700000 but the Prisma
    // client artifact may still be stale (Windows DLL lock blocks
    // `prisma generate`); the typed create skips sectionId and a follow-up
    // raw UPDATE writes it. Same playbook the earlier Plan-4 phases used.
    //
    // `attachment` — staff (prof / TA / chat-admin) may include an
    // attachment payload (image / video / audio / document). It rides along
    // in the broadcast so connected clients render the file inline. We
    // don't persist the attachment to DB here (kept transient so a 60 MB
    // video doesn't bloat the row) — a refresh shows the text only.
    socket.on('chat:message', async (data) =>
      runWithTenant(socket.tenantId, async () => {
        const {
          courseCode,
          sectionId,
          userId,
          senderName,
          message,
          senderAvatar,
          attachment,
          tempId,
        } = data;
        const inner = resolveRoomKey({ sectionId, courseCode });
        const room = tenantRoom(socket.tenantId, inner);
        if (!room) return;
        try {
          const savedMsg = await prisma.chatMessage.create({
            data: {
              courseCode: (courseCode || '').toUpperCase(),
              userId,
              senderName,
              senderAvatar,
              message,
              status: 'sent',
            },
          });
          if (sectionId) {
            try {
              await prisma.$executeRaw`
                UPDATE "chat_messages" SET "section_id" = ${sectionId} WHERE id = ${savedMsg.id} AND "tenant_id" = ${socket.tenantId}
              `;
              savedMsg.sectionId = sectionId;
            } catch (e) {
              console.warn('[chat] sectionId write failed:', e.message);
            }
          }
          // Echo `tempId` back so the sender's client can match this real
          // saved row against the optimistic pending one and replace it
          // (status: pending → sent).
          io.to(room).emit('chat:newMessage', {
            courseCode: (courseCode || '').toUpperCase(),
            sectionId: sectionId ?? null,
            tempId: tempId ?? null,
            message: { ...savedMsg, attachment: attachment ?? null },
          });
          // Don't log message body content — privacy. Room + attachment-presence
          // is enough for operational debugging.
          if (process.env.LOG_LEVEL === 'debug') {
            console.log(
              `[websocket] [${room}] message from ${socket.userId || 'anon'} (len=${message?.length ?? 0}${attachment ? ' +attachment' : ''})`
            );
          }
        } catch (e) {
          console.error('Failed to save message:', e);
        }
      })
    );

    // ── chat:markRead ──────────────────────────────────────────────────────
    // Receiver tells the server they've seen one or more messages. We update
    // each row to status='read' and broadcast `chat:messagesRead` to the
    // section room so the SENDER's bubble upgrades from single to double check.
    //
    // Body: { messageIds: string[], sectionId?: string, courseCode?: string }
    //
    // Forgiving — typed Prisma update walks each id one at a time so a
    // single bad id doesn't poison the batch.
    socket.on('chat:markRead', async (data) =>
      runWithTenant(socket.tenantId, async () => {
        const { messageIds, sectionId, courseCode } = data || {};
        if (!Array.isArray(messageIds) || messageIds.length === 0) return;
        const inner = sectionId
          ? `section:${sectionId}`
          : (courseCode || '').toUpperCase() || null;
        const room = tenantRoom(socket.tenantId, inner);
        if (!room) return;
        const updatedIds = [];
        for (const id of messageIds) {
          try {
            await prisma.chatMessage.update({
              where: { id },
              data: { status: 'read' },
            });
            updatedIds.push(id);
          } catch {
            // Ignore — likely an optimistic / temp id that never persisted.
          }
        }
        if (updatedIds.length === 0) return;
        io.to(room).emit('chat:messagesRead', { messageIds: updatedIds });
      })
    );

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      io.emit('users:online', { count: onlineUsers.size });
    });
  });

  return io;
}

/**
 * Returns the live Socket.io Server instance.
 * Route handlers use this to broadcast events after DB mutations.
 *
 * @returns {import('socket.io').Server|null}
 */
function getIo() {
  return io;
}

module.exports = { attachSocketIo, getIo };
