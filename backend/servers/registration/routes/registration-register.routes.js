/**
 * registration/routes/registration-register.routes.js
 *
 * Core registration creation endpoint:
 *
 *   POST /api/registrations/register — enrol in lecture + optional lab
 *
 * This is the most complex route in the server. It enforces, in order:
 *   1. Global registrationEnabled flag + active period
 *   2. Window policy (main / late / withdrawal / closed)
 *   3. Eligibility (semester lock, missing prereqs) — students only
 *   4. Section existence + single-course constraint
 *   5. Capacity check
 *   6. Schedule-conflict check
 *   7. Credit-hour cap check
 *   8. Academic-advisor gate
 *   9. Academic probation check
 *  10. Upsert Registration rows + tag pending_reason via raw SQL
 *  11. Chat-sync + notification
 *
 * Output: 201 with { pending: boolean, registrations: [...] }.
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');
const { getCreditLimit, getCreditLimitPolicy } = require('../../../lib/credit-limits');
const { evaluateCourse } = require('../../../lib/course-eligibility');
const { getWindowsPolicy, getCurrentWindow } = require('../../../lib/registration-windows');
const { getAdvisorPolicy, evaluateAdvisorGate } = require('../../../lib/advisor-policy');
const chatSync = require('../../../lib/chat-sync');

const { detectConflicts, getUserActiveSlots } = require('../lib/section-helpers');
const { findActivePeriod, notifyStudent } = require('../lib/period-helpers');

// ── Zod schemas ───────────────────────────────────────────────────────────────

const registerSchema = z.object({
  lectureSectionId: z.string().cuid('Invalid lectureSectionId'),
  labSectionId: z.string().cuid('Invalid labSectionId').optional(),
});

// ── POST /api/registrations/register ─────────────────────────────────────────

/**
 * POST /api/registrations/register
 * Register a student for lecture + optional lab sections.
 * Body: { userId?, lectureSectionId, labSectionId? }
 * userId in the body is ignored — identity comes from the JWT.
 */
