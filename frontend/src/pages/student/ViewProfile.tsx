import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { API_URLS } from '@shared/config';
import {
  fetchTranscript,
  UserProfile,
  TranscriptData,
  TranscriptCourse,
  uploadProfilePicture,
  registerDevice,
} from '../../utils/userProfileService';
import { useT } from '../../i18n';
import { apiFetch } from '../../utils/api';
import { formatMoney } from '../../utils/format';
import { downloadPayslipPdf } from '../../utils/pdfGenerator';
import { useHasPermission } from '../../utils/permissions';

// ─── Role helpers ────────────────────────────────────────────────────────────

type AppRole = 'student' | 'professor' | 'ta' | 'sa' | 'admin';

const ROLE_LABELS: Record<AppRole, string> = {
  student: 'Student',
  professor: 'Professor',
  ta: 'Teaching Assistant',
  sa: 'Student Affairs',
  admin: 'Administrator',
};

const ROLE_ICONS: Record<AppRole, string> = {
  student: 'ph-student',
  professor: 'ph-chalkboard-teacher',
  ta: 'ph-book-open',
  sa: 'ph-users',
  admin: 'ph-shield-check',
};

function getRoleLabel(role: string): string {
  return ROLE_LABELS[role as AppRole] ?? 'User';
}

function getRoleIcon(role: string): string {
  return ROLE_ICONS[role as AppRole] ?? 'ph-user';
}

// ─── Shared card style ───────────────────────────────────────────────────────

const glassCardStyle =
  'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

// ─── Personal Information Card ───────────────────────────────────────────────

interface PersonalInformationCardProps {
  profile: UserProfile | null;
  loading: boolean;
  role: string;
  onProfileChanged?: () => void;
}

