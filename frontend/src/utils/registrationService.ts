/**
 * Course Registration Service
 * Handles course registration, conflict checking, and schedule management
 * Connects to Registration API Server on port 4002
 */

import { API_URLS } from '@shared/config';

// Dynamically determine API URL based on current host
// This allows the app to work from both desktop (localhost) and mobile (via IP)
const getApiBaseUrl = () => {
  return `${API_URLS.registration()}/api`;
};

const API_BASE_URL = getApiBaseUrl();

// Types
export interface TimeSlot {
  id?: string;
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  startTime?: string; // HH:MM format
  endTime?: string;   // HH:MM format
  start?: string;     // API format
  end?: string;       // API format
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

export interface Course {
  code: string;
  title: string;
  credits: number;
  department: string;
  description: string;
  prerequisites: string[];
  sections: CourseSection[];
  status?: string;
  totalSeats?: number;
  availableSeats?: number;
}

export interface RegisteredCourse {
  courseCode: string;
  sectionId: string;
  courseName?: string;
  credits?: number;
  registeredAt: string;
  course?: {
    title: string;
    credits: number;
    department: string;
  };
  section?: {
    type: string;
    instructor: string;
    location: string;
    slots: TimeSlot[];
  };
}

export interface ConflictInfo {
  hasConflict: boolean;
  conflictingCourse?: string;
  conflictingCourseName?: string;
  conflictingSlot?: TimeSlot;
  day?: string;
  newTime?: string;
  existingTime?: string;
  message?: string;
}

export interface RegistrationResult {
  success: boolean;
  message: string;
  conflicts?: ConflictInfo[];
  registeredCourse?: RegisteredCourse;
  registration?: RegisteredCourse;
  newTotalCredits?: number;
  canRegister?: boolean;
}

// ============ API FUNCTIONS ============

// Fetch all courses from API
export const fetchAllCourses = async (): Promise<Course[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/courses`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch courses');
    return await response.json();
  } catch (error) {
    console.error('Error fetching courses:', error);
    return getAllCourses(); // Fallback to local data
  }
};

// Fetch course by code from API
export const fetchCourseByCode = async (code: string): Promise<Course | null> => {
  try {
    const response = await fetch(`${API_BASE_URL}/courses/${code}`, { credentials: 'include' });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Error fetching course:', error);
    return getCourseByCode(code) || null;
  }
};

// Fetch user registrations from API
export const fetchUserRegistrations = async (userId: string): Promise<{
  registrations: RegisteredCourse[];
  totalCredits: number;
  courseCount: number;
}> => {
  try {
    const response = await fetch(`${API_BASE_URL}/registrations/${userId}`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch registrations');
    return await response.json();
  } catch (error) {
    console.error('Error fetching registrations:', error);
    const regs = getUserRegistrations(userId);
    return {
      registrations: regs,
      totalCredits: getTotalCredits(userId),
      courseCount: regs.length
    };
  }
};

// Check conflicts via API
export const checkConflictsAPI = async (
  userId: string,
  courseCode: string,
  sectionId: string
): Promise<RegistrationResult> => {
  try {
    const response = await fetch(`${API_BASE_URL}/registrations/check-conflicts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, courseCode, sectionId })
    });
    if (!response.ok) throw new Error('Failed to check conflicts');
    return await response.json();
  } catch (error) {
    console.error('Error checking conflicts:', error);
    const conflicts = checkConflicts(userId, courseCode, sectionId);
    return {
      success: conflicts.length === 0,
      message: conflicts.length > 0 ? 'Schedule conflict detected' : 'No conflicts',
      conflicts,
      canRegister: conflicts.length === 0
    };
  }
};

// Register for course via API — use RegistrationContext.registerForCourse() instead
// (backend now expects { lectureSectionId, labSectionId? }, not { courseCode, sectionId })
export const registerForCourseAPI = async (
  _userId: string,
  _courseCode: string,
  _sectionId: string
): Promise<RegistrationResult> => {
  console.warn('registerForCourseAPI is deprecated — use RegistrationContext.registerForCourse()');
  return { success: false, message: 'Use RegistrationContext.registerForCourse()' };
};

