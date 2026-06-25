import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const API_BASE_URL = `${API_URLS.userProfile()}/api`;

// ============ TYPES ============

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface AcademicInfo {
  program: string;
  major: string;
  minor?: string;
  enrollmentDate: string;
  expectedGraduation: string;
  standing: string;
  status: string;
  advisor: string;
  advisorEmail?: string;
  gpa: number;
  totalCredits: number;
  creditsThisSemester: number;
}

export interface TranscriptAssignment {
  name: string;
  // null = not graded yet (current-semester live view). The card renders
  // these as "N/A" instead of zero so the student can tell the difference
  // between "scored zero" and "the prof hasn't graded this yet".
  earned: number | null;
  max: number;
  // Legacy string fields kept for any older consumer; new code reads earned/max.
  grade?: string;
  weight?: string;
  contribution?: string;
}

export interface TranscriptCategory {
  title: string;
  assignments: TranscriptAssignment[];
  // null when no assignment in the category has been graded yet.
  subtotalEarned: number | null;
  subtotalMax: number;
}

export interface TranscriptCourse {
  code: string;
  title: string;
  credits: number;
  grade: string;
  points: number;
  // null when nothing has been graded — the card renders the course total
  // as "N/A" instead of zero in that case.
  totalEarned?: number | null;
  totalMax?: number;
  breakdown?: TranscriptCategory[];
}

export interface TranscriptSemester {
  id: string;
  name: string;
  gpa: number;
  credits: number;
  courses: TranscriptCourse[];
}

export interface TranscriptData {
  studentId: string;
  gpa: number;
  totalCredits: number;
  semesters: TranscriptSemester[];
  // Plan 4 Phase 5 — populated when AcademicProfile has the new columns.
  //   academicStanding: 'good' | 'warning' | 'probation' | 'dismissed' | null
  //   honorsEligible:   'none' | 'honors' | 'high_honors' | 'disqualified' | null
  academicStanding?: string | null;
  honorsEligible?: string | null;
}

export interface GpaSummary {
  gpa: number;
  totalCredits: number;
  creditsThisSemester: number;
  standing: string;
}
export interface UserProfile {
  id: string;
  odID: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  address?: Address;
  emergencyContact?: EmergencyContact;
  academic: AcademicInfo;
  profilePicture?: string;
  activated: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  // FCM push subscription. Driven by browser notification permission.
  fcmToken?: string | null;
  fcmTokenAt?: string | null;
  // Generic device binding — set by clicking "Register Device" in the
  // profile. Independent of notification permission so it works even when
  // push is blocked. Treat presence as the source of truth for "device
  // registered".
  registeredDeviceId?: string | null;
  registeredDeviceLabel?: string | null;
  deviceRegisteredAt?: string | null;
  // Re-registration release control (Attendance Documentation §3.5.3.5).
  deviceReleaseAt?: string | null;
  deviceReleaseType?: string | null;
  createdAt: string;
  lastLogin?: string;
}

export interface UserSettings {
  userId: string;
  appearance: {
    theme: 'light' | 'dark' | 'system';
    fontSize: number;
    compactMode: boolean;
  };
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    announcements: boolean;
    grades: boolean;
    assignments: boolean;
    messages: boolean;
    reminders: boolean;
  };
  privacy: {
    showEmail: boolean;
    showPhone: boolean;
    showProfile: boolean;
    allowMessages: boolean;
  };
  language: string;
  timezone: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  token?: string;
  user?: UserProfile;
  error?: string;
}

// ============ API FUNCTIONS ============

/**
 * Get user profile
 */
export const fetchUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/profile/${userId}`);
    if (!response.ok) throw new Error('Profile not found');
    return await response.json();
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
};

/**
 * Update user profile
 */
export const updateUserProfile = async (
  userId: string,
  updates: Partial<Pick<UserProfile, 'phone' | 'address' | 'emergencyContact' | 'profilePicture'>>
): Promise<{ success: boolean; message: string; profile?: UserProfile }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/profile/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating profile:', error);
    return { success: false, message: 'Failed to update profile' };
  }
};

/**
 * Update profile picture
 */
export const updateProfilePicture = async (
  userId: string,
  pictureUrl: string
): Promise<{ success: boolean; message: string; pictureUrl?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/profile/${userId}/picture`, {
      method: 'POST',
      body: JSON.stringify({ pictureUrl })
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating profile picture:', error);
    return { success: false, message: 'Failed to update profile picture' };
  }
};

/**
 * Login user
 */
export const loginUser = async (
  email: string,
  password: string
): Promise<LoginResponse> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();

    if (!response.ok) {
      return { success: false, message: data.error || 'Login failed' };
    }

    // Store token in localStorage
    if (data.token) {
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('currentUserId', data.user.id);
      localStorage.setItem('currentUserEmail', data.user.email);
    }

    return data;
  } catch (error) {
    console.error('Error logging in:', error);
    return { success: false, message: 'Failed to connect to server' };
  }
};

/**
 * Logout user
 */
