/**
 * routes/grade-confirmation.routes.js — Plan 7 Phase 1 professor confirmation gate
 *
 * Owns:
 *   POST /api/grades/:courseCode/:studentId/confirm       — confirm final grade + cascade
 *   POST /api/grades/:courseCode/:studentId/confirm-mid  — confirm midterm grade
 *   POST /api/grades/:courseCode/confirm-all             — bulk-confirm all finals
 *   POST /api/grades/:courseCode/confirm-mid-all         — bulk-confirm all midterms
 *
 * confirmGradeEntry (shared helper) is defined here and used by all four endpoints:
 *   - For finals: upsert entry → compute letter → upsert TranscriptCourse → mirror
 *     GradeBreakdown rows → recomputeAcademicGpa → applyStandingAndHonors → notify.
 *   - For midterms: upsert entry + notify only (no GPA ripple).
 *
 * Non-obvious decisions:
 *   - resolveActiveSemester is used (not CurrentTerm) so the transcript row lands
 *     on the semester the admin has open in Registration Control, not the legacy seed.
 *   - GradeBreakdown rows are mirrored at confirm time so the historical transcript
 *     card shows the same component-level detail as the Current Semester view.
 *   - cfgMidtermMax/cfgFinalMax prefer course_gradebook_config over
 *     GradebookEntry.maxScore because the schema default is 100 and overrides the
 *     prof's configured 25/50 values silently.
 *   - The confirm action implies finalization (isFinal=true) — the prof no longer
 *     has to explicitly "mark final" before confirming.
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { resolveActiveSemester, toLetterGrade } = require('../lib/grading');
const _gradingHelpers = require('../../../lib/grading-rules');
const { recomputeAcademicGpa, applyStandingAndHonors } = require('../../../lib/transcript-cascade');
const { getGradingRules } = require('../../../lib/grading-rules');

const router = Router();

// ── Shared fetch shim ─────────────────────────────────────────────────────────

const _confirmFetch = (...args) => (global.fetch || require('node-fetch'))(...args);

// ── computeOverallForCourse ───────────────────────────────────────────────────
//
// Sum earned + max across EVERY gradebook column the prof's Live Gradebook
// shows — assignments, quizzes, midterm, final — and run the resulting
// percentage through the admin's grading rules. Mirrors the frontend's
// `computeOverall(row)` in ProfGradeBook.tsx so the letter the prof sees on
// the gradebook is byte-for-byte the same letter that lands on:
//   (a) the student's "Current Semester" card (via buildCurrentSemester),
//   (b) the historical TranscriptCourse row (after Release).
//
// Lenient sum semantics — columns without a submitted score are SKIPPED
// from both earned AND max. Matches the prof gradebook display (a missing
// assignment doesn't quietly push the grade to F). Once everything is
// graded this is irrelevant because both numerator and denominator are
// full; partial grading just keeps the letter representative of what's
// been entered.
async function computeOverallForCourse({ courseId, studentId, courseCredits, gradingRules }) {
  const [assignments, quizzes, asgSubs, quizSubs, gbEntries] = await Promise.all([
    prisma.assignment.findMany({
      where: { courseId },
      select: { id: true, maxScore: true },
    }),
    prisma.quiz.findMany({
      where: { courseId },
      include: { questions: { select: { points: true } } },
    }),
    prisma.assignmentSubmission.findMany({
      where: { userId: studentId },
      select: { assignmentId: true, score: true },
    }),
    prisma.quizSubmission.findMany({
      where: { userId: studentId },
      select: { quizId: true, score: true },
    }),
    prisma.gradebookEntry.findMany({
      where: { studentId, courseId, component: { in: ['midterm', 'final'] } },
      select: { component: true, score: true, maxScore: true },
    }),
  ]);

  // Resolve midterm/final max from course_gradebook_config (admin override)
  // first, then the entry's stored max, then the FCDS defaults of 30/60.
  let cfgMidtermMax = null;
  let cfgFinalMax = null;
  try {
    const tenantId = getCurrentTenant();
    const cfgRows = await prisma.$queryRaw`
      SELECT "midterm_max", "final_max"
        FROM "course_gradebook_config"
       WHERE "course_id" = ${courseId}
         AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
       ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
       LIMIT 1
    `;
    if (cfgRows?.[0]?.midterm_max != null) cfgMidtermMax = parseFloat(cfgRows[0].midterm_max);
    if (cfgRows?.[0]?.final_max != null) cfgFinalMax = parseFloat(cfgRows[0].final_max);
  } catch { /* table missing */ }

  const gbByComponent = new Map(gbEntries.map((e) => [e.component, e]));
  const midEntryMax = gbByComponent.get('midterm')?.maxScore;
  const finEntryMax = gbByComponent.get('final')?.maxScore;
  const midtermMax = cfgMidtermMax
    ?? (midEntryMax != null ? parseFloat(midEntryMax.toString()) : null)
    ?? 30;
  const finalMax = cfgFinalMax
    ?? (finEntryMax != null ? parseFloat(finEntryMax.toString()) : null)
    ?? 60;

  const asgScoreById = new Map(asgSubs.map((s) => [s.assignmentId, s.score]));
  const quizScoreById = new Map(quizSubs.map((s) => [s.quizId, s.score]));

  let totalEarned = 0;
  let totalMax = 0;

  for (const a of assignments) {
    const earned = asgScoreById.get(a.id);
    const max = a.maxScore ? parseFloat(a.maxScore.toString()) : 0;
    if (earned != null && max > 0) {
      totalEarned += parseFloat(earned.toString());
      totalMax += max;
    }
  }
  for (const q of quizzes) {
    const earned = quizScoreById.get(q.id);
    const summed = (q.questions || []).reduce(
      (acc, qq) => acc + (qq.points != null ? parseFloat(qq.points.toString()) : 0),
      0,
    );
    const max = summed > 0 ? summed : 100;
    if (earned != null && max > 0) {
      totalEarned += parseFloat(earned.toString());
      totalMax += max;
    }
  }
  const midScore = gbByComponent.get('midterm')?.score;
  if (midScore != null && midtermMax > 0) {
    totalEarned += parseFloat(midScore.toString());
    totalMax += midtermMax;
  }
  const finScore = gbByComponent.get('final')?.score;
  if (finScore != null && finalMax > 0) {
    totalEarned += parseFloat(finScore.toString());
    totalMax += finalMax;
  }

  const overallPercent = totalMax > 0 ? (totalEarned / totalMax) * 100 : 0;
  // Admin grading scale ALWAYS owns the percent → letter mapping. No
  // hard-coded thresholds anywhere in this path.
  const overallLetter = _gradingHelpers.percentToLetter(overallPercent, gradingRules) || 'F';
  let overallQpPerCredit = 0;
  try {
    overallQpPerCredit = _gradingHelpers.letterToPoints(overallLetter, gradingRules) ?? 0;
  } catch { /* fall through to 0 */ }
  // GradebookEntry.gradePoints stores total = qp_per_credit * credits.
  // Match the existing convention so the GPA recompute reads the same
  // shape from confirmed AND released entries.
  const overallGradePoints = overallQpPerCredit * (Number(courseCredits) || 0);

  return { overallPercent, overallLetter, overallGradePoints, totalEarned, totalMax };
}

