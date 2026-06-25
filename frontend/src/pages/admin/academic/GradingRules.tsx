// src/pages/admin/academic/GradingRules.tsx
//
// Top-level "Academic → Grading Rules" page. Lifts the GradingRulesCard
// component out of the old admin Settings → Academic tab into its own page.
// Pure refactor — no new behavior.
import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GradingRules,
  AcademicStanding,
  DEFAULT_RULES as DEFAULT_GRADING_RULES,
  invalidateGradingRules,
} from '../../../utils/gradingRules';
import { articleHint, useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle, inputStyle } from './_shared';
import { GlassCheckbox } from '../../../components/GlassCheckbox';
import { useT } from '../../../i18n';

/* ─── Grading Rules Card (preview mockup) ─────────────────────────────────────
 * MVP build — no backend. Seeded from the FCDS default grading rules; edits
 * are local-only. The Recompute Transcripts button simulates a result.
 */
const GradingRulesCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [rules, setRules] = useState<GradingRules>(DEFAULT_GRADING_RULES);
  const loading = false;
  const [saving] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);
  const [error] = useState<string | null>(null);
  const [confirmRecompute, setConfirmRecompute] = useState(false);

  const updateScaleRow = (idx: number, patch: Partial<GradingRules['scale'][number]>) => {
    setRules((prev) => ({
      ...prev,
      scale: prev.scale.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  };
  const removeScaleRow = (idx: number) => {
    setRules((prev) => ({ ...prev, scale: prev.scale.filter((_, i) => i !== idx) }));
  };
  const addScaleRow = () => {
    setRules((prev) => ({
      ...prev,
      scale: [...prev.scale, { letter: 'X', minPercent: 0, qualityPoints: 0 }],
    }));
  };
  const addNonScoringRow = () => {
    setRules((prev) => ({
      ...prev,
      scale: [
        ...prev.scale,
        { letter: 'NEW', minPercent: 0, qualityPoints: 0, nonScoring: true, label: '' },
      ],
    }));
  };

  const handleSave = () => {
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 2500);
    // Force every consumer (GpaCalculator, FullTranscript, dashboards)
    // to pick up the new rules without a hard reload.
    invalidateGradingRules().catch(() => {});
  };

  // MVP build — no backend. Simulate the recompute result locally.
  const handleRecompute = () => {
    setRecomputeMsg(null);
    setRecomputing(true);
    window.setTimeout(() => {
      setRecomputeMsg(
        t('admin.grRecomputeResult', {
          courses: 1284,
          sems: 312,
          profiles: 160,
        })
      );
      setRecomputing(false);
      setConfirmRecompute(false);
    }, 600);
  };

  const standing = rules.academicStanding;

  return (
    <div className={`${glassCardStyle} p-6`}>
      <h3 className="text-lg font-bold text-black dark:text-white flex items-center">
        <i className="ph-bold ph-scales mr-2 text-[#6A3FF4]"></i> {t('admin.gradingRulesCardTitle')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">
        {t('admin.grHelpIntro')}
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse h-48 rounded-xl bg-white/5"></div>
      ) : (
        <>
          {/* ── Letter scale ──────────────────────── */}
          <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            {t('admin.letterScale')}
          </h4>
          <div className="overflow-x-auto rounded-xl border border-white/10 mb-2">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">{t('admin.letterCol')}</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">{t('admin.minPctCol')}</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">{t('admin.qualityPtsCol')}</th>
                  <th className="px-3 py-2 text-center text-[10px] uppercase tracking-wider text-gray-500" title={t('admin.grAdminCodeTip')}>
                    {t('admin.adminCodeCol')}
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500">{t('admin.labelCol')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rules.scale.map((row, i) => {
                  const isAdmin = !!row.nonScoring;
                  return (
                    <tr key={i} className={`border-t border-white/5 ${isAdmin ? 'bg-[#6A3FF4]/5' : ''}`}>
                      <td className="px-3 py-1.5">
                        <input
                          value={row.letter}
                          onChange={(e) => updateScaleRow(i, { letter: e.target.value.slice(0, 4) })}
                          className="w-16 bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-2 py-1.5 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4]"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={row.minPercent}
                          min={0}
                          max={100}
                          disabled={isAdmin}
                          title={isAdmin ? t('admin.grNonScoringNoPct') : ''}
                          onChange={(e) => updateScaleRow(i, { minPercent: Number(e.target.value) })}
                          className={`w-20 border border-white/10 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#6A3FF4] ${isAdmin ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-white/5 dark:bg-black/10 text-black dark:text-white'}`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          step={0.001}
                          value={row.qualityPoints}
                          min={0}
                          max={5}
                          disabled={isAdmin}
                          title={isAdmin ? t('admin.grNonScoringNoGpa') : ''}
                          onChange={(e) => updateScaleRow(i, { qualityPoints: Number(e.target.value) })}
                          className={`w-20 border border-white/10 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#6A3FF4] ${isAdmin ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-white/5 dark:bg-black/10 text-black dark:text-white'}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="flex justify-center" title={t('admin.grMarkNonScoringTip')}>
                          <GlassCheckbox
                            checked={isAdmin}
                            onChange={(next) => {
                              updateScaleRow(i, next
                                ? { nonScoring: true, minPercent: 0, qualityPoints: 0 }
                                : { nonScoring: false }
                              );
                            }}
                            size="sm"
                            ariaLabel={t('admin.grNonScoringAria')}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={row.label ?? ''}
                          onChange={(e) => updateScaleRow(i, { label: e.target.value.slice(0, 60) })}
                          placeholder={isAdmin ? t('admin.grLabelPhAdmin') : t('admin.grLabelPhScoring')}
                          className="w-full min-w-[140px] bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-2 py-1.5 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4]"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => removeScaleRow(i)}
                          className="text-red-400 hover:text-red-300 text-xs"
                          title={t('admin.grRemoveLetter', { letter: row.letter })}
                        >
                          <i className="ph-bold ph-trash text-base"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4 mb-5">
            <button
              onClick={addScaleRow}
              className="text-xs text-[#7B5AFF] hover:text-[#9B7AFF] transition-colors flex items-center gap-1"
            >
              <i className="ph-bold ph-plus"></i> {t('admin.addScoringLetter')}
            </button>
            <button
              onClick={addNonScoringRow}
              className="text-xs text-[#7B5AFF] hover:text-[#9B7AFF] transition-colors flex items-center gap-1"
              title={t('admin.grAddAdminCodeTip')}
            >
              <i className="ph-bold ph-plus-circle"></i> {t('admin.addAdminCode')}
            </button>
          </div>

          {/* ── Academic standing ─────────────────── */}
          <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            {t('admin.standingThresholds')}
          </h4>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {(
              [
                ['probationGpaBelow', t('admin.probationIfBelow')],
                ['dismissalGpaBelow', t('admin.dismissalIfBelow')],
                ['honorsGpaAbove', t('admin.honorsIfAbove')],
                ['highHonorsGpaAbove', t('admin.highHonorsIfAbove')],
              ] as Array<[keyof AcademicStanding, string]>
            ).map(([k, label]) => (
              <div key={k}>
                <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{label}</label>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  max={5}
                  value={(standing[k] as number | undefined) ?? 0}
                  onChange={(e) =>
                    setRules((prev) => ({
                      ...prev,
                      academicStanding: { ...prev.academicStanding, [k]: Number(e.target.value) },
                    }))
                  }
                  className={inputStyle}
                />
              </div>
            ))}
          </div>

          {/* Plan 4 Phase 5 — Article 19 / 22 extensions. The 2nd-semester
              warning floor + dismissal counter + probation credit cap. */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.grSecondSemWarn')}</label>
              <input
                type="number" step={0.001} min={0} max={5}
                value={standing.firstYearWarningGpa ?? 1.666}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    academicStanding: { ...prev.academicStanding, firstYearWarningGpa: Number(e.target.value) },
                  }))
                }
                className={inputStyle}
              />
              <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '19a', 'Special floor at end of 2nd semester.')}</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.grProbationMaxCredits')}</label>
              <input
                type="number" min={1} max={60} step={1}
                value={standing.probationMaxCredits ?? 12}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    academicStanding: { ...prev.academicStanding, probationMaxCredits: parseInt(e.target.value, 10) || 0 },
                  }))
                }
                className={inputStyle}
              />
              <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '19b', 'Registration cap when on probation.')}</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.grDismissConsec')}</label>
              <input
                type="number" min={1} max={20} step={1}
                value={standing.dismissalConsecutiveSemesters ?? 3}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    academicStanding: { ...prev.academicStanding, dismissalConsecutiveSemesters: parseInt(e.target.value, 10) || 0 },
                  }))
                }
                className={inputStyle}
              />
              <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '19e', '3 in a row triggers dismissal.')}</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.grDismissNonConsec')}</label>
              <input
                type="number" min={1} max={20} step={1}
                value={standing.dismissalNonConsecutiveSemesters ?? 4}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    academicStanding: { ...prev.academicStanding, dismissalNonConsecutiveSemesters: parseInt(e.target.value, 10) || 0 },
                  }))
                }
                className={inputStyle}
              />
              <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, '19e', "Total over the student's career.")}</p>
            </div>
          </div>

          {/* ── Credits ──────────────────────────── */}
          {/* Plan 4 Phase 1 follow-up — `Graduation Total` moved to its own
              admin page (Academic Settings → Graduation Policy) so per-credit
              graduation rules live next to per-CGPA / per-semester rules.
              `min` / `max` here continue to gate the legacy bounds-check used
              by the GpaCalculator and the gradebook. */}
          <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            {t('admin.perSemCreditBounds')}
          </h4>
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.minPerSem')}</label>
              <input
                type="number"
                value={rules.credits.min}
                min={1}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    credits: { ...prev.credits, min: Number(e.target.value) },
                  }))
                }
                className={inputStyle}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase">{t('admin.maxPerSem')}</label>
              <input
                type="number"
                value={rules.credits.max}
                min={1}
                onChange={(e) =>
                  setRules((prev) => ({
                    ...prev,
                    credits: { ...prev.credits, max: Number(e.target.value) },
                  }))
                }
                className={inputStyle}
              />
            </div>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-5 italic">
            {t('admin.grGradTotalMovedPre')}{' '}
            <a href="/admin/academic/graduation-policy" className="text-[#7B5AFF] hover:underline">
              {t('admin.grGradTotalMovedLink')}
            </a>
            {' '}{t('admin.grGradTotalMovedPost')}
          </p>

          {/* ── Actions ──────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
            >
              {saving ? t('admin.saving') : savedFlag ? t('admin.savedFlash') : t('admin.saveRules')}
            </button>
            <button
              onClick={() => setConfirmRecompute(true)}
              disabled={recomputing}
              className="flex-1 py-3 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-bold hover:bg-white/10 transition-colors disabled:opacity-60"
            >
              {recomputing ? t('admin.recomputing') : t('admin.recomputeTranscripts')}
            </button>
          </div>

          {recomputeMsg && (
            <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
              <i className="ph-bold ph-check-circle mr-2"></i>
              {recomputeMsg}
            </div>
          )}

          {/* Confirmation modal — recompute touches every transcript in the DB */}
          {confirmRecompute && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => setConfirmRecompute(false)}
            >
              <div
                className={`${glassCardStyle} p-6 max-w-md mx-4`}
                onClick={(e) => e.stopPropagation()}
              >
                <h4 className="text-lg font-bold text-black dark:text-white mb-2">
                  {t('admin.recomputeConfirmTitle')}
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {t('admin.grRecomputeConfirmBody')}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setConfirmRecompute(false)}
                    className="flex-1 py-2.5 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-medium text-sm hover:bg-white/10"
                  >
                    {t('admin.cancelBtn')}
                  </button>
                  <button
                    onClick={handleRecompute}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-medium text-sm hover:opacity-90"
                  >
                    {t('admin.yesRecompute')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const GradingRulesPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.gradingRulesTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.grPageSubtitle')}</p>
      </motion.div>
      <GradingRulesCard />
    </div>
  );
};

export default GradingRulesPage;
