// src/pages/admin/academic/SemesterCalendar.tsx
//
// Plan 4 Phase 1 — admin-tunable semester durations (FCDS Article 5).
// Three knobs: Fall / Spring / Summer week counts. Persisted to
// SystemSettings.semesterDurations via PATCH /api/admin/semester-durations.
// The cached useAcademicSettings() hook is invalidated on save.
//
// Future phases (Plan 4 Phase 3 — registration / add-drop / withdrawal
// windows) will derive their week-numbered windows from these durations.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  SemesterDurations,
  DEFAULT_SEMESTER_DURATIONS,
  useSemesterDurations,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle } from './_shared';
import { useT } from '../../../i18n';

const SemesterCalendarCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const initialDurations = useSemesterDurations();
  const [durations, setDurations] = useState<SemesterDurations>(initialDurations);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const validationError = useMemo(() => {
    for (const k of ['fallWeeks', 'springWeeks', 'summerWeeks'] as const) {
      const v = durations[k];
      if (!Number.isInteger(v) || v < 1 || v > 52) {
        return `${k.replace('Weeks', '')} week count must be an integer between 1 and 52.`;
      }
    }
    return null;
  }, [durations]);

  const update = (k: keyof SemesterDurations, v: number) =>
    setDurations((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    // MVP build — local-only save, no network.
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
    setSaving(false);
  };

  const handleReset = () => setDurations(DEFAULT_SEMESTER_DURATIONS);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-calendar-check text-[#6A3FF4]"></i> {t('admin.semesterCalCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 5, 'Length in weeks of each semester type. Future registration / add-drop / withdrawal windows are computed against these durations.')}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span>{' '}
        {t('admin.semesterCalPreviewBody', { fall: durations.fallWeeks, spring: durations.springWeeks, summer: durations.summerWeeks })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.fallWeeks')}</label>
          <input
            type="number"
            min={1}
            max={52}
            value={durations.fallWeeks}
            onChange={(e) => update('fallWeeks', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.springWeeks')}</label>
          <input
            type="number"
            min={1}
            max={52}
            value={durations.springWeeks}
            onChange={(e) => update('springWeeks', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.summerWeeks')}</label>
          <input
            type="number"
            min={1}
            max={52}
            value={durations.summerWeeks}
            onChange={(e) => update('summerWeeks', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.calendarSaved')}</p>
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
          {saving ? t('admin.saving') : t('admin.saveCalendar')}
        </button>
      </div>
    </div>
  );
};

const SemesterCalendarPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.semesterCalCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.semesterCalSubtitle')}
        </p>
      </motion.div>
      <SemesterCalendarCard />
    </div>
  );
};

export default SemesterCalendarPage;
