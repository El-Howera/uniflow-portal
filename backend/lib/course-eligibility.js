/**
 * Course-eligibility helper — single source of truth for the prerequisite,
 * level-gate, and semester-lock rules that govern student course registration.
 *
 * The same rules drive three call-sites:
 *   1. GET /api/courses          — hide locked courses, badge level-gated ones.
 *   2. GET /api/courses/:code    — 403 the detail page when not visible.
 *   3. POST /api/registrations/register — block hard-fail cases (prereqs / semester),
 *                                          force pending status when level-gated.
 *
 * Non-student callers (admin, professor, ta, sa) are NEVER subject to this gate;
 * the catalog/detail handlers branch on req.user.role and skip the helper for
 * staff. Keeping that decision at the handler layer (instead of leaking it into
 * the helper) means the helper has one job and is unit-testable in isolation.
 *
 * Performance: the catalog query iterates over many courses, so callers should
 * `precomputeContext(prisma, userId)` once and pass the result via opts to
 * every evaluateCourse() call. Without opts, evaluateCourse() falls back to
 * lazy per-call DB reads — fine for a single-course detail/register handler.
 */

const { letterToPoints, getGradingRules } = require('./grading-rules');
const { getLevelProgression, computeLevel } = require('./level-progression');

/**
 * Pull the term name ('Fall' | 'Spring' | 'Summer') out of a SystemSettings
 * `currentSemester` string like "Fall 2025" or "Summer 2026". Returns null if
 * the string doesn't match a known term keyword — caller treats null as "no
 * lock active", so an unrecognised stored value safely falls back to allowing
 * registration rather than blocking it.
 */
function extractTermName(currentSemester) {
  if (!currentSemester || typeof currentSemester !== 'string') return null;
  if (/fall/i.test(currentSemester)) return 'Fall';
  if (/spring/i.test(currentSemester)) return 'Spring';
  if (/summer/i.test(currentSemester)) return 'Summer';
  return null;
}

/**
 * One-shot context fetch for the catalog handler. Returns three pieces:
 *   - passedTranscript: Map<courseCode, gradeLetter>  — only F is excluded
 *     from the map; all other letters (including non-scoring W/I/etc.) are
 *     included so the per-prereq min-grade comparison can decide. Caveat:
 *     non-scoring letters all have qualityPoints=0, so they will fail any
 *     min-grade comparison against a real letter. That's the desired behavior:
 *     a "W" doesn't satisfy a "must pass with C" requirement.
 *   - userLevel: number | null
 *   - currentSemester: 'Fall' | 'Spring' | 'Summer' | null
 *   - rules: the active grading rules (so letterToPoints uses the same scale
 *     the rest of the system does)
 */
async function precomputeContext(prisma, userId) {
  const [transcripts, profile, settings, rules, progression] = await Promise.all([
    prisma.transcriptCourse.findMany({
      where: { userId },
      select: { courseCode: true, grade: true },
    }),
    prisma.academicProfile.findUnique({
      where: { userId },
      select: { level: true, completedCredits: true, totalCredits: true, department: true },
    }),
    prisma.systemSettings.findFirst({
      select: { currentSemester: true },
    }),
    getGradingRules(prisma),
    getLevelProgression(prisma),
  ]);

  // Build courseCode → best-grade map. If a student retook a course we want
  // the highest letter (best attempt). Walk all rows and keep the one with
  // the most quality points.
  const passedTranscript = new Map();
  for (const t of transcripts) {
    const existing = passedTranscript.get(t.courseCode);
    if (!existing) {
      passedTranscript.set(t.courseCode, t.grade);
    } else {
      const a = letterToPoints(existing, rules);
      const b = letterToPoints(t.grade, rules);
      if (b > a) passedTranscript.set(t.courseCode, t.grade);
    }
  }

  // Effective level — driven by the credit-hour thresholds, not the stored
  // AcademicProfile.level (which can drift between transcript writes). When
  // the profile is missing entirely we fall back to null (no gate).
  // completedCredits is the canonical "earned hours" counter; totalCredits is
  // a defensive fallback for older rows where the field was the only one set.
  let userLevel = null;
  if (profile) {
    const earned = profile.completedCredits ?? profile.totalCredits ?? 0;
    userLevel = computeLevel(earned, progression);
  }

  // Department lock — resolve the student's free-text `department` string
  // (stored on AcademicProfile) to a Department.id so the catalog filter
  // can do a clean ID comparison against the course's primary department +
  // cross-listed M:N rows. Empty/unknown department resolves to null, which
  // FAILS OPEN (student sees everything) so an unmigrated/legacy student
  // record doesn't accidentally hide their entire catalog.
  let studentDepartmentId = null;
  if (profile?.department && profile.department.trim().length > 0) {
    const dept = await prisma.department.findFirst({
      where: {
        OR: [
          { name: profile.department },
          { code: profile.department },
        ],
      },
      select: { id: true },
    });
    if (dept) studentDepartmentId = dept.id;
  }

  return {
    passedTranscript,
    userLevel,
    studentDepartmentId,
    currentSemester: extractTermName(settings?.currentSemester ?? null),
    rules,
  };
}

