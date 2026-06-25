// src/pages/admin/academic/GraduationPolicy.tsx
//
// Plan 4 Phase 1 — admin-tunable graduation requirements (FCDS Article 8).
// Three knobs: minimum credit hours, minimum main semesters, minimum CGPA.
// Persists to SystemSettings.graduationPolicy via PATCH
// /api/admin/graduation-policy; the cached useAcademicSettings() hook is
// invalidated on save so any open student transcript picks up the new
// "Eligible to graduate" decision without a page reload.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  setAcademicSettings,
  GraduationPolicy,
  DEFAULT_GRADUATION_POLICY,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const GraduationPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [policy, setPolicy] = useState<GraduationPolicy>(DEFAULT_GRADUATION_POLICY);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Sanity checks the backend Zod also enforces — surfacing them here saves a
  // round-trip and lets the admin see the issue before clicking Save.
  const validationError = useMemo(() => {
    if (!Number.isInteger(policy.minTotalCredits) || policy.minTotalCredits < 30) {
      return t('admin.graduationMinCreditsValidation');
    }
    if (!Number.isInteger(policy.minMainSemesters) || policy.minMainSemesters < 1) {
      return 'Minimum main semesters must be at least 1.';
    }
    if (!(policy.minCgpa >= 0 && policy.minCgpa <= 5)) {
      return 'Minimum CGPA must be between 0 and 5.';
    }
    return null;
    // t is stable from useT(); only recompute when policy changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy]);

  const update = (k: keyof GraduationPolicy, v: number) =>
    setPolicy((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (validationError) return;
    setAcademicSettings({ graduationPolicy: policy });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setPolicy(DEFAULT_GRADUATION_POLICY);

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
          <i className="ph-bold ph-graduation-cap text-[#6A3FF4]"></i> {t('admin.graduationCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 8, 'Minimum requirements a student must meet to graduate. Surfaced on the student transcript page as an "Eligible to graduate" pill.')}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span> A student must complete at least{' '}
        <span className="font-semibold">{policy.minTotalCredits}</span> credit hours over at least{' '}
        <span className="font-semibold">{policy.minMainSemesters}</span> main semesters with a cumulative GPA of at least{' '}
        <span className="font-semibold">{policy.minCgpa.toFixed(2)}</span>.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.graduationMinCredits')}</label>
          <input
            type="number"
            min={30}
            max={300}
            value={policy.minTotalCredits}
            onChange={(e) => update('minTotalCredits', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.graduationMinSemesters')}</label>
          <input
            type="number"
            min={1}
            max={20}
            value={policy.minMainSemesters}
            onChange={(e) => update('minMainSemesters', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.graduationMinCgpa')}</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={5}
            value={policy.minCgpa}
            onChange={(e) => update('minCgpa', parseFloat(e.target.value) || 0)}
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
        <p className="text-xs text-emerald-400 mb-3">{t('admin.graduationSaved')}</p>
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
          {saving ? t('admin.saving') : t('admin.savePolicy')}
        </button>
      </div>
    </div>
  );
};

const GraduationPolicyPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.graduationCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.graduationSubtitle')}
        </p>
      </motion.div>
      <GraduationPolicyCard />
    </div>
  );
};

export default GraduationPolicyPage;
