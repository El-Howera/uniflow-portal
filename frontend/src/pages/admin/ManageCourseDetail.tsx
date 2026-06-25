// src/pages/admin/ManageCourseDetail.tsx
//
// Admin "deep edit" page for a single course. Backed by:
//   GET  /api/admin/courses/:code/full     — course + sections + slots + TAs
//   PUT  /api/admin/courses/:code          — update course meta
//   POST /api/admin/courses/:code/sections — add section
//   PUT  /api/admin/sections/:id           — edit section
//   DELETE /api/admin/sections/:id         — remove section (no enrollments)
//   POST /api/admin/sections/:id/slots     — add timing slot
//   DELETE /api/admin/slots/:id            — remove slot
//   POST /api/admin/sections/:id/tas       — assign TA
//   DELETE /api/admin/sections/:sectionId/tas/:taId — unassign TA
//   GET  /api/admin/professors             — instructor dropdown
//   GET  /api/admin/teaching-assistants    — TA dropdown
//
// Permissions: gates the destructive actions on Course Management:write/delete.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useHasPermission } from '../../utils/permissions';
import { useT } from '../../i18n';

type DetailTab = 'info' | 'sections' | 'enrolled';

const glassCardStyle = 'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle = 'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors';
const labelStyle = 'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

// Only Lecture / Lab are exposed in the admin UI. The schema enum has more
// values (Tutorial, Seminar) but the institution this build targets only
// uses the two; gating the picker prevents accidental data divergence.
type SectionType = 'Lecture' | 'Lab';
type DayOfWeek = 'Saturday' | 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';
const ALL_DAYS: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface PersonLite { id: string; firstName: string; lastName: string; email: string }
interface DepartmentLite { id: string; code?: string | null; name: string }

/**
 * CrossListedDepartmentsPicker
 * ------------------------------------------------------------------
 * Tag-style multi-select for the cross-listed-departments set. The
 * PRIMARY department (passed in `primaryId`) is removed from the
 * options list — it's implicit membership, not an explicit cross-list.
 *
 * Rendered as: a row of selected chips (each with an × to remove) +
 * a single-pick `GlassDropdown` underneath that appends to the set
 * when the admin picks a row. Choosing a department whose ID is
 * already in `selectedIds` is a no-op (the dropdown resets itself).
 */
const CrossListedDepartmentsPicker: React.FC<{
  departments: DepartmentLite[];
  primaryId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}> = ({ departments, primaryId, selectedIds, onChange }) => {
  const t = useT();
  // Adder dropdown is fully controlled; reset to empty after each pick
  // so the same option doesn't stay "selected" in the picker UI.
  const [pendingPick, setPendingPick] = useState('');

  // Available options = all departments minus the primary (implicit) and
  // any already-cross-listed. Filtering both keeps the dropdown clean.
  const available = departments.filter(
    (d) => d.id !== primaryId && !selectedIds.includes(d.id),
  );

  const addPick = (id: string) => {
    if (!id || selectedIds.includes(id)) {
      setPendingPick('');
      return;
    }
    onChange([...selectedIds, id]);
    setPendingPick('');
  };

  const removePick = (id: string) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
        {selectedIds.length === 0 ? (
          <span className="text-xs text-gray-500 italic">{t('admin.noCrossListedYet')}</span>
        ) : (
          selectedIds.map((id) => {
            const d = departments.find((x) => x.id === id);
            const label = d ? (d.code ? `${d.code} — ${d.name}` : d.name) : id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[#6A3FF4]/15 text-[#6A3FF4] border border-[#6A3FF4]/30"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removePick(id)}
                  className="hover:text-red-500 transition-colors"
                  aria-label={t('admin.removeLabel', { label })}
                >
                  <i className="ph-bold ph-x text-[10px]" />
                </button>
              </span>
            );
          })
        )}
      </div>
      {available.length > 0 && (
        <GlassDropdown
          value={pendingPick}
          onChange={addPick}
          direction="up"
          options={[
            { value: '', label: t('admin.addDeptToCrossList'), icon: 'ph-plus' },
            ...available.map((d) => ({
              value: d.id,
              label: d.code ? `${d.code} — ${d.name}` : d.name,
              icon: 'ph-buildings',
            })),
          ]}
        />
      )}
    </div>
  );
};

interface HallLite {
  id: string;
  name: string;
  building?: string | null;
  room?: string | null;
  capacity: number;
  isActive: boolean;
}
// /api/admin/registration-periods returns one row per period; semesterRef.name
// is the canonical semester string we store on Course.semester.
interface PeriodLite {
  id: string;
  name: string;
  isActive: boolean;
  semesterRef?: { id: string; name: string; academicYear?: string | null } | null;
}
interface Slot { id: string; day: DayOfWeek; startTime: string; endTime: string; room?: string | null }
interface TAAssign { id: string; ta: PersonLite }
interface Section {
  id: string;
  sectionId: string;
  type: SectionType;
  capacity: number;
  enrolled: number;
  semester?: string | null;
  year?: number | null;
  room?: string | null;
  location?: string | null;
  hallId?: string | null;
  hall?: HallLite | null;
  instructorId?: string | null;
  instructor?: PersonLite | null;
  instructorName?: string | null;
  slots: Slot[];
  taAssignments: TAAssign[];
}
interface CourseFull {
  id: string;
  code: string;
  title: string;
  credits: number;
  description?: string | null;
  level?: number | null;
  maxStudents: number;
  lectureOnly: boolean;
  isActive: boolean;
  semester?: string | null;
  departmentId?: string | null;
  department?: { id: string; name: string } | null;
  // Multi-dept cross-listing (migration 20260520000000). Departments that
  // can SEE this course in their student catalog beyond the primary one.
  crossListedDepartments?: { id: string; code?: string | null; name: string }[];
  defaultInstructorId?: string | null;
  defaultTaId?: string | null;
  defaultInstructor?: PersonLite | null;
  defaultTa?: PersonLite | null;
  sections: Section[];
}

// ─── Preview mock data ─────────────────────────────────────────────────────────
const MOCK_PROFESSORS: PersonLite[] = [
  { id: 'u-prof-fares', firstName: 'Fares', lastName: 'Howera', email: 'fares.howera@fcds.edu' },
  { id: 'u-prof-hala', firstName: 'Hala', lastName: 'Mansour', email: 'hala.mansour@fcds.edu' },
  { id: 'u-prof-tamer', firstName: 'Tamer', lastName: 'Fouad', email: 'tamer.fouad@fcds.edu' },
  { id: 'u-prof-rania', firstName: 'Rania', lastName: 'Kamel', email: 'rania.kamel@fcds.edu' },
];

const MOCK_TAS: PersonLite[] = [
  { id: 'u-ta-mona', firstName: 'Mona', lastName: 'Salah', email: 'mona.salah@fcds.edu' },
  { id: 'u-ta-bishoy', firstName: 'Bishoy', lastName: 'Nabil', email: 'bishoy.nabil@fcds.edu' },
  { id: 'u-ta-dina', firstName: 'Dina', lastName: 'Fathy', email: 'dina.fathy@fcds.edu' },
];

const MOCK_DEPARTMENTS: DepartmentLite[] = [
  { id: 'dept-cs', code: 'CS', name: 'Computer Science' },
  { id: 'dept-ds', code: 'DS', name: 'Data Science' },
  { id: 'dept-ma', code: 'MA', name: 'Mathematics' },
  { id: 'dept-cy', code: 'CY', name: 'Cybersecurity' },
];

const MOCK_PERIODS: PeriodLite[] = [
  { id: 'p-spring-2026', name: 'Spring 2026 Registration Period', isActive: true, semesterRef: { id: 's-spring-2026', name: 'Spring 2026', academicYear: '2025/2026' } },
  { id: 'p-fall-2025', name: 'Fall 2025 Registration Period', isActive: false, semesterRef: { id: 's-fall-2025', name: 'Fall 2025', academicYear: '2025/2026' } },
];

