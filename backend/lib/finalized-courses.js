// finalized-courses.js
//
// Shared filter: a course is "finalized" for a given student when BOTH
//   (a) a GradebookEntry with component='final' has confirmedById set, AND
//   (b) a matching TranscriptCourse row exists for (userId, courseCode).
// The AND is intentional belt-and-suspenders — if either side missing, the
// course is still considered "in progress" so a silent cascade failure
// doesn't hide live work from the student.
//
// Used by:
//   - registration server's /api/registrations/:userId (Current Enrollments)
//   - attendance server's per-student summary / history / today endpoints
//     (so a confirmed course's attendance doesn't surface on the student's
//      attendance page — admin per-course reports stay intact)
//
// Retake-safe: a new registration for a previously-failed course has its
// OWN GradebookEntry; until the new final is confirmed, the AND fails and
// the course shows as in progress, even though the old TranscriptCourse row
// (with the 'F') already exists.
//
// Returns a `Set<courseId>`. Empty when nothing is finalized OR on error
// (fail-open: better to show a finalized course than to silently hide an
// active one).

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {string[]} [candidateCourseIds]   Optional pre-filter — when known,
 *   restricts both queries to this set so we don't scan the whole table.
 * @returns {Promise<Set<string>>}
 */
async function getFinalizedCourseIds(prisma, userId, candidateCourseIds) {
  if (!userId) return new Set();
  try {
    const courseFilter =
      Array.isArray(candidateCourseIds) && candidateCourseIds.length > 0
        ? { courseId: { in: candidateCourseIds } }
        : {};
    const [confirmedFinals, transcriptRows] = await Promise.all([
      prisma.gradebookEntry.findMany({
        where: {
          studentId: userId,
          component: 'final',
          confirmedById: { not: null },
          ...courseFilter,
        },
        select: { courseId: true, course: { select: { code: true } } },
      }),
      prisma.transcriptCourse.findMany({
        where: { userId },
        select: { courseCode: true },
      }),
    ]);

    const transcriptedCodes = new Set(
      transcriptRows.map((r) => (r.courseCode || '').toUpperCase()),
    );
    const finalized = new Set();
    for (const e of confirmedFinals) {
      const code = (e.course?.code || '').toUpperCase();
      if (transcriptedCodes.has(code)) finalized.add(e.courseId);
    }
    return finalized;
  } catch (err) {
    // Fail-open. If we can't compute the set, every consumer behaves as it
    // did pre-filter (showing the course). Better than accidentally hiding
    // active work.
    // eslint-disable-next-line no-console
    console.warn('[finalized-courses] lookup failed:', err.message);
    return new Set();
  }
}

module.exports = { getFinalizedCourseIds };
