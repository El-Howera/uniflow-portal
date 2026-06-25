/**
 * Socket.io setup for the chat server (Firestore-backed).
 *
 * Exports:
 *   - attachSocketIo(httpServer) → wires Socket.io, installs JWT auth
 *     middleware, handles chat:join / chat:message / chat:markRead /
 *     disconnect events. All Firestore writes are tenant-scoped via the
 *     socket's tenantId claim.
 *   - getIo() → the raw Server instance (used by REST routes to broadcast).
 *
 * Room naming: `t:<tenantId>:section:<sectionId>` (see roomKey in
 * lib/firestore-helpers.js). Routes import getIo() and call
 * `getIo().to(roomKey(...)).emit(...)` for broadcasting REST-triggered events.
 *
 * Single-room vs global sockets: per-page chatroom sockets set
 * `auth.scope = 'single-room'` in their handshake and emit `chat:join`
 * explicitly for the active section only. NotificationContext sockets omit
 * the flag → auto-join all section rooms (powers the global new-message chime).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const prisma = require('../../lib/prisma');
const chatSync = require('../../lib/chat-sync');
const { sendPushToUsers } = require('../../lib/push');
const { runWithTenant } = require('../../lib/tenant-context');
const { attachRedisAdapter } = require('../../lib/socket-adapter');

const {
  groupRef,
  memberRef,
  messagesRef,
  roomKey,
  serverTimestamp,
  isFirestoreNotFound,
  markFirestoreDown,
  getDocScoped,
  fetchGroupForTenant,
  shapeMessage,
} = require('./lib/firestore-helpers');
const { getSectionIdsForUser } = require('./lib/staff-groups');

let io = null;

function getIo() {
  return io;
}

/**
 * Wire Socket.io to the given HTTP server. Called once from index.js.
 */
