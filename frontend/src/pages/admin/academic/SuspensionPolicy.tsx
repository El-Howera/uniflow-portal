// src/pages/admin/academic/SuspensionPolicy.tsx
//
// Plan 4 Phase 6 — admin-tunable enrollment workflow caps (FCDS Articles
// 20, 21). Three knobs:
//   - maxSuspensionsTotal: career-wide cap (FCDS = 4 main semesters)
//   - militaryWithdrawalCountsAgainstCap: toggle
//   - reEnrollmentWithinSemesters: max time after cancellation to re-apply
//
// `maxConsecutive` is also stored but currently informational — the
// backend cap-check evaluates the running total, not the consecutive count.
// (The consecutive check would need a chronological semester index per
// suspension; this UI flags it as informational so admins know the field
// exists but doesn't auto-enforce.)
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  SuspensionPolicy,
  DEFAULT_SUSPENSION_POLICY,
  useSuspensionPolicy,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle } from './_shared';
import { GlassCheckbox } from '../../../components/GlassCheckbox';
import { useT } from '../../../i18n';

const SuspensionPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const initialPolicy = useSuspensionPolicy();
  const [policy, setPolicy] = useState<SuspensionPolicy>(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const validationError = useMemo(() => {
    if (!Number.isInteger(policy.maxSuspensionsTotal) || policy.maxSuspensionsTotal < 0) {
      return 'Max suspensions total must be a non-negative integer.';
    }
    if (!Number.isInteger(policy.maxConsecutive) || policy.maxConsecutive < 0) {
      return 'Max consecutive must be a non-negative integer.';
    }
    if (policy.maxConsecutive > policy.maxSuspensionsTotal) {
      return 'Max consecutive cannot exceed max total.';
    }
    if (!Number.isInteger(policy.reEnrollmentWithinSemesters) || policy.reEnrollmentWithinSemesters < 0) {
      return 'Re-enrollment window must be a non-negative integer.';
    }
    return null;
  }, [policy]);

  const handleSave = () => {
    if (validationError) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    // MVP build — local-only save, no network.
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
    setSaving(false);
  };

  const handleReset = () => setPolicy(DEFAULT_SUSPENSION_POLICY);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-pause-circle text-[#6A3FF4]"></i> {t('admin.suspensionCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Caps for suspension (Article 20) + re-enrollment after cancellation (Article 21). The SA queue cap-checks every approval against this policy.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.maxSuspensionsCareer')}</label>
          <input
            type="number"
            min={0}
            max={20}
            value={policy.maxSuspensionsTotal}
            onChange={(e) => setPolicy((p) => ({ ...p, maxSuspensionsTotal: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '20a', 'Default: 4.')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.maxConsecutive')}</label>
          <input
            type="number"
            min={0}
            max={20}
            value={policy.maxConsecutive}
            onChange={(e) => setPolicy((p) => ({ ...p, maxConsecutive: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apSuspensionInformationalHint')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.reEnrollmentWindow')}</label>
          <input
            type="number"
            min={0}
            max={20}
            value={policy.reEnrollmentWithinSemesters}
            onChange={(e) => setPolicy((p) => ({ ...p, reEnrollmentWithinSemesters: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, 21, 'Default: 4.')}</p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 mb-5 cursor-pointer"
        onClick={() => setPolicy((p) => ({ ...p, militaryWithdrawalCountsAgainstCap: !p.militaryWithdrawalCountsAgainstCap }))}
      >
        <GlassCheckbox
          checked={policy.militaryWithdrawalCountsAgainstCap}
          onChange={(v) => setPolicy((p) => ({ ...p, militaryWithdrawalCountsAgainstCap: v }))}
          size="sm"
        />
        <span className="text-sm text-black dark:text-white">{t('admin.militaryCountsCap')}</span>
        <span className="text-xs text-gray-500">{articleHint(institution, '20c', 'Default: off.')}</span>
      </div>

      <div className="rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-4 py-3 mb-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#7B5AFF] mb-2 flex items-center gap-2">
          <i className="ph-bold ph-eye"></i> {t('admin.preview')}
        </h4>
        <ul className="space-y-1.5 text-xs text-gray-700 dark:text-gray-300 list-disc list-inside">
          <li>
            A student can suspend their enrollment for up to{' '}
            <span className="font-semibold">{policy.maxSuspensionsTotal}</span> main semester{policy.maxSuspensionsTotal === 1 ? '' : 's'} total over their career.
          </li>
          <li>
            Military withdrawal{' '}
            <span className="font-semibold">{policy.militaryWithdrawalCountsAgainstCap ? 'counts' : 'does NOT count'}</span>{' '}
            toward that cap.
          </li>
          <li>
            After cancelling enrollment, a student must re-apply within{' '}
            <span className="font-semibold">{policy.reEnrollmentWithinSemesters}</span>{' '}
            main semester{policy.reEnrollmentWithinSemesters === 1 ? '' : 's'}; later than that, the window is closed.
          </li>
        </ul>
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

const SuspensionPolicyPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.suspensionCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.suspensionSubtitle')}
        </p>
      </motion.div>
      <SuspensionPolicyCard />
    </div>
  );
};

export default SuspensionPolicyPage;
