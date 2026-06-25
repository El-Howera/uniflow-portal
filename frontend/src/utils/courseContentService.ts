/**
 * Course Content Service
 * Handles course materials, file downloads, assignments, and progress tracking
 * Connects to Course Content API Server on port 4005
 */

import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const API_BASE_URL = `${API_URLS.courseContent()}/api`;

// ============ TYPES ============

export interface CourseMaterial {
  id: string;
  title: string;
  type: 'pdf' | 'slides' | 'video' | 'link' | 'document';
  size?: string;
  duration?: string;
  url?: string;
  fileName?: string;
  uploadedAt: string;
  isNew?: boolean;
  views?: number;
  downloadUrl?: string;
  watched?: boolean;
}

export interface LectureProgressResponse {
  success: boolean;
  progress: number;
  lectureId: string;
  isCompleted: boolean;
}

export interface Assignment {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  // Authoritative field on the Assignment Prisma model. The earlier `points`
  // field was a mock-only convention; backend always sends `maxScore`.
  maxScore: number;
  weight?: number;
  allowLate?: boolean;
  // Score change shown to a student when the assignment is past due with no
  // submission. Stored on the Assignment row (default -2). Set to 0 to hide.
  latePenalty?: number;
  instructions?: string;
  attachments?: string[];
  allowedFileTypes?: string[];
  maxSubmissions?: number;
  // 'missing' is computed server-side for past-due + no-submission cases.
  status?: 'pending' | 'submitted' | 'graded' | 'active' | 'closed' | 'missing';
  submissions?: Submission[];
  submissionsRemaining?: number;
  submissionId?: string | null;
  score?: number | null;
}

export interface Submission {
  id: string;
  courseCode: string;
  assignmentId: string;
  submittedAt: string;
  fileName: string;
  originalFileName?: string;
  status: 'submitted' | 'graded' | 'pending_review';
  isLate?: boolean;
  // Backend AssignmentSubmission stores `score` (Float?). The earlier `grade`
  // alias was mock-only; aliased `grade` getter retained below for any caller
  // we haven't migrated yet.
  score: number | null;
  feedback: string | null;
  gradedAt?: string | null;
  maxScore?: number;
  attemptNumber?: number;
  assignmentTitle?: string;
  courseTitle?: string;
}

export type QuizType = 'mcq' | 'written';

export interface QuizQuestion {
  id: string;
  type: QuizType;
  text: string;
  points: number;
  options?: string[]; // For MCQ
  correctAnswer?: string; // Only visible to professors
}

export interface Quiz {
  id: string;
  courseCode: string;
  title: string;
  description: string;
  timeLimit: number; // minutes
  dueDate: string;
  questions: QuizQuestion[];
  createdBy: string;
  questionCount?: number; // For list view
  // Scheduled-window anchor (ISO string). When set, the quiz is locked
  // before this moment and the global timer ends at startsAt + timeLimit.
  startsAt?: string | null;
  // Optional total-points override (used as gradebook column max).
  totalPoints?: number | null;
  // Optional audience targeting — empty / unset = whole course.
  audienceUserIds?: string[];
}

export interface QuizAnswer {
  questionId: string;
  userAnswer: string;
  type: QuizType;
  isCorrect?: boolean;
  pointsAwarded?: number;
}

export interface QuizSubmission {
  id: string;
  quizId: string;
  userId: string;
  courseCode: string;
  submittedAt: string;
  answers: QuizAnswer[];
  totalScore: number | null; // null if pending review
  // The DB field is `score` (the model column); some endpoints alias to
  // totalScore for back-compat. Both surface here so consumers can read
  // whichever the backend handed them.
  score?: number | null;
  maxPoints: number;
  status: 'graded' | 'pending_review' | 'in_progress' | 'submitted';
  // Stable anchor used by the timer-recovery flow on the student page.
  startedAt?: string;
}
export interface CourseRemark {
  id: string;
  title: string;
  content: string;
  date: string;
  important?: boolean;
}