// Drop course via API
export const dropCourseAPI = async (
  userId: string,
  courseCode: string
): Promise<RegistrationResult> => {
  try {
    const response = await fetch(`${API_BASE_URL}/registrations/drop`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, courseCode })
    });
    if (!response.ok) throw new Error('Failed to drop course');
    return await response.json();
  } catch (error) {
    console.error('Error dropping course:', error);
    return dropCourse(userId, courseCode);
  }
};

// Swap section via API
export const swapSectionAPI = async (
  userId: string,
  courseCode: string,
  newSectionId: string
): Promise<RegistrationResult> => {
  try {
    const response = await fetch(`${API_BASE_URL}/registrations/swap-section`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, courseCode, newSectionId })
    });
    if (!response.ok) throw new Error('Failed to swap section');
    return await response.json();
  } catch (error) {
    console.error('Error swapping section:', error);
    return swapSection(userId, courseCode, newSectionId);
  }
};

// Fetch user schedule via API
export const fetchUserSchedule = async (userId: string): Promise<{
  schedule: Record<string, any[]>;
  totalCredits: number;
  courseCount: number;
}> => {
  try {
    const response = await fetch(`${API_BASE_URL}/schedule/${userId}`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch schedule');
    return await response.json();
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return {
      schedule: generateWeeklySchedule(userId),
      totalCredits: getTotalCredits(userId),
      courseCount: getUserRegistrations(userId).length
    };
  }
};

// Fetch departments list
export const fetchDepartments = async (): Promise<string[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/departments`, { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch departments');
    return await response.json();
  } catch (error) {
    console.error('Error fetching departments:', error);
    return [...new Set(getAllCourses().map(c => c.department))];
  }
};

// ============ LOCAL FALLBACK DATA ============
const coursesDatabase: Course[] = [
  {
    code: 'CS101',
    title: 'Introduction to Computer Science',
    credits: 3,
    department: 'Computer Science',
    description: 'Fundamental concepts of programming and computer science.',
    prerequisites: [],
    sections: [
      {
        id: 'CS101-LEC-A',
        type: 'Lecture',
        instructor: 'Dr. Alice Johnson',
        location: 'Building A, Room 101',
        capacity: 120,
        enrolled: 85,
        slots: [
          { id: 'cs101-l1', day: 'Monday', startTime: '10:00', endTime: '11:30' },
          { id: 'cs101-l2', day: 'Wednesday', startTime: '10:00', endTime: '11:30' }
        ]
      },
      {
        id: 'CS101-LEC-B',
        type: 'Lecture',
        instructor: 'Dr. Bob Smith',
        location: 'Building A, Room 102',
        capacity: 100,
        enrolled: 98,
        slots: [
          { id: 'cs101-l3', day: 'Tuesday', startTime: '14:00', endTime: '15:30' },
          { id: 'cs101-l4', day: 'Thursday', startTime: '14:00', endTime: '15:30' }
        ]
      },
      {
        id: 'CS101-LAB-1',
        type: 'Lab',
        instructor: 'TA Sarah Wilson',
        location: 'Computer Lab 201',
        capacity: 30,
        enrolled: 25,
        slots: [
          { id: 'cs101-lab1', day: 'Friday', startTime: '09:00', endTime: '11:00' }
        ]
      },
      {
        id: 'CS101-LAB-2',
        type: 'Lab',
        instructor: 'TA Mike Brown',
        location: 'Computer Lab 202',
        capacity: 30,
        enrolled: 30,
        slots: [
          { id: 'cs101-lab2', day: 'Friday', startTime: '13:00', endTime: '15:00' }
        ]
      }
    ]
  },
  {
    code: 'MA203',
    title: 'Calculus III',
    credits: 4,
    department: 'Mathematics',
    description: 'Multivariable calculus and vector analysis.',
    prerequisites: ['MA201', 'MA202'],
    sections: [
      {
        id: 'MA203-LEC-A',
        type: 'Lecture',
        instructor: 'Prof. David Chen',
        location: 'Math Building, Room 301',
        capacity: 80,
        enrolled: 72,
        slots: [
          { id: 'ma203-l1', day: 'Monday', startTime: '09:00', endTime: '10:00' },
          { id: 'ma203-l2', day: 'Wednesday', startTime: '09:00', endTime: '10:00' },
          { id: 'ma203-l3', day: 'Friday', startTime: '09:00', endTime: '10:00' }
        ]
      },
      {
        id: 'MA203-TUT-1',
        type: 'Tutorial',
        instructor: 'TA Emily Park',
        location: 'Math Building, Room 105',
        capacity: 25,
        enrolled: 20,
        slots: [
          { id: 'ma203-t1', day: 'Tuesday', startTime: '16:00', endTime: '17:00' }
        ]
      }
    ]
  },
  {
    code: 'PH101',
    title: 'Introduction to Philosophy',
    credits: 3,
    department: 'Philosophy',
    description: 'Survey of major philosophical questions and thinkers.',
    prerequisites: [],
    sections: [
      {
        id: 'PH101-LEC-A',
        type: 'Lecture',
        instructor: 'Dr. Maria Garcia',
        location: 'Humanities Building, Room 201',
        capacity: 150,
        enrolled: 120,
        slots: [
          { id: 'ph101-l1', day: 'Tuesday', startTime: '11:00', endTime: '12:30' },
          { id: 'ph101-l2', day: 'Thursday', startTime: '11:00', endTime: '12:30' }
        ]
      },
      {
        id: 'PH101-SEM-1',
        type: 'Seminar',
        instructor: 'Dr. Maria Garcia',
        location: 'Humanities Building, Room 105',
        capacity: 20,
        enrolled: 18,
        slots: [
          { id: 'ph101-s1', day: 'Friday', startTime: '14:00', endTime: '16:00' }
        ]
      }
    ]
  },
  {
    code: 'PY200',
    title: 'General Psychology',
    credits: 3,
    department: 'Psychology',
    description: 'Introduction to the scientific study of behavior and mental processes.',
    prerequisites: [],
    sections: [
      {
        id: 'PY200-LEC-A',
        type: 'Lecture',
        instructor: 'Prof. James Lee',
        location: 'Science Building, Room 401',
        capacity: 200,
        enrolled: 200,
        slots: [
          { id: 'py200-l1', day: 'Monday', startTime: '13:00', endTime: '14:30' },
          { id: 'py200-l2', day: 'Wednesday', startTime: '13:00', endTime: '14:30' }
        ]
      }
    ]
  },
  {
    code: 'HI100',
    title: 'World History I',
    credits: 3,
    department: 'History',
    description: 'Survey of world history from ancient civilizations to 1500 CE.',
    prerequisites: [],
    sections: [
      {
        id: 'HI100-LEC-A',
        type: 'Lecture',
        instructor: 'Dr. Robert Taylor',
        location: 'History Building, Room 101',
        capacity: 100,
        enrolled: 100,
        slots: [
          { id: 'hi100-l1', day: 'Monday', startTime: '10:00', endTime: '11:00' },
          { id: 'hi100-l2', day: 'Wednesday', startTime: '10:00', endTime: '11:00' },
          { id: 'hi100-l3', day: 'Friday', startTime: '10:00', endTime: '11:00' }
        ]
      }
    ]
  }
];

// In-memory storage for user registrations (would be in database in production)
const userRegistrations: Map<string, RegisteredCourse[]> = new Map();

// Helper function to parse time string to minutes since midnight
const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Check if two time slots overlap
const doSlotsOverlap = (slot1: TimeSlot, slot2: TimeSlot): boolean => {
  if (slot1.day !== slot2.day) return false;

  // Handle both API format (start/end) and local format (startTime/endTime)
  const start1Str = slot1.startTime || slot1.start || '00:00';
  const end1Str = slot1.endTime || slot1.end || '00:00';
  const start2Str = slot2.startTime || slot2.start || '00:00';
  const end2Str = slot2.endTime || slot2.end || '00:00';

  const start1 = parseTimeToMinutes(start1Str);
  const end1 = parseTimeToMinutes(end1Str);
  const start2 = parseTimeToMinutes(start2Str);
  const end2 = parseTimeToMinutes(end2Str);

  // Check for overlap: slot1 starts before slot2 ends AND slot1 ends after slot2 starts
  return start1 < end2 && end1 > start2;
};

// Get all courses
export const getAllCourses = (): Course[] => {
  return coursesDatabase;
};

// Get course by code
export const getCourseByCode = (code: string): Course | undefined => {
  return coursesDatabase.find(c => c.code === code);
};

// Get available courses (with enrollment status)
export const getAvailableCourses = (): (Course & { status: string })[] => {
  return coursesDatabase.map(course => {
    const allFull = course.sections.every(s => s.enrolled >= s.capacity);
    const status = allFull ? 'Full' : 'Open';
    return { ...course, status };
  });
};

// Get user's current registrations
export const getUserRegistrations = (userId: string): RegisteredCourse[] => {
  return userRegistrations.get(userId) || [];
};

// Get user's current schedule (all time slots)
export const getUserSchedule = (userId: string): { course: Course; section: CourseSection; slots: TimeSlot[] }[] => {
  const registrations = getUserRegistrations(userId);
  const schedule: { course: Course; section: CourseSection; slots: TimeSlot[] }[] = [];

  for (const reg of registrations) {
    const course = getCourseByCode(reg.courseCode);
    if (course) {
      const section = course.sections.find(s => s.id === reg.sectionId);
      if (section) {
        schedule.push({ course, section, slots: section.slots });
      }
    }
  }

  return schedule;
};

// Check for schedule conflicts
export const checkConflicts = (userId: string, courseCode: string, sectionId: string): ConflictInfo[] => {
  const course = getCourseByCode(courseCode);
  if (!course) {
    return [{ hasConflict: true, message: 'Course not found' }];
  }

  const section = course.sections.find(s => s.id === sectionId);
  if (!section) {
    return [{ hasConflict: true, message: 'Section not found' }];
  }

  const userSchedule = getUserSchedule(userId);
  const conflicts: ConflictInfo[] = [];

  // Check each slot of the new section against existing schedule
  for (const newSlot of section.slots) {
    for (const scheduled of userSchedule) {
      for (const existingSlot of scheduled.slots) {
        if (doSlotsOverlap(newSlot, existingSlot)) {
          conflicts.push({
            hasConflict: true,
            conflictingCourse: scheduled.course.code,
            conflictingSlot: existingSlot,
            message: `Conflicts with ${scheduled.course.code} on ${newSlot.day} at ${newSlot.startTime}`
          });
        }
      }
    }
  }

  return conflicts;
};

// Check prerequisites
export const checkPrerequisites = (_userId: string, courseCode: string): { met: boolean; missing: string[] } => {
  const course = getCourseByCode(courseCode);
  if (!course) {
    return { met: false, missing: ['Course not found'] };
  }

  // Stub: production would check _userId's completed courses against course.prerequisites.
  const completedCourses = ['MA201', 'MA202', 'EN101']; // Mock completed courses
  const missing = course.prerequisites.filter(prereq => !completedCourses.includes(prereq));

  return { met: missing.length === 0, missing };
};

// Register for a course
export const registerForCourse = (
  userId: string,
  courseCode: string,
  sectionId: string
): RegistrationResult => {
  const course = getCourseByCode(courseCode);
  if (!course) {
    return { success: false, message: 'Course not found' };
  }

  const section = course.sections.find(s => s.id === sectionId);
  if (!section) {
    return { success: false, message: 'Section not found' };
  }

  // Check capacity
  if (section.enrolled >= section.capacity) {
    return { success: false, message: 'Section is full' };
  }

  // Check if already registered for this course
  const existingRegistrations = getUserRegistrations(userId);
  if (existingRegistrations.some(r => r.courseCode === courseCode)) {
    return { success: false, message: 'Already registered for this course' };
  }

  // Check prerequisites
  const prereqCheck = checkPrerequisites(userId, courseCode);
  if (!prereqCheck.met) {
    return {
      success: false,
      message: `Missing prerequisites: ${prereqCheck.missing.join(', ')}`
    };
  }

  // Check for conflicts
  const conflicts = checkConflicts(userId, courseCode, sectionId);
  if (conflicts.length > 0) {
    return {
      success: false,
      message: 'Schedule conflict detected',
      conflicts
    };
  }

  // Register the student
  const registration: RegisteredCourse = {
    courseCode,
    sectionId,
    registeredAt: new Date().toISOString()
  };

  if (!userRegistrations.has(userId)) {
    userRegistrations.set(userId, []);
  }
  userRegistrations.get(userId)!.push(registration);

  // Update enrolled count (in-memory)
  section.enrolled += 1;

  return {
    success: true,
    message: `Successfully registered for ${course.title}`,
    registeredCourse: registration
  };
};

// Drop a course
export const dropCourse = (userId: string, courseCode: string): RegistrationResult => {
  const registrations = userRegistrations.get(userId);
  if (!registrations) {
    return { success: false, message: 'No registrations found' };
  }

  const index = registrations.findIndex(r => r.courseCode === courseCode);
  if (index === -1) {
    return { success: false, message: 'Not registered for this course' };
  }

  const dropped = registrations.splice(index, 1)[0];

  // Update enrolled count
  const course = getCourseByCode(courseCode);
  if (course) {
    const section = course.sections.find(s => s.id === dropped.sectionId);
    if (section && section.enrolled > 0) {
      section.enrolled -= 1;
    }
  }

  return {
    success: true,
    message: `Successfully dropped ${courseCode}`
  };
};

// Swap sections within a course
export const swapSection = (
  userId: string,
  courseCode: string,
  newSectionId: string
): RegistrationResult => {
  const registrations = userRegistrations.get(userId);
  if (!registrations) {
    return { success: false, message: 'No registrations found' };
  }

  const existingReg = registrations.find(r => r.courseCode === courseCode);
  if (!existingReg) {
    return { success: false, message: 'Not registered for this course' };
  }

  const course = getCourseByCode(courseCode);
  if (!course) {
    return { success: false, message: 'Course not found' };
  }

  const newSection = course.sections.find(s => s.id === newSectionId);
  if (!newSection) {
    return { success: false, message: 'New section not found' };
  }

  if (newSection.enrolled >= newSection.capacity) {
    return { success: false, message: 'New section is full' };
  }

  // Temporarily remove from schedule for conflict check
  const oldSectionId = existingReg.sectionId;
  existingReg.sectionId = 'TEMP_REMOVED';

  // Check conflicts with new section
  const conflicts = checkConflicts(userId, courseCode, newSectionId);

  if (conflicts.length > 0) {
    existingReg.sectionId = oldSectionId; // Restore
    return {
      success: false,
      message: 'Schedule conflict with new section',
      conflicts
    };
  }

  // Update section
  const oldSection = course.sections.find(s => s.id === oldSectionId);
  if (oldSection && oldSection.enrolled > 0) {
    oldSection.enrolled -= 1;
  }
  newSection.enrolled += 1;
  existingReg.sectionId = newSectionId;

  return {
    success: true,
    message: `Successfully swapped to section ${newSectionId}`
  };
};

// Get total credits for a user
export const getTotalCredits = (userId: string): number => {
  const registrations = getUserRegistrations(userId);
  let totalCredits = 0;

  for (const reg of registrations) {
    const course = getCourseByCode(reg.courseCode);
    if (course) {
      totalCredits += course.credits;
    }
  }

  return totalCredits;
};

// Check if user can add more credits
export const canAddCredits = (userId: string, additionalCredits: number, maxCredits: number = 18): boolean => {
  const currentCredits = getTotalCredits(userId);
  return currentCredits + additionalCredits <= maxCredits;
};

// Generate weekly schedule view
export const generateWeeklySchedule = (userId: string): Record<string, { time: string; course: string; location: string; type: string }[]> => {
  const schedule = getUserSchedule(userId);
  const weekly: Record<string, { time: string; course: string; location: string; type: string }[]> = {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: [],
    Sunday: []
  };

  for (const item of schedule) {
    for (const slot of item.slots) {
      weekly[slot.day].push({
        time: `${slot.startTime} - ${slot.endTime}`,
        course: `${item.course.code}: ${item.course.title}`,
        location: item.section.location,
        type: item.section.type
      });
    }
  }

  // Sort each day by start time
  for (const day of Object.keys(weekly)) {
    weekly[day].sort((a, b) => {
      const timeA = parseTimeToMinutes(a.time.split(' - ')[0]);
      const timeB = parseTimeToMinutes(b.time.split(' - ')[0]);
      return timeA - timeB;
    });
  }

  return weekly;
};

export default {
  getAllCourses,
  getCourseByCode,
  getAvailableCourses,
  getUserRegistrations,
  getUserSchedule,
  checkConflicts,
  checkPrerequisites,
  registerForCourse,
  dropCourse,
  swapSection,
  getTotalCredits,
  canAddCredits,
  generateWeeklySchedule,
  // API functions
  fetchAllCourses,
  fetchCourseByCode,
  fetchUserRegistrations,
  checkConflictsAPI,
  registerForCourseAPI,
  dropCourseAPI,
  swapSectionAPI,
  fetchUserSchedule,
  fetchDepartments
};
