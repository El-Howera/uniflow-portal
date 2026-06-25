/**
 * Staff group helpers for the chat server.
 *
 * Resolves which section IDs a given user should be auto-joined to based on
 * their system role, and ensures staff group membership in Firestore. All
 * Postgres queries are tenant-scoped via the Prisma async-local-storage
 * extension (set before these helpers are called by runWithTenant or by the
 * requireAuth middleware's tenant resolver).
 *
 * Exports:
 *   - getSectionIdsForUser(userId, role) → string[]
 *       Postgres-first lookup: returns every sectionId the user should see.
 *   - ensureMembershipForUser(userId, role, sectionIds) → void
 *       Idempotently writes Firestore group + member docs for the given
 *       sectionIds. On the first NOT_FOUND error it marks Firestore down
 *       and aborts the loop.
 */

const prisma = require('../../../lib/prisma');
const chatSync = require('../../../lib/chat-sync');
const { isFirestoreNotFound, markFirestoreDown } = require('./firestore-helpers');

/**
 * Resolve the set of sectionIds the caller should be a member of.
 *
 *   student   → approved + active registrations
 *   professor → sections where they are the instructor
 *   ta        → CourseSectionTA rows ∪ lab sections where they are instructor
 *   admin     → empty (admin peeks per-group, not via the global list)
 */
async function getSectionIdsForUser(userId, role) {
  if (role === 'student') {
    const regs = await prisma.registration.findMany({
      where: { userId, status: 'approved', isActive: true },
      select: { sectionId: true },
    });
    return [...new Set(regs.map((r) => r.sectionId))];
  }
  if (role === 'professor') {
    const sections = await prisma.courseSection.findMany({
      where: { instructorId: userId },
      select: { id: true },
    });
    return sections.map((s) => s.id);
  }
  if (role === 'ta') {
    const [csTa, instructorSecs] = await Promise.all([
      prisma.courseSectionTA.findMany({ where: { taId: userId }, select: { sectionId: true } }),
      prisma.courseSection.findMany({ where: { instructorId: userId }, select: { id: true } }),
    ]);
    return [...new Set([
      ...csTa.map((r) => r.sectionId),
      ...instructorSecs.map((s) => s.id),
    ])];
  }
  return [];
}

/**
 * Idempotently ensure every section in `sectionIds` has a Firestore chat group
 * doc and that `userId` is recorded as a member. Students use
 * chatSync.addStudentToSectionChat; staff use chatSync.ensureChatGroupForSection
 * (which derives membership from the Postgres section record). On the first
 * Firestore NOT_FOUND (code 5) the function marks Firestore down and bails so
 * every subsequent call in the loop doesn't hit the same grpc retry path.
 */
async function ensureMembershipForUser(userId, role, sectionIds) {
  for (const sid of sectionIds) {
    try {
      if (role === 'student') {
        await chatSync.addStudentToSectionChat(prisma, { userId, sectionId: sid });
      } else {
        await chatSync.ensureChatGroupForSection(prisma, sid);
      }
    } catch (err) {
      if (isFirestoreNotFound(err)) {
        markFirestoreDown(err);
        return;
      }
      console.warn(`[chat] ensureMembership ${role} section ${sid}:`, err.message);
    }
  }
}

module.exports = {
  getSectionIdsForUser,
  ensureMembershipForUser,
};