export interface CourseProgress {
  completedLectures: string[];
  completedReadings: string[];
  progress: number;
  courseTitle?: string;
  totalLectures?: number;
  totalReadings?: number;
}

export interface CourseData {
  code: string;
  title: string;
  instructor: string;
  instructorEmail: string;
  description: string;
  credits: number;
  semester: string;
  progress?: number;
  lectures: CourseMaterial[];
  readings: CourseMaterial[];
  assignments: Assignment[];
  remarks: CourseRemark[];
}

export interface CourseSummary {
  code: string;
  title: string;
  instructor: string;
  credits: number;
  semester: string;
  lectureCount: number;
  assignmentCount: number;
}

// ============ API FUNCTIONS ============
//
// All endpoints below talk to the live backend. There used to be a
// `mockCourseData` block here injecting a hard-coded "Calculator Program"
// CS101 assignment whenever a fetch failed; that's been removed so the UI
// only ever shows what's actually in the database.

/**
 * Fetch all courses summary
 */
export const fetchAllCourses = async (): Promise<CourseSummary[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/courses`);
    if (!response.ok) throw new Error('Failed to fetch courses');
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return [];
  }
};

/**
 * Fetch course details by code
 */
export const fetchCourseByCode = async (
  courseCode: string,
  userId?: string
): Promise<CourseData | null> => {
  try {
    const url = userId
      ? `${API_BASE_URL}/courses/${courseCode}?userId=${userId}`
      : `${API_BASE_URL}/courses/${courseCode}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Course not found');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch course ${courseCode}:`, error);
    return null;
  }
};

/**
 * Fetch course materials (lectures + readings)
 */
export const fetchCourseMaterials = async (
  courseCode: string
): Promise<{ lectures: CourseMaterial[]; readings: CourseMaterial[] } | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/courses/${courseCode}/materials`);
    if (!response.ok) throw new Error('Failed to fetch materials');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch materials for ${courseCode}:`, error);
    return null;
  }
};

/**
 * Fetch course lectures with watched status
 */
export const fetchCourseLectures = async (
  courseCode: string,
  userId?: string
): Promise<CourseMaterial[]> => {
  try {
    const url = userId
      ? `${API_BASE_URL}/courses/${courseCode}/lectures?userId=${userId}`
      : `${API_BASE_URL}/courses/${courseCode}/lectures`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch lectures');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch lectures for ${courseCode}:`, error);
    return [];
  }
};

/**
 * Update lecture progress
 */
export const updateLectureProgress = async (
  courseCode: string,
  lectureId: string,
  userId: string,
  data: { position?: number; duration?: number; completed?: boolean }
): Promise<LectureProgressResponse | null> => {
  try {
    const response = await apiFetch(
      `${API_BASE_URL}/courses/${courseCode}/lectures/${lectureId}/progress`,
      {
        method: 'POST',
        body: JSON.stringify({ userId, ...data })
      }
    );
    if (!response.ok) throw new Error('Failed to update lecture progress');
    return await response.json();
  } catch (error) {
    console.warn('Lecture progress update failed');
    return null;
  }
};

/**
 * Fetch course assignments
 */
export const fetchCourseAssignments = async (
  courseCode: string,
  userId?: string
): Promise<Assignment[]> => {
  try {
    const url = userId
      ? `${API_BASE_URL}/courses/${courseCode}/assignments?userId=${userId}`
      : `${API_BASE_URL}/courses/${courseCode}/assignments`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch assignments');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch assignments for ${courseCode}:`, error);
    return [];
  }
};

/**
 * Download/view a material and track it
 */
export const downloadMaterial = async (
  courseCode: string,
  materialId: string,
  userId?: string
): Promise<{ success: boolean; downloadUrl?: string; material?: CourseMaterial }> => {
  try {
    const response = await apiFetch(
      `${API_BASE_URL}/courses/${courseCode}/materials/download/${materialId}`,
      {
        method: 'POST',
        body: JSON.stringify({ userId })
      }
    );
    if (!response.ok) throw new Error('Failed to get download URL');
    return await response.json();
  } catch (error) {
    console.error(`Failed to get download URL for material ${materialId}:`, error);
    return { success: false };
  }
};

