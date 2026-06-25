// src/pages/admin/academic/RegistrationWindows.tsx
//
// Plan 4 Phase 3 — admin-tunable registration / add-drop / withdrawal windows
// (FCDS Articles 13, 14, 15). 3 × 2 grid: 3 windows × main + summer term.
// Each cell takes startWeek + endWeek inputs. A live preview block at the
// bottom resolves the configured weeks against the active RegistrationPeriod
// startDate so the admin sees concrete dates instead of abstract week numbers.
import { FC, useMemo, useState } from 'react';
import {
  WindowsPolicy,
  DEFAULT_WINDOWS_POLICY,
  useWindowsPolicy,
  resolveWindow,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig, InstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle } from './_shared';
import { useT } from '../../../i18n';

interface RegistrationPeriodLite {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  semester?: string | null;
  type?: string | null;
}

// MVP build — mock active registration period so the preview block resolves
// concrete dates without a backend call.
const MOCK_ACTIVE_PERIOD: RegistrationPeriodLite = {
  id: 'mock-period-1',
  name: 'Spring 2026',
  startDate: '2026-02-08',
  endDate: '2026-05-28',
  semester: 'Spring',
  type: 'main',
};

// Plan 6 Phase 1 — description is a function of the institution config so the
// "Article N" prefix appears only when an admin opts in via Settings →
// Institution → "Show Article Numbers". The body text is identical either way.
const WINDOW_KINDS: Array<{
  key: keyof WindowsPolicy;
  label: string;
  description: (inst: InstitutionConfig) => string;
  tone: string;
}> = [
  {
    key: 'lateRegistration',
    label: 'Late Registration',
    description: (inst) =>
      articleHint(
        inst,
        '13b',
        'students who missed the regular registration window can still enroll, but the row is sent to SA for approval.',
      ),
    tone: 'text-amber-300 border-amber-500/30 bg-amber-500/5',
  },
  {
    key: 'addDrop',
    label: 'Add / Drop',
    description: (inst) =>
      articleHint(inst, 14, 'students can add and drop courses freely. Dropped courses leave no transcript record.'),
    tone: 'text-blue-300 border-blue-500/30 bg-blue-500/5',
  },
  {
    key: 'withdrawal',
    label: 'Withdrawal',
    description: (inst) =>
      articleHint(inst, 15, 'voluntary withdrawal (W grade). Course credits not counted; no quality-point contribution.'),
    tone: 'text-purple-300 border-purple-500/30 bg-purple-500/5',
  },
];

