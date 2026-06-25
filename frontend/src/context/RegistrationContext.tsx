/**
 * Registration Context
 * Shares registered courses across the app (Registrations page and Timetable)
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { isPreviewSession } from '../utils/previewSession';

const API_BASE_URL = `${API_URLS.registration()}/api`;

export interface TimeSlot {
  day: string;
  start: string;
  end: string;
  timeFormatted?: string;
}

export interface CourseSection {
  id: string;
  type: 'Lecture' | 'Lab' | 'Tutorial' | 'Seminar';
  instructor: string;
  location: string;
  capacity: number;
  enrolled: number;
  available?: number;
  isFull?: boolean;
  slots: TimeSlot[];
}

/**
 * Backend-shaped prerequisite (from `GET /api/courses` and `GET /api/courses/:code`).
 * The legacy shape was `string[]` (codes only). The current backend returns
 * `{ code, title, minGrade }` per row so the UI can render a richer tooltip.
 */
export interface CoursePrerequisite {
  code: string;
  title: string;
  minGrade: string;
}

export interface Course {
  code: string;
  title: string;
  credits: number;
  department: string;
  description?: string;
  prerequisites?: CoursePrerequisite[];
  sections: CourseSection[];
  status?: 'Open' | 'Full' | 'Closed';
  availableSeats?: number;
  /**
   * Student-only annotation. True when the student has met all prereqs but is
   * below the course's required academic level — registering will mark the row
   * `pending` with `pendingReason='level_below_course'` for SA review.
   */
  levelGateActive?: boolean;
  /**
   * Semester lock: 'Fall' | 'Spring' | 'Summer' | null. Informational; the
   * backend already hides courses whose semester doesn't match the current term.
   */
  semester?: 'Fall' | 'Spring' | 'Summer' | null;
  /**
   * Plan 4 Phase 2 — language of instruction (FCDS Article 7). Drives the
   * EN/AR chip on the student catalog card.
   */
  language?: 'en' | 'ar';
  /**
   * Plan 4 Phase 2 — course category (FCDS Articles 30, 31). One of
   * 'university' | 'faculty_compulsory' | 'faculty_elective' |
   * 'program_compulsory' | 'program_elective' | 'training' | null.
   */
  category?: string | null;
}

export interface RegisteredCourse {
  /** DB id of the Registration row (when available). */
  id?: string;
  /** pending | approved | rejected | dropped */
  status?: string;
  courseCode: string;
  sectionId: string;
  courseName: string;
  credits: number;
  registeredAt: string;
  section?: {
    /** Human-readable section label as the registrar set it: "L1", "S1", … */
    sectionId?: string;
    type: string;
    instructor: string;
    /**
     * Display location — backend overrides this with the assigned hall's
     * name when one is set (canonical source via `hallName`), falling back
     * to the legacy free-text room field.
     */
    location: string;
    slots: TimeSlot[];
    /** Capacity + enrolled — backend hydrates these on every registration. */
    capacity?: number;
    enrolled?: number;
    /** Canonical assigned hall — wins over legacy `location` when set. */
    hallName?: string | null;
    hallBuilding?: string | null;
    hallRoom?: string | null;
  };
  /**
   * Pending-row metadata. Surfaced when the row is held in SA review.
   * `'level_below_course'` means the student registered for a course above
   * their level; null/undefined means an ordinary review queue entry.
   */
  pendingReason?: string | null;
  /** Free-text caption supplied by the backend, e.g. "Course level is 3, your level is 2". */
  pendingNote?: string | null;
}

export interface ConflictInfo {
  day: string;
  startTime: string;
  endTime: string;
  courseCode?: string;
  sectionType?: string;
}

export interface TimetableEntry {
  id: string;
  courseCode: string;
  title: string;
  type: string;
  instructor?: string;
  location?: string;
  day: string;
  startTime: string;
  // Section label as the registrar set it (e.g. "L1" for lecture, "S1"
  // for lab). Surfaced so the student timetable can show which parallel
  // section they're enrolled in when a course splits into multiple.
  sectionLabel?: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  canRegister: boolean;
  conflicts?: ConflictInfo[];
}

export interface MissingPrerequisite {
  code: string;
  title: string;
  minGrade: string;
}

export interface RegistrationResult {
  success: boolean;
  /**
   * Friendly message — present on most success/failure shapes. NOT present
   * on the structured 403s (e.g. Missing prerequisite(s)) where only `error`
   * is set; callers should fall back to `error` in that case.
   */
  message?: string;
  conflicts?: ConflictInfo[];
  registration?: RegisteredCourse;
  newTotalCredits?: number;
  /** Set when backend approved the row but routed it to SA for review. */
  pending?: boolean;
  /** Reason for `pending: true` (currently only `'level_below_course'`). */
  reason?: string;
  /** Backend error code on failure, e.g. 'Missing prerequisite(s)'. */
  error?: string;
  /** Populated on a 403 'Missing prerequisite(s)' response. */
  missingPrereqs?: MissingPrerequisite[];
  /** Populated on a 403 'Course not offered this semester' response. */
  courseSemester?: string;
  currentSemester?: string;
}

