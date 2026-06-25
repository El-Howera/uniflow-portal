// src/pages/ta/Settings.tsx
import React, { useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

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

// Plan 8 Phase 3 — wraps GlassDropdown so existing call sites stay intact.
const SelectInput: React.FC<{
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    <Label>{label}</Label>
    <GlassDropdown
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o, label: o }))}
      direction="up"
      className="w-full"
    />
  </div>
);

const ToggleRow: React.FC<{ label: string; description?: string; enabled: boolean; onToggle: () => void }> = ({
  label, description, enabled, onToggle,
}) => (
  <div className="flex items-center justify-between gap-3 p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-black dark:text-white">{label}</div>
      {description && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</div>}
    </div>
    {/* `dir="ltr"` keeps the binary toggle visual direction-independent. */}
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

/* ── Section wrapper ──────────────────────────────────── */
const Section: React.FC<{ title: string; description: string; icon: string; children: React.ReactNode }> = ({
  title, description, icon, children,
}) => (
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

/* ── Password change section ──────────────────────────── */
const PasswordSection: React.FC = () => {
  const t = useT();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    // MVP build — local-only validation + success, no backend call.
    setError(null);
    setSuccess(null);
    if (!currentPw || !newPw || !confirmPw) { setError(t('ta.pwFillAll')); return; }
    if (newPw.length < 8) { setError(t('ta.pwMinLen')); return; }
    if (newPw !== confirmPw) { setError(t('ta.pwMismatch')); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(t('ta.pwUpdatedOk'));
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    }, 400);
  };

  return (
    <Section title={t('ta.changePasswordSectionTitle')} description={t('ta.changePasswordSectionDesc')} icon="ph-lock-key">
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
        <TextInput label={t('ta.currentPasswordLabel')} type="password" value={currentPw} onChange={setCurrentPw} placeholder="••••••••" />
        <TextInput label={t('ta.newPasswordLabel')} type="password" value={newPw} onChange={setNewPw} placeholder="••••••••" />
        <TextInput label={t('ta.confirmNewPasswordLabel')} type="password" value={confirmPw} onChange={setConfirmPw} placeholder="••••••••" />
      </div>
      <div className="flex justify-end mt-4">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <i className="ph-bold ph-spinner animate-spin" />}
          {loading ? t('ta.updatingPwBtn') : t('ta.updatePasswordBtn')}
        </button>
      </div>
    </Section>
  );
};

/* ── Main page ────────────────────────────────────────── */
interface TASettingsProps {
  onLogout?: () => void;
}

