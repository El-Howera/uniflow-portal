import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const API_BASE_URL = `${API_URLS.attendance()}/api`;

// Types
export interface QRCodeData {
  qrId: string;
  token: string;
  timestamp: number;
  expiresAt: number;
  qrData: string;
}

export interface SecurityFeatures {
  dynamicQR: boolean;
  bssidValidation: boolean;
  duplicateDetection: boolean;
}

export interface SessionInfo {
  sessionId: string;
  hasActiveQR: boolean;
  currentQR: QRCodeData;
  expiresAt: string;
  requiresBSSID: boolean;
  validBSSIDs: string[];
}

export interface ClassSchedule {
  courseCode: string;
  courseName: string;
  instructor: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  validBSSIDs?: string[];
  isCurrentlyActive?: boolean;
  hasActiveSession?: boolean;
  sessionInfo?: SessionInfo;
  alreadyMarked?: boolean;
  attendanceStatus?: string | null;
  securityFeatures?: SecurityFeatures;
}

export interface TodaySchedule {
  date: string;
  day: string;
  currentTime: string;
  classes: ClassSchedule[];
}

export interface AttendanceRecord {
  /** Server-side primary key — needed for the "Appeal this absence" flow
   *  so the excuse can be linked to the exact record being disputed. */
  id?: string;
  /** Server-side session FK — alternative link target when no record exists yet. */
  sessionId?: string;
  courseCode: string;
  courseName: string;
  date: string;
  status: 'present' | 'late' | 'absent' | 'excused';
  markedAt: string;
  verificationMethod?: string;
  bssidVerified?: boolean;
  qrLatency?: number;
}

export interface AttendanceStats {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  attendanceRate: number;
}

export interface AttendanceHistory {
  records: AttendanceRecord[];
  stats: AttendanceStats;
}

export interface CourseSummary {
  courseCode: string;
  courseName: string;
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  attendanceRate: number;
  /**
   * Total sessions expected for this course over the full semester
   * (SectionSlot count × weeks). The classifier in the student attendance
   * page uses this as the denominator so barring/warning only fire when
   * the absence ratio against the FULL semester crosses the rule
   * thresholds — never mid-semester from a small sample. Falls back to
   * 0 when the backend hasn't computed it (older deployments).
   */
  totalExpected?: number;
}

export interface VerificationResult {
  qrValid: boolean;
  qrLatency: string;
  bssidVerified: boolean;
  duplicateCheck: string;
}

export interface MarkAttendanceResult {
  success: boolean;
  message: string;
  record?: AttendanceRecord;
  securityCheck?: string;
  verification?: VerificationResult;
  flagged?: boolean;
  details?: Record<string, unknown>;
}

export interface SecureSessionResult {
  success: boolean;
  message: string;
  sessionId?: string;
  courseCode?: string;
  currentQR?: QRCodeData;
  expiresAt?: string;
  securityFeatures?: {
    dynamicQR: boolean;
    refreshInterval: string;
    bssidValidation: boolean;
    duplicateDetection: boolean;
    validBSSIDs: string[];
  };
}

// ============ Network Info Helpers ============

/**
 * Attempt to get network information (BSSID)
 * Note: Browser access to BSSID is limited for privacy reasons
 * In a real implementation, this would use a native mobile app or browser extension
 */
export const getNetworkInfo = async (): Promise<{ bssid: string | null; ssid: string | null }> => {
  // In production, this would be obtained from:
  // 1. Native mobile app (Android/iOS) with proper permissions
  // 2. Browser extension with network access
  // 3. WiFi captive portal integration

  // For preview purposes, we'll use a test BSSID
  // The server accepts 'DEMO:BSSID:TEST' for testing
  return {
    bssid: 'DEMO:BSSID:TEST',
    ssid: 'DEMO_NETWORK'
  };
};

/**
 * Get device identifier (MAC address simulation)
 * In production, this would come from native app
 */
export const getDeviceId = (): string => {
  // Check localStorage for consistent device ID
  let deviceId = localStorage.getItem('uniflow_device_id');
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('uniflow_device_id', deviceId);
  }
  return deviceId;
};

// ============ API Functions ============

/**
 * Get today's classes for a student
 */
