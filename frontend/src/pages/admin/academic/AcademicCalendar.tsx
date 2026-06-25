// src/pages/admin/academic/AcademicCalendar.tsx
//
// Top-level "Academic → Academic Calendar" page. Lifts the
// AcademicCalendarSettingsCard component out of the old admin Settings →
// Academic tab into its own page. Pure refactor — no new behavior.
import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { glassCardStyle, inputStyle } from './_shared';
import { useT } from '../../../i18n';

/* ─── Academic Calendar Settings Card (preview mockup) ───────────────────────
 * MVP build — no backend. Form is seeded from sensible FCDS defaults and
 * edits are local-only.
 *   - currentSemester / academicYear: "current term" labels
 *   - holidays: array of { date: 'YYYY-MM-DD', label: string } — add/remove inline
 */
interface Holiday { date: string; label: string }

const MOCK_CURRENT_SEMESTER = 'Fall';
const MOCK_ACADEMIC_YEAR = '2026/2027';
const MOCK_HOLIDAYS: Holiday[] = [
  { date: '2026-10-06', label: 'Armed Forces Day' },
  { date: '2026-12-25', label: 'Mid-Year Break' },
  { date: '2027-01-07', label: 'Coptic Christmas' },
];

const AcademicCalendarSettingsCard: FC = () => {
  const t = useT();
  const [currentSemester, setCurrentSemester] = useState(MOCK_CURRENT_SEMESTER);
  const [academicYear, setAcademicYear] = useState(MOCK_ACADEMIC_YEAR);
  const [holidays, setHolidays] = useState<Holiday[]>(
    [...MOCK_HOLIDAYS].sort((a, b) => a.date.localeCompare(b.date)),
  );
  const [newDate, setNewDate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = false;

  const addHoliday = () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError(t('admin.acDateFmtErr'));
      return;
    }
    if (!newLabel.trim()) {
      setError(t('admin.acLabelRequired'));
      return;
    }
    setHolidays((prev) =>
      [...prev.filter((h) => h.date !== newDate), { date: newDate, label: newLabel.trim() }].sort(
        (a, b) => a.date.localeCompare(b.date)
      )
    );
    setNewDate('');
    setNewLabel('');
  };

  const removeHoliday = (date: string) => {
    setHolidays((prev) => prev.filter((h) => h.date !== date));
  };

  const handleSave = () => {
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <h3 className="text-lg font-bold text-black dark:text-white flex items-center">
        <i className="ph-bold ph-calendar-blank mr-2 text-[#6A3FF4]"></i> {t('admin.academicCalendarCardTitle')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">
        {t('admin.acCardDesc')}
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse h-40 rounded-xl bg-white/5"></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('admin.currentSemesterLbl')}</label>
              <input
                value={currentSemester}
                onChange={(e) => setCurrentSemester(e.target.value)}
                placeholder={t('admin.acCurSemPh')}
                className={inputStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('admin.academicYearLbl')}</label>
              <input
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                placeholder={t('admin.acAcadYearPh')}
                className={inputStyle}
              />
            </div>
          </div>

          <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            {t('admin.universityHolidays')}
          </h4>
          <div className="rounded-xl border border-white/10 mb-3 max-h-48 overflow-y-auto">
            {holidays.length === 0 ? (
              <p className="text-xs text-gray-500 italic px-4 py-3">{t('admin.noHolidaysDefined')}</p>
            ) : (
              holidays.map((h) => (
                <div
                  key={h.date}
                  className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-b-0 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-[#6A3FF4] flex-shrink-0">{h.date}</span>
                    <span className="text-black dark:text-white truncate">{h.label}</span>
                  </div>
                  <button
                    onClick={() => removeHoliday(h.date)}
                    className="text-red-400 hover:text-red-300 flex-shrink-0"
                    title={t('admin.acRemoveHoliday', { label: h.label })}
                  >
                    <i className="ph-bold ph-x text-base"></i>
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-[140px_1fr_auto] gap-2 mb-5">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className={inputStyle}
            />
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t('admin.holidayNamePh')}
              className={inputStyle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addHoliday();
              }}
            />
            <button
              onClick={addHoliday}
              className="px-4 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white text-sm hover:bg-white/10 transition-colors"
            >
              <i className="ph-bold ph-plus"></i>
            </button>
          </div>

          <button
            onClick={handleSave}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
          >
            {saved ? t('admin.savedFlash') : t('admin.acUpdateBtn')}
          </button>
        </>
      )}
    </div>
  );
};

const AcademicCalendarPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.academicCalendarTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.academicCalendarSubtitle')}</p>
      </motion.div>
      <AcademicCalendarSettingsCard />
    </div>
  );
};

export default AcademicCalendarPage;
