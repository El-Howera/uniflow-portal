// src/pages/admin/academic/CourseRules.tsx
//
// Admin → Academic → Course Rules. Per-course level + semester editor.
//
// Two-pane layout (mirrors Prerequisites): left rail = searchable course
// picker; right pane = a small form for the selected course's `level` and
// `semester`. PATCHes /api/admin/courses/:code/rules.
//
// Behaviours worth noting:
//   - The level dropdown is built from `useAcademicSettings().numberOfAcademicLevels`
//     so the option count tracks the institution's configured level count.
//   - Form resets to the saved values when the user switches courses.
//   - Save is disabled until at least one field changed vs the loaded values.
//   - On a successful save we update the local course list so the chips on
//     the left rail stay in sync (no full re-fetch needed).
import { FC, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { GlassDropdown } from '../../../components/GlassDropdown';
import { useAcademicSettings } from '../../../utils/academicSettings';
import { articleHint, useInstitutionConfig } from '../../../config/institutionConfig';
import { useT } from '../../../i18n';
import { glassCardStyle } from './_shared';

interface CourseRow {
  id: string;
  code: string;
  title: string;
  level: number | null;
  semester: string | null;
  // Plan 4 Phase 2 — language / category are admin-tunable per course.
  // `language` defaults to "en". Program affiliation was rolled into the
  // existing department (the 6 FCDS programs are departments).
  language: string;
  category: string | null;
}

// MVP build — no backend. Inline catalog seeds the picker + rules form.
const MOCK_COURSES: CourseRow[] = [
  { id: 'c1', code: 'CSC101', title: 'Introduction to Computer Science', level: 1, semester: 'Fall',   language: 'en', category: 'faculty_compulsory' },
  { id: 'c2', code: 'CSC102', title: 'Structured Programming',           level: 1, semester: 'Spring', language: 'en', category: 'faculty_compulsory' },
  { id: 'c3', code: 'MAT111', title: 'Calculus I',                       level: 1, semester: 'Fall',   language: 'en', category: 'university' },
  { id: 'c4', code: 'CSC201', title: 'Data Structures',                  level: 2, semester: 'Fall',   language: 'en', category: 'program_compulsory' },
  { id: 'c5', code: 'CSC205', title: 'Database Systems',                 level: 2, semester: 'Spring', language: 'en', category: 'program_compulsory' },
  { id: 'c6', code: 'DSC301', title: 'Machine Learning',                 level: 3, semester: null,     language: 'en', category: 'program_elective' },
  { id: 'c7', code: 'CYS310', title: 'Network Security',                 level: 3, semester: 'Fall',   language: 'ar', category: 'program_compulsory' },
  { id: 'c8', code: 'CSC400', title: 'Graduation Project',              level: 4, semester: null,     language: 'en', category: 'training' },
];

// Note: SEMESTER_OPTIONS labels are translated at use-site since they need the t() hook.

// Plan 4 Phase 2 — language and category use closed taxonomies
// (see backend/lib/course-taxonomy.js).
const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
];

const CATEGORY_OPTIONS = [
  { value: '',                   label: 'No category' },
  { value: 'university',         label: 'University Requirement' },
  { value: 'faculty_compulsory', label: 'Faculty Compulsory' },
  { value: 'faculty_elective',   label: 'Faculty Elective' },
  { value: 'program_compulsory', label: 'Programme Compulsory' },
  { value: 'program_elective',   label: 'Programme Elective' },
  { value: 'training',           label: 'Field Training' },
];

const CourseRulesPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const { numberOfAcademicLevels } = useAcademicSettings();

  const SEMESTER_OPTIONS = [
    { value: '',       label: t('admin.semAllSemesters') },
    { value: 'Fall',   label: t('admin.semFallOnly') },
    { value: 'Spring', label: t('admin.semSpringOnly') },
    { value: 'Summer', label: t('admin.semSummerOnly') },
  ];

  // ── Course list state ────────────────────────────────────────────────────
  const [courses, setCourses] = useState<CourseRow[]>(MOCK_COURSES);
  const coursesLoading = false;
  const coursesError = null;
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // ── Form state — empty string in the dropdown means "no requirement" ────
  const [formLevel, setFormLevel] = useState<string>('');
  const [formSemester, setFormSemester] = useState<string>('');
  const [savedLevel, setSavedLevel] = useState<string>('');
  const [savedSemester, setSavedSemester] = useState<string>('');
  // Plan 4 Phase 2 — language / category per course.
  const [formLanguage, setFormLanguage] = useState<string>('en');
  const [formCategory, setFormCategory] = useState<string>('');
  const [savedLanguage, setSavedLanguage] = useState<string>('en');
  const [savedCategory, setSavedCategory] = useState<string>('');

  // ── Save UX ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Reset form to the saved values whenever the selected course changes.
  useEffect(() => {
    if (!selectedCode) {
      setFormLevel(''); setFormSemester('');
      setSavedLevel(''); setSavedSemester('');
      setFormLanguage('en'); setFormCategory('');
      setSavedLanguage('en'); setSavedCategory('');
      setSaveError(null);
      return;
    }
    const c = courses.find((x) => x.code === selectedCode);
    const lvl = c?.level !== null && c?.level !== undefined ? String(c.level) : '';
    const sem = c?.semester ?? '';
    const lang = c?.language ?? 'en';
    const cat = c?.category ?? '';
    setFormLevel(lvl);
    setFormSemester(sem);
    setFormLanguage(lang);
    setFormCategory(cat);
    setSavedLevel(lvl);
    setSavedSemester(sem);
    setSavedLanguage(lang);
    setSavedCategory(cat);
    setSaveError(null);
  }, [selectedCode, courses]);

  const filteredCourses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) => c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
    );
  }, [courses, search]);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.code === selectedCode) ?? null,
    [courses, selectedCode],
  );

  const levelOptions = useMemo(() => {
    const max = Math.max(1, Math.floor(numberOfAcademicLevels || 4));
    const opts = [{ value: '', label: t('admin.noLevelReq') }];
    for (let i = 1; i <= max; i++) {
      opts.push({ value: String(i), label: t('admin.levelN', { n: i }) });
    }
    return opts;
  }, [numberOfAcademicLevels, t]);

  const dirty =
    formLevel !== savedLevel ||
    formSemester !== savedSemester ||
    formLanguage !== savedLanguage ||
    formCategory !== savedCategory;

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((prev) => (prev === msg ? null : prev)), 2000);
  };

  // MVP build — no backend. Apply the change to local state only.
  const handleSave = () => {
    if (!selectedCourse || !dirty) return;
    setSaving(true);
    setSaveError(null);

    const newLevel: number | null = formLevel === '' ? null : Number(formLevel);
    const newSemester: string | null = formSemester === '' ? null : formSemester;
    const newCategory: string | null = formCategory === '' ? null : formCategory;

    // Sync the local course list so left-rail chips refresh.
    setCourses((prev) =>
      prev.map((c) =>
        c.code === selectedCourse.code
          ? {
              ...c,
              level: newLevel,
              semester: newSemester,
              language: formLanguage,
              category: newCategory,
            }
          : c,
      ),
    );
    setSavedLevel(formLevel);
    setSavedSemester(formSemester);
    setSavedLanguage(formLanguage);
    setSavedCategory(formCategory);
    flashToast('Saved');
    setSaving(false);
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.courseDetailsTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.courseRulesSubtitle')}
        </p>
      </motion.div>

      {toast && (
        <div className="fixed top-24 right-4 z-50 px-4 py-2 rounded-xl bg-green-500/90 text-white text-sm font-medium shadow-lg">
          <i className="ph-bold ph-check-circle mr-1.5" /> {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left rail: course picker ─────────────────────────────────── */}
        <div className={`${glassCardStyle} p-4 lg:col-span-1`}>
          <div className="relative mb-3">
            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.searchCodeOrTitle')}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
            />
          </div>

          {coursesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : coursesError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <i className="ph-bold ph-warning-circle mr-2" /> {coursesError}
            </div>
          ) : filteredCourses.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-6">{t('admin.apNoCoursesMatch')}</p>
          ) : (
            <div className="max-h-[640px] overflow-y-auto space-y-1 pr-1">
              {filteredCourses.map((c) => {
                const isActive = c.code === selectedCode;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCode(c.code)}
                    className={`w-full text-left p-3 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-[#6A3FF4]/15 border-l-2 border-[#6A3FF4]'
                        : 'hover:bg-white/5 dark:hover:bg-black/20 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-black dark:text-white">{c.code}</span>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {c.level !== null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400">
                            Lvl {c.level}
                          </span>
                        )}
                        {c.semester && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6A3FF4]/20 text-[#7B5AFF]">
                            {c.semester}
                          </span>
                        )}
                        {c.language === 'ar' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            AR
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{c.title}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right pane: rules form ───────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedCourse ? (
            <div className={`${glassCardStyle} p-12 text-center`}>
              <i className="ph-bold ph-arrow-left text-3xl text-gray-500 mb-3 block" />
              <p className="text-gray-500 dark:text-gray-400">
                Select a course on the left to edit its registration rules.
              </p>
            </div>
          ) : (
            <div className={`${glassCardStyle} p-6`}>
              <h2 className="text-lg font-bold text-black dark:text-white">
                Rules for {selectedCourse.code} — {selectedCourse.title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-6">
                Required academic level and semester offering. These rules gate student registration.
              </p>

              {saveError && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <i className="ph-bold ph-warning-circle mr-2" /> {saveError}
                </div>
              )}

              {/* Academic Level */}
              <div className="mb-6">
                <h3 className="text-sm font-bold text-black dark:text-white flex items-center mb-2">
                  <i className="ph-bold ph-stack mr-2 text-[#6A3FF4]" /> {t('admin.academicLevelLbl')}
                </h3>
                <GlassDropdown
                  value={formLevel}
                  onChange={setFormLevel}
                  options={levelOptions}
                  direction="auto"
                  className="w-full sm:w-72"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Students below this level will need Student Affairs approval to register.
                </p>
              </div>

              {/* Semester Lock */}
              <div className="mb-6">
                <h3 className="text-sm font-bold text-black dark:text-white flex items-center mb-2">
                  <i className="ph-bold ph-calendar mr-2 text-[#6A3FF4]" /> {t('admin.semesterLockLbl')}
                </h3>
                <GlassDropdown
                  value={formSemester}
                  onChange={setFormSemester}
                  options={SEMESTER_OPTIONS}
                  direction="auto"
                  className="w-full sm:w-72"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  When set, the course is hidden from students except in the matching semester.
                </p>
              </div>

              {/* Plan 4 Phase 2 — language (Article 7), category (Articles
                  30/31), and program affiliation (Article 1). All three are
                  surfaced as chips on the student catalog cards. */}
              <div className="mb-6">
                <h3 className="text-sm font-bold text-black dark:text-white flex items-center mb-2">
                  <i className="ph-bold ph-translate mr-2 text-[#6A3FF4]" /> {t('admin.instructionLang')}
                </h3>
                <GlassDropdown
                  value={formLanguage}
                  onChange={setFormLanguage}
                  options={LANGUAGE_OPTIONS}
                  direction="auto"
                  className="w-full sm:w-72"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {articleHint(institution, 7, 'Default is English; courses approved for Arabic instruction set this to Arabic.')}
                </p>
              </div>

              <div className="mb-6">
                <h3 className="text-sm font-bold text-black dark:text-white flex items-center mb-2">
                  <i className="ph-bold ph-tag mr-2 text-[#6A3FF4]" /> {t('admin.courseCategoryLbl')}
                </h3>
                <GlassDropdown
                  value={formCategory}
                  onChange={setFormCategory}
                  options={CATEGORY_OPTIONS}
                  direction="auto"
                  className="w-full sm:w-72"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {articleHint(institution, '30 & 31', 'Faculty Compulsory & Faculty Elective. Drives how the course counts toward graduation totals.')}
                </p>
              </div>

              {/* Plan 4 Phase 2 follow-up — the "Program Affiliation" picker
                  was removed when programs were merged into departments.
                  Use Manage Courses to set a course's department; the 6 FCDS
                  programs (codes 01–06) are now department rows. */}

              <div className="flex justify-end pt-2 border-t border-white/10">
                <button
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="px-6 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? t('admin.saving') : t('admin.saveChangesPolicy')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CourseRulesPage;
