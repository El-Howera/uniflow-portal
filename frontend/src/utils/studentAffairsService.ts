/**
 * Student Affairs Service
 * Handles support requests, announcements, and department contacts
 * Connects to Student Affairs API Server on port 4006
 */

import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const API_BASE_URL = `${API_URLS.studentAffairs()}/api`;

// ============ TYPES ============

export interface RequestType {
  id: string;
  name: string;
  department: string;
  estimatedDays: number;
}

export interface ProcessorInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  processedAt: string | null;
}

export interface SupportRequest {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  type: string;
  typeName?: string;
  subject: string;
  message: string;
  // Friendly status alias served by the backend (processing/resolved). The
  // raw DB-enum value (in_progress/completed) is also exposed as `statusRaw`.
  status: 'pending' | 'processing' | 'in-progress' | 'completed' | 'resolved' | 'rejected';
  statusRaw?: 'pending' | 'in_progress' | 'completed' | 'rejected';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  assignedTo: string;
  resolution?: string;
  notes?: string;
  attachments: string[];
  estimatedDays?: number;
  department?: {
    title: string;
    email: string;
    phone: string;
  };
  // The "Being processed by …" banner reads this. Null until SA flips
  // the row to in_progress.
  processedBy?: ProcessorInfo | null;
  // Discriminator the unified My Requests / Complaints UI uses.
  kind?: 'request' | 'complaint';
}

export interface DepartmentContact {
  id: string;
  title: string;
  email: string;
  phone: string;
  hours: string;
  location: string;
  description: string;
}

export interface Announcement {
  id: string;
  title: string;
  subtitle: string;
  content: string;
  fullContent?: string;
  date: string;
  author: string;
  readTime: string;
  category: 'events' | 'academic' | 'financial' | 'health' | 'general';
  priority: 'low' | 'medium' | 'high';
  imageUrl?: string;
  categoryColor?: {
    bg: string;
    text: string;
    border: string;
  };
}

export interface RequestSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

// ============ FALLBACK MOCK DATA ============

const mockRequestTypes: RequestType[] = [
  { id: 'transcript', name: 'Transcript Request', department: 'registrar', estimatedDays: 3 },
  { id: 'financial-aid', name: 'Financial Aid Inquiry', department: 'financial', estimatedDays: 5 },
  { id: 'registration', name: 'Course Registration Issue', department: 'registrar', estimatedDays: 2 },
  { id: 'absence-excuse', name: 'Absence Excuse Request', department: 'academic', estimatedDays: 3 },
  { id: 'other', name: 'Other', department: 'general', estimatedDays: 5 }
];

const mockContacts: DepartmentContact[] = [
  { id: 'registrar', title: "Registrar's Office", email: 'registrar@uni.edu', phone: '(555) 123-4567', hours: 'Mon-Fri: 9 AM - 4 PM', location: 'Admin Building, Room 101', description: 'Handles transcripts and registration.' },
  { id: 'it', title: 'IT Help Desk', email: 'helpdesk@uni.edu', phone: '(555) 456-7890', hours: '24/7 Online', location: 'Library, Ground Floor', description: 'Technical support.' }
];

// ============ API FUNCTIONS ============

/**
 * Get all request types
 */
export const fetchRequestTypes = async (): Promise<RequestType[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/requests/types`);
    if (!response.ok) throw new Error('Failed to fetch request types');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback request types');
    return mockRequestTypes;
  }
};

export interface ComplaintCategory {
  id: string;
  categoryKey: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  defaultSeverity?: 'low' | 'medium' | 'high' | 'urgent';
}

/**
 * Get all active complaint categories. SA manages this list via the
 * Categories Management page; the student form renders whatever's active.
 */
export const fetchComplaintCategories = async (): Promise<ComplaintCategory[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/complaints/categories`);
    if (!response.ok) throw new Error('Failed to fetch complaint categories');
    return await response.json();
  } catch (error) {
    console.warn('Could not fetch complaint categories', error);
    return [];
  }
};

/**
 * Fetch the current user's complaints. Backend returns the same envelope
 * shape as /api/requests/:studentId so the unified UI can merge both lists.
 */