// ── confirmGradeEntry ─────────────────────────────────────────────────────────

/**
 * Core confirmation logic shared by all four endpoints.
 *
 * @param {object} opts
 * @param {string} opts.courseCode
 * @param {string} opts.courseTitle
 * @param {string} opts.courseId
 * @param {number} opts.courseCredits
 * @param {string} opts.studentId
 * @param {'final'|'midterm'} opts.component
 * @param {string} opts.performerId
 * @param {string} opts.authHeader
 * @param {number|undefined} opts.score   — when supplied, upserts the score; otherwise confirms existing.
 * @returns {Promise<{ok:boolean, reason?:string, max?:number}>}
 */
async function confirmGradeEntry({ courseCode, courseTitle, courseId, courseCredits, studentId, component, performerId, authHeader, score }) {
  let resolvedMaxScore = null;
  let entry = await prisma.gradebookEntry.findFirst({
    where: { courseId, studentId, component },
  });
  if (entry?.maxScore != null) {
    resolvedMaxScore = parseFloat(entry.maxScore.toString());
  }
  if ((score !== undefined) && (component === 'midterm' || component === 'final')) {
    try {
      const tenantId = getCurrentTenant();
      const cfgRows = await prisma.$queryRaw`
        SELECT "midterm_max", "final_max"
          FROM "course_gradebook_config"
         WHERE "course_id" = ${courseId}
           AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
         ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
         LIMIT 1
      `;
      if (cfgRows?.[0]) {
        const cfgMax = component === 'midterm'
          ? cfgRows[0].midterm_max
          : cfgRows[0].final_max;
        if (cfgMax != null) resolvedMaxScore = parseFloat(cfgMax.toString());
      }
    } catch { /* table missing */ }
    if (resolvedMaxScore == null) {
      resolvedMaxScore = component === 'midterm' ? 30 : 60;
    }
  }
  const gradingRules = await _gradingHelpers.getGradingRules(prisma).catch(() => undefined);

  if (score !== undefined) {
    const numericScore = score === null ? null : parseFloat(score.toString());
    if (numericScore != null && Number.isNaN(numericScore)) {
      return { ok: false, reason: 'score_invalid' };
    }
    if (numericScore != null && resolvedMaxScore != null && (numericScore < 0 || numericScore > resolvedMaxScore)) {
      return { ok: false, reason: 'score_out_of_range', max: resolvedMaxScore };
    }
    const letterFromScore = numericScore != null
      ? toLetterGrade(numericScore, resolvedMaxScore, gradingRules)
      : null;
    let gradePointsFromLetter = null;
    if (letterFromScore && gradingRules) {
      try {
        const gp = _gradingHelpers.letterToPoints(letterFromScore, gradingRules);
        gradePointsFromLetter = (gp != null ? gp : 0) * (courseCredits ?? 0);
      } catch { /* fall through */ }
    }
    entry = await prisma.gradebookEntry.upsert({
      where: {
        courseId_studentId_component: { courseId, studentId, component },
      },
      update: {
        score: numericScore,
        maxScore: resolvedMaxScore ?? undefined,
        letterGrade: letterFromScore,
        gradePoints: gradePointsFromLetter,
        gradedById: performerId,
      },
      create: {
        courseId,
        studentId,
        component,
        score: numericScore,
        maxScore: resolvedMaxScore ?? 100,
        letterGrade: letterFromScore,
        gradePoints: gradePointsFromLetter,
        isFinal: component === 'final',
        gradedById: performerId,
      },
    });
  }

  // Owner directive: allow the prof to confirm even when the cell is empty —
  // useful when the student no-showed or was withdrawn and the prof wants
  // to lock the row at zero. We synthesize a stub entry with score=null,
  // letter='F' (or 'I' if the grading rules supply one), so the cascade
  // downstream has something to write into the transcript.
  if (!entry) {
    const fallbackLetter = component === 'final'
      ? (gradingRules?.scale?.find((s) => s.letter === 'F')?.letter ?? 'F')
      : null;
    let fallbackPoints = null;
    if (fallbackLetter && gradingRules) {
      try {
        const gp = _gradingHelpers.letterToPoints(fallbackLetter, gradingRules);
        fallbackPoints = (gp != null ? gp : 0) * (courseCredits ?? 0);
      } catch { /* ignore */ }
    }
    entry = await prisma.gradebookEntry.create({
      data: {
        courseId,
        studentId,
        component,
        score: null,
        maxScore: resolvedMaxScore ?? (component === 'midterm' ? 30 : component === 'final' ? 60 : 100),
        letterGrade: fallbackLetter,
        gradePoints: fallbackPoints,
        isFinal: component === 'final',
        gradedById: performerId,
      },
    });
  }
  // If the final has no letter (e.g. confirming a previously-empty entry
  // that was never assigned a numeric score), default to F so the
  // transcript cascade can still record a row.
  if (component === 'final' && !entry.letterGrade) {
    const fallbackLetter = gradingRules?.scale?.find((s) => s.letter === 'F')?.letter ?? 'F';
    let fallbackPoints = null;
    if (gradingRules) {
      try {
        const gp = _gradingHelpers.letterToPoints(fallbackLetter, gradingRules);
        fallbackPoints = (gp != null ? gp : 0) * (courseCredits ?? 0);
      } catch { /* ignore */ }
    }
    entry = await prisma.gradebookEntry.update({
      where: { id: entry.id },
      data: { letterGrade: fallbackLetter, gradePoints: fallbackPoints },
    });
  }

  // For the FINAL component specifically — overwrite the per-component
  // letter/gradePoints with the WEIGHTED OVERALL letter from all gradebook
  // columns. This is what the prof's gradebook header shows
  // (computeOverall in ProfGradeBook.tsx) and what the user expects on the
  // student transcript, derived through the admin grading rules. For midterm
  // we keep the per-component letter — midterm IS a single component and
  // the gradebook displays its own letter for it.
  let updateData = {
    isFinal: component === 'final' ? true : entry.isFinal,
    confirmedById: performerId,
    confirmedAt: new Date(),
  };
  if (component === 'final') {
    try {
      const overall = await computeOverallForCourse({
        courseId,
        studentId,
        courseCredits,
        gradingRules,
      });
      // Stamp the overall onto the entry so:
      //   * buildCurrentSemesterGradebook surfaces it as the visible letter,
      //   * releaseGradeEntry inherits it for the TranscriptCourse row.
      updateData.letterGrade = overall.overallLetter;
      updateData.gradePoints = overall.overallGradePoints;
    } catch (err) {
      console.warn('[confirm] overall recompute failed; keeping per-component letter:', err.message);
    }
  }
  await prisma.gradebookEntry.update({
    where: { id: entry.id },
    data: updateData,
  });
  // Re-read so downstream callers / releaseGradeEntry see the overwritten
  // values without an extra round trip.
  entry = await prisma.gradebookEntry.findFirst({ where: { id: entry.id } });

  // Plan 22 follow-up — Confirm vs Release split.
  // Confirm = letter is computed + visible (above). The transcript cascade
  // (transcript row + breakdowns + GPA recompute) ONLY fires from the
  // separate Release endpoint now. This keeps a confirmed final under
  // the student's "Current Semester" view until the prof explicitly
  // releases. See `runReleaseCascade` below.
  // eslint-disable-next-line no-constant-condition
  if (false) {
    const currentSemester = await resolveActiveSemester(prisma, { createIfMissing: true });

    let transcriptCourseId = null;
    if (currentSemester) {
      const tc = await prisma.transcriptCourse.upsert({
        where: {
          userId_semesterId_courseCode: {
            userId: studentId,
            semesterId: currentSemester.id,
            courseCode: courseCode.toUpperCase(),
          },
        },
        update: { grade: entry.letterGrade, qualityPoints: entry.gradePoints ?? 0 },
        create: {
          userId: studentId,
          semesterId: currentSemester.id,
          courseCode: courseCode.toUpperCase(),
          courseTitle,
          credits: courseCredits,
          grade: entry.letterGrade,
          qualityPoints: entry.gradePoints ?? 0,
        },
      }).catch((err) => {
        // Used to be development-only — caused production transcript writes
        // to silently no-op when the upsert failed (e.g. no active period
        // → no semester resolved → cascade returned null). Always log now.
        console.warn('[confirm cascade] transcript upsert skipped:', err.message);
        return null;
      });
      if (tc) transcriptCourseId = tc.id;
    } else {
      console.warn(
        `[confirm cascade] no active semester resolved for course=${courseCode} ` +
        `student=${studentId} — transcript row will NOT be created. Configure ` +
        `an active registration period in Admin → Academics.`
      );
    }

    if (transcriptCourseId) {
      try {
        const [assignments, quizzes, asgSubs, quizSubs, gbEntries] = await Promise.all([
          prisma.assignment.findMany({
            where: { courseId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, title: true, maxScore: true },
          }),
          prisma.quiz.findMany({
            where: { courseId },
            orderBy: { createdAt: 'asc' },
            include: { questions: { select: { points: true } } },
          }),
          prisma.assignmentSubmission.findMany({
            where: { userId: studentId },
            select: { assignmentId: true, score: true },
          }),
          prisma.quizSubmission.findMany({
            where: { userId: studentId },
            select: { quizId: true, score: true },
          }),
          prisma.gradebookEntry.findMany({
            where: { studentId, courseId, component: { in: ['midterm', 'final'] } },
            select: { component: true, score: true, maxScore: true },
          }),
        ]);

        let cfgMidtermMax = null;
        let cfgFinalMax = null;
        try {
          const tenantId = getCurrentTenant();
          const cfgRows = await prisma.$queryRaw`
            SELECT "midterm_max", "final_max", "tenant_id"
              FROM "course_gradebook_config"
             WHERE "course_id" = ${courseId}
               AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
             ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
             LIMIT 1
          `;
          if (cfgRows?.[0]?.midterm_max != null) cfgMidtermMax = parseFloat(cfgRows[0].midterm_max);
          if (cfgRows?.[0]?.final_max != null) cfgFinalMax = parseFloat(cfgRows[0].final_max);
        } catch { /* table not present */ }

        const asgScoreById = new Map(asgSubs.map((s) => [s.assignmentId, s.score]));
        const quizScoreById = new Map(quizSubs.map((s) => [s.quizId, s.score]));
        const gbByComponent = new Map(gbEntries.map((e) => [e.component, e]));

        const midEntryMax = gbByComponent.get('midterm')?.maxScore;
        const finEntryMax = gbByComponent.get('final')?.maxScore;
        const midtermMax = cfgMidtermMax
          ?? (midEntryMax != null ? parseFloat(midEntryMax.toString()) : null)
          ?? 30;
        const finalMax = cfgFinalMax
          ?? (finEntryMax != null ? parseFloat(finEntryMax.toString()) : null)
          ?? 60;

        const rows = [];
        for (const a of assignments) {
          const earned = asgScoreById.get(a.id);
          const max = a.maxScore ? parseFloat(a.maxScore.toString()) : 0;
          rows.push({
            categoryTitle: 'Assignments',
            componentName: a.title || 'Assignment',
            grade: earned != null ? String(parseFloat(earned.toString())) : '0',
            weight: String(max),
            contribution: '',
          });
        }
        for (const q of quizzes) {
          const earned = quizScoreById.get(q.id);
          const summed = (q.questions || []).reduce(
            (acc, qq) => acc + (qq.points != null ? parseFloat(qq.points.toString()) : 0),
            0,
          );
          rows.push({
            categoryTitle: 'Quizzes',
            componentName: q.title || 'Quiz',
            grade: earned != null ? String(parseFloat(earned.toString())) : '0',
            weight: String(summed > 0 ? summed : 100),
            contribution: '',
          });
        }
        const midScore = gbByComponent.get('midterm')?.score;
        rows.push({
          categoryTitle: 'Midterm',
          componentName: 'Midterm',
          grade: midScore != null ? String(parseFloat(midScore.toString())) : '0',
          weight: String(midtermMax),
          contribution: '',
        });
        const finScore = gbByComponent.get('final')?.score;
        rows.push({
          categoryTitle: 'Final',
          componentName: 'Final',
          grade: finScore != null ? String(parseFloat(finScore.toString())) : '0',
          weight: String(finalMax),
          contribution: '',
        });

        await prisma.gradeBreakdown.deleteMany({ where: { transcriptCourseId } });
        if (rows.length > 0) {
          await prisma.gradeBreakdown.createMany({
            data: rows.map((r) => ({ transcriptCourseId, ...r })),
          });
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[confirm cascade] breakdown write skipped:', err.message);
        }
      }
    }

    try {
      await recomputeAcademicGpa(prisma, studentId);
      const rules = await getGradingRules(prisma);
      await applyStandingAndHonors(prisma, studentId, rules);
    } catch (err) {
      console.warn('[confirm cascade] gpa/standing recompute skipped:', err.message);
    }
  }

  const title = component === 'final'
    ? `Final grade confirmed for ${courseCode}`
    : `Midterm grade confirmed for ${courseCode}`;
  const body = component === 'final'
    // Plan 22 follow-up — Confirm vs Release. After Confirm the letter is
    // VISIBLE under Current Semester only; the prof's separate Release
    // action is what writes it to the official transcript.
    ? `Your final letter (${entry.letterGrade || 'see gradebook'}) is now visible under Current Semester.`
    : `Your midterm score is now visible on your gradebook.`;
  setImmediate(() => {
    const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
    _confirmFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader || '' },
      body: JSON.stringify({
        userId: studentId,
        title,
        content: body,
        type: 'grade',
        referenceType: 'GradebookEntry',
        referenceId: entry.id,
      }),
    }).catch(() => { /* best effort */ });
  });

  return { ok: true };
}

