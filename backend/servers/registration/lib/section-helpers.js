/**
 * registration/lib/section-helpers.js
 *
 * Service-specific helpers for section CRUD and slot operations.
 *
 * Exports:
 *   parseTime(time)                           — HH:MM → minutes since midnight
 *   timesOverlap(s1, e1, s2, e2)              — overlap check on HH:MM ranges
 *   dedupeSlots(slots)                        — remove duplicate SectionSlot rows
 *   detectConflicts(existingSlots, newSlots)  — slot-vs-slot conflict report
 *   getUserActiveSlots(userId, excludeId?)    — active schedule slots for a user
 *   assertSectionHallValid({ hallId, cap })   — hall exists + active + capacity
 *   assertSectionCapacityWithinCourse(opts)   — per-type capacity vs course max
 *   loadSectionsForScope(filter)              — sections matching wizard filter
 *   loadActiveHalls()                         — active halls from bssid_locations
 */

const prisma = require('../../../lib/prisma');
const { AppError } = require('../../../lib/errors');
const { getCurrentTenant } = require('../../../lib/tenant-context');

// ── Time utilities ─────────────────────────────────────────────────────────────

/**
 * Parse HH:MM string → minutes since midnight.
 * Works with both "08:30" and "08:30:00".
 */
function parseTime(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Returns true when [s1,e1) overlaps [s2,e2) */
function timesOverlap(s1, e1, s2, e2) {
  return parseTime(s1) < parseTime(e2) && parseTime(e1) > parseTime(s2);
}

// ── Slot deduplication ────────────────────────────────────────────────────────

/**
 * Deduplicate slots by (day, startTime, endTime). The DB historically allows
 * duplicate SectionSlot rows for the same section + day + time (no unique index),
 * so seed re-runs accumulate dupes — without this guard the UI shows a slot 3x
 * and conflict detection produces O(n²) duplicate entries (e.g. 36 instead of 1).
 * Keeps the first occurrence (preserving the original `id`/`room` fields).
 */
function dedupeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  const seen = new Set();
  const out = [];
  for (const s of slots) {
    const key = `${s.day}|${s.startTime ?? s.start}|${s.endTime ?? s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── Conflict detection ────────────────────────────────────────────────────────

/**
 * Detect schedule conflicts between a set of new slots and existing user slots.
 * Returns an array of conflict descriptors (empty = no conflicts).
 * Both inputs are deduped first; output is also deduped on (day, newSlot, existingSlot).
 */
function detectConflicts(existingSlots, newSlots) {
  const dedupedExisting = dedupeSlots(existingSlots);
  const dedupedNew = dedupeSlots(newSlots);
  const seen = new Set();
  const conflicts = [];
  for (const ns of dedupedNew) {
    for (const es of dedupedExisting) {
      if (
        ns.day === es.day &&
        timesOverlap(ns.startTime, ns.endTime, es.startTime, es.endTime)
      ) {
        const key = `${ns.day}|${ns.startTime}-${ns.endTime}|${es.startTime}-${es.endTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          day: ns.day,
          newSlot: `${ns.startTime}–${ns.endTime}`,
          existingSlot: `${es.startTime}–${es.endTime}`,
          existingSectionId: es.sectionId,
        });
      }
    }
  }
  return conflicts;
}

// ── User active slots ─────────────────────────────────────────────────────────

/**
 * Fetch the active section slots for a user (excluding dropped registrations).
 * Returns an array of { day, startTime, endTime, sectionId }.
 */
async function getUserActiveSlots(userId, excludeSectionId = null) {
  const regs = await prisma.registration.findMany({
    where: {
      userId,
      status: { in: ['pending', 'approved'] },
      isActive: true,
      ...(excludeSectionId ? { sectionId: { not: excludeSectionId } } : {}),
    },
    include: {
      section: { include: { slots: true } },
    },
  });

  const slots = [];
  for (const reg of regs) {
    for (const slot of reg.section.slots) {
      slots.push({
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        sectionId: reg.sectionId,
        registrationId: reg.id,
      });
    }
  }
  return slots;
}

// ── Section guards ────────────────────────────────────────────────────────────

/**
 * Hall guard: when a section is being created or updated with a hallId, the
 * hall must exist, be active, and have capacity >= the section's capacity
 * (the room can't physically hold more students than its seat count).
 */