const MOCK_HALLS: HallLite[] = [
  { id: 'h-a101', name: 'Hall A101', building: 'Main Building', room: 'A101', capacity: 200, isActive: true },
  { id: 'h-a205', name: 'Hall A205', building: 'Main Building', room: 'A205', capacity: 120, isActive: true },
  { id: 'h-lab1', name: 'Computer Lab 1', building: 'IT Block', room: 'L1', capacity: 40, isActive: true },
  { id: 'h-lab2', name: 'Computer Lab 2', building: 'IT Block', room: 'L2', capacity: 40, isActive: true },
];

const MOCK_COURSE_TITLES: Record<string, { title: string; credits: number; departmentId: string }> = {
  CS101: { title: 'Introduction to Computer Science', credits: 3, departmentId: 'dept-cs' },
  CS201: { title: 'Data Structures & Algorithms', credits: 4, departmentId: 'dept-cs' },
  MA205: { title: 'Linear Algebra', credits: 3, departmentId: 'dept-ma' },
  DS340: { title: 'Machine Learning', credits: 4, departmentId: 'dept-ds' },
};

const buildMockCourse = (rawCode: string): CourseFull => {
  const code = rawCode.toUpperCase();
  const meta = MOCK_COURSE_TITLES[code] ?? { title: 'Course', credits: 3, departmentId: 'dept-cs' };
  const dept = MOCK_DEPARTMENTS.find((d) => d.id === meta.departmentId) ?? null;
  return {
    id: `c-${code}`,
    code,
    title: meta.title,
    credits: meta.credits,
    description: 'A core course in the FCDS curriculum covering foundational concepts with weekly lectures and lab work.',
    level: 2,
    maxStudents: 200,
    lectureOnly: false,
    isActive: true,
    semester: 'Spring 2026',
    departmentId: meta.departmentId,
    department: dept ? { id: dept.id, name: dept.name } : null,
    crossListedDepartments: [],
    defaultInstructorId: 'u-prof-fares',
    defaultTaId: 'u-ta-mona',
    defaultInstructor: MOCK_PROFESSORS[0],
    defaultTa: MOCK_TAS[0],
    sections: [
      {
        id: `${code}-sec-L1`, sectionId: 'L1', type: 'Lecture', capacity: 200, enrolled: 142,
        semester: 'Spring 2026', year: 2026, room: null, location: 'Main Building',
        hallId: 'h-a101', hall: MOCK_HALLS[0],
        instructorId: 'u-prof-fares', instructor: MOCK_PROFESSORS[0], instructorName: null,
        slots: [
          { id: `${code}-slot-1`, day: 'Sunday', startTime: '09:00', endTime: '10:30', room: 'A101' },
          { id: `${code}-slot-2`, day: 'Tuesday', startTime: '09:00', endTime: '10:30', room: 'A101' },
        ],
        taAssignments: [],
      },
      {
        id: `${code}-sec-B1`, sectionId: 'B1', type: 'Lab', capacity: 40, enrolled: 31,
        semester: 'Spring 2026', year: 2026, room: null, location: 'IT Block',
        hallId: 'h-lab1', hall: MOCK_HALLS[2],
        instructorId: 'u-ta-mona', instructor: MOCK_TAS[0], instructorName: null,
        slots: [
          { id: `${code}-slot-3`, day: 'Monday', startTime: '11:00', endTime: '13:00', room: 'L1' },
        ],
        taAssignments: [],
      },
    ],
  };
};