// Exported so the merged Admin → Registration Control page can embed
// this card alongside Status / Semester Cycle / Periods. The standalone
// Academic Settings → Registration Windows route was removed in favour
// of the merged surface; the card is the only thing that survived.
export const RegistrationWindowsCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const initialPolicy = useWindowsPolicy();
  const [policy, setPolicy] = useState<WindowsPolicy>(initialPolicy);
  const [activePeriod] = useState<RegistrationPeriodLite | null>(MOCK_ACTIVE_PERIOD);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Cross-window validation mirroring the backend Zod refinement.
  const validationError = useMemo(() => {
    for (const term of ['main', 'summer'] as const) {
      for (const kind of WINDOW_KINDS) {
        const r = policy[kind.key][term];
        if (!Number.isInteger(r.startWeek) || r.startWeek < 1 || r.startWeek > 20) {
          return `${kind.label} (${term}): startWeek must be 1–20.`;
        }
        if (!Number.isInteger(r.endWeek) || r.endWeek < 1 || r.endWeek > 20) {
          return `${kind.label} (${term}): endWeek must be 1–20.`;
        }
        if (r.endWeek < r.startWeek) {
          return `${kind.label} (${term}): endWeek (${r.endWeek}) must be ≥ startWeek (${r.startWeek}).`;
        }
      }
      if (policy.addDrop[term].endWeek > policy.withdrawal[term].startWeek) {
        return `${term}: withdrawal must start AFTER add-drop ends (add-drop ends week ${policy.addDrop[term].endWeek}, withdrawal starts week ${policy.withdrawal[term].startWeek}).`;
      }
    }
    return null;
  }, [policy]);

  const update = (kind: keyof WindowsPolicy, term: 'main' | 'summer', field: 'startWeek' | 'endWeek', value: number) => {
    setPolicy((prev) => ({
      ...prev,
      [kind]: {
        ...prev[kind],
        [term]: { ...prev[kind][term], [field]: value },
      },
    }));
  };

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    // MVP build — local-only save, no network.
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
    setSaving(false);
  };

  const handleReset = () => setPolicy(DEFAULT_WINDOWS_POLICY);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  // Format Date → "Mar 12 2026" for the preview block.
  const fmt = (d: Date | undefined) =>
    d ? d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-clock-clockwise text-[#6A3FF4]"></i> {t('admin.regWindowsCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Week-numbered windows for late registration, add-drop, and withdrawal. Resolved against the active registration period's start date — change the weeks to instantly shift every active window.
        </p>
      </div>

      {/* 3 windows × 2 terms grid */}
      <div className="space-y-5 mb-5">
        {WINDOW_KINDS.map((kind) => (
          <div key={kind.key} className={`rounded-xl border px-4 py-4 ${kind.tone}`}>
            <div className="mb-3">
              <h4 className="text-sm font-bold text-black dark:text-white">{kind.label}</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{kind.description(institution)}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['main', 'summer'] as const).map((term) => (
                <div key={term} className="bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                    {term === 'main' ? 'Fall / Spring' : 'Summer'}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelStyle}>{t('admin.startWeek')}</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={policy[kind.key][term].startWeek}
                        onChange={(e) => update(kind.key, term, 'startWeek', parseInt(e.target.value, 10) || 0)}
                        onFocus={(e) => e.currentTarget.select()}
                        className={inputStyle}
                      />
                    </div>
                    <div>
                      <label className={labelStyle}>{t('admin.endWeek')}</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={policy[kind.key][term].endWeek}
                        onChange={(e) => update(kind.key, term, 'endWeek', parseInt(e.target.value, 10) || 0)}
                        onFocus={(e) => e.currentTarget.select()}
                        className={inputStyle}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Live preview — concrete dates resolved against the active period */}
      <div className="rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-4 py-3 mb-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#7B5AFF] mb-2 flex items-center gap-2">
          <i className="ph-bold ph-eye"></i> {t('admin.preview')}
        </h4>
        {activePeriod ? (
          <div className="space-y-1.5 text-xs text-gray-700 dark:text-gray-300">
            <p className="font-medium">
              Active period: <span className="text-black dark:text-white">{activePeriod.name}</span>{' '}
              (starts {fmt(new Date(activePeriod.startDate))})
            </p>
            {WINDOW_KINDS.map((kind) => {
              const window = resolveWindow(activePeriod, policy, kind.key);
              if (!window) return null;
              return (
                <p key={kind.key}>
                  <span className="font-semibold">{kind.label}:</span>{' '}
                  {fmt(window.start)} → {fmt(window.end)}
                </p>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('admin.apNoActivePeriodHint')} <em>{t('admin.apRegistrationControlItalic')}</em>{t('admin.apNoActivePeriodHintEnd')}
          </p>
        )}
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.windowsSaved')}</p>
      )}

      <div className="flex justify-between items-center pt-3 border-t border-white/10">
        <button
          onClick={handleReset}
          className="text-xs text-gray-500 hover:text-[#6A3FF4] transition-colors"
        >
          {resetLabel(institution)}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !!validationError}
          className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 text-sm font-bold rounded-lg transition-colors"
        >
          {saving ? t('admin.saving') : t('admin.saveWindows')}
        </button>
      </div>
    </div>
  );
};

// Standalone page wrapper retired — the same `RegistrationWindowsCard`
// editor is now embedded directly inside Registration Control. The named
// `RegistrationWindowsCard` export above is still consumed there; only
// the duplicate `RegistrationWindowsPage` default wrapper was removed.
//
// Old `/admin/academic/registration-windows` bookmarks redirect to
// `/admin/registration-control` via App.tsx routes.
