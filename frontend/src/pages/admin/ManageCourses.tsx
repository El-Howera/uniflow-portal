// src/pages/admin/ManageCourses.tsx
import { FC, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { motion, AnimatePresence } from 'framer-motion';
import { useHasPermission } from '../../utils/permissions';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const inputStyle = "w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400";

interface Course {
  id: string;
  code: string;
  title: string;
  instructor: string;
  credits: number;
  semester: string;
  enrolled: number;
  status: 'Active' | 'Inactive';
  departmentId?: string | null;
  departmentName?: string | null;
  // Cross-listed (extra) departments that can see this course beyond the
  // primary owner above. Sourced from CourseDepartment M:N rows.
  crossListedDepartments?: { id: string; code?: string | null; name: string }[];
}
interface Department { id: string; code?: string | null; name: string }

// Shape from /api/admin/registration-periods. Course.semester is a free-text
// string (e.g. "Fall 2025"). We filter by matching it against the period's
// semesterRef.name (the canonical semester label) or the period's own name
// when there's no Semester record linked.
interface RegistrationPeriod {
  id: string;
  name: string;
  isActive: boolean;
  semesterRef?: { id: string; name: string; academicYear?: string | null } | null;
}

// ─── Preview mock data ─────────────────────────────────────────────────────────
const MOCK_DEPARTMENTS: Department[] = [
  { id: 'dept-cs', code: 'CS', name: 'Computer Science' },
  { id: 'dept-ds', code: 'DS', name: 'Data Science' },
  { id: 'dept-ma', code: 'MA', name: 'Mathematics' },
  { id: 'dept-cy', code: 'CY', name: 'Cybersecurity' },
];

const MOCK_PERIODS: RegistrationPeriod[] = [
  { id: 'p-spring-2026', name: 'Spring 2026 Registration Period', isActive: true, semesterRef: { id: 's-spring-2026', name: 'Spring 2026', academicYear: '2025/2026' } },
  { id: 'p-fall-2025', name: 'Fall 2025 Registration Period', isActive: false, semesterRef: { id: 's-fall-2025', name: 'Fall 2025', academicYear: '2025/2026' } },
];

const MOCK_COURSES: Course[] = [
  { id: 'c-cs101', code: 'CS101', title: 'Introduction to Computer Science', instructor: 'Dr. Fares Howera', credits: 3, semester: 'Spring 2026', enrolled: 42, status: 'Active', departmentId: 'dept-cs', departmentName: 'Computer Science', crossListedDepartments: [] },
  { id: 'c-cs102', code: 'CS102', title: 'Programming Fundamentals', instructor: 'Dr. Hala Mansour', credits: 4, semester: 'Spring 2026', enrolled: 38, status: 'Active', departmentId: 'dept-cs', departmentName: 'Computer Science', crossListedDepartments: [] },
  { id: 'c-cs201', code: 'CS201', title: 'Data Structures & Algorithms', instructor: 'Dr. Tamer Fouad', credits: 4, semester: 'Spring 2026', enrolled: 31, status: 'Active', departmentId: 'dept-cs', departmentName: 'Computer Science', crossListedDepartments: [{ id: 'dept-ds', code: 'DS', name: 'Data Science' }] },
  { id: 'c-cs305', code: 'CS305', title: 'Database Systems', instructor: 'Dr. Nabil Aziz', credits: 3, semester: 'Spring 2026', enrolled: 27, status: 'Active', departmentId: 'dept-cs', departmentName: 'Computer Science', crossListedDepartments: [] },
  { id: 'c-ds210', code: 'DS210', title: 'Statistical Foundations of Data Science', instructor: 'Dr. Rania Kamel', credits: 3, semester: 'Spring 2026', enrolled: 24, status: 'Active', departmentId: 'dept-ds', departmentName: 'Data Science', crossListedDepartments: [] },
  { id: 'c-ds340', code: 'DS340', title: 'Machine Learning', instructor: 'Dr. Rania Kamel', credits: 4, semester: 'Spring 2026', enrolled: 19, status: 'Active', departmentId: 'dept-ds', departmentName: 'Data Science', crossListedDepartments: [] },
  { id: 'c-ma205', code: 'MA205', title: 'Linear Algebra', instructor: 'Dr. Samir Lotfy', credits: 3, semester: 'Spring 2026', enrolled: 45, status: 'Active', departmentId: 'dept-ma', departmentName: 'Mathematics', crossListedDepartments: [] },
  { id: 'c-ma110', code: 'MA110', title: 'Calculus I', instructor: 'Dr. Samir Lotfy', credits: 4, semester: 'Fall 2025', enrolled: 52, status: 'Inactive', departmentId: 'dept-ma', departmentName: 'Mathematics', crossListedDepartments: [] },
  { id: 'c-cy301', code: 'CY301', title: 'Network Security', instructor: 'Dr. Adel Mansy', credits: 3, semester: 'Spring 2026', enrolled: 16, status: 'Active', departmentId: 'dept-cy', departmentName: 'Cybersecurity', crossListedDepartments: [] },
  { id: 'c-cy150', code: 'CY150', title: 'Introduction to Cybersecurity', instructor: 'Unassigned', credits: 3, semester: '—', enrolled: 0, status: 'Inactive', departmentId: null, departmentName: null, crossListedDepartments: [] },
];

const CoursesManagementPage: FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [periods, setPeriods] = useState<RegistrationPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const canDelete = useHasPermission('Course Management', 'delete');
  const [showForm, setShowForm] = useState(false);
  const [formCode, setFormCode] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formCredits, setFormCredits] = useState('3');
  const [formSemester, setFormSemester] = useState('');
  const [formInstructor, setFormInstructor] = useState('');
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  // Plan 4 Phase 9 — surface the configured course-code pattern + structured
  // 400 from POST /api/admin/courses so admins immediately see why a code is
  // rejected instead of a silent no-op.
  const [coursePattern, setCoursePattern] = useState<string>('');
  const [addCourseError, setAddCourseError] = useState<string>('');

  // Edit modal state
  const [editTarget, setEditTarget] = useState<Course | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCredits, setEditCredits] = useState('3');
  const [editSemester, setEditSemester] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Preview mode — edit always succeeds locally; the error slot stays empty.
  const [editError] = useState('');

  useEffect(() => {
    // Preview mode — load static catalog / departments / periods. No backend.
    setIsLoading(true);
    setCourses(MOCK_COURSES);
    setDepartments(MOCK_DEPARTMENTS);
    setPeriods(MOCK_PERIODS);
    setCoursePattern('^[A-Z]{2,4}[0-9]{3}$');
    setIsLoading(false);
  }, []);

  // Disable / re-enable — soft-toggle isActive in local state only.
  const handleToggleActive = async (code: string, nextActive: boolean) => {
    setCourses((prev) =>
      prev.map((c) => (c.code === code ? { ...c, status: nextActive ? 'Active' : 'Inactive' } : c))
    );
    setDeletingCode(null);
  };

  // Hard delete — preview mode removes the row from local state only.
  const handleHardDelete = async (
    code: string,
    _force: boolean,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
    setCourses((prev) => prev.filter((c) => c.code !== code));
    setDeletingCode(null);
    return { ok: true };
  };

  // Phase 7 — clicking edit jumps to the dedicated detail page where the
  // admin can edit course meta + sections + slots + TAs in one place. The
  // legacy in-page modal (setEditTarget, etc.) is kept around so the rest of
  // the file still compiles, but isn't reachable from the new pencil button.
  const openEdit = (c: Course) => {
    navigate(`/admin/courses/${encodeURIComponent(c.code)}`);
  };

  // Preview mode — edit the course in local state only. No network.
  const handleEditSave = async () => {
    if (!editTarget || !editTitle) return;
    setEditSubmitting(true);
    setCourses(prev => prev.map(c => c.code === editTarget.code
      ? { ...c, title: editTitle, credits: parseInt(editCredits), semester: editSemester || '—' }
      : c
    ));
    setEditTarget(null);
    setEditSubmitting(false);
  };

  // Preview mode — append the new course to local state, then jump to its
  // (also-mocked) detail page so the admin can wire up sections.
  const handleAddCourse = async () => {
    if (!formCode || !formTitle) return;
    setAddCourseError('');
    const created: Course = {
      id: `c-${formCode.toLowerCase()}`,
      code: formCode.toUpperCase(),
      title: formTitle,
      instructor: formInstructor || 'Unassigned',
      credits: parseInt(formCredits) || 3,
      semester: formSemester || '—',
      enrolled: 0,
      status: 'Active',
      departmentId: null,
      departmentName: null,
      crossListedDepartments: [],
    };
    setCourses(prev => [...prev, created]);
    setShowForm(false); setFormCode(''); setFormTitle(''); setFormSemester(''); setFormInstructor(''); setFormCredits('3');
    navigate(`/admin/courses/${encodeURIComponent(created.code)}`);
  };

  // Resolve the picked period to its canonical semester name. Course.semester
  // is a free-text field; we match it case-insensitively against either the
  // period's semesterRef.name (preferred — the linked Semester row) or the
  // period's own name when no Semester is attached. The 'active' sentinel
  // resolves dynamically to whichever period is currently isActive.
  const periodSemesterMatchTarget = (() => {
    if (periodFilter === 'all' || periodFilter === 'none') return null;
    const p = periodFilter === 'active'
      ? periods.find((x) => x.isActive)
      : periods.find((x) => x.id === periodFilter);
    return p?.semesterRef?.name ?? p?.name ?? null;
  })();

  const filtered = courses.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    // Department gate
    if (departmentFilter === 'none' && c.departmentId) return false;
    if (departmentFilter !== 'all' && departmentFilter !== 'none' && c.departmentId !== departmentFilter) return false;

    // Period gate
    if (periodFilter === 'none' && c.semester && c.semester !== '—') return false;
    if (periodSemesterMatchTarget) {
      const courseSem = (c.semester || '').toLowerCase();
      if (courseSem !== periodSemesterMatchTarget.toLowerCase()) return false;
    }

    return true;
  });

  const activeCourses = courses.filter(c => c.status === 'Active').length;
  const totalEnrolled = courses.reduce((sum, c) => sum + c.enrolled, 0);
  const totalCapacity = courses.reduce((sum, c) => sum + (c.credits || 3) * 15, 0);
  const avgUtilization = totalCapacity > 0 ? Math.round((totalEnrolled / totalCapacity) * 100) : 0;

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView enabled={false}>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('admin.manageCoursesTitle')}</h1>
            <p className="text-black dark:text-gray-300 text-sm">{t('admin.manageCoursesSubtitle')}</p>
          </div>
          <button
            onClick={() => navigate('/admin/courses/new')}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center gap-2"
          >
            <i className="ph-bold ph-plus"></i> {t('admin.addCourse')}
          </button>
        </div>
      </AnimateOnView>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: t('admin.totalCoursesStat'), value: isLoading ? '—' : String(courses.length), icon: 'ph-books', color: 'bg-[#6A3FF4]/20', iconColor: 'text-[#6A3FF4]' },
          { label: t('admin.activeCoursesStat'), value: isLoading ? '—' : String(activeCourses), icon: 'ph-check-circle', color: 'bg-green-500/20', iconColor: 'text-green-500' },
          { label: t('admin.totalEnrolledStat'), value: isLoading ? '—' : String(totalEnrolled), icon: 'ph-users', color: 'bg-blue-500/20', iconColor: 'text-blue-500' },
          { label: t('admin.avgUtilizationStat'), value: isLoading ? '—' : `${avgUtilization}%`, icon: 'ph-chart-pie', color: 'bg-yellow-500/20', iconColor: 'text-yellow-500' },
        ].map((stat, i) => (
          <AnimateOnView key={stat.label} delay={i * 0.05} enabled={false}>
            {/* `h-full` on the card so it stretches to fill the grid row
                height (AnimateOnView wraps with h-full already). Without
                this, cards with shorter labels were ~10 px shorter than
                their neighbors in the same row, especially on mobile
                grid-cols-2 where label length variation is most visible. */}
            <div className={`${glassCardStyle} p-4 flex items-center gap-3 h-full`}>
              <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center flex-shrink-0`}>
                <i className={`ph-fill ${stat.icon} text-xl ${stat.iconColor}`}></i>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{stat.label}</p>
                <p className="text-xl font-bold text-black dark:text-white">{stat.value}</p>
              </div>
            </div>
          </AnimateOnView>
        ))}
      </div>

      {/* Course table */}
      <AnimateOnView delay={0.15} enabled={false}>
        <div className={`${glassCardStyle} overflow-hidden`}>
          <div className="p-5 border-b border-white/10 dark:border-white/5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
            <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
              <i className="ph-bold ph-books mr-2 text-[#6A3FF4]"></i>{t('admin.courseListingTitle')}
            </h2>
            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              {/* Registration period filter — dynamic. Options are pulled from
                  /api/admin/registration-periods so they stay in sync with
                  whatever the admin has configured in Registration Control.
                  "Active period" resolves at filter-time to whichever period
                  currently has isActive=true, so admins can always one-click
                  to "current term". */}
              <div className="w-full sm:w-60">
                <GlassDropdown
                  value={periodFilter}
                  onChange={setPeriodFilter}
                  options={[
                    { value: 'all', label: t('admin.allPeriodsOpt'), icon: 'ph-calendar-blank' },
                    { value: 'active', label: t('admin.activePeriodOpt'), icon: 'ph-broadcast' },
                    { value: 'none', label: t('admin.noSemesterSet'), icon: 'ph-circle-dashed' },
                    ...periods.map((p) => ({
                      value: p.id,
                      label: `${p.name}${p.isActive ? `  •  ${t('admin.activeMarker')}` : ''}`,
                      icon: p.isActive ? 'ph-broadcast' : 'ph-calendar-blank',
                    })),
                  ]}
                />
              </div>
              {/* Department filter — also dynamic, sourced from /api/departments. */}
              <div className="w-full sm:w-56">
                <GlassDropdown
                  value={departmentFilter}
                  onChange={setDepartmentFilter}
                  options={[
                    { value: 'all', label: t('admin.allDepartmentsOpt'), icon: 'ph-buildings' },
                    // Plan 6 Phase 6 — courses unlinked when a department is
                    // deleted surface under "Unassigned". Matches the wording
                    // in the department delete confirmation modal.
                    { value: 'none', label: t('admin.unassignedOpt'), icon: 'ph-circle-dashed' },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: d.code ? `${d.code} — ${d.name}` : d.name,
                      icon: 'ph-buildings',
                    })),
                  ]}
                />
              </div>
              <div className="relative w-full sm:w-52">
                <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                <input placeholder={t('admin.searchCoursesPh')} value={search} onChange={e => setSearch(e.target.value)} className={`${inputStyle} pl-10`} />
              </div>
            </div>
          </div>
          {isLoading ? (
            <div className="text-center py-16"><i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-white/5 dark:bg-black/10 border-b border-white/10 dark:border-white/5">
                    {[
                      t('admin.codeCourseCol'),
                      t('admin.titleCourseCol'),
                      t('admin.departmentCourseCol'),
                      t('admin.instructorCol'),
                      t('admin.creditsCourseCol'),
                      t('admin.semesterCourseCol'),
                      t('admin.enrolledCol'),
                      t('admin.statusCourseCol'),
                      t('admin.actionsCourseCol'),
                    ].map(h => (
                      <th key={h} className="p-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-white/5 dark:border-white/5 hover:bg-white/5 dark:hover:bg-black/10 transition-colors">
                      <td className="p-4 text-xs text-[#6A3FF4] font-mono font-bold">{c.code}</td>
                      <td className="p-4 text-black dark:text-white font-medium">{c.title}</td>
                      <td className="p-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {c.departmentName ? (
                          <span className="text-black dark:text-gray-200">{c.departmentName}</span>
                        ) : (
                          <span className="italic text-gray-500">{t('admin.unassignedTxt')}</span>
                        )}
                        {c.crossListedDepartments && c.crossListedDepartments.length > 0 && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#6A3FF4]/15 text-[#6A3FF4] border border-[#6A3FF4]/30"
                            title={t('admin.alsoOfferedToTitle', { list: c.crossListedDepartments.map((d) => d.code ?? d.name).join(', ') })}
                          >
                            <i className="ph-bold ph-share-network" />
                            +{c.crossListedDepartments.length}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-black dark:text-gray-300">{c.instructor}</td>
                      <td className="p-4 text-gray-500 dark:text-gray-400">{c.credits}</td>
                      <td className="p-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {(() => {
                          // If the stored semester string matches a known
                          // registration period's canonical name, show the
                          // period's full name + an "active" pill so admins
                          // can see at a glance which period this course is on.
                          const sem = c.semester;
                          if (!sem || sem === '—') return <span className="italic text-gray-500">—</span>;
                          const matched = periods.find((p) => {
                            const canonical = p.semesterRef?.name ?? p.name;
                            return canonical.toLowerCase() === sem.toLowerCase();
                          });
                          return (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-black dark:text-gray-200">{sem}</span>
                              {matched?.isActive && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 uppercase tracking-wider">
                                  {t('admin.activePill')}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-4 text-black dark:text-white font-bold">{c.enrolled}</td>
                      <td className="p-4">
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${c.status === 'Active' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}`}>{c.status === 'Active' ? t('admin.statusActive') : t('admin.statusInactive')}</span>
                      </td>
                      <td className="p-4">
                        {deletingCode === c.code ? (
                          // Two-button hard-delete confirmation. The backend
                          // refuses without ?force=true when there are deps.
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                const r = await handleHardDelete(c.code, false);
                                if (r.ok) return;
                                if (r.status === 409) {
                                  if (window.confirm(
                                    t('admin.forcedDeleteConfirm', { error: r.error })
                                  )) {
                                    const r2 = await handleHardDelete(c.code, true);
                                    if (!r2.ok) {
                                      window.alert(t('admin.forcedDeleteAlsoFailed', { error: r2.error }));
                                    }
                                  }
                                  return;
                                }
                                // Any other status (500, network, etc.) — surface
                                // the message instead of silently leaving the row.
                                window.alert(t('admin.deleteFailedHttp', { status: r.status || '—', error: r.error }));
                              }}
                              className="px-3 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-colors"
                            >
                              {t('admin.confirmPermanentDelete')}
                            </button>
                            <button
                              onClick={() => setDeletingCode(null)}
                              className="px-3 py-1 rounded-lg bg-white/10 text-gray-400 text-xs font-bold hover:bg-white/20 transition-colors"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg text-gray-500 hover:text-[#6A3FF4] hover:bg-[#6A3FF4]/10 transition-colors" title={t('admin.editCourseBtnTitle')}>
                              <i className="ph-bold ph-pencil text-base"></i>
                            </button>
                            {/* Disable / Re-enable toggle. Yellow (pause) icon
                                when active, green (play) when inactive. Soft —
                                preserves all data. */}
                            <button
                              onClick={() => handleToggleActive(c.code, c.status !== 'Active')}
                              className={`p-1.5 rounded-lg transition-colors ${
                                c.status === 'Active'
                                  ? 'text-gray-500 hover:text-yellow-400 hover:bg-yellow-500/10'
                                  : 'text-yellow-400 hover:text-green-400 hover:bg-green-500/10'
                              }`}
                              title={c.status === 'Active' ? t('admin.disableCourseTitle') : t('admin.reEnableCourseTitle')}
                            >
                              <i className={`ph-bold ${c.status === 'Active' ? 'ph-pause-circle' : 'ph-play-circle'} text-base`}></i>
                            </button>
                            {/* Permanent delete — refuses if course has
                                registrations / grades unless force=true. */}
                            {canDelete && (
                              <button
                                onClick={() => setDeletingCode(c.code)}
                                className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title={t('admin.permanentlyDeleteCourse')}
                              >
                                <i className="ph-bold ph-trash text-base"></i>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-gray-500 py-10">{t('admin.noCoursesFound')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AnimateOnView>

      {/* Add course modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className={`${glassCardStyle} p-8 max-w-md w-full space-y-4`} onClick={e => e.stopPropagation()}
            >
              <h3 className="text-black dark:text-white text-xl font-bold">{t('admin.addNewCourse')}</h3>
              {/* Plan 4 Phase 9 — show the configured course-code pattern so
                  admins know the format. Falls through quietly if the GET failed. */}
              {coursePattern && (
                <div className="rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-3 py-2 text-[11px] text-gray-500 dark:text-gray-300">
                  <i className="ph-bold ph-info text-[#7B5AFF] mr-1" />
                  {t('admin.courseCodePatternHint1')} <code className="font-mono">{coursePattern}</code>{t('admin.courseCodePatternHint2')}{' '}
                  <strong>{t('admin.courseCodePatternHint3')}</strong>.
                </div>
              )}
              {addCourseError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  <i className="ph-bold ph-warning mr-1" />
                  {addCourseError}
                </div>
              )}
              {[
                { label: t('admin.courseCodeStarLbl'), value: formCode, set: setFormCode, placeholder: t('admin.phCs101') },
                { label: t('admin.courseTitleStarLbl'), value: formTitle, set: setFormTitle, placeholder: t('admin.phIntroCs') },
                { label: t('admin.creditsLbl'), value: formCredits, set: setFormCredits, placeholder: t('admin.ph3Number') },
                { label: t('admin.semesterLbl'), value: formSemester, set: setFormSemester, placeholder: t('admin.phSpring2026') },
                { label: t('admin.instructorEmailLbl'), value: formInstructor, set: setFormInstructor, placeholder: t('admin.phProfEmail') },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">{f.label}</label>
                  <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} className={inputStyle} />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button onClick={handleAddCourse} disabled={!formCode || !formTitle} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50">{t('admin.saveCourseBtn')}</button>
                <button onClick={() => setShowForm(false)} className={`flex-1 py-2.5 rounded-xl ${glassCardStyle} text-black dark:text-gray-300 font-bold hover:bg-white/20 dark:hover:bg-black/30 transition-colors`}>{t('common.cancel')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit course modal */}
      <AnimatePresence>
        {editTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setEditTarget(null)}
          >
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              className={`${glassCardStyle} p-8 max-w-md w-full space-y-4`} onClick={e => e.stopPropagation()}
            >
              <h3 className="text-black dark:text-white text-xl font-bold">{t('admin.editCourseHeading')} <span className="text-[#6A3FF4]">{editTarget.code}</span></h3>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">{t('admin.courseTitleStarLbl')}</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className={inputStyle} placeholder={t('admin.courseTitlePh')} />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">{t('admin.creditsLbl')}</label>
                <input value={editCredits} onChange={e => setEditCredits(e.target.value)} className={inputStyle} placeholder={t('admin.ph3Number')} type="number" min="1" max="6" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 block mb-1">{t('admin.semesterLbl')}</label>
                <input value={editSemester} onChange={e => setEditSemester(e.target.value)} className={inputStyle} placeholder={t('admin.phSpring2026')} />
              </div>
              {editError && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{editError}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={handleEditSave} disabled={editSubmitting || !editTitle} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50">
                  {editSubmitting ? t('admin.savingDots') : t('admin.saveChangesBtn2')}
                </button>
                <button onClick={() => setEditTarget(null)} className={`flex-1 py-2.5 rounded-xl ${glassCardStyle} text-black dark:text-gray-300 font-bold hover:bg-white/20 dark:hover:bg-black/30 transition-colors`}>{t('common.cancel')}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CoursesManagementPage;
