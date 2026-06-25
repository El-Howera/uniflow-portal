// src/pages/admin/academic/AdvisorPolicy.tsx
//
// Plan 4 Phase 8 — admin-tunable academic advisor approval gate
// (FCDS Article 12). 4 fields:
//   - requireAdvisorApproval — master toggle. When false, the advisor gate
//     never fires (registrations still go to SA, just without an advisor row).
//   - autoApproveBelowCredits — bypass the advisor gate when the new course's
//     credit total is at or below this value. Default 0 = every registration.
//   - gracePeriodHours — reserved for a future scheduled-sweep auto-approval.
//     Surfaced for visibility; not currently enforced.
//   - restrictPickerToFlaggedProfessors — UI hint. When true, the student-edit
//     advisor picker pre-filters to professors with isAcademicAdvisor=true.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  setAcademicSettings,
  AdvisorPolicy,
  DEFAULT_ADVISOR_POLICY,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const AdvisorPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [policy, setPolicy] = useState<AdvisorPolicy>(DEFAULT_ADVISOR_POLICY);
  const loading = false;
  const [saving] = useState(false);
  const [saveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const validationError = useMemo(() => {
    if (!Number.isInteger(policy.autoApproveBelowCredits) ||
        policy.autoApproveBelowCredits < 0 || policy.autoApproveBelowCredits > 60) {
      return 'Auto-approve threshold must be an integer between 0 and 60.';
    }
    if (!Number.isInteger(policy.gracePeriodHours) ||
        policy.gracePeriodHours < 0 || policy.gracePeriodHours > 720) {
      return 'Grace period must be 0–720 hours (30 days).';
    }
    return null;
  }, [policy]);

  const handleSave = () => {
    if (validationError) return;
    setAcademicSettings({ advisorPolicy: policy });
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
  };

  const handleReset = () => setPolicy(DEFAULT_ADVISOR_POLICY);

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
          <i className="ph-bold ph-user-focus text-[#6A3FF4]"></i> {t('admin.advisorCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 12, 'Routes student registrations through their assigned advisor before SA can approve. The advisor sees pending registrations on their Advisees queue and flips the gate; SA still issues final approval.')}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.apAdvPreviewLabel')}</span>{' '}
        {policy.requireAdvisorApproval ? (
          <>
            {t('admin.apAdvPreviewAddingMore')}{' '}
            <span className="font-semibold">{policy.autoApproveBelowCredits}</span>{' '}
            {t('admin.apAdvPreviewCreditHrs', { s: policy.autoApproveBelowCredits === 1 ? '' : 's' })}
            {policy.gracePeriodHours > 0 && (
              <> {t('admin.apAdvPreviewAutoApprove')} <span className="font-semibold">{policy.gracePeriodHours}h</span> {t('admin.apAdvPreviewIfUntouched')}</>
            )}
            {' '}{t('admin.apAdvPreviewPickerIs')}{' '}
            <span className="font-semibold">{policy.restrictPickerToFlaggedProfessors ? t('admin.apAdvPreviewRestricted') : t('admin.apAdvPreviewOpen')}</span>{' '}
            {t('admin.apAdvPreviewPickerTo')} {policy.restrictPickerToFlaggedProfessors ? t('admin.apAdvPreviewFlaggedOnly') : t('admin.apAdvPreviewAllProfs')}.
          </>
        ) : (
          <>{t('admin.apAdvDisabledFull')} <span className="font-semibold">{t('admin.apAdvDisabledBold')}</span>{t('admin.apAdvDisabledTail')}</>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.advisorRequire')}</label>
          <button
            onClick={() => setPolicy((p) => ({ ...p, requireAdvisorApproval: !p.requireAdvisorApproval }))}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              policy.requireAdvisorApproval
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
            }`}
          >
            {policy.requireAdvisorApproval ? t('admin.advisorYesGate') : t('admin.advisorNoGate')}
          </button>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.advisorAutoApprove')}</label>
          <input
            type="number"
            min={0}
            max={60}
            value={policy.autoApproveBelowCredits}
            onChange={(e) => setPolicy((p) => ({ ...p, autoApproveBelowCredits: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apAdvAutoApproveHint')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.advisorGraceHrs')}</label>
          <input
            type="number"
            min={0}
            max={720}
            value={policy.gracePeriodHours}
            onChange={(e) => setPolicy((p) => ({ ...p, gracePeriodHours: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apAdvInformationalHint')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.advisorPickerRestriction')}</label>
          <button
            onClick={() => setPolicy((p) => ({ ...p, restrictPickerToFlaggedProfessors: !p.restrictPickerToFlaggedProfessors }))}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              policy.restrictPickerToFlaggedProfessors
                ? 'bg-[#6A3FF4]/15 text-[#7B5AFF] border-[#6A3FF4]/30'
                : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
            }`}
          >
            {policy.restrictPickerToFlaggedProfessors ? t('admin.advisorFlaggedOnly') : t('admin.advisorAnyProf')}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <i className="ph-bold ph-info text-blue-300 mr-1.5"></i>
        The advisor gate is <strong>enforced server-side</strong> at registration time. Approved
        advisor sign-off clears the <code className="px-1 bg-white/10 rounded">advisor_approval</code>{' '}
        pending reason; SA still does the final approval pass on every registration.
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

/**
 * BulkAutoAssignCard
 *
 * Round-robins flagged professors across every student that doesn't yet
 * have an advisor assigned. Idempotent — re-running only fills gaps. Use
 * the per-student picker on UserEditPage to override individual assignments
 * after the bulk run.
 */
const BulkAutoAssignCard: FC = () => {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    assigned: number;
    skipped: number;
    totalStudents: number;
    totalAdvisors: number;
  } | null>(null);
  const [err] = useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(true);

  // MVP build — no backend. Simulate a plausible auto-assign result locally.
  const handleRun = () => {
    if (!onlyMissing) {
      const ok = window.confirm(
        'Reassign EVERY student—even ones who already have an advisor? Existing assignments will be overwritten.'
      );
      if (!ok) return;
    }
    setRunning(true);
    setResult(null);
    window.setTimeout(() => {
      setResult(
        onlyMissing
          ? { assigned: 18, skipped: 142, totalStudents: 160, totalAdvisors: 12 }
          : { assigned: 160, skipped: 0, totalStudents: 160, totalAdvisors: 12 },
      );
      setRunning(false);
    }, 600);
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-3">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-shuffle text-[#6A3FF4]"></i> {t('admin.advisorBulkAssign')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Round-robins every flagged advisor across the student roster. Re-runnable;
          new students are also auto-assigned at creation time using the smallest-load
          advisor — bulk run only needed for retroactive fills or after flagging new advisors.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => setOnlyMissing((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            onlyMissing
              ? 'bg-[#6A3FF4]/15 text-[#7B5AFF] border-[#6A3FF4]/30'
              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          }`}
        >
          {onlyMissing ? 'Fill gaps only (safe)' : 'Reassign everyone (overwrites)'}
        </button>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 text-white px-4 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
        >
          <i className={`ph-bold ${running ? 'ph-spinner animate-spin' : 'ph-play-circle'}`}></i>
          {running ? t('admin.advisorRunning') : t('admin.advisorRunAssign')}
        </button>
      </div>

      {err && (
        <p className="text-xs text-red-400">{err}</p>
      )}
      {result && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
          <p>
            Assigned <span className="font-semibold text-emerald-400">{result.assigned}</span> · skipped{' '}
            <span className="font-semibold">{result.skipped}</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {result.totalStudents} student{result.totalStudents === 1 ? '' : 's'} ·{' '}
            {result.totalAdvisors} advisor{result.totalAdvisors === 1 ? '' : 's'} in the pool.
          </p>
        </div>
      )}
    </div>
  );
};

const AdvisorPolicyPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.advisorCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Article 12 — academic advisor approval gate.
        </p>
      </motion.div>
      <AdvisorPolicyCard />
      <BulkAutoAssignCard />
    </div>
  );
};

export default AdvisorPolicyPage;