export const fetchMyComplaints = async (): Promise<{ complaints: SupportRequest[]; summary: RequestSummary }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/complaints/me`);
    if (!response.ok) throw new Error('Failed to fetch complaints');
    return await response.json();
  } catch (error) {
    console.warn('Could not fetch my complaints', error);
    return { complaints: [], summary: { total: 0, pending: 0, inProgress: 0, completed: 0 } };
  }
};

/**
 * Edit a pending support request. Backend rejects with 409 once the
 * request is in_progress / completed / rejected.
 */
export const editSupportRequest = async (
  id: string,
  patch: { subject?: string; message?: string; type?: string; priority?: 'low' | 'medium' | 'high' },
): Promise<{ success: boolean; message?: string }> => {
  try {
    const fd = new FormData();
    if (patch.subject !== undefined) fd.append('subject', patch.subject);
    if (patch.message !== undefined) fd.append('message', patch.message);
    if (patch.type !== undefined) fd.append('type', patch.type);
    if (patch.priority !== undefined) fd.append('priority', patch.priority);
    const res = await apiFetch(`${API_BASE_URL}/requests/${id}`, { method: 'PATCH', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data.error || 'Failed to update request.' };
    return { success: true };
  } catch {
    return { success: false, message: 'Network error.' };
  }
};

/**
 * Edit a pending complaint. Same lock semantics as editSupportRequest.
 */
export const editComplaint = async (
  id: string,
  patch: { subject?: string; message?: string; category?: string; severity?: 'low' | 'medium' | 'high' | 'urgent' },
): Promise<{ success: boolean; message?: string }> => {
  try {
    const fd = new FormData();
    if (patch.subject !== undefined) fd.append('subject', patch.subject);
    if (patch.message !== undefined) fd.append('message', patch.message);
    if (patch.category !== undefined) fd.append('category', patch.category);
    if (patch.severity !== undefined) fd.append('severity', patch.severity);
    const res = await apiFetch(`${API_BASE_URL}/complaints/${id}`, { method: 'PATCH', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data.error || 'Failed to update complaint.' };
    return { success: true };
  } catch {
    return { success: false, message: 'Network error.' };
  }
};

/**
 * Get student's support requests
 */
export const fetchStudentRequests = async (
  studentId: string,
  filters?: { status?: string; type?: string }
): Promise<{ requests: SupportRequest[]; summary: RequestSummary }> => {
  try {
    let url = `${API_BASE_URL}/requests/${studentId}`;
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.type) params.append('type', filters.type);
    if (params.toString()) url += `?${params.toString()}`;

    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch requests');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback requests data');
    return { requests: [], summary: { total: 0, pending: 0, inProgress: 0, completed: 0 } };
  }
};

/**
 * Get request details
 */
export const fetchRequestDetails = async (requestId: string): Promise<SupportRequest | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/requests/details/${requestId}`);
    if (!response.ok) throw new Error('Request not found');
    return await response.json();
  } catch (error) {
    console.warn('Request not found');
    return null;
  }
};

/**
 * Submit a new support request
 */
export const submitSupportRequest = async (
  data: {
    studentId: string;
    studentName?: string;
    studentEmail?: string;
    type: string;
    subject: string;
    message: string;
    priority?: 'low' | 'medium' | 'high';
  },
  attachments?: File[]
): Promise<{ success: boolean; message: string; request?: SupportRequest }> => {
  try {
    const formData = new FormData();
    formData.append('studentId', data.studentId);
    if (data.studentName) formData.append('studentName', data.studentName);
    if (data.studentEmail) formData.append('studentEmail', data.studentEmail);
    formData.append('type', data.type);
    formData.append('subject', data.subject);
    formData.append('message', data.message);
    if (data.priority) formData.append('priority', data.priority);

    if (attachments) {
      attachments.forEach(file => formData.append('attachments', file));
    }

    const response = await apiFetch(`${API_BASE_URL}/requests`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      return { success: false, message: result.error || 'Failed to submit request' };
    }
    return result;
  } catch (error) {
    console.error('Error submitting request:', error);
    return { success: false, message: 'Failed to submit request. Please try again.' };
  }
};

/**
 * Submit a new complaint. Mirrors the support-request flow but hits the
 * Complaint table; the StudentAffairs form picks one or the other based on
 * the request/complaint toggle.
 */