/**
 * Evaluate a single course against the student's record.
 *
 * @param {object} prisma - the singleton (used only when opts.* are missing)
 * @param {string} userId - cuid
 * @param {object} course - Prisma Course row, MUST be queried with
 *                          include: { prereqFor: { include: { prerequisiteCourse: true } } }
 *                          NOTE: the schema relation is named `prereqFor` (the rows where
 *                          THIS course is the requirer — i.e. its outgoing prereq edges,
 *                          which is what "this course's prerequisites" semantically is).
 *                          The other relation, `Course.prerequisites`, returns dependents
 *                          (courses that require this one) and must NOT be used here.
 * @param {object} [opts]
 * @param {Map<string,string>} [opts.passedTranscript] - courseCode → grade letter
 * @param {number|null}        [opts.userLevel]
 * @param {'Fall'|'Spring'|'Summer'|null} [opts.currentSemester]
 * @param {object}             [opts.rules] - grading rules (for letterToPoints)
 *
 * @returns {Promise<{
 *   visible: boolean,
 *   levelGate: boolean,
 *   missingPrereqs: Array<{ code: string, title: string, minGrade: string }>,
 *   semesterLocked: boolean,
 *   prerequisitesDisplay: Array<{ code: string, title: string, minGrade: string }>,
 * }>}
 */