/**
 * Mark material as completed
 */
export const markMaterialCompleted = async (
  courseCode: string,
  materialId: string,
  materialType: 'lecture' | 'reading',
  userId: string
): Promise<{ success: boolean; progress: number }> => {
  try {
    const response = await apiFetch(
      `${API_BASE_URL}/courses/${courseCode}/progress/${materialId}`,
      {
        method: 'POST',
        body: JSON.stringify({ userId, materialType })
      }
    );
    if (!response.ok) throw new Error('Failed to update progress');
    return await response.json();
  } catch (error) {
    console.warn('Progress update failed');
    return { success: false, progress: 0 };
  }
};

/**
 * Get user progress for all courses
 */
export const fetchUserProgress = async (
  userId: string
): Promise<Record<string, CourseProgress>> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/users/${userId}/progress`);
    if (!response.ok) throw new Error('Failed to fetch progress');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch progress for ${userId}:`, error);
    return {};
  }
};

/**
 * Get user submissions
 */
export const fetchUserSubmissions = async (
  userId: string,
  courseCode?: string
): Promise<Submission[]> => {
  try {
    const url = courseCode
      ? `${API_BASE_URL}/users/${userId}/submissions?courseCode=${courseCode}`
      : `${API_BASE_URL}/users/${userId}/submissions`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch submissions');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch submissions for ${userId}:`, error);
    return [];
  }
};

/**
 * Submit assignment
 */
export const submitAssignment = async (
  userId: string,
  courseCode: string,
  assignmentId: string,
  file: File
): Promise<{ success: boolean; message: string; submission?: Submission }> => {
  try {
    const formData = new FormData();
    formData.append('userId', userId);
    formData.append('courseCode', courseCode);
    formData.append('assignmentId', assignmentId);
    formData.append('file', file);

    const response = await apiFetch(`${API_BASE_URL}/submissions`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Submission failed' };
    }
    return data;
  } catch (error) {
    console.error('Error submitting assignment:', error);
    return { success: false, message: 'Failed to submit assignment' };
  }
};

// ============ LIVE SESSIONS ============

export interface LiveSessionItem {
  id: string;
  title: string;
  description: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  hostName: string;
  type: string;
  status: string;
  scheduledFor: string | null;
  duration: number;
  meetingUrl: string | null;
  recordingUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  hasRecording: boolean;
}

/**
 * Fetch a student's live sessions, split into upcoming and past.
 * Filtered server-side to courses the student is actively registered in.
 */
export const fetchStudentLiveSessions = async (
  userId: string
): Promise<{ upcoming: LiveSessionItem[]; past: LiveSessionItem[] }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/live-sessions/student/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch live sessions');
    const json = await response.json();
    return {
      upcoming: Array.isArray(json?.upcoming) ? json.upcoming : [],
      past: Array.isArray(json?.past) ? json.past : [],
    };
  } catch (error) {
    console.error(`Failed to fetch live sessions for ${userId}:`, error);
    return { upcoming: [], past: [] };
  }
};

/**
 * Get assignment details with submission info
 */
export const fetchAssignmentDetails = async (
  courseCode: string,
  assignmentId: string,
  userId?: string
): Promise<Assignment | null> => {
  try {
    const url = userId
      ? `${API_BASE_URL}/courses/${courseCode}/assignments/${assignmentId}?userId=${userId}`
      : `${API_BASE_URL}/courses/${courseCode}/assignments/${assignmentId}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Assignment not found');
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch assignment ${assignmentId}:`, error);
    return null;
  }
};

/**
 * Add a remark to a course (instructor)
 */
