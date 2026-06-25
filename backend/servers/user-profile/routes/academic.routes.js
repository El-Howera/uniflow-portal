/**
 * user-profile / routes / academic.routes.js
 *
 * Mounted at: (no prefix — routes declare their full /api/... paths)
 *
 * Endpoints:
 *   GET /api/academic/:userId
 *   GET /api/academic/transcript/:userId
 *   GET /api/academic/gpa/:userId
 *
 * Non-obvious decisions:
 *   - SCOPE_INCLUSION is reproduced from active-sessions.js here to allow the
 *     transcript endpoint to evaluate the caller's privilege level without
 *     importing the full auth module — this keeps the auth side-effect
 *     (markPresent) cleanly separated.
 *   - The gradePoints map is inlined (same as original) rather than importing
 *     from backend/lib/grading-rules since the transcript endpoint uses a
 *     hard-coded historical scale that predates the admin-tunable rules.
 *   - Raw SQL is used for academicStanding + honorsEligible because the
 *     Windows DLL lock may prevent prisma generate from exposing these columns
 *     on the typed client. Same approach as original.
 */

'use strict';

const express = require('express');
const prisma  = require('../../../lib/prisma');
const { resolveUser }       = require('../../../lib/users');
const { getCurrentTenant }  = require('../../../lib/tenant-context');
const { authenticateToken } = require('../lib/active-sessions');

const router = express.Router();

const SCOPE_INCLUSION = {
  admin:     ['admin', 'financial', 'it'],
  financial: ['financial'],
  it:        ['it'],
  professor: ['professor'],
  ta:        ['ta'],
  sa:        ['sa'],
  student:   ['student'],
};

// ── GET /api/academic/:userId ─────────────────────────────────────────────────

router.get('/api/academic/:userId', async (req, res) => {
  try {
    const resolved = await resolveUser(req.params.userId);
    if (!resolved) return res.status(404).json({ error: 'User not found' });

    const user = await prisma.user.findFirst({
      where: { id: resolved.id },
      include: { academicProfile: true },
    });

    const academicProfile = user.academicProfile || {};
    res.json({
      gpa: parseFloat(academicProfile.gpa) || 0,
      totalCredits: parseInt(academicProfile.totalCredits) || 0,
      creditsThisSemester: parseInt(academicProfile.creditsThisSemester) || 0,
      standing: academicProfile.standing || 'Good',
      studentId: user.id,
      studentName: `${user.firstName} ${user.lastName}`,
      email: user.email,
    });
  } catch (error) {
    console.error('Error fetching academic info:', error);
    res.status(500).json({ error: 'Failed to fetch academic information' });
  }
});

// ── GET /api/academic/transcript/:userId ──────────────────────────────────────