async function assertSectionHallValid({ hallId, sectionCapacity }) {
  if (!hallId) return; // null hall → nothing to check; "required on create" enforced by caller
  const tenantId = getCurrentTenant();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, location, capacity, is_active AS "isActive" FROM bssid_locations WHERE tenant_id = $1 AND id = $2`,
    tenantId, hallId,
  );
  const hall = rows?.[0];
  if (!hall) throw new AppError('Selected hall does not exist.', 400);
  if (!hall.isActive) throw new AppError(`Hall "${hall.name || hall.location}" is inactive.`, 400);
  if (sectionCapacity != null && sectionCapacity > hall.capacity) {
    throw new AppError(
      `Section capacity (${sectionCapacity}) exceeds hall "${hall.name || hall.location}" capacity (${hall.capacity}). Lower the section capacity, or pick a larger hall.`,
      400,
    );
  }
}

/**
 * Capacity guard: per-type section capacity totals must not exceed the
 * course's maxStudents. Lecture and Lab rosters are tracked independently —
 * each type group is summed separately and compared against the same
 * Course.maxStudents ceiling.
 *
 * Throws AppError(400) with a structured body when the requested capacity
 * would exceed the cap so the frontend can render an inline error pointing
 * at "edit Course capacity first".
 */
async function assertSectionCapacityWithinCourse({ courseId, type, requestedCapacity, excludeSectionId }) {
  const course = await prisma.course.findFirst({
    where: { id: courseId },
    select: { code: true, maxStudents: true },
  });
  if (!course) throw new AppError('Course not found', 404);

  const siblings = await prisma.courseSection.findMany({
    where: {
      courseId,
      type,
      ...(excludeSectionId ? { NOT: { id: excludeSectionId } } : {}),
    },
    select: { capacity: true },
  });
  const currentTotal = siblings.reduce((sum, s) => sum + (s.capacity || 0), 0);
  const projected = currentTotal + requestedCapacity;

  if (projected > course.maxStudents) {
    throw new AppError(
      `${type} sections for ${course.code} would total ${projected} seats, exceeding the course capacity of ${course.maxStudents}. Raise the course capacity first, or lower this section's capacity.`,
      400,
      {
        reason: 'course_capacity_exceeded',
        type,
        courseCapacity: course.maxStudents,
        currentTotal,
        attempted: requestedCapacity,
        projected,
      },
    );
  }
}

// ── Timetable wizard helpers ──────────────────────────────────────────────────

/**
 * Common helper: load sections matching the wizard filters.
 *
 * Filter shape:
 *   { departmentId?, level?, semester?, scope: 'all_lectures' | 'specific',
 *     courseIds?: string[], sectionIds?: string[], includeLabs?: boolean }
 *
 *   - scope='all_lectures': every section matching dept/level/semester
 *   - scope='specific':     intersection with courseIds (course-level
 *                           multi-pick) and/or sectionIds (lower-level pick)
 */
async function loadSectionsForScope(filter) {
  const where = {};
  // Course-level filters live on the Course relation.
  const courseFilter = {};
  if (filter.departmentId) courseFilter.departmentId = filter.departmentId;
  if (filter.level != null) courseFilter.level = filter.level;
  if (filter.semester) courseFilter.semester = filter.semester;
  if (Array.isArray(filter.courseIds) && filter.courseIds.length) {
    courseFilter.id = { in: filter.courseIds };
  }
  if (Object.keys(courseFilter).length) where.course = courseFilter;
  if (Array.isArray(filter.sectionIds) && filter.sectionIds.length) {
    where.id = { in: filter.sectionIds };
  }
  // Specific-scope safety: refuse to fan out across the whole catalog when
  // the admin picked 'specific' but supplied no courseIds + no sectionIds.
  if (filter.scope === 'specific' &&
      !(Array.isArray(filter.courseIds) && filter.courseIds.length) &&
      !(Array.isArray(filter.sectionIds) && filter.sectionIds.length)) {
    return [];
  }
  // Type filter: by default include lectures + labs. When includeLabs=false,
  // skip labs regardless of scope.
  const types = filter.includeLabs === false ? ['Lecture'] : ['Lecture', 'Lab'];
  where.type = { in: types };

  const sections = await prisma.courseSection.findMany({
    where,
    include: {
      course: { select: { code: true, title: true, departmentId: true, level: true, semester: true } },
    },
    orderBy: [{ course: { code: 'asc' } }, { type: 'asc' }, { sectionId: 'asc' }],
  });

  // Enrich with hallId via raw SQL (column not on typed client yet).
  if (sections.length > 0) {
    const ids = sections.map((s) => s.id);
    const tenantId = getCurrentTenant();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, hall_id AS "hallId" FROM course_sections WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      tenantId, ids,
    );
    const byId = new Map(rows.map((r) => [r.id, r.hallId]));
    for (const s of sections) s.hallId = byId.get(s.id) ?? null;
  }

  return sections.map((s) => ({
    id: s.id,
    sectionId: s.sectionId,
    courseId: s.courseId,
    courseCode: s.course?.code || '',
    courseTitle: s.course?.title || '',
    departmentId: s.course?.departmentId || null,
    level: s.course?.level ?? null,
    semester: s.course?.semester || null,
    type: s.type,
    capacity: s.capacity,
    enrolled: s.enrolled,
    instructorId: s.instructorId,
    instructorName: s.instructorName,
    hallId: s.hallId,
  }));
}

async function loadActiveHalls() {
  const tenantId = getCurrentTenant();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, building, room, capacity, is_active AS "isActive"
       FROM bssid_locations
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY capacity ASC`,
    tenantId,
  );
  return rows;
}

module.exports = {
  parseTime,
  timesOverlap,
  dedupeSlots,
  detectConflicts,
  getUserActiveSlots,
  assertSectionHallValid,
  assertSectionCapacityWithinCourse,
  loadSectionsForScope,
  loadActiveHalls,
};