export const submitComplaint = async (
  data: {
    category: string;
    subject: string;
    message: string;
    severity?: 'low' | 'medium' | 'high' | 'urgent';
    targetUserId?: string;
  },
  attachments?: File[]
): Promise<{ success: boolean; message: string; complaint?: { id: string } }> => {
  try {
    const formData = new FormData();
    formData.append('category', data.category);
    formData.append('subject', data.subject);
    formData.append('message', data.message);
    if (data.severity) formData.append('severity', data.severity);
    if (data.targetUserId) formData.append('targetUserId', data.targetUserId);
    if (attachments) attachments.forEach((f) => formData.append('attachments', f));

    const response = await apiFetch(`${API_BASE_URL}/complaints`, {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) {
      return { success: false, message: result.error || 'Failed to submit complaint' };
    }
    return { success: true, message: 'Complaint submitted', complaint: result.complaint };
  } catch (error) {
    console.error('Error submitting complaint:', error);
    return { success: false, message: 'Failed to submit complaint. Please try again.' };
  }
};

/**
 * Get department contacts
 */
export const fetchDepartmentContacts = async (): Promise<DepartmentContact[]> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/contacts`);
    if (!response.ok) throw new Error('Failed to fetch contacts');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback contacts');
    return mockContacts;
  }
};

/**
 * Get contact by department ID
 */
export const fetchContactById = async (id: string): Promise<DepartmentContact | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/contacts/${id}`);
    if (!response.ok) throw new Error('Contact not found');
    return await response.json();
  } catch (error) {
    console.warn('Contact not found');
    return mockContacts.find(c => c.id === id) || null;
  }
};

/**
 * Get announcements
 */
export const fetchAnnouncements = async (
  filters?: { category?: string; priority?: string; limit?: number }
): Promise<{ announcements: Announcement[]; categories: string[] }> => {
  try {
    let url = `${API_BASE_URL}/announcements`;
    const params = new URLSearchParams();
    if (filters?.category) params.append('category', filters.category);
    if (filters?.priority) params.append('priority', filters.priority);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (params.toString()) url += `?${params.toString()}`;

    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch announcements');
    return await response.json();
  } catch (error) {
    console.warn('Using fallback announcements');
    return { announcements: [], categories: ['events', 'academic', 'financial', 'health', 'general'] };
  }
};

/**
 * Get announcement by ID
 */
export const fetchAnnouncementById = async (id: string): Promise<Announcement | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/announcements/${id}`);
    if (!response.ok) throw new Error('Announcement not found');
    return await response.json();
  } catch (error) {
    console.warn('Announcement not found');
    return null;
  }
};

// ============ UTILITY FUNCTIONS ============

/**
 * Get status badge colors
 */
export const getStatusColor = (status: string): { bg: string; text: string; border: string } => {
  switch (status) {
    case 'completed':
      return { bg: 'bg-green-500/20', text: 'text-green-500', border: 'border-green-500/30' };
    case 'in-progress':
      return { bg: 'bg-blue-500/20', text: 'text-blue-500', border: 'border-blue-500/30' };
    case 'pending':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-500', border: 'border-yellow-500/30' };
    case 'rejected':
      return { bg: 'bg-red-500/20', text: 'text-red-500', border: 'border-red-500/30' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-500', border: 'border-gray-500/30' };
  }
};

/**
 * Get priority badge colors
 */
export const getPriorityColor = (priority: string): { bg: string; text: string; border: string } => {
  switch (priority) {
    case 'high':
      return { bg: 'bg-red-500/20', text: 'text-red-500', border: 'border-red-500/30' };
    case 'medium':
      return { bg: 'bg-yellow-500/20', text: 'text-yellow-500', border: 'border-yellow-500/30' };
    case 'low':
      return { bg: 'bg-green-500/20', text: 'text-green-500', border: 'border-green-500/30' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-500', border: 'border-gray-500/30' };
  }
};

/**
 * Get category colors for announcements
 */
export const getCategoryColor = (category: string): { bg: string; text: string; border: string } => {
  switch (category) {
    case 'events':
      return { bg: 'bg-purple-500/20', text: 'text-purple-500', border: 'border-purple-500/30' };
    case 'academic':
      return { bg: 'bg-blue-500/20', text: 'text-blue-500', border: 'border-blue-500/30' };
    case 'financial':
      return { bg: 'bg-green-500/20', text: 'text-green-500', border: 'border-green-500/30' };
    case 'health':
      return { bg: 'bg-red-500/20', text: 'text-red-500', border: 'border-red-500/30' };
    default:
      return { bg: 'bg-gray-500/20', text: 'text-gray-500', border: 'border-gray-500/30' };
  }
};

/**
 * Format date for display
 */
export const formatRequestDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Calculate days since request was created
 */
export const daysSinceCreated = (createdAt: string): number => {
  const created = new Date(createdAt);
  const now = new Date();
  const diff = now.getTime() - created.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

