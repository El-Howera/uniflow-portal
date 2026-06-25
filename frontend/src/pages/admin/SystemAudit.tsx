// src/pages/admin/SystemAudit.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls / no polling. Audit
// logs, the activity heatmap, system-health metrics, active sessions, and
// service-status rows all render from static mock data.
import React, { useState, useEffect } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { PORTS } from '@shared/config';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// ─── AuditLogs interfaces ────────────────────────────────────────────────────

interface LogEntry {
    id: string;
    action: string;
    details: string;
    performedBy: string;
    target: string;
    createdAt: string;
}

// ─── ActivityHeatmap ─────────────────────────────────────────────────────────

interface HeatmapCell {
    dayOfWeek: number; // 0-6
    hour: number;      // 0-23
    count: number;
}

// Static heatmap — a realistic weekday-heavy / business-hours pattern.
// Deterministic so the preview renders the same grid every time.
const MOCK_HEATMAP: HeatmapCell[] = (() => {
    const cells: HeatmapCell[] = [];
    for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
            const weekend = day === 5 || day === 6; // Fri/Sat
            const businessHours = hour >= 8 && hour <= 18;
            const peak = hour >= 10 && hour <= 14;
            let count = 0;
            if (businessHours) {
                count = peak ? 38 : 18;
                if (weekend) count = peak ? 9 : 4;
            } else if (hour >= 19 && hour <= 22) {
                count = weekend ? 3 : 7;
            } else {
                count = weekend ? 0 : 1;
            }
            // Light deterministic variation by (day*hour) parity.
            if ((day * 24 + hour) % 5 === 0) count = Math.round(count * 1.2);
            cells.push({ dayOfWeek: day, hour, count });
        }
    }
    return cells;
})();

// Bucket count → opacity. Five buckets so empty / low / medium / high / peak
// are visually distinguishable even when the maxCount is small.
function intensity(count: number, maxCount: number): number {
    if (count === 0) return 0;
    const ratio = count / maxCount;
    if (ratio >= 0.8) return 0.95;
    if (ratio >= 0.6) return 0.75;
    if (ratio >= 0.4) return 0.55;
    if (ratio >= 0.2) return 0.35;
    return 0.18;
}

