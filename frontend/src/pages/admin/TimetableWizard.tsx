// Timetable Wizard — admin-facing flow that:
//   1. Filters sections by department / level / semester / scope
//   2. Builds a DRY-RUN preview of proposed slot assignments
//   3. On confirm, "commits" the schedule
//
// MVP BUILD — pure front-end mockup. No backend calls. Departments, halls,
// courses, the preview generation, and commit all run on static mock data;
// preview drag-drop reorder + commit are local-only state mutations.
//
// Lives under /admin/timetable/wizard. Linked from Registration Control.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle = 'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors';
const labelStyle = 'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

interface DepartmentLite { id: string; code?: string | null; name: string }
interface HallLite {
    id: string;
    name: string;
    building?: string | null;
    room?: string | null;
    capacity: number;
    isActive: boolean;
}
interface CourseLite {
    id: string;
    code: string;
    title: string;
    level: number | null;
    semester: string | null;
    sectionCount: number;
}
interface Assignment {
    sectionId: string;
    courseId: string;
    courseCode: string;
    courseTitle: string;
    type: 'Lecture' | 'Lab' | 'Tutorial' | 'Seminar';
    capacity: number;
    hallId: string;
    hallName: string;
    hallRoom?: string | null;
    hallBuilding?: string | null;
    day: string;
    startTime: string;
    endTime: string;
    instructorId?: string | null;
    action?: 'create_slot' | 'assign_hall' | 'create_section';
    draft?: boolean;
    draftCourseId?: string;
    draftSectionLabel?: string;
    draftType?: 'Lecture' | 'Lab';
    draftCapacity?: number;
}
interface Conflict {
    sectionId: string;
    courseCode: string;
    type: string;
    reason: string;
}
interface PreviewResponse {
    success: true;
    sectionCount: number;
    skippedCount?: number;
    draftedCount?: number;
    assignments: Assignment[];
    conflicts: Conflict[];
    policy: { workingDays: string[]; slotMinutes: number; dayStart: string; dayEnd: string };
    message?: string;
}

type Step = 'filter' | 'preview' | 'done';

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_DEPARTMENTS: DepartmentLite[] = [
    { id: 'dept-cs', code: 'CS', name: 'Computer Science' },
    { id: 'dept-ds', code: 'DS', name: 'Data Science' },
    { id: 'dept-cy', code: 'CY', name: 'Cybersecurity' },
    { id: 'dept-ma', code: 'MA', name: 'Mathematics' },
    { id: 'dept-bu', code: 'BU', name: 'Business Informatics' },
];

const MOCK_HALLS: HallLite[] = [
    { id: 'h1', name: 'Hall A-101', building: 'A', room: '101', capacity: 200, isActive: true },
    { id: 'h2', name: 'Lab C-204', building: 'C', room: '204', capacity: 40, isActive: true },
    { id: 'h3', name: 'Hall B-202', building: 'B', room: '202', capacity: 150, isActive: true },
    { id: 'h4', name: 'Hall D-301', building: 'D', room: '301', capacity: 90, isActive: true },
    { id: 'h5', name: 'Lab C-205', building: 'C', room: '205', capacity: 35, isActive: true },
];

const MOCK_COURSES: CourseLite[] = [
    { id: 'c-cs101', code: 'CS101', title: 'Introduction to Programming', level: 1, semester: 'Fall', sectionCount: 2 },
    { id: 'c-cs201', code: 'CS201', title: 'Data Structures', level: 2, semester: 'Fall', sectionCount: 2 },
    { id: 'c-cs301', code: 'CS301', title: 'Operating Systems', level: 3, semester: 'Fall', sectionCount: 1 },
    { id: 'c-ds310', code: 'DS310', title: 'Machine Learning', level: 3, semester: 'Fall', sectionCount: 2 },
    { id: 'c-cy220', code: 'CY220', title: 'Network Security', level: 2, semester: 'Fall', sectionCount: 1 },
    { id: 'c-ma205', code: 'MA205', title: 'Linear Algebra', level: 2, semester: 'Fall', sectionCount: 1 },
];

const MOCK_POLICY = {
    workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    slotMinutes: 120,
    dayStart: '08:00',
    dayEnd: '20:00',
};

