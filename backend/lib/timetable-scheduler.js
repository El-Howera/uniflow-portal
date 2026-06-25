// Timetable Scheduler — greedy first-fit assignment of CourseSection rows
// to (hall × day × time-slot) cells.
//
// Pure function, no DB access. Inputs are passed in; outputs are
// assignments + conflicts. The HTTP handler in registration-server is
// responsible for fetching, calling this, and persisting the result.
//
// Constraints enforced:
//   1. A hall cannot host two sections in the same slot.
//   2. An instructor cannot teach two sections in the same slot.
//   3. NO two sections of the same course can share a slot — even in
//      different halls. Sections are split for a reason (e.g. morning vs
//      evening cohorts), so the scheduler treats every Lecture/Lab of the
//      same course as mutually exclusive in time. Cross-course parallels
//      are always allowed (gated by hall + instructor only).
//   4. Section capacity must fit in hall capacity.
//
// Strategy:
//   - Sort sections by (capacity DESC, type='Lecture' first) so the largest /
//     hardest-to-place go first.
//   - For each section, scan the slot grid in (day, time) order and pick the
//     first cell + hall combo that satisfies every constraint.
//   - If no slot fits, record a conflict with a human reason.
//
// One slot per section per week (typical FCDS course structure: each section
// has one weekly meeting). Multi-meeting sections are out of scope for v1;
// they would require a second pass with the same algorithm.

const { buildSlotGrid } = require('./schedule-policy');

/**
 * @param {object} input
 * @param {Array<{ id, courseId, courseCode, courseTitle, type, capacity, instructorId, hallId, level?, departmentId? }>} input.sections
 * @param {Array<{ id, name, building?, room?, capacity, isActive }>} input.halls
 * @param {object} input.policy schedule policy (workingDays, slotMinutes, dayStart, dayEnd)
 * @param {Array<{ sectionId, day, startTime, endTime, hallId? }>} [input.lockedSlots] existing slots to keep busy (e.g. other-semester sections we don't touch)
 * @returns {{ assignments: Array<{ sectionId, hallId, day, startTime, endTime }>, conflicts: Array<{ sectionId, courseCode, type, reason }> }}
 */
function generateTimetable({ sections, halls, policy, lockedSlots = [] }) {
  const assignments = [];
  const conflicts = [];
  const grid = buildSlotGrid(policy);

  // Keyed busy maps so we can do O(1) collision checks.
  //   hallBusy:        `${hallId}|${day}|${start}`       → true
  //   instructorBusy:  `${instructorId}|${day}|${start}` → true
  //   courseBusy:      `${courseId}|${day}|${start}`     → true
  // courseBusy blocks ANY two sections of the same course from sharing a
  // (day, time) cell — splits exist precisely so cohorts attend different
  // times (e.g. L1 in the morning, L2 in the evening).
  const hallBusy = new Map();
  const instructorBusy = new Map();
  const courseBusy = new Map();

  // Pre-seed busy maps from locked slots. Locked slots come from skipped
  // in-scope sections AND from globally-committed background slots so a
  // dept-B run never double-books a hall a dept-A run already placed.
  for (const ls of lockedSlots) {
    const slotKey = `${ls.day}|${ls.startTime}`;
    if (ls.hallId) hallBusy.set(`${ls.hallId}|${slotKey}`, true);
    if (ls.instructorId) instructorBusy.set(`${ls.instructorId}|${slotKey}`, true);
    if (ls.courseId) courseBusy.set(`${ls.courseId}|${slotKey}`, true);
  }

  // Sort: largest sections first, lectures before labs (lectures usually
  // need bigger halls and are the gating constraint for the cohort schedule).
  const ordered = [...sections].sort((a, b) => {
    if (b.capacity !== a.capacity) return b.capacity - a.capacity;
    if (a.type === 'Lecture' && b.type !== 'Lecture') return -1;
    if (b.type === 'Lecture' && a.type !== 'Lecture') return 1;
    return 0;
  });

  // Pre-filter halls: only active halls big enough are candidates. Sorted
  // ascending by capacity so we use the smallest fitting hall first
  // (frees larger halls for sections that genuinely need them).
  const activeHalls = halls.filter((h) => h.isActive).sort((a, b) => a.capacity - b.capacity);

  for (const sec of ordered) {
    // Preferred hall: if the section has an assigned hallId, prefer it.
    const preferredHall = sec.hallId ? activeHalls.find((h) => h.id === sec.hallId) : null;
    const candidateHalls = preferredHall
      ? [preferredHall, ...activeHalls.filter((h) => h.id !== preferredHall.id)]
      : activeHalls;

    // Filter to halls that physically fit the roster.
    const fittingHalls = candidateHalls.filter((h) => h.capacity >= sec.capacity);

    if (fittingHalls.length === 0) {
      conflicts.push({
        sectionId: sec.id,
        courseCode: sec.courseCode,
        type: sec.type,
        reason: `No active hall has capacity >= ${sec.capacity}.`,
      });
      continue;
    }

    let placed = false;
    outer: for (const slot of grid) {
      const slotKey = `${slot.day}|${slot.startTime}`;
      // Constraint 2: instructor free?
      if (sec.instructorId && instructorBusy.has(`${sec.instructorId}|${slotKey}`)) continue;
      // Constraint 3: any other section of the same course already at this
      // slot? Block — splits are deliberate cohort separations.
      if (courseBusy.has(`${sec.courseId}|${slotKey}`)) continue;
      // Constraint 1 + 4: find a hall free in this slot.
      for (const hall of fittingHalls) {
        if (hallBusy.has(`${hall.id}|${slotKey}`)) continue;
        // Place it.
        assignments.push({
          sectionId: sec.id,
          courseId: sec.courseId,
          courseCode: sec.courseCode,
          courseTitle: sec.courseTitle,
          type: sec.type,
          capacity: sec.capacity,
          hallId: hall.id,
          hallName: hall.name,
          hallRoom: hall.room || null,
          hallBuilding: hall.building || null,
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          instructorId: sec.instructorId,
        });
        hallBusy.set(`${hall.id}|${slotKey}`, true);
        if (sec.instructorId) instructorBusy.set(`${sec.instructorId}|${slotKey}`, true);
        courseBusy.set(`${sec.courseId}|${slotKey}`, true);
        placed = true;
        break outer;
      }
    }

    if (!placed) {
      conflicts.push({
        sectionId: sec.id,
        courseCode: sec.courseCode,
        type: sec.type,
        reason: 'No (hall × time slot) cell satisfies every constraint. Try expanding working days or slot window, or freeing instructor schedule.',
      });
    }
  }

  return { assignments, conflicts };
}

module.exports = { generateTimetable };
