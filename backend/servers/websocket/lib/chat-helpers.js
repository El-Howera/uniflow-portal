/**
 * lib/chat-helpers.js — Shared helpers for the websocket service.
 *
 * Owns:
 *   - tenantRoom(tenantId, innerKey): builds a tenant-scoped Socket.io room name.
 *   - roomForMessage(msg): derives the inner room key from a ChatMessage row.
 *   - readOnlyChannels: in-memory per-process Map keyed by tenantRoom name.
 *   - userIsModeratorForGroup / userIsModeratorForCourse: permission helpers
 *     used by both REST routes and (indirectly) socket logic.
 *
 * Imported by: socket.js, routes/moderation.routes.js, routes/group.routes.js.
 * No route handlers here — helpers only.
 */

const prisma = require('../../../lib/prisma');

/**
 * Prefix a room key with the tenant id. The result is the Socket.io room
 * name actually joined / broadcast to. Two tenants with the same sectionId /
 * courseCode will produce different room names, so no cross-tenant broadcast
 * is possible.
 *
 * @param {string} tenantId
 * @param {string|null} innerKey  e.g. 'section:abc123' or 'CS101'
 * @returns {string|null}
 */
function tenantRoom(tenantId, innerKey) {
  if (!tenantId) throw new Error('tenantRoom: tenantId required');
  if (!innerKey) return null;
  return `t:${tenantId}:${innerKey}`;
}

/**
 * Pick the live broadcast room key for an existing ChatMessage row. New
 * messages have sectionId set; legacy rows fall back to course-code.
 * Result is the *inner* key — pair with tenantRoom() at the call-site.
 *
 * @param {object} msg ChatMessage DB row (may have .sectionId and .courseCode)
 * @returns {string}
 */
const roomForMessage = (msg) =>
  msg?.sectionId ? `section:${msg.sectionId}` : (msg?.courseCode || '').toUpperCase();

/**
 * Per-course read-only state (in-memory; resets on server restart which is
 * acceptable). Keyed by the *full* tenantRoom string (e.g.
 * 't:tid:section:sectionId') so two tenants can independently lock CS101.
 *
 * @type {Map<string, boolean>}
 */
const readOnlyChannels = new Map();

/**
 * Returns true when the caller can moderate the given chat group. System
 * roles (professor / ta / admin) always pass. Otherwise checks the
 * ChatMember row for the specific group — only `admin`, `professor`, and
 * `ta` chat roles count.
 *
 * @param {string} userId
 * @param {string} systemRole JWT role claim
 * @param {string} chatGroupId
 * @returns {Promise<boolean>}
 */
async function userIsModeratorForGroup(userId, systemRole, chatGroupId) {
  if (['professor', 'ta', 'admin'].includes(systemRole)) return true;
  const member = await prisma.chatMember.findFirst({
    where: { userId, chatGroupId, role: { in: ['admin', 'professor', 'ta'] } },
    select: { role: true },
  });
  return !!member;
}

/**
 * Returns true when the caller can moderate the given course's chat room.
 * System roles (professor / ta / admin) always pass. Otherwise checks the
 * ChatMember row filtered by course code.
 *
 * @param {string} userId
 * @param {string} systemRole JWT role claim
 * @param {string} courseCode
 * @returns {Promise<boolean>}
 */
async function userIsModeratorForCourse(userId, systemRole, courseCode) {
  if (['professor', 'ta', 'admin'].includes(systemRole)) return true;
  const member = await prisma.chatMember.findFirst({
    where: {
      userId,
      role: { in: ['admin', 'professor', 'ta'] },
      chatGroup: { section: { course: { code: courseCode.toUpperCase() } } },
    },
    select: { role: true },
  });
  return !!member;
}

module.exports = {
  tenantRoom,
  roomForMessage,
  readOnlyChannels,
  userIsModeratorForGroup,
  userIsModeratorForCourse,
};
