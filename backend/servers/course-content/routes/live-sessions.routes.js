/**
 * routes/live-sessions.routes.js — LiveSession CRUD + LiveKit token minting
 *
 * Owns:
 *   GET  /api/live-sessions/student/:userId  — upcoming/past sessions for a student
 *   GET  /api/sessions/:courseCode           — sessions for a course
 *   POST /api/sessions                       — create a session
 *   POST /api/sessions/:sessionId/join       — upsert attendee record
 *   PATCH /api/sessions/:sessionId           — update status/title/recording
 *   DELETE /api/sessions/:sessionId          — delete a session
 *   POST /api/sessions/:sessionId/livekit-token — mint a LiveKit room JWT
 *   GET  /api/sessions/by-id/:id             — single-session detail by id
 *   GET  /api/sessions/:sessionId/live-stats — live attendee count + elapsed time
 *   POST /api/sessions/:sessionId/recording-upload — upload recorded blob
 *
 * Non-obvious decisions:
 *   - /api/sessions/by-id/:id is declared BEFORE /api/sessions/:courseCode so Express
 *     does not swallow "by-id" as a courseCode param value.
 *   - /api/sessions/:sessionId/live-stats is declared BEFORE /api/sessions/:courseCode
 *     for the same Express-param-capture reason; same for the livekit-token route.
 *   - Recording upload uses the `recordingUpload` multer instance from lib/file-upload.js
 *     (1 GB cap, video-only filter). `restoreTenantContext` is applied AFTER multer
 *     so the tenant context survives the multipart body parse.
 *   - LiveKit credentials are optional at startup; the token endpoint throws 503 with
 *     a helpful setup message when LIVEKIT_API_KEY / LIVEKIT_API_SECRET are absent.
 *   - The PATCH handler fires a fire-and-forget broadcast notification when a session
 *     transitions to 'live'. If the notification server is unreachable the warning is
 *     logged but the response is already sent (200).
 */

'use strict';

const { Router } = require('express');
const prisma = require('../../../lib/prisma');
const { requireAuth, requireRole } = require('../../../lib/auth');
const { asyncHandler, AppError } = require('../../../lib/errors');
const { restoreTenantContext } = require('../../../lib/tenant-context');
const { resolveUser } = require('../../../lib/users');
const { recordingUpload } = require('../lib/file-upload');

const router = Router();