const TimetableWizard: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [step, setStep] = useState<Step>('filter');

    // Filter state
    const [departmentId, setDepartmentId] = useState('');
    const [level, setLevel] = useState<string>('');           // '' = any
    const [semester, setSemester] = useState('');
    const [scope, setScope] = useState<'all_lectures' | 'specific'>('all_lectures');
    const [includeLabs, setIncludeLabs] = useState(true);
    const [departments] = useState<DepartmentLite[]>(MOCK_DEPARTMENTS);

    // Course multi-select state (only used when scope='specific').
    const [courses, setCourses] = useState<CourseLite[]>([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
    const [courseSearch, setCourseSearch] = useState('');

    // Slot length override. Empty string = use the policy.
    const [slotMinutes, setSlotMinutes] = useState<string>('');

    // How many sections of each type to draft per course.
    const [lectureCount, setLectureCount] = useState<number>(1);
    const [labCount, setLabCount] = useState<number>(1);

    // Halls scope. Empty set = use all active halls.
    const [halls] = useState<HallLite[]>(MOCK_HALLS);
    const [selectedHallIds, setSelectedHallIds] = useState<Set<string>>(new Set());

    // Preview state
    const [preview, setPreview] = useState<PreviewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Commit state
    const [committing, setCommitting] = useState(false);
    const [committed, setCommitted] = useState<{ written: number; sectionCount: number } | null>(null);

    // Preview drag-drop state.
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Stable key for an assignment row.
    const assignmentKey = (a: Assignment) => `${a.sectionId}|${a.day}|${a.startTime}`;

    const reorderPreviewRows = (draggedKey: string, targetKey: string) => {
        if (!preview || draggedKey === targetKey) return;
        const fromIdx = preview.assignments.findIndex((a) => assignmentKey(a) === draggedKey);
        const toIdx = preview.assignments.findIndex((a) => assignmentKey(a) === targetKey);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

        // Snapshot the slot grid by visual position — these don't move.
        const slots = preview.assignments.map((a) => ({
            day: a.day,
            startTime: a.startTime,
            endTime: a.endTime,
            hallId: a.hallId,
            hallName: a.hallName,
            hallBuilding: a.hallBuilding,
            hallRoom: a.hallRoom,
        }));

        // Splice the identity list — that's the user's drag/drop intent.
        const ids = [...preview.assignments];
        const [moved] = ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, moved);

        // Glue identity i ← slot[i] so each row shows the slot that lives
        // at its new visual position.
        const next = ids.map((a, i) => ({ ...a, ...slots[i] }));

        // Validate the new arrangement: no two rows may share (hall+slot),
        // (instructor+slot), or (course+slot).
        for (let i = 0; i < next.length; i++) {
            for (let j = i + 1; j < next.length; j++) {
                const x = next[i];
                const y = next[j];
                if (x.day !== y.day || x.startTime !== y.startTime) continue;
                if (x.hallId === y.hallId) {
                    setFlash({ kind: 'err', text: t('admin.reorderBlockedHallTwice', { hall: x.hallName, day: x.day, time: x.startTime }) });
                    setTimeout(() => setFlash(null), 4000);
                    return;
                }
                if (x.instructorId && x.instructorId === y.instructorId) {
                    setFlash({ kind: 'err', text: t('admin.reorderBlockedInstructor', { day: x.day, time: x.startTime }) });
                    setTimeout(() => setFlash(null), 4000);
                    return;
                }
                if (x.courseId === y.courseId) {
                    setFlash({ kind: 'err', text: t('admin.reorderBlockedSameCourse', { code: x.courseCode, day: x.day, time: x.startTime }) });
                    setTimeout(() => setFlash(null), 4000);
                    return;
                }
            }
        }

        setPreview({ ...preview, assignments: next });
        setFlash({
            kind: 'ok',
            text: t('admin.reorderMovedFlash', { code: moved.courseCode, type: moved.type, row: toIdx + 1 }),
        });
        setTimeout(() => setFlash(null), 2500);
    };

    // Load eligible courses for the multi-select whenever scope='specific'
    // and filter changes (from mock data).
    useEffect(() => {
        if (scope !== 'specific') return;
        setCoursesLoading(true);
        const id = window.setTimeout(() => {
            const deptCode = departments.find((d) => d.id === departmentId)?.code ?? null;
            const list = MOCK_COURSES.filter((c) => {
                if (deptCode && !c.code.startsWith(deptCode)) return false;
                if (level && String(c.level) !== level) return false;
                if (semester && c.semester && !c.semester.toLowerCase().includes(semester.toLowerCase())) return false;
                return true;
            });
            setCourses(list);
            // Drop selections that fell out of scope.
            const validIds = new Set(list.map((c) => c.id));
            setSelectedCourseIds((prev) => {
                const next = new Set<string>();
                prev.forEach((cid) => { if (validIds.has(cid)) next.add(cid); });
                return next;
            });
            setCoursesLoading(false);
        }, 200);
        return () => window.clearTimeout(id);
    }, [scope, departmentId, level, semester, departments]);

    // Build a dry-run preview from the mock data + chosen filters.
    const runPreview = useCallback(() => {
        setLoading(true);
        setError(null);
        window.setTimeout(() => {
            const deptCode = departments.find((d) => d.id === departmentId)?.code ?? null;
            // Choose the base course set.
            let baseCourses: CourseLite[] =
                scope === 'specific'
                    ? MOCK_COURSES.filter((c) => selectedCourseIds.has(c.id))
                    : MOCK_COURSES.filter((c) => {
                          if (deptCode && !c.code.startsWith(deptCode)) return false;
                          if (level && String(c.level) !== level) return false;
                          return true;
                      });

            const slotMin = slotMinutes ? Number(slotMinutes) : MOCK_POLICY.slotMinutes;
            const activeHalls = selectedHallIds.size > 0
                ? halls.filter((h) => selectedHallIds.has(h.id))
                : halls;
            const lectureHalls = activeHalls.filter((h) => h.capacity >= 80);
            const labHalls = activeHalls.filter((h) => h.capacity < 80);

            const days = MOCK_POLICY.workingDays;
            const startMins = [8 * 60, 10 * 60, 12 * 60, 14 * 60, 16 * 60];
            const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

            const assignments: Assignment[] = [];
            const conflicts: Conflict[] = [];
            let slotCursor = 0;
            const nextSlot = () => {
                const day = days[slotCursor % days.length];
                const startMin = startMins[Math.floor(slotCursor / days.length) % startMins.length];
                slotCursor++;
                return { day, start: fromMin(startMin), end: fromMin(startMin + slotMin) };
            };

            let sectionCount = 0;
            baseCourses.forEach((c, ci) => {
                // Lecture sections
                for (let li = 0; li < Math.max(1, lectureCount); li++) {
                    sectionCount++;
                    const hall = lectureHalls[(ci + li) % Math.max(1, lectureHalls.length)] ?? activeHalls[0];
                    const slot = nextSlot();
                    if (!hall) {
                        conflicts.push({ sectionId: `${c.id}-L${li + 1}`, courseCode: c.code, type: 'Lecture', reason: 'No eligible hall has sufficient capacity.' });
                        continue;
                    }
                    assignments.push({
                        sectionId: `${c.id}-L${li + 1}`,
                        courseId: c.id,
                        courseCode: c.code,
                        courseTitle: c.title,
                        type: 'Lecture',
                        capacity: Math.ceil(hall.capacity * 0.9),
                        hallId: hall.id,
                        hallName: hall.name,
                        hallBuilding: hall.building,
                        hallRoom: hall.room,
                        day: slot.day,
                        startTime: slot.start,
                        endTime: slot.end,
                        instructorId: `inst-${ci}`,
                        action: 'create_section',
                        draft: true,
                        draftCourseId: c.id,
                        draftSectionLabel: `L${li + 1}`,
                        draftType: 'Lecture',
                        draftCapacity: Math.ceil(hall.capacity * 0.9),
                    });
                }
                // Lab sections
                if (includeLabs) {
                    for (let bi = 0; bi < Math.max(1, labCount); bi++) {
                        sectionCount++;
                        const hall = labHalls[(ci + bi) % Math.max(1, labHalls.length)] ?? activeHalls[0];
                        const slot = nextSlot();
                        if (!hall) {
                            conflicts.push({ sectionId: `${c.id}-B${bi + 1}`, courseCode: c.code, type: 'Lab', reason: 'No eligible lab hall available.' });
                            continue;
                        }
                        assignments.push({
                            sectionId: `${c.id}-B${bi + 1}`,
                            courseId: c.id,
                            courseCode: c.code,
                            courseTitle: c.title,
                            type: 'Lab',
                            capacity: hall.capacity,
                            hallId: hall.id,
                            hallName: hall.name,
                            hallBuilding: hall.building,
                            hallRoom: hall.room,
                            day: slot.day,
                            startTime: slot.start,
                            endTime: slot.end,
                            instructorId: `inst-lab-${ci}`,
                            action: 'create_section',
                            draft: true,
                            draftCourseId: c.id,
                            draftSectionLabel: `B${bi + 1}`,
                            draftType: 'Lab',
                            draftCapacity: hall.capacity,
                        });
                    }
                }
            });

            const data: PreviewResponse = {
                success: true,
                sectionCount,
                skippedCount: 0,
                draftedCount: assignments.length,
                assignments,
                conflicts,
                policy: { ...MOCK_POLICY, slotMinutes: slotMin },
            };

            setLoading(false);
            const hasWork = data.assignments.length > 0 || data.conflicts.length > 0;
            if (!hasWork) {
                setPreview(data);
                setError(
                    data.sectionCount === 0
                        ? t('admin.noWorkEmpty')
                        : (data.sectionCount === 1
                            ? t('admin.noWorkAllScheduled', { n: data.sectionCount })
                            : t('admin.noWorkAllScheduledPlural', { n: data.sectionCount }))
                );
                return;
            }
            setPreview(data);
            setStep('preview');
        }, 500);
    }, [departmentId, level, scope, includeLabs, selectedCourseIds, slotMinutes, lectureCount, labCount, selectedHallIds, departments, halls, t]);

    // Local-only commit — just record the count and advance to the done step.
    const commit = () => {
        if (!preview) return;
        setCommitting(true);
        setError(null);
        window.setTimeout(() => {
            setCommitted({ written: preview.assignments.length, sectionCount: preview.sectionCount });
            setStep('done');
            setCommitting(false);
        }, 600);
    };

    const deptOptions = [
        { value: '', label: t('admin.allDepartmentsOptTt'), icon: 'ph-buildings' },
        ...departments.map((d) => ({ value: d.id, label: `${d.code ? d.code + ' · ' : ''}${d.name}`, icon: 'ph-buildings' })),
    ];
    const levelOptions = [
        { value: '', label: t('admin.allLevelsOptTt'), icon: 'ph-stairs' },
        ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: t('admin.levelOpt', { n }), icon: 'ph-stairs' })),
    ];
    const scopeOptions = [
        { value: 'all_lectures', label: t('admin.scopeAllSections'), icon: 'ph-stack' },
        { value: 'specific', label: t('admin.scopeSpecificOnly'), icon: 'ph-list-checks' },
    ];
    const slotOptions = [
        { value: '', label: t('admin.useSchedulePolicyDefault'), icon: 'ph-clock' },
        ...[30, 45, 60, 90, 120, 180].map((m) => ({
            value: String(m),
            label: m === 60 ? t('admin.oneHourUnit') : m === 120 ? t('admin.twoHoursUnit') : m === 180 ? t('admin.threeHoursUnit') : t('admin.minutesUnit', { n: m }),
            icon: 'ph-clock',
        })),
    ];
    const splitOptions = [1, 2, 3, 4, 5, 6].map((n) => ({
        value: String(n),
        label: n === 1 ? t('admin.sectionsOneSplit') : t('admin.sectionsNSplit', { n }),
        icon: 'ph-stack',
    }));

    // Filter the course list with the in-modal search box.
    const visibleCourses = courses.filter((c) => {
        if (!courseSearch.trim()) return true;
        const q = courseSearch.trim().toLowerCase();
        return c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
    });
    const toggleCourse = (id: string) => {
        setSelectedCourseIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const selectAllVisible = () => {
        setSelectedCourseIds((prev) => {
            const next = new Set(prev);
            for (const c of visibleCourses) next.add(c.id);
            return next;
        });
    };
    const clearSelection = () => setSelectedCourseIds(new Set());

    // Generate is disabled when scope='specific' and no course is picked.
    const canGenerate = !loading && (scope !== 'specific' || selectedCourseIds.size > 0);

    const toggleHall = (id: string) => {
        setSelectedHallIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const selectAllHalls = () => setSelectedHallIds(new Set(halls.map((h) => h.id)));
    const clearHallSelection = () => setSelectedHallIds(new Set());

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('admin.wizardTitle')}</h1>
                        <p className="text-black dark:text-gray-300 text-sm max-w-2xl">
                            {t('admin.wizardLongSubtitle')}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/admin/timetable')}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm hover:bg-white/10 text-black dark:text-white"
                    >
                        <i className="ph-bold ph-calendar mr-2" />
                        {t('admin.viewCurrentTimetable')}
                    </button>
                </div>
            </AnimateOnView>

            {/* Step indicator */}
            <div className="flex items-center gap-3 text-xs">
                {(['filter', 'preview', 'done'] as Step[]).map((s, i) => {
                    const stepLabel = s === 'filter' ? t('admin.stepLabelFilter') : s === 'preview' ? t('admin.stepLabelPreview') : t('admin.stepLabelDone');
                    return (
                    <React.Fragment key={s}>
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                            step === s
                                ? 'bg-[#6A3FF4] text-white'
                                : i < ['filter', 'preview', 'done'].indexOf(step)
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-white/5 text-gray-400'
                        }`}>
                            <span className="font-bold">{i + 1}</span>
                            <span className="capitalize">{stepLabel}</span>
                        </div>
                        {i < 2 && <i className="ph-bold ph-caret-right text-gray-500" />}
                    </React.Fragment>
                    );
                })}
            </div>

            {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>
            )}

            {step === 'filter' && (
                <div className={`${glassCardStyle} p-6 space-y-5`}>
                    <h2 className="text-base font-bold text-black dark:text-white">{t('admin.step1Filter')}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className={labelStyle}>{t('admin.departmentLabelTt')}</label>
                            <GlassDropdown value={departmentId} onChange={setDepartmentId} options={deptOptions} />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.levelLabelTt')}</label>
                            <GlassDropdown value={level} onChange={setLevel} options={levelOptions} />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.semesterFreeTextLabel')}</label>
                            <input
                                value={semester}
                                onChange={(e) => setSemester(e.target.value)}
                                placeholder={t('admin.semesterFreeTextPlaceholder')}
                                className={inputStyle}
                            />
                        </div>
                        <div className="md:col-span-3">
                            <label className={labelStyle}>{t('admin.courseScopeLabel')}</label>
                            <GlassDropdown
                                value={scope}
                                onChange={(v) => setScope(v as 'all_lectures' | 'specific')}
                                options={scopeOptions}
                            />
                        </div>

                        {scope === 'specific' && (
                            <div className="md:col-span-3 rounded-xl bg-white/5 border border-white/10 p-3">
                                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                    <label className={labelStyle}>
                                        {t('admin.pickCoursesCount', { n: selectedCourseIds.size })}
                                    </label>
                                    <div className="flex items-center gap-2 text-xs">
                                        <button
                                            type="button"
                                            onClick={selectAllVisible}
                                            disabled={visibleCourses.length === 0}
                                            className="px-2 py-1 rounded-lg bg-[#6A3FF4]/20 text-[#7B5AFF] hover:bg-[#6A3FF4]/30 disabled:opacity-40"
                                        >
                                            {t('admin.selectAllBtn')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={clearSelection}
                                            disabled={selectedCourseIds.size === 0}
                                            className="px-2 py-1 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-40"
                                        >
                                            {t('admin.clearBtn')}
                                        </button>
                                    </div>
                                </div>
                                <div className="relative mb-2">
                                    <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" />
                                    <input
                                        value={courseSearch}
                                        onChange={(e) => setCourseSearch(e.target.value)}
                                        placeholder={t('admin.searchByCodeOrTitle')}
                                        className={`${inputStyle} pl-9`}
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
                                    {coursesLoading ? (
                                        <p className="p-4 text-xs text-gray-500 italic animate-pulse">{t('admin.loadingCourses')}</p>
                                    ) : visibleCourses.length === 0 ? (
                                        <p className="p-4 text-xs text-gray-500 italic">
                                            {t('admin.noCoursesMatchWiden')}
                                        </p>
                                    ) : (
                                        visibleCourses.map((c) => {
                                            const checked = selectedCourseIds.has(c.id);
                                            return (
                                                <div
                                                    key={c.id}
                                                    onClick={() => toggleCourse(c.id)}
                                                    className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer border-b border-white/5 last:border-b-0 transition-colors ${
                                                        checked ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5'
                                                    }`}
                                                >
                                                    <GlassCheckbox
                                                        checked={checked}
                                                        onChange={() => toggleCourse(c.id)}
                                                        size="sm"
                                                        ariaLabel={`Toggle ${c.code}`}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-bold text-black dark:text-white truncate">
                                                            {c.code} <span className="text-gray-500 font-normal">— {c.title}</span>
                                                        </p>
                                                        <p className="text-[10px] text-gray-500">
                                                            {c.level != null ? t('admin.courseLevelLabel', { n: c.level }) : t('admin.anyLevelLabel')}
                                                            {c.semester ? ` · ${c.semester}` : ''}
                                                            {' · '}
                                                            {c.sectionCount === 1 ? t('admin.sectionCount', { n: c.sectionCount }) : t('admin.sectionCountPlural', { n: c.sectionCount })}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="md:col-span-3 rounded-xl bg-white/5 border border-white/10 p-3">
                            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <label className={labelStyle}>
                                    {t('admin.hallsLabelCount', { label: selectedHallIds.size === 0 ? t('admin.allActiveHallsScope') : t('admin.hallsSelectedScope', { n: selectedHallIds.size }) })}
                                </label>
                                <div className="flex items-center gap-2 text-xs">
                                    <button
                                        type="button"
                                        onClick={selectAllHalls}
                                        disabled={halls.length === 0}
                                        className="px-2 py-1 rounded-lg bg-[#6A3FF4]/20 text-[#7B5AFF] hover:bg-[#6A3FF4]/30 disabled:opacity-40"
                                    >
                                        {t('admin.selectAllBtn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearHallSelection}
                                        disabled={selectedHallIds.size === 0}
                                        className="px-2 py-1 rounded-lg bg-white/5 text-gray-400 hover:bg-white/10 disabled:opacity-40"
                                    >
                                        {t('admin.clearBtn')}
                                    </button>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-500 mb-2">
                                {t('admin.hallsPickHint')}
                            </p>
                            {halls.length === 0 ? (
                                <p className="p-4 text-xs text-gray-500 italic">
                                    {t('admin.noActiveHallsAdd', { link: '' })} <a href="/admin/halls" className="underline">{t('admin.hallsLinkLabel')}</a>.
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto rounded-lg border border-white/10 p-2">
                                    {halls.map((h) => {
                                        const checked = selectedHallIds.has(h.id);
                                        return (
                                            <div
                                                key={h.id}
                                                onClick={() => toggleHall(h.id)}
                                                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                                                    checked ? 'bg-[#6A3FF4]/15' : 'hover:bg-white/5'
                                                }`}
                                            >
                                                <GlassCheckbox
                                                    checked={checked}
                                                    onChange={() => toggleHall(h.id)}
                                                    size="sm"
                                                    ariaLabel={`Toggle ${h.name}`}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-bold text-black dark:text-white truncate">{h.name}</p>
                                                    <p className="text-[10px] text-gray-500 truncate">
                                                        {t('admin.hallSeatsLine', { loc: [h.building, h.room].filter(Boolean).join('-') || t('admin.dashSymbol'), seats: h.capacity })}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={labelStyle}>{t('admin.slotLengthLabel')}</label>
                            <GlassDropdown
                                value={slotMinutes}
                                onChange={setSlotMinutes}
                                options={slotOptions}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                {t('admin.slotLengthOverrideHint')}
                            </p>
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.lecturesPerCourseLabel')}</label>
                            <GlassDropdown
                                value={String(lectureCount)}
                                onChange={(v) => setLectureCount(Number(v) || 1)}
                                options={splitOptions}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                {t('admin.lecturesPerCourseHint')}
                            </p>
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.labsPerCourseLabel')}</label>
                            <GlassDropdown
                                value={String(labCount)}
                                onChange={(v) => setLabCount(Number(v) || 1)}
                                options={splitOptions}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                {t('admin.labsPerCourseHint')}
                            </p>
                        </div>
                        <div className="md:col-span-3">
                            <div
                                onClick={() => setIncludeLabs(!includeLabs)}
                                className="flex items-center gap-2 text-sm text-black dark:text-white cursor-pointer w-fit"
                            >
                                <GlassCheckbox
                                    checked={includeLabs}
                                    onChange={setIncludeLabs}
                                    size="sm"
                                    ariaLabel={t('admin.includeLabsLabel')}
                                />
                                <span>{t('admin.includeLabsLabel')}</span>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1 ml-6">
                                {t('admin.includeLabsHint')}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 p-3 text-xs text-gray-700 dark:text-gray-300 space-y-1">
                        <p><i className="ph-bold ph-info text-[#7B5AFF] mr-1" /> {t('admin.wizardOnlyEditsLine')}</p>
                        <ul className="ml-5 list-disc space-y-0.5">
                            <li><span className="text-gray-500">{t('admin.wizardEditsLine1Pre')}</span> → <strong>{t('admin.wizardEditsLine1Mid')}</strong> {t('admin.wizardEditsLine1Post')}</li>
                            <li><span className="text-gray-500">{t('admin.wizardEditsLine2Pre')}</span> → <strong>{t('admin.wizardEditsLine2Mid')}</strong>{t('admin.wizardEditsLine2Post')}</li>
                            <li><span className="text-gray-500">{t('admin.wizardEditsLine3Pre')}</span> → <strong>{t('admin.wizardEditsLine3Mid')}</strong>{t('admin.wizardEditsLine3Post')}</li>
                            <li><span className="text-gray-500">{t('admin.wizardEditsLine4Pre')}</span> → <strong>{t('admin.wizardEditsLine4Mid')}</strong> {t('admin.wizardEditsLine4Post')}</li>
                        </ul>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={runPreview}
                            disabled={!canGenerate}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
                        >
                            {loading ? t('admin.runningDots') : t('admin.generatePreviewBtn')}
                        </button>
                    </div>
                </div>
            )}

            {step === 'preview' && preview && (
                <div className={`${glassCardStyle} p-6 space-y-5`}>
                    <h2 className="text-base font-bold text-black dark:text-white">{t('admin.step2Preview')}</h2>
                    {flash && (
                        <div className={`rounded-xl px-3 py-2 text-xs ${
                            flash.kind === 'ok'
                                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                                : 'bg-red-500/10 border border-red-500/30 text-red-300'
                        }`}>
                            <i className={`ph-bold mr-1 ${flash.kind === 'ok' ? 'ph-check-circle' : 'ph-warning-circle'}`} />
                            {flash.text}
                        </div>
                    )}
                    {preview.message && (
                        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                            <i className="ph-bold ph-info mr-1" />
                            {preview.message}
                        </div>
                    )}
                    {preview.sectionCount > 0 && preview.assignments.length === 0 && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-300">
                            <i className="ph-bold ph-warning-circle mr-1" />
                            {preview.sectionCount === 1
                                ? t('admin.sectionsMatchedNoneScheduled', { n: preview.sectionCount })
                                : t('admin.sectionsMatchedNoneScheduledPlural', { n: preview.sectionCount })}
                        </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                            <p className="text-[10px] text-gray-500 uppercase">{t('admin.statsSections')}</p>
                            <p className="text-xl font-bold text-black dark:text-white">{preview.sectionCount}</p>
                        </div>
                        <div className="rounded-xl bg-gray-500/10 border border-gray-500/30 p-3" title={t('admin.statsSkippedTooltip')}>
                            <p className="text-[10px] text-gray-400 uppercase">{t('admin.statsSkipped')}</p>
                            <p className="text-xl font-bold text-gray-400">{preview.skippedCount ?? 0}</p>
                        </div>
                        <div className="rounded-xl bg-purple-500/10 border border-purple-500/30 p-3" title={t('admin.statsDraftedTooltip')}>
                            <p className="text-[10px] text-purple-300 uppercase">{t('admin.statsDrafted')}</p>
                            <p className="text-xl font-bold text-purple-300">{preview.draftedCount ?? 0}</p>
                        </div>
                        <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-3">
                            <p className="text-[10px] text-green-400 uppercase">{t('admin.statsScheduled')}</p>
                            <p className="text-xl font-bold text-green-400">{preview.assignments.length}</p>
                        </div>
                        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3">
                            <p className="text-[10px] text-red-400 uppercase">{t('admin.statsConflicts')}</p>
                            <p className="text-xl font-bold text-red-400">{preview.conflicts.length}</p>
                        </div>
                        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                            <p className="text-[10px] text-gray-500 uppercase">{t('admin.statsSlotLength')}</p>
                            <p className="text-xl font-bold text-black dark:text-white">{t('admin.minutesShort', { n: preview.policy.slotMinutes })}</p>
                        </div>
                    </div>

                    {preview.conflicts.length > 0 && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-3 space-y-2">
                            <p className="text-sm font-bold text-red-300">{t('admin.conflictsHeading', { n: preview.conflicts.length })}</p>
                            <div className="max-h-40 overflow-y-auto text-xs text-red-200 space-y-1">
                                {preview.conflicts.map((c) => (
                                    <p key={c.sectionId}>
                                        <span className="font-mono">{c.courseCode}</span> {c.type}: {c.reason}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {preview.assignments.length > 0 && (
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                            <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400 bg-white/5 border-b border-white/5">
                                <i className="ph-bold ph-info text-[#7B5AFF] mr-1.5" />
                                {t('admin.dragRowHint')}
                            </div>
                            <table className="w-full text-left text-xs">
                                <thead className="bg-white/5">
                                    <tr>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colCourse')}</th>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colType')}</th>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colAction')}</th>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colWhen')}</th>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colHall')}</th>
                                        <th className="p-3 font-bold text-gray-500 uppercase">{t('admin.colCapacity')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.assignments.map((a) => {
                                        const rowKey = assignmentKey(a);
                                        const isDragging = dragKey === rowKey;
                                        const isDropTarget = dragKey && dragOverKey === rowKey && dragKey !== rowKey;
                                        return (
                                    <tr
                                        key={rowKey}
                                        draggable
                                        onDragStart={(e) => {
                                            setDragKey(rowKey);
                                            e.dataTransfer.effectAllowed = 'move';
                                        }}
                                        onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
                                        onDragOver={(e) => {
                                            if (!dragKey || dragKey === rowKey) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragOverKey !== rowKey) setDragOverKey(rowKey);
                                        }}
                                        onDragLeave={() => { if (dragOverKey === rowKey) setDragOverKey(null); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            if (dragKey && dragKey !== rowKey) reorderPreviewRows(dragKey, rowKey);
                                            setDragKey(null);
                                            setDragOverKey(null);
                                        }}
                                        title={t('admin.rowDragTooltip')}
                                        className={`border-t border-white/5 select-none transition-colors ${
                                            isDragging ? 'opacity-40' : 'cursor-move hover:bg-white/5'
                                        } ${isDropTarget ? 'bg-[#6A3FF4]/15 ring-2 ring-[#6A3FF4] ring-inset' : ''}`}
                                    >
                                            <td className="p-3">
                                                <p className="font-bold text-black dark:text-white">{a.courseCode}</p>
                                                <p className="text-gray-500 text-[10px]">{a.courseTitle}</p>
                                            </td>
                                            <td className="p-3">
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                                    a.type === 'Lecture'
                                                        ? 'bg-[#6A3FF4]/20 text-[#7B5AFF]'
                                                        : 'bg-blue-500/20 text-blue-300'
                                                }`}>{a.type}</span>
                                            </td>
                                            <td className="p-3">
                                                {a.action === 'assign_hall' ? (
                                                    <span
                                                        className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                                        title={t('admin.actionHallOnlyTooltip')}
                                                    >
                                                        <i className="ph-bold ph-door-open mr-1" />
                                                        {t('admin.actionHallOnly')}
                                                    </span>
                                                ) : a.action === 'create_section' ? (
                                                    <span
                                                        className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                                        title={t('admin.actionCreatedTooltip', { type: a.draftType || a.type, label: a.draftSectionLabel || '' })}
                                                    >
                                                        <i className="ph-bold ph-sparkle mr-1" />
                                                        {t('admin.actionCreated', { label: a.draftSectionLabel || '' })}
                                                    </span>
                                                ) : (
                                                    <span
                                                        className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30"
                                                        title={t('admin.actionNewSlotTooltip')}
                                                    >
                                                        <i className="ph-bold ph-plus mr-1" />
                                                        {t('admin.actionNewSlot')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-3 text-gray-700 dark:text-gray-300">
                                                {a.day}, {a.startTime}–{a.endTime}
                                            </td>
                                            <td className="p-3 text-gray-700 dark:text-gray-300">
                                                {a.hallName}
                                                {a.hallBuilding || a.hallRoom
                                                    ? ` · ${[a.hallBuilding, a.hallRoom].filter(Boolean).join('-')}`
                                                    : ''}
                                            </td>
                                            <td className="p-3 text-[#7B5AFF] font-bold">{a.capacity}</td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="flex justify-between gap-3 pt-2">
                        <button
                            onClick={() => { setPreview(null); setStep('filter'); }}
                            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm hover:bg-white/10 text-black dark:text-white"
                        >
                            <i className="ph-bold ph-arrow-left mr-2" /> {t('admin.backBtn')}
                        </button>
                        <button
                            onClick={commit}
                            disabled={committing || preview.assignments.length === 0}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
                        >
                            {committing
                                ? t('admin.committingDots')
                                : (preview.assignments.length === 1
                                    ? t('admin.commitAssignmentsBtn', { n: preview.assignments.length })
                                    : t('admin.commitAssignmentsBtnPlural', { n: preview.assignments.length }))}
                        </button>
                    </div>
                </div>
            )}

            {step === 'done' && committed && (
                <div className={`${glassCardStyle} p-8 text-center space-y-4`}>
                    <i className="ph-bold ph-check-circle text-6xl text-green-400" />
                    <h2 className="text-xl font-bold text-black dark:text-white">
                        {t('admin.timetableSavedTitle')}
                    </h2>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                        {committed.written === 1
                            ? t('admin.timetableSavedBody', { written: committed.written, sections: committed.sectionCount })
                            : t('admin.timetableSavedBodyPlural', { written: committed.written, sections: committed.sectionCount })}
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                        <button
                            onClick={() => { setStep('filter'); setPreview(null); setCommitted(null); }}
                            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm hover:bg-white/10 text-black dark:text-white"
                        >
                            {t('admin.runAgainBtn')}
                        </button>
                        <button
                            onClick={() => navigate('/admin/timetable')}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90"
                        >
                            {t('admin.viewTimetableBtn')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimetableWizard;