const ManageCourseDetail: React.FC = () => {
  const t = useT();
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const canWriteCourses = useHasPermission('Course Management', 'write');
  const canDeleteCourses = useHasPermission('Course Management', 'delete');

  // `code === 'new'` is the sentinel for the create-flow. The Add button on
  // ManageCourses navigates here directly — no modal, no two-step. Once the
  // admin saves the meta, we redirect to /admin/courses/<created-code>.
  const isNew = code === 'new';

  const [course, setCourse] = useState<CourseFull | null>(null);
  const [professors, setProfessors] = useState<PersonLite[]>([]);
  const [teachingAssistants, setTeachingAssistants] = useState<PersonLite[]>([]);
  const [departments, setDepartments] = useState<DepartmentLite[]>([]);
  const [periods, setPeriods] = useState<PeriodLite[]>([]);
  const [halls, setHalls] = useState<HallLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('info');

  // Course-meta form fields, initialised from the API response (existing
  // course) OR with safe defaults (new course).
  const [newCode, setNewCode] = useState('');           // only used when isNew
  const [editCode, setEditCode] = useState('');
  const [title, setTitle] = useState('');
  const [credits, setCredits] = useState(3);
  const [maxStudents, setMaxStudents] = useState(30);
  const [level, setLevel] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  // Cross-listed departments — admin picks zero or more EXTRA departments
  // that should see this course in their catalog. The primary is the
  // single `departmentId` above; this set is purely additive.
  const [crossListedDepartmentIds, setCrossListedDepartmentIds] = useState<string[]>([]);
  const [semester, setSemester] = useState<string>(''); // free-text; period picker writes to this
  const [description, setDescription] = useState('');
  const [lectureOnly, setLectureOnly] = useState(false);
  const [isActive, setIsActive] = useState(true);
  // Default professor + default TA for the course. New sections inherit
  // them on create unless the admin picks a different person per section.
  const [defaultInstructorId, setDefaultInstructorId] = useState<string>('');
  const [defaultTaId, setDefaultTaId] = useState<string>('');

  const loadPickers = useCallback(() => {
    // Preview mode — populate every picker from static mock data. No network.
    setProfessors(MOCK_PROFESSORS);
    setTeachingAssistants(MOCK_TAS);
    setDepartments(MOCK_DEPARTMENTS);
    setPeriods(MOCK_PERIODS);
    setHalls(MOCK_HALLS);
  }, []);

  const refresh = useCallback(async () => {
    if (!code) return;

    // Create-mode: just populate the picker lists so the new section form has
    // dropdowns once the course is saved.
    if (isNew) {
      setLoading(true);
      setError(null);
      loadPickers();
      setLoading(false);
      return;
    }

    // Preview mode — synthesise the course from static mock data. No network.
    setLoading(true);
    setError(null);
    loadPickers();
    const c = buildMockCourse(code);
    setCourse(c);
    setEditCode(c.code);
    setTitle(c.title);
    setCredits(c.credits);
    setMaxStudents(c.maxStudents);
    setLevel(c.level != null ? String(c.level) : '');
    setDepartmentId(c.departmentId ?? '');
    setCrossListedDepartmentIds((c.crossListedDepartments ?? []).map((d) => d.id));
    setSemester(c.semester ?? '');
    setDescription(c.description ?? '');
    setLectureOnly(c.lectureOnly);
    setIsActive(c.isActive);
    setDefaultInstructorId(c.defaultInstructorId ?? '');
    setDefaultTaId(c.defaultTaId ?? '');
    setLoading(false);
  }, [code, isNew, loadPickers]);

  useEffect(() => { refresh(); }, [refresh]);

  // Helper: resolve the current `semester` string back to whichever period
  // it came from so the dropdown shows the correct selection on edit. Empty
  // string when the course has no semester or the semester doesn't match
  // any current period (e.g. a course saved before that period existed).
  const periodNameFor = (p: PeriodLite) => p.semesterRef?.name ?? p.name;
  const matchedPeriodId = (() => {
    if (!semester) return '';
    const p = periods.find((x) => periodNameFor(x).toLowerCase() === semester.toLowerCase());
    return p ? p.id : '';
  })();
  const periodOptions = [
    { value: '', label: t('admin.noRegPeriodOpt'), icon: 'ph-calendar-blank' },
    ...periods.map((p) => ({
      value: p.id,
      label: `${p.name}${p.isActive ? `  •  ${t('admin.activeMarker')}` : ''}`,
      icon: p.isActive ? 'ph-broadcast' : 'ph-calendar-blank',
    })),
  ];
  const setSemesterFromPeriod = (periodId: string) => {
    if (!periodId) {
      setSemester('');
      return;
    }
    const p = periods.find((x) => x.id === periodId);
    if (p) setSemester(periodNameFor(p));
  };

  // Create-mode submit — preview mode just navigates to the (mocked) detail page.
  const createCourse = async () => {
    setError(null);
    if (!newCode.trim() || !title.trim()) {
      setError(t('admin.codeAndTitleRequired'));
      return;
    }
    const created = newCode.trim().toUpperCase();
    navigate(`/admin/courses/${encodeURIComponent(created)}`, { replace: true });
  };

  const flash = (msg: string) => {
    setSavedFlag(msg);
    setTimeout(() => setSavedFlag(null), 3500);
  };

  // Preview mode — persist course-meta edits into local state only. No network.
  const saveCourse = async () => {
    if (!course || !canWriteCourses) return;
    setError(null);
    const nextCode = editCode.trim();
    const codeChanged = !!nextCode && nextCode !== course.code;
    setCourse((prev) =>
      prev
        ? {
            ...prev,
            code: nextCode || prev.code,
            title,
            credits,
            maxStudents,
            level: level === '' ? null : Number(level),
            departmentId: departmentId || null,
            department: MOCK_DEPARTMENTS.find((d) => d.id === departmentId)
              ? { id: departmentId, name: MOCK_DEPARTMENTS.find((d) => d.id === departmentId)!.name }
              : null,
            crossListedDepartments: crossListedDepartmentIds
              .map((cid) => MOCK_DEPARTMENTS.find((d) => d.id === cid))
              .filter((d): d is DepartmentLite => !!d)
              .map((d) => ({ id: d.id, code: d.code, name: d.name })),
            semester: semester || null,
            description: description || null,
            lectureOnly,
            isActive,
            defaultInstructorId: defaultInstructorId || null,
            defaultTaId: defaultTaId || null,
          }
        : prev,
    );
    flash(codeChanged ? t('admin.courseSavedRename', { code: nextCode }) : t('admin.courseSavedFlash'));
    window.dispatchEvent(new Event('uniflow:courses-updated'));
    if (codeChanged) {
      navigate(`/admin/courses/${encodeURIComponent(nextCode)}`, { replace: true });
    }
  };

  // Preview mode — soft delete just navigates back to the list. No network.
  const deleteCourse = async () => {
    if (!course || !canDeleteCourses) return;
    if (!window.confirm(t('admin.softDeleteConfirm', { code: course.code }))) return;
    navigate('/admin/manage-courses');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i>
      </div>
    );
  }

  // Create-mode renders a minimal form; sections panel comes later, after save.
  if (isNew) {
    return (
      <div className="pb-16 space-y-6 px-2 sm:px-0">
        <AnimateOnView enabled={false}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/manage-courses')}
              className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors text-black dark:text-white flex-shrink-0"
              title={t('admin.backToCourseListTitle')}
            >
              <i className="ph-bold ph-arrow-left text-lg"></i>
            </button>
            <div>
              <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.addCourse')}</h1>
              <p className="text-gray-500 text-sm">{t('admin.fillBasicsNote')}</p>
            </div>
          </div>
        </AnimateOnView>

        {error && (
          <div className={`${glassCardStyle} p-3 border-red-500/30 bg-red-500/10`}>
            <p className="text-red-300 text-sm flex items-center gap-2">
              <i className="ph-bold ph-warning-circle"></i> {error}
            </p>
          </div>
        )}

        <AnimateOnView enabled={false}>
          <div className={`${glassCardStyle} p-6`}>
            <h2 className="text-black dark:text-white font-bold text-lg flex items-center gap-2 mb-4">
              <i className="ph-bold ph-info text-[#6A3FF4]"></i> {t('admin.courseInfoTitle')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelStyle}>{t('admin.courseCodeLbl')}</label>
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder={t('admin.phCS999')}
                  className={`${inputStyle} font-mono`}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.coursePatternHint')}
                </p>
              </div>
              <div>
                <label className={labelStyle}>{t('admin.titleLbl')}</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('admin.phIntroDots')} className={inputStyle} />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.creditsFieldLbl')}</label>
                <input type="number" min={1} max={12} value={credits} onChange={(e) => setCredits(Number(e.target.value))} className={inputStyle} />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.maxStudentsLbl')}</label>
                <input type="number" min={1} value={maxStudents} onChange={(e) => setMaxStudents(Number(e.target.value))} className={inputStyle} />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.levelLbl')}</label>
                <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t('admin.levelExample')} className={inputStyle} />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.deptPrimaryLbl')}</label>
                <GlassDropdown
                  value={departmentId}
                  onChange={setDepartmentId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDeptOpt'), icon: 'ph-buildings' },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: d.code ? `${d.code} — ${d.name}` : d.name,
                      icon: 'ph-buildings',
                    })),
                  ]}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.deptPrimaryHelp')}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className={labelStyle}>{t('admin.alsoOfferedLbl')}</label>
                <CrossListedDepartmentsPicker
                  departments={departments}
                  primaryId={departmentId}
                  selectedIds={crossListedDepartmentIds}
                  onChange={setCrossListedDepartmentIds}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.crossListHelp')}
                </p>
              </div>
              <div>
                <label className={labelStyle}>{t('admin.regPeriodLbl')}</label>
                <GlassDropdown
                  value={matchedPeriodId}
                  onChange={setSemesterFromPeriod}
                  direction="up"
                  options={periodOptions}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.regPeriodHelp')}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className={labelStyle}>{t('admin.descriptionLbl')}</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputStyle} />
              </div>

              <div>
                <label className={labelStyle}>{t('admin.defaultProfLectures')}</label>
                <GlassDropdown
                  value={defaultInstructorId}
                  onChange={setDefaultInstructorId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDefaultOpt'), icon: 'ph-user' },
                    ...professors.map((p) => ({
                      value: p.id,
                      label: `${p.firstName} ${p.lastName}`,
                      icon: 'ph-chalkboard-teacher',
                    })),
                  ]}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.defaultProfHelp')}
                </p>
              </div>
              <div>
                <label className={labelStyle}>{t('admin.defaultTaLabs')}</label>
                <GlassDropdown
                  value={defaultTaId}
                  onChange={setDefaultTaId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDefaultOpt'), icon: 'ph-user' },
                    ...teachingAssistants.map((p) => ({
                      value: p.id,
                      label: `${p.firstName} ${p.lastName}`,
                      icon: 'ph-graduation-cap',
                    })),
                  ]}
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('admin.defaultTaHelp')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6 mt-4 mb-4">
              <div
                onClick={() => setLectureOnly(!lectureOnly)}
                className="flex items-center gap-2 text-sm text-black dark:text-gray-300 cursor-pointer"
              >
                <GlassCheckbox checked={lectureOnly} onChange={setLectureOnly} size="sm" />
                <span>{t('admin.lectureOnlyCheck')}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => navigate('/admin/manage-courses')}
                className="px-5 py-2 rounded-xl bg-white/5 border border-white/10 text-black dark:text-white text-sm hover:bg-white/10"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={createCourse}
                disabled={!canWriteCourses || !newCode.trim() || !title.trim()}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
              >
                {t('admin.createCourseBtn')}
              </button>
            </div>
          </div>
        </AnimateOnView>

        <p className="text-xs text-gray-500 italic text-center">
          {t('admin.sectionsScheduleHint')}
        </p>
      </div>
    );
  }

  if (error && !course) {
    return (
      <div className={`${glassCardStyle} p-8 text-center max-w-2xl mx-auto`}>
        <i className="ph-bold ph-warning-circle text-3xl text-red-400 mb-3"></i>
        <p className="text-red-300 mb-4">{error}</p>
        <button onClick={() => navigate(-1)} className="px-4 py-2 rounded-xl bg-white/10 text-black dark:text-white hover:bg-white/20 text-sm font-bold">
          {t('admin.goBackBtn')}
        </button>
      </div>
    );
  }
  if (!course) return null;

  return (
    <div className="pb-16 space-y-6 px-2 sm:px-0">
      {/* Header */}
      <AnimateOnView enabled={false}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/manage-courses')}
            title={t('admin.backToCourseListTitle')}
            className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors text-black dark:text-white flex-shrink-0"
          >
            <i className="ph-bold ph-arrow-left text-lg"></i>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white truncate">
              {course.code} — {course.title}
            </h1>
            <p className="text-gray-500 text-sm">
              {t('admin.creditsAndSections', {
                credits: course.credits,
                n: course.sections.length,
                label: course.sections.length === 1 ? t('admin.sectionLabel') : t('admin.sectionsLabel'),
              })}
              {course.isActive ? '' : ` · ${t('admin.inactiveLabel')}`}
            </p>
          </div>
          {savedFlag && (
            <div className="text-green-400 text-sm font-medium flex items-center gap-1">
              <i className="ph-bold ph-check-circle"></i> {savedFlag}
            </div>
          )}
        </div>
      </AnimateOnView>

      {error && course && (
        <div className={`${glassCardStyle} p-3 border-red-500/30 bg-red-500/10`}>
          <p className="text-red-300 text-sm flex items-center gap-2">
            <i className="ph-bold ph-warning-circle"></i> {error}
          </p>
        </div>
      )}

      {/* Tab nav — splits the page into Information / Sections / Enrolled
          Students. The existing meta + sections panels stay 1:1 with the
          prior layout; the third tab is the Phase 8 roster surface. */}
      <AnimateOnView enabled={false}>
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { id: 'info', label: t('admin.infoTab'), icon: 'ph-info' },
            { id: 'sections', label: t('admin.sectionsTab'), icon: 'ph-stack' },
            { id: 'enrolled', label: t('admin.enrolledTab'), icon: 'ph-users' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border ${
                activeTab === tab.id
                  ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 text-[#7B5AFF]'
                  : 'bg-white/5 border-white/10 text-black dark:text-white hover:bg-white/10'
              }`}
            >
              <i className={`ph-bold ${tab.icon}`}></i> {tab.label}
            </button>
          ))}
        </div>
      </AnimateOnView>

      {activeTab === 'info' && (
      <>
      {/* Course meta */}
      <AnimateOnView enabled={false}>
        <div className={`${glassCardStyle} p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-black dark:text-white font-bold text-lg flex items-center gap-2">
              <i className="ph-bold ph-info text-[#6A3FF4]"></i> {t('admin.courseInfoTitle')}
            </h2>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
              course.isActive
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
            }`}>{course.isActive ? t('admin.statusActive') : t('admin.statusInactive')}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelStyle}>
                {t('admin.courseCodeLbl')}
                {editCode.trim() && course && editCode.trim() !== course.code && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-amber-500">{t('admin.unsavedRenameBadge')}</span>
                )}
              </label>
              <input
                value={editCode}
                onChange={(e) => setEditCode(e.target.value)}
                className={inputStyle}
                placeholder={t('admin.phCs101')}
                disabled={!canWriteCourses}
              />
              <p className="text-[10px] text-gray-500 mt-1">
                {t('admin.codeRenameHint')}
              </p>
            </div>
            <div>
              <label className={labelStyle}>{t('admin.titleLbl')}</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputStyle} disabled={!canWriteCourses} />
            </div>
            <div>
              <label className={labelStyle}>{t('admin.creditsFieldLbl')}</label>
              <input type="number" min={1} max={12} value={credits} onChange={(e) => setCredits(Number(e.target.value))} className={inputStyle} disabled={!canWriteCourses} />
            </div>
            <div>
              <label className={labelStyle}>{t('admin.maxStudentsLbl')}</label>
              <input type="number" min={1} value={maxStudents} onChange={(e) => setMaxStudents(Number(e.target.value))} className={inputStyle} disabled={!canWriteCourses} />
            </div>
            <div>
              <label className={labelStyle}>{t('admin.levelLbl')}</label>
              <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t('admin.levelExample')} className={inputStyle} disabled={!canWriteCourses} />
            </div>
            <div>
              <label className={labelStyle}>{t('admin.deptPrimaryLbl')}</label>
              {canWriteCourses ? (
                <GlassDropdown
                  value={departmentId}
                  onChange={setDepartmentId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDeptOpt'), icon: 'ph-buildings' },
                    ...departments.map((d) => ({
                      value: d.id,
                      label: d.code ? `${d.code} — ${d.name}` : d.name,
                      icon: 'ph-buildings',
                    })),
                  ]}
                />
              ) : (
                <div className={`${inputStyle} text-gray-500`}>
                  {departments.find((d) => d.id === departmentId)?.name ?? t('admin.noDeptOpt')}
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                {t('admin.deptPrimaryHelpShort')}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className={labelStyle}>{t('admin.alsoOfferedLbl')}</label>
              {canWriteCourses ? (
                <CrossListedDepartmentsPicker
                  departments={departments}
                  primaryId={departmentId}
                  selectedIds={crossListedDepartmentIds}
                  onChange={setCrossListedDepartmentIds}
                />
              ) : (
                <div className={`${inputStyle} text-gray-500 flex flex-wrap gap-1.5`}>
                  {crossListedDepartmentIds.length === 0
                    ? t('admin.noCrossListedShort')
                    : crossListedDepartmentIds.map((id) => {
                        const d = departments.find((x) => x.id === id);
                        return (
                          <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-white/10 dark:bg-black/20 border border-white/10">
                            {d ? (d.code ? `${d.code} — ${d.name}` : d.name) : id}
                          </span>
                        );
                      })}
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                {t('admin.crossListHelpEdit')}
              </p>
            </div>
            <div>
              <label className={labelStyle}>{t('admin.regPeriodLbl')}</label>
              {canWriteCourses ? (
                <GlassDropdown
                  value={matchedPeriodId}
                  onChange={setSemesterFromPeriod}
                  direction="up"
                  options={periodOptions}
                />
              ) : (
                <div className={`${inputStyle} text-gray-500`}>
                  {semester || t('admin.noRegPeriodOpt')}
                </div>
              )}
              {semester && !matchedPeriodId && (
                <p className="text-[10px] text-yellow-400 mt-1">
                  {t('admin.storedAsMismatchHint', { value: semester })}
                </p>
              )}
            </div>
            <div className="md:col-span-2">
              <label className={labelStyle}>{t('admin.descriptionLbl')}</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputStyle} disabled={!canWriteCourses} />
            </div>

            {/* Default staff — Lectures inherit the professor, Labs inherit
                the TA. Admin can override per section in the Sections panel
                below. */}
            <div>
              <label className={labelStyle}>{t('admin.defaultProfLectures')}</label>
              {canWriteCourses ? (
                <GlassDropdown
                  value={defaultInstructorId}
                  onChange={setDefaultInstructorId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDefaultOpt'), icon: 'ph-user' },
                    ...professors.map((p) => ({
                      value: p.id,
                      label: `${p.firstName} ${p.lastName}`,
                      icon: 'ph-chalkboard-teacher',
                    })),
                  ]}
                />
              ) : (
                <div className={`${inputStyle} text-gray-500`}>
                  {(() => {
                    const p = professors.find((x) => x.id === defaultInstructorId);
                    return p ? `${p.firstName} ${p.lastName}` : t('admin.noDefaultOpt');
                  })()}
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                {t('admin.defaultProfHelp')}
              </p>
            </div>
            <div>
              <label className={labelStyle}>{t('admin.defaultTaLabs')}</label>
              {canWriteCourses ? (
                <GlassDropdown
                  value={defaultTaId}
                  onChange={setDefaultTaId}
                  direction="up"
                  options={[
                    { value: '', label: t('admin.noDefaultOpt'), icon: 'ph-user' },
                    ...teachingAssistants.map((p) => ({
                      value: p.id,
                      label: `${p.firstName} ${p.lastName}`,
                      icon: 'ph-graduation-cap',
                    })),
                  ]}
                />
              ) : (
                <div className={`${inputStyle} text-gray-500`}>
                  {(() => {
                    const taFound = teachingAssistants.find((x) => x.id === defaultTaId);
                    return taFound ? `${taFound.firstName} ${taFound.lastName}` : t('admin.noDefaultOpt');
                  })()}
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                {t('admin.defaultTaHelp')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 mt-4 mb-4">
            <div
              onClick={() => canWriteCourses && setLectureOnly(!lectureOnly)}
              className={`flex items-center gap-2 text-sm text-black dark:text-gray-300 ${canWriteCourses ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <GlassCheckbox checked={lectureOnly} onChange={setLectureOnly} size="sm" disabled={!canWriteCourses} />
              <span>{t('admin.lectureOnlyCheck')}</span>
            </div>
            <div
              onClick={() => canWriteCourses && setIsActive(!isActive)}
              className={`flex items-center gap-2 text-sm text-black dark:text-gray-300 ${canWriteCourses ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <GlassCheckbox checked={isActive} onChange={setIsActive} size="sm" disabled={!canWriteCourses} />
              <span>{t('admin.activeOfferedCheck')}</span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {canDeleteCourses && (
              <button onClick={deleteCourse} className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/30 text-sm font-bold hover:bg-red-500/20 transition-colors">
                <i className="ph-bold ph-trash mr-1"></i> {t('admin.softDeleteCourseBtn')}
              </button>
            )}
            {canWriteCourses && (
              <button onClick={saveCourse} className="px-6 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20">
                {t('admin.saveCourseSimple')}
              </button>
            )}
          </div>
        </div>
      </AnimateOnView>
      </>
      )}

      {activeTab === 'sections' && (
      /* Sections */
      <AnimateOnView enabled={false}>
        <SectionsManager
          course={course}
          professors={professors}
          teachingAssistants={teachingAssistants}
          halls={halls}
          canWrite={canWriteCourses}
          canDelete={canDeleteCourses}
          onChange={refresh}
          mutate={(updater) => setCourse((prev) => (prev ? updater(prev) : prev))}
        />
      </AnimateOnView>
      )}

      {activeTab === 'enrolled' && (
        <AnimateOnView enabled={false}>
          <EnrolledStudentsPanel courseCode={course.code} />
        </AnimateOnView>
      )}
    </div>
  );
};

// ── Sections list + per-section editor (slots, TAs) ─────────────────────────

interface SectionsProps {
  course: CourseFull;
  professors: PersonLite[];
  teachingAssistants: PersonLite[];
  halls: HallLite[];
  canWrite: boolean;
  canDelete: boolean;
  onChange: () => void;
  // Preview mode — applies an optimistic local mutation to the parent's course.
  mutate: (updater: (prev: CourseFull) => CourseFull) => void;
}

const SectionsManager: React.FC<SectionsProps> = ({ course, professors, teachingAssistants, halls, canWrite, canDelete, mutate }) => {
  const t = useT();
  // Two-button create flow. `addingType` controls which form is open:
  //   null     → no form
  //   'Lecture'→ form pre-set to Lecture, professor picker visible
  //   'Lab'    → form pre-set to Lab, TA picker visible
  const [addingType, setAddingType] = useState<SectionType | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview mode — append the new section to the parent's course state. No network.
  const handleAdd = async (data: NewSectionData) => {
    setError(null);
    const hall = halls.find((h) => h.id === data.hallId) ?? null;
    const instructor =
      [...professors, ...teachingAssistants].find((p) => p.id === data.instructorId) ?? null;
    const created: Section = {
      id: `${course.code}-sec-${Date.now()}`,
      sectionId: data.sectionId,
      type: data.type,
      capacity: data.capacity,
      enrolled: 0,
      semester: data.semester,
      year: data.year,
      room: data.room,
      location: data.location,
      hallId: data.hallId,
      hall,
      instructorId: data.instructorId,
      instructor,
      instructorName: null,
      slots: [],
      taAssignments: [],
    };
    mutate((prev) => ({ ...prev, sections: [...prev.sections, created] }));
    setAddingType(null);
  };

  const lectureCount = course.sections.filter((s) => s.type === 'Lecture').length;
  const labCount = course.sections.filter((s) => s.type === 'Lab').length;

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-black dark:text-white font-bold text-lg flex items-center gap-2">
          <i className="ph-bold ph-stack text-[#6A3FF4]"></i> {t('admin.sectionsHeading')}
          <span className="text-xs text-gray-500 font-normal ml-1">
            {t('admin.lecturesCountLabel', {
              lec: lectureCount,
              lecLabel: lectureCount === 1 ? t('admin.lectureWord') : t('admin.lecturesWord'),
              lab: labCount,
              labLabel: labCount === 1 ? t('admin.labWord') : t('admin.labsWord'),
            })}
          </span>
        </h2>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddingType((cur) => (cur === 'Lecture' ? null : 'Lecture'))}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border ${
                addingType === 'Lecture'
                  ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 text-[#7B5AFF]'
                  : 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] border-transparent text-white hover:opacity-90 shadow-lg shadow-purple-500/20'
              }`}
            >
              <i className={`ph-bold ${addingType === 'Lecture' ? 'ph-x' : 'ph-book-open'}`}></i>
              {addingType === 'Lecture' ? t('admin.cancelShort') : t('admin.addLectureBtn')}
            </button>
            <button
              onClick={() => setAddingType((cur) => (cur === 'Lab' ? null : 'Lab'))}
              className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border ${
                addingType === 'Lab'
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'bg-blue-500/20 border-blue-500/30 text-blue-300 hover:bg-blue-500/30'
              }`}
            >
              <i className={`ph-bold ${addingType === 'Lab' ? 'ph-x' : 'ph-flask'}`}></i>
              {addingType === 'Lab' ? t('admin.cancelShort') : t('admin.addLabBtn')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {addingType && (
        <NewSectionForm
          forcedType={addingType}
          professors={professors}
          teachingAssistants={teachingAssistants}
          halls={halls}
          // Course-level default staff — pre-fills the instructor picker
          // unless the admin overrides for this section.
          defaultInstructorId={course.defaultInstructorId ?? null}
          defaultTaId={course.defaultTaId ?? null}
          onCancel={() => setAddingType(null)}
          onSubmit={handleAdd}
        />
      )}

      {course.sections.length === 0 ? (
        <p className="text-sm text-gray-500 italic mt-2">{t('admin.noSectionsYet')}</p>
      ) : (
        <div className="space-y-4 mt-4">
          {course.sections.map((s) => (
            <SectionCard
              key={s.id}
              section={s}
              professors={professors}
              teachingAssistants={teachingAssistants}
              halls={halls}
              canWrite={canWrite}
              canDelete={canDelete}
              mutate={mutate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface NewSectionData {
  sectionId: string;
  type: SectionType;
  instructorId: string | null;
  capacity: number;
  semester: string | null;
  year: number | null;
  room: string | null;
  location: string | null;
  hallId: string;
}

const NewSectionForm: React.FC<{
  forcedType: SectionType;
  professors: PersonLite[];
  teachingAssistants: PersonLite[];
  halls: HallLite[];
  defaultInstructorId?: string | null;
  defaultTaId?: string | null;
  onSubmit: (d: NewSectionData) => void;
  onCancel: () => void;
}> = ({ forcedType, professors, teachingAssistants, halls, defaultInstructorId, defaultTaId, onSubmit, onCancel }) => {
  const t = useT();
  const [sectionId, setSectionId] = useState('');
  // For Lecture: instructor is a professor → instructorId points to a User with role=professor
  // For Lab:     instructor is a TA        → instructorId points to a User with role=ta
  // The schema's instructorId is just a User FK; the role discrimination is
  // a UI/UX convention enforced by the backend role check on save.
  // Pre-fills with the course's default staff for the type — admin can
  // pick someone else before saving.
  const [instructorId, setInstructorId] = useState(
    forcedType === 'Lecture' ? (defaultInstructorId || '') : (defaultTaId || '')
  );
  const [capacity, setCapacity] = useState(30);
  const [semester, setSemester] = useState('');
  const [year, setYear] = useState<string>('');
  const [hallId, setHallId] = useState('');
  const [location, setLocation] = useState('');

  const activeHalls = halls.filter((h) => h.isActive);
  const hallOptions = [
    { value: '', label: t('admin.selectHallOpt'), icon: 'ph-door' },
    ...activeHalls.map((h) => ({
      value: h.id,
      label: `${h.name} · ${h.capacity} seats${h.building || h.room ? ` · ${[h.building, h.room].filter(Boolean).join('-')}` : ''}`,
      icon: 'ph-door-open',
    })),
  ];

  const isLecture = forcedType === 'Lecture';
  const peopleList = isLecture ? professors : teachingAssistants;
  const personRoleLabel = isLecture ? t('admin.professorLabel') : t('admin.teachingAssistantLabel');
  const personFieldLabel = isLecture ? t('admin.lecturerProfessor') : t('admin.labInstructorTA');
  const personIcon = isLecture ? 'ph-chalkboard-teacher' : 'ph-graduation-cap';
  const accentBadge = isLecture
    ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30'
    : 'bg-blue-500/20 text-blue-300 border-blue-500/30';

  const personOptions = [
    { value: '', label: t('admin.noRoleOpt', { role: personRoleLabel.toLowerCase() }), icon: 'ph-user' },
    ...peopleList.map((p) => ({
      value: p.id,
      label: `${p.firstName} ${p.lastName}`,
      icon: personIcon,
    })),
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 mt-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${accentBadge}`}>
          {t('admin.newSectionTypeBadge', { type: forcedType })}
        </span>
        <span className="text-xs text-gray-500">
          {isLecture ? t('admin.lecturesLedByProf') : t('admin.labsLedByTA')}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelStyle}>{t('admin.sectionIdLabel', { sample: isLecture ? 'L1' : 'B1' })}</label>
          <input value={sectionId} onChange={(e) => setSectionId(e.target.value)} className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{personFieldLabel}</label>
          {peopleList.length === 0 ? (
            <p className="text-xs text-gray-500 italic mt-2">
              {t('admin.noPeopleExistHint', { role: personRoleLabel.toLowerCase() })}
            </p>
          ) : (
            <GlassDropdown value={instructorId} onChange={setInstructorId} options={personOptions} direction="up" />
          )}
        </div>
        <div>
          <label className={labelStyle}>{t('admin.capacityLbl')}</label>
          <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.semesterLbl')}</label>
          <input value={semester} onChange={(e) => setSemester(e.target.value)} placeholder={t('admin.phFall2025')} className={inputStyle} />
        </div>
        <div>
          <label className={labelStyle}>{t('admin.yearLbl')}</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder={t('admin.ph2025')} className={inputStyle} />
        </div>
        <div className="md:col-span-2">
          <label className={labelStyle}>{t('admin.hallStarLbl')}</label>
          {activeHalls.length === 0 ? (
            <p className="text-xs text-amber-400 italic mt-2">
              {t('admin.noActiveHallsHint')} <a href="/admin/halls" className="underline">{t('admin.halls')}</a> {t('admin.noHallsBefore')}
            </p>
          ) : (
            <GlassDropdown value={hallId} onChange={setHallId} options={hallOptions} direction="up" />
          )}
        </div>
        <div className="md:col-span-2">
          <label className={labelStyle}>{t('admin.locationLbl')}</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('admin.phMainBuilding')} className={inputStyle} />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-black dark:text-white text-sm hover:bg-white/10">
          {t('common.cancel')}
        </button>
        <button
          onClick={() =>
            onSubmit({
              sectionId: sectionId.trim(),
              type: forcedType,
              instructorId: instructorId || null,
              capacity,
              semester: semester || null,
              year: year ? Number(year) : null,
              room: null,
              location: location || null,
              hallId,
            })
          }
          disabled={!sectionId.trim() || !hallId}
          className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
        >
          {t('admin.createSectionBtn', { type: forcedType })}
        </button>
      </div>
    </div>
  );
};

