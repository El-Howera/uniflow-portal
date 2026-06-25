// src/pages/admin/academic/CourseConfigurations.tsx
//
// Top-level "Academic → Course Configurations" page. Lifts the
// CourseConfigurationsCard component out of the old admin Settings → Academic
// tab into its own page. Pure refactor — no new behavior.
import { FC, useState } from 'react';
import { motion } from 'framer-motion';
import { useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle, inputStyle } from './_shared';

/* ─── Course Configurations Card (preview mockup) ─────────────────────────────
 * MVP build — no backend. Seeded with sensible FCDS defaults; edits are
 * local-only.
 *   - courseCodePattern: course-code validation regex
 *   - defaultSectionCapacity: fallback section capacity
 *   - requirePrerequisites: prerequisite-gate toggle
 */
const MOCK_PATTERN = '^[A-Z]{2,4}[0-9]{3}$';
const MOCK_DEFAULT_CAPACITY = 30;
const MOCK_REQUIRE_PREREQS = true;

const CourseConfigurationsCard: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [pattern, setPattern] = useState(MOCK_PATTERN);
  const [defaultCapacity, setDefaultCapacity] = useState(MOCK_DEFAULT_CAPACITY);
  const [requirePrereqs, setRequirePrereqs] = useState(MOCK_REQUIRE_PREREQS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = false;

  // Lightweight regex validation so admins don't save a broken pattern.
  const patternValid = (() => {
    try { new RegExp(pattern); return true; } catch { return false; }
  })();

  // Sample-test the pattern against a typical course code so the admin can
  // see at a glance whether their regex matches the format they expect.
  const sampleMatch = (() => {
    if (!patternValid) return null;
    try { return new RegExp(pattern).test('CS101'); } catch { return null; }
  })();

  const handleSave = () => {
    setError(null);
    if (!patternValid) {
      setError('Course code pattern is not a valid regular expression.');
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={`${glassCardStyle} p-6`}>
      <h3 className="text-lg font-bold text-black dark:text-white flex items-center">
        <i className="ph-bold ph-gear mr-2 text-[#6A3FF4]"></i> {t('admin.courseConfigTitle')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">
        {t('admin.courseConfigDesc')} <strong>{t('admin.apGradingConfigBold')}</strong>.
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
          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">
              {t('admin.courseCodePatternField')}
            </label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className={`${inputStyle} font-mono text-xs ${!patternValid ? 'border-red-500/40' : ''}`}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Validated on every <code>POST /api/admin/courses</code>.
              {patternValid ? (
                sampleMatch ? (
                  <span className="ml-1 text-green-400">{t('admin.sampleMatches')}</span>
                ) : (
                  <span className="ml-1 text-yellow-400">{t('admin.sampleNoMatch')}</span>
                )
              ) : (
                <span className="ml-1 text-red-400">{t('admin.notValidRegex')}</span>
              )}
            </p>
            {/* Plan 4 Phase 9 — FCDS Article 4 reference */}
            <p className="text-[11px] text-gray-500 mt-1">
              <i className="ph-bold ph-info text-[#7B5AFF] mr-1"></i>
              <strong>{institution.articleRefsVisible ? `${institution.regulatoryFramework} Article 4 example` : 'Example'}:</strong> codes are written in the form{' '}
              <code>CC-DD-PPPLL</code> (college · department · program-level), e.g. <code>02-24-CSC101</code>.
              Adjust the regex above for the format your institution uses.
            </p>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">
              {t('admin.defaultSectionCapacity')}
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={defaultCapacity}
              onChange={(e) => setDefaultCapacity(Number(e.target.value))}
              className={inputStyle}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              {t('admin.apCourseSectionDefaultSeats')} <code>CourseSection</code>{t('admin.apCourseSectionDefaultSeatsEnd')}
            </p>
          </div>

          <div className="mb-5 flex items-start gap-3 p-3 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10">
            <button
              onClick={() => setRequirePrereqs((v) => !v)}
              className={`mt-0.5 w-9 h-5 rounded-full p-0.5 transition-colors flex-shrink-0 ${
                requirePrereqs ? 'bg-[#6A3FF4]' : 'bg-gray-400/40'
              }`}
              role="switch"
              aria-checked={requirePrereqs}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full transition-transform ${
                  requirePrereqs ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <div>
              <h4 className="text-sm font-medium text-black dark:text-white">{t('admin.enforcePrereqs')}</h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {t('admin.enforcePrereqsDesc')}
              </p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!patternValid}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
          >
            {saved ? t('admin.savedFlash') : t('admin.updateSettings')}
          </button>
        </>
      )}
    </div>
  );
};

const CourseConfigurationsPage: FC = () => {
  const t = useT();
  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.courseConfigTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('admin.courseConfigSubtitle')}</p>
      </motion.div>
      <CourseConfigurationsCard />
    </div>
  );
};

export default CourseConfigurationsPage;