const ActivityHeatmap: React.FC = () => {
    const t = useT();
    const [cells, setCells] = useState<HeatmapCell[]>([]);
    const [maxCount, setMaxCount] = useState(1);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const max = MOCK_HEATMAP.reduce((m, c) => Math.max(m, c.count), 0);
        setCells(MOCK_HEATMAP);
        setMaxCount(max || 1);
        setLoading(false);
    }, []);

    const dayLabels = [t('admin.dowSun'), t('admin.dowMon'), t('admin.dowTue'), t('admin.dowWed'), t('admin.dowThu'), t('admin.dowFri'), t('admin.dowSat')];

    // Index by "day-hour" so the JSX render is deterministic regardless of
    // payload order.
    const lookup = new Map<string, number>();
    cells.forEach(c => lookup.set(`${c.dayOfWeek}-${c.hour}`, c.count));

    const totalEvents = cells.reduce((sum, c) => sum + c.count, 0);

    return (
        <div className={`${glassCardStyle} p-6`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
                <div>
                    <h2 className="text-black dark:text-white font-semibold text-sm uppercase tracking-wider">
                        {t('admin.saHeatmapTitle')}
                    </h2>
                    <p className="text-gray-500 text-xs mt-1">
                        {loading ? t('admin.saHeatmapLoading') : t('admin.saHeatmapSummary', { events: totalEvents.toLocaleString(), hours: cells.filter(c => c.count > 0).length })}
                    </p>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <span>{t('admin.saHeatmapLess')}</span>
                    {[0.18, 0.35, 0.55, 0.75, 0.95].map((op) => (
                        <span
                            key={op}
                            className="w-3.5 h-3.5 rounded-sm"
                            style={{ backgroundColor: `rgba(106,63,244,${op})` }}
                        />
                    ))}
                    <span>{t('admin.saHeatmapMore')}</span>
                </div>
            </div>

            {loading ? (
                <div className="animate-pulse h-[280px] rounded-xl bg-white/5"></div>
            ) : (
                /* Mobile-safe wrapper — at narrow viewports the 24-hour
                   grid was squeezing each cell below ~11 px wide while
                   `min-h-[18px]` forced the height bigger, breaking the
                   aspect-square layout and causing rows to visually
                   overlap. `overflow-x-auto` + a min-width on the inner
                   keeps the grid at a usable cell size and lets the user
                   pan horizontally to see all 24 hours. On md+ the grid
                   fits the card width naturally; the min-width is moot
                   there. */
                <div className="w-full overflow-x-auto -mx-2 px-2">
                  <div className="min-w-[640px]">
                    {/* Hour axis labels — every 2 hours so they read cleanly at any width */}
                    <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px] mb-1">
                        <div />
                        {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="text-[9px] text-gray-500 text-center leading-none">
                                {h % 2 === 0 ? String(h).padStart(2, '0') : ''}
                            </div>
                        ))}
                    </div>
                    {/* 7 rows × (label + 24 cells) */}
                    {Array.from({ length: 7 }, (_, day) => (
                        <div
                            key={day}
                            className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[3px] mb-[3px]"
                        >
                            <span className="text-[10px] text-gray-500 text-right pr-2 leading-none self-center">
                                {dayLabels[day]}
                            </span>
                            {Array.from({ length: 24 }, (_, hour) => {
                                const count = lookup.get(`${day}-${hour}`) ?? 0;
                                const op = intensity(count, maxCount);
                                return (
                                    <div
                                        key={hour}
                                        title={t('admin.saHeatmapTooltip', { day: dayLabels[day], hour: String(hour).padStart(2, '0'), count, s: count === 1 ? '' : 's' })}
                                        className="aspect-square min-h-[18px] rounded-[3px] transition-opacity hover:ring-2 hover:ring-[#6A3FF4]/60"
                                        style={{
                                            backgroundColor: count === 0
                                                ? 'rgba(255,255,255,0.04)'
                                                : `rgba(106,63,244,${op})`,
                                        }}
                                    />
                                );
                            })}
                        </div>
                    ))}
                  </div>
                </div>
            )}
        </div>
    );
};

// ─── AuditLogs export ─────────────────────────────────────────────────────────

// Static audit-log feed — realistic admin / staff / system actions, 2026 dates.
const MOCK_AUDIT_LOGS: LogEntry[] = [
    { id: 'al-1', action: 'user.login', details: 'Successful sign-in from 156.198.x.x', performedBy: 'Hisham Kamal', target: 'Session', createdAt: '2026-04-28T08:42:00.000Z' },
    { id: 'al-2', action: 'grade.override', details: 'Overrode CS201 final grade B → A- for student stu-1182', performedBy: 'Dr. Amira Saleh', target: 'GradebookEntry', createdAt: '2026-04-28T07:55:00.000Z' },
    { id: 'al-3', action: 'course.create', details: 'Created new section DS310-L2', performedBy: 'Hisham Kamal', target: 'CourseSection', createdAt: '2026-04-27T15:10:00.000Z' },
    { id: 'al-4', action: 'user.suspend', details: 'Suspended account for unpaid fees', performedBy: 'System', target: 'User', createdAt: '2026-04-27T03:00:00.000Z' },
    { id: 'al-5', action: 'auth.unauthorized', details: 'Blocked access to /api/admin/users — insufficient scope', performedBy: 'Omar Hassan', target: 'Endpoint', createdAt: '2026-04-26T22:14:00.000Z' },
    { id: 'al-6', action: 'announcement.create', details: 'Published "Spring 2026 Final Exam Schedule"', performedBy: 'Salma Farouk', target: 'Announcement', createdAt: '2026-04-26T09:30:00.000Z' },
    { id: 'al-7', action: 'role.update', details: 'Updated permissions for role "Financial"', performedBy: 'Hisham Kamal', target: 'Role', createdAt: '2026-04-25T13:05:00.000Z' },
    { id: 'al-8', action: 'backup.success', details: 'Scheduled nightly pg_dump completed (148.3 MB)', performedBy: 'System', target: 'Backup', createdAt: '2026-04-25T03:00:00.000Z' },
    { id: 'al-9', action: 'registration.approve', details: 'Approved 12 pending registrations for Level 2', performedBy: 'Nour Abdelrahman', target: 'Registration', createdAt: '2026-04-24T11:20:00.000Z' },
    { id: 'al-10', action: 'lock.create', details: 'Created sign-in lock for department CS', performedBy: 'Hisham Kamal', target: 'LoginLock', createdAt: '2026-04-24T10:00:00.000Z' },
    { id: 'al-11', action: 'transfer.reject', details: 'Rejected external credit transfer — exceeds 25% cap', performedBy: 'Mariam El-Sayed', target: 'ExternalCredit', createdAt: '2026-04-23T16:45:00.000Z' },
    { id: 'al-12', action: 'user.login.fail', details: 'Failed sign-in attempt — wrong password (3rd)', performedBy: 'Karim Mostafa', target: 'Session', createdAt: '2026-04-23T08:01:00.000Z' },
];