// ── releaseGradeEntry ─────────────────────────────────────────────────────────
//
// Plan 22 follow-up. Fires the FULL transcript cascade that used to run on
// Confirm:
//   1. Resolve the active semester (current registration period).
//   2. Upsert TranscriptCourse for (userId, semesterId, courseCode) — a
//      RETAKE in a different semester lands as a new row, preserving the
//      original failing attempt's history per the user's request.
//   3. Rewrite GradeBreakdown rows under the transcript row.
//   4. Stamp releasedById + releasedAt on the GradebookEntry (final only —
//      midterm is a private gradebook slot, no transcript implication).
//   5. recomputeAcademicGpa — which honours the repetition policy and
//      excludes F/FW/W from completedCredits via the existing
//      passingLetters filter (qualityPoints >= 1).
//   6. applyStandingAndHonors.
//   7. Notify the student that the grade is now on the transcript.
//
// Pre-condition: the entry MUST already be confirmed (the renderer also
// disables the Release pill until Confirm has happened). We re-check here
// as a server-side safety net.
async function releaseGradeEntry({ courseCode, courseTitle, courseId, courseCredits, studentId, performerId, authHeader }) {
  const entry = await prisma.gradebookEntry.findFirst({
    where: { courseId, studentId, component: 'final' },
  });
  if (!entry) return { ok: false, reason: 'not_confirmed_yet' };
  if (!entry.confirmedById || !entry.confirmedAt) return { ok: false, reason: 'not_confirmed_yet' };
  if (!entry.letterGrade) return { ok: false, reason: 'letter_missing' };

  // Re-derive the weighted-overall letter from current gradebook data so
  // a score edited AFTER confirm doesn't ship a stale letter to the
  // transcript. Falls back to entry.letterGrade if the recompute fails so
  // a partial outage doesn't block the release.
  let releasedLetter = entry.letterGrade;
  let releasedGradePoints = entry.gradePoints ?? 0;
  try {
    const gradingRules = await getGradingRules(prisma).catch(() => undefined);
    if (gradingRules) {
      const overall = await computeOverallForCourse({
        courseId,
        studentId,
        courseCredits,
        gradingRules,
      });
      releasedLetter = overall.overallLetter;
      releasedGradePoints = overall.overallGradePoints;
      // Persist the recomputed letter back on the entry so the student's
      // post-release "released" snapshot matches the released transcript.
      await prisma.gradebookEntry.update({
        where: { id: entry.id },
        data: { letterGrade: releasedLetter, gradePoints: releasedGradePoints },
      }).catch(() => { /* best effort */ });
    }
  } catch (err) {
    console.warn('[release] overall recompute failed; using confirmed letter:', err.message);
  }

  const currentSemester = await resolveActiveSemester(prisma, { createIfMissing: true });
  if (!currentSemester) {
    console.warn(
      `[release cascade] no active semester resolved for course=${courseCode} ` +
      `student=${studentId} — transcript row will NOT be created. Configure ` +
      `an active registration period in Admin → Academics.`,
    );
    return { ok: false, reason: 'no_active_semester' };
  }

  // Plan 22 retake — allocate the next attemptNumber for this
  // (user, courseCode) so retaking in the SAME registration period
  // produces a NEW row instead of editing the previous attempt's
  // grade. The unique key is (user, semester, courseCode, attemptNumber);
  // we pick max(existing) + 1 across ALL semesters of the course so
  // attempt 2 is always strictly after attempt 1 regardless of period.
  let transcriptCourseId = null;
  let nextAttempt = 1;
  try {
    const existingAttempts = await prisma.transcriptCourse.findMany({
      where: { userId: studentId, courseCode: courseCode.toUpperCase() },
      select: { attemptNumber: true },
    });
    if (existingAttempts.length > 0) {
      const maxAttempt = existingAttempts.reduce(
        (m, r) => Math.max(m, r.attemptNumber || 1),
        1,
      );
      nextAttempt = maxAttempt + 1;
    }
  } catch (err) {
    console.warn('[release cascade] attemptNumber lookup failed:', err.message);
  }

  const tc = await prisma.transcriptCourse.create({
    data: {
      userId: studentId,
      semesterId: currentSemester.id,
      courseCode: courseCode.toUpperCase(),
      courseTitle,
      credits: courseCredits,
      // Use the freshly recomputed weighted-overall letter (re-derives if
      // the prof edited a score after Confirm). Falls back to whatever
      // was stamped during Confirm if the recompute failed.
      grade: releasedLetter,
      qualityPoints: releasedGradePoints,
      attemptNumber: nextAttempt,
    },
  }).catch(async (err) => {
    // If the create races a previous identical release call, fall
    // back to update on the matching (user, semester, code, attempt)
    // tuple. Idempotent across retries.
    console.warn('[release cascade] transcript create raced, falling back to update:', err.message);
    try {
      return await prisma.transcriptCourse.update({
        where: {
          userId_semesterId_courseCode_attemptNumber: {
            userId: studentId,
            semesterId: currentSemester.id,
            courseCode: courseCode.toUpperCase(),
            attemptNumber: nextAttempt,
          },
        },
        data: { grade: releasedLetter, qualityPoints: releasedGradePoints },
      });
    } catch (updateErr) {
      console.warn('[release cascade] transcript update fallback also failed:', updateErr.message);
      return null;
    }
  });
  if (tc) transcriptCourseId = tc.id;

  // Rebuild breakdown rows under the transcript row.
  if (transcriptCourseId) {
    try {
      const [assignments, quizzes, asgSubs, quizSubs, gbEntries] = await Promise.all([
        prisma.assignment.findMany({
          where: { courseId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, maxScore: true },
        }),
        prisma.quiz.findMany({
          where: { courseId },
          orderBy: { createdAt: 'asc' },
          include: { questions: { select: { points: true } } },
        }),
        prisma.assignmentSubmission.findMany({
          where: { userId: studentId },
          select: { assignmentId: true, score: true },
        }),
        prisma.quizSubmission.findMany({
          where: { userId: studentId },
          select: { quizId: true, score: true },
        }),
        prisma.gradebookEntry.findMany({
          where: { studentId, courseId, component: { in: ['midterm', 'final'] } },
          select: { component: true, score: true, maxScore: true },
        }),
      ]);

      let cfgMidtermMax = null;
      let cfgFinalMax = null;
      try {
        const tenantId = getCurrentTenant();
        const cfgRows = await prisma.$queryRaw`
          SELECT "midterm_max", "final_max", "tenant_id"
            FROM "course_gradebook_config"
           WHERE "course_id" = ${courseId}
             AND ("tenant_id" = ${tenantId} OR "tenant_id" = '')
           ORDER BY CASE WHEN "tenant_id" = ${tenantId} THEN 0 ELSE 1 END
           LIMIT 1
        `;
        if (cfgRows?.[0]?.midterm_max != null) cfgMidtermMax = parseFloat(cfgRows[0].midterm_max);
        if (cfgRows?.[0]?.final_max != null) cfgFinalMax = parseFloat(cfgRows[0].final_max);
      } catch { /* table not present */ }

      const asgScoreById = new Map(asgSubs.map((s) => [s.assignmentId, s.score]));
      const quizScoreById = new Map(quizSubs.map((s) => [s.quizId, s.score]));
      const gbByComponent = new Map(gbEntries.map((e) => [e.component, e]));

      const midEntryMax = gbByComponent.get('midterm')?.maxScore;
      const finEntryMax = gbByComponent.get('final')?.maxScore;
      const midtermMax = cfgMidtermMax
        ?? (midEntryMax != null ? parseFloat(midEntryMax.toString()) : null)
        ?? 30;
      const finalMax = cfgFinalMax
        ?? (finEntryMax != null ? parseFloat(finEntryMax.toString()) : null)
        ?? 60;

      const rows = [];
      for (const a of assignments) {
        const earned = asgScoreById.get(a.id);
        const max = a.maxScore ? parseFloat(a.maxScore.toString()) : 0;
        rows.push({
          categoryTitle: 'Assignments',
          componentName: a.title || 'Assignment',
          grade: earned != null ? String(parseFloat(earned.toString())) : '0',
          weight: String(max),
          contribution: '',
        });
      }
      for (const q of quizzes) {
        const earned = quizScoreById.get(q.id);
        const summed = (q.questions || []).reduce(
          (acc, qq) => acc + (qq.points != null ? parseFloat(qq.points.toString()) : 0),
          0,
        );
        rows.push({
          categoryTitle: 'Quizzes',
          componentName: q.title || 'Quiz',
          grade: earned != null ? String(parseFloat(earned.toString())) : '0',
          weight: String(summed > 0 ? summed : 100),
          contribution: '',
        });
      }
      const midScore = gbByComponent.get('midterm')?.score;
      rows.push({
        categoryTitle: 'Midterm',
        componentName: 'Midterm',
        grade: midScore != null ? String(parseFloat(midScore.toString())) : '0',
        weight: String(midtermMax),
        contribution: '',
      });
      const finScore = gbByComponent.get('final')?.score;
      rows.push({
        categoryTitle: 'Final',
        componentName: 'Final',
        grade: finScore != null ? String(parseFloat(finScore.toString())) : '0',
        weight: String(finalMax),
        contribution: '',
      });

      await prisma.gradeBreakdown.deleteMany({ where: { transcriptCourseId } });
      if (rows.length > 0) {
        await prisma.gradeBreakdown.createMany({
          data: rows.map((r) => ({ transcriptCourseId, ...r })),
        });
      }
    } catch (err) {
      console.warn('[release cascade] breakdown write skipped:', err.message);
    }
  }

  // Stamp the release on the GradebookEntry — this is the flag the
  // student's "Current Semester" view reads to decide whether to keep
  // showing the course (it disappears once releasedAt is set, because
  // the row is now on the official transcript).
  await prisma.gradebookEntry.update({
    where: { id: entry.id },
    data: {
      releasedById: performerId,
      releasedAt: new Date(),
    },
  });

  try {
    await recomputeAcademicGpa(prisma, studentId);
    const rules = await getGradingRules(prisma);
    await applyStandingAndHonors(prisma, studentId, rules);
  } catch (err) {
    console.warn('[release cascade] gpa/standing recompute skipped:', err.message);
  }

  setImmediate(() => {
    const url = `${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`;
    _confirmFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader || '' },
      body: JSON.stringify({
        userId: studentId,
        title: `Grade released for ${courseCode}`,
        content: `Your final letter (${releasedLetter}) has been released to your official transcript.`,
        type: 'grade',
        referenceType: 'GradebookEntry',
        referenceId: entry.id,
      }),
    }).catch(() => { /* best effort */ });
  });

  return { ok: true };
}

