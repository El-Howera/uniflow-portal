// src/pages/admin/academic/MobilityPolicy.tsx
//
// Plan 4 Phase 7 — admin-tunable mobility / exchange policy (FCDS Articles 24, 25).
// 4 fields:
//   - maxExternalPercentOfTotal — fraction of graduation credits that can come
//     from external transfers. Default 0.25 (FCDS Article 25a → 35 cr of 140).
//   - includeInCgpa — whether approved external credits feed into the cumulative
//     GPA. FCDS says yes; some tenants prefer "transfer credit, not GPA".
//   - visitingMaxPerMain / visitingMaxPerSummer — per-term registration cap for
//     visiting (non-FCDS) students (Article 25b).
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  MobilityPolicy,
  DEFAULT_MOBILITY_POLICY,
  useGraduationPolicy,
  useMobilityPolicy,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const MobilityPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const initialPolicy = useMobilityPolicy();
  const [policy, setPolicy] = useState<MobilityPolicy>(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const graduation = useGraduationPolicy();

  // Live preview: cap as raw credits at the configured graduation total.
  const externalCap = useMemo(
    () => Math.floor((graduation.minTotalCredits || 140) * policy.maxExternalPercentOfTotal),
    [graduation.minTotalCredits, policy.maxExternalPercentOfTotal],
  );

  const validationError = useMemo(() => {
    if (policy.maxExternalPercentOfTotal < 0 || policy.maxExternalPercentOfTotal > 1) {
      return 'External cap must be a fraction between 0 and 1 (e.g. 0.25 = 25%).';
    }
    if (!Number.isInteger(policy.visitingMaxPerMain) ||
        policy.visitingMaxPerMain < 0 || policy.visitingMaxPerMain > 60) {
      return 'Visiting (main term) cap must be an integer between 0 and 60.';
    }
    if (!Number.isInteger(policy.visitingMaxPerSummer) ||
        policy.visitingMaxPerSummer < 0 || policy.visitingMaxPerSummer > 60) {
      return 'Visiting (summer) cap must be an integer between 0 and 60.';
    }
    return null;
  }, [policy]);

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    // MVP build — local-only save, no network.
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
    setSaving(false);
  };

  const handleReset = () => setPolicy(DEFAULT_MOBILITY_POLICY);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-globe-hemisphere-east text-[#6A3FF4]"></i> {t('admin.mobilityCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 25, `Caps for ${institution.regulatoryFramework} students transferring external credits in (25a) and for visiting students registered for credit while enrolled (25b).`)}
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span> A {institution.regulatoryFramework} student may import up to{' '}
        <span className="font-semibold">{(policy.maxExternalPercentOfTotal * 100).toFixed(1)}%</span>{' '}
        of their graduation total = <span className="font-semibold">{externalCap} cr</span> from external institutions
        ({graduation.minTotalCredits || 140} cr graduation total).
        Approved transfers <span className="font-semibold">{policy.includeInCgpa ? 'count' : 'do not count'}</span> toward CGPA.
        Visiting students may register up to <span className="font-semibold">{policy.visitingMaxPerMain}</span> cr in a main semester
        and <span className="font-semibold">{policy.visitingMaxPerSummer}</span> cr in summer.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.mobilityExternalCap')}</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={policy.maxExternalPercentOfTotal}
            onChange={(e) => setPolicy((p) => ({ ...p, maxExternalPercentOfTotal: parseFloat(e.target.value) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">0.25 = 25% (default).</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.mobilityIncludeCgpa')}</label>
          <button
            onClick={() => setPolicy((p) => ({ ...p, includeInCgpa: !p.includeInCgpa }))}
            className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              policy.includeInCgpa
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-gray-500/15 text-gray-400 border-gray-500/30'
            }`}
          >
            {policy.includeInCgpa ? t('admin.mobilityYesIncl') : t('admin.mobilityNoIncl')}
          </button>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.mobilityVisitMain')}</label>
          <input
            type="number"
            min={0}
            max={60}
            value={policy.visitingMaxPerMain}
            onChange={(e) => setPolicy((p) => ({ ...p, visitingMaxPerMain: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.mobilityVisitSummer')}</label>
          <input
            type="number"
            min={0}
            max={60}
            value={policy.visitingMaxPerSummer}
            onChange={(e) => setPolicy((p) => ({ ...p, visitingMaxPerSummer: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <i className="ph-bold ph-info text-blue-300 mr-1.5"></i>
        The external-transfer cap is <strong>enforced server-side</strong> when an admin approves an
        external credit transfer (External Credits queue). The visiting caps are applied during
        registration when the student is flagged as a visitor — currently informational; not yet
        enforced in the registration handler.
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

const MobilityPolicyPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.mobilityCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.mobilitySubtitle')}
        </p>
      </motion.div>
      <MobilityPolicyCard />
    </div>
  );
};

export default MobilityPolicyPage;