export const addCourseRemark = async (
  courseCode: string,
  title: string,
  content: string,
  important: boolean = false
): Promise<{ success: boolean; remark?: CourseRemark }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/courses/${courseCode}/remarks`, {
      method: 'POST',
      body: JSON.stringify({ title, content, important })
    });
    if (!response.ok) throw new Error('Failed to add remark');
    return await response.json();
  } catch (error) {
    console.error('Error adding remark:', error);
    return { success: false };
  }
};

// ============ QUIZ FUNCTIONS ============

// Fetch all quizzes for a course (or all if no code)
export async function fetchQuizzes(courseCode?: string): Promise<Quiz[]> {
  const url = courseCode
    ? `${API_BASE_URL}/quizzes?courseCode=${courseCode}`
    : `${API_BASE_URL}/quizzes`;

  const response = await apiFetch(url);
  if (!response.ok) return [];
  return response.json();
}

// Fetch single quiz detail
export async function fetchQuizDetail(quizId: string, role: string = 'student'): Promise<Quiz | null> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes/${quizId}?role=${role}`);
  if (!response.ok) return null;
  return response.json();
}

// Create a new quiz
// Accepts optional `audienceUserIds` so a quiz can be targeted at a specific
// subset of students rather than the whole course. Also accepts `startsAt`
// (scheduled global window start) and `totalPoints` (override for the
// gradebook column max). Backend persists all three; student-side fetches
// filter on audienceUserIds.
export async function createQuiz(
  quiz: Omit<Quiz, 'id'> & {
    audienceUserIds?: string[];
    startsAt?: string | null;
    totalPoints?: number | null;
  }
): Promise<Quiz | null> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes`, {
    method: 'POST',
    body: JSON.stringify(quiz)
  });

  if (!response.ok) return null;
  return response.json();
}

// Delete a quiz
export async function deleteQuiz(quizId: string): Promise<boolean> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes/${quizId}`, {
    method: 'DELETE'
  });
  return response.ok; // Assumes 200 OK on success
}

// Submit quiz answers
export async function submitQuiz(
  quizId: string,
  userId: string,
  answers: Record<string, string>
): Promise<{ success: boolean; submission?: QuizSubmission }> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes/${quizId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ userId, answers })
  });

  if (!response.ok) return { success: false };
  return response.json();
}

// Fetch quiz submissions (Professor view)
export async function fetchQuizSubmissions(quizId: string): Promise<QuizSubmission[]> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes/${quizId}/submissions`);
  if (!response.ok) return [];
  return response.json();
}

// Grade quiz submission (Professor view)
export async function gradeQuizSubmission(
  quizId: string,
  submissionId: string,
  grades: Record<string, number>
): Promise<boolean> {
  const response = await apiFetch(`${API_BASE_URL}/quizzes/${quizId}/submissions/${submissionId}/grade`, {
    method: 'POST',
    body: JSON.stringify({ grades })
  });

  return response.ok;
}
// ============ UTILITY FUNCTIONS ============

/**
 * Get material type icon
 */
export const getMaterialIcon = (type: string): { icon: string; color: string; bg: string } => {
  switch (type) {
    case 'pdf': return { icon: 'ph-file-pdf', color: 'text-red-500', bg: 'bg-red-500/20' };
    case 'slides': return { icon: 'ph-presentation', color: 'text-orange-500', bg: 'bg-orange-500/20' };
    case 'video': return { icon: 'ph-video', color: 'text-blue-500', bg: 'bg-blue-500/20' };
    case 'link': return { icon: 'ph-link', color: 'text-green-500', bg: 'bg-green-500/20' };
    case 'document': return { icon: 'ph-file-text', color: 'text-purple-500', bg: 'bg-purple-500/20' };
    default: return { icon: 'ph-file', color: 'text-gray-500', bg: 'bg-gray-500/20' };
  }
};

/**
 * Format file size
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Check if assignment is overdue
 */
export const isAssignmentOverdue = (dueDate: string): boolean => {
  return new Date(dueDate) < new Date();
};

/**
 * Calculate days until due
 */
export const daysUntilDue = (dueDate: string): number => {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

/**
 * Get assignment status color
 */
export const getAssignmentStatusColor = (status: string): string => {
  switch (status) {
    case 'graded': return 'bg-green-500/20 text-green-500 border-green-500/30';
    case 'submitted': return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
    default: return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
  }
};

