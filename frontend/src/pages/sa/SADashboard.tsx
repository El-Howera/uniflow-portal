import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- Interfaces ---
interface SADashboardData {
    stats: {
        students: string;
        requests: number;
        complaints: number;
        enrollments: number;
        pendingNameChanges?: number;
    };
    recentActivity: {
        id: string;
        icon: string;
        text: string;
        time: string;
        type: string;
    }[];
    pendingCases: {
        id: string;
        student: string;
        type: string;
        priority: string;
        since: string;
        status?: string;
    }[];
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard: React.FC<{
    title: string; value: string | number; description: string; tagText: string;
    icon: string; targetPath: string; glowColor?: string; isLoading?: boolean;
}> = ({ title, value, description, tagText, icon, targetPath, glowColor = "132, 0, 255", isLoading }) => {
    const navigate = useNavigate();
    return (
        <ParticleCard className={`${glassCardStyle} p-6 flex flex-col justify-between h-full`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor={glowColor}>
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center">
                        <i className={`ph-fill ${icon} text-xl text-[#6A3FF4]`}></i>
                    </div>
                    <span className="text-black dark:text-gray-300 font-bold text-sm uppercase tracking-wider">{title}</span>
                </div>
                <button onClick={() => navigate(targetPath)} className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:border-[#6A3FF4] transition-all group">
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
                <p className="text-black dark:text-gray-300 text-xs w-2/3 leading-relaxed">{description}</p>
                <span className="text-white text-[10px] font-bold bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] px-2 py-1 rounded-full shadow-lg shadow-purple-500/20 whitespace-nowrap">{tagText}</span>
            </div>
        </ParticleCard>
    );
};


const activityColor: Record<string, string> = {
    profile: 'bg-blue-500/20 text-blue-500',
    complaint: 'bg-red-500/20 text-red-500',
    request: 'bg-amber-500/20 text-amber-500',
    enrollment: 'bg-[#6A3FF4]/20 text-[#6A3FF4]',
    resolved: 'bg-green-500/20 text-green-500',
};

const priorityStyle: Record<string, string> = {
    high: 'text-red-500 bg-red-500/10 border-red-500/30',
    medium: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
    low: 'text-green-500 bg-green-500/10 border-green-500/30',
};

// Maps a notification type to the icon + colour bucket used by the activity row.
const NOTIF_ICON: Record<string, { icon: string; type: string }> = {
    request:        { icon: 'ph-file-text',     type: 'request' },
    complaint:      { icon: 'ph-warning-circle', type: 'complaint' },
    enrollment:     { icon: 'ph-books',          type: 'enrollment' },
    announcement:   { icon: 'ph-megaphone',      type: 'profile' },
    name_change:    { icon: 'ph-user-circle',    type: 'profile' },
    grade:          { icon: 'ph-graduation-cap', type: 'profile' },
    attendance:     { icon: 'ph-calendar',       type: 'profile' },
    chat:           { icon: 'ph-chat',           type: 'profile' },
    info:           { icon: 'ph-info',           type: 'profile' },
    success:        { icon: 'ph-check-circle',   type: 'resolved' },
    warning:        { icon: 'ph-warning',        type: 'complaint' },
    critical:       { icon: 'ph-warning-octagon', type: 'complaint' },
    system:         { icon: 'ph-gear',           type: 'profile' },
};

interface RecentNotification {
    id: string;
    title: string;
    content: string;
    type: string;
    createdAt: string;
    isRead: boolean;
    senderName?: string | null;
}

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_DASHBOARD: SADashboardData = {
    stats: {
        students: '1,284',
        requests: 9,
        complaints: 4,
        enrollments: 23,
        pendingNameChanges: 3,
    },
    recentActivity: [],
    pendingCases: [
        { id: 'REQ-2041', student: 'Mariam El-Sayed', type: 'Transcript Request', priority: 'high', since: '2 hours ago', status: 'pending' },
        { id: 'CMP-1187', student: 'Omar Hassan', type: 'Grade Appeal', priority: 'high', since: '5 hours ago', status: 'in_progress' },
        { id: 'REQ-2039', student: 'Youssef Ibrahim', type: 'Enrollment Verification', priority: 'medium', since: '1 day ago', status: 'pending' },
        { id: 'CMP-1185', student: 'Salma Mahmoud', type: 'Facility Complaint', priority: 'low', since: '2 days ago', status: 'completed' },
        { id: 'REQ-2035', student: 'Ahmed Tarek', type: 'Course Withdrawal', priority: 'medium', since: '3 days ago', status: 'rejected' },
    ],
};

const MOCK_RECENT_NOTIFS: RecentNotification[] = [
    { id: 'n1', title: 'New transcript request', content: 'Mariam El-Sayed submitted a transcript request', type: 'request', createdAt: new Date(Date.now() - 12 * 60000).toISOString(), isRead: false, senderName: 'Mariam El-Sayed' },
    { id: 'n2', title: 'Grade appeal escalated', content: 'Omar Hassan opened a grade appeal for CS301', type: 'complaint', createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), isRead: false, senderName: 'Omar Hassan' },
    { id: 'n3', title: 'Enrollment approved', content: 'Spring 2026 enrollment confirmed for 18 students', type: 'enrollment', createdAt: new Date(Date.now() - 26 * 3600000).toISOString(), isRead: true, senderName: 'System' },
    { id: 'n4', title: 'Name change pending', content: 'Salma Mahmoud requested a legal name update', type: 'name_change', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), isRead: true, senderName: 'Salma Mahmoud' },
    { id: 'n5', title: 'Complaint resolved', content: 'Lab AC complaint marked as resolved', type: 'success', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), isRead: true, senderName: 'Facilities' },
];

