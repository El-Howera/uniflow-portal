// src/pages/admin/academic/IncompletePolicy.tsx
//
// Plan 4 Phase 4 — admin-tunable Incomplete grade policy (FCDS Article 17).
// 3 fields: term-work threshold percent, max-incompletes-per-student cap,
// and the make-up exam window (informational; not enforced server-side).
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  setAcademicSettings,
  IncompletePolicy,
  DEFAULT_INCOMPLETE_POLICY,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const IncompletePolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [policy, setPolicy] = useState<IncompletePolicy>(DEFAULT_INCOMPLETE_POLICY);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const validationError = useMemo(() => {
    if (policy.minTermWorkPercent < 0 || policy.minTermWorkPercent > 100) {
      return 'Term-work threshold must be between 0 and 100 %.';
    }
    if (!Number.isInteger(policy.maxIncompletesPerStudent) ||
        policy.maxIncompletesPerStudent < 0 || policy.maxIncompletesPerStudent > 20) {
      return 'Max incompletes per student must be an integer between 0 and 20.';
    }
    if (!Number.isInteger(policy.makeupExamWindowDays) ||
        policy.makeupExamWindowDays < 1 || policy.makeupExamWindowDays > 60) {
      return 'Makeup exam window must be 1–60 days.';
    }
    return null;
  }, [policy]);

  const update = (k: keyof IncompletePolicy, v: number) =>
    setPolicy((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    if (validationError) return;
    setAcademicSettings({ incompletePolicy: policy });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setPolicy(DEFAULT_INCOMPLETE_POLICY);

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
          <i className="ph-bold ph-hourglass-medium text-[#6A3FF4]"></i> {t('admin.incompleteCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 17, 'When a final exam is missed with an accepted excuse, the registrar files an Incomplete (I) letter on the transcript. The conditions below define when a student qualifies; admins tune them here.')}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span> A student qualifies for an Incomplete if their term-work earned is at least{' '}
        <span className="font-semibold">{policy.minTermWorkPercent}%</span> AND they have fewer than{' '}
        <span className="font-semibold">{policy.maxIncompletesPerStudent}</span> existing Incomplete rows. The make-up exam runs within{' '}
        <span className="font-semibold">{policy.makeupExamWindowDays}</span> days of the next semester start.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.incompleteTermWork')}</label>
          <input
            type="number"
            min={0}
            max={100}
            value={policy.minTermWorkPercent}
            onChange={(e) => update('minTermWorkPercent', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.incompleteMaxPerStudent')}</label>
          <input
            type="number"
            min={0}
            max={20}
            value={policy.maxIncompletesPerStudent}
            onChange={(e) => update('maxIncompletesPerStudent', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.incompleteWindowDays')}</label>
          <input
            type="number"
            min={1}
            max={60}
            value={policy.makeupExamWindowDays}
            onChange={(e) => update('makeupExamWindowDays', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <i className="ph-bold ph-info text-blue-300 mr-1.5"></i>
        Term-work and max-incompletes are <strong>enforced server-side</strong> when filing an <code className="px-1 bg-white/10 rounded">I</code> via Grade Override. The makeup window is informational — used in admin UI hints; not auto-enforced.
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.policySaved')}</p>
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

const IncompletePolicyPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.incompleteCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {articleHint(institution, 17, 'Conditions a student must meet to qualify for an "I" grade.')}
        </p>
      </motion.div>
      <IncompletePolicyCard />
    </div>
  );
};

export default IncompletePolicyPage;