export const AuditLogs: React.FC = () => {
    const t = useT();
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        setLogs(MOCK_AUDIT_LOGS);
        setIsLoading(false);
    }, []);

    const filtered = logs.filter(l =>
        l.action.toLowerCase().includes(search.toLowerCase()) ||
        l.performedBy.toLowerCase().includes(search.toLowerCase()) ||
        l.target.toLowerCase().includes(search.toLowerCase())
    );

    const deriveBadge = (action: string): { label: string; cls: string } => {
        const lower = action.toLowerCase();
        if (lower.includes('error') || lower.includes('unauthorized') || lower.includes('fail')) {
            return { label: t('admin.saBadgeWarn'), cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' };
        }
        if (lower.includes('delete') || lower.includes('override') || lower.includes('force')) {
            return { label: t('admin.saBadgeSensitive'), cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
        }
        return { label: t('admin.saBadgeOk'), cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('admin.auditLogs')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.systemAuditSubtitle')}</p>
            </AnimateOnView>

            {/* Search */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} p-4`}>
                    <div className="relative max-w-md">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                        <input
                            value={search} onChange={e => setSearch(e.target.value)} placeholder={t('admin.saAuditSearchPh')}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4]"
                        />
                    </div>
                </div>
            </AnimateOnView>

            {/* Log Table */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} overflow-hidden`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5 dark:bg-black/10 border-b border-white/10 dark:border-white/5">
                                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('admin.saAuditColTimestamp')}</th>
                                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('admin.saAuditColPerformer')}</th>
                                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('admin.saAuditColAction')}</th>
                                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('admin.saAuditColTarget')}</th>
                                    <th className="p-4 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">{t('admin.saAuditColDetails')}</th>
                                    <th className="p-4 pr-6 text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap text-right">{t('admin.saAuditColStatus')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    [1, 2, 3].map(i => <tr key={i}><td colSpan={6} className="p-6 animate-pulse bg-white/5"></td></tr>)
                                ) : filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="p-8 text-center text-gray-500 text-sm">{t('admin.saAuditNoLogs')}</td>
                                    </tr>
                                ) : filtered.map(log => {
                                    const badge = deriveBadge(log.action);
                                    const detailsText = log.details
                                        ? log.details.substring(0, 60) + (log.details.length > 60 ? '…' : '')
                                        : '—';
                                    return (
                                        <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="p-4 text-xs text-gray-500 font-mono whitespace-nowrap">
                                                {new Date(log.createdAt).toLocaleString()}
                                            </td>
                                            <td className="p-4 text-sm text-black dark:text-white font-medium whitespace-nowrap">
                                                {log.performedBy}
                                            </td>
                                            <td className="p-4 text-sm text-[#6A3FF4] font-mono whitespace-nowrap">
                                                {log.action}
                                            </td>
                                            <td className="p-4 text-sm text-black dark:text-gray-300 whitespace-nowrap">
                                                {log.target}
                                            </td>
                                            <td className="p-4 text-xs text-gray-400 max-w-[240px] truncate" title={log.details || undefined}>
                                                {detailsText}
                                            </td>
                                            <td className="p-4 whitespace-nowrap text-right pr-6">
                                                <span className={`inline-block text-[10px] font-bold px-2.5 py-1 rounded-full border ${badge.cls}`}>
                                                    {badge.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </AnimateOnView>

            {/* Activity Heatmap */}
            <AnimateOnView enabled={false}>
                <ActivityHeatmap />
            </AnimateOnView>
        </div>
    );
};

// ─── SystemHealth interfaces ──────────────────────────────────────────────────

interface ActiveSessionsData {
    activeSessions: number;
    onlineUsers: number;
    issuedTokens?: number;
    windowMinutes?: number;
    byRole?: Record<string, number>;
}

interface SystemHealthData {
    status: string;
    uptime: number;
    database: { status: string; latency: number };
    cpu: { loadAvg1m: number; cpuPercent?: number | null; cores?: number };
    memory: { totalMB: number; freeMB: number; usedPercent: number };
    timestamp: string;
}

interface AuditLogEntry {
    id: string;
    action: string;
    target?: string;
    targetType?: string;
    performer: {
        firstName: string;
        lastName: string;
    };
    createdAt: string;
    details: string | Record<string, unknown>;
}

interface ServiceStatus {
    name: string;
    port: number;
    up: boolean;
    note?: string;
}

// ─── Static mock data for SystemHealth ─────────────────────────────────────────

const MOCK_SESSIONS: ActiveSessionsData = {
    activeSessions: 87,
    onlineUsers: 64,
    issuedTokens: 142,
    windowMinutes: 20,
    byRole: { student: 51, professor: 7, ta: 4, sa: 1, admin: 1 },
};

const MOCK_HEALTH: SystemHealthData = {
    status: 'ok',
    uptime: 8 * 86400 + 14 * 3600 + 23 * 60, // 8d 14h 23m
    database: { status: 'ok', latency: 42 },
    cpu: { loadAvg1m: 0, cpuPercent: 31, cores: 8 },
    memory: { totalMB: 16384, freeMB: 6144, usedPercent: 62 },
    timestamp: '2026-04-28T08:45:00.000Z',
};

const MOCK_HEALTH_AUDIT: AuditLogEntry[] = [
    { id: 'ha-1', action: 'user.login', target: 'Session', performer: { firstName: 'Hisham', lastName: 'Kamal' }, createdAt: '2026-04-28T08:42:00.000Z', details: '' },
    { id: 'ha-2', action: 'grade.override', target: 'GradebookEntry', performer: { firstName: 'Amira', lastName: 'Saleh' }, createdAt: '2026-04-28T07:55:00.000Z', details: '' },
    { id: 'ha-3', action: 'backup.success', target: 'Backup', performer: { firstName: 'System', lastName: '' }, createdAt: '2026-04-28T03:00:00.000Z', details: '' },
    { id: 'ha-4', action: 'course.create', target: 'CourseSection', performer: { firstName: 'Hisham', lastName: 'Kamal' }, createdAt: '2026-04-27T15:10:00.000Z', details: '' },
    { id: 'ha-5', action: 'registration.approve', target: 'Registration', performer: { firstName: 'Nour', lastName: 'Abdelrahman' }, createdAt: '2026-04-27T11:20:00.000Z', details: '' },
    { id: 'ha-6', action: 'role.update', target: 'Role', performer: { firstName: 'Hisham', lastName: 'Kamal' }, createdAt: '2026-04-26T13:05:00.000Z', details: '' },
    { id: 'ha-7', action: 'announcement.create', target: 'Announcement', performer: { firstName: 'Salma', lastName: 'Farouk' }, createdAt: '2026-04-26T09:30:00.000Z', details: '' },
    { id: 'ha-8', action: 'lock.create', target: 'LoginLock', performer: { firstName: 'Hisham', lastName: 'Kamal' }, createdAt: '2026-04-24T10:00:00.000Z', details: '' },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

// Built from the canonical PORTS map in shared/config.ts so it can never drift.
// In the MVP build every backend service is reported as UP from static data.
const SERVICE_MAP: { port: number; name: string }[] = [
    { port: PORTS.WEBSOCKET,       name: 'websocket' },
    { port: PORTS.REGISTRATION,    name: 'registration' },
    { port: PORTS.ATTENDANCE,      name: 'attendance' },
    { port: PORTS.PAYMENTS,        name: 'payments' },
    { port: PORTS.COURSE_CONTENT,  name: 'course-content' },
    { port: PORTS.STUDENT_AFFAIRS, name: 'student-affairs' },
    { port: PORTS.USER_PROFILE,    name: 'user-profile' },
    { port: PORTS.CHATBOT,         name: 'chatbot' },
    { port: PORTS.NOTIFICATION,    name: 'notification' },
    { port: PORTS.CHAT,            name: 'chat' },
];

type TFn = (key: string, params?: Record<string, string | number>) => string;

function formatUptime(seconds: number, t: TFn): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t('admin.saUptimeFmt', { d, h, m });
}

function relativeTime(isoString: string, t: TFn): string {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return t('admin.saRelSecondsAgo', { n: diff });
    if (diff < 3600) return t('admin.saRelMinutesAgo', { n: Math.floor(diff / 60) });
    if (diff < 86400) return t('admin.saRelHoursAgo', { n: Math.floor(diff / 3600) });
    return t('admin.saRelDaysAgo', { n: Math.floor(diff / 86400) });
}

function latencyColor(ms: number): string {
    if (ms < 100) return 'text-green-400';
    if (ms < 300) return 'text-yellow-400';
    return 'text-red-400';
}

function memColor(pct: number): string {
    if (pct < 60) return 'text-green-400';
    if (pct < 80) return 'text-yellow-400';
    return 'text-red-400';
}

function cpuColor(pct: number): string {
    if (pct < 50) return 'text-green-400';
    if (pct < 80) return 'text-yellow-400';
    return 'text-red-400';
}

// Format CPU for display. Prefer cpuPercent (Windows fallback) when present;
// otherwise fall back to load average. If both are 0/null show "Idle".
function formatCpu(cpu: SystemHealthData['cpu'], t: TFn): { value: string; cls: string } {
    if (cpu.cpuPercent !== null && cpu.cpuPercent !== undefined) {
        const v = cpu.cpuPercent;
        return { value: `${v.toFixed(0)}%`, cls: cpuColor(v) };
    }
    if (cpu.loadAvg1m > 0) {
        return { value: cpu.loadAvg1m.toFixed(2), cls: 'text-white' };
    }
    return { value: t('admin.saCpuIdle'), cls: 'text-gray-400' };
}

// ─── stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
    label: string;
    value: string;
    icon: string;
    valueClass?: string;
    loading: boolean;
    sublabel?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon, valueClass = 'text-black dark:text-white', loading, sublabel }) => (
    <div className={`${glassCardStyle} p-5 flex flex-col gap-2`}>
        <div className="flex items-center gap-2 text-gray-400 text-xs font-semibold uppercase tracking-wider">
            <i className={`${icon} text-base`}></i>
            {label}
        </div>
        {loading ? (
            <div className="animate-pulse h-8 w-24 rounded-lg bg-white/10"></div>
        ) : (
            <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        )}
        {sublabel && !loading && (
            <p className="text-[11px] text-gray-500">{sublabel}</p>
        )}
    </div>
);

