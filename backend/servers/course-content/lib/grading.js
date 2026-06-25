/**
 * lib/grading.js — Course-Content grading helpers
 *
 * Owns:
 *   - toLetterGrade(score, maxScore, rules) — percent → letter via admin grading scale
 *   - resolveActiveSemester(prisma, opts)   — resolves the current semester for
 *     cascade writes; derives a Semester row from an active RegistrationPeriod name
 *     when the FK isn't set, and optionally lazy-creates the row so the confirm
 *     cascade can land on the right term every time.
 *   - buildCurrentSemesterGradebook(prisma, userId, tenantId) — shared helper used
 *     by /api/me/gradebook/current-semester and /api/admin/users/:id/gradebook/current-semester.
 *   - timeAgo(date) — human-readable elapsed time label for activity feeds.
 *
 * Non-obvious decisions:
 *   - resolveActiveSemester has a 4-step cascade (linked period → name-derived →
 *     CurrentTerm fallback → most-recent) to handle the common dev state where
 *     the admin has a RegistrationPeriod without a linked Semester row.
 *   - buildCurrentSemesterGradebook is exported (not inlined in a route) because
 *     two routes use it: the student self-route and the admin cross-user route.
 *   - getCurrentTenant() is imported lazily (called inside async fns) so it reads
 *     from the per-request AsyncLocalStorage context, not from module-load time.
 */

'use strict';

const { getCurrentTenant } = require('../../../lib/tenant-context');
const _gradingHelpers = require('../../../lib/grading-rules');

// ── timeAgo ──────────────────────────────────────────────────────────────────