function attachSocketIo(httpServer) {
  io = new Server(httpServer, {
    // Handshake is JWT-based (handshake.auth.token), not cookie-based, so
    // wildcard CORS origin is safe here — the token is the auth mechanism.
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // Multi-replica Pub/Sub bridge (no-op when REDIS_URL is unset). Required
  // for horizontal scaling — without it, a chat:message emitted on one
  // chat-server replica never reaches sockets connected to another.
  attachRedisAdapter(io, 'chat').catch((err) => {
    console.warn('[chat] redis adapter attach error:', err.message);
  });

  // ─── Auth middleware ─────────────────────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userRole = decoded.role;
      // Plan 5 Phase 6 — preserve view-as mode so message-send handlers can
      // reject writes while an admin is impersonating another user.
      socket.userMode = decoded.mode || null;
      // Plan 11 / Phase 2 — every socket must carry a tenantId claim. Tokens
      // issued before the multi-tenant migration won't have one; refuse the
      // connection rather than letting it run in an undefined tenant scope.
      if (!decoded.tenantId) {
        return next(new Error('tenant_claim_missing'));
      }
      socket.tenantId = decoded.tenantId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ─── Connection handler ──────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    console.log(`[chat] socket connected: ${socket.id} user=${socket.userId} tenant=${socket.tenantId}`);

    const tenantId = socket.tenantId;
    const isSingleRoomSocket = socket.handshake.auth?.scope === 'single-room';

    // Auto-join all section rooms for global-scope sockets (powers the chime).
    try {
      if (isSingleRoomSocket) {
        console.log(`[chat]   user=${socket.userId} role=${socket.userRole} single-room socket - skipping auto-join`);
      } else {
        const allIds = await runWithTenant(tenantId, () =>
          getSectionIdsForUser(socket.userId, socket.userRole)
        );
        for (const sid of allIds) {
          socket.join(roomKey(tenantId, sid));
        }
        console.log(
          `[chat]   user=${socket.userId} role=${socket.userRole} tenant=${tenantId} ` +
          `auto-joined ${allIds.length} section room(s)` +
          (allIds.length > 0
            ? ` [${allIds.slice(0, 3).join(', ')}${allIds.length > 3 ? '...' : ''}]`
            : '')
        );
      }
    } catch (err) {
      console.warn(`[chat] auto-join failed for user=${socket.userId}:`, err.message);
    }

    // Plan 5 Phase 5 — staff chat auto-membership.
    try {
      if (!isSingleRoomSocket && socket.userRole && socket.userRole !== 'student') {
        const staffIds = await runWithTenant(tenantId, () =>
          chatSync.ensureStaffGroupMembership(prisma, socket.userId, socket.userRole, tenantId)
        );
        for (const gid of staffIds) {
          socket.join(roomKey(tenantId, gid));
        }
        if (staffIds.length > 0) {
          console.log(`[chat]   user=${socket.userId} role=${socket.userRole} auto-joined staff group(s) [${staffIds.join(', ')}]`);
        }
      }
    } catch (err) {
      console.warn(`[chat] staff-group auto-join failed for user=${socket.userId}:`, err.message);
    }

    // ─── chat:join ──────────────────────────────────────────────────────────
    socket.on('chat:join', async (data = {}) => {
      const { sectionId, userName } = data;
      if (!sectionId) return;

      try {
        const groupSnap = await fetchGroupForTenant(sectionId, tenantId);
        if (!groupSnap) {
          socket.emit('chat:history', { sectionId, messages: [] });
          return;
        }
        socket.join(roomKey(tenantId, sectionId));

        // Fetch last 50 non-deleted messages, oldest first. orderBy('createdAt')
        // only (no where-clause) avoids the composite-index requirement. The
        // parent group was already tenant-verified; in-memory filter is
        // defence-in-depth for stale docs.
        const snap = await messagesRef(sectionId)
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();
        const messages = snap.docs
          .map((doc) => shapeMessage(doc))
          .filter((m) => !m.isDeleted && (!m.tenantId || m.tenantId === tenantId))
          .reverse();
        socket.emit('chat:history', { sectionId, messages });
        console.log(`[chat] ${userName || socket.userId} joined section:${sectionId} t=${tenantId} (${messages.length} msgs)`);
      } catch (err) {
        console.error('chat:join history fetch failed:', err);
        socket.emit('chat:history', { sectionId, messages: [] });
      }
    });

    // ─── chat:message ────────────────────────────────────────────────────────
    /**
     * Send a text/voice/file message to a section room.
     * Flow: verify membership → readOnly gate → persist → bump lastMessageAt
     *       → echo to room with tempId so sender's optimistic bubble settles.
     */
    socket.on('chat:message', async (data = {}) => {
      const { sectionId, message, senderName, senderAvatar, attachment, tempId, mentions } = data;
      if (!sectionId) return;

      // Plan 5 Phase 6 — block sends while impersonating.
      if (socket.userMode === 'view-as') {
        socket.emit('chat:error', {
          tempId,
          error: 'impersonation_read_only',
          message: 'Cannot send while impersonating.',
        });
        return;
      }

      try {
        const groupSnap = await fetchGroupForTenant(sectionId, tenantId);
        if (!groupSnap) return;
        const groupData = groupSnap.data();

        const memberSnap = await getDocScoped(memberRef(sectionId, socket.userId), tenantId);
        const isStaff = ['professor', 'ta', 'admin'].includes(socket.userRole);
        if (!memberSnap && !isStaff) return;

        const role = memberSnap ? memberSnap.get('role') : socket.userRole;
        const callerIsMod = isStaff || ['admin', 'professor', 'ta'].includes(role);
        if (groupData.readOnly && !callerIsMod) return;

        // Normalise mentions to { userIds: string[], hasAll: boolean }.
        const normMentions =
          mentions && typeof mentions === 'object' && !Array.isArray(mentions)
            ? {
                userIds: Array.isArray(mentions.userIds)
                  ? mentions.userIds.filter((x) => typeof x === 'string')
                  : [],
                hasAll: !!mentions.hasAll,
              }
            : Array.isArray(mentions)
            ? { userIds: mentions.filter((x) => typeof x === 'string'), hasAll: false }
            : { userIds: [], hasAll: false };

        const docRef = await messagesRef(sectionId).add({
          tenantId,
          userId: socket.userId,
          senderName: senderName ?? '',
          senderAvatar: senderAvatar ?? null,
          senderRole: role ?? socket.userRole ?? null,
          message: typeof message === 'string' ? message : '',
          sectionId,
          courseCode: groupData.courseCode ?? null,
          status: 'sent',
          pinned: false,
          system: false,
          isDeleted: false,
          deletedById: null,
          attachment: attachment ?? null,
          mentions: normMentions,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await groupRef(sectionId).set(
          { lastMessageAt: serverTimestamp() },
          { merge: true }
        );

        const saved = await docRef.get();
        const room = roomKey(tenantId, sectionId);

        // Telemetry: log subscriber count to help debug the "prof never gets
        // pinged" class of issue. Silently skipped if fetchSockets fails.
        try {
          const subs = await io.in(room).fetchSockets();
          console.log(
            `[chat] broadcast to ${room} — ${subs.length} subscriber(s)` +
              (subs.length > 0 ? ` [${subs.map((x) => x.userId).join(', ')}]` : '')
          );
        } catch { /* telemetry only — ignore */ }

        io.to(room).emit('chat:newMessage', {
          sectionId,
          tempId: tempId ?? null,
          message: shapeMessage(saved),
        });

        // Background push (FCM + Web Push) so members are notified when the
        // PWA / app is CLOSED — the socket emit above only reaches connected
        // clients. Excludes the sender and anyone who muted THIS chat (the
        // per-chat "disable notifications" toggle sets members/{uid}.muted),
        // so muting genuinely suppresses these pushes. Fire-and-forget.
        try {
          const membersSnap = await groupRef(sectionId).collection('members').get();
          const recipientIds = [];
          membersSnap.forEach((m) => {
            if (m.id === socket.userId) return;       // not the sender
            if (m.get('muted') === true) return;      // muted this chat
            recipientIds.push(m.id);
          });
          if (recipientIds.length > 0) {
            const preview =
              typeof message === 'string' && message.trim()
                ? message.trim().slice(0, 120)
                : attachment
                ? '📎 Attachment'
                : 'New message';
            const groupName = groupData.name || groupData.courseCode || 'Course chat';
            runWithTenant(tenantId, async () => {
              // Resolve the sender's FULL name (first + last) server-side so the
              // notification shows the whole name, not just whatever short name
              // the client passed in `senderName`.
              let fullName = senderName || '';
              try {
                const u = await prisma.user.findFirst({
                  where: { id: socket.userId },
                  select: { firstName: true, lastName: true },
                });
                if (u) fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || fullName;
              } catch { /* fall back to senderName */ }
              return sendPushToUsers(prisma, recipientIds, {
                title: `${fullName || 'New message'} · ${groupName}`,
                body: preview,
                data: { type: 'chat', sectionId, courseCode: groupData.courseCode || '' },
              });
            }).catch((e) => console.warn('[chat] push fan-out failed:', e.message));
          }
        } catch (e) {
          console.warn('[chat] push fan-out skipped:', e.message);
        }
      } catch (err) {
        console.error('chat:message failed:', err);
      }
    });

    // ─── chat:markRead ───────────────────────────────────────────────────────
    /**
     * Receiver tells the server they've seen a set of messages. Flips each
     * row's status to 'read' and broadcasts the ids so the sender's bubble
     * upgrades from 1 grey check → 2 purple checks.
     */
    socket.on('chat:markRead', async (data = {}) => {
      const { sectionId, messageIds } = data;
      if (!sectionId || !Array.isArray(messageIds) || messageIds.length === 0) return;

      // Tenant-gate: ensure the section belongs to this socket's tenant.
      const groupSnap = await fetchGroupForTenant(sectionId, tenantId);
      if (!groupSnap) return;

      const updated = [];
      for (const id of messageIds) {
        try {
          const msgRef = messagesRef(sectionId).doc(id);
          const msgSnap = await msgRef.get();
          if (!msgSnap.exists) continue;
          const stored = msgSnap.get('tenantId');
          if (stored && stored !== tenantId) continue;
          await msgRef.set(
            { status: 'read', updatedAt: serverTimestamp() },
            { merge: true }
          );
          updated.push(id);
        } catch {
          // Optimistic id that never persisted — ignore.
        }
      }
      if (updated.length === 0) return;
      io.to(roomKey(tenantId, sectionId)).emit('chat:messagesRead', {
        sectionId,
        messageIds: updated,
      });
    });

    // ─── disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      // No presence map in use. The legacy `users:online` counter was dropped.
      // Re-add here if a future feature needs it.
    });
  });

  return io;
}

module.exports = { attachSocketIo, getIo };
