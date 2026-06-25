// src/pages/admin/academic/CreditHourDefinition.tsx
//
// Plan 4 Phase 9 — admin-tunable credit-hour definition (FCDS Article 6).
// 4 fields: how many weekly contact-hours equal one credit, broken down by
// the four FCDS course types (lecture / practical / applied / field).
// Defaults match Article 6 verbatim. Stored as JSON on SystemSettings.
//
// Currently informational — no other code path enforces these ratios yet.
// Surfacing them in a single source of truth so future capacity/load
// calculations can read them instead of hardcoding.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  setAcademicSettings,
  CreditHourDefinition,
  DEFAULT_CREDIT_HOUR_DEFINITION,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const CreditHourDefinitionCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [definition, setDefinition] = useState<CreditHourDefinition>(DEFAULT_CREDIT_HOUR_DEFINITION);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const validationError = useMemo(() => {
    const fields: Array<keyof CreditHourDefinition> = [
      'lectureHoursPerCredit',
      'practicalHoursPerCredit',
      'appliedTrainingHoursPerCredit',
      'fieldTrainingHoursPerCredit',
    ];
    for (const f of fields) {
      const v = definition[f];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.25 || v > 20) {
        return `${f} must be between 0.25 and 20.`;
      }
    }
    return null;
  }, [definition]);

  const update = (k: keyof CreditHourDefinition, v: number) =>
    setDefinition((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (validationError) return;
    setAcademicSettings({ creditHourDefinition: definition });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setDefinition(DEFAULT_CREDIT_HOUR_DEFINITION);

  if (loading) {
    return (
      <div className={`${glassCardStyle} p-6 animate-pulse`}>
        <div className="h-5 w-1/2 bg-white/10 rounded mb-4"></div>
        <div className="h-32 bg-white/10 rounded"></div>
      </div>
    );
  }

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-clock-counter-clockwise text-[#6A3FF4]"></i> {t('admin.creditHourCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 6, 'How many weekly contact-hours equal one credit, broken down by course type.')}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span> One credit hour ={' '}
        <span className="font-semibold">{definition.lectureHoursPerCredit}</span> lecture h ·{' '}
        <span className="font-semibold">{definition.practicalHoursPerCredit}</span> practical h ·{' '}
        <span className="font-semibold">{definition.appliedTrainingHoursPerCredit}</span> applied-training h ·{' '}
        <span className="font-semibold">{definition.fieldTrainingHoursPerCredit}</span> field-training h.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.creditHourLecture')}</label>
          <input
            type="number"
            step="0.25"
            min={0.25}
            max={20}
            value={definition.lectureHoursPerCredit}
            onChange={(e) => update('lectureHoursPerCredit', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditHourPractical')}</label>
          <input
            type="number"
            step="0.25"
            min={0.25}
            max={20}
            value={definition.practicalHoursPerCredit}
            onChange={(e) => update('practicalHoursPerCredit', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditHourAppliedTraining')}</label>
          <input
            type="number"
            step="0.25"
            min={0.25}
            max={20}
            value={definition.appliedTrainingHoursPerCredit}
            onChange={(e) => update('appliedTrainingHoursPerCredit', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditHourFieldTraining')}</label>
          <input
            type="number"
            step="0.25"
            min={0.25}
            max={20}
            value={definition.fieldTrainingHoursPerCredit}
            onChange={(e) => update('fieldTrainingHoursPerCredit', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <i className="ph-bold ph-info text-blue-300 mr-1.5"></i>
        {t('admin.creditHourInformational')}
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.definitionSaved')}</p>
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
          {saving ? t('admin.saving') : t('admin.saveDefinition')}
        </button>
      </div>
    </div>
  );
};

const CreditHourDefinitionPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.creditHourCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {articleHint(institution, 6, t('admin.creditHourSubtitle'))}
        </p>
      </motion.div>
      <CreditHourDefinitionCard />
    </div>
  );
};

export default CreditHourDefinitionPage;