const MOCK_CURRENT_TERM = 'Spring 2026';

// Compact "x minutes ago" formatter so the activity feed reads naturally.
// Accepts the `t` hook output so labels translate without breaking module purity.
type TFn = (key: string, params?: Record<string, string | number>) => string;
const timeAgo = (iso: string, t: TFn): string => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1) return t('sa.timeJustNow');
    if (min < 60) return t('sa.timeMinAgo', { n: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t('sa.timeHoursAgo', { n: hr });
    const day = Math.round(hr / 24);
    if (day < 7) return t('sa.timeDaysAgo', { n: day });
    return new Date(iso).toLocaleDateString();
};

// ─── Main Component ───────────────────────────────────────────────────────────
const SADashboard: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [data, setData] = useState<SADashboardData | null>(null);
    const [recentNotifs, setRecentNotifs] = useState<RecentNotification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [notifsLoading, setNotifsLoading] = useState(true);
    const [currentTerm, setCurrentTerm] = useState<string>('');

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setData(MOCK_DASHBOARD);
        setRecentNotifs(MOCK_RECENT_NOTIFS);
        setCurrentTerm(MOCK_CURRENT_TERM);
        setIsLoading(false);
        setNotifsLoading(false);
    }, []);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Header */}
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.dashboardTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.dashboardSubtitle')}</p>
            </AnimateOnView>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <AnimateOnView delay={0.1} enabled={false}>
                    <StatCard
                        title={t('sa.statStudentsTitle')}
                        value={data?.stats.students || '0'}
                        description={t('sa.statStudentsDesc')}
                        tagText={currentTerm || t('sa.loadingTag')}
                        icon="ph-users"
                        targetPath="/sa/student-profiles"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.15} enabled={false}>
                    <StatCard
                        title={t('sa.statOpenRequestsTitle')}
                        value={data?.stats.requests || 0}
                        description={t('sa.statOpenRequestsDesc')}
                        tagText={t('sa.statOpenRequestsTag')}
                        icon="ph-file-text"
                        targetPath="/sa/requests"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.2} enabled={false}>
                    <StatCard
                        title={t('sa.statComplaintsTitle')}
                        value={data?.stats.complaints || 0}
                        description={t('sa.statComplaintsDesc')}
                        tagText={t('sa.statComplaintsTag')}
                        icon="ph-warning-circle"
                        targetPath="/sa/complaints"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.25} enabled={false}>
                    <StatCard
                        title={t('sa.statEnrollmentsTitle')}
                        value={data?.stats.enrollments || 0}
                        description={t('sa.statEnrollmentsDesc')}
                        tagText={t('sa.statEnrollmentsTag')}
                        icon="ph-books"
                        targetPath="/sa/enrollment"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
            </div>

            {/* Quick Actions + Activity — both columns share an explicit min-height so they
                render at matched height regardless of how many activity items load. */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch xl:min-h-[340px]">
                {/* Contextual Cards */}
                <AnimateOnView delay={0.3} enabled={false} className="xl:col-span-1 h-full">
                    <div className="flex flex-col gap-4 h-full">
                        {/* Pending Requests */}
                        <motion.button
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate('/sa/requests')}
                            className={`${glassCardStyle} p-5 flex items-center gap-4 hover:border-[#6A3FF4]/50 transition-all cursor-pointer group`}
                        >
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-[#6A3FF4]/20 flex-shrink-0">
                                <i className="ph-fill ph-file-text text-2xl text-[#6A3FF4]"></i>
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider">{t('sa.pendingRequestsCard')}</p>
                                <p className="text-black dark:text-white text-2xl font-bold">{isLoading ? '—' : (data?.stats.requests ?? 0)}</p>
                            </div>
                            <span className="text-[#6A3FF4] text-xs font-bold group-hover:underline whitespace-nowrap">{t('sa.viewAllBtn')}</span>
                        </motion.button>

                        {/* Open Complaints */}
                        <motion.button
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate('/sa/complaints')}
                            className={`${glassCardStyle} p-5 flex items-center gap-4 hover:border-orange-500/50 transition-all cursor-pointer group`}
                        >
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-orange-500/20 flex-shrink-0">
                                <i className="ph-fill ph-warning-circle text-2xl text-orange-500"></i>
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider">{t('sa.openComplaintsCard')}</p>
                                <p className="text-black dark:text-white text-2xl font-bold">{isLoading ? '—' : (data?.stats.complaints ?? 0)}</p>
                            </div>
                            <span className="text-orange-500 text-xs font-bold group-hover:underline whitespace-nowrap">{t('sa.viewAllBtn')}</span>
                        </motion.button>

                        {/* Pending Name Changes */}
                        <motion.button
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate('/sa/name-changes')}
                            className={`${glassCardStyle} p-5 flex items-center gap-4 hover:border-blue-500/50 transition-all cursor-pointer group`}
                        >
                            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-blue-500/20 flex-shrink-0">
                                <i className="ph-fill ph-user-gear text-2xl text-blue-500"></i>
                            </div>
                            <div className="flex-1 text-left">
                                <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider">{t('sa.pendingNameChangesCard')}</p>
                                <p className="text-black dark:text-white text-2xl font-bold">{isLoading ? '—' : (data?.stats.pendingNameChanges ?? 0)}</p>
                            </div>
                            <span className="text-blue-500 text-xs font-bold group-hover:underline whitespace-nowrap">{t('sa.viewAllBtn')}</span>
                        </motion.button>
                    </div>
                </AnimateOnView>

                {/* Recent Activity — driven by the SA's real notification feed. */}
                <AnimateOnView delay={0.4} enabled={false} className="xl:col-span-2 h-full">
                    <ParticleCard className={`${glassCardStyle} p-6 h-full flex flex-col`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                                <i className="ph-bold ph-clock-counter-clockwise text-[#6A3FF4]"></i> {t('sa.recentActivityHeading')}
                            </h3>
                            <button
                                onClick={() => navigate('/sa/notifications')}
                                className="text-[#6A3FF4] text-xs font-bold hover:underline whitespace-nowrap"
                            >
                                {t('sa.viewAllBtn')}
                            </button>
                        </div>
                        <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-1">
                            {notifsLoading ? (
                                [1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 w-full bg-white/5 animate-pulse rounded-xl"></div>)
                            ) : recentNotifs.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm py-10">
                                    <i className="ph-duotone ph-bell-slash text-4xl mb-2 opacity-30"></i>
                                    <p>{t('sa.noRecentNotifications')}</p>
                                </div>
                            ) : (
                                // Cap to 3 so the card never grows the dashboard
                                // row; the rest live behind "View all".
                                recentNotifs.slice(0, 3).map(n => {
                                    const meta = NOTIF_ICON[n.type] ?? NOTIF_ICON.info;
                                    return (
                                        <button
                                            key={n.id}
                                            onClick={() => navigate('/sa/notifications')}
                                            className="w-full text-left flex items-start gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all"
                                        >
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${activityColor[meta.type] || 'bg-gray-500/20 text-gray-500'}`}>
                                                <i className={`ph-fill ${meta.icon} text-lg`}></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-black dark:text-white text-sm font-medium line-clamp-1">
                                                    {n.title}
                                                    {!n.isRead && <span className="ml-2 w-1.5 h-1.5 rounded-full bg-[#6A3FF4] inline-block align-middle"></span>}
                                                </p>
                                                {n.content && (
                                                    <p className="text-gray-400 dark:text-gray-400 text-xs line-clamp-1 mt-0.5">{n.content}</p>
                                                )}
                                                <p className="text-gray-500 dark:text-gray-500 text-[10px] mt-0.5">
                                                    {timeAgo(n.createdAt, t)}
                                                    {n.senderName && <> · {n.senderName}</>}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </ParticleCard>
                </AnimateOnView>
            </div>

            {/* Pending Cases */}
            <AnimateOnView delay={0.5} enabled={false}>
                <div className={`${glassCardStyle} p-4 sm:p-6`}>
                    {/* Header — stack on mobile so the title doesn't crowd
                        the View Complaints / View Requests links. */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 mb-5">
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-list-checks text-[#6A3FF4]"></i> {t('sa.pendingCasesHeading')}
                        </h3>
                        <div className="flex gap-2 flex-wrap">
                            <button onClick={() => navigate('/sa/complaints')} className="text-xs font-semibold text-[#6A3FF4] hover:underline whitespace-nowrap">{t('sa.viewComplaints')}</button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button onClick={() => navigate('/sa/requests')} className="text-xs font-semibold text-[#6A3FF4] hover:underline whitespace-nowrap">{t('sa.viewRequests')}</button>
                        </div>
                    </div>
                    {/* Inner min-width guarantees the 6-column table stays
                        readable; overflow-x-auto lets mobile users pan
                        horizontally to see all columns without column
                        text squishing into each other. */}
                    <div className="overflow-x-auto -mx-2 sm:mx-0 px-2 sm:px-0">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead>
                                <tr className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                                    <th className="text-left pb-3 font-semibold">{t('sa.caseIdCol')}</th>
                                    <th className="text-left pb-3 font-semibold">{t('sa.studentCol')}</th>
                                    <th className="text-left pb-3 font-semibold">{t('staff.type')}</th>
                                    <th className="text-left pb-3 font-semibold">{t('staff.priority')}</th>
                                    <th className="text-left pb-3 font-semibold">{t('sa.openSinceCol')}</th>
                                    <th className="text-left pb-3 font-semibold text-right">{t('staff.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="space-y-2">
                                {isLoading ? (
                                    [1, 2, 3, 4].map(i => (
                                        <tr key={i} className="animate-pulse border-t border-white/10">
                                            <td colSpan={6} className="py-4"><div className="h-6 bg-white/5 rounded w-full"></div></td>
                                        </tr>
                                    ))
                                ) : (data?.pendingCases || []).length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-gray-500 italic">{t('sa.noPendingCases')}</td>
                                    </tr>
                                ) : (
                                    (data?.pendingCases || []).map((c, i) => (
                                        <motion.tr
                                            key={c.id}
                                            initial={{ opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.06 }}
                                            className="border-t border-white/10 dark:border-white/5 hover:bg-white/5 dark:hover:bg-black/10 transition-colors"
                                        >
                                            <td className="py-3 font-mono text-xs text-[#6A3FF4] font-bold">{c.id}</td>
                                            <td className="py-3 text-black dark:text-white font-medium">{c.student}</td>
                                            <td className="py-3 text-gray-500 dark:text-gray-400">{c.type}</td>
                                            <td className="py-3">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${priorityStyle[c.priority as keyof typeof priorityStyle] || priorityStyle.medium}`}>{c.priority}</span>
                                            </td>
                                            <td className="py-3 text-gray-500 dark:text-gray-400 text-xs">{c.since}</td>
                                            <td className="py-3 text-right">
                                                {/* Only render Manage on cases that are still actionable.
                                                   Completed (resolved) / rejected cases get a small status
                                                   pill instead — the button would lead nowhere useful. */}
                                                {(c.status === 'completed' || c.status === 'rejected') ? (
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                                                        c.status === 'completed'
                                                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                                            : 'bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/30'
                                                    }`}>
                                                        {c.status === 'completed' ? t('sa.caseResolvedPill') : t('sa.caseRejectedPill')}
                                                    </span>
                                                ) : (
                                                    <button onClick={() => navigate('/sa/requests')} className="text-xs font-semibold text-white bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] px-3 py-1 rounded-lg hover:opacity-90 transition-opacity">
                                                        {t('sa.manageCaseBtn')}
                                                    </button>
                                                )}
                                            </td>
                                        </motion.tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </AnimateOnView>
        </div>
    );
};

export default SADashboard;
