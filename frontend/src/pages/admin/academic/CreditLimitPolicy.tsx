// src/pages/admin/academic/CreditLimitPolicy.tsx
//
// Top-level "Academic → Credit Limit Policy" page. Lifts the
// CreditLimitPolicyCard component out of the old admin Settings → Academic
// tab into its own page. Pure refactor — no new behavior.
import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { setAcademicSettings } from '../../../utils/academicSettings';
import { resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

/* ─── Phase 12 follow-up — Credit-Hour Limit Policy card ────────────────
 * Replaces the nine hardcoded constants previously in
 * backend/lib/credit-limits.js. Persists to SystemSettings.creditLimitPolicy
 * via PATCH /api/admin/credit-limit-policy and refreshes the cached
 * useAcademicSettings() hook so any open page picks up the new caps.
 *
 * Decision tree the policy drives (also in docs/credit-limit-policy.md):
 *   1. summer term            → summer
 *   2. Senior + gpa ≥ good    → seniorBonus
 *   3. Freshman + freshmanMin ≤ gpa < good → freshmanSecondChance
 *   4. gpa > highThreshold    → highGpa
 *   5. gpa ≥ goodThreshold    → normal
 *   6. else                   → probation
 */

interface CreditPolicyShape {
  summer: number;
  seniorBonus: number;
  freshmanSecondChance: number;
  freshmanSecondChanceMinGpa: number;
  highGpa: number;
  normal: number;
  probation: number;
  highGpaThreshold: number;
  goodStandingThreshold: number;
}

const CREDIT_POLICY_DEFAULT: CreditPolicyShape = {
  summer: 9,
  seniorBonus: 21,
  freshmanSecondChance: 19,
  freshmanSecondChanceMinGpa: 1.66,
  highGpa: 21,
  normal: 19,
  probation: 12,
  highGpaThreshold: 3.33,
  goodStandingThreshold: 2.0,
};

const CreditLimitPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [policy, setPolicy] = useState<CreditPolicyShape>(CREDIT_POLICY_DEFAULT);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const update = (k: keyof CreditPolicyShape, v: number) =>
    setPolicy((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    setAcademicSettings({ creditLimitPolicy: policy });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setPolicy(CREDIT_POLICY_DEFAULT);

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
          <i className="ph-bold ph-clock-counter-clockwise text-[#6A3FF4]"></i> {t('admin.creditLimitCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Per-rule caps used by the registration handler. Edits take effect on the next registration without a server restart. See{' '}
          <code>docs/credit-limit-policy.md</code> for the rule order.
        </p>
      </div>

      {/* Caps */}
      <h4 className="text-sm font-bold text-black dark:text-white flex items-center gap-2 mb-3">
        <i className="ph-bold ph-stack text-[#6A3FF4]"></i> {t('admin.creditCapsSection')}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.creditSummerCap')}</label>
          <input type="number" min={1} max={60} value={policy.summer}
            onChange={(e) => update('summer', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditSeniorBonus')}</label>
          <input type="number" min={1} max={60} value={policy.seniorBonus}
            onChange={(e) => update('seniorBonus', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditHighGpaCap')}</label>
          <input type="number" min={1} max={60} value={policy.highGpa}
            onChange={(e) => update('highGpa', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditNormalCap')}</label>
          <input type="number" min={1} max={60} value={policy.normal}
            onChange={(e) => update('normal', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditFreshmanCap')}</label>
          <input type="number" min={1} max={60} value={policy.freshmanSecondChance}
            onChange={(e) => update('freshmanSecondChance', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.creditProbationCap')}</label>
          <input type="number" min={1} max={60} value={policy.probation}
            onChange={(e) => update('probation', parseInt(e.target.value, 10) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
      </div>

      {/* GPA thresholds */}
      <h4 className="text-sm font-bold text-black dark:text-white flex items-center gap-2 mb-3">
        <i className="ph-bold ph-chart-line text-[#6A3FF4]"></i> {t('admin.gpaThresholdsSection')}
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.gpaHighThreshold')}</label>
          <input type="number" step="0.01" min={0} max={5} value={policy.highGpaThreshold}
            onChange={(e) => update('highGpaThreshold', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.gpaGoodStanding')}</label>
          <input type="number" step="0.01" min={0} max={5} value={policy.goodStandingThreshold}
            onChange={(e) => update('goodStandingThreshold', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.gpaFreshmanMin')}</label>
          <input type="number" step="0.01" min={0} max={5} value={policy.freshmanSecondChanceMinGpa}
            onChange={(e) => update('freshmanSecondChanceMinGpa', parseFloat(e.target.value) || 0)}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle} />
        </div>
      </div>

      {saveError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.creditLimitSaved')}</p>
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
          disabled={saving}
          className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 text-sm font-bold rounded-lg transition-colors"
        >
          {saving ? t('admin.saving') : t('admin.savePolicy')}
        </button>
      </div>
    </div>
  );
};

const CreditLimitPolicyPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.creditLimitCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.creditLimitSubtitle')}</p>
      </motion.div>
      <CreditLimitPolicyCard />
    </div>
  );
};

export default CreditLimitPolicyPage;