export const getTodaySchedule = async (userId: string): Promise<TodaySchedule | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/today/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch schedule');
    return await response.json();
  } catch (error) {
    console.error('Error fetching today schedule:', error);
    return null;
  }
};

/**
 * Get attendance history for a student
 */
export const getAttendanceHistory = async (
  userId: string,
  courseCode?: string,
  startDate?: string,
  endDate?: string
): Promise<AttendanceHistory | null> => {
  try {
    const params = new URLSearchParams();
    if (courseCode) params.append('courseCode', courseCode);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);

    const url = `${API_BASE_URL}/attendance/history/${userId}${params.toString() ? '?' + params.toString() : ''}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch history');
    return await response.json();
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    return null;
  }
};

/**
 * Get attendance summary by course
 */
export const getAttendanceSummary = async (userId: string): Promise<CourseSummary[] | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/summary/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch summary');
    return await response.json();
  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    return null;
  }
};

/**
 * Get current QR code for a session
 */
export const getCurrentQR = async (sessionId: string): Promise<QRCodeData | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/session/${sessionId}/qr`);
    if (!response.ok) throw new Error('Failed to fetch QR');
    const data = await response.json();
    return data.currentQR;
  } catch (error) {
    console.error('Error fetching QR code:', error);
    return null;
  }
};

/**
 * Mark attendance with security validation
 */
export const markAttendance = async (
  userId: string,
  sessionId: string,
  qrToken: string,
  bssid?: string,
  macAddress?: string
): Promise<MarkAttendanceResult> => {
  try {
    const networkInfo = await getNetworkInfo();
    const deviceId = getDeviceId();

    const response = await apiFetch(`${API_BASE_URL}/attendance/mark`, {
      method: 'POST',
      body: JSON.stringify({
        userId,
        sessionId,
        qrToken,
        bssid: bssid || networkInfo.bssid,
        macAddress: macAddress || deviceId
      })
    });
    return await response.json();
  } catch (error) {
    console.error('Error marking attendance:', error);
    return {
      success: false,
      message: 'Could not connect to attendance server',
      securityCheck: 'CONNECTION_FAILED'
    };
  }
};

/**
 * Create a preview attendance session (for testing)
 */
export const createDemoSession = async (courseCode: string): Promise<SecureSessionResult> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/preview/create-session`, {
      method: 'POST',
      body: JSON.stringify({ courseCode })
    });
    return await response.json();
  } catch (error) {
    console.error('Error creating preview session:', error);
    return { success: false, message: 'Could not connect to attendance server' };
  }
};

/**
 * Get all active attendance sessions
 */
export const getActiveSessions = async (): Promise<any[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/sessions`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return await response.json();
  } catch (error) {
    console.error('Error fetching sessions:', error);
    return [];
  }
};

/**
 * Get cheating flags for a student
 */
export const getCheatingFlags = async (userId: string): Promise<{ flagCount: number; flags: Record<string, unknown>[] }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/attendance/flags/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch flags');
    return await response.json();
  } catch (error) {
    console.error('Error fetching flags:', error);
    return { flagCount: 0, flags: [] };
  }
};

// ============ Helper Functions ============

/**
 * Format time to 12-hour format
 */
export const formatTime = (time: string): string => {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
};

/**
 * Get status color for attendance
 */
export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'present': return 'text-green-500 bg-green-500/20 border-green-500/30';
    case 'late': return 'text-yellow-500 bg-yellow-500/20 border-yellow-500/30';
    case 'absent': return 'text-red-500 bg-red-500/20 border-red-500/30';
    case 'excused': return 'text-blue-500 bg-blue-500/20 border-blue-500/30';
    default: return 'text-gray-500 bg-gray-500/20 border-gray-500/30';
  }
};

/**
 * Get status icon for attendance
 */
export const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'present': return 'ph-check-circle';
    case 'late': return 'ph-clock';
    case 'absent': return 'ph-x-circle';
    case 'excused': return 'ph-info';
    default: return 'ph-question';
  }
};

/**
 * Calculate time until QR expires
 */
export const getQRTimeRemaining = (expiresAt: number): number => {
  return Math.max(0, expiresAt - Date.now());
};

/**
 * Format milliseconds to seconds
 */
export const formatTimeRemaining = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  return `${seconds}s`;
};