// ── Notification fan-out helper ───────────────────────────────────────────────
// Centralised so the three lifecycle events (schedule / start / end) all
// emit identically-shaped broadcast payloads.
//
//   - `body` is the colloquial name; the notification server expects `content`.
//     Earlier code sent `body` and got a silent 400 from the broadcast endpoint.
//   - `type: 'info'` because the broadcast endpoint only accepts the
//     NotificationType enum values (announcement / message / critical / info /
//     system). Custom strings get coerced to 'info' anyway.
//   - Fire-and-forget via setImmediate — the PATCH/POST response has already
//     gone out by the time this runs, so a slow / down notification server
//     never blocks the host's UI.
function fanOutSessionNotification({ authorization, courseCode, title, content, priority = 'normal' }) {
  setImmediate(async () => {
    try {
      const notifUrl = process.env.NOTIFICATION_URL || 'http://localhost:4009';
      await fetch(`${notifUrl}/api/notifications/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization || '',
        },
        body: JSON.stringify({
          courseCode,
          targetRole: 'student',
          title,
          content,
          type: 'info',
          priority,
        }),
      });
    } catch (err) {
      console.warn('[course-content] live-session notification failed:', err.message);
    }
  });
}

// Format a Date for the "scheduled for" notification. Locale-agnostic
// because the consumers are an English-language UI + the Arabic UI which
// already runs its own date formatting on the client; we only need a
// human-readable string for the notification body.
function formatScheduleDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── GET /api/live-sessions/student/:userId ────────────────────────────────────
// NOTE: This route's path prefix (/api/live-sessions) differs from the other
// routes in this file (/api/sessions). In index.js the router is mounted at
// /api with full paths internally.

router.get(
  '/live-sessions/student/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rawParam = req.params.userId === 'current' ? req.user.userId : req.params.userId;
    const resolved = await resolveUser(rawParam);
    if (!resolved) throw new AppError('User not found', 404);

    if (
      resolved.id !== req.user.userId &&
      !['sa', 'admin', 'professor', 'ta'].includes(req.user.role)
    ) {
      throw new AppError('Access denied', 403);
    }

    const regs = await prisma.registration.findMany({
      where: {
        userId: resolved.id,
        isActive: true,
        status: { in: ['pending', 'approved'] },
      },
      select: { courseId: true },
    });
    const courseIds = [...new Set(regs.map((r) => r.courseId))];
    if (courseIds.length === 0) return res.json({ upcoming: [], past: [] });

    const sessions = await prisma.liveSession.findMany({
      where: { courseId: { in: courseIds } },
      include: {
        course: { select: { id: true, code: true, title: true } },
        host: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    const now = new Date();
    const map = (s) => {
      const scheduled = s.scheduledFor || s.scheduledAt || null;
      const hasRecording = !!s.recordingUrl;
      const hostName = s.host ? `${s.host.firstName} ${s.host.lastName}` : 'TBA';
      return {
        id: s.id,
        title: s.title,
        description: s.description ?? '',
        courseId: s.courseId,
        courseCode: s.course.code,
        courseTitle: s.course.title,
        hostName,
        type: s.type,
        status: s.status,
        scheduledFor: scheduled,
        duration: s.duration,
        meetingUrl: s.meetingUrl || s.meetingLink || null,
        recordingUrl: s.recordingUrl || null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        hasRecording,
      };
    };

    const upcoming = [];
    const past = [];
    for (const s of sessions) {
      const mapped = map(s);
      const scheduled = s.scheduledFor || s.scheduledAt;
      const isFuture = scheduled ? new Date(scheduled) >= now : false;
      const isLive = s.status === 'live' || s.status === 'active';
      if (s.status === 'ended' || s.status === 'cancelled' || mapped.hasRecording) {
        past.push(mapped);
      } else if (isLive || s.status === 'scheduled' || isFuture) {
        upcoming.push(mapped);
      } else {
        past.push(mapped);
      }
    }

    upcoming.sort((a, b) => {
      const ta = a.scheduledFor ? new Date(a.scheduledFor).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.scheduledFor ? new Date(b.scheduledFor).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    past.sort((a, b) => {
      const ta = a.endedAt
        ? new Date(a.endedAt).getTime()
        : a.scheduledFor
        ? new Date(a.scheduledFor).getTime()
        : 0;
      const tb = b.endedAt
        ? new Date(b.endedAt).getTime()
        : b.scheduledFor
        ? new Date(b.scheduledFor).getTime()
        : 0;
      return tb - ta;
    });

    res.json({ upcoming, past });
  })
);

// ── GET /api/sessions/by-id/:id ───────────────────────────────────────────────
// Declared BEFORE /:courseCode to prevent Express swallowing "by-id" as param.

router.get(
  '/sessions/by-id/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.liveSession.findFirst({
      where: { id: req.params.id },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, email: true } },
        course: { select: { code: true, title: true } },
        _count: { select: { attendees: true } },
      },
    });
    if (!session) throw new AppError('Session not found', 404);
    res.json({
      id: session.id,
      title: session.title,
      description: session.description,
      courseCode: session.course?.code || session.courseCode,
      courseTitle: session.course?.title,
      hostName: session.host ? `${session.host.firstName} ${session.host.lastName}` : 'TBA',
      hostId: session.host?.id,
      meetingLink: session.meetingLink || session.meetingUrl,
      meetingUrl: session.meetingUrl || session.meetingLink,
      status: session.status,
      scheduledFor: session.scheduledFor,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      duration: session.duration,
      participants: session._count.attendees,
      recordingUrl: session.recordingUrl,
    });
  }),
);

// ── POST /api/sessions/:sessionId/livekit-token ───────────────────────────────
// Declared before /:sessionId/live-stats and /:courseCode (param-capture).

router.post(
  '/sessions/:sessionId/livekit-token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { config, validateLiveKit } = require('../../../lib/config');
    
    // Validate LiveKit is configured
    const validation = validateLiveKit();
    if (!validation.isValid) {
      throw new AppError(validation.error, 503);
    }
    
    const apiKey = config.livekit.apiKey;
    const apiSecret = config.livekit.apiSecret;
    const url = config.livekit.url;
    const session = await prisma.liveSession.findFirst({
      where: { id: sessionId },
      select: { id: true, hostId: true, courseCode: true },
    });
    if (!session) throw new AppError('Session not found', 404);

    const isHost = req.user.userId === session.hostId
      || ['admin', 'professor', 'ta'].includes((req.user.role || '').toLowerCase());

    const displayName = (req.user.firstName && req.user.lastName)
      ? `${req.user.firstName} ${req.user.lastName}`
      : (req.user.email || 'Guest');

    const { AccessToken } = require('livekit-server-sdk');
    const at = new AccessToken(apiKey, apiSecret, {
      identity: req.user.userId,
      name: displayName,
      ttl: 60 * 60 * 6, // 6 hours
    });
    at.addGrant({
      roomJoin: true,
      room: `uniflow-${sessionId}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: isHost,
    });
    const token = await at.toJwt();
    res.json({
      token,
      url,
      room: `uniflow-${sessionId}`,
      isHost,
      identity: req.user.userId,
      displayName,
    });
  }),
);

