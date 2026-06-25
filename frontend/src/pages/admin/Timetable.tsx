// Admin Timetable — week-grid layout with dept × level × semester filters and
// HTML5 drag-drop on the cards.
//
// MVP BUILD — pure front-end mockup. No backend calls. The grid, departments,
// schedule policy, and slot moves all run on static mock data; drag-drop +
// override save/clear are local-only state mutations.

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { generateAdminTimetablePDF, AdminTimetableData } from '../../utils/pdfGenerator';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';
const inputStyle = 'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors';
const labelStyle = 'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

const ROW_HEIGHT = 100;

const FULL_TO_SHORT: Record<string, string> = {
    Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue',
    Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri',
};

interface DepartmentLite { id: string; code?: string | null; name: string }
interface TimetableItem {
    slotId: string;
    sectionId: string;
    sectionLabel: string;
    courseCode: string;
    courseTitle: string;
    level: number | null;
    type: 'Lecture' | 'Lab' | 'Tutorial' | 'Seminar';
    capacity: number;
    enrolled: number;
    instructorName?: string | null;
    hallId?: string | null;
    hallName?: string | null;
    day: string;
    startTime: string;
    endTime: string;
}
interface ViewResponse {
    success: true;
    items: TimetableItem[];
    policy: { workingDays: string[]; slotMinutes: number; dayStart: string; dayEnd: string };
    grid: { day: string; startTime: string; endTime: string }[];
}

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_DEPARTMENTS: DepartmentLite[] = [
    { id: 'dept-cs', code: 'CS', name: 'Computer Science' },
    { id: 'dept-ds', code: 'DS', name: 'Data Science' },
    { id: 'dept-cy', code: 'CY', name: 'Cybersecurity' },
    { id: 'dept-ma', code: 'MA', name: 'Mathematics' },
    { id: 'dept-bu', code: 'BU', name: 'Business Informatics' },
];

const MOCK_POLICY = {
    workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    slotMinutes: 120,
    dayStart: '08:00',
    dayEnd: '20:00',
};

const MOCK_GRID = [
    { day: 'Sunday', startTime: '08:00', endTime: '20:00' },
];

const MOCK_ITEMS: TimetableItem[] = [
    { slotId: 's1', sectionId: 'sec-cs101-l1', sectionLabel: 'L1', courseCode: 'CS101', courseTitle: 'Introduction to Programming', level: 1, type: 'Lecture', capacity: 200, enrolled: 178, instructorName: 'Dr. Amira Saleh', hallId: 'h1', hallName: 'Hall A-101', day: 'Sunday', startTime: '08:00', endTime: '10:00' },
    { slotId: 's2', sectionId: 'sec-cs101-b1', sectionLabel: 'B1', courseCode: 'CS101', courseTitle: 'Introduction to Programming', level: 1, type: 'Lab', capacity: 40, enrolled: 38, instructorName: 'Eng. Karim Adel', hallId: 'h2', hallName: 'Lab C-204', day: 'Sunday', startTime: '10:00', endTime: '12:00' },
    { slotId: 's3', sectionId: 'sec-ma205-l1', sectionLabel: 'L1', courseCode: 'MA205', courseTitle: 'Linear Algebra', level: 2, type: 'Lecture', capacity: 150, enrolled: 132, instructorName: 'Dr. Hossam Nabil', hallId: 'h3', hallName: 'Hall B-202', day: 'Monday', startTime: '08:00', endTime: '10:00' },
    { slotId: 's4', sectionId: 'sec-cs301-l1', sectionLabel: 'L1', courseCode: 'CS301', courseTitle: 'Operating Systems', level: 3, type: 'Lecture', capacity: 120, enrolled: 96, instructorName: 'Dr. Mona Farid', hallId: 'h1', hallName: 'Hall A-101', day: 'Monday', startTime: '12:00', endTime: '14:00' },
    { slotId: 's5', sectionId: 'sec-ds310-l2', sectionLabel: 'L2', courseCode: 'DS310', courseTitle: 'Machine Learning', level: 3, type: 'Lecture', capacity: 90, enrolled: 84, instructorName: 'Dr. Tarek Mansour', hallId: 'h4', hallName: 'Hall D-301', day: 'Tuesday', startTime: '10:00', endTime: '12:00' },
    { slotId: 's6', sectionId: 'sec-ds310-b1', sectionLabel: 'B1', courseCode: 'DS310', courseTitle: 'Machine Learning', level: 3, type: 'Lab', capacity: 25, enrolled: 24, instructorName: 'Eng. Laila Adel', hallId: 'h2', hallName: 'Lab C-204', day: 'Tuesday', startTime: '12:00', endTime: '14:00' },
    { slotId: 's7', sectionId: 'sec-cy220-l1', sectionLabel: 'L1', courseCode: 'CY220', courseTitle: 'Network Security', level: 2, type: 'Lecture', capacity: 80, enrolled: 71, instructorName: 'Dr. Sara Ezzat', hallId: 'h3', hallName: 'Hall B-202', day: 'Wednesday', startTime: '08:00', endTime: '10:00' },
    { slotId: 's8', sectionId: 'sec-cs305-l1', sectionLabel: 'L1', courseCode: 'CS305', courseTitle: 'Advanced Algorithms', level: 3, type: 'Lecture', capacity: 100, enrolled: 88, instructorName: 'Dr. Amira Saleh', hallId: 'h1', hallName: 'Hall A-101', day: 'Thursday', startTime: '14:00', endTime: '16:00' },
];

