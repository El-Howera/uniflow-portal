// src/pages/admin/academic/LevelsAndAttendance.tsx
//
// Top-level "Academic → Levels & Attendance" page. Lifts the
// LevelsAndAttendanceCard component out of the old admin Settings → Academic
// tab into its own page. Pure refactor — no new behavior.
import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { articleHint, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle, inputStyle } from './_shared';

interface AttendanceRulesShape {
  minAttendancePercent: number;
  warnAbsencePercents: number[];
  failAbsencePercent: number;
  barredGradeLetter: string;
  practicalOnly: boolean;
}

const DEFAULT_ATTENDANCE_RULES: AttendanceRulesShape = {
  minAttendancePercent: 75,
  warnAbsencePercents: [15, 20],
  failAbsencePercent: 25,
  barredGradeLetter: 'FW',
  practicalOnly: false,
};

const LevelsAndAttendanceCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [levels, setLevels] = useState<number>(4);
  const [rules, setRules] = useState<AttendanceRulesShape>(DEFAULT_ATTENDANCE_RULES);
  const [warnRaw, setWarnRaw] = useState<string>(
    DEFAULT_ATTENDANCE_RULES.warnAbsencePercents.join(', '),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    setSaving(true);
    setSaved(false);
    // Parse comma-separated warning thresholds: "15, 20" → [15, 20].
    const parsedWarns = warnRaw
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100)
      .sort((a, b) => a - b);
    if (parsedWarns.length === 0) {
      setError(t('admin.laWarnRequired'));
      setSaving(false);
      return;
    }
    if (rules.failAbsencePercent <= parsedWarns[parsedWarns.length - 1]) {
      setError(t('admin.laFailGtWarn'));
      setSaving(false);
      return;
    }
    if (levels < 1 || levels > 12) {
      setError(t('admin.laLevelsRange'));
      setSaving(false);
      return;
    }

    // MVP build — local-only save, no network.
    setRules((r) => ({ ...r, warnAbsencePercents: parsedWarns }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    setSaving(false);
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-black dark:text-white flex items-center">
          <i className="ph-bold ph-stack mr-2 text-[#6A3FF4]"></i> {t('admin.levelsAttCardTitle')}
        </h3>
        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">
          {articleHint(institution, 16, 'Drives level chips across the app and the warning / barred attendance thresholds. Every tenant can override.')}
        </p>
      </div>

      {/* Academic levels */}
      <div className="mb-5">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
          {t('admin.numberOfAcademicLevels')}
        </label>
        <input
          type="number"
          min="1"
          max="12"
          value={levels}
          onChange={(e) => setLevels(parseInt(e.target.value, 10) || levels)}
          onFocus={(e) => e.currentTarget.select()}
          className={inputStyle}
        />
        <p className="text-[11px] text-gray-500 mt-1">
          {t('admin.laLevelsExample')}
        </p>
      </div>

      {/* Attendance rules */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
          <i className="ph-bold ph-calendar-check text-[#6A3FF4]"></i> {t('admin.attendanceRegulations')}
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              {t('admin.minRequiredAttPct')}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={rules.minAttendancePercent}
              onChange={(e) => setRules((r) => ({ ...r, minAttendancePercent: parseFloat(e.target.value) || 0 }))}
              onFocus={(e) => e.currentTarget.select()}
              className={inputStyle}
            />
            <p className="text-[10px] text-gray-500 mt-0.5">{t('admin.laMinAttDefault')}</p>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              {t('admin.failBarredPct')}
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={rules.failAbsencePercent}
              onChange={(e) => setRules((r) => ({ ...r, failAbsencePercent: parseFloat(e.target.value) || 0 }))}
              onFocus={(e) => e.currentTarget.select()}
              className={inputStyle}
            />
            <p className="text-[10px] text-gray-500 mt-0.5">{t('admin.laFailDefault')}</p>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
            {t('admin.warningThresholdsLbl')}
          </label>
          <input
            type="text"
            value={warnRaw}
            onChange={(e) => setWarnRaw(e.target.value)}
            placeholder="15, 20"
            className={inputStyle}
          />
          <p className="text-[10px] text-gray-500 mt-0.5">
            {t('admin.laWarnHintPre')} <code>15, 20</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              {t('admin.barredGradeLetter')}
            </label>
            <input
              type="text"
              maxLength={4}
              value={rules.barredGradeLetter}
              onChange={(e) => setRules((r) => ({ ...r, barredGradeLetter: e.target.value.toUpperCase() }))}
              onFocus={(e) => e.currentTarget.select()}
              className={inputStyle}
            />
            <p className="text-[10px] text-gray-500 mt-0.5">{t('admin.laBarredDefaultPre')} <code>FW</code> {t('admin.laBarredDefaultPost')}</p>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              {t('admin.practicalOnly')}
            </label>
            <button
              type="button"
              onClick={() => setRules((r) => ({ ...r, practicalOnly: !r.practicalOnly }))}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm border transition-colors ${
                rules.practicalOnly
                  ? 'bg-[#6A3FF4]/15 border-[#6A3FF4]/30 text-[#7B5AFF]'
                  : 'bg-white/5 dark:bg-black/10 border-white/10 dark:border-white/5 text-black dark:text-white'
              }`}
            >
              <span>{rules.practicalOnly ? t('admin.practicalYes') : t('admin.practicalNo')}</span>
              <i className={`ph-bold ${rules.practicalOnly ? 'ph-check-square' : 'ph-square'} text-base`} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        {saved && <span className="text-green-400 text-xs">{t('admin.savedFlash')}</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 rounded-xl bg-[#6A3FF4] text-white font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? t('admin.saving') : t('admin.savePolicy')}
        </button>
      </div>
    </div>
  );
};

const LevelsAndAttendancePage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.levelsAttCardTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.levelsAttSubtitle')}</p>
      </motion.div>
      <LevelsAndAttendanceCard />
    </div>
  );
};

export default LevelsAndAttendancePage;