const PersonalInformationCard: React.FC<PersonalInformationCardProps> = ({
  profile,
  loading,
  role,
  onProfileChanged,
}) => {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handlePickPhoto = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!profile?.id && !profile?.email) {
      setUploadError('Profile not loaded yet — refresh and try again.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image too large (max 5 MB).');
      return;
    }
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
      setUploadError('Only PNG, JPEG, GIF, or WebP images are accepted.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    const url = await uploadProfilePicture(profile.id || profile.email, file);
    setUploading(false);
    if (!url) {
      setUploadError('Upload failed — please try again.');
      return;
    }
    // Push the new URL into localStorage + bump the cache-bust counter so
    // the navbar (which lives outside this component) re-renders with the
    // fresh image. The custom event also wakes up any other listeners.
    try {
      localStorage.setItem('currentUserPicture', url);
      localStorage.setItem(
        'currentUserPictureV',
        String(Date.now()) // changes on every upload → new query string
      );
    } catch { /* ignore — non-critical */ }
    window.dispatchEvent(new CustomEvent('uniflow:profile-updated'));
    onProfileChanged?.();
    // Reset input so picking the same file again triggers onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (loading) {
    return (
      <div className={`${glassCardStyle} p-8 h-full`}>
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="flex gap-8">
            <div className="w-32 h-32 rounded-full bg-gray-300 dark:bg-gray-700"></div>
            <div className="flex-1 space-y-4">
              <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/2"></div>
              <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-16 bg-gray-300 dark:bg-gray-700 rounded-xl"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isStudent = role === 'student';
  const idLabel = isStudent ? t('viewProfilePage.studentId') : t('viewProfilePage.employeeId');

  return (
    <div className={`${glassCardStyle} p-4 md:p-8 h-full`}>
      <div className="flex justify-between items-start mb-8">
        <h2 className="text-2xl font-bold text-black dark:text-white">{t('viewProfilePage.personalInfo')}</h2>
      </div>

      <div className="flex flex-col md:flex-row gap-8 items-start">
        <div className="relative flex-shrink-0 mx-auto md:mx-0">
          {/* No more pravatar fallback (the third-party random face was
              never a real identity). When the user hasn't uploaded a photo,
              we render an initials badge matching the navbar avatar. */}
          {profile?.profilePicture ? (
            <img
              src={profile.profilePicture}
              alt="Profile"
              className="w-32 h-32 rounded-full object-cover border-4 border-white/50 dark:border-[#0d0d0d] shadow-2xl"
            />
          ) : (
            <div
              className="w-32 h-32 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-3xl font-bold border-4 border-white/50 dark:border-[#0d0d0d] shadow-2xl"
              aria-label={t('viewProfilePage.profileInitialsAria')}
            >
              {(`${profile?.firstName || ''} ${profile?.lastName || ''}`)
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((s) => s.charAt(0).toUpperCase())
                .join('') || '?'}
            </div>
          )}
          <span
            className={`absolute bottom-2 right-2 block h-6 w-6 rounded-full border-4 ${
              profile?.activated ? 'bg-green-500' : 'bg-gray-500'
            } border-white dark:border-[#1a1a1a]`}
          ></span>
        </div>

        <div className="flex-1 w-full space-y-6">
          <div className="text-center md:text-left">
            <h3 className="text-3xl font-bold text-black dark:text-white mb-1">
              {profile ? `${profile.firstName} ${profile.lastName}` : getRoleLabel(role)}
            </h3>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#6A3FF4]/10 border border-[#6A3FF4]/20">
              <i className={`ph-fill ${getRoleIcon(role)} text-[#6A3FF4]`}></i>
              <span className="text-[#6A3FF4] font-medium text-sm">{getRoleLabel(role)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
              <i className="ph-duotone ph-identification-card text-[#6A3FF4] text-2xl mr-4"></i>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 uppercase tracking-wider">{idLabel}</span>
                <span className="text-black dark:text-white font-bold text-base">
                  {profile?.odID || '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
              <i className="ph-duotone ph-envelope text-[#6A3FF4] text-2xl mr-4"></i>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 uppercase tracking-wider">{t('viewProfilePage.email')}</span>
                <span className="text-black dark:text-white font-bold text-base break-all">
                  {profile?.email || 'Not logged in'}
                </span>
              </div>
            </div>

            {isStudent ? (
              <>
                <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
                  <i className="ph-duotone ph-calendar-check text-[#6A3FF4] text-2xl mr-4"></i>
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">{t('viewProfilePage.program')}</span>
                    <span className="text-black dark:text-white font-bold text-base">
                      {profile?.academic?.program || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
                  <i className="ph-duotone ph-graduation-cap text-[#6A3FF4] text-2xl mr-4"></i>
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">{t('viewProfilePage.major')}</span>
                    <span className="text-black dark:text-white font-bold text-base">
                      {profile?.academic?.major || '—'}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
                  <i className="ph-duotone ph-buildings text-[#6A3FF4] text-2xl mr-4"></i>
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">{t('viewProfilePage.department')}</span>
                    <span className="text-black dark:text-white font-bold text-base">
                      {profile?.academic?.major || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center text-gray-600 dark:text-gray-400 bg-white/30 dark:bg-[#0d0d0d] p-4 rounded-xl border border-white/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors">
                  <i className="ph-duotone ph-briefcase text-[#6A3FF4] text-2xl mr-4"></i>
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-500 uppercase tracking-wider">{t('viewProfilePage.role')}</span>
                    <span className="text-black dark:text-white font-bold text-base">
                      {getRoleLabel(role)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-300/50 dark:border-[#363636] flex flex-col md:flex-row md:justify-end items-end gap-3">
        {uploadError && (
          <span className="text-red-500 text-xs flex items-center gap-1">
            <i className="ph-bold ph-x-circle"></i> {uploadError}
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={handleFile}
          className="hidden"
        />
        <button
          onClick={handlePickPhoto}
          disabled={uploading || loading}
          className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold py-3 px-8 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {uploading ? (
            <><i className="ph-bold ph-spinner animate-spin"></i> {t('viewProfilePage.uploading')}</>
          ) : (
            <><i className="ph-bold ph-camera"></i> {t('viewProfilePage.updatePhoto')}</>
          )}
        </button>
      </div>
    </div>
  );
};

// ─── Academic History Card (students only) ───────────────────────────────────

const AcademicHistoryCard: React.FC<{
  transcript: TranscriptData | null;
  loading: boolean;
}> = ({ transcript, loading }) => {
  const navigate = useNavigate();
  const t = useT();
  // Mirrors the /student/full-transcript sidebar entry — gates on Grades:read.
  const canOpenTranscript = useHasPermission('Grades', 'read');

  const recentCourses: (TranscriptCourse & { semester: string })[] = [];
  if (transcript?.semesters) {
    const sortedSemesters = [...transcript.semesters].reverse();
    for (const sem of sortedSemesters) {
      for (const course of sem.courses) {
        if (recentCourses.length < 5) {
          recentCourses.push({ ...course, semester: sem.name });
        }
      }
    }
  }

  return (
    <div className={`${glassCardStyle} p-4 md:p-8`}>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-black dark:text-white">{t('viewProfilePage.academicHistory')}</h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
            {t('viewProfilePage.performanceOverview')}
          </p>
        </div>
        {canOpenTranscript && (
          <button
            onClick={() => navigate('/student/full-transcript')}
            className="bg-white/50 dark:bg-[#262626] hover:bg-gray-300/50 dark:hover:bg-[#333] text-black dark:text-white text-sm font-semibold py-2 px-4 rounded-lg transition-colors border border-gray-300/50 dark:border-[#363636]"
          >
            {t('viewProfilePage.fullTranscriptCta')}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {loading ? (
          [1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"></div>
          ))
        ) : recentCourses.length > 0 ? (
          recentCourses.map((course, index) => (
            <div
              key={index}
              className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 p-3 md:p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl border border-gray-300/50 dark:border-[#363636]"
            >
              <div className="min-w-0">
                <p className="text-black dark:text-white font-bold text-sm md:text-base truncate">
                  {course.code} - {course.title}
                </p>
                <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">
                  {course.semester} &bull; {course.credits} Credits
                </p>
              </div>
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center text-sm font-bold ${
                  course.grade.startsWith('A')
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
                    : course.grade.startsWith('B')
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                    : course.grade.startsWith('C')
                    ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20'
                    : 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
                }`}
              >
                {course.grade}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center text-gray-500 py-8">{t('viewProfilePage.noAcademicRecords')}</div>
        )}
      </div>
    </div>
  );
};

// ─── Employment Info Card (non-student roles) ────────────────────────────────

const EmploymentInfoCard: React.FC<{
  profile: UserProfile | null;
  loading: boolean;
  role: string;
}> = ({ profile, loading, role }) => {
  const t = useT();
  const infoRows: Array<{ icon: string; label: string; value: string }> = [
    {
      icon: 'ph-buildings',
      label: 'Department',
      value: profile?.academic?.major || '—',
    },
    {
      icon: 'ph-briefcase',
      label: 'Position',
      value: getRoleLabel(role),
    },
    {
      icon: 'ph-calendar-blank',
      label: 'Member Since',
      value: profile?.createdAt
        ? new Date(profile.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
          })
        : '—',
    },
    {
      icon: 'ph-check-circle',
      label: 'Status',
      value: profile?.activated ? 'Active' : 'Inactive',
    },
  ];

  if (profile?.academic?.advisor) {
    infoRows.splice(2, 0, {
      icon: 'ph-user-circle',
      label: 'Supervisor',
      value: profile.academic.advisor,
    });
  }

  return (
    <div className={`${glassCardStyle} p-4 md:p-8`}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-black dark:text-white">{t('viewProfilePage.employmentInfo')}</h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
          {t('viewProfilePage.employmentInfoSub')}
        </p>
      </div>

      <div className="space-y-3">
        {loading
          ? [1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"
              ></div>
            ))
          : infoRows.map((row, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 bg-white/30 dark:bg-[#0d0d0d] rounded-xl border border-gray-300/50 dark:border-[#363636] hover:border-[#6A3FF4]/30 transition-colors"
              >
                <i className={`ph-duotone ${row.icon} text-[#6A3FF4] text-2xl flex-shrink-0`}></i>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">
                    {row.label}
                  </span>
                  <span className="text-black dark:text-white font-bold text-base truncate">
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
};

// ─── Attendance / Device Card ────────────────────────────────────────────────

// Parse a friendly device label from the User-Agent. We don't try to be
// clever — just enough to tell "Chrome on Windows" from "Safari on iPhone".
const detectDeviceLabel = (): string => {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Device';
  return `${browser} on ${os}`;
};

interface AttendanceDeviceCardProps {
  profile: UserProfile | null;
  onProfileChanged?: () => void;
}

const AttendanceDeviceCard: React.FC<AttendanceDeviceCardProps> = ({
  profile,
  onProfileChanged,
}) => {
  const t = useT();
  const userName = localStorage.getItem('currentUserFirstName') || 'User';
  const hasDevice = !!profile?.registeredDeviceId;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'ok' | 'err' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Re-registration cooldown (Attendance Doc §3.5.3.5): after an admin grants a
  // "normal" release, the student waits out a 48h window before binding a new
  // device. During it, attendance is recorded manually by the instructor.
  const releaseAtMs = profile?.deviceReleaseAt ? new Date(profile.deviceReleaseAt).getTime() : 0;
  const cooldownActive = !hasDevice && releaseAtMs > now;
  const remainingMs = Math.max(0, releaseAtMs - now);

  // Live tick while the cooldown is counting down.
  useEffect(() => {
    if (!cooldownActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownActive]);

  const countdown = (() => {
    const totalSec = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  const lastSeen = profile?.deviceRegisteredAt
    ? new Date(profile.deviceRegisteredAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  const handleRegister = async () => {
    setBusy(true);
    setFeedback(null);
    setFeedbackKind(null);
    try {
      const result = await registerDevice(detectDeviceLabel());
      if (result.ok) {
        setFeedback('Device registered.');
        setFeedbackKind('ok');
        onProfileChanged?.();
      } else {
        setFeedback(result.error || 'Could not register the device — please try again.');
        setFeedbackKind('err');
        if (result.reason) onProfileChanged?.(); // refresh in case a cooldown is now active
      }
    } finally {
      setBusy(false);
      setTimeout(() => {
        setFeedback(null);
        setFeedbackKind(null);
      }, 5000);
    }
  };

  return (
    <div className={`${glassCardStyle} p-4 md:p-8 h-full flex flex-col`}>
      <h2 className="text-xl font-bold text-black dark:text-white mb-6">{t('viewProfilePage.registeredDevice')}</h2>

      <div className="flex-grow flex flex-col items-center justify-center bg-white/30 dark:bg-[#0d0d0d] rounded-2xl border border-gray-300/50 dark:border-[#363636] p-8 mb-6 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#6A3FF4] to-[#A855F7]"></div>

        <div className="w-20 h-20 bg-white/50 dark:bg-[#1a1a1a] rounded-full flex items-center justify-center mb-4 border border-gray-300/50 dark:border-[#333] shadow-lg group-hover:scale-110 transition-transform duration-300">
          <i className="ph-duotone ph-device-mobile text-[#6A3FF4] text-4xl"></i>
        </div>

        {hasDevice ? (
          <>
            <h3 className="text-black dark:text-white font-bold text-lg mb-1">
              {userName}'s Device
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-xs text-center">
              {profile?.registeredDeviceLabel || detectDeviceLabel()}
            </p>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 mt-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-green-600 dark:text-green-400 text-xs font-bold uppercase tracking-wide">
                {t('viewProfilePage.deviceActive')}
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-[11px] text-center mt-3 max-w-xs">
              To register a different device, request a release from Student Affairs.
            </p>
          </>
        ) : cooldownActive ? (
          <>
            <h3 className="text-black dark:text-white font-bold text-lg mb-1">
              Device release in cooldown
            </h3>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 mt-2">
              <i className="ph-bold ph-lock-key text-amber-500 text-sm"></i>
              <span className="text-amber-600 dark:text-amber-400 text-sm font-bold font-mono tracking-wide">
                {countdown}
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400 text-[11px] text-center mt-3 max-w-xs">
              You can register a new device once the timer ends. Until then, ask your
              instructor to record your attendance manually.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-black dark:text-white font-bold text-lg mb-1">
              {t('viewProfilePage.noDevice')}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-xs text-center mt-2">
              {t('viewProfilePage.deviceHelp')}
            </p>
            <button
              onClick={handleRegister}
              disabled={busy}
              className="mt-4 px-4 py-2 bg-[#6A3FF4] text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {busy ? (
                <><i className="ph-bold ph-spinner animate-spin"></i> {t('viewProfilePage.workingShort')}</>
              ) : (
                <><i className="ph-bold ph-device-mobile-camera"></i> {t('viewProfilePage.registerDevice')}</>
              )}
            </button>
          </>
        )}

        {feedback && (
          <p
            className={`mt-3 text-[11px] text-center max-w-xs ${
              feedbackKind === 'ok'
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-500 dark:text-red-400'
            }`}
          >
            {feedback}
          </p>
        )}
      </div>

      {hasDevice && lastSeen && (
        <div className="w-full">
          <div className="flex justify-between items-center p-4 rounded-xl bg-white/50 dark:bg-[#262626]/50 border border-gray-300/50 dark:border-[#363636]">
            <div className="flex items-center gap-3">
              <i className="ph-bold ph-clock text-gray-600 dark:text-gray-400"></i>
              <span className="text-gray-600 dark:text-gray-400 text-sm">{t('viewProfilePage.deviceRegistered')}</span>
            </div>
            <span className="text-black dark:text-white font-mono text-xs">{lastSeen}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Page ───────────────────────────────────────────────────────────────

const ViewProfile: React.FC = () => {
  const role = (localStorage.getItem('currentUserRole') || 'student') as AppRole;
  const isStudent = role === 'student';
  const t = useT();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);

  // useCallback so we can pass it to children as a stable refresh handle.
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const userEmail = localStorage.getItem('currentUserEmail') || '';
      const token = localStorage.getItem('authToken') || '';

      const profileRes = await fetch(
        `${API_URLS.userProfile()}/api/profile/${encodeURIComponent(userEmail)}`,
        {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!profileRes.ok) throw new Error('Profile fetch failed');
      const profileData: UserProfile = await profileRes.json();
      setProfile(profileData);

      // Mirror the picture into localStorage so the global navbar can show
      // it without re-fetching the profile on every route change. Skip the
      // pravatar fallback (the navbar derives it from email if missing).
      const pic = profileData.profilePicture || '';
      const isPravatar = /i\.pravatar\.cc/.test(pic);
      try {
        if (pic && !isPravatar) {
          localStorage.setItem('currentUserPicture', pic);
        } else {
          localStorage.removeItem('currentUserPicture');
        }
      } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('uniflow:profile-updated'));

      if (isStudent) {
        const transcriptData = await fetchTranscript(userEmail);
        setTranscript(transcriptData);
      }
    } catch (err) {
      // Surface nothing to the user — the UI shows "—" for missing fields
    } finally {
      setLoading(false);
    }
  }, [isStudent]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const pageSubtitle = isStudent
    ? t('viewProfilePage.studentSubtitle')
    : t('viewProfilePage.staffSubtitle');

  return (
    <div className="pb-28 md:pb-16 space-y-4">
      <AnimateOnView>
        <div>
          <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('viewProfilePage.title')}</h2>
          <p className="text-gray-600 dark:text-gray-400">{pageSubtitle}</p>
        </div>
      </AnimateOnView>

      <AnimateOnView delay={0.1}>
        <div className="w-full">
          <PersonalInformationCard
            profile={profile}
            loading={loading}
            role={role}
            onProfileChanged={loadData}
          />
        </div>
      </AnimateOnView>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <AnimateOnView delay={0.2} className="xl:col-span-2">
          {isStudent ? (
            <AcademicHistoryCard transcript={transcript} loading={loading} />
          ) : (
            <EmploymentInfoCard profile={profile} loading={loading} role={role} />
          )}
        </AnimateOnView>
        <AnimateOnView delay={0.3} className="xl:col-span-1 h-full">
          <AttendanceDeviceCard profile={profile} onProfileChanged={loadData} />
        </AnimateOnView>
      </div>

      {/* Phase 10 — staff payslips */}
      {!isStudent && (
        <AnimateOnView delay={0.35}>
          <PayslipsCard />
        </AnimateOnView>
      )}
    </div>
  );
};

/* ─── Phase 10 — staff Payslips card ──────────────────────────────────── */

interface MyPayslip {
  id: string;
  period: string;
  status: string;
  currency: string;
  gross: number;
  deductionsTotal: number;
  net: number;
  generatedAt: string;
}

const PayslipsCard: React.FC = () => {
  const t = useT();
  const [slips, setSlips] = useState<MyPayslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch(`${API_URLS.payments()}/api/me/payslips`);
        if (res.ok) {
          const data = await res.json();
          setSlips(data.payslips ?? []);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl p-6">
      <h2 className="text-black dark:text-white font-bold text-lg mb-4 flex items-center gap-2">
        <i className="ph-bold ph-receipt text-[#6A3FF4]"></i> My Payslips
      </h2>
      {loading ? (
        <div className="animate-pulse h-24 bg-white/5 rounded-xl" />
      ) : slips.length === 0 ? (
        <p className="text-gray-500 text-sm py-4 text-center">{t('viewProfilePage.noPayslips')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                <th className="text-left py-2 pr-4 font-bold">{t('viewProfilePage.payslipPeriod')}</th>
                <th className="text-left py-2 pr-4 font-bold">{t('viewProfilePage.payslipStatus')}</th>
                <th className="text-right py-2 pr-4 font-bold">{t('viewProfilePage.payslipGross')}</th>
                <th className="text-right py-2 pr-4 font-bold">{t('viewProfilePage.payslipDeductions')}</th>
                <th className="text-right py-2 pr-4 font-bold">{t('viewProfilePage.payslipNet')}</th>
                <th className="text-right py-2 font-bold">{t('viewProfilePage.payslipPdf')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {slips.map((s) => (
                <tr key={s.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-2 pr-4 text-black dark:text-white font-bold">{s.period}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      s.status === 'paid'      ? 'bg-green-500/10 text-green-400'
                      : s.status === 'finalized' ? 'bg-blue-500/10 text-blue-400'
                      : s.status === 'cancelled' ? 'bg-red-500/10 text-red-400'
                      : 'bg-yellow-500/10 text-yellow-400'
                    }`}>{s.status}</span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-400">{formatMoney(s.gross, { code: s.currency })}</td>
                  <td className="py-2 pr-4 text-right text-red-400">−{formatMoney(s.deductionsTotal, { code: s.currency })}</td>
                  <td className="py-2 pr-4 text-right font-bold text-black dark:text-white">{formatMoney(s.net, { code: s.currency })}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => downloadPayslipPdf(s.id, 'me')}
                      className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                    >
                      {t('viewProfilePage.payslipDownload')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ViewProfile;