async function evaluateCourse(prisma, userId, course, opts = {}) {
  // ── Lazy-fetch any missing context. The catalog handler should always pass
  //    everything; detail/register handlers may pass nothing.
  let passedTranscript = opts.passedTranscript;
  let userLevel = opts.userLevel;
  let studentDepartmentId = opts.studentDepartmentId;
  let currentSemester = opts.currentSemester;
  let rules = opts.rules;

  if (!passedTranscript || userLevel === undefined || studentDepartmentId === undefined || currentSemester === undefined || !rules) {
    const ctx = await precomputeContext(prisma, userId);
    if (!passedTranscript) passedTranscript = ctx.passedTranscript;
    if (userLevel === undefined) userLevel = ctx.userLevel;
    if (studentDepartmentId === undefined) studentDepartmentId = ctx.studentDepartmentId;
    if (currentSemester === undefined) currentSemester = ctx.currentSemester;
    if (!rules) rules = ctx.rules;
  }

  // Display list — full prereq set, used by both visible and hidden courses
  // so the frontend can render a tooltip even when filtering happens server-side.
  // NOTE: `course.prereqFor` is the array of CoursePrerequisite rows where THIS
  // course is the requirer — i.e. the courses that must be passed BEFORE it.
  // (The misleadingly-named `course.prerequisites` relation returns dependents.)
  const prerequisitesDisplay = (course.prereqFor || []).map((p) => ({
    code: p.prerequisiteCourse?.code ?? '',
    title: p.prerequisiteCourse?.title ?? '',
    minGrade: p.minGrade ?? 'D',
  }));

  // ── Step 0: Department lock. Students only see courses owned by their
  //    department OR cross-listed to it via CourseDepartment. Fails OPEN
  //    when the student has no resolved department OR the course has no
  //    primary department (legacy rows) so legacy data + new students
  //    don't accidentally see an empty catalog.
  if (studentDepartmentId && course.departmentId) {
    const crossListed = (course.crossListedDepartments || []).map((cd) => cd.departmentId);
    const allowedDepartmentIds = new Set([course.departmentId, ...crossListed]);
    if (!allowedDepartmentIds.has(studentDepartmentId)) {
      return {
        visible: false,
        levelGate: false,
        missingPrereqs: [],
        semesterLocked: false,
        departmentLocked: true,
        prerequisitesDisplay,
      };
    }
  }

  // ── Step 1: Semester lock. Course bound to a different term → invisible.
  //    null on either side means "no lock applies" (allow). This matches
  //    the admin UX where leaving the field blank means "any term".
  //    Both sides go through extractTermName so the comparison is tolerant
  //    of either format — admins sometimes type "Spring 2026" (full string)
  //    and sometimes "Spring", and the seed historically stored full
  //    strings. extractTermName returns null when the input doesn't match
  //    a term keyword, in which case we fall back to a literal compare.
  if (course.semester && currentSemester) {
    const courseTerm = extractTermName(course.semester) ?? course.semester;
    if (courseTerm !== currentSemester) {
      return {
        visible: false,
        levelGate: false,
        missingPrereqs: [],
        semesterLocked: true,
        departmentLocked: false,
        prerequisitesDisplay,
      };
    }
  }

  // ── Step 2: Prerequisite check. For each prereq, default to 'D' if minGrade
  //    is null (FCDS lowest passing). Compare via letterToPoints so the active
  //    grading scale drives the decision — a 'C' satisfies a 'C-' requirement.
  const missingPrereqs = [];
  for (const p of course.prereqFor || []) {
    const prereqCode = p.prerequisiteCourse?.code;
    const prereqTitle = p.prerequisiteCourse?.title ?? '';
    const requiredLetter = p.minGrade || 'D';
    if (!prereqCode) continue;

    const studentLetter = passedTranscript.get(prereqCode);
    if (!studentLetter) {
      missingPrereqs.push({ code: prereqCode, title: prereqTitle, minGrade: requiredLetter });
      continue;
    }

    const studentPoints = letterToPoints(studentLetter, rules);
    const requiredPoints = letterToPoints(requiredLetter, rules);
    if (studentPoints < requiredPoints) {
      missingPrereqs.push({ code: prereqCode, title: prereqTitle, minGrade: requiredLetter });
    }
  }

  if (missingPrereqs.length > 0) {
    return {
      visible: false,
      levelGate: false,
      missingPrereqs,
      semesterLocked: false,
      departmentLocked: false,
      prerequisitesDisplay,
    };
  }

  // ── Step 3: Level gate. visible=true; flag levelGate so the frontend can
  //    badge it and the register handler can route via the SA priority queue.
  //    Per owner directive (2026-05-17): level is NOT a hard block. A
  //    level-1 student who has cleared prereqs + is not on probation CAN
  //    register for a level-2 course — it just enters pending so SA can
  //    confirm priority (course-level students take seats first). The
  //    pending-row creation is handled by the registration handler reading
  //    this `levelGate` flag.
  //    null on course.level OR userLevel = no gate (allow without pending).
  let levelGate = false;
  if (course.level != null && userLevel != null && userLevel < course.level) {
    levelGate = true;
  }

  return {
    visible: true,
    levelGate,
    missingPrereqs: [],
    semesterLocked: false,
    departmentLocked: false,
    prerequisitesDisplay,
  };
}

module.exports = {
  evaluateCourse,
  precomputeContext,
  extractTermName,
};