// ── GET /api/sessions/:sessionId/live-stats ───────────────────────────────────
// Declared before /:courseCode to avoid param capture.

router.get(
  '/sessions/:sessionId/live-stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.liveSession.findFirst({
      where: { id: req.params.sessionId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        endedAt: true,
        recordingUrl: true,
        _count: { select: { attendees: true } },
      },
    });
    if (!session) throw new AppError('Session not found', 404);
    res.json({
      sessionId: session.id,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      participants: session._count.attendees,
      recordingUrl: session.recordingUrl,
      elapsedSec: session.startedAt
        ? Math.max(
            0,
            Math.floor(((session.endedAt || new Date()).getTime() - new Date(session.startedAt).getTime()) / 1000),
          )
        : 0,
    });
  }),
);

// ── POST /api/sessions/:sessionId/recording-upload ────────────────────────────

router.post(
  '/sessions/:sessionId/recording-upload',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  (req, res, next) => {
    recordingUpload.single('recording')(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  restoreTenantContext,
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('recording file required', 400);
    const fileUrl = `/files/recordings/${req.file.filename}`;
    const session = await prisma.liveSession.update({
      where: { id: req.params.sessionId },
      data: {
        recordingUrl: fileUrl,
        status: 'ended',
        endedAt: new Date(),
      },
    });
    res.json({
      success: true,
      recordingUrl: fileUrl,
      sizeBytes: req.file.size,
      session,
    });
  }),
);

// ── POST /api/sessions/:sessionId/join ────────────────────────────────────────

router.post(
  '/sessions/:sessionId/join',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.userId;

    const attendee = await prisma.sessionAttendee.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      update: { joinedAt: new Date() },
      create: { sessionId, userId, joinedAt: new Date() },
    });

    res.json({ success: true, attendee });
  })
);

// ── PATCH /api/sessions/:sessionId ───────────────────────────────────────────

router.patch(
  '/sessions/:sessionId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    const { status, title, description, recordingUrl } = req.body;

    const data = {};
    if (status !== undefined) data.status = status;
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (recordingUrl !== undefined) data.recordingUrl = recordingUrl;
    if (status === 'live') data.startedAt = new Date();
    if (status === 'ended') data.endedAt = new Date();

    const session = await prisma.liveSession.update({
      where: { id: req.params.sessionId },
      data,
    });

    res.json({ success: true, session });

    // Fan-out lifecycle notifications to enrolled students.
    //
    //   live  → "is starting"            (no recording state needed)
    //   ended → "has ended"
    //           + replay availability    (read from session.recordingUrl which
    //                                     was either set in this same PATCH
    //                                     body or by a prior recording-upload
    //                                     POST that flipped status to 'ended'
    //                                     and populated recordingUrl)
    //
    // courseCode falls back to session.course.code so an explicit code in the
    // session row (legacy) and the relational join both work.
    const courseCode = session.courseCode || null;
    if (status === 'live' && courseCode) {
      fanOutSessionNotification({
        authorization: req.headers.authorization,
        courseCode,
        title: `${courseCode} live session starting`,
        content: `"${session.title}" is now live. Join now.`,
        priority: 'high',
      });
    }
    if (status === 'ended' && courseCode) {
      const hasReplay = !!session.recordingUrl;
      fanOutSessionNotification({
        authorization: req.headers.authorization,
        courseCode,
        title: `${courseCode} live session ended`,
        content: hasReplay
          ? `"${session.title}" has ended. Replay is available — open the lecture to watch.`
          : `"${session.title}" has ended. No replay was recorded.`,
        priority: 'normal',
      });
    }
  })
);

