/**
 * registration/routes/registration-drop.routes.js
 *
 * Registration mutation endpoints (drop, withdraw, tools):
 *
 *   POST /api/registrations/drop            — drop a course (add/drop window)
 *   POST /api/registrations/withdraw        — withdraw with 'W' grade (withdrawal window)
 *   POST /api/registrations/check-conflicts — pre-check schedule conflicts
 *   POST /api/registrations/swap-section    — swap to another section within the same course
 *
 * All routes require auth. Students act on their own data; sa/admin can act on
 * behalf of another user (drop only). Withdraw gated behind the withdrawal window
 * and attendance-rule check (barred → FW, not W).
 */

const express = require('express');
const router = express.Router();

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { resolveUser } = require('../../../lib/users');
const { writeAudit } = require('../../../lib/audit');
const { getWindowsPolicy, enforceWindow } = require('../../../lib/registration-windows');
const chatSync = require('../../../lib/chat-sync');

const { detectConflicts, getUserActiveSlots } = require('../lib/section-helpers');
const { findActivePeriod } = require('../lib/period-helpers');

// ── POST /api/registrations/drop ─────────────────────────────────────────────

/**
 * POST /api/registrations/drop
 * Drop a registration. Accepts either form:
 *   - { registrationId }            → drop one specific Registration row
 *   - { courseCode } (or course)    → drop ALL of the user's active Registration rows
 *                                     for that course (lecture + lab + …)
 */