const TASettings: React.FC<TASettingsProps> = ({ onLogout }) => {
  const t = useT();
  const { isDarkMode, toggleDarkMode, animationsPreference, prefersReducedMotion, setAnimationsEnabled } = useAppContext();

  // Profile state
  const [displayName, setDisplayName] = useState(
    `${localStorage.getItem('currentUserFirstName') || ''} ${localStorage.getItem('currentUserLastName') || ''}`.trim()
  );
  const email = localStorage.getItem('currentUserEmail') || 'layla.hassan@uniflow.edu';
  const [officeLocation, setOfficeLocation] = useState('Office 312, CS Building');
  const [availabilityNotes, setAvailabilityNotes] = useState('Mon 1–3 PM, Wed 10 AM–12 PM');

  // Notification toggles
  const [submissionAlerts, setSubmissionAlerts] = useState(true);
  const [gradingReminders, setGradingReminders] = useState(true);

  // Preferences
  const [language, setLanguage] = useState('English');

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleSaveProfile = () => {
    // MVP build — local-only save, no backend call.
    setSaveStatus('saving');
    setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    }, 400);
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView enabled={false}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('common.settings')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('settingsPage.subtitle')}</p>
      </AnimateOnView>

      {/* Profile */}
      <AnimateOnView delay={0.05} enabled={false}>
        <Section title={t('ta.profileSectionTitle')} description={t('ta.profileSectionDesc')} icon="ph-user-circle">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextInput label={t('ta.displayNameLabel')} value={displayName} onChange={setDisplayName} />
            <TextInput label={t('ta.emailLabelReadOnly')} value={email} onChange={() => {}} readOnly />
            <TextInput label={t('ta.officeLocationLabel')} value={officeLocation} onChange={setOfficeLocation} placeholder={t('ta.officeLocationPlaceholder')} />
            <TextInput
              label={t('ta.availabilityNotesLabel')}
              value={availabilityNotes}
              onChange={setAvailabilityNotes}
              placeholder={t('ta.availabilityNotesPlaceholder')}
            />
          </div>
          <div className="flex justify-end mt-4 gap-2 items-center">
            {saveStatus === 'saved' && (
              <span className="text-green-500 text-sm flex items-center gap-1">
                <i className="ph-bold ph-check-circle" /> {t('ta.savedFlash')}
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-500 text-sm flex items-center gap-1">
                <i className="ph-bold ph-warning" /> {t('ta.saveFailedFlash')}
              </span>
            )}
            <button
              onClick={handleSaveProfile}
              disabled={saveStatus === 'saving'}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? t('ta.savingBtn') : t('ta.saveProfileBtn')}
            </button>
          </div>
        </Section>
      </AnimateOnView>

      {/* Notifications */}
      <AnimateOnView delay={0.1} enabled={false}>
        <Section title={t('ta.notificationsSectionTitle')} description={t('ta.notificationsSectionDesc')} icon="ph-bell">
          <div className="space-y-3">
            <ToggleRow
              label={t('ta.submissionAlertsLabel')}
              description={t('ta.submissionAlertsDesc')}
              enabled={submissionAlerts}
              onToggle={() => setSubmissionAlerts(prev => !prev)}
            />
            <ToggleRow
              label={t('ta.gradingRemindersLabel')}
              description={t('ta.gradingRemindersDesc')}
              enabled={gradingReminders}
              onToggle={() => setGradingReminders(prev => !prev)}
            />
          </div>
        </Section>
      </AnimateOnView>

      {/* Preferences */}
      <AnimateOnView delay={0.15} enabled={false}>
        <Section title={t('ta.preferencesSectionTitle')} description={t('ta.preferencesSectionDesc')} icon="ph-sliders-horizontal">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <SelectInput
              label={t('ta.interfaceLanguageLabel')}
              value={language}
              options={['English', 'Arabic']}
              onChange={v => setLanguage(v)}
            />
          </div>
          <div className="space-y-3">
            <ToggleRow
              label={t('ta.darkModeLabel')}
              description={t('ta.darkModeDesc')}
              enabled={isDarkMode}
              onToggle={toggleDarkMode}
            />
            {/* Plan 8 Phase 2 — decorative animations toggle. Reflects + flips
                the user's preference; OS prefers-reduced-motion stacks on top. */}
            <ToggleRow
              label={t('ta.reduceMotionLabel')}
              description={
                prefersReducedMotion
                  ? t('ta.reduceMotionDescOS')
                  : t('ta.reduceMotionDescPlain')
              }
              enabled={!animationsPreference}
              onToggle={() => setAnimationsEnabled(!animationsPreference)}
            />
          </div>
        </Section>
      </AnimateOnView>

      {/* Password */}
      <AnimateOnView delay={0.2} enabled={false}>
        <PasswordSection />
      </AnimateOnView>

      {/* Logout */}
      {onLogout && (
        <AnimateOnView delay={0.25} enabled={false}>
          <div className={`${glassCard} p-4 sm:p-6 flex items-center justify-between gap-3`}>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-black dark:text-white">{t('settingsPage.session')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('settingsPage.sessionDesc')}</p>
            </div>
            <button
              onClick={onLogout}
              aria-label={t('ta.logOutBtn')}
              className="flex-shrink-0 flex items-center gap-2 border border-red-500/30 text-red-500 dark:text-red-400 font-bold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl hover:bg-red-500/10 transition-colors text-xs sm:text-sm"
            >
              <i className="ph-bold ph-sign-out text-base sm:text-lg" />
              <span className="hidden sm:inline">{t('common.logout')}</span>
            </button>
          </div>
        </AnimateOnView>
      )}
    </div>
  );
};

export default TASettings;