router.post(
  '/register',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.userId;
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const { lectureSectionId, labSectionId } = parsed.data;
    const sectionIds = [lectureSectionId, labSectionId].filter(Boolean);

    // 1. Check the global registrationEnabled flag AND that an active period exists.
    const settings = await prisma.systemSettings.findFirst({
      select: { registrationEnabled: true },
    });
    if (settings && settings.registrationEnabled === false) {
      throw new AppError('Registration is currently disabled by the administrator.', 403);
    }
    const activePeriod = await findActivePeriod();
    if (!activePeriod) {
      throw new AppError(
        'Registration is not currently open. Ask an admin to open a registration period in Admin → Registration Control.',
        403,
      );
    }

    // 1b. Plan 4 Phase 3 — gate on the windows policy (Articles 13–15).
    const windowsPolicy = await getWindowsPolicy(prisma);
    const currentWindow = getCurrentWindow(activePeriod, windowsPolicy);
    if (currentWindow === 'closed') {
      throw new AppError('Registration window is closed for this period.', 403);
    }
    if (currentWindow === 'withdrawal') {
      throw new AppError(
        'Registration closed for this semester — only withdrawals are accepted now.',
        403,
      );
    }
    const isLateRegistration = currentWindow === 'late';

    // 2. Fetch all requested sections (lecture + optional lab)
    const sections = await prisma.courseSection.findMany({
      where: { id: { in: sectionIds } },
      include: { slots: true, course: true },
    });
    if (sections.length !== sectionIds.length) {
      throw new AppError('One or more sections not found', 404);
    }

    // All sections must belong to the same course
    const courseIds = [...new Set(sections.map(s => s.courseId))];
    if (courseIds.length !== 1) {
      throw new AppError('Lecture and lab sections must belong to the same course', 400);
    }
    const courseId = courseIds[0];
    const lectureSection = sections.find(s => s.id === lectureSectionId);

    // 2b. Eligibility gate (students only).
    let eligibility = null;
    if (req.user.role === 'student') {
      const courseForGate = await prisma.course.findFirst({
        where: { id: courseId },
        include: {
          prereqFor: {
            include: { prerequisiteCourse: { select: { code: true, title: true } } },
          },
        },
      });
      if (courseForGate) {
        eligibility = await evaluateCourse(prisma, userId, courseForGate);

        if (eligibility.semesterLocked) {
          const settingsForMsg = await prisma.systemSettings.findFirst({
            select: { currentSemester: true },
          });
          return res.status(403).json({
            success: false,
            error: 'Course not offered this semester',
            courseSemester: courseForGate.semester,
            currentSemester: settingsForMsg?.currentSemester ?? null,
          });
        }
        if (eligibility.missingPrereqs.length > 0) {
          return res.status(403).json({
            success: false,
            error: 'Missing prerequisite(s)',
            missingPrereqs: eligibility.missingPrereqs,
          });
        }

        // Already-passed gate. Owner directive: a student who has already
        // passed this course (any letter other than F/FW/W/I/AU on any
        // previous attempt's transcript row) is blocked from re-enrolling.
        // Failures are the ONLY case that opens re-enrollment so retake
        // logic stays meaningful. We read transcript_courses (which the
        // release cascade populates per attempt under the active period's
        // semester name) and look for any non-failing letter on the same
        // courseCode.
        try {
          const prior = await prisma.transcriptCourse.findMany({
            where: {
              userId,
              courseCode: courseForGate.code.toUpperCase(),
            },
            select: { grade: true, semester: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
          });
          if (prior.length > 0) {
            const NON_PASSING = new Set(['F', 'FW', 'W', 'I', 'AU', 'IP']);
            const passingRow = prior.find((r) => !NON_PASSING.has((r.grade || '').toUpperCase()));
            if (passingRow) {
              return res.status(409).json({
                success: false,
                error: 'already_passed',
                message: `You already passed ${courseForGate.code.toUpperCase()} with grade ${passingRow.grade}${passingRow.semester?.name ? ` in ${passingRow.semester.name}` : ''}. Re-enrollment is only allowed after a failing attempt.`,
                priorGrade: passingRow.grade,
                priorSemester: passingRow.semester?.name ?? null,
              });
            }
          }
        } catch (err) {
          // Fail-open on transcript read errors — better to allow a
          // re-enrollment than to lock a student out due to a query
          // failure. The cascade will still record their new attempt.
          console.warn('[registration] already-passed check skipped:', err.message);
        }
      }
    }

    // 3. Look up existing Registration rows for this user × these sections.
    const existingForSections = await prisma.registration.findMany({
      where: { userId, sectionId: { in: sectionIds } },
    });
    const activeBlocking = existingForSections.filter((r) =>
      ['pending', 'approved'].includes(r.status)
    );
    if (activeBlocking.length > 0) {
      throw new AppError('Already registered for one or more of these sections', 409);
    }
    const reusableBySection = new Map(
      existingForSections
        .filter((r) => !['pending', 'approved'].includes(r.status))
        .map((r) => [r.sectionId, r])
    );

    // 4. Capacity check for each section
    for (const sec of sections) {
      if (sec.enrolled >= sec.capacity) {
        throw new AppError(`Section ${sec.sectionId} (${sec.type}) is at full capacity`, 409);
      }
    }

    // 5. Schedule conflict check
    const existingSlots = await getUserActiveSlots(userId);
    const allNewSlots = sections.flatMap(sec => sec.slots);
    const conflicts = detectConflicts(existingSlots, allNewSlots);
    if (conflicts.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Schedule conflict detected',
        conflicts,
      });
    }

    // 5b. Credit-hour cap check
    const [academicProfile, systemSettings, activeRegs, creditPolicy] = await Promise.all([
      prisma.academicProfile.findUnique({ where: { userId } }),
      prisma.systemSettings.findFirst(),
      prisma.registration.findMany({
        where: { userId, isActive: true, status: { in: ['pending', 'approved'] } },
        include: { course: { select: { id: true, code: true, credits: true } } },
      }),
      getCreditLimitPolicy(prisma),
    ]);

    const seenCourseIds = new Set();
    let currentCredits = 0;
    for (const reg of activeRegs) {
      if (seenCourseIds.has(reg.courseId)) continue;
      seenCourseIds.add(reg.courseId);
      currentCredits += reg.course?.credits || 0;
    }

    const newCourseCredits = sections[0].course?.credits ?? 0;
    const prospectiveCredits = currentCredits + newCourseCredits;

    const { maxCredits, reason } = getCreditLimit({
      gpa: academicProfile?.gpa ?? 0,
      standing: academicProfile?.standing ?? 'Freshman',
      currentSemester: systemSettings?.currentSemester ?? '',
    }, creditPolicy);

    if (prospectiveCredits > maxCredits) {
      return res.status(409).json({
        success: false,
        error: 'Credit-hour limit exceeded',
        message:
          `This registration would bring you to ${prospectiveCredits} credit hours, ` +
          `but your cap is ${maxCredits} (${reason}). ` +
          `You currently have ${currentCredits} hours; this course adds ${newCourseCredits}. ` +
          `Drop another course first or contact Student Affairs for an exception.`,
        currentCredits,
        newCourseCredits,
        prospectiveCredits,
        maxCredits,
        reason,
      });
    }

    // 5c. Plan 4 Phase 8 — academic advisor gate (Article 12).
    let advisorRequired = false;
    let advisorGateReason = null;
    if (req.user.role === 'student') {
      try {
        const advisorPolicy = await getAdvisorPolicy(prisma);
        if (advisorPolicy.requireAdvisorApproval) {
          const advisorTenantId = getCurrentTenant();
          const advisorRows = await prisma.$queryRaw`
            SELECT academic_advisor_id AS "academicAdvisorId",
                   requires_advisor_approval AS "requiresAdvisorApproval"
              FROM users
             WHERE tenant_id = ${advisorTenantId} AND id = ${userId}
             LIMIT 1
          `;
          const studentRow = advisorRows?.[0] ?? {};
          const studentRequires = !!studentRow.requiresAdvisorApproval;
          if (studentRequires) {
            const hasAdvisor = !!studentRow.academicAdvisorId;
            const gate = evaluateAdvisorGate(
              { hasAssignedAdvisor: hasAdvisor, totalCredits: newCourseCredits },
              advisorPolicy,
            );
            advisorRequired = gate.requires;
            advisorGateReason = gate.reason || null;
          }
        }
      } catch (err) {
        console.warn('[registration] advisor gate eval failed:', err.message);
      }
    }

    // 5d. Probation check.
    let onProbation = false;
    if (req.user.role === 'student') {
      try {
        const standingTenantId = getCurrentTenant();
        const standingRows = await prisma.$queryRaw`
          SELECT academic_standing AS "academicStanding"
            FROM academic_profiles
           WHERE tenant_id = ${standingTenantId} AND user_id = ${userId}
           LIMIT 1
        `;
        const standing = standingRows?.[0]?.academicStanding;
        if (standing === 'probation' || standing === 'dismissed') {
          onProbation = true;
        }
      } catch (err) {
        console.warn('[registration] probation check failed:', err.message);
      }
    }

    // 6. Upsert each registration.
    const levelGated = !!eligibility?.levelGate;
    const courseLevel = (eligibility && (req.user.role === 'student'))
      ? (sections[0]?.course?.level ?? null)
      : null;
    const userLevelForNote = levelGated
      ? (await prisma.academicProfile.findUnique({
          where: { userId },
          select: { level: true },
        }))?.level ?? null
      : null;

    // Gatekeep toggle check
    let gatekeepEnabled = false;
    try {
      const gkTenantId = getCurrentTenant();
      const gkRows = await prisma.$queryRaw`
        SELECT registration_gatekeep_enabled AS "enabled"
          FROM system_settings
         WHERE tenant_id = ${gkTenantId}
         LIMIT 1
      `;
      if (gkRows?.[0] && typeof gkRows[0].enabled === 'boolean') {
        gatekeepEnabled = gkRows[0].enabled;
      }
    } catch (err) {
      console.warn('[registration] gatekeep lookup failed (defaulting OFF):', err.message);
    }

    const isStaffCaller = ['sa', 'admin'].includes(req.user.role);
    const requiresReview = !isStaffCaller && (
      gatekeepEnabled || levelGated || isLateRegistration || advisorRequired || onProbation
    );
    const newStatus = requiresReview ? 'pending' : 'approved';
    const initialApprovedById = null;

    const registrations = await prisma.$transaction(async (tx) => {
      const regs = [];
      for (const sec of sections) {
        const reusable = reusableBySection.get(sec.id);
        const reg = await tx.registration.upsert({
          where: { userId_sectionId: { userId, sectionId: sec.id } },
          create: {
            userId,
            courseId,
            sectionId: sec.id,
            status: newStatus,
            isActive: true,
            approvedById: initialApprovedById,
          },
          update: {
            status: newStatus,
            isActive: true,
            droppedAt: null,
            approvedById: initialApprovedById,
            registeredAt: new Date(),
          },
          include: {
            course: { select: { code: true, title: true } },
            section: { select: { sectionId: true, type: true } },
          },
        });
        regs.push(reg);

        const wasInactive = !reusable || ['dropped', 'rejected'].includes(reusable.status);
        if (wasInactive) {
          await tx.courseSection.update({
            where: { id: sec.id },
            data: { enrolled: { increment: 1 } },
          });
        }
      }

      await tx.studentEnrollment.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, courseCode: lectureSection.course.code },
        update: {},
      });

      return regs;
    });

    // 6b. Tag pending_reason on the just-written rows.
    try {
      const tagTenantId = getCurrentTenant();
      if (levelGated) {
        const note = `Course level is ${courseLevel ?? '?'}, your level is ${userLevelForNote ?? '?'}`;
        for (const r of registrations) {
          await prisma.$executeRawUnsafe(
            'UPDATE registrations SET pending_reason = $1, pending_note = $2 WHERE tenant_id = $3 AND id = $4',
            'level_below_course',
            note,
            tagTenantId,
            r.id,
          );
        }
      } else if (isLateRegistration) {
        const note = 'Submitted during the late-registration window — requires SA approval.';
        for (const r of registrations) {
          await prisma.$executeRawUnsafe(
            'UPDATE registrations SET pending_reason = $1, pending_note = $2 WHERE tenant_id = $3 AND id = $4',
            'late_registration',
            note,
            tagTenantId,
            r.id,
          );
        }
      } else if (advisorRequired) {
        const note = advisorGateReason === 'no_advisor_assigned'
          ? 'Advisor approval required but no advisor assigned. Contact Student Affairs.'
          : 'Awaiting academic advisor approval.';
        for (const r of registrations) {
          await prisma.$executeRawUnsafe(
            'UPDATE registrations SET pending_reason = $1, pending_note = $2 WHERE tenant_id = $3 AND id = $4',
            'advisor_approval',
            note,
            tagTenantId,
            r.id,
          );
        }
      } else if (onProbation) {
        const note = 'Student is on academic probation — registration requires Student Affairs review.';
        for (const r of registrations) {
          await prisma.$executeRawUnsafe(
            'UPDATE registrations SET pending_reason = $1, pending_note = $2 WHERE tenant_id = $3 AND id = $4',
            'probation',
            note,
            tagTenantId,
            r.id,
          );
        }
      } else {
        for (const r of registrations) {
          await prisma.$executeRawUnsafe(
            'UPDATE registrations SET pending_reason = NULL, pending_note = NULL WHERE tenant_id = $1 AND id = $2',
            tagTenantId,
            r.id,
          );
        }
      }
    } catch (sqlErr) {
      console.warn('[registration] pending_reason tagging failed:', sqlErr.message);
    }

    // 6c. Auto-enroll the student into each section's chat group.
    for (const r of registrations) {
      try {
        await chatSync.addStudentToSectionChat(prisma, {
          userId,
          sectionId: r.sectionId,
        });
      } catch (chatErr) {
        console.warn('[registration] chat sync (register) failed:', chatErr.message);
      }
    }

    // 7. Notification (fire and forget)
    const firstReg = registrations[0];
    let notifTitle = 'Registration Confirmed';
    let notifContent = `Your registration for ${firstReg.course.code} — ${firstReg.course.title} has been confirmed.`;
    if (requiresReview) {
      notifTitle = 'Registration Sent for Approval';
      const courseLabel = `${firstReg.course.code} — ${firstReg.course.title}`;
      if (levelGated) {
        notifContent = `Your registration for ${courseLabel} requires Student Affairs approval (your level is below the course level) and is pending review.`;
      } else if (isLateRegistration) {
        notifContent = `Your registration for ${courseLabel} was submitted in the late-registration window and is pending Student Affairs review.`;
      } else if (advisorRequired) {
        notifContent = `Your registration for ${courseLabel} requires academic advisor approval before Student Affairs review.`;
      } else if (onProbation) {
        notifContent = `Your registration for ${courseLabel} requires Student Affairs review because you are on academic probation.`;
      } else {
        notifContent = `Your registration for ${courseLabel} has been submitted and is pending approval.`;
      }
    }
    await notifyStudent(req.headers.authorization, {
      userId,
      title: notifTitle,
      content: notifContent,
      type: 'info',
    });

    if (requiresReview) {
      const reason = levelGated ? 'level_below_course'
        : isLateRegistration ? 'late_registration'
        : advisorRequired ? 'advisor_approval'
        : onProbation ? 'probation'
        : null;
      return res.status(201).json({
        success: true,
        pending: true,
        reason,
        message: 'Sent to Student Affairs for approval',
        registrations,
      });
    }
    res.status(201).json({
      success: true,
      pending: false,
      message: 'Registration confirmed',
      registrations,
    });
  })
);

module.exports = router;
