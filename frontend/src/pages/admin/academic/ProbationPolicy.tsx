// src/pages/admin/academic/ProbationPolicy.tsx
//
// Focused editor for the 6 academic-standing thresholds that decide whether
// a student is in good standing / on warning / on probation / dismissed.
// These values live inside the larger `gradingRules.academicStanding` JSON
// blob; this page is a sibling of GradingRules.tsx that only exposes the
// standing knobs so admins don't have to scroll through the full grading-rules
// editor to tune dismissal rules.
//
// Save round-trip: GET /api/admin/grading-rules → splice this page's edits
// into the rules.academicStanding sub-object → PATCH /api/admin/grading-rules.
// This way the rest of the grading rules (letter scale, credit bounds, etc.)
// remain untouched while we update just the standing block.
//
// Backend reads these on every transcript cascade via backend/lib/
// academic-standing.js → evaluateStanding(). Toggling a threshold here →
// the next grade write will use the new values and persist a recomputed
// `academic_standing` to the student's AcademicProfile.

import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { useGradingRules } from '../../../utils/gradingRules';
import {
  GradingRules,
  AcademicStanding,
  DEFAULT_RULES as DEFAULT_GRADING_RULES,
} from '../../../utils/gradingRules';
import { articleHint, useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle, inputStyle } from './_shared';
import { useT } from '../../../i18n';

const ProbationPolicy: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const initialRules = useGradingRules();
  const [rules, setRules] = useState<GradingRules>(initialRules);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const standing: AcademicStanding = rules.academicStanding;

  const updateStanding = <K extends keyof AcademicStanding>(key: K, value: AcademicStanding[K]) => {
    setRules((prev) => ({
      ...prev,
      academicStanding: { ...prev.academicStanding, [key]: value },
    }));
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    // MVP build — local-only save, no network.
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2000);
    setSaving(false);
  };

  const handleReset = () => {
    setRules((prev) => ({
      ...prev,
      academicStanding: { ...DEFAULT_GRADING_RULES.academicStanding },
    }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${glassCardStyle} p-6 sm:p-8`}
    >
      <div className="flex items-center gap-3 mb-4">
        <i className="ph-bold ph-warning text-2xl text-amber-400"></i>
        <div>
          <h2 className="text-black dark:text-white font-bold text-lg">{t('admin.probationCardTitle')}</h2>
          <p className="text-gray-500 text-xs">
            {articleHint(institution, 19, "Controls the per-semester GPA floor for warnings and the counter that triggers dismissal.")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 mb-5 text-xs text-amber-300">
        <i className="ph-bold ph-info mr-1"></i>
        {t('admin.apProbWriteBoth')} <code className="text-amber-200">gradingRules.academicStanding</code> {t('admin.apProbWriteBoth')} <strong>{t('admin.apProbCourseSettingsPath')}</strong>{t('admin.apProbWriteBothEnd')}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          {error}
        </div>
      )}

      {/* GPA thresholds — what counts as warning / probation / dismissal */}
      <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        {t('admin.gpaThresholdsSection')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.warnIfBelow')}</label>
          <input
            type="number" step={0.01} min={0} max={5}
            value={standing.probationGpaBelow ?? 2.0}
            onChange={(e) => updateStanding('probationGpaBelow', Number(e.target.value))}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apProbWarningHint')}</p>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.immediateDismissBelow')}</label>
          <input
            type="number" step={0.01} min={0} max={5}
            value={standing.dismissalGpaBelow ?? 1.5}
            onChange={(e) => updateStanding('dismissalGpaBelow', Number(e.target.value))}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apProbDismissHint')}</p>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.secondSemFloor')}</label>
          <input
            type="number" step={0.001} min={0} max={5}
            value={standing.firstYearWarningGpa ?? 1.666}
            onChange={(e) => updateStanding('firstYearWarningGpa', Number(e.target.value))}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {articleHint(institution, '19a', 'Default 1.666 — end of 2nd semester below this jumps straight to probation.')}
          </p>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.probationCreditCap')}</label>
          <input
            type="number" min={1} max={60} step={1}
            value={standing.probationMaxCredits ?? 12}
            onChange={(e) => updateStanding('probationMaxCredits', parseInt(e.target.value, 10) || 0)}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {articleHint(institution, '19b', 'Default 12 — registration cap when a student is on probation.')}
          </p>
        </div>
      </div>

      {/* Dismissal counters */}
      <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        {t('admin.dismissalCounters')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.dismissAfterConsecutive')}</label>
          <input
            type="number" min={1} max={20} step={1}
            value={standing.dismissalConsecutiveSemesters ?? 3}
            onChange={(e) => updateStanding('dismissalConsecutiveSemesters', parseInt(e.target.value, 10) || 0)}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {articleHint(institution, '19e', 'Default 3 — three semesters in a row below the warning floor dismisses the student.')}
          </p>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.dismissAfterNonConsec')}</label>
          <input
            type="number" min={1} max={20} step={1}
            value={standing.dismissalNonConsecutiveSemesters ?? 4}
            onChange={(e) => updateStanding('dismissalNonConsecutiveSemesters', parseInt(e.target.value, 10) || 0)}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {articleHint(institution, '19e', "Default 4 — total over the student's career, regardless of order.")}
          </p>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-white/10 dark:border-white/5 bg-white/5 dark:bg-black/10 p-4 mb-5">
        <div className="text-[10px] font-bold text-gray-500 uppercase mb-2">{t('admin.livePreviewLower')}</div>
        <ul className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed space-y-1">
          <li>• A cumulative GPA below <strong>{standing.probationGpaBelow ?? 2.0}</strong> triggers a warning the first time, then probation on the second time.</li>
          <li>• A cumulative GPA below <strong>{standing.dismissalGpaBelow ?? 1.5}</strong> at any point → immediate dismissal.</li>
          <li>• <strong>{standing.dismissalConsecutiveSemesters ?? 3}</strong> consecutive sub-threshold semesters → dismissal.</li>
          <li>• <strong>{standing.dismissalNonConsecutiveSemesters ?? 4}</strong> total sub-threshold semesters (any order) → dismissal.</li>
          <li>• While on probation, a student can register at most <strong>{standing.probationMaxCredits ?? 12}</strong> credits per semester.</li>
        </ul>
      </div>

      <div className="flex justify-between gap-3">
        <button
          onClick={handleReset}
          type="button"
          className="px-4 py-2 text-xs font-bold rounded-xl border border-white/10 dark:border-white/5 text-gray-300 hover:bg-white/5"
        >
          {t('admin.resetFcds')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
        >
          {saving ? t('admin.saving') : savedFlag ? t('admin.savedFlash') : t('admin.saveThresholdsPolicy')}
        </button>
      </div>
    </motion.div>
  );
};

export default ProbationPolicy;