// ── POST /api/grades/:courseCode/:studentId/confirm ───────────────────────────

router.post(
  '/grades/:courseCode/:studentId/confirm',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
      include: { sections: { select: { instructorId: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);
    if (req.user.role !== 'admin') {
      const isOwner = course.sections.some((s) => s.instructorId === req.user.userId);
      if (!isOwner) throw new AppError('not_course_owner', 403);
    }
    const result = await confirmGradeEntry({
      courseCode,
      courseTitle: course.title,
      courseId: course.id,
      courseCredits: course.credits,
      studentId,
      component: 'final',
      performerId: req.user.userId,
      authHeader: req.headers.authorization,
      score: req.body?.score,
    });
    if (!result.ok) {
      if (result.reason === 'score_out_of_range') {
        throw new AppError(`score_out_of_range:${result.max}`, 400);
      }
      throw new AppError(result.reason, 400);
    }
    res.json({ success: true });
  }),
);

// ── POST /api/grades/:courseCode/:studentId/confirm-mid ───────────────────────

router.post(
  '/grades/:courseCode/:studentId/confirm-mid',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
      include: { sections: { select: { instructorId: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);
    if (req.user.role !== 'admin') {
      const isOwner = course.sections.some((s) => s.instructorId === req.user.userId);
      if (!isOwner) throw new AppError('not_course_owner', 403);
    }
    const result = await confirmGradeEntry({
      courseCode,
      courseTitle: course.title,
      courseId: course.id,
      courseCredits: course.credits,
      studentId,
      component: 'midterm',
      performerId: req.user.userId,
      authHeader: req.headers.authorization,
      score: req.body?.score,
    });
    if (!result.ok) {
      if (result.reason === 'score_out_of_range') {
        throw new AppError(`score_out_of_range:${result.max}`, 400);
      }
      throw new AppError(result.reason, 400);
    }
    res.json({ success: true });
  }),
);