const buildMockView = (): ViewResponse => ({
    success: true,
    items: MOCK_ITEMS.map((it) => ({ ...it })),
    policy: { ...MOCK_POLICY },
    grid: MOCK_GRID.map((g) => ({ ...g })),
});

// Type-based palette: Lecture = green, Lab = orange. Course-code coloring
// was retired so the type is readable at a glance regardless of which
// course is in the cell.
const cardClass = (type: string) => {
    if (type === 'Lecture') {
        return 'bg-green-500/15 border-green-500/60 text-green-300 dark:text-green-200';
    }
    if (type === 'Lab') {
        return 'bg-orange-500/15 border-orange-500/60 text-orange-300 dark:text-orange-200';
    }
    return 'bg-[#6A3FF4]/15 border-[#6A3FF4]/60 text-[#bda8ff]';
};

const formatDisplayTime = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${m < 10 ? '0' + m : m} ${ampm}`;
};

const Timetable: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [departmentId, setDepartmentId] = useState('');
    const [level, setLevel] = useState<string>('');
    const [semester, setSemester] = useState('');
    const [departments] = useState<DepartmentLite[]>(MOCK_DEPARTMENTS);
    const [data, setData] = useState<ViewResponse | null>(null);
    const [loading, setLoading] = useState(false);

    // View-side slot-length override. Empty = follow the policy.
    const [slotMinutesOverride, setSlotMinutesOverride] = useState<string>('');
    const [savingOverride, setSavingOverride] = useState(false);
    const [clearingOverride, setClearingOverride] = useState(false);

    // DnD state
    const [dragSlotId, setDragSlotId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState<string | null>(null);
    const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Load the timetable view from mock data, filtered by dept / level.
    const load = useCallback(() => {
        setLoading(true);
        const id = window.setTimeout(() => {
            const view = buildMockView();
            const deptCode = departments.find((d) => d.id === departmentId)?.code ?? null;
            view.items = view.items.filter((it) => {
                if (deptCode && !it.courseCode.startsWith(deptCode)) return false;
                if (level && String(it.level) !== level) return false;
                return true;
            });
            setData(view);
            setLoading(false);
        }, 150);
        return () => window.clearTimeout(id);
    }, [departmentId, level, departments]);

    useEffect(() => { load(); }, [load]);

    // Effective slot length: view override takes precedence over the policy.
    const effectiveSlotMin = slotMinutesOverride
        ? Number(slotMinutesOverride)
        : data?.policy.slotMinutes ?? 60;
    const dayStart = data?.policy.dayStart ?? '08:00';
    const dayEnd = data?.policy.dayEnd ?? '20:00';

    const toMin = (s: string): number => {
        const [h, m] = s.split(':').map(Number);
        return h * 60 + m;
    };
    const fromMin = (n: number): string => {
        const h = Math.floor(n / 60);
        const m = n % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // Derive time-slot row starts. When the view override doesn't divide
    // the day window evenly we fall back to the policy slots so the grid
    // never disappears.
    const dayStartMin = toMin(dayStart);
    const dayEndMin = toMin(dayEnd);
    const span = Math.max(0, dayEndMin - dayStartMin);
    const overrideValid = effectiveSlotMin > 0 && span % effectiveSlotMin === 0;
    // Default mock slot grid (every 2h from 08:00) when no override applies.
    const defaultSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];
    const timeSlots: string[] = data
        ? overrideValid
            ? Array.from({ length: span / effectiveSlotMin }, (_, i) => fromMin(dayStartMin + i * effectiveSlotMin))
            : defaultSlots
        : [];

    // DnD handlers
    const onDragStart = (slotId: string) => (e: React.DragEvent) => {
        setDragSlotId(slotId);
        e.dataTransfer.setData('text/uniflow-slot', slotId);
        e.dataTransfer.effectAllowed = 'move';
    };
    const onDragEnd = () => {
        setDragSlotId(null);
        setDragOver(null);
    };
    const onDragOver = (cellKey: string) => (e: React.DragEvent) => {
        if (!dragSlotId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragOver !== cellKey) setDragOver(cellKey);
    };
    const onDragLeave = (cellKey: string) => () => {
        if (dragOver === cellKey) setDragOver(null);
    };

    // Save the current slot length as the (dept, level) override — local-only.
    const saveSlotOverride = () => {
        if (!slotMinutesOverride) {
            setFlash({ kind: 'err', text: t('admin.pickSlotLengthFirst') });
            setTimeout(() => setFlash(null), 3000);
            return;
        }
        setSavingOverride(true);
        window.setTimeout(() => {
            const scope = [departmentId ? t('admin.scopeThisDept') : null, level ? t('admin.levelOpt', { n: level }) : null].filter(Boolean).join(' · ') || t('admin.scopeAllDepts');
            setFlash({ kind: 'ok', text: t('admin.savedSlotForScope', { min: slotMinutesOverride, scope }) });
            setTimeout(() => setFlash(null), 3000);
            setSavingOverride(false);
        }, 400);
    };

    const clearSlotOverride = () => {
        setClearingOverride(true);
        window.setTimeout(() => {
            const scope = [departmentId ? t('admin.scopeThisDept') : null, level ? t('admin.levelOpt', { n: level }) : null].filter(Boolean).join(' · ') || t('admin.scopeGlobal');
            setFlash({ kind: 'ok', text: t('admin.clearedOverrideFor', { scope }) });
            setTimeout(() => setFlash(null), 3000);
            setSlotMinutesOverride('');
            setClearingOverride(false);
        }, 400);
    };

    // Local-only move — relocate the dragged slot to the target (day, time).
    const onDrop = (day: string, startTime: string) => (e: React.DragEvent) => {
        e.preventDefault();
        const slotId = e.dataTransfer.getData('text/uniflow-slot') || dragSlotId;
        setDragSlotId(null);
        setDragOver(null);
        if (!slotId) return;
        setData((prev) => {
            if (!prev) return prev;
            const slotMin = slotMinutesOverride ? Number(slotMinutesOverride) : prev.policy.slotMinutes;
            const endMin = toMin(startTime) + slotMin;
            return {
                ...prev,
                items: prev.items.map((it) =>
                    it.slotId === slotId
                        ? { ...it, day, startTime, endTime: fromMin(endMin) }
                        : it,
                ),
            };
        });
        setFlash({ kind: 'ok', text: t('admin.movedTo', { day, time: startTime }) });
        setTimeout(() => setFlash(null), 2500);
    };

    const deptOptions = [
        { value: '', label: t('admin.allDepartmentsOptTt'), icon: 'ph-buildings' },
        ...departments.map((d) => ({ value: d.id, label: `${d.code ? d.code + ' · ' : ''}${d.name}`, icon: 'ph-buildings' })),
    ];
    const levelOptions = [
        { value: '', label: t('admin.allLevelsOptTt'), icon: 'ph-stairs' },
        ...[1, 2, 3, 4].map((n) => ({ value: String(n), label: t('admin.levelOpt', { n }), icon: 'ph-stairs' })),
    ];
    const slotOptions = [
        { value: '', label: t('admin.useSchedulePolicyDefault'), icon: 'ph-clock' },
        ...[30, 45, 60, 90, 120, 180].map((m) => ({
            value: String(m),
            label: m === 60 ? t('admin.oneHourUnit') : m === 120 ? t('admin.twoHoursUnit') : m === 180 ? t('admin.threeHoursUnit') : t('admin.minutesUnit', { n: m }),
            icon: 'ph-clock',
        })),
    ];

    const fullDays = data?.policy.workingDays ?? [];

    // Build a context label for the PDF header (e.g. "Department: CS · Level 2 · Fall 2025").
    const filterLabelParts: string[] = [];
    if (departmentId) {
        const d = departments.find((x) => x.id === departmentId);
        if (d) filterLabelParts.push(t('admin.departmentColonPrefix', { dept: `${d.code ? d.code + ' · ' : ''}${d.name}` }));
    } else {
        filterLabelParts.push(t('admin.allDepartmentsOptTt'));
    }
    if (level) filterLabelParts.push(t('admin.levelOpt', { n: level }));
    if (semester) filterLabelParts.push(semester);
    const exportLabel = filterLabelParts.join(' · ');

    const handleExportPDF = () => {
        if (!data || data.items.length === 0) return;
        // Use the local timeSlots (already derived from policy or override)
        // so the PDF rows match the admin's current grid view exactly.
        const pdfData: AdminTimetableData = {
            scopeLabel: exportLabel || t('admin.adminTimetableLabel'),
            semester: semester || `${data.policy.dayStart}–${data.policy.dayEnd}`,
            workingDays: data.policy.workingDays,
            timeSlots,
            items: data.items.map((it) => ({
                day: it.day,
                startTime: it.startTime,
                endTime: it.endTime,
                courseCode: it.courseCode,
                type: it.type,
                hallName: it.hallName,
            })),
        };
        generateAdminTimetablePDF(pdfData);
    };

    return (
        <div className="flex flex-col pb-24">
            <AnimateOnView enabled={false}>
                <div className="mb-4 flex justify-between items-end flex-wrap gap-3">
                    <div>
                        <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('admin.timetableTitle')}</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            {t('admin.timetableWeeklyHint')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleExportPDF}
                            disabled={!data || data.items.length === 0}
                            className="bg-white/50 dark:bg-[#262626] border border-gray-300/50 dark:border-[#363636] text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-[#363636] px-4 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <i className="ph-bold ph-file-pdf" /> {t('admin.exportPdfBtnTt')}
                        </button>
                        <button
                            onClick={() => navigate('/admin/timetable/wizard')}
                            className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2"
                        >
                            <i className="ph-bold ph-magic-wand" /> {t('admin.runWizardLabel')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Filter row — z-40 keeps the dropdowns above the timetable
                card below (which has its own stacking context from
                backdrop-filter). Direction is 'down' so the panels don't
                collide with the global navbar / search input above. */}
            <div className={`${glassCardStyle} p-4 grid grid-cols-1 md:grid-cols-4 gap-3 mb-4 relative z-40`}>
                <div>
                    <label className={labelStyle}>{t('admin.departmentLabelTt')}</label>
                    <GlassDropdown value={departmentId} onChange={setDepartmentId} options={deptOptions} direction="down" />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.levelLabelTt')}</label>
                    <GlassDropdown value={level} onChange={setLevel} options={levelOptions} direction="down" />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.slotLengthLabel')}</label>
                    <GlassDropdown
                        value={slotMinutesOverride}
                        onChange={setSlotMinutesOverride}
                        options={slotOptions}
                        direction="down"
                    />
                    <div className="flex items-center gap-1 mt-2">
                        <button
                            type="button"
                            onClick={saveSlotOverride}
                            disabled={!slotMinutesOverride || savingOverride}
                            title={t('admin.saveScopeTooltip')}
                            className="px-2 py-1 rounded-lg bg-[#6A3FF4]/20 text-[#7B5AFF] text-[10px] font-bold uppercase tracking-wider hover:bg-[#6A3FF4]/30 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {savingOverride ? t('admin.saveScopeSaving') : t('admin.saveScopedSlot')}
                        </button>
                        <button
                            type="button"
                            onClick={clearSlotOverride}
                            disabled={clearingOverride}
                            title={t('admin.clearScopeTooltip')}
                            className="px-2 py-1 rounded-lg bg-white/5 text-gray-400 text-[10px] font-bold uppercase tracking-wider hover:bg-white/10 disabled:opacity-40"
                        >
                            {clearingOverride ? t('admin.clearScopeClearing') : t('admin.clearSavedSlot')}
                        </button>
                    </div>
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
            </div>

            {flash && (
                <div className={`p-3 mb-3 rounded-xl text-sm ${
                    flash.kind === 'ok'
                        ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                        : 'bg-red-500/10 border border-red-500/30 text-red-300'
                }`}>
                    <i className={`ph-bold ${flash.kind === 'ok' ? 'ph-check-circle' : 'ph-warning-circle'} mr-2`} />
                    {flash.text}
                </div>
            )}

            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} flex flex-col overflow-x-hidden relative`}>
                    {/* Header bar — drag hint sits where the student page has its week nav */}
                    <div className="flex justify-between items-center p-4 border-b border-gray-300/50 dark:border-[#2d2d2d]">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            <i className="ph-bold ph-info text-[#7B5AFF] mr-1.5" />
                            {data && data.items.length > 0
                                ? (data.items.length === 1
                                    ? t('admin.scheduledSlotsCount', { n: data.items.length })
                                    : t('admin.scheduledSlotsCountPlural', { n: data.items.length }))
                                : loading
                                    ? t('admin.loadingDotsTt')
                                    : t('admin.noScheduledSlotsFilter')}
                            {slotMinutesOverride && !overrideValid && data && (
                                <span className="ml-2 text-amber-400">
                                    {t('admin.overrideMismatchWarn', { min: slotMinutesOverride, start: dayStart, end: dayEnd })}
                                </span>
                            )}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-500">
                            {data ? t('admin.slotsAndDayRange', { min: effectiveSlotMin, start: data.policy.dayStart, end: data.policy.dayEnd }) : ''}
                        </p>
                    </div>

                    {!data || data.items.length === 0 ? (
                        <div className="p-12 text-center">
                            <i className="ph-bold ph-calendar-x text-6xl text-gray-400 dark:text-gray-600 mb-4 block" />
                            <h3 className="text-xl font-bold text-gray-600 dark:text-gray-400 mb-2">
                                {loading ? t('admin.loadingTimetable') : t('admin.noScheduledSlots')}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-500 text-sm">
                                {loading ? '' : t('admin.runWizardToGenerate')}
                            </p>
                        </div>
                    ) : (
                        // Flipped layout: days as rows on the left, time
                        // slots as columns on top. Outer wrapper allows
                        // horizontal scroll when the day-window × slot
                        // count exceeds the viewport.
                        (() => {
                            const DAY_COL_WIDTH = 80;       // left day-label column
                            const TIME_COL_MIN_WIDTH = 140; // each time-slot column
                            // Build cell index ONCE — keyed by `${day}|${startTime}`.
                            const cellIndex = new Map<string, typeof data.items>();
                            for (const ev of data.items) {
                                const k = `${ev.day}|${ev.startTime}`;
                                const list = cellIndex.get(k) ?? [];
                                list.push(ev);
                                cellIndex.set(k, list);
                            }
                            // Sliced display: end-of-slot label uses the next
                            // slot's startTime; the very last slot uses dayEnd.
                            const slotEnd = (i: number): string => {
                                if (i + 1 < timeSlots.length) return timeSlots[i + 1];
                                return dayEnd;
                            };
                            return (
                                <div
                                    className="flex flex-col overflow-x-auto scrollbar-hidden"
                                    style={{ minWidth: '100%' }}
                                >
                                    {/* Top header row: empty corner + time-slot column headers */}
                                    <div
                                        className="flex sticky top-0 z-20 bg-white/10 dark:bg-[#1a1a1a] border-b border-gray-300/50 dark:border-[#2d2d2d]"
                                        style={{ minWidth: DAY_COL_WIDTH + timeSlots.length * TIME_COL_MIN_WIDTH }}
                                    >
                                        <div className="flex-shrink-0 border-r border-gray-300/50 dark:border-[#2d2d2d]" style={{ width: DAY_COL_WIDTH }} />
                                        {timeSlots.map((time, i) => (
                                            <div
                                                key={time}
                                                className="flex-1 border-r border-gray-300/50 dark:border-[#2d2d2d] text-center py-2"
                                                style={{ minWidth: TIME_COL_MIN_WIDTH }}
                                            >
                                                <div className="text-xs font-bold text-black dark:text-gray-300">
                                                    {formatDisplayTime(time)}
                                                </div>
                                                <div className="text-[10px] text-gray-500 dark:text-gray-500">
                                                    –{formatDisplayTime(slotEnd(i))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* One row per working day. */}
                                    {fullDays.map((day) => {
                                        // Find the most-occupied cell in this row
                                        let maxOccupants = 1;
                                        for (const slot of timeSlots) {
                                            const n = (cellIndex.get(`${day}|${slot}`) ?? []).length;
                                            if (n > maxOccupants) maxOccupants = n;
                                        }
                                        const rowH = Math.max(ROW_HEIGHT, maxOccupants * 44 + 8);
                                        return (
                                        <div
                                            key={day}
                                            className="flex border-b border-gray-300/30 dark:border-[#2d2d2d]/30"
                                            style={{ minWidth: DAY_COL_WIDTH + timeSlots.length * TIME_COL_MIN_WIDTH }}
                                        >
                                            {/* Sticky day label on the left */}
                                            <div
                                                className="flex-shrink-0 sticky left-0 z-10 bg-white/10 dark:bg-[#1a1a1a] border-r border-gray-300/50 dark:border-[#2d2d2d] flex items-center justify-center font-bold text-black dark:text-gray-300"
                                                style={{ width: DAY_COL_WIDTH, height: rowH }}
                                            >
                                                {FULL_TO_SHORT[day] || day}
                                            </div>

                                            {/* Time-slot cells for this day */}
                                            {timeSlots.map((slot) => {
                                                const cellKey = `${day}|${slot}`;
                                                const occupants = cellIndex.get(cellKey) ?? [];
                                                const isTarget = dragSlotId && dragOver === cellKey;
                                                return (
                                                    <div
                                                        key={cellKey}
                                                        onDragOver={onDragOver(cellKey)}
                                                        onDragLeave={onDragLeave(cellKey)}
                                                        onDrop={onDrop(day, slot)}
                                                        className={`flex-1 border-r border-gray-300/30 dark:border-[#2d2d2d]/30 bg-white/5 dark:bg-[#0d0d0d]/50 transition-colors ${
                                                            isTarget ? 'bg-[#6A3FF4]/20 ring-2 ring-[#6A3FF4] ring-inset' : ''
                                                        }`}
                                                        style={{ minWidth: TIME_COL_MIN_WIDTH, height: rowH }}
                                                    >
                                                        {/* Stacked cards */}
                                                        <div className="flex flex-col h-full p-1 gap-1">
                                                            {occupants.map((event) => {
                                                                const isDragging = dragSlotId === event.slotId;
                                                                return (
                                                                    <div
                                                                        key={event.slotId}
                                                                        draggable
                                                                        onDragStart={onDragStart(event.slotId)}
                                                                        onDragEnd={onDragEnd}
                                                                        onClick={() => !dragSlotId && navigate(`/admin/courses/${encodeURIComponent(event.courseCode)}`)}
                                                                        title={t('admin.cardTooltip', { title: event.courseTitle, section: event.sectionLabel, instructor: event.instructorName || t('admin.unassignedLabel'), enrolled: event.enrolled, capacity: event.capacity, hall: event.hallName || t('admin.dashSymbol') })}
                                                                        className={`flex-1 min-h-0 rounded border-l-[3px] px-1.5 py-1 text-xs cursor-move hover:brightness-110 transition-all shadow-sm flex flex-col justify-center select-none overflow-hidden ${cardClass(event.type)} ${isDragging ? 'opacity-40' : ''}`}
                                                                    >
                                                                        <div className="font-bold truncate text-[11px] leading-tight">
                                                                            {event.courseTitle || event.courseCode} · {event.sectionLabel}
                                                                        </div>
                                                                        {event.hallName && (
                                                                            <div className="truncate opacity-80 text-[9px] leading-tight mt-0.5">
                                                                                <i className="ph-bold ph-door-open mr-0.5" />{event.hallName}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        );
                                    })}
                                </div>
                            );
                        })()
                    )}
                </div>
            </AnimateOnView>
        </div>
    );
};

export default Timetable;