export interface RegistrationContextType {
  courses: Course[];
  registeredCourses: RegisteredCourse[];
  totalCredits: number;
  isLoading: boolean;
  error: string | null;
  isApiConnected: boolean;
  fetchCourses: () => Promise<void>;
  fetchRegistrations: () => Promise<void>;
  registerForCourse: (courseCode: string, lectureSectionId: string, labSectionId: string | null) => Promise<RegistrationResult>;
  dropCourse: (courseCode: string) => Promise<RegistrationResult>;
  checkConflicts: (courseCode: string, sectionId: string) => Promise<ConflictCheckResult>;
  getScheduleForTimetable: () => TimetableEntry[];
}

const RegistrationContext = createContext<RegistrationContextType | undefined>(undefined);

// Get current user ID
const getCurrentUserId = (): string => {
  return localStorage.getItem('currentUserEmail') || '';
};

export const RegistrationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [registeredCourses, setRegisteredCourses] = useState<RegisteredCourse[]>([]);
  const [totalCredits, setTotalCredits] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApiConnected, setIsApiConnected] = useState(false);

  const userId = getCurrentUserId();

  // Fetch all courses
  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/courses`, { credentials: 'include', headers: authHeaders() });
      if (!response.ok) throw new Error('Failed to fetch courses');
      const data = await response.json();
      setCourses(Array.isArray(data) ? data : (data.courses ?? []));
      setIsApiConnected(true);
      setError(null);
    } catch (err) {
      console.error('Error fetching courses:', err);
      setError('Could not connect to registration server');
      setIsApiConnected(false);
      // Use fallback data
      setCourses([
        { code: 'CS101', title: 'Introduction to Computer Science', credits: 3, department: 'Computer Science', status: 'Open', sections: [], availableSeats: 35 },
        { code: 'MA203', title: 'Calculus III', credits: 4, department: 'Mathematics', status: 'Open', sections: [], availableSeats: 8 },
        { code: 'PH101', title: 'Introduction to Philosophy', credits: 3, department: 'Philosophy', status: 'Open', sections: [], availableSeats: 30 },
        { code: 'PY200', title: 'General Psychology', credits: 3, department: 'Psychology', status: 'Full', sections: [], availableSeats: 0 },
        { code: 'HI100', title: 'World History I', credits: 3, department: 'History', status: 'Full', sections: [], availableSeats: 0 },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch user's registrations
  const fetchRegistrations = useCallback(async () => {
    if (!userId) {
      setRegisteredCourses([]);
      setTotalCredits(0);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/registrations/${userId}`, { credentials: 'include', headers: authHeaders() });
      if (!response.ok) throw new Error('Failed to fetch registrations');
      const data = await response.json();
      const rows: RegisteredCourse[] = data.registrations || [];
      // Backend regression probe: GET /api/registrations/:userId now hydrates
      // `pendingReason` + `pendingNote` server-side, so every pending row
      // should carry the metadata the level-gate UI on Courses.tsx needs.
      // This warn fires only if a pending row arrives without EITHER field —
      // which indicates the server endpoint stopped surfacing the columns
      // (regression), not the steady-state. Safe to leave in place.
      const pendingRowsMissingMeta = rows.some(
        (r) =>
          r.status === 'pending' &&
          r.pendingReason === undefined &&
          r.pendingNote === undefined,
      );
      if (pendingRowsMissingMeta) {
        // eslint-disable-next-line no-console
        console.warn(
          '[RegistrationContext] pending registrations missing pendingReason/pendingNote — likely a backend regression on GET /api/registrations/:userId.',
        );
      }
      setRegisteredCourses(rows);
      setTotalCredits(data.totalCredits || 0);
      setIsApiConnected(true);
    } catch (err) {
      console.error('Error fetching registrations:', err);
      setIsApiConnected(false);
      // Keep existing data or use empty
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // Register for a course - lab section ID can be null for lecture-only courses
  const registerForCourse = useCallback(async (courseCode: string, lectureSectionId: string, labSectionId: string | null): Promise<RegistrationResult> => {
    try {
      const body: { userId: string; courseCode: string; lectureSectionId: string; labSectionId?: string } = {
        userId,
        courseCode,
        lectureSectionId
      };

      // Only include labSectionId if it's not null
      if (labSectionId) {
        body.labSectionId = labSectionId;
      }

      const response = await fetch(`${API_BASE_URL}/registrations/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body)
      });
      const result = await response.json();

      if (result.success) {
        // Refresh registrations
        await fetchRegistrations();
        await fetchCourses();
        // Notify other open tabs / dashboards (admin CurrentCoursesCard,
        // Registrations card on student dashboard) that seat counts changed.
        window.dispatchEvent(new Event('uniflow:registrations-updated'));
        window.dispatchEvent(new Event('uniflow:courses-updated'));
      }

      return result;
    } catch (err) {
      console.error('Error registering:', err);
      return { success: false, message: 'Could not connect to registration server' };
    }
  }, [userId, fetchRegistrations, fetchCourses]);

  // Drop a course
  const dropCourse = useCallback(async (courseCode: string): Promise<RegistrationResult> => {
    try {
      const response = await fetch(`${API_BASE_URL}/registrations/drop`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, courseCode })
      });
      const result = await response.json();

      if (result.success) {
        // Refresh registrations
        await fetchRegistrations();
        await fetchCourses();
        // Notify other open tabs / dashboards (admin CurrentCoursesCard,
        // Registrations card on student dashboard) that seat counts changed.
        window.dispatchEvent(new Event('uniflow:registrations-updated'));
        window.dispatchEvent(new Event('uniflow:courses-updated'));
      }

      return result;
    } catch (err) {
      console.error('Error dropping course:', err);
      return { success: false, message: 'Could not connect to registration server' };
    }
  }, [userId, fetchRegistrations, fetchCourses]);

  // Check for conflicts
  const checkConflicts = useCallback(async (courseCode: string, sectionId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/registrations/check-conflicts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, courseCode, sectionId })
      });
      return await response.json();
    } catch (err) {
      console.error('Error checking conflicts:', err);
      return { hasConflict: false, canRegister: true };
    }
  }, [userId]);

  // Get schedule data for timetable
  const getScheduleForTimetable = useCallback(() => {
    const schedule: TimetableEntry[] = [];

    for (const reg of registeredCourses) {
      if (reg.section?.slots) {
        for (const slot of reg.section.slots) {
          // Map full day names to short names for timetable
          const dayMap: Record<string, string> = {
            'Monday': 'Mon', 'Tuesday': 'Tue', 'Wednesday': 'Wed',
            'Thursday': 'Thu', 'Friday': 'Fri', 'Saturday': 'Sat', 'Sunday': 'Sun'
          };

          // Determine section type based on slot position or section info
          const sectionType = reg.section.type?.includes('Lab') ? 'Lab' :
            reg.section.type?.includes('Lecture') ? 'Lecture' : 'Lecture';

          // Hall name first (single source of truth from course_sections.hall_id),
          // then legacy free-text location, then nothing. The student card
          // reads this into `event.location` and shows it on line 2.
          const hallText =
            reg.section.hallName?.trim()
            || reg.section.location?.split(',')[0]?.trim()
            || reg.section.location
            || '';
          schedule.push({
            id: `${reg.courseCode}-${slot.day}-${slot.start}`,
            courseCode: reg.courseCode,
            title: reg.courseName,
            type: sectionType,
            instructor: reg.section.instructor?.split(',')[0] || reg.section.instructor,
            location: hallText,
            day: dayMap[slot.day] || slot.day,
            startTime: slot.start,
            sectionLabel: reg.section.sectionId,
          });
        }
      }
    }

    return schedule;
  }, [registeredCourses]);

  // Initial load. Preview (mock-role) sessions skip it — they make no backend calls.
  useEffect(() => {
    if (isPreviewSession()) return;
    fetchCourses();
    fetchRegistrations();
  }, [fetchCourses, fetchRegistrations]);

  // Refresh on window focus / tab visible / explicit cross-page events so
  // seat counts (capacity + enrolled) and registration status reflect drops
  // and admin-side capacity edits that happen in other tabs. Without this
  // the catalog and Registrations card stay stale until full page reload.
  useEffect(() => {
    if (isPreviewSession()) return;
    const reload = () => {
      fetchCourses();
      fetchRegistrations();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    window.addEventListener('uniflow:courses-updated', reload);
    window.addEventListener('uniflow:registrations-updated', reload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', reload);
      window.removeEventListener('uniflow:courses-updated', reload);
      window.removeEventListener('uniflow:registrations-updated', reload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchCourses, fetchRegistrations]);

  return (
    <RegistrationContext.Provider
      value={{
        courses,
        registeredCourses,
        totalCredits,
        isLoading,
        error,
        isApiConnected,
        fetchCourses,
        fetchRegistrations,
        registerForCourse,
        dropCourse,
        checkConflicts,
        getScheduleForTimetable
      }}
    >
      {children}
    </RegistrationContext.Provider>
  );
};

export const useRegistration = (): RegistrationContextType => {
  const context = useContext(RegistrationContext);
  if (!context) {
    throw new Error('useRegistration must be used within a RegistrationProvider');
  }
  return context;
};

export default RegistrationContext;