export const logoutUser = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const token = localStorage.getItem('authToken');
    await apiFetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      body: JSON.stringify({ token })
    });

    // Clear localStorage
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('currentUserEmail');

    return { success: true, message: 'Logged out successfully' };
  } catch (error) {
    console.error('Error logging out:', error);
    // Still clear local storage even if server call fails
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('currentUserEmail');
    return { success: true, message: 'Logged out' };
  }
};

/**
 * Change password
 */
export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify({ userId, currentPassword, newPassword })
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Failed to change password' };
    }
    return data;
  } catch (error) {
    console.error('Error changing password:', error);
    return { success: false, message: 'Failed to change password' };
  }
};

/**
 * Request password reset
 */
export const requestPasswordReset = async (
  email: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    return await response.json();
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return { success: false, message: 'Failed to request password reset' };
  }
};

/**
 * Reset password with token
 */
export const resetPassword = async (
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ token, newPassword })
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Failed to reset password' };
    }
    return data;
  } catch (error) {
    console.error('Error resetting password:', error);
    return { success: false, message: 'Failed to reset password' };
  }
};

/**
 * Verify session token
 */
export const verifySession = async (): Promise<{ valid: boolean; user?: UserProfile }> => {
  try {
    const token = localStorage.getItem('authToken');
    if (!token) {
      return { valid: false };
    }

    const response = await apiFetch(`${API_BASE_URL}/auth/verify`);

    if (!response.ok) {
      localStorage.removeItem('authToken');
      return { valid: false };
    }

    return await response.json();
  } catch (error) {
    console.warn('Session verification failed');
    return { valid: false };
  }
};

/**
 * Upload a new profile picture (multipart). Backend stores it under
 * /uploads/avatars/ and returns a public URL we can drop straight into
 * <img src=…>. Do NOT pre-set Content-Type — the browser injects the
 * correct multipart boundary.
 */
export const uploadProfilePicture = async (
  userId: string,
  file: File
): Promise<string | null> => {
  try {
    const fd = new FormData();
    fd.append('picture', file);
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_BASE_URL}/profile/${encodeURIComponent(userId)}/picture`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('uploadProfilePicture failed:', body.error || res.statusText);
      return null;
    }
    const data = await res.json();
    return data.pictureUrl ?? null;
  } catch (err) {
    console.error('uploadProfilePicture error:', err);
    return null;
  }
};

/**
 * Get or generate this browser's stable device id. Lives in localStorage so
 * the same UUID survives across logins / refreshes; lost only when the user
 * clears site data. NOT synced across devices — each browser install gets
 * its own. Used as the deviceId payload for /api/users/me/device.
 */
export const getOrCreateDeviceId = (): string => {
  try {
    const existing = localStorage.getItem('uniflowDeviceId');
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('uniflowDeviceId', fresh);
    return fresh;
  } catch {
    // localStorage blocked (incognito / sandboxed). Return a session-scoped
    // id; the server will accept any non-empty string.
    return `eph-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

/**
 * Mock device public key for the cryptographic binding (Attendance Doc §3.5.3).
 * On a native Capacitor build this is the Secure Enclave / StrongBox public key
 * (non-exportable private key). In the PWA we mint a per-install random token —
 * the binding logic ships, only the hardware-backing is mocked until native.
 */
export const getOrCreateDevicePublicKey = (): string => {
  try {
    const existing = localStorage.getItem('uniflowDevicePubKey');
    if (existing) return existing;
    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `pwa-mock-${crypto.randomUUID()}`
        : `pwa-mock-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    localStorage.setItem('uniflowDevicePubKey', fresh);
    return fresh;
  } catch {
    return `pwa-mock-eph-${Date.now()}`;
  }
};

export interface RegisterDeviceResult {
  ok: boolean;
  error?: string;
  reason?: string;
  releaseAt?: string | null;
}

/**
 * Register the current browser as the user's bound device. Independent of
 * notification permission — works even when push is blocked. First registration
 * is free; re-registration requires an admin-granted release (§3.5.3.5).
 */
export const registerDevice = async (deviceLabel: string): Promise<RegisterDeviceResult> => {
  try {
    const res = await apiFetch(`${API_BASE_URL}/users/me/device`, {
      method: 'POST',
      body: JSON.stringify({
        deviceId: getOrCreateDeviceId(),
        deviceLabel,
        devicePublicKey: getOrCreateDevicePublicKey(),
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body?.error, reason: body?.reason, releaseAt: body?.releaseAt };
  } catch {
    return { ok: false };
  }
};

/**
 * Clear the user's registered device.
 */
export const unregisterDevice = async (): Promise<boolean> => {
  try {
    const res = await apiFetch(`${API_BASE_URL}/users/me/device`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Get user settings
 */
export const fetchUserSettings = async (userId: string): Promise<UserSettings> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/settings/${userId}`);
    if (!response.ok) throw new Error('Settings not found');
    return await response.json();
  } catch (error) {
    console.error('Error fetching settings:', error);
    throw error;
  }
};

/**
 * Update user settings
 */
export const updateUserSettings = async (
  userId: string,
  updates: Partial<Omit<UserSettings, 'userId'>>
): Promise<{ success: boolean; message: string; settings?: UserSettings }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/settings/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating settings:', error);
    return { success: false, message: 'Failed to update settings' };
  }
};

