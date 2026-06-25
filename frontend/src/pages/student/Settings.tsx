import React, { useState, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { changePassword } from '../../utils/userProfileService';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';
import { firebase } from '../../utils/firebase';
import { webpush } from '../../utils/webpush';
import { enablePushFromGesture } from '../../utils/pushEnable';
import EnrollmentRequestsSection from './EnrollmentRequestsSection';

const glassCard = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const inputCls = "w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors";
const labelCls = "block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2";

/* ── Shared atoms ─────────────────────────────────────── */
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className={labelCls}>{children}</label>
);

const TextInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  type?: string;
  placeholder?: string;
}> = ({ label, value, onChange, readOnly = false, type = 'text', placeholder }) => (
  <div>
    <Label>{label}</Label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
      placeholder={placeholder}
      className={`${inputCls} ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
    />
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
}> = ({ label, description, enabled, onToggle }) => (
  <div className="flex items-center justify-between gap-3 p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-black dark:text-white">{label}</div>
      {description && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>}
    </div>
    {/* `dir="ltr"` forces the toggle visual to be direction-independent —
        the binary OFF/ON state always renders knob-left/knob-right
        regardless of page language. In RTL without this, the knob's
        natural position is the right edge and `translate-x-5` shifts it
        further right (off-screen), inverting and breaking the toggle. */}
    <button
      onClick={onToggle}
      aria-pressed={enabled}
      dir="ltr"
      className={`relative inline-flex flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors p-0.5 ${enabled ? 'bg-[#6A3FF4]' : 'bg-gray-300 dark:bg-black/30 ring-1 ring-inset ring-black/10 dark:ring-white/10'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white transform transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  </div>
);

/**
 * Push notification toggle.
 *
 * Reflects the browser-level Notifications permission (the FCM token is
 * tied to it). We can't programmatically enable / disable a granted
 * permission — the browser owns that — so the toggle is locked when the
 * permission is already in a terminal state. The three states are:
 *
 *   granted — toggle ON, locked. To turn off, the user removes the
 *             permission via their browser's site-settings panel.
 *   denied  — toggle OFF, locked. To turn on, the user must reset the
 *             permission via site-settings (browsers cache "Block" and
 *             refuse to re-prompt).
 *   default — toggle OFF, clickable. Clicking calls
 *             registerFcmTokenWithBackend(), which prompts the user and,
 *             on grant, registers the FCM token against the current
 *             user (per-user — backend stores it on User.fcmToken).
 *
 * The toggle re-checks `Notification.permission` every 2s while open so
 * a permission flipped from a different tab / site-settings updates the
 * UI without a refresh. Render returns null when the browser doesn't
 * support Notifications at all.
 */
const PushNotificationsToggle: React.FC = () => {
  const t = useT();
  // Supported when EITHER channel is available: FCM (configured) OR standard
  // Web Push (the iOS-PWA path). iOS Safari has no FCM but does have Web Push.
  const supported =
    typeof Notification !== 'undefined' &&
    (firebase.isConfigured() || webpush.isWebPushSupported());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported'
  );
  const [busy, setBusy] = useState(false);

  // Poll the live permission so a change from another tab / browser
  // settings panel reflects without a hard refresh. Cheap (single string
  // read, no IO), 2s cadence is plenty.
  useEffect(() => {
    if (!supported) return;
    const id = setInterval(() => {
      const p = Notification.permission;
      setPermission((prev) => (prev !== p ? p : prev));
    }, 2000);
    return () => clearInterval(id);
  }, [supported]);

  if (!supported) return null;

  const enabled = permission === 'granted';
  const locked = permission === 'granted' || permission === 'denied';

  const handleToggle = async () => {
    if (locked || busy) return;
    setBusy(true);
    try {
      // enablePushFromGesture() prompts + registers the right channel: FCM
      // where supported, else standard Web Push (iOS PWA). The gesture origin
      // matters — iOS only allows the permission prompt from a user tap.
      const ok = await enablePushFromGesture();
      // Refresh permission state immediately (the user may have denied).
      setPermission(Notification.permission);
      if (!ok && Notification.permission === 'granted') {
        // Permission granted but registration failed — surface through console;
        // the toggle stays consistent with browser state.
        console.warn('[push] permission granted but registration failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const description =
    permission === 'granted'
      ? t('settingsPage.pushGranted')
      : permission === 'denied'
      ? t('settingsPage.pushDenied')
      : t('settingsPage.pushDefault');

  return (
    <div className="flex items-center justify-between p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
      <div className="pr-4">
        <div className="text-sm font-medium text-black dark:text-white flex items-center gap-2">
          {t('settingsPage.pushNotifications')}
          {locked && (
            <i
              className="ph-bold ph-lock-simple text-[11px] text-gray-500"
              title={t('settingsPage.pushLocked')}
            />
          )}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>
      </div>
      <button
        onClick={handleToggle}
        disabled={locked || busy}
        aria-pressed={enabled}
        aria-disabled={locked}
        dir="ltr"
        title={
          locked
            ? enabled
              ? t('settingsPage.pushTurnOff')
              : t('settingsPage.pushDenied')
            : busy
            ? t('settingsPage.pushEnabling')
            : t('settingsPage.pushEnable')
        }
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors p-0.5 shrink-0 ${
          enabled ? 'bg-[#6A3FF4]' : 'bg-gray-300 dark:bg-black/30 ring-1 ring-inset ring-black/10 dark:ring-white/10'
        } ${locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'} ${busy ? 'opacity-60' : ''}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white transform transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

const Section: React.FC<{
  title: string;
  description: string;
  icon: string;
  children: React.ReactNode;
}> = ({ title, description, icon, children }) => (
  <div className={`${glassCard} p-6`}>
    <div className="mb-5">
      <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
        <i className={`ph-bold ${icon} text-[#6A3FF4]`} />
        {title}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
    </div>
    {children}
  </div>
);

/* ── Password section ─────────────────────────────────── */
const PasswordSection: React.FC = () => {
  const t = useT();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const userId = localStorage.getItem('currentUserId') || '';

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!currentPw || !newPw || !confirmPw) { setError(t('settingsPage.pwFillAll')); return; }
    if (newPw.length < 8) { setError(t('settingsPage.pwMinLen')); return; }
    if (newPw !== confirmPw) { setError(t('settingsPage.pwMismatch')); return; }
    setLoading(true);
    const result = await changePassword(userId, currentPw, newPw);
    setLoading(false);
    if (result.success) {
      setSuccess(t('settingsPage.pwUpdated'));
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } else {
      setError(result.message);
    }
  };

  return (
    <Section title={t('settingsPage.changePassword')} description={t('settingsPage.changePasswordDesc')} icon="ph-lock-key">
      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-2 text-sm text-red-500">
          <i className="ph-bold ph-warning" /> {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-xl flex items-center gap-2 text-sm text-green-500">
          <i className="ph-bold ph-check-circle" /> {success}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TextInput label={t('settingsPage.currentPassword')} type="password" value={currentPw} onChange={setCurrentPw} placeholder="••••••••" />
        <TextInput label={t('settingsPage.newPassword')} type="password" value={newPw} onChange={setNewPw} placeholder="••••••••" />
        <TextInput label={t('settingsPage.confirmPassword')} type="password" value={confirmPw} onChange={setConfirmPw} placeholder="••••••••" />
      </div>
      <div className="flex justify-end mt-4">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <i className="ph-bold ph-spinner animate-spin" />}
          {loading ? t('settingsPage.updating') : t('settingsPage.updatePassword')}
        </button>
      </div>
    </Section>
  );
};

/* ── Main page ────────────────────────────────────────── */
interface SettingsProps {
  onLogout?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onLogout }) => {
  const { isDarkMode, toggleDarkMode, animationsPreference, prefersReducedMotion, setAnimationsEnabled } = useAppContext();
  const t = useT();

  // Personal Info
  const [displayName, setDisplayName] = useState(
    `${localStorage.getItem('currentUserFirstName') || ''} ${localStorage.getItem('currentUserLastName') || ''}`.trim()
  );
  const email = localStorage.getItem('currentUserEmail') || '';
  const studentId = localStorage.getItem('currentUserOdId') || '';
  const userId = localStorage.getItem('currentUserId') || '';
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Name-change request state
  const [namePending, setNamePending] = useState(false);
  const [, setNameRequestId] = useState<string | null>(null);

  // Notifications
  const [notifyAssignments, setNotifyAssignments] = useState(true);
  const [notifyGrades, setNotifyGrades] = useState(true);
  const [notifyAnnouncements, setNotifyAnnouncements] = useState(true);
  const [notifyChatroom, setNotifyChatroom] = useState(false);

  // Load persisted settings from backend on mount.
  // Privacy section was removed (2026-05-03) — its toggles were UI-only and
  // not consumed anywhere. Only notifications round-trip to the server.
  useEffect(() => {
    if (!userId) return;
    fetch(`${API_URLS.userProfile()}/api/settings/${userId}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
    })
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then((data: { notifications?: { assignments?: boolean; grades?: boolean; announcements?: boolean; messages?: boolean } }) => {
        const n = data.notifications ?? {};
        if (n.assignments !== undefined) setNotifyAssignments(n.assignments);
        if (n.grades !== undefined) setNotifyGrades(n.grades);
        if (n.announcements !== undefined) setNotifyAnnouncements(n.announcements);
        if (n.messages !== undefined) setNotifyChatroom(n.messages);
      })
      .catch(() => {}); // silently keep defaults on error
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Check for an existing pending name-change request on mount
  useEffect(() => {
    if (!userId) return;
    fetch(`${API_URLS.userProfile()}/api/profile/name-change-requests/${userId}`, {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { requests?: Array<{ id: string; status: string }> }) => {
        const pending = data.requests?.find(r => r.status === 'pending');
        if (pending) {
          setNamePending(true);
          setNameRequestId(pending.id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Save a patch to the settings endpoint (optimistic — local state already updated by caller)
  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!userId) return;
    await fetch(`${API_URLS.userProfile()}/api/settings/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('authToken')}`,
      },
      body: JSON.stringify(patch),
    }).catch(() => {}); // silent fail — toggle already flipped locally
  };

  const handleSaveProfile = async () => {
    setSaveStatus('saving');
    try {
      const parts = displayName.trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ');
      if (!firstName || !lastName) {
        setSaveStatus('error');
        return;
      }

      // Name changes go through the approval flow
      const currentFirst = localStorage.getItem('currentUserFirstName') || '';
      const currentLast = localStorage.getItem('currentUserLastName') || '';
      const nameChanged = firstName !== currentFirst || lastName !== currentLast;

      if (nameChanged) {
        if (namePending) {
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 2500);
          return;
        }
        const res = await fetch(`${API_URLS.userProfile()}/api/profile/name-change-request`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestedFirstName: firstName, requestedLastName: lastName }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setNamePending(true);
          setSaveStatus('error');
          setTimeout(() => setSaveStatus('idle'), 2500);
          return;
        }
        if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to submit name change request');
        setNamePending(true);
        setNameRequestId((data as { request?: { id: string } }).request?.id ?? null);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        // No name change — nothing else to patch at this time
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      }
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2500);
    }
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('settingsPage.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('settingsPage.subtitle')}</p>
      </AnimateOnView>

      {/* 1 — Personal Info */}
      <AnimateOnView delay={0.05}>
        <Section title={t('settingsPage.personalInfo')} description={t('settingsPage.personalInfoDesc')} icon="ph-user-circle">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <TextInput
                label={t('settingsPage.displayName')}
                value={displayName}
                onChange={setDisplayName}
                placeholder={t('settingsPage.displayNamePlaceholder')}
                readOnly={namePending}
              />
              {namePending && (
                <p className="text-xs text-yellow-400 mt-1">{t('settingsPage.namePending')}</p>
              )}
            </div>
            <TextInput label={t('settingsPage.email')} value={email} onChange={() => {}} readOnly />
            <TextInput label={t('settingsPage.studentId')} value={studentId} onChange={() => {}} readOnly />
          </div>
          <div className="flex justify-end mt-4 gap-2 items-center">
            {saveStatus === 'saved' && (
              <span className="text-green-500 text-sm flex items-center gap-1">
                <i className="ph-bold ph-check-circle" /> {t('settingsPage.saved')}
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-500 text-sm flex items-center gap-1">
                <i className="ph-bold ph-warning" /> {namePending ? t('settingsPage.nameAlreadyPending') : t('settingsPage.saveFailed')}
              </span>
            )}
            <button
              onClick={handleSaveProfile}
              disabled={saveStatus === 'saving'}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? t('settingsPage.saving') : t('settingsPage.saveChanges')}
            </button>
          </div>
        </Section>
      </AnimateOnView>

      {/* 2 — Notifications */}
      <AnimateOnView delay={0.1}>
        <Section title={t('settingsPage.notifications')} description={t('settingsPage.notificationsDesc')} icon="ph-bell">
          <div className="space-y-3">
            <ToggleRow
              label={t('settingsPage.notifAssignments')}
              description={t('settingsPage.notifAssignmentsDesc')}
              enabled={notifyAssignments}
              onToggle={() => {
                setNotifyAssignments(p => !p);
                saveSettings({ notifications: { assignments: !notifyAssignments } });
              }}
            />
            <ToggleRow
              label={t('settingsPage.notifGrades')}
              description={t('settingsPage.notifGradesDesc')}
              enabled={notifyGrades}
              onToggle={() => {
                setNotifyGrades(p => !p);
                saveSettings({ notifications: { grades: !notifyGrades } });
              }}
            />
            <ToggleRow
              label={t('settingsPage.notifAnnouncements')}
              description={t('settingsPage.notifAnnouncementsDesc')}
              enabled={notifyAnnouncements}
              onToggle={() => {
                setNotifyAnnouncements(p => !p);
                saveSettings({ notifications: { announcements: !notifyAnnouncements } });
              }}
            />
            <ToggleRow
              label={t('settingsPage.notifChatroom')}
              description={t('settingsPage.notifChatroomDesc')}
              enabled={notifyChatroom}
              onToggle={() => {
                setNotifyChatroom(p => !p);
                saveSettings({ notifications: { messages: !notifyChatroom } });
              }}
            />
            <PushNotificationsToggle />
          </div>
        </Section>
      </AnimateOnView>

      {/* 3 — Accessibility (Privacy section removed 2026-05-03 — its toggles
              were UI-only and not consumed anywhere) */}
      <AnimateOnView delay={0.2}>
        <Section title={t('settingsPage.accessibility')} description={t('settingsPage.accessibilityDesc')} icon="ph-eye">
          <div className="space-y-3">
            <ToggleRow
              label={t('settingsPage.darkMode')}
              description={t('settingsPage.darkModeDesc')}
              enabled={isDarkMode}
              onToggle={toggleDarkMode}
            />
            {/* Plan 8 Phase 2 — decorative animations toggle. Off = static UI;
                toasts / modals / loading spinners still animate (whitelisted).
                The toggle reflects + flips the USER's preference; OS-level
                prefers-reduced-motion stacks on top (forces motion off even
                when the user hasn't toggled it) and surfaces a hint below. */}
            <ToggleRow
              label={t('settingsPage.reduceMotion')}
              description={
                prefersReducedMotion
                  ? t('settingsPage.reduceMotionOsHint')
                  : t('settingsPage.reduceMotionDesc')
              }
              enabled={!animationsPreference}
              onToggle={() => setAnimationsEnabled(!animationsPreference)}
            />
          </div>
        </Section>
      </AnimateOnView>

      {/* Plan 4 Phase 6 — Enrollment workflow requests (Articles 20, 21, 23). */}
      <AnimateOnView delay={0.22}>
        <EnrollmentRequestsSection />
      </AnimateOnView>

      {/* Password */}
      <AnimateOnView delay={0.25}>
        <PasswordSection />
      </AnimateOnView>

      {/* Session */}
      {onLogout && (
        <AnimateOnView delay={0.3}>
          <div className={`${glassCard} p-4 sm:p-6 flex items-center justify-between gap-3`}>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-black dark:text-white">{t('settingsPage.session')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('settingsPage.sessionDesc')}</p>
            </div>
            <button
              onClick={onLogout}
              aria-label={t('settingsPage.logOut')}
              className="flex-shrink-0 flex items-center gap-2 border border-red-500/30 text-red-500 dark:text-red-400 font-bold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl hover:bg-red-500/10 transition-colors text-xs sm:text-sm"
            >
              <i className="ph-bold ph-sign-out text-base sm:text-lg" />
              <span className="hidden sm:inline">{t('settingsPage.logOut')}</span>
            </button>
          </div>
        </AnimateOnView>
      )}
    </div>
  );
};

export default Settings;
