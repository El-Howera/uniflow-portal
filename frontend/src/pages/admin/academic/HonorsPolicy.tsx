// src/pages/admin/academic/HonorsPolicy.tsx
//
// Plan 4 Phase 5 — admin-tunable honors qualification (FCDS Article 22).
// Knobs:
//   - maxMainSemesters         — graduation must finish in ≤ N main semesters.
//   - perSemesterMinGpa        — every main semester's earned GPA must clear this.
//   - cumulativeMinGpa         — final cumulative threshold for "honors".
//   - highHonorsCumMinGpa      — bumps "honors" → "high_honors". null = use
//                                 gradingRules.academicStanding.highHonorsGpaAbove.
//   - disqualifyingGrades      — pill picker (toggleable) over the active scale.
//   - requireNoDisciplinary    — toggle.
//
// Pill picker uses the live grading-rules scale so toggling letters in
// Grading Rules instantly reshapes the available disqualifying-grade options.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGradingRules } from '../../../utils/gradingRules';
import {
  setAcademicSettings,
  HonorsPolicy,
  DEFAULT_HONORS_POLICY,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle } from './_shared';
import { GlassCheckbox } from '../../../components/GlassCheckbox';
import { useT } from '../../../i18n';

const HonorsPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const gradingRules = useGradingRules();
  const [policy, setPolicy] = useState<HonorsPolicy>(DEFAULT_HONORS_POLICY);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Available letters = every entry in the active grading scale (scoring +
  // non-scoring administrative codes like FW, U). The DISQUALIFYING set is
  // a subset of those letters — pill toggle adds/removes.
  const allLetters = useMemo(
    () => gradingRules.scale.map((r) => r.letter),
    [gradingRules],
  );

  const validationError = useMemo(() => {
    if (!Number.isInteger(policy.maxMainSemesters) || policy.maxMainSemesters < 1) {
      return t('admin.hpErrMaxMain');
    }
    if (policy.perSemesterMinGpa < 0 || policy.perSemesterMinGpa > 5) return t('admin.hpErrPerSemRange');
    if (policy.cumulativeMinGpa < 0 || policy.cumulativeMinGpa > 5) return t('admin.hpErrCumRange');
    if (policy.highHonorsCumMinGpa !== null) {
      if (policy.highHonorsCumMinGpa < 0 || policy.highHonorsCumMinGpa > 5) {
        return t('admin.hpErrHighRange');
      }
      if (policy.highHonorsCumMinGpa < policy.cumulativeMinGpa) {
        return t('admin.hpErrHighGteCum');
      }
    }
    const unknown = policy.disqualifyingGrades.filter((l) => !allLetters.includes(l));
    if (unknown.length > 0) {
      return t('admin.hpErrUnknownLetters', { letters: unknown.join(', ') });
    }
    return null;
  }, [policy, allLetters, t]);

  const toggleLetter = (letter: string) => {
    setPolicy((prev) => {
      const has = prev.disqualifyingGrades.includes(letter);
      return {
        ...prev,
        disqualifyingGrades: has
          ? prev.disqualifyingGrades.filter((l) => l !== letter)
          : [...prev.disqualifyingGrades, letter],
      };
    });
  };

  const handleSave = () => {
    if (validationError) return;
    setAcademicSettings({ honorsPolicy: policy });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setPolicy(DEFAULT_HONORS_POLICY);

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
          <i className="ph-bold ph-medal text-[#6A3FF4]"></i> {t('admin.honorsCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 22, 'Conditions a graduating student must meet to earn Honors / High Honors. Evaluated whenever a transcript event fires; the result is stored on AcademicProfile and surfaced on the student transcript page.')}
        </p>
      </div>

      {/* Numeric thresholds */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.honorsMaxMain')}</label>
          <input
            type="number"
            min={1}
            max={20}
            value={policy.maxMainSemesters}
            onChange={(e) => setPolicy((p) => ({ ...p, maxMainSemesters: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '22b', 'Default: 9.')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.honorsPerSemMin')}</label>
          <input
            type="number" step={0.001} min={0} max={5}
            value={policy.perSemesterMinGpa}
            onChange={(e) => setPolicy((p) => ({ ...p, perSemesterMinGpa: parseFloat(e.target.value) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.hpPerSemHint')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.honorsCumMin')}</label>
          <input
            type="number" step={0.001} min={0} max={5}
            value={policy.cumulativeMinGpa}
            onChange={(e) => setPolicy((p) => ({ ...p, cumulativeMinGpa: parseFloat(e.target.value) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.honorsHighCumMin')}</label>
          <input
            type="number" step={0.001} min={0} max={5}
            value={policy.highHonorsCumMinGpa ?? ''}
            placeholder={t('admin.hpHighDefaultPh', { val: gradingRules.academicStanding.highHonorsGpaAbove })}
            onChange={(e) => {
              const raw = e.target.value;
              setPolicy((p) => ({ ...p, highHonorsCumMinGpa: raw === '' ? null : parseFloat(raw) || 0 }));
            }}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {t('admin.hpHighInheritHint', { val: gradingRules.academicStanding.highHonorsGpaAbove })}
          </p>
        </div>
      </div>

      {/* Disqualifying grades — pill picker */}
      <h4 className="text-sm font-bold text-black dark:text-white flex items-center gap-2 mb-2">
        <i className="ph-bold ph-prohibit text-[#6A3FF4]"></i> {t('admin.honorsDisqualifying')}
      </h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
        {articleHint(institution, '22b', 'A student with any of these letters anywhere in their transcript is permanently disqualified. Defaults: F, (F), FW, U.')}
      </p>
      <div className="flex flex-wrap gap-2 mb-5">
        {allLetters.map((letter) => {
          const active = policy.disqualifyingGrades.includes(letter);
          return (
            <button
              key={letter}
              onClick={() => toggleLetter(letter)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                active
                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
              }`}
              title={active ? t('admin.hpRemoveLetter', { letter }) : t('admin.hpAddLetter', { letter })}
            >
              {letter}
            </button>
          );
        })}
      </div>

      {/* Toggle: disciplinary disqualifies */}
      <div
        className="flex items-center gap-2 mb-5 cursor-pointer"
        onClick={() => setPolicy((p) => ({ ...p, requireNoDisciplinary: !p.requireNoDisciplinary }))}
      >
        <GlassCheckbox
          checked={policy.requireNoDisciplinary}
          onChange={(v) => setPolicy((p) => ({ ...p, requireNoDisciplinary: v }))}
          size="sm"
          ariaLabel={t('admin.honorsDisciplinary')}
        />
        <span className="text-sm text-black dark:text-white">{t('admin.honorsDisciplinary')}</span>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-4 py-3 mb-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#7B5AFF] mb-2 flex items-center gap-2">
          <i className="ph-bold ph-eye"></i> {t('admin.preview')}
        </h4>
        <p className="text-xs text-gray-700 dark:text-gray-300">
          {t('admin.hpPreviewPre')}{' '}
          <span className="font-semibold">{policy.cumulativeMinGpa}</span> {t('admin.hpPreviewAcross')}{' '}
          <span className="font-semibold">≤ {policy.maxMainSemesters}</span> {t('admin.hpPreviewMainSems')}{' '}
          {t('admin.hpPreviewPerSem')} <span className="font-semibold">{policy.perSemesterMinGpa}</span>, {t('admin.hpPreviewNoDisq')}
          ({policy.disqualifyingGrades.join(', ') || t('admin.hpNoneConfigured')}){policy.requireNoDisciplinary ? t('admin.hpAlsoDisc') : ''}{' '}
          {t('admin.hpEarns')} <span className="font-semibold text-emerald-400">{t('admin.honorsLbl')}</span>. {t('admin.hpWithCumGte')}{' '}
          <span className="font-semibold">
            {policy.highHonorsCumMinGpa ?? gradingRules.academicStanding.highHonorsGpaAbove}
          </span>
          {' '}{t('admin.hpTheyEarn')} <span className="font-semibold text-amber-400">{t('admin.highHonorsLbl')}</span>.
        </p>
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.apHonorsSavedFlash')}</p>
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

const HonorsPolicyPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.honorsCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {articleHint(institution, 22, 'Conditions a graduating student must meet to earn Honors / High Honors.')}
        </p>
      </motion.div>
      <HonorsPolicyCard />
    </div>
  );
};

export default HonorsPolicyPage;
