// src/pages/admin/academic/RepetitionPolicy.tsx
//
// Plan 4 Phase 4 — admin-tunable course repetition policy (FCDS Article 18).
// Knobs:
//   - retakesCountedForGpa (numeric) — within this many retakes only the
//     best passing grade counts.
//   - maxGradeAfterRetake (letter dropdown, populated from gradingRules) —
//     cap the recorded grade on retakes; (no cap) lets retakes earn full A.
//   - maxGradeAppliesToFirstRetakeOnly + preserveOriginalIfHigher checkboxes.
// Live preview block walks the admin through "what would the recorded grade
// be if a student takes this course twice and scores X then Y?".
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { GlassDropdown } from '../../../components/GlassDropdown';
import { useGradingRules } from '../../../utils/gradingRules';
import {
  RepetitionPolicy,
  DEFAULT_REPETITION_POLICY,
  useRepetitionPolicy,
} from '../../../utils/academicSettings';
import { articleHint, resetLabel, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';
import { GlassCheckbox } from '../../../components/GlassCheckbox';

const RepetitionPolicyCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const gradingRules = useGradingRules();
  const initialPolicy = useRepetitionPolicy();
  const [policy, setPolicy] = useState<RepetitionPolicy>(initialPolicy);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Letter cap dropdown — populated from the active grading scale.
  // Non-scoring letters (W, FW, I, etc.) are filtered out.
  const capOptions = useMemo(() => {
    const scoring = gradingRules.scale.filter((r) => !r.nonScoring);
    return [
      { value: '__none__', label: t('admin.repetitionNoCap') },
      ...scoring.map((r) => ({ value: r.letter, label: `${r.letter} (${r.qualityPoints.toFixed(3)} qp)` })),
    ];
  }, [gradingRules, t]);

  const validationError = useMemo(() => {
    if (!Number.isInteger(policy.retakesCountedForGpa) ||
        policy.retakesCountedForGpa < 0 ||
        policy.retakesCountedForGpa > 50) {
      return 'Retakes counted for GPA must be an integer between 0 and 50.';
    }
    if (policy.maxGradeAfterRetake !== null) {
      const valid = gradingRules.scale.some(
        (r) => !r.nonScoring && r.letter === policy.maxGradeAfterRetake,
      );
      if (!valid) return `Cap letter "${policy.maxGradeAfterRetake}" is not in the active scoring scale.`;
    }
    return null;
  }, [policy, gradingRules]);

  // Helpers to format the live preview in plain language.
  const qpFor = (letter: string): number =>
    Number(gradingRules.scale.find((r) => r.letter === letter)?.qualityPoints ?? 0);
  const previewLines = useMemo(() => {
    const cap = policy.maxGradeAfterRetake;
    const lines: string[] = [];

    // Scenario A: 1 retake (D → A on retake)
    if (cap) {
      const recorded = qpFor('A') > qpFor(cap) ? cap : 'A';
      lines.push(
        `A student who failed with D, then scored A on retake #1: recorded grade = ${recorded} ` +
        `(${qpFor(recorded).toFixed(3)} qp/credit). ${recorded !== 'A' ? 'A is capped.' : 'No cap applied.'}`,
      );
    } else {
      lines.push('A student who failed with D, then scored A on retake #1: recorded grade = A (no cap).');
    }

    // Scenario B: 2 retakes with maxGradeAppliesToFirstRetakeOnly
    if (cap && policy.maxGradeAppliesToFirstRetakeOnly) {
      lines.push(
        `On retake #2 (the SECOND retake), the cap does NOT apply — a student scoring A on retake #2 records a full A.`,
      );
    } else if (cap) {
      lines.push(`The cap applies to every retake attempt — retake #2 onward also caps at ${cap}.`);
    }

    // Scenario C: retakesCountedForGpa
    lines.push(
      `Up to ${policy.retakesCountedForGpa} retake${policy.retakesCountedForGpa === 1 ? '' : 's'} ` +
      `(= ${policy.retakesCountedForGpa + 1} total attempts), only the best passing grade counts toward CGPA. ` +
      (policy.countAllAttemptsBeyond
        ? 'Beyond that, every attempt — pass or fail — contributes to CGPA.'
        : 'Beyond that, additional attempts are ignored.'),
    );

    // Scenario D: preserveOriginalIfHigher
    if (policy.preserveOriginalIfHigher) {
      lines.push(`If a retake is WORSE than the original, the original grade keeps its CGPA contribution.`);
    } else {
      lines.push(`Retakes always replace the previous attempt for CGPA purposes — even if worse.`);
    }

    return lines;
    // qpFor reads gradingRules.scale which is already in the dep array; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy, gradingRules]);

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

  const handleReset = () => setPolicy(DEFAULT_REPETITION_POLICY);

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-arrows-counter-clockwise text-[#6A3FF4]"></i> {t('admin.repetitionCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 18, 'Drives how the cumulative GPA treats retaken courses. Per-semester GPAs are unaffected — they always show what was earned that semester.')}
        </p>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-5 text-xs text-gray-600 dark:text-gray-300">
        <i className="ph-bold ph-warning text-amber-300 mr-1.5"></i>
        <strong>{t('admin.repetitionHighBlast')}</strong> Changing these knobs immediately changes every student's recorded CGPA on the next transcript event. Run <code className="px-1 bg-white/10 rounded">node backend/scripts/recompute-cgpa-dryrun.js</code> first to see who would shift.
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div>
          <label className={labelStyle}>{t('admin.repetitionRetakesCounted')}</label>
          <input
            type="number"
            min={0}
            max={50}
            value={policy.retakesCountedForGpa}
            onChange={(e) => setPolicy((p) => ({ ...p, retakesCountedForGpa: parseInt(e.target.value, 10) || 0 }))}
            onFocus={(e) => e.currentTarget.select()}
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-1">{articleHint(institution, 18, 'Default: 8.')}</p>
        </div>
        <div>
          <label className={labelStyle}>{t('admin.repetitionMaxGrade')}</label>
          <GlassDropdown
            value={policy.maxGradeAfterRetake ?? '__none__'}
            onChange={(v) => setPolicy((p) => ({ ...p, maxGradeAfterRetake: v === '__none__' ? null : v }))}
            options={capOptions}
            direction="auto"
            className="w-full"
          />
          <p className="text-[10px] text-gray-500 mt-1">{t('admin.apRepRetakeCapsHint')}</p>
        </div>
      </div>

      <div className="space-y-2 mb-5">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setPolicy((p) => ({ ...p, maxGradeAppliesToFirstRetakeOnly: !p.maxGradeAppliesToFirstRetakeOnly }))}
        >
          <GlassCheckbox
            checked={policy.maxGradeAppliesToFirstRetakeOnly}
            onChange={(v) => setPolicy((p) => ({ ...p, maxGradeAppliesToFirstRetakeOnly: v }))}
            size="sm"
          />
          <span className="text-sm text-black dark:text-white">{t('admin.repetitionFirstRetakeOnly')}</span>
        </div>
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setPolicy((p) => ({ ...p, preserveOriginalIfHigher: !p.preserveOriginalIfHigher }))}
        >
          <GlassCheckbox
            checked={policy.preserveOriginalIfHigher}
            onChange={(v) => setPolicy((p) => ({ ...p, preserveOriginalIfHigher: v }))}
            size="sm"
          />
          <span className="text-sm text-black dark:text-white">{t('admin.repetitionPreserveOriginal')}</span>
        </div>
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setPolicy((p) => ({ ...p, countAllAttemptsBeyond: !p.countAllAttemptsBeyond }))}
        >
          <GlassCheckbox
            checked={policy.countAllAttemptsBeyond}
            onChange={(v) => setPolicy((p) => ({ ...p, countAllAttemptsBeyond: v }))}
            size="sm"
          />
          <span className="text-sm text-black dark:text-white">{articleHint(institution, '18d', 'Count every attempt past the retake cap.')}</span>
        </div>
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => setPolicy((p) => ({ ...p, allowImprovementForProbation: !p.allowImprovementForProbation }))}
        >
          <GlassCheckbox
            checked={policy.allowImprovementForProbation}
            onChange={(v) => setPolicy((p) => ({ ...p, allowImprovementForProbation: v }))}
            size="sm"
          />
          <span className="text-sm text-black dark:text-white">{t('admin.repetitionAllowProbation')}</span>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-4 py-3 mb-5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[#7B5AFF] mb-2 flex items-center gap-2">
          <i className="ph-bold ph-eye"></i> Preview
        </h4>
        <ul className="space-y-1.5 text-xs text-gray-700 dark:text-gray-300 list-disc list-inside">
          {previewLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>

      {validationError && (
        <p className="text-xs text-red-400 mb-3">{validationError}</p>
      )}
      {saveError && !validationError && (
        <p className="text-xs text-red-400 mb-3">{saveError}</p>
      )}
      {saveOk && (
        <p className="text-xs text-emerald-400 mb-3">{t('admin.apRepSavedFlash')}</p>
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

const RepetitionPolicyPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.repetitionCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {articleHint(institution, 18, 'How retakes are counted in CGPA.')}
        </p>
      </motion.div>
      <RepetitionPolicyCard />
    </div>
  );
};

export default RepetitionPolicyPage;