/**
 * Get academic info
 */
export const fetchAcademicInfo = async (userId: string): Promise<AcademicInfo & { studentId: string; studentName: string; email: string } | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/academic/${userId}`);
    if (!response.ok) throw new Error('Academic info not found');
    return await response.json();
  } catch (error) {
    console.error('Error fetching academic info:', error);
    return null;
  }
};

/**
 * Fetch student transcript
 */
export const fetchTranscript = async (userId: string): Promise<TranscriptData | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/academic/transcript/${userId}`);
    if (!response.ok) throw new Error('Transcript not found');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback transcript data');
    return null;
  }
};

/**
 * Fetch GPA summary
 */
export const fetchGpaSummary = async (userId: string): Promise<GpaSummary | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/academic/gpa/${userId}`);
    if (!response.ok) throw new Error('GPA summary not found');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback GPA data');
    return null;
  }
};
// ============ EMAIL VERIFICATION FUNCTIONS ============

/**
 * Send verification code to email
 */
export const sendVerificationCode = async (
  userId: string
): Promise<{ success: boolean; message: string; expiresAt?: string; devCode?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/send-verification`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    return await response.json();
  } catch (error) {
    console.error('Error sending verification code:', error);
    return { success: false, message: 'Failed to send verification code' };
  }
};

/**
 * Verify email with code
 */
export const verifyEmailCode = async (
  userId: string,
  code: string
): Promise<{ success: boolean; message: string; activated?: boolean; attemptsRemaining?: number }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/verify-code`, {
      method: 'POST',
      body: JSON.stringify({ userId, code })
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Verification failed', attemptsRemaining: data.attemptsRemaining };
    }
    return data;
  } catch (error) {
    console.error('Error verifying code:', error);
    return { success: false, message: 'Failed to verify code' };
  }
};

/**
 * Resend verification code
 */
export const resendVerificationCode = async (
  userId: string
): Promise<{ success: boolean; message: string; expiresAt?: string; devCode?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/resend-verification`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Failed to resend code' };
    }
    return data;
  } catch (error) {
    console.error('Error resending verification code:', error);
    return { success: false, message: 'Failed to resend verification code' };
  }
};

/**
 * Send password reset code to email
 */
export const sendPasswordResetCode = async (
  email: string
): Promise<{ success: boolean; message: string; devCode?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/send-reset-code`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    return await response.json();
  } catch (error) {
    console.error('Error sending reset code:', error);
    return { success: false, message: 'Failed to send reset code' };
  }
};

/**
 * Reset password with code
 */
export const resetPasswordWithCode = async (
  email: string,
  code: string,
  newPassword: string
): Promise<{ success: boolean; message: string; attemptsRemaining?: number }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/auth/reset-with-code`, {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword })
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, message: data.error || 'Reset failed', attemptsRemaining: data.attemptsRemaining };
    }
    return data;
  } catch (error) {
    console.error('Error resetting password:', error);
    return { success: false, message: 'Failed to reset password' };
  }
};

// ============ UTILITY FUNCTIONS ============

/**
 * Get current user ID from storage
 */
export const getCurrentUserId = (): string | null => {
  return localStorage.getItem('currentUserId');
};

/**
 * Get current user email from storage
 */
export const getCurrentUserEmail = (): string | null => {
  return localStorage.getItem('currentUserEmail');
};

/**
 * Check if user is logged in
 */
export const isLoggedIn = (): boolean => {
  return !!localStorage.getItem('authToken');
};

/**
 * Format academic standing with color
 */
export const getStandingColor = (standing: string): { bg: string; text: string } => {
  switch (standing.toLowerCase()) {
    case 'freshman':
      return { bg: 'bg-blue-500/20', text: 'text-blue-500' };
    case 'sophomore':
      return { bg: 'bg-green-500/20', text: 'text-green-500' };
    case 'junior':
      return { bg: 'bg-purple-500/20', text: 'text-purple-500' };
    case 'senior':
      return { bg: 'bg-orange-500/20', text: 'text-orange-500' };
    case 'graduate':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-500' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-500' };
  }
};

/**
 * Format GPA with color
 */
export const getGpaColor = (gpa: number): string => {
  if (gpa >= 3.7) return 'text-green-500';
  if (gpa >= 3.0) return 'text-blue-500';
  if (gpa >= 2.0) return 'text-yellow-500';
  return 'text-red-500';
};

/**
 * Calculate time until graduation
 */
export const timeUntilGraduation = (expectedGraduation: string): string => {
  const grad = new Date(expectedGraduation);
  const now = new Date();
  const diff = grad.getTime() - now.getTime();

  if (diff < 0) return 'Graduated';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);

  if (months > 12) {
    const years = Math.floor(months / 12);
    return `${years} year${years > 1 ? 's' : ''} remaining`;
  }
  if (months > 0) {
    return `${months} month${months > 1 ? 's' : ''} remaining`;
  }
  return `${days} day${days > 1 ? 's' : ''} remaining`;
};

