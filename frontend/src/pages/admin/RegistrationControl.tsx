import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { RegistrationWindowsCard } from './academic/RegistrationWindows';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface SystemSettings {
    id: string;
    registrationEnabled: boolean;
    currentSemester: string;
    academicYear: string;
    gradeSubmissionDeadline: string;
    maxCreditsPerSemester: number;
}

interface RegistrationPeriod {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
    addDropDeadline?: string;
    lateDeadline?: string;
    semester?: string | { name: string };
}

// ─── Preview mock data ─────────────────────────────────────────────────────────
const MOCK_SETTINGS: SystemSettings = {
    id: 'sys-1',
    registrationEnabled: true,
    currentSemester: 'Spring 2026',
    academicYear: '2025/2026',
    gradeSubmissionDeadline: '2026-06-15',
    maxCreditsPerSemester: 18,
};

const MOCK_PERIODS: RegistrationPeriod[] = [
    {
        id: 'p-spring-2026',
        name: 'Spring 2026 Registration Period',
        startDate: '2026-01-15',
        endDate: '2026-12-31',
        isActive: true,
        addDropDeadline: '2026-02-05',
        lateDeadline: '2026-02-12',
        semester: 'Spring 2026',
    },
    {
        id: 'p-fall-2026',
        name: 'Fall 2026 Registration Period',
        startDate: '2026-08-20',
        endDate: '2026-09-10',
        isActive: false,
        addDropDeadline: '2026-09-03',
        lateDeadline: '2026-09-07',
        semester: 'Fall 2026',
    },
    {
        id: 'p-fall-2025',
        name: 'Fall 2025 Registration Period',
        startDate: '2025-08-20',
        endDate: '2025-09-10',
        isActive: false,
        semester: 'Fall 2025',
    },
];

type TermType = 'Fall' | 'Spring' | 'Summer';

// `isActive` is intentionally NOT in this form — the per-period flag is
// derived at save time from (dateRange ∩ today) && registrationEnabled.
// Keeping it out prevents the two-toggle drift the previous UI suffered.
interface PeriodForm {
    termType: TermType;
    year: number;
    startDate: string;
    endDate: string;
    addDropDeadline: string;
    lateDeadline: string;
}