const SectionCard: React.FC<{
  section: Section;
  professors: PersonLite[];
  teachingAssistants: PersonLite[];
  halls: HallLite[];
  canWrite: boolean;
  canDelete: boolean;
  // Preview mode — applies an optimistic local mutation to the parent's course.
  mutate: (updater: (prev: CourseFull) => CourseFull) => void;
}> = ({ section, professors, teachingAssistants, halls, canWrite, canDelete, mutate }) => {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Section meta edit state
  const [instructorId, setInstructorId] = useState(section.instructorId ?? '');
  const [capacity, setCapacity] = useState(section.capacity);
  const [hallId, setHallId] = useState(section.hallId ?? '');
  // New slot inputs
  const [newDay, setNewDay] = useState<DayOfWeek>('Sunday');
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('10:30');
  const [newRoom, setNewRoom] = useState('');

  const activeHalls = halls.filter((h) => h.isActive || h.id === section.hallId);
  const hallOptions = [
    { value: '', label: t('admin.selectHallOpt'), icon: 'ph-door' },
    ...activeHalls.map((h) => ({
      value: h.id,
      label: `${h.name} · ${h.capacity} seats${h.building || h.room ? ` · ${[h.building, h.room].filter(Boolean).join('-')}` : ''}`,
      icon: 'ph-door-open',
    })),
  ];

  // Preview mode — all section mutations apply to the parent's course state.
  const saveMeta = async () => {
    setError(null);
    const hall = halls.find((h) => h.id === hallId) ?? null;
    const instructor =
      [...professors, ...teachingAssistants].find((p) => p.id === instructorId) ?? null;
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === section.id
          ? { ...s, instructorId: instructorId || null, instructor, capacity, hallId: hallId || null, hall }
          : s,
      ),
    }));
    setEditing(false);
    window.dispatchEvent(new Event('uniflow:courses-updated'));
  };

  const removeSection = async () => {
    if (!window.confirm(t('admin.confirmDeleteSection', { id: section.sectionId }))) return;
    mutate((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== section.id) }));
  };

  const addSlot = async () => {
    setError(null);
    const slot: Slot = {
      id: `slot-${Date.now()}`,
      day: newDay,
      startTime: newStart,
      endTime: newEnd,
      room: newRoom || null,
    };
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === section.id ? { ...s, slots: [...s.slots, slot] } : s,
      ),
    }));
    setNewRoom('');
  };

  const removeSlot = async (slotId: string) => {
    mutate((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === section.id ? { ...s, slots: s.slots.filter((sl) => sl.id !== slotId) } : s,
      ),
    }));
  };

  // Section-type-driven picker: Lecture sections are led by a professor;
  // Lab sections are led by a TA. The picker swaps role list based on type.
  const isLecture = section.type === 'Lecture';
  const peopleList = isLecture ? professors : teachingAssistants;
  const personLabel = isLecture ? t('admin.lecturerProfessor') : t('admin.labInstructorTA');
  const personIcon = isLecture ? 'ph-chalkboard-teacher' : 'ph-graduation-cap';
  const noneLabel = isLecture ? t('admin.noProfessorOpt') : t('admin.noTAOpt');
  const profOptions = [
    { value: '', label: noneLabel, icon: 'ph-user' },
    ...peopleList.map((p) => ({ value: p.id, label: `${p.firstName} ${p.lastName}`, icon: personIcon })),
  ];

  const dayLabelMap: Record<DayOfWeek, string> = {
    Saturday: t('admin.daySaturday'),
    Sunday: t('admin.daySunday'),
    Monday: t('admin.dayMonday'),
    Tuesday: t('admin.dayTuesday'),
    Wednesday: t('admin.dayWednesday'),
    Thursday: t('admin.dayThursday'),
    Friday: t('admin.dayFriday'),
  };
  const dayOptions = ALL_DAYS.map((d) => ({ value: d, label: dayLabelMap[d], icon: 'ph-calendar' }));

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 dark:bg-black/10 p-4">
      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-black dark:text-white font-bold text-lg">{section.sectionId}</span>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
              isLecture
                ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30'
                : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
            }`}>
              {section.type}
            </span>
            <span className="text-xs text-gray-500">
              {t('admin.enrolledOfCapacity', { enrolled: section.enrolled, capacity: section.capacity })}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {(() => {
              const name = section.instructor
                ? `${section.instructor.firstName} ${section.instructor.lastName}`
                : section.instructorName ?? null;
              if (!name) return t('admin.unassignedShort');
              return isLecture ? `${t('admin.profPrefix')}${name}` : `${t('admin.taPrefix')}${name}`;
            })()}
            {section.semester ? ` · ${section.semester}` : ''}
            {section.year ? ` ${section.year}` : ''}
          </p>
          <p className="text-xs mt-1">
            {section.hall ? (
              <span className="text-[#7B5AFF]">
                <i className="ph-bold ph-door-open mr-1"></i>
                {section.hall.name}
                {section.hall.building || section.hall.room
                  ? ` · ${[section.hall.building, section.hall.room].filter(Boolean).join('-')}`
                  : ''}
              </span>
            ) : (
              <span className="text-amber-400 italic">
                <i className="ph-bold ph-warning-circle mr-1"></i>
                {t('admin.noHallAssignedTxt')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite && (
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-xs px-2 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-black dark:text-white"
            >
              <i className={`ph-bold ${editing ? 'ph-x' : 'ph-pencil-simple'}`}></i> {editing ? t('common.cancel') : t('common.edit')}
            </button>
          )}
          {canDelete && (
            <button
              onClick={removeSection}
              className="text-xs px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
            >
              <i className="ph-bold ph-trash"></i>
            </button>
          )}
        </div>
      </div>

      {editing && canWrite && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-3 rounded-lg bg-white/5">
          <div>
            <label className={labelStyle}>{personLabel}</label>
            <GlassDropdown value={instructorId} onChange={setInstructorId} options={profOptions} direction="up" />
          </div>
          <div>
            <label className={labelStyle}>{t('admin.capacityLbl')}</label>
            <input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className={inputStyle} />
          </div>
          <div>
            <label className={labelStyle}>{t('admin.hallStarLbl')}</label>
            {activeHalls.length === 0 ? (
              <p className="text-xs text-amber-400 italic mt-2">
                {t('admin.noHallsAvailable')} <a href="/admin/halls" className="underline">{t('admin.halls2')}</a>.
              </p>
            ) : (
              <GlassDropdown value={hallId} onChange={setHallId} options={hallOptions} direction="up" />
            )}
          </div>
          <div className="md:col-span-3 flex justify-end">
            <button onClick={saveMeta} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90">
              {t('admin.saveSectionBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Slots */}
      <div className="mb-3">
        <h4 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          {t('admin.scheduleHeading', {
            n: section.slots.length,
            label: section.slots.length === 1 ? t('admin.slotWord') : t('admin.slotsWord'),
          })}
        </h4>
        {section.slots.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t('admin.noSlotsYet')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {section.slots.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-white/5 dark:bg-black/10 rounded-lg px-3 py-2 border border-white/10">
                <div className="text-xs">
                  <span className="text-black dark:text-white font-medium">{dayLabelMap[s.day]}</span>{' '}
                  <span className="text-gray-500 font-mono">{s.startTime}–{s.endTime}</span>
                  {s.room && <span className="text-gray-500"> · {s.room}</span>}
                </div>
                {canWrite && (
                  <button onClick={() => removeSlot(s.id)} className="text-red-400 hover:text-red-300 text-xs">
                    <i className="ph-bold ph-x"></i>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {canWrite && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_1fr_auto] gap-2 mt-3">
            <GlassDropdown value={newDay} onChange={(v) => setNewDay(v as DayOfWeek)} options={dayOptions} />
            <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} className={inputStyle} />
            <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} className={inputStyle} />
            <input value={newRoom} onChange={(e) => setNewRoom(e.target.value)} placeholder={t('admin.phRoomOptional')} className={inputStyle} />
            <button onClick={addSlot} className="px-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-black dark:text-white text-sm">
              <i className="ph-bold ph-plus"></i>
            </button>
          </div>
        )}
      </div>

      {/* TA management is exclusively a Lab concept now: the Lab's lead
          instructor IS a TA, set via the section's instructor field above.
          Lectures intentionally have no TA UI — the role split is clean. */}
    </div>
  );
};

// ── Enrolled Students tab ──────────────────────────────────────────────────
//
// Roster grouped by user. Each row shows the student + the chips of every
// section they're registered for (lecture purple, lab amber). Two actions:
//   • Drop — confirms, then fires POST /api/registrations/drop once per
//     registrationId. Pending rows stop the dropdown from getting stale on
//     the next refetch.
//   • Override Grade — navigates to the existing per-student grade override
//     page; no API call from here.

interface EnrolledRegistration {
  registrationId: string;
  sectionId: string;
  sectionLabel: string;
  type: string;
  status: 'approved' | 'pending';
  createdAt: string;
}

interface EnrolledRow {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    level: number | null;
    gpa: number | null;
    program: string | null;
  };
  registrations: EnrolledRegistration[];
}

interface EnrolledResponse {
  course: { id: string; code: string; title: string };
  counts: { students: number; sections: number };
  enrolled: EnrolledRow[];
}

type EnrolledStatusFilter = 'approved' | 'pending' | 'all';

const EnrolledStudentsPanel: React.FC<{ courseCode: string }> = ({ courseCode }) => {
  const t = useT();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<EnrolledStatusFilter>('approved');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<EnrolledResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<string | null>(null); // userId being dropped
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null); // userId pending confirm
  const [actionMsg, setActionMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const fetchEnrolled = useCallback(async () => {
    // Preview mode — synthesise an enrolled roster. No network. The status
    // filter narrows the static set so the picker visibly works.
    setLoading(true);
    setError(null);
    const sem = 'Spring 2026';
    const allRows: EnrolledRow[] = [
      {
        user: { id: 'u-omar', firstName: 'Omar', lastName: 'Khaled', email: 'omar.khaled@fcds.edu', level: 2, gpa: 3.42, program: 'Computer Science' },
        registrations: [
          { registrationId: 'r-omar-l1', sectionId: `${courseCode}-L1`, sectionLabel: 'L1', type: 'Lecture', status: 'approved', createdAt: sem },
          { registrationId: 'r-omar-b1', sectionId: `${courseCode}-B1`, sectionLabel: 'B1', type: 'Lab', status: 'approved', createdAt: sem },
        ],
      },
      {
        user: { id: 'u-sara', firstName: 'Sara', lastName: 'Mahmoud', email: 'sara.mahmoud@fcds.edu', level: 2, gpa: 3.88, program: 'Computer Science' },
        registrations: [
          { registrationId: 'r-sara-l1', sectionId: `${courseCode}-L1`, sectionLabel: 'L1', type: 'Lecture', status: 'approved', createdAt: sem },
          { registrationId: 'r-sara-b2', sectionId: `${courseCode}-B2`, sectionLabel: 'B2', type: 'Lab', status: 'approved', createdAt: sem },
        ],
      },
      {
        user: { id: 'u-nour', firstName: 'Nour', lastName: 'Hassan', email: 'nour.hassan@fcds.edu', level: 1, gpa: 3.15, program: 'Computer Science' },
        registrations: [
          { registrationId: 'r-nour-l1', sectionId: `${courseCode}-L1`, sectionLabel: 'L1', type: 'Lecture', status: 'pending', createdAt: sem },
        ],
      },
    ];
    const rows = allRows
      .map((row) => ({
        ...row,
        registrations:
          statusFilter === 'all'
            ? row.registrations
            : row.registrations.filter((r) => r.status === statusFilter),
      }))
      .filter((row) => row.registrations.length > 0);
    const sections = new Set(rows.flatMap((r) => r.registrations.map((reg) => reg.sectionId)));
    setData({
      course: { id: `c-${courseCode}`, code: courseCode, title: '' },
      counts: { students: rows.length, sections: sections.size },
      enrolled: rows,
    });
    setLoading(false);
  }, [courseCode, statusFilter]);

  useEffect(() => { fetchEnrolled(); }, [fetchEnrolled]);

  // Auto-hide the success / error banner after a couple of seconds so it
  // doesn't linger across multiple actions.
  useEffect(() => {
    if (!actionMsg) return;
    const timer = setTimeout(() => setActionMsg(null), 2500);
    return () => clearTimeout(timer);
  }, [actionMsg]);

  // Filter rows by name / email locally — the backend already caps at 50,
  // so this only fires across the visible page.
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.enrolled;
    return data.enrolled.filter((row) => {
      const fullName = `${row.user.firstName} ${row.user.lastName}`.toLowerCase();
      return fullName.includes(q) || row.user.email.toLowerCase().includes(q);
    });
  }, [data, search]);

  // Preview mode — drop removes the student's rows from local state. No network.
  const handleDrop = async (row: EnrolledRow) => {
    setPendingDrop(row.user.id);
    setActionMsg(null);
    setData((prev) =>
      prev
        ? {
            ...prev,
            enrolled: prev.enrolled.filter((r) => r.user.id !== row.user.id),
            counts: { ...prev.counts, students: Math.max(0, prev.counts.students - 1) },
          }
        : prev,
    );
    setActionMsg({
      kind: 'success',
      text: t('admin.droppedFlash', { first: row.user.firstName, last: row.user.lastName, code: courseCode }),
    });
    setConfirmDrop(null);
    setPendingDrop(null);
  };

  const goOverride = (userId: string) => {
    navigate(`/admin/grade-override/${encodeURIComponent(courseCode)}/${encodeURIComponent(userId)}`);
  };

  const statusOptions = [
    { value: 'approved', label: t('admin.approvedOnlyOpt'), icon: 'ph-check-circle' },
    { value: 'pending', label: t('admin.pendingOnlyOpt'), icon: 'ph-hourglass' },
    { value: 'all', label: t('admin.allStatusesOpt'), icon: 'ph-list' },
  ];

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-black dark:text-white font-bold text-lg flex items-center gap-2">
          <i className="ph-bold ph-users text-[#6A3FF4]"></i> {t('admin.enrolledStudentsTitle')}
          {data && (
            <span className="text-xs text-gray-500 font-normal ml-1">
              {t('admin.studentsAndSectionsCount', {
                s: data.counts.students,
                sLabel: data.counts.students === 1 ? t('admin.studentWord') : t('admin.studentsWord'),
                sec: data.counts.sections,
                secLabel: data.counts.sections === 1 ? t('admin.sectionLabel') : t('admin.sectionsLabel'),
              })}
            </span>
          )}
        </h2>
      </div>

      {/* Filter row — status picker opens upward so the menu doesn't cover
          the table rows below. */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.searchNameEmailPh')}
            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
          />
        </div>
        <div className="min-w-[180px]">
          <GlassDropdown
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as EnrolledStatusFilter)}
            options={statusOptions}
            direction="up"
            className="w-full"
          />
        </div>
      </div>

      {actionMsg && (
        <div className={`mb-3 rounded-xl border p-3 text-sm ${
          actionMsg.kind === 'success'
            ? 'border-green-500/30 bg-green-500/10 text-green-300'
            : 'border-red-500/30 bg-red-500/10 text-red-300'
        }`}>
          <i className={`ph-bold ${actionMsg.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'} mr-2`}></i>
          {actionMsg.text}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <i className="ph-duotone ph-spinner animate-spin text-3xl text-[#6A3FF4]"></i>
        </div>
      ) : filteredRows.length === 0 ? (
        <p className="text-sm text-gray-500 italic text-center py-8">
          {search.trim()
            ? t('admin.noStudentsMatchSearch')
            : statusFilter === 'pending'
              ? t('admin.noPendingRegistrations')
              : t('admin.noStudentsEnrolledYet')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-white/10">
                <th className="py-2 pr-3">{t('admin.nameCol2')}</th>
                <th className="py-2 pr-3">{t('admin.emailCol')}</th>
                <th className="py-2 pr-3">{t('admin.levelColEnrolled')}</th>
                <th className="py-2 pr-3">{t('admin.gpaCol2')}</th>
                <th className="py-2 pr-3">{t('admin.sectionsCol')}</th>
                <th className="py-2 pr-3 text-right">{t('admin.actionsRightCol')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isPending = pendingDrop === row.user.id;
                const isConfirm = confirmDrop === row.user.id;
                return (
                  <tr key={row.user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 pr-3 text-black dark:text-white font-medium">
                      {row.user.firstName} {row.user.lastName}
                      {row.user.program && (
                        <div className="text-[10px] text-gray-500 mt-0.5">{row.user.program}</div>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-gray-400 text-xs">{row.user.email}</td>
                    <td className="py-3 pr-3 text-gray-300 text-xs">
                      {row.user.level != null ? row.user.level : <span className="text-gray-500">—</span>}
                    </td>
                    <td className="py-3 pr-3 text-gray-300 text-xs">
                      {row.user.gpa != null && !Number.isNaN(Number(row.user.gpa))
                        ? Number(row.user.gpa).toFixed(2)
                        : <span className="text-gray-500">—</span>}
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {row.registrations.map((r) => {
                          // Backend `sectionLabel` already encodes the type
                          // prefix ("L1" for lectures, "S2" for labs / sections);
                          // chip colour is the only thing the type drives here.
                          const isLecture = r.type === 'Lecture';
                          const chipColor = isLecture
                            ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30';
                          return (
                            <span
                              key={r.registrationId}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${chipColor}`}
                              title={`${r.type} ${r.sectionLabel} · ${r.status}`}
                            >
                              {r.sectionLabel}
                              {r.status === 'pending' ? ' •' : ''}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-right">
                      {isConfirm ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {t('admin.dropFromCoursePrompt', { code: courseCode })}
                          </span>
                          <button
                            onClick={() => handleDrop(row)}
                            disabled={isPending}
                            className="text-xs px-3 py-1 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 disabled:opacity-60"
                          >
                            {isPending ? t('admin.droppingDots') : t('admin.confirmDropBtn')}
                          </button>
                          <button
                            onClick={() => setConfirmDrop(null)}
                            disabled={isPending}
                            className="text-xs px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-black dark:text-white hover:bg-white/10"
                          >
                            {t('admin.cancelDropBtn')}
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => goOverride(row.user.id)}
                            className="text-xs px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[#7B5AFF] hover:bg-[#6A3FF4]/10"
                          >
                            <i className="ph-bold ph-pencil-line mr-1"></i> {t('admin.overrideGradeBtn')}
                          </button>
                          <button
                            onClick={() => setConfirmDrop(row.user.id)}
                            className="text-xs px-3 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                          >
                            <i className="ph-bold ph-x-circle mr-1"></i> {t('admin.dropBtn')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {data && data.counts.students > 0 && (
            <p className="text-xs text-gray-500 italic mt-3 text-center">
              {t('admin.studentsEnrolledFooter', {
                s: data.counts.students,
                sLabel: data.counts.students === 1 ? t('admin.studentWord') : t('admin.studentsWord'),
                sec: data.counts.sections,
                secLabel: data.counts.sections === 1 ? t('admin.sectionLabel') : t('admin.sectionsLabel'),
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ManageCourseDetail;
