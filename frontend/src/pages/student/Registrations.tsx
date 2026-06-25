import React, { useMemo, useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useRegistration, Course, CourseSection } from '../../context/RegistrationContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../../i18n';
import { API_URLS } from '@shared/config';
import { apiFetch } from '../../utils/api';
import { useWindowsPolicy, getCurrentWindow, resolveWindow } from '../../utils/academicSettings';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

const RegStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    Open: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
    Full: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
    Closed: 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30'
  };
  return (
    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${colors[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  );
};

// Format time from 24h to 12h format
const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
};

// Result returned by `onRegister` so the EnrollmentView can render the right
// confirmation message. `levelGatePending` true means the row was accepted but
// routed to Student Affairs for approval (course level > student level); a
// regular success has `levelGatePending: false`.
interface RegisterCallbackResult {
  levelGatePending: boolean;
}

// Enrollment View Component - Requires selecting both Lecture AND Lab (unless lecture-only)
const EnrollmentView: React.FC<{
  course: Course;
  onBack: () => void;
  onRegister: (lectureSectionId: string, labSectionId: string | null) => Promise<RegisterCallbackResult>;
}> = ({ course, onBack, onRegister }) => {
  const t = useT();
  const [selectedLecture, setSelectedLecture] = useState<string | null>(null);
  const [selectedLab, setSelectedLab] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Separate lectures and labs
  const lectures = course.sections.filter(s => s.type === 'Lecture');
  const labs = course.sections.filter(s => s.type === 'Lab');

  // Check if this is a lecture-only course
  const isLectureOnly = labs.length === 0;

  // Check for conflicts between selected lecture and lab
  const checkInternalConflict = () => {
    if (isLectureOnly || !selectedLecture || !selectedLab) return null;

    const lecture = lectures.find(l => l.id === selectedLecture);
    const lab = labs.find(l => l.id === selectedLab);

    if (!lecture || !lab) return null;

    for (const lectureSlot of lecture.slots) {
      for (const labSlot of lab.slots) {
        if (lectureSlot.day === labSlot.day) {
          const parseTime = (time: string) => {
            const [h, m] = time.split(':').map(Number);
            return h * 60 + m;
          };
          const ls = parseTime(lectureSlot.start);
          const le = parseTime(lectureSlot.end);
          const lbs = parseTime(labSlot.start);
          const lbe = parseTime(labSlot.end);

          if (ls < lbe && le > lbs) {
            return `Lecture and Lab times conflict on ${lectureSlot.day}`;
          }
        }
      }
    }
    return null;
  };

  const internalConflict = checkInternalConflict();

  // Handle registration
  const handleConfirmEnrollment = async () => {
    if (!selectedLecture) {
      setMessage({ type: 'error', text: 'Please select a Lecture section' });
      return;
    }

    if (!isLectureOnly && !selectedLab) {
      setMessage({ type: 'error', text: 'Please select both a Lecture and a Lab section' });
      return;
    }

    if (internalConflict) {
      setMessage({ type: 'error', text: internalConflict });
      return;
    }

    setIsRegistering(true);
    setMessage(null);

    try {
      const outcome = await onRegister(selectedLecture, isLectureOnly ? null : selectedLab);
      if (outcome.levelGatePending) {
        // Backend wrote the row but tagged pendingReason='level_below_course'.
        // Tell the student explicitly that SA must review it; don't pretend
        // they're enrolled (they're not until SA approves).
        setMessage({ type: 'success', text: t('registrationsPage.sentToSaApproval') });
        setTimeout(() => onBack(), 2200);
      } else {
        setMessage({ type: 'success', text: `Successfully enrolled in ${course.title}!` });
        setTimeout(() => onBack(), 1500);
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to enroll. Please try again.' });
    } finally {
      setIsRegistering(false);
    }
  };

  const renderSection = (section: CourseSection, isSelected: boolean, onSelect: () => void) => {
    const isFull = section.enrolled >= section.capacity;

    return (
      <div
        key={section.id}
        className={`bg-white/30 dark:bg-[#0d0d0d] p-5 rounded-xl border transition-all cursor-pointer ${isSelected
          ? 'border-[#6A3FF4] ring-2 ring-[#6A3FF4]/30'
          : isFull
            ? 'border-gray-500/50 opacity-60 cursor-not-allowed'
            : 'border-gray-300/50 dark:border-[#363636] hover:border-[#6A3FF4]/50'
          }`}
        onClick={() => !isFull && onSelect()}
      >
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-medium text-black dark:text-white">
              {/* Role prefix tells the student who's running this section.
                  Lecture sections are led by a professor; Labs by a TA. The
                  underlying instructor name is set on the admin Manage Course
                  Detail page. */}
              {section.instructor
                ? `${section.type === 'Lab' ? 'TA' : 'Prof.'} ${section.instructor}`
                : 'Unassigned'}
            </p>
            <p className="text-gray-500 text-sm">{section.location}</p>
          </div>
          <div className="text-right">
            <span className={`text-sm font-semibold ${isFull ? 'text-red-500' : 'text-green-500'}`}>
              {section.capacity - section.enrolled} / {section.capacity} seats
            </span>
            {isFull && (
              <span className="block text-xs text-red-500 mt-1 font-bold">{t('registrationsPage.full')}</span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {/* Dedupe slots on the client — backend may serve dupes if it hasn't been restarted
              after the SectionSlot dedup fix; either way the user should never see "Tuesday, 11:30 AM – 1:00 PM" three times. */}
          {Array.from(
            new Map(
              section.slots.map((slot) => [`${slot.day}|${slot.start}|${slot.end}`, slot])
            ).values()
          ).map((slot, idx) => (
            <div key={idx} className="flex items-center text-gray-700 dark:text-gray-300 text-sm">
              <i className="ph-bold ph-calendar mr-2 text-[#6A3FF4]"></i>
              {slot.day}, {formatTime(slot.start)} - {formatTime(slot.end)}
            </div>
          ))}
        </div>

        {isSelected && (
          <div className="mt-3 flex items-center text-[#6A3FF4] text-sm font-medium">
            <i className="ph-bold ph-check-circle mr-1"></i> Selected
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors mb-4">
        <i className="ph-bold ph-arrow-left mr-2"></i> Back to Registrations
      </button>

      <div className={`${glassCardStyle} p-8`}>
        <div className="flex justify-between items-start mb-8 border-b border-gray-300/50 dark:border-[#363636] pb-6">
          <div>
            <h1 className="text-2xl font-bold text-black dark:text-white">{course.code}: {course.title}</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">{course.credits} Credits • {course.department}</p>
            {/* Plan 4 Phase 2 — language + category chips (FCDS Articles 7, 30, 31).
                Program affiliation was rolled into the department field
                (visible above as `course.department`). */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="bg-white/10 text-gray-300 border border-white/10 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                {course.language === 'ar' ? 'Arabic' : 'English'}
              </span>
              {course.category && (
                <span className="bg-[#6A3FF4]/15 text-[#7B5AFF] border border-[#6A3FF4]/30 rounded-full px-2 py-0.5 text-[10px] font-bold">
                  {String(course.category).replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {course.description && (
              <p className="text-gray-500 dark:text-gray-500 mt-2 text-sm">{course.description}</p>
            )}
          </div>
          <div className="text-right">
            <RegStatusBadge status={course.status || 'Open'} />
            <p className="text-gray-500 text-sm mt-2">{course.availableSeats} seats available</p>
          </div>
        </div>

        {/* Level-gate banner — fires on level mismatch (prereqs met,
            student level < course level). Backend will accept the
            registration but tag pendingReason='level_below_course' for
            SA review. Mirrors the row chip in the catalog. */}
        {course.levelGateActive && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 flex items-start gap-3">
            <i className="ph-bold ph-info text-amber-400 text-lg mt-0.5"></i>
            <div className="flex-1">
              <p className="text-amber-300 text-sm font-bold mb-1">
                {t('registrationsPage.needsSaApproval')}
              </p>
              <p className="text-amber-200/80 text-xs">
                {t('registrationsPage.levelGateTooltip')}
              </p>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 rounded-lg p-4 mb-6">
          <p className="text-[#6A3FF4] text-sm">
            <i className="ph-bold ph-info mr-2"></i>
            {isLectureOnly
              ? <>{t('registrationsPage.lectureOnlyHintPrefix')} <strong>{t('registrationsPage.lectureOnlyHintBold')}</strong> {t('registrationsPage.lectureOnlyHintBetween')} <strong>{t('registrationsPage.lectureOnlyHintLec')}</strong> {t('registrationsPage.lectureOnlyHintSuffix')}</>
              : <>{t('registrationsPage.lectureLabHintPrefix')} <strong>{t('registrationsPage.lectureLabHintLec')}</strong> {t('registrationsPage.lectureLabHintAnd')} <strong>{t('registrationsPage.lectureLabHintLab')}</strong> {t('registrationsPage.lectureLabHintSuffix')}</>
            }
          </p>
        </div>

        {/* Message display */}
        <AnimatePresence>
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-4 rounded-lg mb-6 ${message.type === 'success'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
                }`}
            >
              <i className={`ph-bold ${message.type === 'success' ? 'ph-check-circle' : 'ph-x-circle'} mr-2`}></i>
              <span className="whitespace-pre-line">{message.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Internal conflict warning */}
        {internalConflict && (
          <div className="bg-red-500/20 text-red-500 border border-red-500/30 rounded-lg p-4 mb-6">
            <i className="ph-bold ph-warning mr-2"></i>
            {internalConflict}
          </div>
        )}

        <div className={`grid grid-cols-1 ${isLectureOnly ? '' : 'lg:grid-cols-2'} gap-8`}>
          {/* Lecture Sections */}
          <section>
            <h2 className="text-lg font-semibold text-black dark:text-white mb-4 flex items-center">
              <i className="ph-bold ph-chalkboard-teacher mr-2 text-[#6A3FF4]"></i>
              {t('registrationsPage.lectureSectionsHeading')}
              {selectedLecture && <i className="ph-bold ph-check-circle ml-2 text-green-500"></i>}
            </h2>
            <div className="space-y-4">
              {lectures.map(section => renderSection(
                section,
                selectedLecture === section.id,
                () => setSelectedLecture(section.id)
              ))}
            </div>
          </section>

          {/* Lab Sections - Only show if not lecture-only */}
          {!isLectureOnly && (
            <section>
              <h2 className="text-lg font-semibold text-black dark:text-white mb-4 flex items-center">
                <i className="ph-bold ph-flask mr-2 text-[#6A3FF4]"></i>
                {t('registrationsPage.labSectionsHeading')}
                {selectedLab && <i className="ph-bold ph-check-circle ml-2 text-green-500"></i>}
              </h2>
              <div className="space-y-4">
                {labs.map(section => renderSection(
                  section,
                  selectedLab === section.id,
                  () => setSelectedLab(section.id)
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Selected Summary */}
        {(selectedLecture || selectedLab) && (
          <div className="mt-8 p-4 bg-white/20 dark:bg-black/30 rounded-xl border border-white/20 dark:border-white/10">
            <h3 className="font-semibold text-black dark:text-white mb-3">{t('registrationsPage.selectedSummary')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {selectedLecture && (
                <div>
                  <p className="text-[#6A3FF4] font-medium mb-1">{t('registrationsPage.lectureLabel')}</p>
                  {lectures.find(l => l.id === selectedLecture)?.slots.map((slot, idx) => (
                    <p key={idx} className="text-gray-600 dark:text-gray-400">
                      {slot.day}, {formatTime(slot.start)} - {formatTime(slot.end)}
                    </p>
                  ))}
                </div>
              )}
              {selectedLab && (
                <div>
                  <p className="text-[#6A3FF4] font-medium mb-1">{t('registrationsPage.labLabel')}</p>
                  {labs.find(l => l.id === selectedLab)?.slots.map((slot, idx) => (
                    <p key={idx} className="text-gray-600 dark:text-gray-400">
                      {slot.day}, {formatTime(slot.start)} - {formatTime(slot.end)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mobile bottom space: stack the action buttons + pad enough scroll
            room below the Confirm button so it can travel clear of the
            floating mobile nav bar + the viewport mask fade. Same fix the
            quiz page uses. Tailwind arbitrary-value calc combines the
            iPhone safe-area inset with the 8rem (128px) gap into a single
            padding-bottom declaration so they actually stack instead of
            overwriting each other in the cascade. `lg:pb-0` resets on
            desktop where the floating bar doesn't exist. */}
        <div className="flex flex-col-reverse sm:flex-row justify-end mt-8 pt-6 border-t border-gray-300/50 dark:border-[#363636] gap-3 sm:gap-4 pb-[calc(max(env(safe-area-inset-bottom,0px),34px)+8rem)] lg:pb-0">
          <button
            onClick={onBack}
            className="px-6 py-2.5 text-red-500 dark:text-red-400 font-semibold rounded-lg hover:bg-red-500/10 transition-colors"
          >
            {t('registrationsPage.cancelBtn')}
          </button>
          <button
            onClick={handleConfirmEnrollment}
            disabled={isRegistering || !selectedLecture || (!isLectureOnly && !selectedLab) || !!internalConflict}
            className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold px-8 py-2.5 rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isRegistering ? (
              <>
                <i className="ph-bold ph-spinner animate-spin mr-2"></i>
                {t('registrationsPage.enrolling')}
              </>
            ) : (
              <>
                <i className="ph-bold ph-check mr-2"></i>
                Confirm Enrollment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Main Registrations Component
const Registrations: React.FC = () => {
  const { searchTerm } = useAppContext();
  const t = useT();
  const {
    courses,
    registeredCourses,
    totalCredits,
    isLoading,
    error,
    registerForCourse,
    dropCourse,
    fetchCourses,
    fetchRegistrations
  } = useRegistration();

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [dropMessage, setDropMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [regStatus, setRegStatus] = useState<{ open: boolean; reason: string | null; activePeriod: { name: string; startDate: string; endDate: string } | null } | null>(null);

  // Refresh data on mount
  useEffect(() => {
    fetchCourses();
    fetchRegistrations();
  }, [fetchCourses, fetchRegistrations]);

  // Refresh again whenever the tab regains focus or the document becomes
  // visible. If an admin / SA dropped or force-enrolled this student on a
  // different surface while the page was idle, the seats counter + enrolled
  // list now reflect the new state without requiring a manual reload.
  // Also listens for a custom uniflow:registrations-updated event so any
  // other in-app surface can trigger a re-fetch directly (notification
  // socket can dispatch it when it sees a registration-change event).
  useEffect(() => {
    const refresh = () => {
      fetchCourses();
      fetchRegistrations();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('uniflow:registrations-updated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('uniflow:registrations-updated', refresh);
    };
  }, [fetchCourses, fetchRegistrations]);

  // Fetch the global registration status. If admin has flipped the kill-switch
  // off in /admin/registration-control, OR no period is open, the page renders
  // a closed banner instead of the picker — saves the student from clicking
  // through to a 403.
  useEffect(() => {
    fetch(`${API_URLS.registration()}/api/registration/status`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRegStatus(d); })
      .catch(() => {});
  }, []);

  // Filter courses based on search
  const filteredCourses = courses.filter(course =>
    course.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    course.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter out already registered courses
  const availableCourses = filteredCourses.filter(
    course => !registeredCourses.some(reg => reg.courseCode === course.code)
  );

  // Group registered rows by courseCode so a student enrolled in BOTH a
  // lecture and a lab section sees ONE card per course (not two). The drop
  // action still calls dropCourse(courseCode) which removes both sections.
  type RegRow = (typeof registeredCourses)[number];
  type GroupedReg = {
    courseCode: string;
    courseName: string;
    credits: number;
    sections: RegRow[];                  // every registration row for this course
    allSlots: { day?: string; start?: string; end?: string }[];
  };
  const filteredRegistered: GroupedReg[] = (() => {
    const map = new Map<string, GroupedReg>();
    for (const reg of registeredCourses) {
      const key = reg.courseCode;
      if (!map.has(key)) {
        map.set(key, {
          courseCode: reg.courseCode,
          courseName: reg.courseName,
          credits: reg.credits,
          sections: [],
          allSlots: [],
        });
      }
      const g = map.get(key)!;
      g.sections.push(reg);
      const slots = reg.section?.slots ?? [];
      for (const s of slots) {
        // Dedupe slots so labs that mirror a lecture's time don't render twice.
        const sig = `${s.day}|${s.start}|${s.end}`;
        if (!g.allSlots.some((x) => `${x.day}|${x.start}|${x.end}` === sig)) {
          g.allSlots.push(s);
        }
      }
    }
    const term = searchTerm.toLowerCase();
    return Array.from(map.values()).filter((g) =>
      g.courseCode.toLowerCase().includes(term) ||
      g.courseName.toLowerCase().includes(term),
    );
  })();

  // Handle registration - now takes both lecture and lab section IDs (lab can be null for lecture-only).
  //
  // Returns a status object so the EnrollmentView can render the right
  // confirmation message (regular success vs. level-gate "Sent to SA").
  // Throws on hard failure (the EnrollmentView catches and shows the message).
  const handleRegister = async (lectureSectionId: string, labSectionId: string | null): Promise<RegisterCallbackResult> => {
    if (!selectedCourse) return { levelGatePending: false };
    const result = await registerForCourse(selectedCourse.code, lectureSectionId, labSectionId);
    if (!result.success) {
      // Specific 403 paths first — backend annotates these with
      // structured fields the catalog can't always pre-empt (e.g. a stale
      // catalog tab held open across a term flip).
      if (result.error === 'Missing prerequisite(s)' && result.missingPrereqs && result.missingPrereqs.length > 0) {
        const list = result.missingPrereqs
          .map((p) => `${p.code} (min ${p.minGrade})`)
          .join(', ');
        throw new Error(t('registrationsPage.missingPrerequisite', { list }));
      }
      if (result.error === 'Course not offered this semester') {
        throw new Error(
          t('registrationsPage.semesterMismatch', {
            courseSemester: result.courseSemester ?? '?',
            currentSemester: result.currentSemester ?? '?',
          }),
        );
      }
      // Already-passed gate (HTTP 409 from backend). The backend's
      // `message` already reads as plain English ("You already passed
      // LA201 with grade A in Spring 2027. Re-enrollment is only allowed
      // after a failing attempt.") so we just surface it as-is.
      if (result.error === 'already_passed') {
        throw new Error(
          result.message
          || `You already passed this course. Re-enrollment is only allowed after a failing attempt.`,
        );
      }

      const baseMessage =
        result.message || (result as { error?: string }).error || 'Registration failed. Please try again.';
      // Surface backend conflict details so the user sees WHICH class clashes.
      // Backend conflict shape: { day, newSlot, existingSlot, existingSectionId }
      const conflicts = (result.conflicts || []) as Array<{
        day?: string;
        newSlot?: string;
        existingSlot?: string;
      }>;
      if (conflicts.length > 0) {
        // Dedupe conflict lines — backend may emit a cartesian product of identical
        // (day, newSlot, existingSlot) entries when overlapping sections share the same slot.
        const lines = Array.from(
          new Set(
            conflicts
              .map((c) =>
                c.day && c.newSlot && c.existingSlot
                  ? `• ${c.day}: this section's ${c.newSlot} clashes with your existing ${c.existingSlot}`
                  : null
              )
              .filter(Boolean) as string[]
          )
        );
        if (lines.length > 0) {
          throw new Error(`${baseMessage}\n${lines.join('\n')}`);
        }
      }
      throw new Error(baseMessage);
    }

    // Success path. `pending: true, reason: 'level_below_course'` means the
    // backend wrote the row but tagged it for SA review.
    const isLevelGate = result.pending === true && result.reason === 'level_below_course';
    return { levelGatePending: isLevelGate };
  };

  // Handle drop
  const handleDrop = async (courseCode: string) => {
    const result = await dropCourse(courseCode);
    if (result.success) {
      setDropMessage({ type: 'success', text: result.message ?? 'Course dropped.' });
    } else {
      setDropMessage({ type: 'error', text: result.message ?? result.error ?? 'Failed to drop course.' });
    }
    setTimeout(() => setDropMessage(null), 3000);
  };

  // Plan 4 Phase 3 — withdrawal handler. Hits the new endpoint that:
  //   1. Verifies we're in the withdrawal window
  //   2. Verifies attendance hasn't crossed the failAbsencePercent line
  //   3. Drops the registration AND files a 'W' on the transcript via cascade.
  const handleWithdraw = async (courseCode: string) => {
    if (!window.confirm(
      `Withdraw from ${courseCode}?\n\n` +
      `A 'W' grade will be recorded on your transcript. The course credits won't count toward your GPA, ` +
      `but the row stays on the transcript permanently. This is different from dropping.`
    )) return;
    try {
      const res = await apiFetch(
        `${API_URLS.registration()}/api/registrations/withdraw`,
        { method: 'POST', body: JSON.stringify({ courseCode }) },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDropMessage({ type: 'error', text: json?.error || `Withdraw failed (HTTP ${res.status})` });
      } else {
        setDropMessage({
          type: 'success',
          text: json?.message ?? `Withdrew from ${courseCode} — 'W' grade recorded.`,
        });
        await fetchRegistrations();
      }
    } catch (err) {
      setDropMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Withdraw failed.',
      });
    }
    setTimeout(() => setDropMessage(null), 4000);
  };

  // Plan 4 Phase 3 — resolve the active window once per render so the UI can
  // toggle the per-row action button between Drop and Withdraw, and show
  // a banner with the withdrawal close date when the window is open.
  const windowsPolicy = useWindowsPolicy();
  const currentWindow = useMemo(() => {
    if (!regStatus?.activePeriod) return 'closed' as const;
    return getCurrentWindow(regStatus.activePeriod, windowsPolicy);
  }, [regStatus, windowsPolicy]);
  const withdrawalDates = useMemo(() => {
    if (!regStatus?.activePeriod) return null;
    return resolveWindow(regStatus.activePeriod, windowsPolicy, 'withdrawal');
  }, [regStatus, windowsPolicy]);

  if (selectedCourse) {
    return (
      <EnrollmentView
        course={selectedCourse}
        onBack={() => setSelectedCourse(null)}
        onRegister={handleRegister}
      />
    );
  }

  return (
    <div className="pb-16 space-y-8">
      <AnimateOnView>
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('registrationsPage.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t('registrationsPage.subtitle')}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 text-sm">{t('registrationsPage.totalCredits')}: <span className="font-bold text-[#6A3FF4]">{totalCredits}/19</span></p>
          </div>
        </div>
      </AnimateOnView>

      {error && (
        <div className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 p-4 rounded-lg border border-yellow-500/30">
          <i className="ph-bold ph-warning mr-2"></i>
          {error}. Using offline data.
        </div>
      )}

      {/* Registration closed banner — appears when admin has disabled
          registration globally OR no registration period is currently open.
          Source: /api/registration/status. */}
      {regStatus && !regStatus.open && (
        <div className={`${glassCardStyle} p-6 border-yellow-500/30 bg-yellow-500/10`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <i className="ph-bold ph-lock-key text-2xl text-yellow-400"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-black dark:text-white font-bold text-lg">
                Registration is currently closed
              </h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">
                {regStatus.reason ?? 'Registration is not currently open.'}{' '}
                You can browse the catalog below but new registrations are paused
                until the next window opens.
              </p>
              {regStatus.activePeriod && (
                <p className="text-xs text-gray-500 mt-2">
                  Last known window: <strong>{regStatus.activePeriod.name}</strong>
                  {' '}({new Date(regStatus.activePeriod.startDate).toLocaleDateString()} →{' '}
                  {new Date(regStatus.activePeriod.endDate).toLocaleDateString()})
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Plan 4 Phase 3 — withdrawal-window banner. Shows when the active
          period is in the withdrawal phase (FCDS Article 15: weeks 4–12
          main / week 6 summer, by default). The Drop button on each
          registered course flips to Withdraw while this window is open. */}
      {currentWindow === 'withdrawal' && withdrawalDates && (
        <div className={`${glassCardStyle} p-5 border-purple-500/30 bg-purple-500/10`}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <i className="ph-bold ph-clock-counter-clockwise text-xl text-[#A855F7]"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-black dark:text-white font-bold">{t('registrationsPage.withdrawalBannerTitle')}</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">
                {t('registrationsPage.withdrawalBannerBody', {
                  date: withdrawalDates.end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }),
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plan 4 Phase 3 — late-registration banner. Reminds the student that
          new registrations submitted now route to SA for approval. */}
      {currentWindow === 'late' && (
        <div className={`${glassCardStyle} p-5 border-amber-500/30 bg-amber-500/10`}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
              <i className="ph-bold ph-warning-circle text-xl text-amber-300"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-black dark:text-white font-bold">{t('registrationsPage.lateBannerTitle')}</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">
                {t('registrationsPage.lateBannerBody')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Drop message */}
      <AnimatePresence>
        {dropMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-lg ${dropMessage.type === 'success'
              ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30'
              : 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
              }`}
          >
            <i className={`ph-bold ${dropMessage.type === 'success' ? 'ph-check-circle' : 'ph-x-circle'} mr-2`}></i>
            {dropMessage.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Available Courses */}
      <AnimateOnView delay={0.1}>
        <div className={`${glassCardStyle} p-6`}>
          <h3 className="text-xl font-bold text-black dark:text-white mb-6 flex items-center">
            <i className="ph-bold ph-book-open mr-2 text-[#6A3FF4]"></i> {t('registrationsPage.catalog')}
            {isLoading && <i className="ph-bold ph-spinner animate-spin ml-2 text-[#6A3FF4]"></i>}
          </h3>

          <div className="hidden md:grid grid-cols-[1fr_2fr_0.8fr_1.5fr_0.8fr_1fr] gap-4 px-4 pb-4 border-b border-gray-300/50 dark:border-[#363636] text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <div>{t('registrationsPage.tblCode')}</div>
            <div>{t('registrationsPage.tblTitle')}</div>
            <div>{t('registrationsPage.tblCredits')}</div>
            <div>{t('registrationsPage.tblDepartment')}</div>
            <div>{t('registrationsPage.tblStatus')}</div>
            <div className="text-right">{t('registrationsPage.tblAction')}</div>
          </div>

          <div className="divide-y divide-gray-300/50 dark:divide-[#363636]">
            {availableCourses.map((course) => {
              // Prereq tooltip — full list with title + min grade. Codes only
              // are shown inline so the row stays compact.
              const prereqs = course.prerequisites ?? [];
              const prereqCodes = prereqs.map((p) => p.code).join(', ');
              const prereqTooltip = prereqs
                .map((p) => `[${p.code}] ${p.title} — min ${p.minGrade}`)
                .join('\n');
              return (
                <div key={course.code} className="grid grid-cols-1 md:grid-cols-[1fr_2fr_0.8fr_1.5fr_0.8fr_1fr] gap-4 items-center px-4 py-4 text-sm hover:bg-white/30 dark:hover:bg-[#2d2d2d]/30 transition-colors rounded-lg">
                  <span className="text-black dark:text-white font-bold">{course.code}</span>
                  <div className="text-gray-700 dark:text-gray-300">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{course.title}</span>
                      {course.levelGateActive && (
                        // Backend says: prereqs met, but student level is below
                        // course level. Registering will route the row to SA.
                        <span
                          className="bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-full px-2 py-0.5 text-xs font-bold"
                          title={t('registrationsPage.levelGateTooltip')}
                        >
                          <i className="ph-bold ph-info mr-1"></i>
                          {t('registrationsPage.needsSaApproval')}
                        </span>
                      )}
                      {/* Plan 4 Phase 2 — language flag (Article 7). EN is
                          the default; only show the chip for Arabic since EN
                          is the assumption. */}
                      {course.language === 'ar' && (
                        <span
                          className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                          title={t('registrationsPage.taughtInArabic')}
                        >
                          AR
                        </span>
                      )}
                    </div>
                    {prereqs.length > 0 && (
                      <div
                        className="text-xs text-gray-500 mt-0.5"
                        title={prereqTooltip}
                      >
                        {t('registrationsPage.prerequisitesLabel')}: {prereqCodes}
                      </div>
                    )}
                  </div>
                  <span className="text-gray-600 dark:text-gray-400">{course.credits}</span>
                  <span className="text-gray-600 dark:text-gray-400">{course.department}</span>
                  <div><RegStatusBadge status={course.status || 'Open'} /></div>
                  <div className="text-right">
                    <button
                      onClick={() => setSelectedCourse(course)}
                      disabled={course.status === 'Full' || course.status === 'Closed'}
                      className={`font-semibold py-2 px-6 rounded-lg transition-all text-sm ${course.status === 'Full' || course.status === 'Closed'
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-[#6A3FF4] text-white hover:bg-[#5833CD]'
                        }`}
                    >
                      {course.status === 'Full' ? 'Full' : 'Enroll'}
                    </button>
                  </div>
                </div>
              );
            })}
            {availableCourses.length === 0 && (
              <div className="text-center py-10 text-gray-500">
                {searchTerm ? 'No courses found matching search criteria.' : 'No available courses.'}
              </div>
            )}
          </div>
        </div>
      </AnimateOnView>

      {/* Current Registrations */}
      <AnimateOnView delay={0.2}>
        <div className={`${glassCardStyle} p-6`}>
          <h3 className="text-xl font-bold text-black dark:text-white mb-6 flex items-center">
            <i className="ph-bold ph-check-circle mr-2 text-green-400"></i> {t('registrationsPage.myRegistrations')}
            <span className="ml-auto text-sm font-normal text-gray-500">{registeredCourses.length} • {totalCredits} {t('dashboard.creditsAbbr')}</span>
          </h3>

          {registeredCourses.length > 0 ? (
            <>
              <div className="hidden md:grid grid-cols-[1fr_2fr_0.8fr_2fr_1fr] gap-4 px-4 pb-4 border-b border-gray-300/50 dark:border-[#363636] text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <div>{t('registrationsPage.tblCode')}</div>
                <div>{t('registrationsPage.tblTitle')}</div>
                <div>{t('registrationsPage.tblCredits')}</div>
                <div>{t('registrationsPage.tblSchedule')}</div>
                <div className="text-right">{t('registrationsPage.tblAction')}</div>
              </div>

              <div className="divide-y divide-gray-300/50 dark:divide-[#363636]">
                {filteredRegistered.map((g) => {
                  // Section-type chips ("Lecture L1", "Lab B2") so the
                  // student sees both registered sections at a glance even
                  // though there's now one row per course.
                  const sectionChips = g.sections
                    .map((s) => {
                      const t = s.section?.type;
                      const sid = (s.section as { sectionId?: string } | undefined)?.sectionId;
                      if (!t) return null;
                      return sid ? `${t} ${sid}` : t;
                    })
                    .filter(Boolean) as string[];
                  return (
                    <div
                      key={g.courseCode}
                      className="grid grid-cols-1 md:grid-cols-[1fr_2fr_0.8fr_2fr_1fr] gap-4 items-center px-4 py-4 text-sm hover:bg-white/30 dark:hover:bg-[#2d2d2d]/30 transition-colors rounded-lg"
                    >
                      <div>
                        <div className="text-black dark:text-white font-bold">{g.courseCode}</div>
                        {sectionChips.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {sectionChips.map((chip, i) => (
                              <span
                                key={i}
                                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-[#6A3FF4]/15 text-[#7B5AFF] border-[#6A3FF4]/30"
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-gray-700 dark:text-gray-300">{g.courseName}</span>
                      <span className="text-gray-600 dark:text-gray-400">{g.credits}</span>
                      <div className="text-gray-600 dark:text-gray-400 text-xs">
                        {g.allSlots.slice(0, 4).map((slot, idx: number) => (
                          <div key={idx}>
                            {slot.day} {formatTime(slot.start ?? '')} - {formatTime(slot.end ?? '')}
                          </div>
                        ))}
                        {g.allSlots.length > 4 && (
                          <div className="text-[#6A3FF4]">+{g.allSlots.length - 4} more</div>
                        )}
                      </div>
                      <div className="text-right">
                        {currentWindow === 'withdrawal' ? (
                          <button
                            onClick={() => handleWithdraw(g.courseCode)}
                            className="border border-purple-500/30 text-[#A855F7] font-semibold py-2 px-4 rounded-lg hover:bg-purple-500/10 transition-colors text-sm"
                            title={t('registrationsPage.withdrawTooltip')}
                          >
                            {t('registrationsPage.withdrawButton')}
                          </button>
                        ) : currentWindow === 'add_drop' ? (
                          <button
                            onClick={() => handleDrop(g.courseCode)}
                            className="border border-red-500/30 text-red-500 dark:text-red-400 font-semibold py-2 px-4 rounded-lg hover:bg-red-500/10 transition-colors text-sm"
                            title={g.sections.length > 1 ? 'Drops both lecture and lab' : 'Drop course'}
                          >
                            {t('registrationsPage.dropButton')}
                          </button>
                        ) : (
                          // Outside both windows — neither action is available.
                          // Show a disabled placeholder so the column doesn't collapse.
                          <button
                            disabled
                            className="border border-gray-500/30 text-gray-500 font-semibold py-2 px-4 rounded-lg text-sm cursor-not-allowed"
                            title={t('registrationsPage.actionUnavailableTooltip')}
                          >
                            {t('registrationsPage.actionUnavailable')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-10 text-gray-500">
              <i className="ph-bold ph-book-open text-4xl mb-4 block opacity-50"></i>
              <p>{t('registrationsPage.emptyTitle')}</p>
              <p className="text-sm mt-2">{t('registrationsPage.emptyBody')}</p>
            </div>
          )}
        </div>
      </AnimateOnView>
    </div>
  );
};

export default Registrations;