router.post(
  '/drop',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { registrationId, courseCode, course, userId: bodyUserId } = req.body || {};
    const code = courseCode || course;

    let userId = req.user.userId;
    if (bodyUserId && bodyUserId !== userId) {
      if (!['sa', 'admin'].includes(req.user.role)) {
        throw new AppError('Only Student Affairs / admin can drop on behalf of another user.', 403);
      }
      const target = await resolveUser(bodyUserId);
      if (!target) throw new AppError('Target user not found', 404);
      userId = target.id;
    }

    if (!registrationId && !code) {
      throw new AppError('registrationId or courseCode is required', 400);
    }

    // Plan 4 Phase 3 — gate on the add-drop window (FCDS Article 14).
    if (req.user.role === 'student') {
      const activePeriod = await findActivePeriod();
      if (!activePeriod) throw new AppError('No active registration period.', 403);
      const windowsPolicy = await getWindowsPolicy(prisma);
      enforceWindow('Drop', 'addDrop', activePeriod, windowsPolicy);
    }

    let registrations;
    if (registrationId) {
      const r = await prisma.registration.findFirst({
        where: { id: registrationId },
        include: { course: { select: { code: true, title: true, id: true } } },
      });
      if (!r) throw new AppError('Registration not found', 404);
      if (r.userId !== userId && !['sa', 'admin'].includes(req.user.role)) {
        throw new AppError('Access denied', 403);
      }
      if (r.status === 'dropped') {
        throw new AppError('Registration is already dropped', 409);
      }
      registrations = [r];
    } else {
      registrations = await prisma.registration.findMany({
        where: {
          userId,
          isActive: true,
          status: { in: ['pending', 'approved'] },
          course: { code: code.toUpperCase() },
        },
        include: { course: { select: { code: true, title: true, id: true } } },
      });
      if (registrations.length === 0) {
        throw new AppError(`No active registration found for ${code}`, 404);
      }
    }

    const droppedCourse = registrations[0].course;

    await prisma.$transaction(async (tx) => {
      for (const reg of registrations) {
        await tx.registration.update({
          where: { id: reg.id },
          data: {
            status: 'dropped',
            isActive: false,
            droppedAt: new Date(),
          },
        });
        if (['pending', 'approved'].includes(reg.status)) {
          await tx.courseSection.update({
            where: { id: reg.sectionId },
            data: { enrolled: { decrement: 1 } },
          });
        }
      }

      const droppedIds = registrations.map((r) => r.id);
      const otherActive = await tx.registration.count({
        where: {
          userId,
          courseId: droppedCourse.id,
          isActive: true,
          status: { in: ['pending', 'approved'] },
          id: { notIn: droppedIds },
        },
      });
      if (otherActive === 0) {
        await tx.studentEnrollment.deleteMany({
          where: { userId, courseId: droppedCourse.id },
        });
      }
    });

    for (const reg of registrations) {
      try {
        await chatSync.removeStudentFromSectionChat(prisma, {
          userId,
          sectionId: reg.sectionId,
        });
      } catch (e) {
        console.warn('[registration] chat sync (drop) failed:', e.message);
      }
    }

    if (['sa', 'admin'].includes(req.user.role) && userId !== req.user.userId) {
      const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
      setImmediate(() => {
        fetch(`${notifUrl}/api/notifications/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: req.headers['authorization'] || '',
            Cookie: req.headers['cookie'] || '',
          },
          body: JSON.stringify({
            userId,
            title: 'Registration dropped',
            content: `Your registration for ${droppedCourse.code} was dropped by ${req.user.role}.`,
            type: 'info',
            referenceType: 'Registration',
            referenceId: registrations[0].id,
          }),
        }).catch((e) => console.warn('[drop] notify failed:', e.message));
      });
    }

    res.json({
      success: true,
      message:
        registrations.length === 1
          ? `Dropped registration for ${droppedCourse.code}`
          : `Dropped ${registrations.length} registrations for ${droppedCourse.code}`,
      droppedCount: registrations.length,
    });
  })
);

// ── POST /api/registrations/withdraw ─────────────────────────────────────────

/**
 * POST /api/registrations/withdraw
 * Voluntary withdrawal (FCDS Article 15). Only allowed when the withdrawal
 * window is open AND the student has not already exceeded the absence cap.
 *
 * Effect: marks the registration row(s) inactive AND files a 'W' letter
 * on the student's transcript.
 *
 * Body: { registrationId } | { courseCode }
 */
router.post(
  '/withdraw',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { registrationId, courseCode, course } = req.body || {};
    const code = courseCode || course;
    if (!registrationId && !code) {
      throw new AppError('registrationId or courseCode is required', 400);
    }

    const activePeriod = await findActivePeriod();
    if (!activePeriod) throw new AppError('No active registration period.', 403);
    if (req.user.role === 'student') {
      const windowsPolicy = await getWindowsPolicy(prisma);
      enforceWindow('Withdrawal', 'withdrawal', activePeriod, windowsPolicy);
    }

    let registrations;
    if (registrationId) {
      const r = await prisma.registration.findFirst({
        where: { id: registrationId },
        include: { course: { select: { code: true, title: true, id: true } } },
      });
      if (!r) throw new AppError('Registration not found', 404);
      if (r.userId !== userId && !['sa', 'admin'].includes(req.user.role)) {
        throw new AppError('Access denied', 403);
      }
      if (!['pending', 'approved'].includes(r.status)) {
        throw new AppError('Registration is not active — nothing to withdraw.', 409);
      }
      registrations = [r];
    } else {
      registrations = await prisma.registration.findMany({
        where: {
          userId,
          isActive: true,
          status: { in: ['pending', 'approved'] },
          course: { code: code.toUpperCase() },
        },
        include: { course: { select: { code: true, title: true, id: true } } },
      });
      if (registrations.length === 0) {
        throw new AppError(`No active registration found for ${code}`, 404);
      }
    }
    const target = registrations[0].course;

    // Cross-reference Article 16: if attendance crossed the threshold, file FW instead.
    const { DEFAULT_RULES, classifyAttendance } = require('../../../lib/attendance-rules');
    const settings = await prisma.systemSettings.findFirst({ select: { attendanceRules: true } });
    const attendanceRules = settings?.attendanceRules || DEFAULT_RULES;

    const attendanceRecs = await prisma.attendanceRecord.findMany({
      where: { userId, session: { courseId: target.id } },
      select: { status: true },
    });
    if (attendanceRecs.length > 0) {
      const total = attendanceRecs.length;
      const absent = attendanceRecs.filter((r) => r.status === 'absent').length;
      const absencePct = (absent / total) * 100;
      const verdict = classifyAttendance(absencePct, attendanceRules);
      if (verdict === 'barred') {
        throw new AppError(
          `Cannot withdraw — your absence has exceeded ${attendanceRules.failAbsencePercent}% (${Math.round(absencePct)}%). The registrar must file ${attendanceRules.barredGradeLetter} per Article 16.`,
          403,
        );
      }
    }

    // 1. Drop the registration row(s)
    await prisma.$transaction(async (tx) => {
      for (const reg of registrations) {
        await tx.registration.update({
          where: { id: reg.id },
          data: { status: 'dropped', isActive: false, droppedAt: new Date() },
        });
        if (['pending', 'approved'].includes(reg.status)) {
          await tx.courseSection.update({
            where: { id: reg.sectionId },
            data: { enrolled: { decrement: 1 } },
          });
        }
      }
      const droppedIds = registrations.map((r) => r.id);
      const otherActive = await tx.registration.count({
        where: {
          userId, courseId: target.id, isActive: true,
          status: { in: ['pending', 'approved'] },
          id: { notIn: droppedIds },
        },
      });
      if (otherActive === 0) {
        await tx.studentEnrollment.deleteMany({ where: { userId, courseId: target.id } });
      }
    });

    // 2. File the W letter on the transcript via the cascade.
    let cascadeError = null;
    try {
      const { applyTranscriptOverride } = require('../../../lib/transcript-cascade');
      const settingsForSem = await prisma.systemSettings.findFirst({
        select: { currentSemester: true },
      });
      await applyTranscriptOverride(prisma, {
        userId,
        courseCode: target.code,
        newLetter: 'W',
        semesterName: settingsForSem?.currentSemester || activePeriod.semester || 'Current',
      });
    } catch (err) {
      console.warn('[withdraw] transcript cascade failed:', err.message);
      cascadeError = err.message;
    }

    await writeAudit(prisma, {
      action: 'registration.withdraw',
      entityType: 'Registration',
      entityId: registrations[0].id,
      details: {
        userId, courseCode: target.code, count: registrations.length,
        cascadeError,
      },
      performedById: req.user.userId,
    }, {
      authHeader: req.headers.authorization,
      summary: `Withdrew from ${target.code} (W grade filed)`,
    });

    for (const reg of registrations) {
      try {
        await chatSync.removeStudentFromSectionChat(prisma, {
          userId,
          sectionId: reg.sectionId,
        });
      } catch (e) {
        console.warn('[registration] chat sync (withdraw) failed:', e.message);
      }
    }

    res.json({
      success: true,
      message: `Withdrew from ${target.code} — a 'W' grade has been recorded.`,
      droppedCount: registrations.length,
      transcriptUpdated: !cascadeError,
    });
  })
);

// ── POST /api/registrations/check-conflicts ───────────────────────────────────

/**
 * POST /api/registrations/check-conflicts
 * Check whether a section conflicts with a user's existing schedule.
 * Body: { userId?, sectionId }
 */
router.post(
  '/check-conflicts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { sectionId } = req.body;

    if (!sectionId) throw new AppError('sectionId is required', 400);

    const section = await prisma.courseSection.findFirst({
      where: { id: sectionId },
      include: { slots: true },
    });
    if (!section) throw new AppError('Section not found', 404);

    if (section.enrolled >= section.capacity) {
      return res.json({
        success: true,
        hasConflict: true,
        reason: 'capacity',
        conflicts: [],
        availableSeats: 0,
      });
    }

    const existingSlots = await getUserActiveSlots(userId);
    const conflicts = detectConflicts(existingSlots, section.slots);

    res.json({
      success: true,
      hasConflict: conflicts.length > 0,
      conflicts,
      availableSeats: section.capacity - section.enrolled,
    });
  })
);

// ── POST /api/registrations/swap-section ─────────────────────────────────────

/**
 * POST /api/registrations/swap-section
 * Swap a student from one section to another within the same course.
 * Body: { registrationId, newSectionId }
 */
router.post(
  '/swap-section',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const { registrationId, newSectionId } = req.body;

    if (!registrationId || !newSectionId) {
      throw new AppError('registrationId and newSectionId are required', 400);
    }

    const registration = await prisma.registration.findFirst({
      where: { id: registrationId },
      include: { section: { include: { slots: true } } },
    });
    if (!registration) throw new AppError('Registration not found', 404);
    if (registration.userId !== userId) throw new AppError('Access denied', 403);
    if (!['pending', 'approved'].includes(registration.status)) {
      throw new AppError('Cannot swap a dropped or rejected registration', 409);
    }

    const newSection = await prisma.courseSection.findFirst({
      where: { id: newSectionId, courseId: registration.courseId },
      include: { slots: true },
    });
    if (!newSection) throw new AppError('Target section not found for this course', 404);
    if (newSection.id === registration.sectionId) {
      throw new AppError('Already registered for this section', 409);
    }
    if (newSection.enrolled >= newSection.capacity) {
      throw new AppError('Target section is at full capacity', 409);
    }

    const existingSlots = await getUserActiveSlots(userId, registration.sectionId);
    const conflicts = detectConflicts(existingSlots, newSection.slots);
    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Schedule conflict with target section',
        conflicts,
      });
    }

    const alreadyInNewSection = await prisma.registration.findFirst({
      where: {
        userId,
        sectionId: newSectionId,
        isActive: true,
        status: { in: ['pending', 'approved'] },
      },
    });
    if (alreadyInNewSection) {
      throw new AppError('Already have an active registration for the target section', 409);
    }

    await prisma.$transaction(async (tx) => {
      await tx.registrationSwap.create({
        data: {
          userId,
          fromRegistrationId: registrationId,
          toSectionId: newSectionId,
          status: 'approved',
        },
      });

      await tx.registration.update({
        where: { id: registrationId },
        data: { sectionId: newSectionId },
      });

      await tx.courseSection.update({
        where: { id: registration.sectionId },
        data: { enrolled: { decrement: 1 } },
      });
      await tx.courseSection.update({
        where: { id: newSectionId },
        data: { enrolled: { increment: 1 } },
      });
    });

    try {
      await chatSync.transferStudentBetweenSections(prisma, {
        userId,
        fromSectionId: registration.sectionId,
        toSectionId: newSectionId,
      });
    } catch (e) {
      console.warn('[registration] chat sync (swap) failed:', e.message);
    }

    res.json({ success: true, message: 'Section swapped successfully' });
  })
);

module.exports = router;