router.get('/api/academic/transcript/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const callerId        = req.user?.userId;
    const callerRole      = req.user?.role;
    const callerInclusions = SCOPE_INCLUSION[callerRole] || [callerRole];
    const isPrivileged    = callerInclusions.some((s) => ['admin', 'sa'].includes(s));
    if (callerId !== user.id && !isPrivileged) {
      return res.status(403).json({ error: 'Cannot view another user\'s transcript' });
    }

    const gradePoints = {
      'A': 4.000, 'A-': 3.666,
      'B+': 3.333, 'B': 3.000, 'B-': 2.666,
      'C+': 2.333, 'C': 2.000, 'C-': 1.666,
      'D+': 1.333, 'D': 1.000,
      'F': 0.000, '(F)': 0.000,
    };

    const semesters = await prisma.semester.findMany({
      include: {
        transcriptCourses: {
          where: { userId: user.id },
          include: { breakdowns: true },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const semesterGpas  = await prisma.semesterGpa.findMany({ where: { userId: user.id } });
    const semGpaMap     = {};
    for (const sg of semesterGpas) {
      semGpaMap[sg.semesterId] = { gpa: parseFloat(sg.gpa) || 0, credits: parseInt(sg.credits) || 0 };
    }

    const formattedSemesters = semesters
      .filter((sem) => sem.transcriptCourses.length > 0)
      .map((sem) => {
        const courses = sem.transcriptCourses.map((tc) => {
          const credits = parseInt(tc.credits) || 0;
          const points  = (gradePoints[tc.grade] || 0) * credits;

          const breakdownMap = {};
          let totalEarned = 0, totalMax = 0;
          if (tc.breakdowns && tc.breakdowns.length > 0) {
            for (const bd of tc.breakdowns) {
              if (!breakdownMap[bd.categoryTitle]) breakdownMap[bd.categoryTitle] = [];
              const earned   = parseFloat(bd.grade);
              const max      = parseFloat(bd.weight);
              const earnedNum = Number.isFinite(earned) ? earned : 0;
              const maxNum    = Number.isFinite(max)    ? max    : 0;
              totalEarned += earnedNum;
              totalMax    += maxNum;
              breakdownMap[bd.categoryTitle].push({
                name: bd.componentName, earned: earnedNum, max: maxNum,
                grade: bd.grade, weight: bd.weight, contribution: bd.contribution,
              });
            }
          }
          const breakdown = Object.entries(breakdownMap).map(([title, assignments]) => {
            const subtotalEarned = assignments.reduce((s, a) => s + a.earned, 0);
            const subtotalMax    = assignments.reduce((s, a) => s + a.max,   0);
            return { title, assignments, subtotalEarned: parseFloat(subtotalEarned.toFixed(1)), subtotalMax };
          });

          return {
            code: tc.courseCode, title: tc.courseTitle, credits,
            grade: tc.grade, points: parseFloat(points.toFixed(2)),
            totalEarned: parseFloat(totalEarned.toFixed(1)), totalMax: totalMax || 100,
            breakdown: breakdown.length > 0 ? breakdown : undefined,
          };
        });

        // User-facing "credits" should reflect EARNED credit — passing
        // grades only. F / FW / W / I / etc. contribute 0 to the
        // displayed credit total (matches typical transcript semantics
        // and the user's expectation). The GPA divisor still uses
        // ATTEMPTED credits because a failing attempt drags the average
        // down — that's the entire point of GPA. Two different sums
        // for two different consumer needs.
        const isPassing = (grade) => (gradePoints[grade] || 0) >= 1;
        const semGpaData             = semGpaMap[sem.id];
        const totalSemAttemptedCreds = courses.reduce((sum, c) => sum + c.credits, 0);
        const totalSemEarnedCreds    = courses.reduce(
          (sum, c) => sum + (isPassing(c.grade) ? c.credits : 0),
          0,
        );
        const totalSemPoints         = courses.reduce((sum, c) => sum + c.points, 0);
        const calculatedGpa          = totalSemAttemptedCreds > 0
          ? totalSemPoints / totalSemAttemptedCreds
          : 0;

        return {
          id: sem.id, name: sem.name,
          gpa: parseFloat((semGpaData?.gpa || calculatedGpa).toFixed(2)),
          // Display = earned. SemesterGpa.credits (legacy = attempted)
          // intentionally ignored here so the new semantics win across
          // historical data too.
          credits: totalSemEarnedCreds,
          courses,
        };
      });

    const userWithProfile = await prisma.user.findFirst({
      where: { id: user.id }, include: { academicProfile: true },
    });
    const totalCredits = formattedSemesters.reduce((sum, sem) => sum + sem.credits, 0);

    let academicStanding = null, honorsEligible = null;
    try {
      const tenantId = req.user?.tenantId || req.tenantId || getCurrentTenant();
      const rows = await prisma.$queryRaw`
        SELECT academic_standing AS "academicStanding", honors_eligible AS "honorsEligible"
        FROM academic_profiles WHERE user_id = ${user.id} AND tenant_id = ${tenantId} LIMIT 1
      `;
      academicStanding = rows?.[0]?.academicStanding ?? null;
      honorsEligible   = rows?.[0]?.honorsEligible   ?? null;
    } catch { /* columns missing on older deployments */ }

    res.json({
      studentId: user.id,
      semesters: formattedSemesters,
      gpa: parseFloat(userWithProfile?.academicProfile?.gpa) || 0,
      totalCredits,
      academicStanding,
      honorsEligible,
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ error: 'Failed to fetch transcript' });
  }
});

// ── GET /api/academic/gpa/:userId ─────────────────────────────────────────────

router.get('/api/academic/gpa/:userId', async (req, res) => {
  try {
    const user = await resolveUser(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [academicProfile, transcriptCourses, registrations] = await Promise.all([
      prisma.academicProfile.findFirst({ where: { userId: user.id } }),
      prisma.transcriptCourse.findMany({
        where: { userId: user.id }, select: { credits: true, courseCode: true },
      }),
      prisma.registration.findMany({
        where: { userId: user.id, isActive: true, status: { notIn: ['dropped', 'rejected'] } },
        select: { courseId: true, course: { select: { credits: true, code: true } } },
      }),
    ]);

    const totalCredits = transcriptCourses.reduce((sum, tc) => sum + (tc.credits || 0), 0);

    let confirmedCourseIds = new Set();
    if (registrations.length > 0) {
      const courseIds = [...new Set(registrations.map((r) => r.courseId))];
      const confirmedFinals = await prisma.gradebookEntry.findMany({
        where: { studentId: user.id, courseId: { in: courseIds }, component: 'final', confirmedById: { not: null } },
        select: { courseId: true },
      }).catch(() => []);
      const transcriptedCodes   = new Set(transcriptCourses.map((tc) => (tc.courseCode || '').toUpperCase()));
      const confirmedFinalIds   = new Set(confirmedFinals.map((r) => r.courseId));
      for (const r of registrations) {
        const isConfirmed    = confirmedFinalIds.has(r.courseId);
        const isTranscripted = transcriptedCodes.has((r.course?.code || '').toUpperCase());
        if (isConfirmed && isTranscripted) confirmedCourseIds.add(r.courseId);
      }
    }

    const seenCourseIds = new Set();
    let creditsThisSemester = 0;
    for (const r of registrations) {
      if (confirmedCourseIds.has(r.courseId)) continue;
      if (seenCourseIds.has(r.courseId)) continue;
      seenCourseIds.add(r.courseId);
      creditsThisSemester += r.course?.credits || 0;
    }

    res.json({
      gpa: parseFloat(academicProfile?.gpa) || 0,
      totalCredits,
      creditsThisSemester,
      standing: academicProfile?.standing || 'Good',
    });
  } catch (error) {
    console.error('Error fetching GPA:', error);
    res.status(500).json({ error: 'Failed to fetch GPA information' });
  }
});

module.exports = router;
