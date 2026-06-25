/**
 * Phase 11 — transcript cascade helper.
 *
 * When an admin overrides a final grade for a student in a course, the change
 * has to ripple into:
 *   1. The matching `TranscriptCourse` row (new grade + qualityPoints)
 *   2. The corresponding `SemesterGpa` (recomputed from all the user's
 *      transcript rows in that semester)
 *   3. The user's `AcademicProfile.gpa` (cumulative, recomputed from every
 *      `SemesterGpa` row they have)
 *
 * This helper centralises that ripple so it can't drift between callers.
 *
 * Usage:
 *   const { applyTranscriptOverride } = require('../../lib/transcript-cascade');
 *   await applyTranscriptOverride(prisma, {
 *     userId, courseCode, newLetter, semesterName, // or semesterId
 *   });
 */

const { getGradingRules, letterToPoints } = require('./grading-rules');
const { getRepetitionPolicy, applyRetakePolicy } = require('./repetition-policy');
const { getIncompletePolicy, validateIncompleteFiling } = require('./incomplete-policy');
const { evaluateStanding, evaluateHonors, getHonorsPolicy } = require('./academic-standing');

/**
 * Plan 4 Phase 4 — apply the repetition policy (FCDS Article 18) to a
 * user's full transcript. Returns a Map<rowId, effectiveQp> and
 * Map<rowId, effectiveCredits>: rows the policy SAYS should count get a
 * positive qp + their credits; rows the policy drops get 0 / 0.
 *
 * Per-semester GPA does NOT use this — that GPA is "what was earned in this
 * semester" and is computed from the raw rows. The policy only re-shapes
 * cumulative GPAs (per-semester rolling cumulative + AcademicProfile.gpa).
 */
