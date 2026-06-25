import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { useHasPermission } from '../../utils/permissions';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- Interfaces ---
interface AdminOverviewData {
    stats: {
        students: string;
        faculty: string;
        courses: string;
        activeUsers: string;
    };
    alerts: {
        id?: string;
        icon: string;
        color: string;
        text: string;
    }[];
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Realistic FCDS-scale overview + audit feed.
const MOCK_OVERVIEW: AdminOverviewData = {
    stats: {
        students: '1,200',
        faculty: '86',
        courses: '142',
        activeUsers: '318',
    },
    alerts: [
        { id: 'a1', icon: 'ph-user-plus', color: 'bg-green-500/15 text-green-400', text: 'New student account created — Aya Sami' },
        { id: 'a2', icon: 'ph-pencil-simple', color: 'bg-blue-500/15 text-blue-400', text: 'Course CS305 updated by Prof. Mahmoud Adel' },
        { id: 'a3', icon: 'ph-currency-circle-dollar', color: 'bg-[#6A3FF4]/15 text-[#7B5AFF]', text: 'Payment of EGP 42,500 recorded for Yousef Mahmoud' },
        { id: 'a4', icon: 'ph-shield-check', color: 'bg-emerald-500/15 text-emerald-400', text: 'Role permissions matrix saved by Admin' },
        { id: 'a5', icon: 'ph-warning', color: 'bg-amber-500/15 text-amber-400', text: 'Login lock created for Khaled Abdullah — unpaid fees' },
    ],
};

interface AdminCourseSummary {
    code: string;
    title: string;
    department: string | null;
    sectionCount: number;
    capacity: number;
    enrolled: number;
}

const MOCK_COURSES: AdminCourseSummary[] = [
    { code: 'CS305', title: 'Operating Systems', department: 'Computer Science', sectionCount: 3, capacity: 240, enrolled: 232 },
    { code: 'DS210', title: 'Statistical Inference', department: 'Data Science', sectionCount: 2, capacity: 180, enrolled: 168 },
    { code: 'CS101', title: 'Introduction to Programming', department: 'Computer Science', sectionCount: 4, capacity: 400, enrolled: 356 },
    { code: 'IS340', title: 'Database Systems', department: 'Information Systems', sectionCount: 2, capacity: 160, enrolled: 138 },
    { code: 'AI420', title: 'Machine Learning', department: 'Artificial Intelligence', sectionCount: 2, capacity: 150, enrolled: 96 },
    { code: 'SE220', title: 'Software Engineering', department: 'Software Engineering', sectionCount: 1, capacity: 90, enrolled: 28 },
];

// Heatmap stats keyed by YYYY-MM-DD — covers the recent window so the calendar
// is populated. Generated deterministically across the last ~90 days.
const MOCK_HEATMAP_STATS: Record<string, { present: number; total: number }> = (() => {
    const out: Record<string, { present: number; total: number }> = {};
    const today = new Date();
    for (let i = 0; i < 90; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const dow = d.getDay();
        // Skip Fridays (5) — non-teaching day at FCDS; leave them "no data".
        if (dow === 5) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const total = 120 + ((i * 7) % 60);
        // Deterministic present rate in the 68–96% band.
        const rate = 68 + ((i * 13) % 29);
        const present = Math.round((total * rate) / 100);
        out[key] = { present, total };
    }
    return out;
})();

// ─── Stat Card ────────────────────────────────────────
const StatCard: React.FC<{
    title: string; value: string | number; description: string; tagText: string; icon: string; targetPath: string; isLoading?: boolean;
}> = ({ title, value, description, tagText, icon, targetPath, isLoading }) => {
    const navigate = useNavigate();
    return (
        <ParticleCard className={`${glassCardStyle} p-6 flex flex-col justify-between h-full`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center">
                        <i className={`ph-fill ${icon} text-xl text-[#6A3FF4]`}></i>
                    </div>
                    <span className="text-black dark:text-gray-300 font-bold text-sm uppercase tracking-wider">{title}</span>
                </div>
                <button onClick={() => navigate(targetPath)} className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all group">
                    <i className="ph-bold ph-arrow-right text-black dark:text-gray-300 group-hover:text-white transition-colors"></i>
                </button>
            </div>
            <div className="my-3">
                {isLoading ? (
                    <div className="h-10 w-24 bg-white/10 animate-pulse rounded-lg"></div>
                ) : (
                    <span className="text-black dark:text-white font-bold text-2xl sm:text-4xl">{value}</span>
                )}
            </div>
            <div className="flex justify-between items-end gap-2">
                <p className="text-black dark:text-gray-300 text-xs w-2/3 leading-relaxed line-clamp-2">{description}</p>
                <span className="text-white text-[10px] font-bold bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] px-2 py-1 rounded-full shadow-lg shadow-purple-500/20 whitespace-nowrap">{tagText}</span>
            </div>
        </ParticleCard>
    );
};

// ─── Current Courses ────────────────────────────────
// Plan 9 follow-up — replaces the Financial Summary tile on the admin
// dashboard. Financials are now the financial role's purview; admins still
// have catalog management as a daily concern, so this surfaces the catalog
// state instead.
//
// Preview: pure front-end mockup — reads MOCK_COURSES, no backend.
//
// Layout mirrors `FinancialSummary`'s shape so the dashboard grid stays
// visually balanced — header + 3 stat tiles + scrollable top-6 list +
// footer CTA.
interface CourseSummary {
    code: string;
    title: string;
    department: string | null;
    sectionCount: number;
    capacity: number;
    enrolled: number;
    fillPct: number;
}
const CurrentCoursesCard: React.FC<{ isLoading: boolean }> = ({ isLoading: parentLoading }) => {
    const t = useT();
    const navigate = useNavigate();
    const [courses, setCourses] = useState<AdminCourseSummary[] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Preview: load static course list, no backend.
        setCourses(MOCK_COURSES);
        setLoading(false);
    }, []);