// ── DELETE /api/sessions/:sessionId ──────────────────────────────────────────

router.delete(
  '/sessions/:sessionId',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    await prisma.liveSession.delete({ where: { id: req.params.sessionId } });
    res.json({ success: true });
  })
);

// ── GET /api/sessions/:courseCode ─────────────────────────────────────────────
// Declared LAST — /:courseCode must not shadow more-specific sub-paths above.

router.get(
  '/sessions/:courseCode',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.liveSession.findMany({
      where: { course: { code: req.params.courseCode.toUpperCase() } },
      include: {
        host: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { attendees: true } },
      },
      orderBy: { scheduledFor: 'desc' },
    });

    res.json(sessions.map(s => ({
      ...s,
      hostName: `${s.host.firstName} ${s.host.lastName}`,
      participants: s._count.attendees,
    })));
  })
);

// ── POST /api/sessions ────────────────────────────────────────────────────────

router.post(
  '/sessions',
  requireAuth,
  requireRole(['professor', 'ta', 'admin']),
  asyncHandler(async (req, res) => {
    // Body convention drifted over time — the frontend Schedule form posts
    // `scheduledAt` but earlier code used `scheduledFor`. Accept either so a
    // change to one side doesn't silently drop the notification fan-out.
    const { courseCode, courseId, title, description, duration, type } = req.body;
    const scheduledFor = req.body.scheduledFor || req.body.scheduledAt;

    if (!title) throw new AppError('title required', 400);

    let resolvedCourseId = courseId;
    if (!resolvedCourseId && courseCode) {
      const course = await prisma.course.findFirst({ where: { code: courseCode.toUpperCase() } });
      if (!course) throw new AppError('Course not found', 404);
      resolvedCourseId = course.id;
    }
    if (!resolvedCourseId) throw new AppError('courseId or courseCode required', 400);

    const meetingBase = process.env.MEETING_URL_BASE || 'https://meet.jit.si/uniflow-';
    const roomSlug = `${(courseCode || 'session').toLowerCase()}-${Date.now()}`;

    const session = await prisma.liveSession.create({
      data: {
        courseId: resolvedCourseId,
        hostId: req.user.userId,
        courseCode: courseCode ? courseCode.toUpperCase() : undefined,
        title,
        description: description ?? null,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
        scheduledAt: scheduledFor ? new Date(scheduledFor) : new Date(),
        duration: duration ? parseInt(duration) : 60,
        type: type ?? 'lecture',
        status: 'scheduled',
        meetingLink: `${meetingBase}${roomSlug}`,
      },
    });

    res.status(201).json({ success: true, session });

    // Fan-out: announce the schedule date to every enrolled student so they
    // can put it on their calendar. Only fires when the host explicitly
    // provided a scheduledFor date AND the course is identifiable by code
    // (the broadcast endpoint resolves recipients by courseCode).
    if (session.courseCode && scheduledFor) {
      const when = formatScheduleDate(scheduledFor);
      fanOutSessionNotification({
        authorization: req.headers.authorization,
        courseCode: session.courseCode,
        title: `${session.courseCode} live session scheduled`,
        content: when
          ? `"${session.title}" is scheduled for ${when}.`
          : `"${session.title}" has been scheduled.`,
        priority: 'normal',
      });
    }
  })
);

module.exports = router;
