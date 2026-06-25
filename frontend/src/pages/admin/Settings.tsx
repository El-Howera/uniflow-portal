// src/pages/admin/Settings.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls. Every tab (General /
// Brand / Roles & Permissions / Maintenance) loads from static mock data and
// every save / reset / create / delete / backup / restore is a local-only
// state mutation (no network).
import React, { FC, useState, useEffect, useRef, createContext, useContext } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useAppContext } from '../../context/AppContext';
import { useBrand } from '../../context/BrandContext';
import { Logo } from '../../components/Logo';
import PermissionOverridesPanel from './PermissionOverridesPanel';
import {
  DEFAULT_INSTITUTION,
  InstitutionConfig,
  adminDashboardHeading,
  articleHint,
  useInstitutionConfig,
} from '../../config/institutionConfig';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const inputStyle = "w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors";

/* ─── General Settings Context ────────────────────── */
type Settings = {
  appName: string;
  language: string;
  timezone: string;
  currency: string;
  userRegistration: boolean;
  // When true, every student-initiated registration goes through SA review.
  // When false, registrations auto-approve UNLESS the student is on
  // probation or registering above their level (those always pend).
  registrationGatekeep: boolean;
  // Plan 6 Phase 1 — institution-wide brand + regulatory framework labels.
  institutionConfig: InstitutionConfig;
};
type SettingsContextType = {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  saved: boolean;
  setSaved: (v: boolean) => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const SettingsProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>({
    appName: adminDashboardHeading(DEFAULT_INSTITUTION),
    language: 'English',
    timezone: 'UTC',
    currency: 'EGP',
    userRegistration: true,
    registrationGatekeep: false,
    institutionConfig: DEFAULT_INSTITUTION,
  });
  const [saved, setSaved] = useState(false);

  // MVP BUILD — settings are seeded from the realistic defaults above; no
  // backend load. (FCDS institution config + EGP currency + English locale.)

  const updateSetting = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings(prev => ({ ...prev, [k]: v }));

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, saved, setSaved }}>
      {children}
    </SettingsContext.Provider>
  );
};

const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};

/* ─── UI Atoms ────────────────────────────────────── */
const Label: FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">{children}</label>
);

const TextRowInput: FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div><Label>{label}</Label><input value={value} onChange={e => onChange(e.target.value)} className={inputStyle} /></div>
);