async function getEffectiveQp(prisma, userId, opts) {
  const onlyEarliestSemesterIds = opts?.throughSemesterIds; // optional Set<id>

  const rows = await prisma.transcriptCourse.findMany({
    where: { userId },
    select: { id: true, semesterId: true, courseCode: true, credits: true, grade: true },
  });
  if (rows.length === 0) {
    return { effectiveQp: new Map(), effectiveCredits: new Map() };
  }
  const semesters = await prisma.semester.findMany({
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const semOrder = new Map(semesters.map((s, i) => [s.id, i]));

  const policy = await getRepetitionPolicy(prisma);
  const rules = await getGradingRules(prisma);

  // Group by courseCode, sorted chronologically by semester order.
  const byCourse = new Map();
  for (const r of rows) {
    if (onlyEarliestSemesterIds && !onlyEarliestSemesterIds.has(r.semesterId)) continue;
    if (!byCourse.has(r.courseCode)) byCourse.set(r.courseCode, []);
    byCourse.get(r.courseCode).push(r);
  }

  const effectiveQp = new Map();
  const effectiveCredits = new Map();
  for (const [, attempts] of byCourse) {
    attempts.sort((a, b) => (semOrder.get(a.semesterId) ?? 0) - (semOrder.get(b.semesterId) ?? 0));
    const effective = applyRetakePolicy(attempts, policy, rules);
    const effectiveById = new Map(effective.map((e) => [e.id, e]));
    for (const a of attempts) {
      const e = effectiveById.get(a.id);
      if (e) {
        effectiveQp.set(a.id, e.qualityPoints);
        effectiveCredits.set(a.id, a.credits);
      } else {
        effectiveQp.set(a.id, 0);
        effectiveCredits.set(a.id, 0);
      }
    }
  }
  return { effectiveQp, effectiveCredits };
}

/**
 * Resolve the Semester row for an override. Caller can pass `semesterId`
 * directly (best); otherwise we look up by `semesterName` (e.g. "Fall 2025");
 * otherwise we fall back to the SystemSettings.currentSemester.
 */
async function resolveSemester(prisma, { semesterId, semesterName }) {
  if (semesterId) {
    const s = await prisma.semester.findUnique({ where: { id: semesterId } });
    if (s) return s;
  }
  if (semesterName) {
    // findFirst (not findUnique): Semester.name is unique only within a tenant
    // (@@unique([tenantId, name])), so the tenant extension must inject tenantId.
    const s = await prisma.semester.findFirst({ where: { name: semesterName } });
    if (s) return s;
  }
  // Fallback: current term from SystemSettings.
  const sys = await prisma.systemSettings.findFirst({ select: { currentSemester: true } });
  if (sys?.currentSemester) {
    const s = await prisma.semester.findFirst({ where: { name: sys.currentSemester } });
    if (s) return s;
  }
  // Final fallback: the most recent semester in the DB.
  return prisma.semester.findFirst({ orderBy: { createdAt: 'desc' } });
}

/**
 * Recompute the SemesterGpa row for a given user/semester from all of their
 * TranscriptCourse rows in that semester. Idempotent.
 *
 * IMPORTANT: TranscriptCourse.qualityPoints stores the TOTAL quality points
 * the course contributes (= qp_per_credit × credits), not the per-credit
 * value. The seed and `backfill-grade-breakdowns.js` follow this convention,
 * and the column is Decimal(3,1) which can't fit per-credit precision (3.666
 * etc.) anyway. So GPA = sum(qualityPoints) / sum(credits) — no double-
 * multiplying by credits.
 */
async function recomputeSemesterGpa(prisma, userId, semesterId) {
  // Per-semester GPA is computed from RAW rows (no policy). A student's
  // Fall 2025 GPA reflects what they earned in Fall 2025, period.
  const rows = await prisma.transcriptCourse.findMany({
    where: { userId, semesterId },
    select: { credits: true, qualityPoints: true },
  });
  const totalCredits = rows.reduce((s, r) => s + (r.credits ?? 0), 0);
  const totalQp = rows.reduce(
    (s, r) => s + (Number(r.qualityPoints) || 0),
    0,
  );
  const gpa = totalCredits > 0 ? totalQp / totalCredits : 0;
  // Round to 2dp for the Decimal(3,2) column.
  const gpaR = Math.round(gpa * 100) / 100;

  // Compute cumulative through this semester (ordered by Semester.startDate
  // ascending — fall back to createdAt if startDate is null).
  const allSemesters = await prisma.semester.findMany({
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const order = new Map(allSemesters.map((s, i) => [s.id, i]));
  const idx = order.get(semesterId);
  const earlierIds = allSemesters
    .slice(0, (idx ?? 0) + 1)
    .map((s) => s.id);

  // Plan 4 Phase 4 — cumulative GPA uses the repetition policy's "effective"
  // rows so retakes drop the originals (within cap) per FCDS Article 18.
  const cumRows = await prisma.transcriptCourse.findMany({
    where: { userId, semesterId: { in: earlierIds } },
    select: { id: true, credits: true, qualityPoints: true },
  });
  const { effectiveQp, effectiveCredits } = await getEffectiveQp(prisma, userId, {
    throughSemesterIds: new Set(earlierIds),
  });
  const cumCredits = cumRows.reduce(
    (s, r) => s + (effectiveCredits.get(r.id) ?? 0),
    0,
  );
  const cumQp = cumRows.reduce(
    (s, r) => s + (Number(effectiveQp.get(r.id)) || 0),
    0,
  );
  const cum = cumCredits > 0 ? cumQp / cumCredits : 0;
  const cumR = Math.round(cum * 100) / 100;

  await prisma.semesterGpa.upsert({
    where:  { userId_semesterId: { userId, semesterId } },
    update: { gpa: gpaR, credits: totalCredits, cumulativeGpa: cumR },
    create: {
      userId,
      semesterId,
      gpa: gpaR,
      credits: totalCredits,
      cumulativeGpa: cumR,
    },
  });

  return { gpa: gpaR, cumulativeGpa: cumR, credits: totalCredits };
}

/**
 * Recompute AcademicProfile.gpa (cumulative across every TranscriptCourse the
 * user has). Different from per-semester cumulative because it includes ALL
 * semesters, not just up-to-and-including a target semester.
 */
async function recomputeAcademicGpa(prisma, userId) {
  const rows = await prisma.transcriptCourse.findMany({
    where: { userId },
    select: { id: true, credits: true, qualityPoints: true, grade: true },
  });
  // Plan 4 Phase 4 — apply the repetition policy. Rows the policy drops
  // contribute 0 / 0; survivors contribute their effective credits + qp.
  const { effectiveQp, effectiveCredits } = await getEffectiveQp(prisma, userId);

  const totalCredits = rows.reduce(
    (s, r) => s + (effectiveCredits.get(r.id) ?? 0),
    0,
  );
  const totalQp = rows.reduce(
    (s, r) => s + (Number(effectiveQp.get(r.id)) || 0),
    0,
  );
  const gpa = totalCredits > 0 ? totalQp / totalCredits : 0;
  const gpaR = Math.round(gpa * 100) / 100;

  // completedCredits = sum of credits from PASSING rows in the effective
  // set (a failed attempt that survives policy still doesn't grant credits).
  const rules = await getGradingRules(prisma);
  const passingLetters = new Set(
    rules.scale.filter((r) => !r.nonScoring && Number(r.qualityPoints) >= 1).map((r) => r.letter),
  );
  const completedCredits = rows.reduce((s, r) => {
    const eff = effectiveCredits.get(r.id) ?? 0;
    if (eff > 0 && passingLetters.has(r.grade)) return s + eff;
    return s;
  }, 0);

  await prisma.academicProfile.update({
    where: { userId },
    data:  { gpa: gpaR, completedCredits },
  }).catch(() => {
    // No academic profile? Nothing to roll up to. Override still went through.
  });

  // Plan 4 Phase 5 — evaluate standing + honors and persist to AcademicProfile.
  // Failures here don't roll back the GPA write; standing is best-effort.
  try {
    await applyStandingAndHonors(prisma, userId, rules);
  } catch (err) {
    console.warn('[cascade] standing/honors update failed:', err.message);
  }

  return { gpa: gpaR, totalCredits, completedCredits };
}

/**
 * Plan 4 Phase 5 — evaluate academic standing (FCDS Article 19) and honors
 * eligibility (Article 22) for a user, then write both to academic_profiles
 * via raw SQL (the columns are new and the Prisma client may not know them
 * yet on Windows DLL-locked envs).
 */
async function applyStandingAndHonors(prisma, userId, gradingRules) {
  const rules = gradingRules || (await getGradingRules(prisma));
  const honorsPolicy = await getHonorsPolicy(prisma);

  // Pull all SemesterGpa rows in chronological order. semesters table is the
  // anchor — sort by startDate then createdAt.
  const allSemesters = await prisma.semester.findMany({
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  const semOrder = new Map(allSemesters.map((s, i) => [s.id, i]));
  const gpaRows = await prisma.semesterGpa.findMany({
    where: { userId },
    select: { semesterId: true, gpa: true, cumulativeGpa: true, semester: { select: { name: true } } },
  });
  const sortedSemesters = gpaRows
    .map((r) => ({
      semesterId:     r.semesterId,
      semesterIdx:    semOrder.get(r.semesterId) ?? 0,
      perSemesterGpa: Number(r.gpa) || 0,
      cumulativeGpa:  Number(r.cumulativeGpa) || 0,
      isMain:         !/summer/i.test(r.semester?.name || ''),
    }))
    .sort((a, b) => a.semesterIdx - b.semesterIdx);

  const standingPolicy = rules?.academicStanding || {};
  const standing = evaluateStanding(sortedSemesters, standingPolicy);

  // Honors: pull every transcript letter the student has earned (across all
  // attempts — disqualifying grades on any single row is enough).
  const allLetters = (await prisma.transcriptCourse.findMany({
    where: { userId },
    select: { grade: true },
  })).map((r) => r.grade);
  const honors = evaluateHonors(
    {
      semesters: sortedSemesters,
      allLetters,
      hasDisciplinary: false, // No disciplinary table yet — see Phase 5 risks.
      highHonorsFromRules: Number(rules?.academicStanding?.highHonorsGpaAbove) || 3.85,
    },
    honorsPolicy,
  );

  // Raw SQL — columns added by migration `20260502000000_phase5_academic_standing_honors_policy`
  // may not be on the regenerated Prisma client yet (Windows DLL lock playbook).
  // `academic_profiles` has no `updated_at` column (the Prisma model
  // omits @updatedAt), so the SET list stops at the standing/honors
  // fields. Writing updated_at fails with 42703 against the live DB.
  await prisma.$executeRaw`
    UPDATE academic_profiles
    SET academic_standing = ${standing},
        honors_eligible   = ${honors}
    WHERE user_id = ${userId}
  `.catch(() => {
    // No academic profile row exists for this user — silently skip; the
    // gpa update earlier already used .catch(() => {}) on the same row.
  });

  return { standing, honors };
}

/**
 * Master cascade. Updates `TranscriptCourse` + recomputes everything down-
 * stream. Idempotent — calling twice with the same letter is a no-op aside
 * from the recompute writes.
 *
 * Returns { transcriptCourse, semesterGpa, academicGpa } so the API can echo
 * the post-cascade values back to the admin UI.
 */
async function applyTranscriptOverride(prisma, args) {
  const {
    userId,
    courseCode,
    newLetter,
    semesterId,
    semesterName,
  } = args;

  const code = String(courseCode).toUpperCase();

  // 1. Resolve course + semester
  // findFirst (not findUnique): Course.code is unique only within a tenant
  // (@@unique([tenantId, code])), so the tenant extension must inject tenantId.
  const course = await prisma.course.findFirst({ where: { code } });
  if (!course) {
    throw Object.assign(new Error(`Course ${code} not found`), { statusCode: 404 });
  }
  const semester = await resolveSemester(prisma, { semesterId, semesterName });
  if (!semester) {
    throw Object.assign(new Error('Semester unresolved — pass semesterId or semesterName'), { statusCode: 400 });
  }

  // 1b. Plan 4 Phase 4 — Incomplete-grade gate (FCDS Article 17). When the
  //     admin is filing an `I` letter, validate the student's term-work has
  //     cleared the policy threshold AND the user hasn't exceeded the
  //     career-wide cap on incompletes. Skip when not filing an I.
  if (newLetter === 'I') {
    const incompletePolicy = await getIncompletePolicy(prisma);
    // Pull existing 'I' count + the breakdown rows for this course (if a row
    // already exists; new rows have no breakdown yet, so admins filing I
    // for a row not yet in the transcript will skip the term-work check —
    // term-work is enforced when grade data exists, not before).
    const [existingIncompletes, currentRow] = await Promise.all([
      prisma.transcriptCourse.count({ where: { userId, grade: 'I' } }),
      // The unique key is now (userId, semesterId, courseCode, attemptNumber)
      // since retakes get their own row. An override edits the latest attempt,
      // so grab the highest attemptNumber for this (user, semester, course).
      prisma.transcriptCourse.findFirst({
        where: { userId, semesterId: semester.id, courseCode: code },
        orderBy: { attemptNumber: 'desc' },
        include: { breakdowns: true },
      }),
    ]);
    // If the existing row was already an 'I', it doesn't double-count toward the cap.
    const adjusted = currentRow?.grade === 'I'
      ? Math.max(0, existingIncompletes - 1)
      : existingIncompletes;
    const result = validateIncompleteFiling(
      { existingIncompletes: adjusted, breakdowns: currentRow?.breakdowns || [] },
      incompletePolicy,
    );
    if (!result.ok) {
      const err = new Error(result.details?.message || 'Incomplete filing rejected by policy.');
      err.statusCode = 400;
      err.details = result;
      throw err;
    }
  }

  // 2. Compute the TOTAL quality points the row should carry.
  //    Convention: qualityPoints stores qp_per_credit × credits. The seed and
  //    backfill scripts follow this, and the column is Decimal(3,1) which
  //    can't hold per-credit precision (3.666 etc.) anyway.
  const rules = await getGradingRules(prisma);
  const qpPerCredit = letterToPoints(newLetter, rules);
  const qpTotal = Math.round(qpPerCredit * course.credits * 10) / 10;

  // 3. Write the TranscriptCourse row.
  //    The unique key is now (userId, semesterId, courseCode, attemptNumber) —
  //    retakes create their own rows. An ADMIN OVERRIDE corrects an existing
  //    grade, so it must edit the LATEST attempt rather than spawn a new one.
  //    Find the highest-attempt row for this (user, semester, course); update
  //    it if present, otherwise create attempt 1.
  const existingRow = await prisma.transcriptCourse.findFirst({
    where: { userId, semesterId: semester.id, courseCode: code },
    orderBy: { attemptNumber: 'desc' },
    select: { id: true },
  });
  const transcriptCourse = existingRow
    ? await prisma.transcriptCourse.update({
        where: { id: existingRow.id },
        data: { grade: newLetter, qualityPoints: qpTotal },
      })
    : await prisma.transcriptCourse.create({
        data: {
          userId,
          semesterId: semester.id,
          courseCode: code,
          courseTitle: course.title,
          credits: course.credits,
          grade: newLetter,
          qualityPoints: qpTotal,
          attemptNumber: 1,
        },
      });

  // 4. Refresh GradeBreakdown rows so the transcript drilldown matches the
  //    new letter. We don't try to redistribute marks across the existing
  //    components (that would falsify the recorded scores); instead we
  //    upsert a single "Override" row that shows the admin-applied letter +
  //    its quality-point contribution. Replaces any prior Override rows so
  //    re-overriding is idempotent.
  await prisma.gradeBreakdown.deleteMany({
    where: { transcriptCourseId: transcriptCourse.id, categoryTitle: 'Override' },
  });
  await prisma.gradeBreakdown.create({
    data: {
      transcriptCourseId: transcriptCourse.id,
      categoryTitle: 'Override',
      componentName: 'Final Grade (Admin Override)',
      grade: newLetter,
      weight: `${course.credits} cr`,
      contribution: `${qpTotal} quality points`,
    },
  });

  // 5. Recompute downstream rolls
  const semesterGpa = await recomputeSemesterGpa(prisma, userId, semester.id);
  const academicGpa = await recomputeAcademicGpa(prisma, userId);

  return {
    transcriptCourse,
    semesterGpa,
    academicGpa,
    semester,
  };
}

module.exports = {
  applyTranscriptOverride,
  recomputeSemesterGpa,
  recomputeAcademicGpa,
  resolveSemester,
  applyStandingAndHonors,
  getEffectiveQp,
};