    const isLoading = parentLoading || loading;

    // Reduce each course to a one-line summary (sections, capacity, fill).
    const summaries: CourseSummary[] = useMemo(() => {
        if (!courses) return [];
        return courses.map((c) => {
            const fillPct = c.capacity > 0 ? Math.min(100, Math.round((c.enrolled / c.capacity) * 100)) : 0;
            return {
                code: c.code,
                title: c.title,
                department: c.department,
                sectionCount: c.sectionCount,
                capacity: c.capacity,
                enrolled: c.enrolled,
                fillPct,
            };
        });
    }, [courses]);

    // Aggregate stats — total active courses, total sections, average fill
    // (only across courses that have any capacity, so an empty seed doesn't
    // skew the average to 0).
    const totalCourses = summaries.length;
    const totalSections = summaries.reduce((acc, s) => acc + s.sectionCount, 0);
    const avgFill = (() => {
        const filled = summaries.filter((s) => s.capacity > 0);
        if (filled.length === 0) return 0;
        return Math.round(filled.reduce((acc, s) => acc + s.fillPct, 0) / filled.length);
    })();

    // Top 4 by fill percentage — surfaces the courses closest to capacity
    // (i.e. needing attention for new sections / waitlists). Tie-breakers:
    // higher absolute enrollment first (a packed 100-seat course beats a
    // packed 10-seat course), then alphabetical code for stable ordering.
    const top = useMemo(() => {
        return [...summaries]
            .sort((a, b) => {
                if (b.fillPct !== a.fillPct) return b.fillPct - a.fillPct;
                if (b.enrolled !== a.enrolled) return b.enrolled - a.enrolled;
                return a.code.localeCompare(b.code);
            })
            .slice(0, 4);
    }, [summaries]);

    const fillTone = (pct: number) => {
        if (pct >= 90) return 'bg-red-500';
        if (pct >= 70) return 'bg-amber-500';
        if (pct >= 40) return 'bg-emerald-500';
        return 'bg-[#6A3FF4]';
    };