// ─── SystemHealth component ───────────────────────────────────────────────────

export const SystemHealth: React.FC = () => {
    const t = useT();
    const [sessions, setSessions] = useState<ActiveSessionsData | null>(null);
    const [health, setHealth] = useState<SystemHealthData | null>(null);
    const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
    const [services, setServices] = useState<ServiceStatus[]>([]);
    const [statsLoading, setStatsLoading] = useState(true);
    const [servicesLoading, setServicesLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(true);

    // Hydrate everything from static mock data once on mount.
    useEffect(() => {
        setSessions(MOCK_SESSIONS);
        setHealth(MOCK_HEALTH);
        setStatsLoading(false);

        setAuditLogs(MOCK_HEALTH_AUDIT);
        setLogsLoading(false);

        setServices(SERVICE_MAP.map(({ name, port }) => ({ name, port, up: true })));
        setServicesLoading(false);
    }, []);

    const dbLatency = health?.database?.latency ?? 0;
    const memPct = health?.memory?.usedPercent;
    const cpuDisplay = health ? formatCpu(health.cpu, t) : { value: '—', cls: 'text-white' };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Header */}
            <AnimateOnView enabled={false}>
                <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('admin.systemHealthHeading')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.systemAuditSubtitle')}</p>
            </AnimateOnView>

            {/* Row 1 — stat cards */}
            <AnimateOnView enabled={false}>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <StatCard
                        label={t('admin.saStatUptime')}
                        icon="ph-bold ph-clock-countdown"
                        value={health ? formatUptime(health.uptime, t) : '—'}
                        loading={statsLoading}
                    />
                    <StatCard
                        label={t('admin.saStatDbLatency')}
                        icon="ph-bold ph-database"
                        value={health ? `${dbLatency}ms` : '—'}
                        valueClass={health ? latencyColor(dbLatency) : 'text-black dark:text-white'}
                        loading={statsLoading}
                    />
                    <StatCard
                        label={t('admin.saStatCpu')}
                        icon="ph-bold ph-cpu"
                        value={cpuDisplay.value}
                        valueClass={cpuDisplay.cls}
                        sublabel={health?.cpu?.cores ? t('admin.saSubCores', { n: health.cpu.cores }) : undefined}
                        loading={statsLoading}
                    />
                    <StatCard
                        label={t('admin.saStatMemUsed')}
                        icon="ph-bold ph-memory"
                        value={memPct !== undefined ? `${memPct}%` : 'N/A'}
                        valueClass={memPct !== undefined ? memColor(memPct) : 'text-black dark:text-white'}
                        sublabel={health ? t('admin.saSubGbTotal', { gb: (health.memory.totalMB / 1024).toFixed(1) }) : undefined}
                        loading={statsLoading}
                    />
                    <StatCard
                        label={t('admin.saStatActiveSessions')}
                        icon="ph-bold ph-users-three"
                        value={sessions ? String(sessions.activeSessions) : '—'}
                        sublabel={
                            sessions
                                ? (sessions.issuedTokens != null
                                    ? t('admin.saSubRefreshedInIssued', { min: sessions.windowMinutes ?? 20, issued: sessions.issuedTokens })
                                    : t('admin.saSubRefreshedIn', { min: sessions.windowMinutes ?? 20 }))
                                : undefined
                        }
                        loading={statsLoading}
                    />
                    <StatCard
                        label={t('admin.saStatOnlineUsers')}
                        icon="ph-bold ph-activity"
                        value={sessions ? String(sessions.onlineUsers) : '—'}
                        sublabel={t('admin.saSubActiveIn', { min: sessions?.windowMinutes ?? 20 })}
                        loading={statsLoading}
                    />
                </div>
            </AnimateOnView>

            {/* Row 1.5 — by-role breakdown if any sessions are live */}
            {sessions && sessions.byRole && Object.values(sessions.byRole).some((n) => n > 0) && (
                <AnimateOnView enabled={false}>
                    <div className={`${glassCardStyle} p-5`}>
                        <h2 className="text-black dark:text-white font-semibold text-sm uppercase tracking-wider mb-3">
                            {t('admin.saByRoleTitle')}
                        </h2>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            {(['student', 'professor', 'ta', 'sa', 'admin'] as const).map((role) => (
                                <div key={role} className="bg-white/5 dark:bg-black/10 rounded-xl p-3 border border-white/10">
                                    <p className="text-[10px] uppercase tracking-wider text-gray-500">{role}</p>
                                    <p className="text-2xl font-bold text-[#6A3FF4]">{sessions.byRole?.[role] ?? 0}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </AnimateOnView>
            )}

            {/* Row 2 — services + audit */}
            <AnimateOnView enabled={false}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Service Status */}
                    <div className={`${glassCardStyle} p-5`}>
                        <h2 className="text-black dark:text-white font-semibold text-sm uppercase tracking-wider mb-4">
                            {t('admin.saServiceStatus')}
                        </h2>
                        {servicesLoading ? (
                            <div className="grid grid-cols-2 gap-3">
                                {Array.from({ length: 11 }).map((_, i) => (
                                    <div key={i} className="animate-pulse h-9 rounded-xl bg-white/10"></div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-3">
                                {services.map((svc) => {
                                    const tone = svc.up
                                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                        : 'bg-red-500/10 text-red-400 border-red-500/20';
                                    const label = svc.up ? t('admin.saServiceUp') : t('admin.saServiceDown');
                                    const tooltip = svc.note
                                        ? svc.note
                                        : svc.port
                                        ? t('admin.saServicePortTooltip', { port: svc.port })
                                        : svc.name;
                                    return (
                                        <div
                                            key={svc.name}
                                            className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs font-medium ${tone}`}
                                            title={tooltip}
                                        >
                                            <span className="truncate">{svc.name}</span>
                                            <span className={`ml-2 shrink-0 font-bold text-[10px] uppercase`}>
                                                {label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Recent Audit Events */}
                    <div className={`${glassCardStyle} p-5`}>
                        <h2 className="text-black dark:text-white font-semibold text-sm uppercase tracking-wider mb-4">
                            {t('admin.saRecentAudit')}
                        </h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-white/10">
                                        <th className="pb-2 text-xs text-gray-500 font-semibold uppercase tracking-wider pr-4">{t('admin.saAuditColActor')}</th>
                                        <th className="pb-2 text-xs text-gray-500 font-semibold uppercase tracking-wider pr-4">{t('admin.saAuditColAction')}</th>
                                        <th className="pb-2 text-xs text-gray-500 font-semibold uppercase tracking-wider pr-4">{t('admin.saAuditColTarget')}</th>
                                        <th className="pb-2 text-xs text-gray-500 font-semibold uppercase tracking-wider">{t('admin.saAuditColTime')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logsLoading ? (
                                        [1, 2, 3, 4].map((i) => (
                                            <tr key={i}>
                                                <td colSpan={4} className="py-3">
                                                    <div className="animate-pulse h-4 rounded bg-white/10 w-full"></div>
                                                </td>
                                            </tr>
                                        ))
                                    ) : auditLogs.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="py-6 text-center text-gray-500 text-xs">{t('admin.saNoAuditEvents')}</td>
                                        </tr>
                                    ) : (
                                        auditLogs.map((log) => {
                                            const actorName = log.performer
                                                ? `${log.performer.firstName} ${log.performer.lastName}`.trim() || t('admin.saSystemActor')
                                                : t('admin.saSystemActor');
                                            const targetText = log.target || log.targetType || '—';
                                            return (
                                                <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                    <td className="py-2.5 pr-4 text-black dark:text-gray-200 font-medium whitespace-nowrap">{actorName}</td>
                                                    <td className="py-2.5 pr-4 text-[#6A3FF4] font-mono text-xs whitespace-nowrap">{log.action}</td>
                                                    <td className="py-2.5 pr-4 text-gray-400 text-xs whitespace-nowrap">{targetText}</td>
                                                    <td className="py-2.5 text-gray-500 text-xs whitespace-nowrap">{relativeTime(log.createdAt, t)}</td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </AnimateOnView>
        </div>
    );
};