// ── POST /api/grades/:courseCode/confirm-all ──────────────────────────────────

router.post(
  '/grades/:courseCode/confirm-all',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
      include: { sections: { select: { instructorId: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);
    if (req.user.role !== 'admin') {
      const isOwner = course.sections.some((s) => s.instructorId === req.user.userId);
      if (!isOwner) throw new AppError('not_course_owner', 403);
    }

    const candidates = await prisma.gradebookEntry.findMany({
      where: {
        courseId: course.id,
        component: 'final',
        confirmedById: null,
        letterGrade: { not: null },
      },
      select: { studentId: true },
    });
    let confirmed = 0;
    for (const c of candidates) {
      const r = await confirmGradeEntry({
        courseCode,
        courseTitle: course.title,
        courseId: course.id,
        courseCredits: course.credits,
        studentId: c.studentId,
        component: 'final',
        performerId: req.user.userId,
        authHeader: req.headers.authorization,
      });
      if (r.ok) confirmed += 1;
    }
    res.json({ success: true, confirmed });
  }),
);

// ── POST /api/grades/:courseCode/confirm-mid-all ──────────────────────────────

router.post(
  '/grades/:courseCode/confirm-mid-all',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode } = req.params;
    const course = await prisma.course.findFirst({
      where: { code: courseCode.toUpperCase() },
      include: { sections: { select: { instructorId: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);
    if (req.user.role !== 'admin') {
      const isOwner = course.sections.some((s) => s.instructorId === req.user.userId);
      if (!isOwner) throw new AppError('not_course_owner', 403);
    }

    const candidates = await prisma.gradebookEntry.findMany({
      where: {
        courseId: course.id,
        component: 'midterm',
        confirmedById: null,
        score: { not: null },
      },
      select: { studentId: true },
    });
    let confirmed = 0;
    for (const c of candidates) {
      const r = await confirmGradeEntry({
        courseCode,
        courseTitle: course.title,
        courseId: course.id,
        courseCredits: course.credits,
        studentId: c.studentId,
        component: 'midterm',
        performerId: req.user.userId,
        authHeader: req.headers.authorization,
      });
      if (r.ok) confirmed += 1;
    }
    res.json({ success: true, confirmed });
  }),
);

// ── POST /api/grades/:courseCode/:studentId/release ──────────────────────────
// "Release" a student from a course: confirms their final grade (creating a
// fallback F entry when nothing was scored), runs the transcript cascade so
// the course shifts from Current Semester into the historical transcript
// under the active period's semester name, then marks their registration as
// inactive so it disappears from their in-progress view.

router.post(
  '/grades/:courseCode/:studentId/release',
  requireAuth,
  requireRole(['professor', 'admin']),
  asyncHandler(async (req, res) => {
    const { courseCode, studentId } = req.params;
    const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
    if (!course) throw new AppError('Course not found', 404);

    // 1) Confirm final — confirmGradeEntry handles the empty-grade fallback
    //    (synthesises an F gradebook entry). After Plan 22's Confirm vs
    //    Release split, confirmGradeEntry NO LONGER writes the transcript;
    //    that's now the explicit job of releaseGradeEntry (step 1b).
    const result = await confirmGradeEntry({
      courseCode,
      courseTitle: course.title,
      courseId: course.id,
      courseCredits: course.credits,
      studentId,
      component: 'final',
      performerId: req.user.userId,
      authHeader: req.headers.authorization,
    });
    if (!result.ok) {
      return res.status(400).json({ error: result.reason || 'release_failed' });
    }

    // 1b) Run the transcript cascade — TranscriptCourse upsert, GradeBreakdown
    //     rebuild, recomputeAcademicGpa, applyStandingAndHonors, stamp
    //     releasedById/releasedAt on the gradebook entry.
    const released = await releaseGradeEntry({
      courseCode,
      courseTitle: course.title,
      courseId: course.id,
      courseCredits: course.credits,
      studentId,
      performerId: req.user.userId,
      authHeader: req.headers.authorization,
    });
    if (!released.ok) {
      return res.status(400).json({ error: released.reason || 'release_cascade_failed' });
    }

    // 2) Drop the student's active registration(s) for this course so the
    //    course exits buildCurrentSemesterGradebook's `isActive: true`
    //    filter immediately — no more "Current Semester" ghost row.
    const dropped = await prisma.registration.updateMany({
      where: {
        userId: studentId,
        courseId: course.id,
        isActive: true,
      },
      data: {
        // 'released' was not a valid RegistrationStatus enum value (the
        // enum is pending|approved|rejected|dropped only); writing it
        // 500'd the entire release endpoint. Use 'dropped' instead — it
        // matches the semantic ("the registration is no longer active")
        // and the existing buildCurrentSemesterGradebook filter already
        // only includes approved/pending so this also exits the live
        // gradebook.
        isActive: false,
        status: 'dropped',
        droppedAt: new Date(),
      },
    });

    // 2b) Archive the live gradebook into the transcript breakdown rows
    //     (so the student keeps the per-component scores under the
    //     historical course card) and then CLEAR the live gradebook for
    //     this (student, course). Without this step, if the student
    //     re-enrolls in the same course the old assignment/quiz scores
    //     would reappear inside the new attempt's gradebook — owner
    //     directive: "see only old breakdowns in the transcript; the new
    //     attempt's gradebook should start empty".
    try {
      // Collect the live scores before we wipe them so they end up on
      // the transcript breakdown rows under their semester.
      const [asgSubs, quizSubs, midfinalEntries] = await Promise.all([
        prisma.assignmentSubmission.findMany({
          where: { userId: studentId, assignment: { courseId: course.id } },
          include: { assignment: true },
        }),
        prisma.quizSubmission.findMany({
          where: { userId: studentId, quiz: { courseId: course.id } },
          include: { quiz: true },
        }),
        prisma.gradebookEntry.findMany({
          where: { courseId: course.id, studentId, component: { in: ['midterm', 'final'] } },
        }),
      ]);

      // Drop the live rows. Order matters — deleteMany is safe because
      // we don't have FKs from breakdowns to these tables.
      await prisma.assignmentSubmission.deleteMany({
        where: { userId: studentId, assignment: { courseId: course.id } },
      });
      await prisma.quizSubmission.deleteMany({
        where: { userId: studentId, quiz: { courseId: course.id } },
      });
      await prisma.gradebookEntry.deleteMany({
        where: { courseId: course.id, studentId },
      });

      // Counts are used only by the response payload for transparency.
      var archived = {
        assignments: asgSubs.length,
        quizzes: quizSubs.length,
        midfinal: midfinalEntries.length,
      };
    } catch (clearErr) {
      console.warn('[release] live gradebook clear failed:', clearErr.message);
      var archived = { assignments: 0, quizzes: 0, midfinal: 0 };
    }

    // 3) Read the actual confirmed final grade so the notification can
    //    include the same letter the prof sees in the gradebook (was a
    //    generic "is now on your transcript" message — the user reported
    //    the notification grade didn't match the gradebook because the
    //    notification didn't show the grade at all).
    let finalLetter = null;
    let finalScore = null;
    let finalMax = null;
    try {
      const finalEntry = await prisma.gradebookEntry.findFirst({
        where: { courseId: course.id, studentId, component: 'final' },
        select: { letterGrade: true, score: true, maxScore: true },
      });
      if (finalEntry) {
        finalLetter = finalEntry.letterGrade;
        finalScore = finalEntry.score != null ? parseFloat(finalEntry.score.toString()) : null;
        finalMax = finalEntry.maxScore != null ? parseFloat(finalEntry.maxScore.toString()) : null;
      }
    } catch { /* notification is best-effort */ }

    // 4) Best-effort notify the student that their final is in.
    try {
      const { notifyUser } = require('../../../lib/notify');
      const scoreText = finalScore != null && finalMax != null
        ? `${finalScore}/${finalMax}`
        : (finalScore != null ? `${finalScore}` : null);
      const gradeText = [finalLetter, scoreText ? `(${scoreText})` : null]
        .filter(Boolean)
        .join(' ');
      notifyUser(req, studentId, {
        title: gradeText
          ? `Final grade for ${courseCode.toUpperCase()}: ${gradeText}`
          : `Final grade released: ${courseCode.toUpperCase()}`,
        content: gradeText
          ? `Your final grade for ${courseCode.toUpperCase()} (${course.title}) is ${gradeText} and is now on your transcript.`
          : `Your final grade for ${courseCode.toUpperCase()} (${course.title}) is now on your transcript.`,
        type: 'info',
        priority: 'normal',
        referenceType: 'TranscriptCourse',
        referenceId: course.id,
      });
    } catch { /* notify is fire-and-forget */ }

    res.json({
      success: true,
      confirmed: true,
      registrationsDropped: dropped.count,
    });
  }),
);

module.exports = router;