// Plan 8 Phase 3 — wraps GlassDropdown so the call sites in the admin
// Settings tabs stay unchanged.
const SelectRow: FC<{ label: string; value: string; options: string[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
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

const ToggleRow: FC<{ label: string; enabled: boolean; onToggle: () => void }> = ({ label, enabled, onToggle }) => {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-black dark:text-white">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{t('admin.setToggleHint', { label: label.toLowerCase() })}</div>
      </div>
      {/* `dir="ltr"` keeps the binary toggle visual direction-independent. */}
      <button onClick={onToggle} aria-pressed={enabled} dir="ltr"
        className={`relative inline-flex flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors p-0.5 ${enabled ? 'bg-[#6A3FF4]' : 'bg-gray-300 dark:bg-black/30 ring-1 ring-inset ring-black/10 dark:ring-white/10'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white transform transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
};

/* ─── General Settings Form ───────────────────────── */
const SettingsForm: FC = () => {
  const t = useT();
  const { settings, updateSetting, saved, setSaved } = useSettings();
  // Plan 8 Phase 2 — Admin's own motion toggle + dark-mode toggle. Admin
  // Settings is system-wide config; these rows are user-level personal
  // prefs (mirrored from the other Settings pages — admin previously had
  // no light/dark control at all).
  const { animationsPreference, prefersReducedMotion, setAnimationsEnabled, isDarkMode, toggleDarkMode } = useAppContext();

  // Local-only save — flash the "Saved!" state; no backend.
  const handleSave = async () => {
    try {
      const { setCurrency } = await import('../../utils/format');
      setCurrency(settings.currency);
    } catch { /* graceful */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Local-only reset — restore the defaults in component state.
  const handleReset = () => {
    if (!window.confirm(t('admin.setGenResetConfirm'))) return;
    const defaultAppName = adminDashboardHeading(DEFAULT_INSTITUTION);
    updateSetting('appName', defaultAppName);
    updateSetting('language', 'English');
    updateSetting('timezone', 'UTC');
    updateSetting('currency', 'EGP');
    updateSetting('userRegistration', true);
    updateSetting('registrationGatekeep', false);
    updateSetting('institutionConfig', DEFAULT_INSTITUTION);
  };

  const updateInstitution = <K extends keyof InstitutionConfig>(k: K, v: InstitutionConfig[K]) => {
    updateSetting('institutionConfig', { ...settings.institutionConfig, [k]: v });
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-black dark:text-white">{t('admin.setGenAppDetails')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('admin.setGenAppDetailsSub')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TextRowInput label={t('admin.setGenAppName')} value={settings.appName} onChange={v => updateSetting('appName', v)} />
        <SelectRow label={t('admin.setGenDefaultLang')} value={settings.language} options={['English', 'Arabic', 'Spanish']} onChange={v => updateSetting('language', v)} />
        <SelectRow label={t('admin.setGenTimezone')} value={settings.timezone} options={['UTC', 'Africa/Cairo', 'America/New_York']} onChange={v => updateSetting('timezone', v)} />
        <SelectRow label={t('admin.setGenCurrency')} value={settings.currency} options={['EGP', 'USD', 'EUR', 'SAR', 'AED', 'GBP', 'JPY']} onChange={v => updateSetting('currency', v)} />
      </div>
      <div className="mb-6">
        <h3 className="text-lg font-bold text-black dark:text-white mb-3">{t('admin.setGenInstitution')}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('admin.setGenInstitutionHint')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextRowInput
            label={t('admin.setGenLblInstitutionName')}
            value={settings.institutionConfig.institutionName}
            onChange={v => updateInstitution('institutionName', v)}
          />
          <TextRowInput
            label={t('admin.setGenLblProductName')}
            value={settings.institutionConfig.productName}
            onChange={v => updateInstitution('productName', v)}
          />
          <TextRowInput
            label={t('admin.setGenLblRegFramework')}
            value={settings.institutionConfig.regulatoryFramework}
            onChange={v => updateInstitution('regulatoryFramework', v)}
          />
          <div className="flex flex-col gap-2">
            <ToggleRow
              label={t('admin.setGenShowArticleNumbers')}
              enabled={settings.institutionConfig.articleRefsVisible}
              onToggle={() => updateInstitution('articleRefsVisible', !settings.institutionConfig.articleRefsVisible)}
            />
            <ToggleRow
              label={t('admin.setGenBrandedResetLabels')}
              enabled={settings.institutionConfig.brandedResetLabels}
              onToggle={() => updateInstitution('brandedResetLabels', !settings.institutionConfig.brandedResetLabels)}
            />
          </div>
        </div>
      </div>
      <div className="mb-6">
        <h3 className="text-lg font-bold text-black dark:text-white mb-3">{t('admin.setGenUserSecurity')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ToggleRow label={t('admin.setGenEnableUserReg')} enabled={settings.userRegistration} onToggle={() => updateSetting('userRegistration', !settings.userRegistration)} />
          {/* Course-registration gatekeep. ON (default) sends every student
              registration to SA review. OFF auto-approves "clean" rows but
              the per-row risk gates (probation, above-level) still pend the
              row, so the admin can never accidentally let a probation
              student auto-enroll. Implemented via OR in the registration
              handler — see backend/servers/registration/index.js. */}
          <div className="flex items-center justify-between gap-3 p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-black dark:text-white">{t('admin.setGenGatekeepReg')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t('admin.setGenGatekeepRegHint')}
              </div>
            </div>
            <button
              onClick={() => updateSetting('registrationGatekeep', !settings.registrationGatekeep)}
              aria-pressed={settings.registrationGatekeep}
              dir="ltr"
              className={`relative inline-flex flex-shrink-0 h-6 w-11 items-center rounded-full transition-colors p-0.5 ${settings.registrationGatekeep ? 'bg-[#6A3FF4]' : 'bg-gray-300 dark:bg-black/30 ring-1 ring-inset ring-black/10 dark:ring-white/10'}`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white transform transition-transform ${settings.registrationGatekeep ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
            <div className="text-sm font-medium text-black dark:text-white mb-1">{t('admin.setGenSupport')}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('admin.setGenSupportHint')}</div>
          </div>
        </div>
      </div>
      {/* Plan 8 Phase 2 — admin's own motion preference. Lives next to the
          system-wide knobs because admin Settings doesn't have a separate
          personal-preferences page. Stored per-device + per-user via
          UserSettings.animationsEnabled (set in AppContext). */}
      <div className="mb-6">
        <h3 className="text-lg font-bold text-black dark:text-white mb-3">{t('admin.setGenPersonalPrefs')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
            <ToggleRow
              label={t('admin.setGenDarkMode')}
              enabled={isDarkMode}
              onToggle={toggleDarkMode}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.setGenDarkModeHint')}
            </p>
          </div>
          <div className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
            <ToggleRow
              label={t('admin.setGenReduceMotion')}
              enabled={!animationsPreference}
              onToggle={() => setAnimationsEnabled(!animationsPreference)}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {prefersReducedMotion
                ? t('admin.setGenReduceMotionSystem')
                : t('admin.setGenReduceMotionHint')}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
        >
          {saved ? t('admin.setGenSavedFlash') : t('admin.setGenSaveChanges')}
        </button>
        <button
          onClick={handleReset}
          className={`px-5 py-2.5 rounded-xl ${glassCardStyle} text-black dark:text-gray-300 font-bold hover:bg-white/20 dark:hover:bg-black/30 transition-colors`}
        >
          {t('admin.setGenResetBtn')}
        </button>
      </div>
    </div>
  );
};

/* ─── Roles & Permissions (Phase 6 — dynamic) ───────────────────────────
 * Backend is now driven by the Role + UserRoleAssignment tables, NOT a single
 * SystemSettings.rolePermissions JSON. The 5 system roles are seeded
 * (cannot be deleted) and admins can create custom roles with any permission
 * matrix. The "users" count next to each role is live from the assignment
 * table — no more sample numbers.
 *
 * Permission shape (per role): { Category: { read, write, delete } }.
 * Categories are free-form strings; this UI shows them as a flat grid.
 */
type Permission = { read: boolean; write: boolean; delete: boolean };
type RolePermissions = { [category: string]: Permission };

interface RoleSummary {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  permissions: RolePermissions;
  usersCount: number;
}

// Canonical permission categories. Each entry is a feature gate — checking
// "Read" allows the role to view the existing surface, "Write" allows
// modifications, "Delete" allows removals. Permissions DO NOT create pages;
// they restrict access to ones that already exist in the role's domain.
//
// `surfaces` lists which existing UI/API areas the permission gates, so
// admins know what they're toggling. Categories here are the ONLY values
// admins can pick from — free-text is rejected.
//
// To add a new category: extend this list AND add a `requirePermission()`
// guard on the route(s) that should respect it.
// Plan 8 follow-up — added 'financial' and 'it' so the matrix filters the
// catalog correctly when an admin opens those system roles. Without these,
// `categoriesForRole` fell through to "no surface known → show every
// category", which was the "shows all pages" bug.
type PermissionSurface = 'admin' | 'staff' | 'student' | 'sa' | 'financial' | 'it';

// `supports` declares which ops the backend actually implements for the
// category. The matrix greys out unsupported checkboxes so admins can't
// toggle on something that has no enforcement target. Categories that are
// inherently read-only (e.g. Audit Logs) only have `read: true`.
type SupportedOps = { read: boolean; write: boolean; delete: boolean };
// Plan 6 Phase 1 — descriptions can be either static strings OR functions of
// the institution config. Function-form is used by entries that mention
// "Article N" so the prefix appears only when an admin opts in via
// Settings → Institution → "Show Article Numbers".
type PermissionDescription = string | ((inst: InstitutionConfig) => string);

function resolvePermissionDescription(d: PermissionDescription, inst: InstitutionConfig): string {
  return typeof d === 'function' ? d(inst) : d;
}

const PERMISSION_CATEGORY_CATALOG: {
  name: string;
  description: PermissionDescription;
  surfaces: PermissionSurface[];
  supports: SupportedOps;
}[] = [
  // Admin / system-wide
  { name: 'Student Management',     description: 'View, edit, deactivate student accounts',                  surfaces: ['admin', 'sa'],                       supports: { read: true, write: true,  delete: true  } },
  { name: 'Faculty Management',     description: 'View, edit, deactivate professor / TA accounts',           surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  { name: 'Course Management',      description: 'Create, edit, delete courses + sections',                  surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  { name: 'Course Catalog',         description: 'Browse the public course catalog (read-only)',             surfaces: ['student'],                           supports: { read: true, write: false, delete: false } },
  { name: 'Registration',           description: 'Register / drop courses, view own schedule',               surfaces: ['student'],                           supports: { read: true, write: true,  delete: false } },
  { name: 'Financial Management',   description: 'Invoices, transactions, refunds, financial reports',       surfaces: ['admin', 'sa', 'financial'],          supports: { read: true, write: true,  delete: true  } },
  { name: 'Payments',               description: 'View own invoices, pay invoice',                           surfaces: ['student'],                           supports: { read: true, write: true,  delete: false } },
  { name: 'Analytics Dashboard',    description: 'GPA distribution, attendance trends, dropout risk',        surfaces: ['admin', 'it'],                       supports: { read: true, write: false, delete: false } },
  { name: 'Announcements',          description: 'Read / create / delete announcements',                     surfaces: ['admin', 'sa', 'staff', 'student', 'financial', 'it'], supports: { read: true, write: true,  delete: true  } },
  { name: 'System Settings',        description: 'App-wide config, grading rules, calendar',                 surfaces: ['admin', 'it'],                       supports: { read: true, write: true,  delete: false } },
  { name: 'Academic Settings',      description: 'Umbrella category — level progression, grading rules, prerequisites, course rules, etc.', surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  // Plan 4 follow-up — fine-grained categories for the new admin pages so
  // an admin can grant read/write/delete on each independently of the
  // umbrella `Academic Settings` flag.
  { name: 'Graduation Policy',      description: (inst) => articleHint(inst, 8, 'Minimum credits, semesters, CGPA required to graduate.'), surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  { name: 'Semester Calendar',      description: (inst) => articleHint(inst, 5, 'Length in weeks of Fall / Spring / Summer semesters.'),   surfaces: ['admin'],                             supports: { read: true, write: true,  delete: false } },
  { name: 'Departments',            description: (inst) => articleHint(inst, '1, 2', 'Academic departments / programs CRUD.'),              surfaces: ['admin'],                             supports: { read: true, write: true,  delete: true  } },
  { name: 'Registration Windows',   description: (inst) => articleHint(inst, '13, 14, 15', 'Late-registration / add-drop / withdrawal windows.'), surfaces: ['admin'],                       supports: { read: true, write: true,  delete: false } },
  { name: 'Incomplete Policy',      description: (inst) => articleHint(inst, 17, 'Term-work threshold + max incompletes per student.'), surfaces: ['admin'],                              supports: { read: true, write: true,  delete: false } },
  { name: 'Repetition Policy',      description: (inst) => articleHint(inst, 18, 'Retake CGPA cap + grade cap on retakes.'),           surfaces: ['admin'],                              supports: { read: true, write: true,  delete: false } },
  { name: 'Honors Policy',          description: (inst) => articleHint(inst, 22, 'Graduation honors qualification: per-semester + cumulative GPA, disqualifying grades.'), surfaces: ['admin'],     supports: { read: true, write: true,  delete: false } },
  { name: 'Enrollment Workflows',   description: (inst) => articleHint(inst, '20, 21, 23', 'Review queue + cap policy for suspension / cancellation / programme change.'), surfaces: ['admin', 'sa'], supports: { read: true, write: true,  delete: false } },
  { name: 'Mobility Policy',        description: (inst) => articleHint(inst, '24, 25', 'External transfer cap + visiting-student credit caps.'), surfaces: ['admin'],                            supports: { read: true, write: true,  delete: false } },
  { name: 'External Credits',       description: 'Review queue: external credit transfers from other faculties / institutions', surfaces: ['admin'],                            supports: { read: true, write: true,  delete: true  } },
  { name: 'Auditors',               description: 'Review queue: auditor enrollments (internal + external visitors)', surfaces: ['admin'],                            supports: { read: true, write: true,  delete: true  } },
  { name: 'Advisor Policy',         description: (inst) => articleHint(inst, 12, 'Academic advisor approval gate.'),         surfaces: ['admin'],                            supports: { read: true, write: true,  delete: false } },
  { name: 'Advisees',               description: 'Professor queue: advisor approval for assigned students',  surfaces: ['staff'],                            supports: { read: true, write: true,  delete: false } },
  { name: 'Credit Hour Definition', description: (inst) => articleHint(inst, 6, 'Contact-hours per credit by course type.'), surfaces: ['admin'],                            supports: { read: true, write: true,  delete: false } },
  { name: 'Audit Logs',             description: 'View system audit trail',                                  surfaces: ['admin', 'it'],                       supports: { read: true, write: false, delete: false } },
  // Plan 8 — IT scope categories. Staff Chat extended to financial + it so
  // their sidebars surface the staff chatroom entry; admins still see it too.
  { name: 'Staff Chat',             description: 'Cross-staff Firestore chat groups (admin/SA/financial/IT/professor/TA cohorts).', surfaces: ['admin', 'financial', 'it'], supports: { read: true, write: true,  delete: false } },
  { name: 'Sign-In Locks',          description: 'Time-window restrictions on sign-in (kind / target).',     surfaces: ['admin', 'it'],                       supports: { read: true, write: true,  delete: true  } },
  // Plan 8 — financial scope categories.
  { name: 'Payroll',                description: 'Employee profiles, payroll runs, payslip PDFs.',           surfaces: ['admin', 'financial'],                supports: { read: true, write: true,  delete: false } },
  { name: 'Financial Aid',          description: 'Aid request queue + approve / reject workflow.',           surfaces: ['admin', 'sa', 'financial'],          supports: { read: true, write: true,  delete: false } },
  // Course-level
  { name: 'Grading',                description: 'Set / propose / approve grades for submissions',           surfaces: ['staff', 'admin'],                    supports: { read: true, write: true,  delete: false } },
  // Attendance — staff/admin start + mark sessions; SA reviews excuse
  // requests; student views own attendance. All four surfaces share the
  // same backend category so toggling Attendance:read in any role's matrix
  // hides their attendance sidebar entry.
  { name: 'Attendance',             description: 'Start sessions, mark attendance, view stats, review excuses, view own attendance', surfaces: ['staff', 'admin', 'sa', 'student'], supports: { read: true, write: true,  delete: false } },
  { name: 'Materials',              description: 'Upload / view course materials and lectures',              surfaces: ['staff', 'student'],                  supports: { read: true, write: true,  delete: true  } },
  { name: 'Grades',                 description: 'View own grade reports / transcripts',                     surfaces: ['student'],                           supports: { read: true, write: false, delete: false } },
  // Student affairs — students file complaints + view their own; SA + admin
  // manage and resolve them. Extending the student surface makes the matrix
  // expose Complaints when admin edits the student role.
  { name: 'Complaints',             description: 'File or manage student complaints + resolutions',          surfaces: ['sa', 'admin', 'student'],            supports: { read: true, write: true,  delete: false } },
  { name: 'Name Change Requests',   description: 'Approve student name change requests',                     surfaces: ['sa', 'admin'],                       supports: { read: true, write: true,  delete: false } },
  // Reports / read-only roles like Auditor
  { name: 'Reports',                description: 'Per-student dossier search + institutional reports',       surfaces: ['admin', 'sa', 'financial', 'it'],    supports: { read: true, write: false, delete: false } },
];

// Logical grouping of permission categories for the matrix UI. Each group
// renders as a collapsible block with a "toggle all" header so admins can
// flip every category in (say) Academic Settings on or off without ticking
// 14 boxes individually. The granular categories still exist behind the
// scenes — the backend enforcement uses the specific name (Honors Policy,
// Incomplete Policy, etc.), so an admin can still hand-tune any single row.
//
// Order matters: groups render in this order, so put the most-edited groups
// first (Academic Settings is admin's daily work, User & Course Management
// second, etc.).
const CATEGORY_GROUPS: { name: string; description: string; categories: string[] }[] = [
  {
    name: 'Academic Settings',
    description: 'Calendar, course settings, prerequisites, degree requirements, grading policies, mobility, advisors.',
    categories: [
      'Academic Settings', 'Graduation Policy', 'Semester Calendar', 'Departments',
      'Registration Windows', 'Incomplete Policy', 'Repetition Policy', 'Honors Policy',
      'Enrollment Workflows', 'Mobility Policy', 'Advisor Policy', 'Credit Hour Definition',
      'External Credits', 'Auditors',
    ],
  },
  {
    name: 'User & Course Management',
    description: 'CRUD for students, faculty, courses, sections, registrations.',
    categories: [
      'Student Management', 'Faculty Management', 'Course Management',
      'Course Catalog', 'Registration',
    ],
  },
  {
    name: 'Financial',
    description: 'Fees, invoices, payments, payroll, financial aid.',
    categories: [
      'Financial Management', 'Payments', 'Payroll', 'Financial Aid',
    ],
  },
  {
    name: 'Communication',
    description: 'Announcements + staff chat.',
    categories: [
      'Announcements', 'Staff Chat',
    ],
  },
  {
    name: 'Analytics & Audit',
    description: 'Dashboards, audit logs, system-wide reports.',
    categories: [
      'Analytics Dashboard', 'Reports', 'Audit Logs',
    ],
  },
  {
    name: 'Operations',
    description: 'System settings, sign-in locks, manual enrollment, per-user permissions, impersonation.',
    categories: [
      'System Settings', 'Sign-In Locks', 'Manual Enrollment',
      'Per-User Permissions', 'Impersonation',
    ],
  },
  {
    name: 'Teaching',
    description: 'Course-level work: grading, attendance, materials, advisees.',
    categories: [
      'Grading', 'Attendance', 'Materials', 'Advisees',
    ],
  },
  {
    name: 'Student Self-Service',
    description: 'Read-only student-facing categories.',
    categories: [
      'Grades',
    ],
  },
  {
    name: 'Support',
    description: 'Student affairs workflows.',
    categories: [
      'Complaints', 'Name Change Requests',
    ],
  },
];

// Reverse index: category name → group name. Categories without an explicit
// group fall back to "Other" at render time.
const CATEGORY_GROUP_OF: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const g of CATEGORY_GROUPS) {
    for (const c of g.categories) m[c] = g.name;
  }
  return m;
})();

const SURFACE_BADGE: Record<PermissionSurface, { label: string; cls: string }> = {
  admin:     { label: 'admin',     cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  staff:     { label: 'staff',     cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  sa:        { label: 'sa',        cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  student:   { label: 'student',   cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  financial: { label: 'financial', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  it:        { label: 'it',        cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
};

// Each system role belongs to a single surface. Custom roles (isSystem=false)
// have no implicit surface — they're free-form, so the matrix shows the full
// catalog. Mirrors backend/scripts/seed-roles.js ROLE_SURFACE.
const SYSTEM_ROLE_SURFACE: Record<string, PermissionSurface> = {
  admin:     'admin',
  professor: 'staff',
  ta:        'staff',
  sa:        'sa',
  student:   'student',
  // Plan 8 — sub-roles. Each gets a focused surface filter; categories
  // that should appear for both admin AND financial/it list both surfaces
  // in the catalog below.
  financial: 'financial',
  it:        'it',
};

/**
 * Categories the given role can use, filtered by surface for system roles.
 * Custom roles (isSystem=false) get the full catalog.
 */
function categoriesForRole(role: { name: string; isSystem: boolean }): typeof PERMISSION_CATEGORY_CATALOG {
  if (!role.isSystem) return PERMISSION_CATEGORY_CATALOG;
  const surface = SYSTEM_ROLE_SURFACE[role.name];
  if (!surface) return PERMISSION_CATEGORY_CATALOG;
  return PERMISSION_CATEGORY_CATALOG.filter((c) => c.surfaces.includes(surface));
}

const RolesList: FC<{
  roles: RoleSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  loading: boolean;
}> = ({ roles, selectedId, onSelect, onAdd, loading }) => {
  const t = useT();
  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-black dark:text-white text-xl font-bold">{t('admin.setRolesUserRoles')}</h2>
        <button
          onClick={onAdd}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
        >
          <i className="ph-bold ph-plus"></i> {t('admin.setRolesAddRole')}
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse h-12 rounded-xl bg-white/5"></div>
          ))}
        </div>
      ) : roles.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{t('admin.setRolesNone')}</p>
      ) : (
        <div className="space-y-3">
          {roles.map((r) => (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`p-4 rounded-xl cursor-pointer transition-all flex justify-between items-center ${
                selectedId === r.id
                  ? 'bg-[#6A3FF4]/20 border border-[#6A3FF4]/50'
                  : 'bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-black dark:text-white font-medium text-sm capitalize truncate">{r.name}</span>
                  {r.isSystem && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
                      {t('admin.setRolesSystemBadge')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {r.usersCount} {r.usersCount === 1 ? t('admin.setRolesUser') : t('admin.setRolesUsers')}
                </div>
              </div>
              <i className="ph-bold ph-caret-right text-gray-500 dark:text-gray-400 text-xs"></i>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CheckboxBox: FC<{ checked: boolean; onToggle: () => void; disabled?: boolean }> = ({ checked, onToggle, disabled }) => {
  const t = useT();
  if (disabled) {
    return (
      <div
        title={t('admin.setRolesOpUnsupported')}
        className="w-5 h-5 rounded-md flex items-center justify-center bg-white/5 dark:bg-black/10 border border-white/5 dark:border-white/5 cursor-not-allowed opacity-40"
      >
        <i className="ph-bold ph-minus text-gray-500 text-[10px]"></i>
      </div>
    );
  }
  return (
    <div
      onClick={onToggle}
      className={`w-5 h-5 rounded-md flex items-center justify-center cursor-pointer transition-colors ${
        checked ? 'bg-[#6A3FF4]' : 'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10'
      }`}
    >
      {checked && (
        <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
          <path d="M1 4L4 7L11 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
};

// Translation helpers for group names + descriptions. Used by
// `PermissionsDetails` at render time so the matrix labels respect the active
// locale without rebuilding the static CATEGORY_GROUPS array.
const GROUP_NAME_KEY: Record<string, string> = {
  'Academic Settings': 'admin.setCgAcademic',
  'User & Course Management': 'admin.setCgUserCourse',
  'Financial': 'admin.setCgFinancial',
  'Communication': 'admin.setCgCommunication',
  'Analytics & Audit': 'admin.setCgAnalytics',
  'Operations': 'admin.setCgOperations',
  'Teaching': 'admin.setCgTeaching',
  'Student Self-Service': 'admin.setCgStudentSelfService',
  'Support': 'admin.setCgSupport',
};
const GROUP_DESC_KEY: Record<string, string> = {
  'Academic Settings': 'admin.setCgAcademicDesc',
  'User & Course Management': 'admin.setCgUserCourseDesc',
  'Financial': 'admin.setCgFinancialDesc',
  'Communication': 'admin.setCgCommunicationDesc',
  'Analytics & Audit': 'admin.setCgAnalyticsDesc',
  'Operations': 'admin.setCgOperationsDesc',
  'Teaching': 'admin.setCgTeachingDesc',
  'Student Self-Service': 'admin.setCgStudentSelfServiceDesc',
  'Support': 'admin.setCgSupportDesc',
};
// Category description fallback map — covers the string-form catalog entries
// so the matrix shows localised descriptions for every category.
const CAT_DESC_KEY: Record<string, string> = {
  'Student Management': 'admin.setPcdStudentMgmt',
  'Faculty Management': 'admin.setPcdFacultyMgmt',
  'Course Management': 'admin.setPcdCourseMgmt',
  'Course Catalog': 'admin.setPcdCourseCatalog',
  'Registration': 'admin.setPcdRegistration',
  'Financial Management': 'admin.setPcdFinancialMgmt',
  'Payments': 'admin.setPcdPayments',
  'Analytics Dashboard': 'admin.setPcdAnalyticsDash',
  'Announcements': 'admin.setPcdAnnouncements',
  'System Settings': 'admin.setPcdSystemSettings',
  'Academic Settings': 'admin.setPcdAcademicSettings',
  'Graduation Policy': 'admin.setPcdGraduationPolicy',
  'Semester Calendar': 'admin.setPcdSemesterCalendar',
  'Departments': 'admin.setPcdDepartments',
  'Registration Windows': 'admin.setPcdRegWindows',
  'Incomplete Policy': 'admin.setPcdIncompletePolicy',
  'Repetition Policy': 'admin.setPcdRepetitionPolicy',
  'Honors Policy': 'admin.setPcdHonorsPolicy',
  'Enrollment Workflows': 'admin.setPcdEnrollWorkflows',
  'Mobility Policy': 'admin.setPcdMobilityPolicy',
  'External Credits': 'admin.setPcdExternalCredits',
  'Auditors': 'admin.setPcdAuditors',
  'Advisor Policy': 'admin.setPcdAdvisorPolicy',
  'Advisees': 'admin.setPcdAdvisees',
  'Credit Hour Definition': 'admin.setPcdCreditHourDef',
  'Audit Logs': 'admin.setPcdAuditLogs',
  'Staff Chat': 'admin.setPcdStaffChat',
  'Sign-In Locks': 'admin.setPcdSignInLocks',
  'Payroll': 'admin.setPcdPayroll',
  'Financial Aid': 'admin.setPcdFinancialAid',
  'Grading': 'admin.setPcdGrading',
  'Attendance': 'admin.setPcdAttendance',
  'Materials': 'admin.setPcdMaterials',
  'Grades': 'admin.setPcdGrades',
  'Complaints': 'admin.setPcdComplaints',
  'Name Change Requests': 'admin.setPcdNameChangeReqs',
  'Reports': 'admin.setPcdReports',
};

const PermissionsDetails: FC<{
  role: RoleSummary | null;
  onChange: (perms: RolePermissions) => void;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
  saving: boolean;
  saved: boolean;
  error: string | null;
}> = ({ role, onChange, onSave, onDelete, saving, saved, error }) => {
  const t = useT();
  const [newCategory, setNewCategory] = useState('');
  const institution = useInstitutionConfig();

  if (!role) {
    return (
      <div className={`${glassCardStyle} p-6 flex items-center justify-center min-h-[200px]`}>
        <p className="text-gray-500 italic text-sm">{t('admin.setRolesSelectRolePrompt')}</p>
      </div>
    );
  }

  const toggle = (category: string, op: keyof Permission) => {
    const next: RolePermissions = JSON.parse(JSON.stringify(role.permissions || {}));
    if (!next[category]) next[category] = { read: false, write: false, delete: false };
    next[category][op] = !next[category][op];
    onChange(next);
  };

  // Group-level toggle — flips `op` for every category in `groupName` to
  // `value`. Categories whose `supports` map doesn't include the op are
  // skipped (e.g. Audit Logs is read-only, so toggling Write on the
  // Analytics & Audit group leaves Audit Logs unchanged).
  const toggleGroup = (groupName: string, op: keyof Permission, value: boolean) => {
    const next: RolePermissions = JSON.parse(JSON.stringify(role.permissions || {}));
    for (const category of Object.keys(next)) {
      if (CATEGORY_GROUP_OF[category] !== groupName) continue;
      const meta = PERMISSION_CATEGORY_CATALOG.find((c) => c.name === category);
      const supports = meta?.supports ?? { read: true, write: true, delete: true };
      if (!supports[op]) continue;
      next[category][op] = value;
    }
    onChange(next);
  };

  const addCategory = () => {
    const name = newCategory;
    if (!name) return;
    if (role.permissions[name]) {
      setNewCategory('');
      return;
    }
    // Strict catalog enforcement — admins can only add categories the
    // system understands. The dropdown options already exclude unknown
    // values, but we belt-and-suspenders here in case state diverges.
    const known = PERMISSION_CATEGORY_CATALOG.some((c) => c.name === name);
    if (!known) {
      setNewCategory('');
      return;
    }
    onChange({ ...role.permissions, [name]: { read: false, write: false, delete: false } });
    setNewCategory('');
  };

  const removeCategory = (category: string) => {
    const next: RolePermissions = { ...role.permissions };
    delete next[category];
    onChange(next);
  };

  const categories = Object.keys(role.permissions || {}).sort();

  // Build the per-group list of categories the user currently has on this
  // role. Groups with zero relevant categories are dropped. Order matches
  // CATEGORY_GROUPS so the most-used groups (Academic Settings, etc.) render
  // first. "Other" catches any category not in the static group map (custom
  // roles using legacy names, or new categories not yet grouped).
  const groupedCategories: { name: string; description: string; categories: string[] }[] = (() => {
    const buckets = new Map<string, string[]>();
    for (const cat of categories) {
      const g = CATEGORY_GROUP_OF[cat] ?? 'Other';
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push(cat);
    }
    const out: { name: string; description: string; categories: string[] }[] = [];
    for (const g of CATEGORY_GROUPS) {
      if (buckets.has(g.name)) {
        const localisedName = GROUP_NAME_KEY[g.name] ? t(GROUP_NAME_KEY[g.name]) : g.name;
        const localisedDesc = GROUP_DESC_KEY[g.name] ? t(GROUP_DESC_KEY[g.name]) : g.description;
        out.push({ name: localisedName, description: localisedDesc, categories: buckets.get(g.name)! });
        buckets.delete(g.name);
      }
    }
    for (const [name, cats] of buckets.entries()) {
      out.push({ name, description: t('admin.setRolesUncategorisedHint'), categories: cats });
    }
    return out;
  })();

  return (
    <div className={`${glassCardStyle} p-6 flex-grow`}>
      <div className="flex justify-between items-start mb-1 gap-3">
        <div>
          <h2 className="text-black dark:text-white text-xl font-bold flex items-center gap-2">
            <span className="capitalize">{role.name}</span>
            {role.isSystem && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
                {t('admin.setRolesSystemBadge')}
              </span>
            )}
          </h2>
          {role.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{role.description}</p>
          )}
        </div>
        {!role.isSystem && (
          <button
            onClick={onDelete}
            className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1 flex-shrink-0"
          >
            <i className="ph-bold ph-trash"></i> {t('admin.setRolesDeleteRoleBtn')}
          </button>
        )}
      </div>

      {error && (
        <div className="my-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[3fr_1fr_1fr_1fr_auto] gap-4 text-gray-500 dark:text-gray-400 text-xs font-bold pb-3 mt-4 border-b border-white/10 dark:border-white/5">
        <span>{t('admin.setRolesColCategory')}</span>
        <span className="text-center">{t('admin.setRolesColRead')}</span>
        <span className="text-center">{t('admin.setRolesColWrite')}</span>
        <span className="text-center">{t('admin.setRolesColDelete')}</span>
        <span></span>
      </div>

      <div className="space-y-3 mt-1">
        {categories.length === 0 ? (
          <p className="text-sm text-gray-500 italic py-4">{t('admin.setRolesNoneCategories')}</p>
        ) : (
          groupedCategories.map((group) => {
            // Compute "how many cats in this group support op AND are granted"
            // so the group header reflects mixed state ("3/5 read granted").
            const groupCats = group.categories;
            const supportsCounts = { read: 0, write: 0, delete: 0 } as Record<keyof Permission, number>;
            const grantedCounts = { read: 0, write: 0, delete: 0 } as Record<keyof Permission, number>;
            for (const cat of groupCats) {
              const meta = PERMISSION_CATEGORY_CATALOG.find((c) => c.name === cat);
              const supports = meta?.supports ?? { read: true, write: true, delete: true };
              const ops = role.permissions[cat] || { read: false, write: false, delete: false };
              for (const op of ['read', 'write', 'delete'] as const) {
                if (supports[op]) supportsCounts[op]++;
                if (supports[op] && ops[op]) grantedCounts[op]++;
              }
            }
            const opLabel = (op: keyof Permission): string => {
              if (op === 'read') return t('admin.setRolesColRead');
              if (op === 'write') return t('admin.setRolesColWrite');
              return t('admin.setRolesColDelete');
            };
            const groupHeaderCell = (op: keyof Permission) => {
              const total = supportsCounts[op];
              const granted = grantedCounts[op];
              if (total === 0) {
                // No categories in this group support this op — nothing to toggle.
                return <span className="text-[9px] text-gray-600">{t('admin.setRolesGroupDash')}</span>;
              }
              const allOn = granted === total;
              const allOff = granted === 0;
              const label = allOn ? t('admin.setRolesAllLabel') : allOff ? t('admin.setRolesNoneLabel') : `${granted}/${total}`;
              const cls = allOn
                ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/40'
                : allOff
                ? 'bg-white/5 text-gray-400 border-white/10'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30';
              const action = allOn ? t('admin.setRolesRevoke') : t('admin.setRolesGrant');
              return (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.name, op, !allOn)}
                  title={t('admin.setRolesGroupToggleTitle', { action, op: opLabel(op), total, group: group.name })}
                  className={`px-2 py-1 text-[10px] uppercase tracking-wide font-bold rounded-md border transition-colors hover:opacity-80 ${cls}`}
                >
                  {label}
                </button>
              );
            };
            return (
              <div key={group.name} className="rounded-xl border border-white/10 dark:border-white/5 overflow-hidden">
                {/* Group header — toggle-all controls per op. */}
                <div className="grid grid-cols-[3fr_1fr_1fr_1fr_auto] gap-4 items-center px-3 py-2.5 bg-white/[0.05] dark:bg-black/30">
                  <div className="min-w-0">
                    <div className="text-black dark:text-white text-sm font-bold flex items-center gap-2">
                      <i className="ph-bold ph-folder text-[#6A3FF4] text-[13px]"></i>
                      {group.name}
                      <span className="text-[10px] font-normal text-gray-500">{t('admin.setRolesGroupCount', { n: groupCats.length })}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 truncate mt-0.5">{group.description}</div>
                  </div>
                  <div className="flex justify-center">{groupHeaderCell('read')}</div>
                  <div className="flex justify-center">{groupHeaderCell('write')}</div>
                  <div className="flex justify-center">{groupHeaderCell('delete')}</div>
                  <span></span>
                </div>
                {/* Per-category rows inside this group. */}
                <div className="divide-y divide-white/5">
                  {groupCats.map((category) => {
                    const ops = role.permissions[category] || { read: false, write: false, delete: false };
                    const meta = PERMISSION_CATEGORY_CATALOG.find((c) => c.name === category);
                    const supports = meta?.supports ?? { read: true, write: true, delete: true };
                    return (
                      <div key={category} className="grid grid-cols-[3fr_1fr_1fr_1fr_auto] gap-4 items-center px-3 py-2.5 hover:bg-white/[0.03]">
                        <div className="min-w-0 pl-5">
                          <div className="text-black dark:text-white text-sm">{category}</div>
                          {meta && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {meta.surfaces.map((s) => (
                                <span
                                  key={s}
                                  className={`text-[9px] px-1.5 py-0.5 rounded-full border uppercase tracking-wider ${SURFACE_BADGE[s].cls}`}
                                  title={t('admin.setRolesAffectsSurface', { s })}
                                >
                                  {SURFACE_BADGE[s].label}
                                </span>
                              ))}
                              <span className="text-[10px] text-gray-500 truncate">
                                {CAT_DESC_KEY[category]
                                  ? t(CAT_DESC_KEY[category])
                                  : resolvePermissionDescription(meta.description, institution)}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex justify-center">
                          <CheckboxBox checked={!!ops.read && supports.read} onToggle={() => toggle(category, 'read')} disabled={!supports.read} />
                        </div>
                        <div className="flex justify-center">
                          <CheckboxBox checked={!!ops.write && supports.write} onToggle={() => toggle(category, 'write')} disabled={!supports.write} />
                        </div>
                        <div className="flex justify-center">
                          <CheckboxBox checked={!!ops.delete && supports.delete} onToggle={() => toggle(category, 'delete')} disabled={!supports.delete} />
                        </div>
                        <button
                          onClick={() => removeCategory(category)}
                          className="text-gray-400 hover:text-red-400 text-xs"
                          title={t('admin.setRolesRemoveCategory')}
                        >
                          <i className="ph-bold ph-x"></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Category picker — uses the project-canonical GlassDropdown filter
          style. For system roles, the catalog is filtered to the role's
          surface (admin sees admin-tagged categories only, etc.). For custom
          roles, the full catalog is available. Already-added categories are
          excluded so the dropdown only shows what's still available. */}
      {(() => {
        const allowed = categoriesForRole(role);
        const available = allowed.filter((c) => !role.permissions[c.name]);
        if (available.length === 0) {
          return (
            <p className="text-xs text-gray-500 italic mt-4">
              {t('admin.setRolesAllAvailableAdded')}
            </p>
          );
        }
        const dropdownOptions = [
          { value: '', label: t('admin.setRolesChooseCategory'), icon: 'ph-list-plus' },
          ...available.map((c) => ({
            value: c.name,
            label: c.name,
            icon: 'ph-shield-check',
          })),
        ];
        return (
          <div className="flex flex-col sm:flex-row gap-2 mt-4 items-stretch sm:items-center">
            <div className="flex-1">
              <GlassDropdown
                value={newCategory}
                onChange={setNewCategory}
                options={dropdownOptions}
                className="w-full"
              />
            </div>
            <button
              onClick={addCategory}
              disabled={!newCategory}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="ph-bold ph-plus mr-1"></i> {t('admin.setRolesAddBtn')}
            </button>
          </div>
        );
      })()}

      <div className="flex justify-end mt-6">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
        >
          {saving ? t('admin.setRolesSaving') : saved ? t('admin.setRolesSaved') : t('admin.setRolesSavePerms')}
        </button>
      </div>
    </div>
  );
};

const AddRoleModal: FC<{
  open: boolean;
  templates: RoleSummary[];
  onClose: () => void;
  onCreate: (role: RoleSummary) => void;
}> = ({ open, templates, onClose, onCreate }) => {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setTemplateId('');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  // Local-only create — build the role from the chosen template and hand it
  // up. No backend.
  const handleCreate = () => {
    setError(null);
    if (!name.trim()) {
      setError(t('admin.setRolesModalNameRequired'));
      return;
    }
    setSaving(true);
    const template = templates.find((r) => r.id === templateId);
    const newRole: RoleSummary = {
      id: `role-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || null,
      isSystem: false,
      permissions: template?.permissions ? JSON.parse(JSON.stringify(template.permissions)) : {},
      usersCount: 0,
    };
    window.setTimeout(() => {
      onCreate(newRole);
      setSaving(false);
      onClose();
    }, 300);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`${glassCardStyle} p-6 w-full max-w-md mx-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.setRolesModalTitle')}</h3>
        <p className="text-xs text-gray-500 mb-4">
          {t('admin.setRolesModalIntro')}
        </p>

        {error && (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
            {error}
          </div>
        )}

        <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">{t('admin.setRolesModalNameLbl')}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('admin.setRolesModalNamePh')}
          className={`${inputStyle} mb-3`}
        />

        <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">{t('admin.setRolesModalDescLbl')}</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('admin.setRolesModalDescPh')}
          className={`${inputStyle} mb-3`}
        />

        <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase">{t('admin.setRolesModalCopyFromLbl')}</label>
        <div className="mb-5">
          <GlassDropdown
            value={templateId}
            onChange={setTemplateId}
            options={[
              { value: '', label: t('admin.setRolesModalCopyEmpty') },
              ...templates.map((r) => ({ value: r.id, label: r.name })),
            ]}
            direction="up"
            className="w-full"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-medium text-sm hover:bg-white/10"
          >
            {t('admin.setRolesModalCancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-medium text-sm hover:opacity-90 disabled:opacity-60"
          >
            {saving ? t('admin.setRolesModalCreating') : t('admin.setRolesModalCreate')}
          </button>
        </div>
      </div>
    </div>
  );
};

type RolesSubTab = 'roles' | 'overrides';

// Build a permission matrix granting every supported op for the categories
// tagged with `surface`. Used to seed the system-role mock data.
const seedPermsForSurface = (surface: PermissionSurface): RolePermissions => {
  const out: RolePermissions = {};
  for (const c of PERMISSION_CATEGORY_CATALOG) {
    if (!c.surfaces.includes(surface)) continue;
    out[c.name] = { read: c.supports.read, write: c.supports.write, delete: c.supports.delete };
  }
  return out;
};

// ── Static mock roles — the 5 system roles + 2 admin sub-roles, with live
// user counts and a full permission matrix per surface. ──────────────────
const MOCK_ROLES: RoleSummary[] = [
  { id: 'role-admin', name: 'admin', description: 'Full system administrator.', isSystem: true, permissions: seedPermsForSurface('admin'), usersCount: 3 },
  { id: 'role-professor', name: 'professor', description: 'Teaching staff.', isSystem: true, permissions: seedPermsForSurface('staff'), usersCount: 11 },
  { id: 'role-ta', name: 'ta', description: 'Teaching assistants.', isSystem: true, permissions: seedPermsForSurface('staff'), usersCount: 9 },
  { id: 'role-sa', name: 'sa', description: 'Student Affairs.', isSystem: true, permissions: seedPermsForSurface('sa'), usersCount: 6 },
  { id: 'role-student', name: 'student', description: 'Enrolled students.', isSystem: true, permissions: seedPermsForSurface('student'), usersCount: 1247 },
  { id: 'role-financial', name: 'financial', description: 'Financial officers.', isSystem: true, permissions: seedPermsForSurface('financial'), usersCount: 4 },
  { id: 'role-it', name: 'it', description: 'IT operations.', isSystem: true, permissions: seedPermsForSurface('it'), usersCount: 3 },
];

const RolesPermissionsTab: FC = () => {
  const t = useT();
  const [subTab, setSubTab] = useState<RolesSubTab>('roles');
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Hydrate roles from static mock data once on mount.
  useEffect(() => {
    const arr = MOCK_ROLES.map((r) => ({ ...r, permissions: JSON.parse(JSON.stringify(r.permissions)) }));
    setRoles(arr);
    if (arr.length > 0) setSelectedId(arr[0].id);
    setLoading(false);
  }, []);

  const selected = roles.find((r) => r.id === selectedId) || null;

  const handlePermsChange = (next: RolePermissions) => {
    setRoles((prev) => prev.map((r) => (r.id === selectedId ? { ...r, permissions: next } : r)));
  };

  // Local-only save — flash the "Saved" state. No backend.
  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    window.setTimeout(() => {
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
      setSaving(false);
    }, 300);
  };

  // Local-only delete — drop the custom role from local state.
  const handleDelete = async () => {
    if (!selected || selected.isSystem) return;
    if (!window.confirm(t('admin.setRolesDeleteConfirm', { name: selected.name }))) return;
    const removedId = selected.id;
    setRoles((prev) => prev.filter((r) => r.id !== removedId));
    setSelectedId((prev) => (prev === removedId ? (roles[0]?.id ?? null) : prev));
  };

  // Local-only create — append the new custom role and select it.
  const handleCreate = (role: RoleSummary) => {
    setRoles((prev) => [...prev, role]);
    setSelectedId(role.id);
  };

  // Sub-tab pill switcher — keeps the existing roles editor intact under
  // 'Roles' and exposes the new per-user override matrix under 'Per-User
  // Overrides'. Design-system glass pill bar (see SA pages for the same
  // pattern).
  const subTabs: { id: RolesSubTab; label: string }[] = [
    { id: 'roles', label: t('admin.setRolesSubTabRoles') },
    { id: 'overrides', label: t('admin.setRolesSubTabOverrides') },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 w-full sm:w-fit overflow-x-auto shadow-lg">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`text-sm font-bold py-2 px-4 rounded-md transition-colors whitespace-nowrap ${
              subTab === tab.id
                ? 'bg-[#6A3FF4] text-white'
                : 'text-black dark:text-gray-300 hover:text-black dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'roles' && (
        <>
          <div className="mb-6">
            <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.setRolesPageTitle')}</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t('admin.setRolesPageSubtitle')}
            </p>
          </div>
          <div className={`${glassCardStyle} p-4 mb-4 flex items-start gap-3`}>
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <i className="ph-bold ph-info text-blue-400"></i>
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              <strong className="text-black dark:text-white">{t('admin.setRolesGateHeadline')}</strong>{' '}
              {t('admin.setRolesGateBodyBefore')} <code className="px-1 py-0.5 rounded bg-white/10 text-[#7B5AFF] text-xs">{t('admin.setRolesGateBodyAttendanceRead')}</code>{t('admin.setRolesGateBodyAfter')}
            </div>
          </div>
          {!loading && roles.length === 0 && error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <i className="ph-bold ph-warning-circle mr-2"></i>
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <RolesList
                roles={roles}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAdd={() => setShowAddModal(true)}
                loading={loading}
              />
            </div>
            <div className="lg:col-span-2">
              <PermissionsDetails
                role={selected}
                onChange={handlePermsChange}
                onSave={handleSave}
                onDelete={handleDelete}
                saving={saving}
                saved={savedFlag}
                error={error}
              />
            </div>
          </div>

          <AddRoleModal
            open={showAddModal}
            templates={roles}
            onClose={() => setShowAddModal(false)}
            onCreate={handleCreate}
          />
        </>
      )}

      {subTab === 'overrides' && <PermissionOverridesPanel />}
    </div>
  );
};

/* ─── Maintenance Tab ─────────────────────────────── */

interface BackupRow {
  id: string;
  kind: string;
  path: string | null;
  bytes: number | null;
  status: 'pending' | 'success' | 'failed' | string;
  createdAt: string;
  createdBy: string | null;
}

// ── Static mock backup history ─────────────────────────────────────────────
const MOCK_BACKUPS: BackupRow[] = [
  { id: 'bk-1', kind: 'scheduled', path: 'uniflow-2026-04-28-0300.dump | full', bytes: 148_300_000, status: 'success', createdAt: '2026-04-28T03:00:00.000Z', createdBy: null },
  { id: 'bk-2', kind: 'scheduled', path: 'uniflow-2026-04-27-0300.dump | full', bytes: 147_900_000, status: 'success', createdAt: '2026-04-27T03:00:00.000Z', createdBy: null },
  { id: 'bk-3', kind: 'manual', path: 'uniflow-2026-04-26-1412.dump | full', bytes: 147_100_000, status: 'success', createdAt: '2026-04-26T14:12:00.000Z', createdBy: 'Hisham Kamal' },
  { id: 'bk-4', kind: 'scheduled', path: 'uniflow-2026-04-26-0300.dump | full', bytes: 146_500_000, status: 'success', createdAt: '2026-04-26T03:00:00.000Z', createdBy: null },
  { id: 'bk-5', kind: 'scheduled', path: null, bytes: null, status: 'failed', createdAt: '2026-04-25T03:00:00.000Z', createdBy: null },
];

// Module-level signal so BackupControlsCard's "Run Manual" can refresh the
// HistoryCard sitting next to it without a shared parent state-lift.
let bumpHistory: () => void = () => {};

const formatBytes = (n: number | null): string => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const BackupControlsCard: FC = () => {
  const t = useT();
  const [frequency, setFrequency] = useState('off');
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [savingFreq, setSavingFreq] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // MVP BUILD — seed the "Last successful" footer from the most recent mock
  // backup. Maintenance mode + frequency start from local defaults.
  useEffect(() => {
    const last = MOCK_BACKUPS.find((b) => b.status === 'success');
    if (last) setLastBackup(new Date(last.createdAt).toLocaleString());
    setFrequency('daily');
  }, []);

  // Local-only toggle.
  const toggleMaintenanceMode = () => {
    setMaintenanceMode((prev) => !prev);
  };

  // Local-only frequency change with a brief "saving" flash.
  const updateFrequency = (next: string) => {
    setFrequency(next);
    setSavingFreq(true);
    window.setTimeout(() => setSavingFreq(false), 400);
  };

  // Local-only manual backup — queue a mock row and flip its status.
  const handleBackup = () => {
    setRunning(true);
    setStatusMsg(null);
    window.setTimeout(() => {
      setStatusMsg(t('admin.setMaintBackupQueued'));
      bumpHistory();
      setRunning(false);
    }, 800);
  };

  // Detect failure messages defensively — the prefix may be localised to
  // "فشل: …" in AR, so we can't string-match on "Failed" alone. We compare
  // against the localised prefix template to colour the status pill red.
  const failedPrefixSample = t('admin.setMaintBackupFailedPrefix', { msg: '' }).trim();
  const isFailedMsg = !!statusMsg && statusMsg.startsWith(failedPrefixSample.replace(/[: ]+$/, ''));

  return (
    <div className={`${glassCardStyle} p-6 flex flex-col`}>
      <h3 className="text-lg font-bold text-black dark:text-white flex items-center mb-1">
        <i className="ph-bold ph-cloud-arrow-up mr-2 text-[#6A3FF4]"></i> {t('admin.setMaintBackupControls')}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
        {t('admin.setMaintBackupCtrlIntro', { dump: 'pg_dump' })}
      </p>

      {/* Maintenance Mode */}
      <div className="flex items-center justify-between mb-4 p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5">
        <div>
          <div className="text-sm font-medium text-black dark:text-white">{t('admin.setMaintMaintMode')}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{t('admin.setMaintMaintModeHint')}</div>
        </div>
        <button
          onClick={toggleMaintenanceMode}
          aria-pressed={maintenanceMode}
          dir="ltr"
          className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors ${maintenanceMode ? 'bg-orange-500' : 'bg-white/10 dark:bg-black/20'}`}
        >
          <span className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${maintenanceMode ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <button
        onClick={handleBackup}
        disabled={running}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center justify-center gap-2 mb-3 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
      >
        <i className="ph-bold ph-upload-simple"></i>
        {running ? t('admin.setMaintQueuingDots') : t('admin.setMaintRunManualBtn')}
      </button>

      {statusMsg && (
        <p className={`text-xs mb-4 ${isFailedMsg ? 'text-red-400' : 'text-green-400'}`}>
          {statusMsg}
        </p>
      )}

      {/* Frequency selector — replaces the ambiguous "Daily" toggle */}
      <div className="mb-4">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
          {t('admin.setMaintFreqLabel')}
        </label>
        <div className="min-w-[180px]">
          <GlassDropdown
            value={frequency}
            onChange={updateFrequency}
            options={[
              { value: 'off',     label: t('admin.setMaintFreqOff') },
              { value: 'daily',   label: t('admin.setMaintFreqDaily') },
              { value: 'weekly',  label: t('admin.setMaintFreqWeekly') },
              { value: 'monthly', label: t('admin.setMaintFreqMonthly') },
            ]}
            direction="auto"
            className="w-full"
          />
        </div>
        {savingFreq && <p className="text-[11px] text-gray-500 mt-1">{t('admin.setMaintSavingDots')}</p>}
      </div>

      <p className="text-[11px] text-gray-500 mb-4">
        {t('admin.setMaintRestoreHintBefore')} <span className="text-[#7B5AFF] font-bold">{t('admin.setMaintRestore')}</span> {t('admin.setMaintRestoreHintMid')} <span className="text-red-400 font-bold">{t('admin.setMaintRestoreHintDest')}</span> {t('admin.setMaintRestoreHintAfter')}
      </p>

      <p className="text-gray-500 dark:text-gray-400 text-xs mt-auto">
        {t('admin.setMaintLastSuccess', { when: lastBackup ?? t('admin.setMaintNever') })}
      </p>
    </div>
  );
};

const BackupHistoryCard: FC = () => {
  const t = useT();
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  // Restore-confirmation modal state. We keep the chosen target on the
  // module-side here (not in a parent state-lift) because the row only ever
  // hands one backup at a time to the modal.
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  // Track the local mock history so a "Run Manual Backup" can prepend a fresh
  // row. Seeded from MOCK_BACKUPS.
  const store = useRef<BackupRow[]>(MOCK_BACKUPS.map((b) => ({ ...b })));

  const load = () => {
    setLoading(true);
    setRows([...store.current]);
    setLoading(false);
  };

  useEffect(() => {
    // bumpHistory() is called by the "Run Manual Backup" button — prepend a
    // brand-new successful backup row to the local store and re-render.
    bumpHistory = () => {
      const fresh: BackupRow = {
        id: `bk-${Date.now()}`,
        kind: 'manual',
        path: `uniflow-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.dump | full`,
        bytes: 148_600_000,
        status: 'success',
        createdAt: new Date().toISOString(),
        createdBy: 'Hisham Kamal',
      };
      store.current = [fresh, ...store.current];
      setTick((x) => x + 1);
      load();
    };
    load();
    return () => { bumpHistory = () => {}; };
  }, []);

  // Local-only restore — flip the chosen backup to a "restore" success row.
  const handleRestore = () => {
    if (!restoreTarget) return;
    if (confirmText !== 'RESTORE') {
      setRestoreMsg(t('admin.setMaintRestoreTypeRequired'));
      return;
    }
    setRestoring(true);
    setRestoreMsg(null);
    window.setTimeout(() => {
      const restoreRow: BackupRow = {
        id: `rs-${Date.now()}`,
        kind: 'restore',
        path: restoreTarget.path,
        bytes: restoreTarget.bytes,
        status: 'success',
        createdAt: new Date().toISOString(),
        createdBy: 'Hisham Kamal',
      };
      store.current = [restoreRow, ...store.current];
      load();
      setRestoreMsg(t('admin.setMaintRestoreCompleted'));
      setRestoring(false);
      setTimeout(() => {
        setRestoreTarget(null);
        setConfirmText('');
        setRestoreMsg(null);
      }, 3000);
    }, 900);
  };

  // Local-only download — generate a small placeholder file so the button
  // visibly does something without a network call.
  const downloadBackup = (_id: string, filename: string | null) => {
    const name = (filename ?? 'uniflow-backup').split(' | ')[0];
    const blob = new Blob(
      [`UniFlow preview backup placeholder — ${name}\nGenerated: ${new Date().toISOString()}\n`],
      { type: 'application/octet-stream' },
    );
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-lg font-bold text-black dark:text-white flex items-center">
            <i className="ph-bold ph-clock-counter-clockwise mr-2 text-[#6A3FF4]"></i> {t('admin.setMaintHistTitle')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{rows.length === 1 ? t('admin.setMaintHistSubtitleSingle', { n: rows.length }) : t('admin.setMaintHistSubtitlePlural', { n: rows.length })}</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold disabled:opacity-50"
          title={t('admin.setMaintRefresh')}
        >
          {loading ? '…' : t('admin.setMaintRefresh')}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="animate-pulse h-24 bg-white/5 rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <i className="ph-fill ph-database text-4xl text-gray-500 dark:text-gray-600 mb-3"></i>
          <p className="text-black dark:text-white font-medium text-sm mb-1">{t('admin.setMaintNoHistory')}</p>
          <p className="text-gray-500 dark:text-gray-400 text-xs">{t('admin.setMaintNoHistoryHint')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                <th className="text-left py-2 pr-4 font-bold">{t('admin.setMaintColWhen')}</th>
                <th className="text-left py-2 pr-4 font-bold">{t('admin.setMaintColKind')}</th>
                <th className="text-left py-2 pr-4 font-bold">{t('admin.setMaintColStatus')}</th>
                <th className="text-right py-2 pr-4 font-bold">{t('admin.setMaintColSize')}</th>
                <th className="text-left py-2 pr-4 font-bold">{t('admin.setMaintColBy')}</th>
                <th className="text-right py-2 font-bold">{t('admin.setMaintColActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/5 transition-colors">
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap text-xs">
                    {new Date(r.createdAt).toLocaleDateString()}
                    <div className="text-[10px] text-gray-500">{new Date(r.createdAt).toLocaleTimeString()}</div>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white/5 text-gray-400">{r.kind}</span>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        r.status === 'success'  ? 'bg-green-500/15 text-green-400'
                        : r.status === 'failed' ? 'bg-red-500/15 text-red-400'
                        :                          'bg-yellow-500/15 text-yellow-400'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-400">{formatBytes(r.bytes)}</td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">{r.createdBy ?? t('admin.setMaintScheduled')}</td>
                  <td className="py-2 text-right">
                    {r.status === 'success' && r.kind !== 'restore' ? (
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => downloadBackup(r.id, r.path)}
                          className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                        >
                          {t('admin.setMaintDownload')}
                        </button>
                        <button
                          onClick={() => {
                            setRestoreTarget(r);
                            setConfirmText('');
                            setRestoreMsg(null);
                          }}
                          className="text-red-400 hover:text-red-300 text-xs font-bold"
                          title={t('admin.setMaintRestoreTitle')}
                        >
                          {t('admin.setMaintRestore')}
                        </button>
                      </div>
                    ) : r.status === 'success' && r.kind === 'restore' ? (
                      <span className="text-green-400 text-xs">{t('admin.setMaintLoaded')}</span>
                    ) : r.status === 'failed' ? (
                      <span className="text-red-400 text-xs" title={r.path ?? ''}>{t('admin.setMaintFailed')}</span>
                    ) : (
                      <span className="text-gray-500 text-xs">{t('admin.setMaintDash')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Phase 12 — Restore confirmation modal. Typed "RESTORE" required. */}
      {restoreTarget && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !restoring && setRestoreTarget(null)}
        >
          <div className={`${glassCardStyle} p-6 w-full max-w-lg`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <i className="ph-fill ph-warning text-xl text-red-400" />
              </div>
              <div>
                <h3 className="text-black dark:text-white font-bold text-lg">{t('admin.setMaintRestoreModalTitle')}</h3>
                <p className="text-gray-500 text-xs">
                  {restoreTarget.path?.split(' | ')[0] ?? restoreTarget.id} · {formatBytes(restoreTarget.bytes)} · {new Date(restoreTarget.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-sm text-red-200 leading-relaxed">
              <p className="font-bold text-red-300 mb-2">{t('admin.setMaintRestoreModalDangerHead')}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t('admin.setMaintRestoreModalPt1')}</li>
                <li>{t('admin.setMaintRestoreModalPt2')}</li>
                <li>{t('admin.setMaintRestoreModalPt3')}</li>
                <li>{t('admin.setMaintRestoreModalPt4')}</li>
              </ul>
            </div>

            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              {t('admin.setMaintRestoreTypeLbl')} <span className="text-red-400 font-mono normal-case">RESTORE</span> {t('admin.setMaintRestoreTypeAfter')}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESTORE"
              autoFocus
              spellCheck={false}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white font-mono focus:outline-none focus:border-red-500 backdrop-filter backdrop-blur-xl"
            />

            {restoreMsg && (() => {
              // Detect the localised failure prefix so the pill colour is
              // honest in both EN+AR. Same approach as the BackupControls
              // status pill above.
              const failedSample = t('admin.setMaintRestoreFailedFmt', { status: '', msg: '' }).replace(/[^A-Za-z؀-ۿ]+$/, '');
              const isErr = !!restoreMsg && (restoreMsg.startsWith(failedSample.slice(0, 6)) || restoreMsg.toLowerCase().includes('http'));
              return (
                <div
                  className={`mt-3 p-3 rounded-xl text-xs whitespace-pre-line ${
                    isErr
                      ? 'bg-red-500/15 border border-red-500/30 text-red-300'
                      : 'bg-green-500/15 border border-green-500/30 text-green-300'
                  }`}
                >
                  {restoreMsg}
                </div>
              );
            })()}

            <div className="flex gap-3 mt-5">
              <button
                onClick={handleRestore}
                disabled={restoring || confirmText !== 'RESTORE'}
                className="flex-1 bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {restoring ? t('admin.setMaintBtnRestoring') : t('admin.setMaintBtnRestoreDb')}
              </button>
              <button
                onClick={() => setRestoreTarget(null)}
                disabled={restoring}
                className="flex-1 bg-white/10 dark:bg-white/5 text-black dark:text-white font-bold py-2.5 rounded-xl text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                {t('admin.setMaintBtnCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Brand Tab (Plan 8 Phase 1) ──────────────────── */
//
// Live editor for the admin-tunable wordmark + 3-color palette.
//   - Product name (free text, ≤ 60 chars)
//   - Optional per-segment color split (e.g. "Alex" + "Uni" with different
//     colors). Segments concatenated must equal the product name to render;
//     a quick-split button regenerates default 2-segment colors on demand.
//   - Brand primary / secondary / accent (hex color pickers).
// Save POSTs to /api/admin/system-settings with `brandConfig`; the
// BrandContext refreshes on success so the sidebar wordmark + every
// `bg-brand-primary` surface picks up the new value live.

type BrandTheme = {
  brandPrimary: string;
  brandSecondary: string;
  brandAccent: string;
  // Page background per theme — drives `--canvas-bg`. Falls back to the
  // theme's canonical default if missing (legacy rows saved before this
  // field existed).
  canvasBg: string;
  // Atmosphere blobs / aurora stops. Length differs per theme:
  //   dark  → 3 entries  (Aurora WebGL color stops)
  //   light → 4 entries  (radial-gradient blob colors)
  backgroundColors: string[];
  logoSegments: { text: string; color: string }[] | null;
};
type Mode = 'light' | 'dark';
const LIGHT_DEFAULTS_LOCAL: BrandTheme = {
  brandPrimary: '#6A3FF4', brandSecondary: '#A855F7', brandAccent: '#5A2AD4',
  canvasBg: '#FFFFFF',
  backgroundColors: ['#A78BFA', '#F472B6', '#7DD3FC', '#C4B5FD'],
  logoSegments: null,
};
const DARK_DEFAULTS_LOCAL: BrandTheme = {
  brandPrimary: '#6A3FF4', brandSecondary: '#A855F7', brandAccent: '#7B5AFF',
  canvasBg: '#0D0D0D',
  backgroundColors: ['#5A2AD4', '#7B5AFF', '#5A2AD4'],
  logoSegments: null,
};
const BrandTab: FC = () => {
  const t = useT();
  const brand = useBrand();
  const [productName, setProductName] = useState(brand.productName);
  const [light, setLight] = useState<BrandTheme>(brand.light);
  const [dark, setDark] = useState<BrandTheme>(brand.dark);
  const [mode, setMode] = useState<Mode>('dark');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  // Keep the draft in sync if BrandContext changes underneath us (e.g.
  // initial fetch completing after the tab mounted).
  useEffect(() => { setProductName(brand.productName); }, [brand.productName]);
  useEffect(() => { setLight(brand.light); }, [brand.light]);
  useEffect(() => { setDark(brand.dark); }, [brand.dark]);

  const draft = mode === 'light' ? light : dark;
  const setDraft = mode === 'light' ? setLight : setDark;

  const isHex = (v: string) => /^#[0-9A-Fa-f]{3,8}$/.test(v.trim());
  const validColors = (t: BrandTheme) =>
    isHex(t.brandPrimary) && isHex(t.brandSecondary) && isHex(t.brandAccent) && isHex(t.canvasBg)
    && Array.isArray(t.backgroundColors) && t.backgroundColors.every(isHex);

  // Per-atmosphere-slot setter for the active theme — keeps the array length
  // matched to the theme's expected slot count so a draft can't accidentally
  // shrink below what the renderer expects.
  const setBackgroundColor = (idx: number, value: string) => {
    const next = [...draft.backgroundColors];
    next[idx] = value;
    setDraft({ ...draft, backgroundColors: next });
  };
  const allValid = validColors(light) && validColors(dark);
  const segmentsValid = (t: BrandTheme) =>
    !t.logoSegments || t.logoSegments.map((s) => s.text).join('') === productName;

  // Local-only save — flash the "Saved" message. No backend / no brand
  // re-fetch; the draft state already reflects the edits in the preview.
  const save = () => {
    setSaving(true);
    setSavedMsg('');
    window.setTimeout(() => {
      setSavedMsg(t('admin.setBrandSavedFlash'));
      setTimeout(() => setSavedMsg(''), 2200);
      setSaving(false);
    }, 300);
  };

  const resetToDefaults = () => {
    setProductName('UniFlow');
    setLight(LIGHT_DEFAULTS_LOCAL);
    setDark(DARK_DEFAULTS_LOCAL);
  };

  const copyFromOther = () => {
    if (mode === 'light') setLight(dark);
    else setDark(light);
  };

  const splitHalves = () => {
    const name = productName || 'UniFlow';
    const half = Math.ceil(name.length / 2);
    // Default "Flow"-half color is theme-aware: white on dark, the dark
    // canvas color on light (so it's actually visible).
    const tailColor = mode === 'dark' ? '#FFFFFF' : '#1A1530';
    setDraft({
      ...draft,
      logoSegments: [
        { text: name.slice(0, half), color: draft.brandPrimary },
        { text: name.slice(half), color: tailColor },
      ],
    });
  };

  const updateSegment = (idx: number, patch: { text?: string; color?: string }) => {
    if (!draft.logoSegments) return;
    const next = draft.logoSegments.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDraft({ ...draft, logoSegments: next });
  };
  const addSegment = () => {
    if ((draft.logoSegments?.length ?? 0) >= 6) return;
    const segs = draft.logoSegments ?? [];
    setDraft({ ...draft, logoSegments: [...segs, { text: '', color: draft.brandPrimary }] });
  };
  const removeSegment = (idx: number) => {
    if (!draft.logoSegments) return;
    const next = draft.logoSegments.filter((_, i) => i !== idx);
    setDraft({ ...draft, logoSegments: next.length > 0 ? next : null });
  };

  // Preview backdrop uses the LIVE draft canvas color so editing the
  // Background picker re-skins the preview in real time. Inline style
  // (not a Tailwind class) because the value is a free-form hex.
  const previewBgStyle = { backgroundColor: isHex(draft.canvasBg) ? draft.canvasBg : (mode === 'dark' ? '#0D0D0D' : '#FFFFFF') };
  const previewTextClass = mode === 'dark' ? 'text-white' : 'text-black';

  // Localised atmosphere labels — render-time replacement of the static
  // ATMOSPHERE_LABELS so admins see Arabic / English labels per slot.
  const ATM_KEYS_LIGHT: { labelKey: string; hintKey: string }[] = [
    { labelKey: 'admin.setBrandAtmTopLeft',     hintKey: 'admin.setBrandAtmTopLeftHint' },
    { labelKey: 'admin.setBrandAtmTopRight',    hintKey: 'admin.setBrandAtmTopRightHint' },
    { labelKey: 'admin.setBrandAtmBottomLeft',  hintKey: 'admin.setBrandAtmBottomLeftHint' },
    { labelKey: 'admin.setBrandAtmBottomRight', hintKey: 'admin.setBrandAtmBottomRightHint' },
  ];
  const ATM_KEYS_DARK: { labelKey: string; hintKey: string }[] = [
    { labelKey: 'admin.setBrandAtmAuroraStart', hintKey: 'admin.setBrandAtmAuroraStartHint' },
    { labelKey: 'admin.setBrandAtmAuroraMid',   hintKey: 'admin.setBrandAtmAuroraMidHint' },
    { labelKey: 'admin.setBrandAtmAuroraEnd',   hintKey: 'admin.setBrandAtmAuroraEndHint' },
  ];
  const atmKeysActive = mode === 'light' ? ATM_KEYS_LIGHT : ATM_KEYS_DARK;

  return (
    <div className={`${glassCardStyle} p-6 space-y-6`}>
      <div>
        <h2 className="text-xl font-bold text-black dark:text-white">{t('admin.setBrandTitle')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('admin.setBrandSubtitle')}
        </p>
      </div>

      {/* Product name (shared between themes — there's only one app name). */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t('admin.setBrandProductName')}</label>
        <input
          type="text"
          value={productName}
          onChange={(e) => {
            setProductName(e.target.value.slice(0, 60));
            // Editing the name invalidates any saved segments — clear them
            // on both themes so the half-split renders cleanly.
            setLight((p) => ({ ...p, logoSegments: null }));
            setDark((p) => ({ ...p, logoSegments: null }));
          }}
          className={inputStyle}
          maxLength={60}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('admin.setBrandProductNameHint')}
        </p>
      </div>

      {/* Light / Dark mode switcher — pills bar, matches the rest of the
          admin Settings pattern. */}
      {/* Mode switcher + copy-from-other.
          Stacked column on mobile, row on sm+ so neither button overflows
          the card on narrow phones. The mode-switcher pill becomes
          full-width on mobile (`flex-1` per child + `w-full` on the
          wrapper) so the Light/Dark buttons split the row evenly. */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-between gap-3">
        <div className="flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg w-full sm:w-auto">
          {(['light', 'dark'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 sm:flex-none text-sm font-bold py-2 px-4 rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                mode === m
                  ? 'bg-[#6A3FF4] text-white'
                  : 'text-black dark:text-gray-300 hover:text-black dark:hover:text-white'
              }`}
            >
              <i className={`ph-fill ${m === 'light' ? 'ph-sun' : 'ph-moon-stars'}`} />
              {m === 'light' ? t('admin.setBrandLightTheme') : t('admin.setBrandDarkTheme')}
            </button>
          ))}
        </div>
        <button
          onClick={copyFromOther}
          className="text-xs px-3 py-2 sm:py-1.5 rounded-lg bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white hover:bg-white/10 whitespace-nowrap"
          title={mode === 'light' ? t('admin.setBrandCopyFromDarkTitle') : t('admin.setBrandCopyFromLightTitle')}
        >
          {mode === 'light' ? t('admin.setBrandCopyFromDark') : t('admin.setBrandCopyFromLight')}
        </button>
      </div>

      {/* Brand colors for the active theme — back to 3 columns now that
          the Canvas color moved down into the Background Atmosphere group. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {([
          [t('admin.setBrandPrimaryLbl'),   'brandPrimary',   t('admin.setBrandPrimaryHint')],
          [t('admin.setBrandSecondaryLbl'), 'brandSecondary', t('admin.setBrandSecondaryHint')],
          [t('admin.setBrandAccentLbl'),    'brandAccent',    t('admin.setBrandAccentHint')],
        ] as const).map(([label, key, hint]) => {
          const v = draft[key as keyof BrandTheme] as string;
          const ok = isHex(v);
          return (
            <div key={key}>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={ok ? v : '#000000'}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={v}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={`${inputStyle} flex-1`}
                />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</p>
              {!ok && <p className="text-[11px] text-red-500 mt-1">{t('admin.setBrandHexErr')}</p>}
            </div>
          );
        })}
      </div>

      {/* Wordmark segments — per active theme. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">
            {t('admin.setBrandWordmarkLbl', { theme: mode === 'light' ? t('admin.setBrandLightTheme') : t('admin.setBrandDarkTheme') })}
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={splitHalves}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white hover:bg-white/10"
            >
              {t('admin.setBrandAutoSplit')}
            </button>
            {draft.logoSegments && (
              <button
                onClick={() => setDraft({ ...draft, logoSegments: null })}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white hover:bg-white/10"
              >
                {t('admin.setBrandClearSegments')}
              </button>
            )}
          </div>
        </div>
        {draft.logoSegments ? (
          <div className="space-y-2">
            {draft.logoSegments.map((seg, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={seg.text}
                  onChange={(e) => updateSegment(i, { text: e.target.value })}
                  className={`${inputStyle} flex-1`}
                  placeholder={t('admin.setBrandSegmentPh', { n: i + 1 })}
                />
                <input
                  type="color"
                  value={isHex(seg.color) ? seg.color : '#000000'}
                  onChange={(e) => updateSegment(i, { color: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer"
                />
                <button
                  onClick={() => removeSegment(i)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                >
                  ×
                </button>
              </div>
            ))}
            {draft.logoSegments.length < 6 && (
              <button
                onClick={addSegment}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white hover:bg-white/10"
              >
                {t('admin.setBrandAddSegment')}
              </button>
            )}
            {!segmentsValid(draft) && (
              <p className="text-[11px] text-amber-400">
                {t('admin.setBrandSegmentMismatch', { name: productName })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.setBrandSegmentsEmpty')}
          </p>
        )}
      </div>

      {/* Background Atmosphere — per-theme color stops for the layered
          backdrop. Dark theme = 3 Aurora WebGL stops (start/middle/end);
          light theme = 4 radial-gradient blob colors (one per corner).
          Slot count is theme-dependent and read from ATMOSPHERE_LABELS so
          adding a new slot later is a metadata-only change. */}
      {/* Background Atmosphere — the page canvas color sits FIRST, then the
          per-theme atmosphere slots. Total slots per theme:
            light → 1 canvas + 4 blobs = 5
            dark  → 1 canvas + 3 aurora stops = 4
          The grid stretches up to 5 columns at `lg` so the light theme's
          full row fits without wrapping; smaller breakpoints scale down to
          2/1 columns. Each slot uses a tighter `flex-col` layout (color
          picker on its own row above the hex input) so the cards stay
          narrow enough to fit 5-across cleanly. */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
          {t('admin.setBrandAtmosphereLbl', { mode: mode === 'light' ? t('admin.setBrandAtmosphereLight') : t('admin.setBrandAtmosphereDark') })}
        </label>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
          {mode === 'light'
            ? t('admin.setBrandAtmosphereLightHint')
            : t('admin.setBrandAtmosphereDarkHint')}
        </p>
        <div className={`grid grid-cols-2 ${mode === 'light' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
          {/* Slot 0 — canvas color. Same picker layout as the atmosphere
              slots so the row reads as one group. */}
          {(() => {
            const v = draft.canvasBg;
            const ok = isHex(v);
            return (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">{t('admin.setBrandCanvasLbl')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={ok ? v : '#000000'}
                    onChange={(e) => setDraft({ ...draft, canvasBg: e.target.value })}
                    className="w-9 h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer flex-shrink-0"
                  />
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => setDraft({ ...draft, canvasBg: e.target.value })}
                    className={`${inputStyle} flex-1 min-w-0`}
                  />
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  {t('admin.setBrandCanvasHint')}
                </p>
                {!ok && <p className="text-[11px] text-red-500 mt-1">{t('admin.setBrandCanvasHexErr')}</p>}
              </div>
            );
          })()}
          {atmKeysActive.map(({ labelKey, hintKey }, idx) => {
            const v = draft.backgroundColors[idx] ?? (mode === 'light' ? LIGHT_DEFAULTS_LOCAL : DARK_DEFAULTS_LOCAL).backgroundColors[idx];
            const ok = isHex(v);
            return (
              <div key={`${mode}-bg-${idx}`}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">{t(labelKey)}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={ok ? v : '#000000'}
                    onChange={(e) => setBackgroundColor(idx, e.target.value)}
                    className="w-9 h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer flex-shrink-0"
                  />
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => setBackgroundColor(idx, e.target.value)}
                    className={`${inputStyle} flex-1 min-w-0`}
                  />
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{t(hintKey)}</p>
                {!ok && <p className="text-[11px] text-red-500 mt-1">{t('admin.setBrandHexErr')}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview — backdrop matches the theme being edited so the
          wordmark visibility is honest (a white "Flow" on white = bad). */}
      <div className="rounded-xl border border-white/10 p-6" style={previewBgStyle}>
        <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${mode === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('admin.setBrandPreviewLbl', { mode: mode === 'light' ? t('admin.setBrandPreviewLight') : t('admin.setBrandPreviewDark') })}
        </p>
        <div className="flex flex-col gap-4 items-start">
          <div className={`text-3xl font-bold tracking-tight ${previewTextClass}`}>
            <Logo
              key={`${productName}|${mode}|${draft.brandPrimary}|${(draft.logoSegments ?? []).map(s => `${s.text}:${s.color}`).join(',')}`}
              overrideName={productName}
              overrideSegments={draft.logoSegments}
              overridePrimary={draft.brandPrimary}
              overrideAccent={draft.brandAccent}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              style={{ backgroundColor: isHex(draft.brandPrimary) ? draft.brandPrimary : '#6A3FF4' }}
              className="px-4 py-2 rounded-lg text-white text-sm font-bold shadow"
            >
              {t('admin.setBrandPreviewPrimary')}
            </button>
            <button
              type="button"
              style={{ backgroundColor: isHex(draft.brandAccent) ? draft.brandAccent : '#7B5AFF' }}
              className="px-4 py-2 rounded-lg text-white text-sm font-bold shadow"
            >
              {t('admin.setBrandPreviewAccent')}
            </button>
            <div
              className="px-6 py-2 rounded-lg text-white text-sm font-bold shadow"
              style={{
                background: `linear-gradient(90deg, ${isHex(draft.brandPrimary) ? draft.brandPrimary : '#6A3FF4'} 0%, ${isHex(draft.brandSecondary) ? draft.brandSecondary : '#A855F7'} 100%)`,
              }}
            >
              {t('admin.setBrandPreviewGradient')}
            </div>
          </div>
        </div>
      </div>

      {/* Save / Reset row — stack vertically on mobile so the long
          "Reset both themes to UniFlow defaults" text doesn't push the
          Save button out of the card. Save sits below on mobile, inline
          right on sm+. */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-between gap-3 pt-3 border-t border-white/10">
        <button onClick={resetToDefaults} className="text-xs text-gray-500 hover:text-[#6A3FF4] text-center sm:text-left">
          {t('admin.setBrandResetBoth')}
        </button>
        <div className="flex items-center justify-end gap-3">
          {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
          <button
            onClick={save}
            disabled={saving || !allValid}
            className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
          >
            {saving ? t('admin.setBrandSaving') : t('admin.setBrandSaveBtn')}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Settings Page ──────────────────────────── */

type Props = { onLogout?: () => void };

const AdminSettingsPage: FC<Props> = () => {
  const t = useT();
  // Plan 8 Phase 1 — added "Brand" tab between General and Roles & Permissions.
  const tabs = ['General', 'Brand', 'Roles & Permissions', 'Maintenance'];
  const [active, setActive] = useState('General');

  const tabLabel = (tab: string) => {
    switch (tab) {
      case 'General': return t('admin.tabGeneral');
      case 'Brand': return t('admin.tabBrand');
      case 'Roles & Permissions': return t('admin.tabRoles');
      case 'Maintenance': return t('admin.tabMaintenance');
      default: return tab;
    }
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView>
        <div className="mb-6">
          <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.settingsTitle')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.settingsSubtitle')}</p>
        </div>

        <div className="flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 w-full sm:w-fit overflow-x-auto shadow-lg">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActive(tab)}
              className={`text-sm font-bold py-2 px-4 rounded-md transition-colors whitespace-nowrap ${active === tab ? 'bg-[#6A3FF4] text-white' : 'text-black dark:text-gray-300 hover:text-black dark:hover:text-white'}`}
            >{tabLabel(tab)}</button>
          ))}
        </div>
      </AnimateOnView>

      <div className="space-y-6">
        {active === 'General' && (
          <SettingsProvider>
            <AnimateOnView delay={0.1}>
              <SettingsForm />
            </AnimateOnView>
          </SettingsProvider>
        )}

        {active === 'Brand' && (
          <AnimateOnView delay={0.1}>
            <BrandTab />
          </AnimateOnView>
        )}

        {active === 'Roles & Permissions' && (
          <AnimateOnView delay={0.1}>
            <RolesPermissionsTab />
          </AnimateOnView>
        )}

        {active === 'Maintenance' && (
          <AnimateOnView delay={0.1}>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-black dark:text-white">{t('admin.setMaintTitle')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.setMaintSubtitle')}</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BackupControlsCard />
              <BackupHistoryCard />
            </div>
          </AnimateOnView>
        )}
      </div>
    </div>
  );
};

export default AdminSettingsPage;