    return (
        <div className={`${glassCardStyle} p-6 h-full flex flex-col`}>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
                    <i className="ph-bold ph-book-bookmark mr-2 text-[#6A3FF4]"></i>
                    {t('admin.currentCoursesTitle')}
                </h2>
                <button
                    onClick={() => navigate('/admin/manage-courses')}
                    className="text-sm text-black dark:text-gray-300 border border-white/20 dark:border-white/10 rounded-lg px-4 py-1.5 hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
                >
                    {t('admin.manageBtn')}
                </button>
            </div>

            {/* 3 quick stats — active courses, sections, average fill */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('admin.currentCoursesActive')}</p>
                    <p className="text-xl font-bold text-[#6A3FF4]">{isLoading ? '…' : totalCourses}</p>
                </div>
                <div className="p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('admin.currentCoursesSections')}</p>
                    <p className="text-xl font-bold text-black dark:text-white">{isLoading ? '…' : totalSections}</p>
                </div>
                <div className="p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 text-center">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{t('admin.currentCoursesAvgFill')}</p>
                    <p className={`text-xl font-bold ${avgFill >= 90 ? 'text-red-500' : avgFill >= 70 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {isLoading ? '…' : `${avgFill}%`}
                    </p>
                </div>
            </div>

            {/* Top-enrollment list — scrolls if there are more than fit */}
            <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-2">
                {isLoading ? (
                    <>
                        <div className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
                        <div className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
                        <div className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
                    </>
                ) : top.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-8">
                        {t('admin.currentCoursesEmpty')}
                    </p>
                ) : (
                    top.map((c) => (
                        <button
                            key={c.code}
                            onClick={() => navigate(`/admin/courses/${c.code}`)}
                            className="w-full text-left p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/40 transition-colors group"
                        >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-bold text-black dark:text-white truncate">
                                        <span className="text-[#6A3FF4]">{c.code}</span>
                                        <span className="mx-2 text-gray-400">·</span>
                                        {c.title}
                                    </p>
                                    <p className="text-[10px] text-gray-500 truncate">
                                        {c.department ?? t('admin.noDeptCol')} · {c.sectionCount} {c.sectionCount === 1 ? t('admin.sectionLbl') : t('admin.sectionsLbl')}
                                    </p>
                                </div>
                                <span className="text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400 flex-shrink-0">
                                    {c.enrolled}/{c.capacity || '∞'}
                                </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-white/10 dark:bg-black/30 overflow-hidden">
                                <div
                                    className={`h-full ${fillTone(c.fillPct)} transition-all`}
                                    style={{ width: `${c.fillPct}%` }}
                                />
                            </div>
                        </button>
                    ))
                )}
            </div>

            <button
                onClick={() => navigate('/admin/manage-courses')}
                className="mt-4 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 text-xs"
            >
                <i className="ph-bold ph-arrow-right"></i> {t('admin.openCourseCatalog')}
            </button>
        </div>
    );
};

// ─── Audit Logs (renamed from Alerts & Notifications) ─────────────────────
// Card now renders a one-line readable summary per audit row (the backend's
// formatAlertText prevents `[object Object]` on details).
const AlertsNotifications: React.FC<{ alerts: AdminOverviewData['alerts']; isLoading: boolean }> = ({ alerts, isLoading }) => {
    const t = useT();
    const navigate = useNavigate();
    return (
        <ParticleCard className={`${glassCardStyle} p-6 h-full flex flex-col`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
            <h2 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center">
                <i className="ph-bold ph-file-magnifying-glass mr-2 text-[#6A3FF4]"></i>
                {t('admin.auditLogs')}
            </h2>
            <div className="space-y-3 flex-1">
                {isLoading ? (
                    [1, 2, 3, 4].map(i => <div key={i} className="h-16 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>)
                ) : alerts.length === 0 ? (
                    <div className="text-center py-12 text-gray-500 italic text-sm">{t('admin.auditNoEvents')}</div>
                ) : (
                    alerts.map((a, i) => (
                        <motion.div
                            key={(a as { id?: string }).id ?? i}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.08 }}
                            onClick={() => navigate('/admin/audit-logs')}
                            className="flex items-start gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all cursor-pointer"
                        >
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${a.color}`}>
                                <i className={`ph-fill ${a.icon} text-lg`}></i>
                            </div>
                            <p className="text-black dark:text-gray-300 text-sm leading-relaxed line-clamp-2 capitalize">
                                {String(a.text)}
                            </p>
                        </motion.div>
                    ))
                )}
            </div>
            <button onClick={() => navigate('/admin/audit-logs')} className="mt-4 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 text-xs">
                <i className="ph-bold ph-arrow-right"></i> {t('admin.viewAllAuditLogs')}
            </button>
        </ParticleCard>
    );
};

// ─── Attendance Heatmap ──────────────────────────────
const getMonthData = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return { firstDay, daysInMonth };
};

