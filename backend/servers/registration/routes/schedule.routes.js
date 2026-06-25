/**
 * registration/routes/schedule.routes.js
 *
 * Weekly schedule endpoint:
 *
 *   GET /api/schedule/:userId — weekly schedule for a user
 *
 * Students can view their own schedule. SA/admin can view any user's.
 */

const express = require('express');
const router = express.Router();

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { resolveUser } = require('../../../lib/users');
const { parseTime, dedupeSlots } = require('../lib/section-helpers');

/**
 * GET /api/schedule/:userId
 * Weekly schedule for a user.
 */
router.get('/:userId', requireAuth, asyncHandler(async (req, res) => {
  // Resolve email/odId/cuid → user (frontend passes email here too).
  const rawParam = req.params.userId === 'current' ? req.user.userId : req.params.userId;
  const resolvedUser = await resolveUser(rawParam);
  if (!resolvedUser) throw new AppError('User not found', 404);
  const targetUserId = resolvedUser.id;

  if (
    targetUserId !== req.user.userId &&
    !['sa', 'admin'].includes(req.user.role)
  ) {
    throw new AppError('Access denied', 403);
  }

  const registrations = await prisma.registration.findMany({
    where: {
      userId: targetUserId,
      isActive: true,
      status: { in: ['pending', 'approved'] },
    },
    include: {
      course: { select: { code: true, title: true, credits: true } },
      section: {
        include: { slots: true },
      },
    },
  });

  const days = [
    'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  ];
  const schedule = Object.fromEntries(days.map((d) => [d, []]));

  for (const reg of registrations) {
    for (const slot of dedupeSlots(reg.section.slots)) {
      if (schedule[slot.day] !== undefined) {
        schedule[slot.day].push({
          registrationId: reg.id,
          courseCode: reg.course.code,
          courseName: reg.course.title,
          credits: reg.course.credits,
          sectionId: reg.section.id,
          sectionType: reg.section.type,
          startTime: slot.startTime,
          endTime: slot.endTime,
          location: reg.section.location,
          room: reg.section.room ?? slot.room,
          instructorName: reg.section.instructorName,
          status: reg.status,
        });
      }
    }
  }

  // Sort each day by start time
  for (const day of days) {
    schedule[day].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));
  }

  const uniqueCourseIds = [...new Set(registrations.map((r) => r.courseId))];
  const totalCredits = registrations
    .filter((r, i, arr) => arr.findIndex((x) => x.courseId === r.courseId) === i)
    .reduce((sum, r) => sum + (r.course.credits || 0), 0);

  res.json({
    success: true,
    schedule,
    totalCredits,
    courseCount: uniqueCourseIds.length,
  });
}));

module.exports = router;