const RegistrationControl: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);
    const [periods, setPeriods] = useState<RegistrationPeriod[]>([]);
    const [periodsLoading, setPeriodsLoading] = useState(true);

    const [showPeriodModal, setShowPeriodModal] = useState(false);
    const [editingPeriod, setEditingPeriod] = useState<RegistrationPeriod | null>(null);
    const [periodForm, setPeriodForm] = useState<PeriodForm>({
        termType: 'Fall',
        year: new Date().getFullYear() + 1,
        startDate: '',
        endDate: '',
        addDropDeadline: '',
        lateDeadline: '',
    });
    const [periodSubmitting, setPeriodSubmitting] = useState(false);
    const [periodError, setPeriodError] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Phase 12 follow-up — editable Semester Cycle. Local edits live in the
    // *Form fields and are PATCHed to /api/admin/system-settings on save.
    const [cycleTerm, setCycleTerm] = useState<TermType>('Fall');
    const [cycleYear, setCycleYear] = useState<number>(new Date().getFullYear());
    const [cycleAcademicYear, setCycleAcademicYear] = useState<string>('');
    const [cycleMaxCredits, setCycleMaxCredits] = useState<number>(18);
    const [cycleSaving, setCycleSaving] = useState(false);
    const [cycleSaved, setCycleSaved] = useState(false);

    // Re-seed editable cycle fields whenever settings reload from the server.
    useEffect(() => {
        if (!settings) return;
        const parts = (settings.currentSemester || '').split(' ');
        const term = (['Fall', 'Spring', 'Summer'].includes(parts[0]) ? parts[0] : 'Fall') as TermType;
        const yr = parseInt(parts[1], 10);
        setCycleTerm(term);
        setCycleYear(Number.isFinite(yr) ? yr : new Date().getFullYear());
        setCycleAcademicYear(settings.academicYear || '');
        setCycleMaxCredits(settings.maxCreditsPerSemester || 18);
    }, [settings]);

    // Preview mode — persist the semester cycle into local state only. No network.
    const handleSaveCycle = async () => {
        setCycleSaving(true);
        setCycleSaved(false);
        setSettings((prev) => ({
            ...(prev ?? MOCK_SETTINGS),
            currentSemester: `${cycleTerm} ${cycleYear}`,
            academicYear: cycleAcademicYear,
            maxCreditsPerSemester: cycleMaxCredits,
        }));
        setCycleSaved(true);
        setTimeout(() => setCycleSaved(false), 2000);
        setCycleSaving(false);
    };

    // Preview mode — load static settings + periods. No backend.
    const fetchSettings = () => {
        setIsLoading(true);
        setSettings(MOCK_SETTINGS);
        setIsLoading(false);
    };

    const fetchPeriods = () => {
        setPeriodsLoading(true);
        setPeriods(MOCK_PERIODS);
        setPeriodsLoading(false);
    };

    useEffect(() => {
        fetchSettings();
        fetchPeriods();
        // Mount-only — loads static preview data.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Date helpers — used to figure out which period (if any) covers today.
    // Periods that overlap "now" are the ones the global toggle should flip.
    const isCurrent = (p: RegistrationPeriod): boolean => {
        const now = Date.now();
        const start = new Date(p.startDate).getTime();
        const end = new Date(p.endDate).getTime();
        return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
    };

    // Single source of truth: the global "ENABLE / DISABLE REGISTRATION"
    // button drives BOTH the system-settings flag and the per-period
    // `isActive` flag for whichever period covers today. Dropping the
    // standalone per-row x/check button kept the two states in lock-step
    // and removed a confusing knob (admins were forgetting to flip it
    // after creating dates).
    // Preview mode — flip the global toggle + sync current-period flags in local
    // state only. No network.
    const toggleRegistration = async () => {
        if (!settings || isUpdating) return;
        setIsUpdating(true);
        const nextEnabled = !settings.registrationEnabled;
        setSettings((prev) => (prev ? { ...prev, registrationEnabled: nextEnabled } : prev));

        const targets = nextEnabled
            ? periods.filter((p) => isCurrent(p) && !p.isActive)
            : periods.filter((p) => p.isActive);
        if (targets.length > 0) {
            setPeriods((prev) =>
                prev.map((p) =>
                    targets.some((target) => target.id === p.id) ? { ...p, isActive: nextEnabled } : p
                )
            );
        }
        setIsUpdating(false);
    };

    const openAddModal = () => {
        setEditingPeriod(null);
        setPeriodForm({
            termType: 'Fall',
            year: new Date().getFullYear() + 1,
            startDate: '',
            endDate: '',
            addDropDeadline: '',
            lateDeadline: '',
        });
        setPeriodError('');
        setShowPeriodModal(true);
    };

    const openEditModal = (period: RegistrationPeriod) => {
        setEditingPeriod(period);
        const semesterStr = typeof period.semester === 'string'
            ? period.semester
            : period.semester?.name ?? '';
        const parts = semesterStr.split(' ');
        const term = (['Fall', 'Spring', 'Summer'].includes(parts[0]) ? parts[0] : 'Fall') as TermType;
        const yr = parseInt(parts[1]) || new Date().getFullYear() + 1;
        setPeriodForm({
            termType: term,
            year: yr,
            startDate: period.startDate ? period.startDate.substring(0, 10) : '',
            endDate: period.endDate ? period.endDate.substring(0, 10) : '',
            addDropDeadline: period.addDropDeadline ? period.addDropDeadline.substring(0, 10) : '',
            lateDeadline: period.lateDeadline ? period.lateDeadline.substring(0, 10) : '',
        });
        setPeriodError('');
        setShowPeriodModal(true);
    };

    // Preview mode — create/update the period in local state only. No network.
    const handleSavePeriod = async () => {
        if (!periodForm.startDate || !periodForm.endDate) {
            setPeriodError(t('admin.startDateAndEndDateRequired'));
            return;
        }
        setPeriodSubmitting(true);
        setPeriodError('');

        const name = `${periodForm.termType} ${periodForm.year} Registration Period`;
        const semester = `${periodForm.termType} ${periodForm.year}`;
        // Derive isActive from "does today fall inside the period?" AND the
        // global registration toggle.
        const now = Date.now();
        const startMs = new Date(periodForm.startDate).getTime();
        const endMs = new Date(periodForm.endDate).getTime();
        const coversNow =
            Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= now && endMs >= now;
        const computedActive = coversNow && Boolean(settings?.registrationEnabled);

        if (editingPeriod) {
            const targetId = editingPeriod.id;
            setPeriods((prev) =>
                prev.map((p) =>
                    p.id === targetId
                        ? {
                              ...p,
                              name,
                              semester,
                              startDate: periodForm.startDate,
                              endDate: periodForm.endDate,
                              isActive: computedActive,
                              addDropDeadline: periodForm.addDropDeadline || undefined,
                              lateDeadline: periodForm.lateDeadline || undefined,
                          }
                        : p,
                ),
            );
        } else {
            const created: RegistrationPeriod = {
                id: `p-${Date.now()}`,
                name,
                semester,
                startDate: periodForm.startDate,
                endDate: periodForm.endDate,
                isActive: computedActive,
                addDropDeadline: periodForm.addDropDeadline || undefined,
                lateDeadline: periodForm.lateDeadline || undefined,
            };
            setPeriods((prev) => [...prev, created]);
        }
        setShowPeriodModal(false);
        setPeriodSubmitting(false);
    };

    // Preview mode — refuse deleting an active period, else drop from local state.
    const handleDeletePeriod = async (id: string) => {
        setDeletingId(id);
        const target = periods.find((p) => p.id === id);
        if (target?.isActive) {
            window.alert(t('admin.cannotDeleteActivePeriod'));
            setDeletingId(null);
            return;
        }
        setPeriods(prev => prev.filter(p => p.id !== id));
        setDeletingId(null);
    };

    const semesterLabel = (p: RegistrationPeriod) => {
        if (!p.semester) return '';
        if (typeof p.semester === 'string') return ` · ${p.semester}`;
        return ` · ${p.semester.name}`;
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-3xl font-bold mb-1">{t('admin.regCtrlTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.regCtrlGlobalSubtitle')}</p>
            </AnimateOnView>

            {/* Phase E — quick-launch wizard at the top, per the spec.
                Auto-assigns sections to halls and time slots from the
                Schedule Policy grid. */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} p-5 flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-[#6A3FF4]`}>
                    <div className="flex items-start gap-3">
                        <i className="ph-bold ph-magic-wand text-3xl text-[#7B5AFF] mt-1" />
                        <div>
                            <p className="text-black dark:text-white font-bold">{t('admin.autoGenerateTimetable')}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                                {t('admin.autoGenerateTimetableHint')}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => navigate('/admin/academic/schedule-policy')}
                            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs hover:bg-white/10 text-black dark:text-white"
                        >
                            <i className="ph-bold ph-clock-clockwise mr-1" /> {t('admin.schedulePolicyBtn')}
                        </button>
                        <button
                            onClick={() => navigate('/admin/timetable/wizard')}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90"
                        >
                            <i className="ph-bold ph-magic-wand mr-1" /> {t('admin.runWizardBtn')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AnimateOnView enabled={false} delay={0.1}>
                    <div className={`${glassCardStyle} p-6 h-full flex flex-col justify-between`}>
                        <div>
                            <h3 className="text-white font-bold mb-4 flex items-center gap-2">
                                <i className="ph-fill ph-toggle-left text-[#6A3FF4]"></i> {t('admin.registrationStatusCard')}
                            </h3>
                            <div className="p-4 bg-white/5 rounded-xl border border-white/10 mb-6">
                                <p className="text-sm font-bold text-white mb-1">{t('admin.generalEnrollment')}</p>
                                <p className="text-xs text-gray-500">{t('admin.generalEnrollmentDesc')}</p>
                            </div>
                        </div>
                        <button
                            onClick={toggleRegistration}
                            disabled={isUpdating || isLoading}
                            className={`w-full py-4 rounded-xl font-bold text-sm transition-all shadow-lg ${
                                settings?.registrationEnabled
                                    ? 'bg-red-500 text-white shadow-red-500/20'
                                    : 'bg-green-500 text-white shadow-green-500/20'
                            } disabled:opacity-50`}
                        >
                            {isUpdating ? t('admin.synchronizing') : settings?.registrationEnabled ? t('admin.disableRegistrationNow') : t('admin.enableRegistrationNow')}
                        </button>
                    </div>
                </AnimateOnView>

                <AnimateOnView enabled={false} delay={0.2}>
                    <div className={`${glassCardStyle} p-6 h-full flex flex-col`}>
                        <h3 className="text-white font-bold mb-1 flex items-center gap-2">
                            <i className="ph-fill ph-calendar-blank text-blue-500"></i> {t('admin.semesterCycleCard')}
                        </h3>
                        <p className="text-gray-500 text-xs mb-4">
                            {t('admin.semesterCycleHint')}
                        </p>
                        <div className="space-y-3 flex-1">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('admin.activeSemester')}</label>
                                <div className="grid grid-cols-[1fr_100px] gap-2">
                                    <GlassDropdown
                                        value={cycleTerm}
                                        onChange={(v) => setCycleTerm(v as TermType)}
                                        options={[
                                            { value: 'Fall',   label: t('admin.fallTerm') },
                                            { value: 'Spring', label: t('admin.springTerm') },
                                            { value: 'Summer', label: t('admin.summerTerm') },
                                        ]}
                                        direction="auto"
                                        className="w-full"
                                    />
                                    <input
                                        type="number"
                                        min="2000"
                                        max="2100"
                                        value={cycleYear}
                                        onChange={(e) => setCycleYear(parseInt(e.target.value, 10) || cycleYear)}
                                        onFocus={(e) => e.currentTarget.select()}
                                        className="bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white text-center focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('admin.academicYearLabel')}</label>
                                <input
                                    type="text"
                                    value={cycleAcademicYear}
                                    onChange={(e) => setCycleAcademicYear(e.target.value)}
                                    onFocus={(e) => e.currentTarget.select()}
                                    placeholder={t('admin.academicYearPlaceholder')}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('admin.maxCreditsPerSemesterLabel')}</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={cycleMaxCredits}
                                    onChange={(e) => setCycleMaxCredits(parseInt(e.target.value, 10) || cycleMaxCredits)}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 mt-4">
                            {cycleSaved && <span className="text-green-400 text-xs">{t('admin.savedDot')}</span>}
                            <button
                                onClick={handleSaveCycle}
                                disabled={cycleSaving || isLoading}
                                className="px-4 py-2 rounded-xl bg-[#6A3FF4] text-white font-bold text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
                            >
                                {cycleSaving ? t('admin.savingEllipsis') : t('admin.saveCycle')}
                            </button>
                        </div>
                    </div>
                </AnimateOnView>
            </div>

            <AnimateOnView enabled={false} delay={0.3}>
                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-white font-bold flex items-center gap-2">
                            <i className="ph-fill ph-clock text-[#6A3FF4]"></i> {t('admin.registrationPeriodsCard')}
                        </h3>
                        <button
                            onClick={openAddModal}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6A3FF4] text-white text-xs font-bold hover:bg-[#5A32D4] transition-colors"
                        >
                            <i className="ph-bold ph-plus"></i> {t('admin.addPeriod')}
                        </button>
                    </div>
                    {periodsLoading ? (
                        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 bg-white/5 animate-pulse rounded-xl" />)}</div>
                    ) : periods.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-6">{t('admin.noPeriodsConfigured')}</p>
                    ) : (
                        <div className="space-y-2">
                            {periods.map(p => {
                                // Period is "currently effective" when today
                                // sits inside its date range AND the global
                                // registration toggle is ON. The badge gives
                                // the admin a quick visual confirmation that
                                // students will see registration as open.
                                const current = isCurrent(p);
                                const effective = current && Boolean(settings?.registrationEnabled);
                                return (
                                <div key={p.id} className="flex items-start justify-between p-3 bg-white/5 rounded-xl gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-white text-sm font-bold">{p.name}</p>
                                            {effective ? (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
                                                    <i className="ph-fill ph-check-circle mr-1"></i>
                                                    {t('admin.currentlyOpenBadge')}
                                                </span>
                                            ) : current ? (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                                    <i className="ph-fill ph-pause-circle mr-1"></i>
                                                    {t('admin.pausedGlobalOffBadge')}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                                                    {new Date(p.startDate).getTime() > Date.now()
                                                        ? t('admin.upcomingBadge')
                                                        : t('admin.pastBadge')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-gray-500 text-xs mt-0.5">
                                            {new Date(p.startDate).toLocaleDateString()} — {new Date(p.endDate).toLocaleDateString()}
                                            {semesterLabel(p)}
                                        </p>
                                        {p.addDropDeadline && (
                                            <p className="text-gray-600 text-xs mt-0.5">
                                                {t('admin.addDropPrefix', { date: new Date(p.addDropDeadline).toLocaleDateString() })}
                                            </p>
                                        )}
                                        {p.lateDeadline && (
                                            <p className="text-gray-600 text-xs">
                                                {t('admin.lateRegPrefix', { date: new Date(p.lateDeadline).toLocaleDateString() })}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                                        <button
                                            onClick={() => openEditModal(p)}
                                            title={t('admin.editPeriodTooltip')}
                                            className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors text-xs"
                                        >
                                            <i className="ph-bold ph-pencil-simple"></i>
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (window.confirm(t('admin.confirmDeletePeriodPrompt', { name: p.name }))) {
                                                    handleDeletePeriod(p.id);
                                                }
                                            }}
                                            disabled={deletingId === p.id}
                                            title={t('admin.deletePeriodTooltip')}
                                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs disabled:opacity-50"
                                        >
                                            <i className="ph-bold ph-trash"></i>
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </AnimateOnView>

            {/* Registration Windows — was a separate Academic Settings page,
                merged here so all enrollment-cycle controls live in one
                place. The card resolves its own data (windows policy +
                active period preview) so embedding is zero-effort. */}
            <AnimateOnView enabled={false} delay={0.4}>
                <RegistrationWindowsCard />
            </AnimateOnView>

            {/* Period Modal */}
            <AnimatePresence>
                {showPeriodModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => setShowPeriodModal(false)}
                        />
                        <div className={`relative w-full max-w-md ${glassCardStyle} p-6 space-y-5`}>
                            <div className="flex items-center justify-between">
                                <h3 className="text-white font-bold text-lg">
                                    {editingPeriod ? t('admin.editPeriodTitle') : t('admin.addRegistrationPeriodTitle')}
                                </h3>
                                <button
                                    onClick={() => setShowPeriodModal(false)}
                                    className="text-gray-400 hover:text-white transition-colors"
                                >
                                    <i className="ph-bold ph-x text-lg"></i>
                                </button>
                            </div>

                            {periodError && (
                                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-2.5 text-sm">
                                    {periodError}
                                </div>
                            )}

                            {/* Term toggle */}
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2">{t('admin.termLabel')}</label>
                                <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                                    {(['Fall', 'Spring', 'Summer'] as TermType[]).map(term => {
                                        const termLabel = term === 'Fall' ? t('admin.fallTerm') : term === 'Spring' ? t('admin.springTerm') : t('admin.summerTerm');
                                        return (
                                        <button
                                            key={term}
                                            onClick={() => setPeriodForm(f => ({ ...f, termType: term }))}
                                            className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-colors ${
                                                periodForm.termType === term
                                                    ? 'bg-[#6A3FF4] text-white'
                                                    : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            {termLabel}
                                        </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Year */}
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2">{t('admin.yearLabel')}</label>
                                <input
                                    type="number"
                                    value={periodForm.year}
                                    min={2020}
                                    max={2040}
                                    onChange={e => setPeriodForm(f => ({ ...f, year: parseInt(e.target.value) || f.year }))}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors"
                                />
                            </div>

                            {/* Start / End dates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">{t('admin.startDateLabel')}</label>
                                    <input
                                        type="date"
                                        value={periodForm.startDate}
                                        onChange={e => setPeriodForm(f => ({ ...f, startDate: e.target.value }))}
                                        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-400 mb-2">{t('admin.endDateLabel')}</label>
                                    <input
                                        type="date"
                                        value={periodForm.endDate}
                                        onChange={e => setPeriodForm(f => ({ ...f, endDate: e.target.value }))}
                                        className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors"
                                    />
                                </div>
                            </div>

                            {/* Optional deadlines */}
                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2">
                                    {t('admin.addDropDeadlineLabel')} <span className="text-gray-600 font-normal">{t('admin.optionalLabel')}</span>
                                </label>
                                <input
                                    type="date"
                                    value={periodForm.addDropDeadline}
                                    onChange={e => setPeriodForm(f => ({ ...f, addDropDeadline: e.target.value }))}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-gray-400 mb-2">
                                    {t('admin.lateRegistrationDeadlineLabel')} <span className="text-gray-600 font-normal">{t('admin.optionalLabel')}</span>
                                </label>
                                <input
                                    type="date"
                                    value={periodForm.lateDeadline}
                                    onChange={e => setPeriodForm(f => ({ ...f, lateDeadline: e.target.value }))}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors"
                                />
                            </div>

                            {/* Active state is derived: a period is open when
                                its date range covers today AND the global
                                "ENABLE REGISTRATION" toggle is on. There's no
                                per-period checkbox anymore so the two states
                                can't drift out of sync. */}
                            <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                                <i className="ph-bold ph-info flex-shrink-0 mt-0.5"></i>
                                <p>
                                    {t('admin.activeStateInfo')}
                                </p>
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={handleSavePeriod}
                                    disabled={periodSubmitting}
                                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {periodSubmitting
                                        ? <><i className="ph-duotone ph-spinner animate-spin"></i> {t('admin.savingDots')}</>
                                        : <><i className="ph-bold ph-floppy-disk"></i> {t('admin.saveBtn')}</>
                                    }
                                </button>
                                <button
                                    onClick={() => setShowPeriodModal(false)}
                                    className={`px-5 py-3 rounded-xl ${glassCardStyle} text-gray-300 font-bold hover:bg-white/20 transition-colors`}
                                >
                                    {t('admin.cancelBtn')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default RegistrationControl;
