// src/pages/admin/academic/Prerequisites.tsx
//
// Admin → Academic → Prerequisites. Per-course prerequisite manager.
//
// Two-pane layout: left rail is a searchable course picker; right pane shows
// the current prereq table for the selected course plus an "Add prerequisite"
// form. Adds and removes hit the registration server's
// /api/admin/courses/:code/prerequisites endpoints (already live).
//
// Key behaviours:
//   - The course picker filters case-insensitively on code OR title.
//   - Already-configured prereqs and the course itself are filtered out of
//     the "add" picker so admins can't create duplicates or self-references.
//   - The Min Grade dropdown's empty value means "D — pass" (server stores null).
//   - Toast auto-clears after 2s; error stays until the next successful action.
import { FC, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { GlassDropdown } from '../../../components/GlassDropdown';
import { glassCardStyle } from './_shared';
import { useT } from '../../../i18n';

interface CourseRow {
  id: string;
  code: string;
  title: string;
  level: number | null;
  semester: string | null;
}

interface Prerequisite {
  id: string;
  prerequisiteCourseId: string;
  prerequisiteCourseCode: string | null;
  prerequisiteCourseTitle: string | null;
  minGrade: string | null;
  createdAt: string;
}

// MVP build — inline mock course catalog and per-course prerequisite map.
// No backend; adds/removes mutate local state only.
const MOCK_COURSES: CourseRow[] = [
  { id: 'c-cs101', code: 'CS101', title: 'Introduction to Programming', level: 1, semester: 'Fall' },
  { id: 'c-cs102', code: 'CS102', title: 'Object-Oriented Programming', level: 1, semester: 'Spring' },
  { id: 'c-cs201', code: 'CS201', title: 'Data Structures', level: 2, semester: 'Fall' },
  { id: 'c-cs202', code: 'CS202', title: 'Algorithms', level: 2, semester: 'Spring' },
  { id: 'c-cs301', code: 'CS301', title: 'Database Systems', level: 3, semester: 'Fall' },
  { id: 'c-cs302', code: 'CS302', title: 'Operating Systems', level: 3, semester: 'Spring' },
  { id: 'c-cs401', code: 'CS401', title: 'Software Engineering', level: 4, semester: 'Fall' },
  { id: 'c-ma101', code: 'MA101', title: 'Calculus I', level: 1, semester: 'Fall' },
  { id: 'c-ma102', code: 'MA102', title: 'Calculus II', level: 1, semester: 'Spring' },
  { id: 'c-ma201', code: 'MA201', title: 'Linear Algebra', level: 2, semester: 'Fall' },
  { id: 'c-st201', code: 'ST201', title: 'Probability & Statistics', level: 2, semester: 'Spring' },
];

// courseCode → prereq rows
const MOCK_PREREQS: Record<string, Prerequisite[]> = {
  CS102: [
    {
      id: 'p-1',
      prerequisiteCourseId: 'c-cs101',
      prerequisiteCourseCode: 'CS101',
      prerequisiteCourseTitle: 'Introduction to Programming',
      minGrade: 'C',
      createdAt: '2025-09-01T00:00:00.000Z',
    },
  ],
  CS201: [
    {
      id: 'p-2',
      prerequisiteCourseId: 'c-cs102',
      prerequisiteCourseCode: 'CS102',
      prerequisiteCourseTitle: 'Object-Oriented Programming',
      minGrade: null,
      createdAt: '2025-09-01T00:00:00.000Z',
    },
  ],
  CS202: [
    {
      id: 'p-3',
      prerequisiteCourseId: 'c-cs201',
      prerequisiteCourseCode: 'CS201',
      prerequisiteCourseTitle: 'Data Structures',
      minGrade: 'C',
      createdAt: '2025-09-01T00:00:00.000Z',
    },
  ],
  CS301: [
    {
      id: 'p-4',
      prerequisiteCourseId: 'c-cs201',
      prerequisiteCourseCode: 'CS201',
      prerequisiteCourseTitle: 'Data Structures',
      minGrade: null,
      createdAt: '2025-09-01T00:00:00.000Z',
    },
  ],
};

const GRADE_OPTIONS = [
  { value: '',   label: 'D (default — pass)' },
  { value: 'D',  label: 'D' },
  { value: 'D+', label: 'D+' },
  { value: 'C-', label: 'C-' },
  { value: 'C',  label: 'C' },
  { value: 'C+', label: 'C+' },
  { value: 'B-', label: 'B-' },
  { value: 'B',  label: 'B' },
  { value: 'B+', label: 'B+' },
  { value: 'A-', label: 'A-' },
  { value: 'A',  label: 'A' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return iso; }
}

const PrerequisitesPage: FC = () => {
  const t = useT();
  // ── Course list state ────────────────────────────────────────────────────
  const [courses] = useState<CourseRow[]>(MOCK_COURSES);
  const [coursesLoading] = useState(false);
  const [coursesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // ── Per-selected-course prereq state ────────────────────────────────────
  // Local mutable prereq map keyed by courseCode. Adds/removes mutate this.
  const [prereqMap, setPrereqMap] = useState<Record<string, Prerequisite[]>>(() => ({ ...MOCK_PREREQS }));
  const [prereqsLoading] = useState(false);
  const [prereqsError, setPrereqsError] = useState<string | null>(null);
  const prereqs: Prerequisite[] = useMemo(
    () => (selectedCode ? (prereqMap[selectedCode] ?? []) : []),
    [selectedCode, prereqMap],
  );

  // ── Add-form state ───────────────────────────────────────────────────────
  const [addCourseCode, setAddCourseCode] = useState('');
  const [addMinGrade, setAddMinGrade] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ── Inline UX feedback ──────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Reset add-form state when the user switches courses.
  useEffect(() => {
    setAddCourseCode('');
    setAddMinGrade('');
    setAddError(null);
    setPrereqsError(null);
    setConfirmingId(null);
  }, [selectedCode]);

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

  // Build the add-prereq dropdown options, excluding the current course AND
  // any course already configured as a prereq for it.
  const eligiblePrereqOptions = useMemo(() => {
    if (!selectedCourse) return [{ value: '', label: 'Select a course…' }];
    const taken = new Set(prereqs.map((p) => p.prerequisiteCourseCode));
    const options = courses
      .filter((c) => c.code !== selectedCourse.code && !taken.has(c.code))
      .map((c) => ({
        value: c.code,
        label: `${c.code} — ${c.title}`,
      }));
    return [{ value: '', label: 'Select a course…' }, ...options];
  }, [courses, prereqs, selectedCourse]);

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2000);
  };

  const handleAdd = () => {
    if (!selectedCourse || !addCourseCode) {
      setAddError('Please choose a prerequisite course.');
      return;
    }
    setAddError(null);
    setAdding(true);
    // MVP build — local-only add, no network.
    const prereqCourse = courses.find((c) => c.code === addCourseCode) ?? null;
    const created: Prerequisite = {
      id: `p-${Date.now()}`,
      prerequisiteCourseId: prereqCourse?.id ?? addCourseCode,
      prerequisiteCourseCode: addCourseCode,
      prerequisiteCourseTitle: prereqCourse?.title ?? null,
      minGrade: addMinGrade || null,
      createdAt: new Date().toISOString(),
    };
    const code = selectedCourse.code;
    setPrereqMap((prev) => ({ ...prev, [code]: [created, ...(prev[code] ?? [])] }));
    setAddCourseCode('');
    setAddMinGrade('');
    flashToast('Added');
    setAdding(false);
  };

  const handleRemove = (prereqId: string) => {
    if (!selectedCourse) return;
    // MVP build — local-only remove, no network.
    const code = selectedCourse.code;
    setPrereqMap((prev) => ({
      ...prev,
      [code]: (prev[code] ?? []).filter((p) => p.id !== prereqId),
    }));
    setConfirmingId(null);
    flashToast('Removed');
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.prereqTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.prereqSubtitle')}
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
                      <div className="flex items-center gap-1">
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
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{c.title}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right pane: prereq table + add form ─────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedCourse ? (
            <div className={`${glassCardStyle} p-12 text-center`}>
              <i className="ph-bold ph-arrow-left text-3xl text-gray-500 mb-3 block" />
              <p className="text-gray-500 dark:text-gray-400">
                {t('admin.prereqSelectCourse')}
              </p>
            </div>
          ) : (
            <>
              <div className={`${glassCardStyle} p-6`}>
                <h2 className="text-lg font-bold text-black dark:text-white">
                  {t('admin.prereqForHeading', { code: selectedCourse.code, title: selectedCourse.title })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">
                  {t('admin.apPrereqMustPass')}
                </p>

                {prereqsError && (
                  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    <i className="ph-bold ph-warning-circle mr-2" /> {prereqsError}
                  </div>
                )}

                {prereqsLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
                    ))}
                  </div>
                ) : prereqs.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
                    {t('admin.apPrereqNoneConfigured', { code: selectedCourse.code })}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 uppercase border-b border-white/10">
                          <th className="text-left py-2 px-2 font-semibold">{t('admin.codeCol')}</th>
                          <th className="text-left py-2 px-2 font-semibold">{t('admin.titleCol')}</th>
                          <th className="text-left py-2 px-2 font-semibold">{t('admin.minGradeCol')}</th>
                          <th className="text-left py-2 px-2 font-semibold">{t('admin.addedCol')}</th>
                          <th className="text-right py-2 px-2 font-semibold">{t('admin.actionCol')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prereqs.map((p) => (
                          <tr key={p.id} className="border-b border-white/5 last:border-b-0">
                            <td className="py-3 px-2 font-bold text-black dark:text-white">
                              {p.prerequisiteCourseCode ?? '—'}
                            </td>
                            <td className="py-3 px-2 text-gray-700 dark:text-gray-300">
                              {p.prerequisiteCourseTitle ?? '—'}
                            </td>
                            <td className="py-3 px-2 text-gray-700 dark:text-gray-300">
                              {p.minGrade ? p.minGrade : <span className="text-gray-500">{t('admin.apPrereqDPass')}</span>}
                            </td>
                            <td className="py-3 px-2 text-gray-500 text-xs">{formatDate(p.createdAt)}</td>
                            <td className="py-3 px-2 text-right">
                              {confirmingId === p.id ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className="text-xs text-gray-400">{t('admin.removeQ')}</span>
                                  <button
                                    onClick={() => handleRemove(p.id)}
                                    className="text-xs px-2 py-1 rounded bg-red-500/80 hover:bg-red-500 text-white"
                                  >
                                    {t('admin.yesBtn')}
                                  </button>
                                  <button
                                    onClick={() => setConfirmingId(null)}
                                    className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-gray-300"
                                  >
                                    {t('admin.cancelBtn')}
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmingId(p.id)}
                                  className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                                  title={t('admin.apRemovePrereqTitle')}
                                >
                                  <i className="ph-bold ph-trash text-lg" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-base font-bold text-black dark:text-white">{t('admin.addPrereq')}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
                  Pick a course and the minimum grade students must earn to satisfy it.
                </p>

                {addError && (
                  <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    <i className="ph-bold ph-warning-circle mr-2" /> {addError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t('admin.prereqCourseLbl')}
                    </label>
                    <GlassDropdown
                      value={addCourseCode}
                      onChange={setAddCourseCode}
                      options={eligiblePrereqOptions}
                      direction="auto"
                      className="w-full"
                    />
                  </div>
                  <div className="w-full sm:w-48">
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t('admin.minGradeLbl')}
                    </label>
                    <GlassDropdown
                      value={addMinGrade}
                      onChange={setAddMinGrade}
                      options={GRADE_OPTIONS}
                      direction="auto"
                      className="w-full"
                    />
                  </div>
                  <button
                    onClick={handleAdd}
                    disabled={adding || !addCourseCode}
                    className="px-6 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {adding ? t('admin.adding') : t('admin.addBtn')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PrerequisitesPage;