const AttendanceHeatmap: React.FC = () => {
    const t = useT();
    const [monthOffset, setMonthOffset] = useState(0);
    const [stats, setStats] = useState<Record<string, { present: number, total: number }>>({});
    const [isLoading, setIsLoading] = useState(true);
    // Plan 4 Phase 1 follow-up — gate the CSV export on Attendance write so
    // the toggle in Settings → Roles & Permissions has a visible effect.
    const canExportAttendance = useHasPermission('Attendance', 'write');

    const now = new Date();
    const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const { firstDay, daysInMonth } = useMemo(
        () => getMonthData(viewDate.getFullYear(), viewDate.getMonth()),
        // viewDate is derived purely from monthOffset; memoising on monthOffset
        // is the correct and stable trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [monthOffset]
    );

    useEffect(() => {
        // Preview: load static heatmap stats, no backend.
        setStats(MOCK_HEATMAP_STATS);
        setIsLoading(false);
    }, []);

    const dateKey = (d: number) =>
        `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    // Color thresholds match the legend below. Five buckets including "no data".
    const getHeatColor = (d: number): string => {
        const dayStat = stats[dateKey(d)];
        if (!dayStat || dayStat.total === 0) return 'bg-white/5 dark:bg-black/20'; // No data
        const rate = (dayStat.present / dayStat.total) * 100;
        if (rate >= 90) return 'bg-green-500/60';   // Excellent
        if (rate >= 80) return 'bg-green-500/30';   // Good
        if (rate >= 70) return 'bg-yellow-500/40';  // Fair
        return 'bg-red-500/40';                     // Low
    };

    // Per-cell tooltip: date + present/total + percentage. Falls back to a
    // "no data" hint when there's no record for that day.
    const getTooltip = (d: number): string => {
        const key = dateKey(d);
        const dayStat = stats[key];
        if (!dayStat || dayStat.total === 0) return `${key} — ${t('admin.dayNoData')}`;
        const pct = Math.round((dayStat.present / dayStat.total) * 100);
        return t('admin.dayPresentOf', { date: key, present: dayStat.present, total: dayStat.total, pct });
    };

    const monthLabel = viewDate.toLocaleString('en', { month: 'long', year: 'numeric' });
    const weekdays = [t('admin.dowSun'), t('admin.dowMon'), t('admin.dowTue'), t('admin.dowWed'), t('admin.dowThu'), t('admin.dowFri'), t('admin.dowSat')];

    // Build a CSV from the loaded month's data. No new endpoint — uses the
    // already-loaded `stats` map, so we don't need to add server work just to
    // make the Attendance.write toggle do something.
    const handleExportCsv = () => {
        const rows: string[] = ['date,present,total,percent'];
        for (let d = 1; d <= daysInMonth; d++) {
            const key = dateKey(d);
            const s = stats[key];
            if (!s || s.total === 0) {
                rows.push(`${key},0,0,`);
            } else {
                const pct = Math.round((s.present / s.total) * 100);
                rows.push(`${key},${s.present},${s.total},${pct}`);
            }
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance-${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
        <div className={`${glassCardStyle} p-6 h-full`}>
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
                    <i className="ph-bold ph-calendar-dots mr-2 text-[#6A3FF4]"></i>
                    {t('admin.attendanceHeatmap')}
                </h2>
                <div className="flex items-center gap-3">
                    {/* Plan 4 Phase 1 follow-up — visible only when admin
                        has Attendance.write. Wires the otherwise-dead toggle
                        to a real action (CSV export of the loaded month). */}
                    {canExportAttendance && (
                        <button
                            onClick={handleExportCsv}
                            disabled={isLoading}
                            title={t('admin.exportCsvTitle')}
                            className="h-8 px-3 rounded-full bg-[#6A3FF4]/10 hover:bg-[#6A3FF4]/20 border border-[#6A3FF4]/30 text-[#7B5AFF] text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                            <i className="ph-bold ph-download-simple"></i> {t('admin.exportCsv')}
                        </button>
                    )}
                    <button onClick={() => setMonthOffset(p => p - 1)} className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all group">
                        <i className="ph-bold ph-caret-left text-black dark:text-gray-300 group-hover:text-white transition-colors"></i>
                    </button>
                    <span className="text-black dark:text-gray-300 text-[10px] font-medium min-w-[100px] text-center">{monthLabel}</span>
                    <button onClick={() => setMonthOffset(p => p + 1)} className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all group">
                        <i className="ph-bold ph-caret-right text-black dark:text-gray-300 group-hover:text-white transition-colors"></i>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-2 mb-2">
                {weekdays.map(w => (
                    <div key={w} className="text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">{w}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
                {isLoading ? (
                    Array.from({ length: 35 }).map((_, i) => <div key={i} className="aspect-square rounded-lg bg-white/5 animate-pulse"></div>)
                ) : (
                    cells.map((day, i) => (
                        <div
                            key={i}
                            title={day ? getTooltip(day) : undefined}
                            className={`aspect-square rounded-lg flex items-center justify-center text-[10px] font-medium transition-all ${
                                day
                                    ? `${getHeatColor(day)} text-black dark:text-white hover:ring-2 hover:ring-[#6A3FF4]/40 cursor-pointer`
                                    : 'bg-transparent'
                            }`}
                        >
                            {day}
                        </div>
                    ))
                )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 text-[10px] text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-green-500/60"></div> {t('admin.legendExcellent')}</div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-green-500/30"></div> {t('admin.legendGood')}</div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-yellow-500/40"></div> {t('admin.legendFair')}</div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-red-500/40"></div> {t('admin.legendLow')}</div>
                <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-white/10 dark:bg-black/30 border border-white/10"></div> {t('admin.legendNoData')}</div>
            </div>
        </div>
    );
};

// ─── Restore admin role defaults — escape hatch for self-lockout ─────
// Plan 4 Phase 1 follow-up. If an admin disables their own dashboard read
// permissions in Settings → Roles & Permissions, all widgets disappear.
// This button calls POST /api/admin/roles/admin/restore-defaults and
// invalidates the permissions cache so the dashboard re-renders with the
// FCDS defaults restored. Backend endpoint is JWT-gated on admin role
// (works regardless of permission state).
const RestoreAdminDefaultsButton: React.FC = () => {
    const t = useT();
    const [busy, setBusy] = useState(false);
    const [err] = useState<string | null>(null);
    const onClick = () => {
        if (busy) return;
        setBusy(true);
        // Preview: no backend. Reload so the locally-cached default permissions
        // re-evaluate across the dashboard + sidebar.
        window.location.reload();
    };
    return (
        <div className="flex flex-col items-center gap-2">
            <button
                onClick={onClick}
                disabled={busy}
                className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 text-sm font-bold rounded-lg transition-colors"
            >
                {busy ? t('admin.restoring') : t('admin.restoreAdminDefaults')}
            </button>
            {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
    );
};

// ─── Main Admin Dashboard Component ──────────────────
const AdminDashboard: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [overview, setOverview] = useState<AdminOverviewData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errors] = useState<string[]>([]);

    // Permission gates — toggling Read in Settings → Roles & Permissions hides
    // the matching widget on next render. The hook caches across consumers, so
    // a single fetch covers the whole page.
    const canSeeStudents   = useHasPermission('Student Management', 'read');
    const canSeeFaculty    = useHasPermission('Faculty Management', 'read');
    const canSeeCourses    = useHasPermission('Course Management', 'read');
    const canSeeAuditLogs  = useHasPermission('Audit Logs', 'read');
    const canSeeAttendance = useHasPermission('Attendance', 'read');
    const visibleStatCount = [canSeeStudents, canSeeFaculty, canSeeCourses, canSeeAuditLogs].filter(Boolean).length;
    // Plan 9 follow-up — the Financial Summary tile was retired from the
    // admin dashboard (financials live under the financial role now).
    // Replaced by Current Courses, which gates on `Course Management:read`.
    const visibleMainCount = [canSeeCourses, canSeeAuditLogs, canSeeAttendance].filter(Boolean).length;

    useEffect(() => {
        // Preview: load static overview data, no backend.
        setOverview(MOCK_OVERVIEW);
        setIsLoading(false);
    }, []);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('admin.dashboardTitle')}</h2>
                        <p className="text-black dark:text-gray-300 text-sm">{t('admin.dashboardSubtitle')}</p>
                    </div>
                </div>
            </AnimateOnView>

            {errors.length > 0 && (
                <AnimateOnView enabled={false}>
                    <div className={`${glassCardStyle} p-4 border-red-500/30 bg-red-500/10`}>
                        <p className="text-red-300 text-sm font-semibold flex items-center gap-2 mb-1">
                            <i className="ph-bold ph-warning-circle"></i>
                            {t('admin.dashErrTitle')}
                        </p>
                        <ul className="text-red-200/90 text-xs list-disc pl-5 space-y-0.5">
                            {errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    </div>
                </AnimateOnView>
            )}

            {/* Top Stat Cards — gated per permission category. When everything is
                disabled an empty state is shown so the dashboard isn't a blank page. */}
            {visibleStatCount > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {canSeeStudents && (
                        <AnimateOnView delay={0.1} enabled={false}>
                            <StatCard
                                title={t('admin.studentsTile')}
                                value={overview?.stats.students || '0'}
                                description={t('admin.dashStudentsDesc')}
                                tagText={t('admin.dashTagInstitution')}
                                icon="ph-student"
                                targetPath="/admin/user-management"
                                isLoading={isLoading}
                            />
                        </AnimateOnView>
                    )}
                    {canSeeFaculty && (
                        <AnimateOnView delay={0.15} enabled={false}>
                            <StatCard
                                title={t('admin.dashFacultyTile')}
                                value={overview?.stats.faculty || '0'}
                                description={t('admin.dashFacultyDesc')}
                                tagText={t('admin.dashTagAcademic')}
                                icon="ph-chalkboard-teacher"
                                targetPath="/admin/user-management"
                                isLoading={isLoading}
                            />
                        </AnimateOnView>
                    )}
                    {canSeeCourses && (
                        <AnimateOnView delay={0.2} enabled={false}>
                            <StatCard
                                title={t('admin.dashActiveCoursesTile')}
                                value={overview?.stats.courses || '0'}
                                description={t('admin.dashCoursesDesc')}
                                tagText={t('admin.dashTagCurriculum')}
                                icon="ph-book-open"
                                targetPath="/admin/manage-courses"
                                isLoading={isLoading}
                            />
                        </AnimateOnView>
                    )}
                    {canSeeAuditLogs && (
                        <AnimateOnView delay={0.25} enabled={false}>
                            <StatCard
                                title={t('admin.dashActiveUsersTile')}
                                value={overview?.stats.activeUsers || '0'}
                                description={t('admin.dashUsersDesc')}
                                tagText={t('admin.dashTagLive')}
                                icon="ph-activity"
                                targetPath="/admin/system-health"
                                isLoading={isLoading}
                            />
                        </AnimateOnView>
                    )}
                </div>
            ) : null}

            {/* Main Content Grid — same pattern. Each panel gates on its own
                permission. The grid auto-shrinks based on how many are visible.
                Order: Audit Logs first so it stays visible above the fold on
                non-xl screens (where the grid collapses to a single column).
                Financials + AttendanceHeatmap follow. */}
            {visibleMainCount > 0 && (
                <div
                    className={`grid grid-cols-1 gap-6 ${
                        visibleMainCount === 1
                            ? 'xl:grid-cols-1'
                            : visibleMainCount === 2
                            ? 'xl:grid-cols-2'
                            : 'xl:grid-cols-3'
                    }`}
                >
                    {canSeeAuditLogs && (
                        <AnimateOnView delay={0.3} enabled={false}>
                            <AlertsNotifications alerts={overview?.alerts || []} isLoading={isLoading} />
                        </AnimateOnView>
                    )}
                    {canSeeCourses && (
                        <AnimateOnView delay={0.4} enabled={false}>
                            <CurrentCoursesCard isLoading={isLoading} />
                        </AnimateOnView>
                    )}
                    {canSeeAttendance && (
                        <AnimateOnView delay={0.5} enabled={false}>
                            <AttendanceHeatmap />
                        </AnimateOnView>
                    )}
                </div>
            )}

            {/* Empty-state when every section is hidden — happens if the admin
                disabled their own read permissions. Helps them recover. */}
            {visibleStatCount === 0 && visibleMainCount === 0 && (
                <div className={`${glassCardStyle} p-8 text-center`}>
                    <i className="ph-bold ph-shield-warning text-4xl text-yellow-400 mb-3"></i>
                    <p className="text-black dark:text-white font-bold text-lg mb-1">{t('admin.noWidgetsVisible')}</p>
                    <p className="text-gray-500 text-sm max-w-md mx-auto mb-4">
                        {t('admin.noWidgetsBody')}
                        <button
                            onClick={() => navigate('/admin/settings')}
                            className="text-[#6A3FF4] hover:underline mx-1"
                        >
                            {t('admin.noWidgetsLink')}
                        </button>
                        {t('admin.noWidgetsOr')}
                    </p>
                    <RestoreAdminDefaultsButton />
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;