function timeAgo(date) {
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Semester name helpers ─────────────────────────────────────────────────────

function _stripPeriodSuffix(name) {
  return (name || '')
    .replace(/\s*registration\s+period\s*$/i, '')
    .replace(/\s*reg\.?\s+period\s*$/i, '')
    .trim();
}

function _deriveAcademicYearFromName(name) {
  const m = (name || '').match(/(\d{4})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const lower = (name || '').toLowerCase();
  if (lower.includes('fall')) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

// ── resolveActiveSemester ─────────────────────────────────────────────────────

/**
 * Resolve the active Semester for grade-cascade writes.
 *
 * Priority:
 *   1. Active RegistrationPeriod with semesterId set (fast path).
 *   2. Active RegistrationPeriod without FK — derive name, optionally create.
 *   3. CurrentTerm fallback (legacy seed pin).
 *   4. Most-recent Semester.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ createIfMissing?: boolean }} opts
 * @returns {Promise<import('@prisma/client').Semester | null>}
 */
async function resolveActiveSemester(prisma, { createIfMissing = false } = {}) {
  try {
    const linked = await prisma.registrationPeriod.findFirst({
      where: { isActive: true, semesterId: { not: null } },
      include: { semesterRef: true },
      orderBy: { startDate: 'desc' },
    });
    if (linked?.semesterRef) return linked.semesterRef;
  } catch { /* */ }

  try {
    const activePeriod = await prisma.registrationPeriod.findFirst({
      where: { isActive: true },
      orderBy: { startDate: 'desc' },
    });
    if (activePeriod) {
      const derivedName = _stripPeriodSuffix(activePeriod.semester || activePeriod.name);
      if (derivedName) {
        let sem = await prisma.semester.findFirst({ where: { name: derivedName } }).catch(() => null);
        if (!sem && createIfMissing) {
          const academicYear = _deriveAcademicYearFromName(derivedName) || 'unknown';
          const code = derivedName.replace(/\s+/g, '').toUpperCase().slice(0, 10);
          sem = await prisma.semester.create({
            data: {
              name: derivedName,
              code,
              academicYear,
              startDate: activePeriod.startDate || new Date(),
              endDate: activePeriod.endDate || new Date(),
            },
          }).catch((err) => {
            console.warn('[resolveActiveSemester] auto-create failed:', err.message);
            return null;
          });
          if (sem) {
            await prisma.registrationPeriod.update({
              where: { id: activePeriod.id },
              data: { semesterId: sem.id },
            }).catch(() => {});
          }
        }
        if (sem) return sem;
        if (!createIfMissing) return { id: null, name: derivedName, virtual: true };
      }
    }
  } catch { /* */ }

  try {
    const ct = await prisma.currentTerm.findFirst({ include: { semester: true } });
    if (ct?.semester) return ct.semester;
  } catch { /* */ }

  // Fall back to ANY registration period (even inactive ones) when no
  // active period exists — without this branch, a tenant that has set
  // up "Spring 2027" but hasn't toggled it active yet had
  // resolveActiveSemester return null and the entire transcript cascade
  // silently no-op'd (the upsert's catch swallowed it, so the user saw
  // a successful release with no transcript row). createIfMissing lazy-
  // creates the semester just like the active-period branch does.
  if (createIfMissing) {
    try {
      const anyPeriod = await prisma.registrationPeriod.findFirst({
        orderBy: { startDate: 'desc' },
      });
      if (anyPeriod) {
        const derivedName = _stripPeriodSuffix(anyPeriod.semester || anyPeriod.name);
        if (derivedName) {
          let sem = await prisma.semester.findFirst({ where: { name: derivedName } }).catch(() => null);
          if (!sem) {
            const academicYear = _deriveAcademicYearFromName(derivedName) || 'unknown';
            const code = derivedName.replace(/\s+/g, '').toUpperCase().slice(0, 10);
            sem = await prisma.semester.create({
              data: {
                name: derivedName,
                code,
                academicYear,
                startDate: anyPeriod.startDate || new Date(),
                endDate: anyPeriod.endDate || new Date(),
              },
            }).catch((err) => {
              console.warn('[resolveActiveSemester] inactive-period auto-create failed:', err.message);
              return null;
            });
            if (sem) {
              await prisma.registrationPeriod.update({
                where: { id: anyPeriod.id },
                data: { semesterId: sem.id },
              }).catch(() => {});
            }
          }
          if (sem) return sem;
        }
      }
    } catch { /* */ }
  }

  try {
    return await prisma.semester.findFirst({ orderBy: { startDate: 'desc' } });
  } catch { /* */ }
  return null;
}

// ── toLetterGrade ─────────────────────────────────────────────────────────────

/**
 * Convert a raw score to a letter grade using the admin grading scale.
 *
 * @param {number|null} score
 * @param {number|null} maxScore
 * @param {object|undefined} rules  - loaded grading rules (optional; falls back to lib default)
 * @returns {string|null}
 */
function toLetterGrade(score, maxScore, rules) {
  if (score == null) return null;
  const max = maxScore != null && parseFloat(maxScore.toString()) > 0
    ? parseFloat(maxScore.toString())
    : 100;
  const percent = (parseFloat(score.toString()) / max) * 100;
  if (rules) return _gradingHelpers.percentToLetter(percent, rules);
  return _gradingHelpers.percentToLetter(percent);
}

// ── buildCurrentSemesterGradebook ────────────────────────────────────────────

/**
 * Build the current-semester gradebook for a given student. Shared between
 * the student self-route and the admin cross-user route.
 *
 * Returns: { courses: [...], semesterName: string|null }
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @returns {Promise<{courses: object[], semesterName: string|null}>}
 */
async function buildCurrentSemesterGradebook(prisma, userId) {
  const regs = await prisma.registration.findMany({
    where: {
      userId,
      isActive: true,
      status: { in: ['approved', 'pending'] },
    },
    include: {
      course: { select: { id: true, code: true, title: true, credits: true } },
      section: { select: { type: true } },
    },
    orderBy: { registeredAt: 'asc' },
  });
  if (regs.length === 0) {
    return { courses: [] };
  }
  const courseMap = new Map();
  for (const r of regs) {
    if (!r.course) continue;
    if (!courseMap.has(r.course.id)) {
      courseMap.set(r.course.id, {
        course: r.course,
        sectionType: r.section?.type ?? null,
        status: r.status,
      });
    }
  }
  let courseList = Array.from(courseMap.values());
  let courseIds = courseList.map((c) => c.course.id);

  if (courseIds.length > 0) {
    // Plan 22 — hide a course from Current Semester only when its
    // FINAL gradebook entry has been RELEASED (releasedById set), not
    // merely transcripted. The old filter `(isConfirmed &&
    // isTranscripted)` caught retakes: a student re-enrolling for a
    // course they previously failed had an old TranscriptCourse row,
    // so any new Confirm action made the filter hide the live course
    // from Current Semester. After this change a retake stays in
    // Current Semester through Confirm, leaves only when Released —
    // which is the entire point of the Confirm/Release split.
    const releasedFinals = await prisma.gradebookEntry.findMany({
      where: {
        studentId: userId,
        courseId: { in: courseIds },
        component: 'final',
        releasedById: { not: null },
      },
      select: { courseId: true },
    });
    const releasedCourseIds = new Set(releasedFinals.map((r) => r.courseId));
    courseList = courseList.filter((c) => !releasedCourseIds.has(c.course.id));
    courseIds = courseList.map((c) => c.course.id);
    if (courseList.length === 0) return { courses: [] };
  }

  const [assignments, quizzes] = await Promise.all([
    prisma.assignment.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.quiz.findMany({
      where: { courseId: { in: courseIds } },
      orderBy: { createdAt: 'asc' },
      include: { questions: { select: { points: true } } },
    }),
  ]);

  const tenantId = getCurrentTenant();
  const quizTotalPointsMap = new Map();
  if (quizzes.length > 0) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT "id", "total_points"
          FROM "quizzes"
         WHERE "id" = ANY(${quizzes.map((q) => q.id)}::text[])
           AND "tenant_id" = ${tenantId}
      `;
      for (const r of rows || []) {
        if (r.total_points != null) {
          quizTotalPointsMap.set(r.id, parseFloat(r.total_points));
        }
      }
    } catch { /* column missing */ }
  }

  const midtermFinalByCourse = new Map();
  try {
    const cfgRows = await prisma.$queryRaw`
      SELECT "course_id", "midterm_max", "final_max", "tenant_id"
        FROM "course_gradebook_config"
       WHERE "course_id" = ANY(${courseIds}::text[])
         AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
       ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
    `;
    for (const r of cfgRows || []) {
      if (midtermFinalByCourse.has(r.course_id)) continue;
      midtermFinalByCourse.set(r.course_id, {
        midtermMax: r.midterm_max ?? 30,
        finalMax: r.final_max ?? 60,
      });
    }
  } catch { /* table not present yet */ }

  const [asgSubs, quizSubs, gbEntries] = await Promise.all([
    assignments.length > 0
      ? prisma.assignmentSubmission.findMany({
          where: { userId, assignmentId: { in: assignments.map((a) => a.id) } },
          select: { assignmentId: true, score: true },
        })
      : [],
    quizzes.length > 0
      ? prisma.quizSubmission.findMany({
          where: { userId, quizId: { in: quizzes.map((q) => q.id) } },
          select: { quizId: true, score: true, status: true },
        })
      : [],
    prisma.gradebookEntry.findMany({
      where: {
        studentId: userId,
        courseId: { in: courseIds },
        component: { in: ['midterm', 'final'] },
      },
      // Pull letterGrade + confirmedAt too so the Current Semester card
      // can show the confirmed letter (Plan 22 Confirm/Release split).
      // Before this, even after Confirm the card showed "IP" because the
      // letter wasn't being threaded through to the renderer.
      select: {
        courseId: true,
        component: true,
        score: true,
        letterGrade: true,
        confirmedAt: true,
        confirmedById: true,
      },
    }),
  ]);

  const asgScore = new Map();
  for (const s of asgSubs) {
    asgScore.set(s.assignmentId, s.score != null ? parseFloat(s.score.toString()) : null);
  }
  const quizScore = new Map();
  for (const s of quizSubs) {
    quizScore.set(s.quizId, {
      score: s.score != null ? parseFloat(s.score.toString()) : null,
      status: s.status,
    });
  }
  const gbScore = new Map();
  // Plan 22 — track the confirmed FINAL letter per course so the response
  // can surface it. A confirmed-but-not-released entry has letterGrade
  // populated + confirmedAt set; the student's Current Semester card
  // reads `finalLetter` and renders that instead of the static "IP" badge.
  const finalLetterByCourse = new Map();
  for (const e of gbEntries) {
    gbScore.set(
      `${e.courseId}:${e.component}`,
      e.score != null ? parseFloat(e.score.toString()) : null,
    );
    if (e.component === 'final' && e.confirmedAt && e.letterGrade) {
      finalLetterByCourse.set(e.courseId, e.letterGrade);
    }
  }

  const asgByCourse = new Map();
  for (const a of assignments) {
    if (!asgByCourse.has(a.courseId)) asgByCourse.set(a.courseId, []);
    asgByCourse.get(a.courseId).push(a);
  }
  const quizByCourse = new Map();
  for (const q of quizzes) {
    if (!quizByCourse.has(q.courseId)) quizByCourse.set(q.courseId, []);
    quizByCourse.get(q.courseId).push(q);
  }

  const out = courseList.map(({ course, sectionType, status }) => {
    const cfg = midtermFinalByCourse.get(course.id) ?? { midtermMax: 30, finalMax: 60 };
    const courseAssignments = asgByCourse.get(course.id) ?? [];
    const courseQuizzes = quizByCourse.get(course.id) ?? [];

    const columns = [
      ...courseAssignments.map((a) => ({
        key: `asg:${a.id}`,
        label: a.title,
        type: 'assignment',
        maxScore: parseFloat(a.maxScore.toString()),
        refId: a.id,
      })),
      ...courseQuizzes.map((q) => {
        const summed = (q.questions || []).reduce(
          (acc, qq) => acc + (qq.points != null ? parseFloat(qq.points.toString()) : 0),
          0,
        );
        const overrideTotal = quizTotalPointsMap.get(q.id) ?? null;
        return {
          key: `quiz:${q.id}`,
          label: q.title,
          type: 'quiz',
          maxScore: overrideTotal ?? (summed > 0 ? summed : 100),
          refId: q.id,
        };
      }),
      { key: 'midterm', label: 'Midterm', type: 'midterm', maxScore: cfg.midtermMax },
      { key: 'final', label: 'Final', type: 'final', maxScore: cfg.finalMax },
    ];

    const scores = {};
    const meta = {};
    for (const a of courseAssignments) {
      scores[`asg:${a.id}`] = asgScore.has(a.id) ? asgScore.get(a.id) : null;
    }
    for (const q of courseQuizzes) {
      const entry = quizScore.get(q.id);
      scores[`quiz:${q.id}`] = entry ? entry.score : null;
      if (entry?.status) {
        meta[`quiz:${q.id}`] = { status: entry.status };
      }
    }
    scores['midterm'] = gbScore.get(`${course.id}:midterm`) ?? null;
    scores['final'] = gbScore.get(`${course.id}:final`) ?? null;

    return {
      courseCode: course.code,
      courseTitle: course.title,
      credits: course.credits,
      sectionType,
      registrationStatus: status,
      columns,
      scores,
      meta,
      // Confirmed final letter — null until the prof confirms. The
      // student-side Current Semester card uses this in place of "IP"
      // once it's populated, so the user sees their actual grade
      // before the registrar releases it to the official transcript.
      finalLetter: finalLetterByCourse.get(course.id) ?? null,
    };
  });

  const activeSem = await resolveActiveSemester(prisma, { createIfMissing: false });
  const semesterName = activeSem?.name || null;

  return { courses: out, semesterName };
}

module.exports = {
  timeAgo,
  toLetterGrade,
  resolveActiveSemester,
  buildCurrentSemesterGradebook,
};
