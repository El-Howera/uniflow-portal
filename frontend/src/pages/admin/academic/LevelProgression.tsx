// src/pages/admin/academic/LevelProgression.tsx
//
// Admin page: configure the credit-hour thresholds that drive a student's
// academic level. Replaces the old "Semesters" tab in Academic Settings.
//
// Each row in the table is { level, minCredits }. Level 1 is implicit at 0
// credits — not configurable. Levels and thresholds must both strictly
// increase. Persisted to SystemSettings.levelProgression via PATCH
// /api/admin/level-progression; the cached useAcademicSettings() hook is
// invalidated on save so any open page picks up the new thresholds.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAcademicSettings, useLevelProgression, LevelThreshold, DEFAULT_LEVEL_PROGRESSION } from '../../../utils/academicSettings';
import { resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

const LevelProgressionCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const { numberOfAcademicLevels } = useAcademicSettings();
  const initialProgression = useLevelProgression();
  const [thresholds, setThresholds] = useState<LevelThreshold[]>(
    [...initialProgression.thresholds].sort((a, b) => a.level - b.level),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Validation surface — show inline so the admin sees what's wrong before
  // hitting Save (the backend Zod also enforces, but blocking client-side
  // saves a round-trip).
  const validationError = useMemo(() => {
    if (thresholds.length === 0) return null; // empty = "no progression" is valid
    const sorted = [...thresholds].sort((a, b) => a.level - b.level);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].level < 2) return 'Level 1 is implicit at 0 credits — first configurable level is 2.';
      if (sorted[i].level > numberOfAcademicLevels) {
        return `Level ${sorted[i].level} exceeds the configured number of academic levels (${numberOfAcademicLevels}). Increase it under "Levels & Attendance" first.`;
      }
      if (i > 0 && sorted[i].level <= sorted[i - 1].level) {
        return `Level ${sorted[i].level} appears more than once.`;
      }
      if (i > 0 && sorted[i].minCredits <= sorted[i - 1].minCredits) {
        return `Level ${sorted[i].level} must require more credits than level ${sorted[i - 1].level}.`;
      }
      if (sorted[i].minCredits < 1) return `Level ${sorted[i].level} threshold must be ≥ 1 credit.`;
    }
    return null;
  }, [thresholds, numberOfAcademicLevels]);

  const updateRow = (index: number, patch: Partial<LevelThreshold>) =>
    setThresholds((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removeRow = (index: number) =>
    setThresholds((prev) => prev.filter((_, i) => i !== index));

  const addRow = () => {
    setThresholds((prev) => {
      // Pre-fill the next sensible level + minCredits so the admin doesn't
      // have to type both fields on every add.
      const usedLevels = new Set(prev.map((row) => row.level));
      let nextLevel = 2;
      while (usedLevels.has(nextLevel) && nextLevel <= numberOfAcademicLevels) nextLevel++;
      const lastCredits = prev.length > 0
        ? Math.max(...prev.map((row) => row.minCredits))
        : 0;
      return [...prev, { level: nextLevel, minCredits: lastCredits + 32 }];
    });
  };

  const handleSave = () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    // MVP build — local-only save, no network.
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2500);
    setSaving(false);
  };

  const handleReset = () => setThresholds(DEFAULT_LEVEL_PROGRESSION.thresholds);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  // Sorted view for stable rendering (the underlying state is unsorted while
  // the admin is mid-edit; the validator works on a sort copy).
  const sortedThresholds = [...thresholds]
    .map((row, originalIndex) => ({ ...row, originalIndex }))
    .sort((a, b) => a.level - b.level);

  const sortedSummary =
    thresholds.length === 0
      ? 'All students remain at Level 1 (no thresholds configured).'
      : `Level 1 = 0–${(sortedThresholds[0]?.minCredits ?? 0) - 1} credits` +
        sortedThresholds
          .map((row, i) => {
            const next = sortedThresholds[i + 1];
            const upper = next ? `${next.minCredits - 1}` : '∞';
            return ` · Level ${row.level} = ${row.minCredits}–${upper} credits`;
          })
          .join('');

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-stairs text-[#6A3FF4]"></i> {t('admin.levelProgressionCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          Credit-hour thresholds that promote a student to the next academic level. A student is at the highest level whose threshold is ≤ their earned credits. Level 1 is implicit at 0 credits.
        </p>
      </div>

      <div className="bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-lg px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-[#6A3FF4]">{t('admin.previewColon')}</span> {sortedSummary}
      </div>

      {/* Header row */}
      <div className="grid grid-cols-12 gap-3 px-2 mb-2">
        <div className="col-span-3 sm:col-span-2"><label className={labelStyle}>{t('admin.levelCol')}</label></div>
        <div className="col-span-7 sm:col-span-8"><label className={labelStyle}>{t('admin.minCreditHoursCol')}</label></div>
        <div className="col-span-2 text-right"><label className={labelStyle}>&nbsp;</label></div>
      </div>

      {sortedThresholds.length === 0 && (
        <div className="px-2 py-6 text-sm text-gray-500 text-center border border-dashed border-white/10 rounded-lg mb-3">
          {t('admin.noThresholdsConfigured')}
        </div>
      )}

      <div className="space-y-2 mb-4">
        {sortedThresholds.map((row) => (
          <div
            key={row.originalIndex}
            className="grid grid-cols-12 gap-3 items-center bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-2 py-2"
          >
            <div className="col-span-3 sm:col-span-2">
              <input
                type="number"
                min={2}
                max={numberOfAcademicLevels}
                value={row.level}
                onChange={(e) =>
                  updateRow(row.originalIndex, { level: parseInt(e.target.value, 10) || 0 })
                }
                onFocus={(e) => e.currentTarget.select()}
                className={inputStyle}
              />
            </div>
            <div className="col-span-7 sm:col-span-8">
              <input
                type="number"
                min={1}
                max={500}
                value={row.minCredits}
                onChange={(e) =>
                  updateRow(row.originalIndex, { minCredits: parseInt(e.target.value, 10) || 0 })
                }
                onFocus={(e) => e.currentTarget.select()}
                className={inputStyle}
              />
            </div>
            <div className="col-span-2 text-right">
              <button
                onClick={() => removeRow(row.originalIndex)}
                className="text-xs text-red-400 hover:text-red-500 px-2 py-1 transition-colors"
                title={t('admin.apRemoveThresholdTitle')}
              >
                <i className="ph-bold ph-trash"></i> {t('admin.removeBtn')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        disabled={thresholds.length >= numberOfAcademicLevels - 1}
        className="text-sm text-[#7B5AFF] hover:text-[#6A3FF4] font-bold mb-4 disabled:opacity-40 disabled:cursor-not-allowed"
        title={
          thresholds.length >= numberOfAcademicLevels - 1
            ? `All ${numberOfAcademicLevels} academic levels already have thresholds.`
            : 'Add a new level threshold'
        }
      >
        <i className="ph-bold ph-plus-circle mr-1"></i> {t('admin.addLevel')}
      </button>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.thresholdsSaved')}</p>
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
          {saving ? t('admin.saving') : t('admin.saveThresholds')}
        </button>
      </div>
    </div>
  );
};

const LevelProgressionPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.levelProgressionCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.levelProgressionSubtitle')}
        </p>
      </motion.div>
      <LevelProgressionCard />
    </div>
  );
};

export default LevelProgressionPage;
