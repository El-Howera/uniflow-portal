import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useNotifications } from '../../context/NotificationContext';
import { getRoutePath } from '../../utils/routeUtils';
import { ParticleCard } from '../../components/MagicBento';
import { AnimateOnView } from '../../components/AnimateOnView';
import { fetchCourseAssignments, fetchUserSubmissions, Assignment, Submission } from '../../utils/courseContentService';
import { getAttendanceSummary } from '../../utils/attendanceService';
import { fetchGpaSummary, fetchTranscript, GpaSummary, TranscriptCourse } from '../../utils/userProfileService';
import { useRegistration } from '../../context/RegistrationContext';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';
import { useHasPermission } from '../../utils/permissions';

// --- Base style for the glass morphism effect ---
const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// Dashboard Stat Card Component
const DashboardStatCard: React.FC<{
    title: string;
    value: string;
    description: string;
    tagText: string;
    targetPage: string;
    // Optional permission gate for the drill-through arrow. When the user
    // doesn't have `read` on the named category, the arrow button is hidden
    // — the stat itself still renders since the value is informational and
    // we don't want a blank dashboard when an admin disables a category.
    requires?: { category: string; action?: 'read' | 'write' | 'delete' };
}> = ({ title, value, description, tagText, targetPage, requires }) => {
    const navigate = useNavigate();
    const canDrillThrough = useHasPermission(
        requires?.category ?? '*',
        requires?.action ?? 'read',
    );
    const showArrow = !requires || canDrillThrough;

    return (
        <ParticleCard
            className={`${glassCardStyle} p-4 sm:p-6 flex flex-col justify-between h-full`}
            enableTilt={true}
            enableMagnetism={true}
            clickEffect={true}
            particleCount={10}
            glowColor="132, 0, 255"
        >
            <div className="flex justify-between items-start">
                <span className="text-black dark:text-gray-300 font-bold text-sm uppercase tracking-wider">{title}</span>
                {showArrow && (
                    <button
                        onClick={() => navigate(getRoutePath(targetPage))}
                        className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white dark:hover:text-white hover:border-[#6A3FF4] transition-all group"
                    >
                        <i className="ph-bold ph-arrow-right text-black dark:text-gray-300 group-hover:text-white transition-colors"></i>
                    </button>
                )}
            </div>

            <div className="my-3">
                <span className="text-black dark:text-white font-bold text-4xl">{value}</span>
            </div>

            <div className="flex justify-between items-end gap-2">
                <p className="text-black dark:text-gray-300 text-xs w-2/3 leading-relaxed line-clamp-2">{description}</p>
                <span className="text-white text-[10px] font-bold bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] px-2 py-1 rounded-full shadow-lg shadow-purple-500/20 whitespace-nowrap">
                    {tagText}
                </span>
            </div>
        </ParticleCard>
    );
};

// Extended type to include courseCode on dashboard assignments
// UI-side status, computed identically to AssignmentPageContent so the dashboard
// card and the full page never disagree on what an assignment looks like.
type DashboardStatus = 'Due Soon' | 'Submitted' | 'Graded' | 'Missing';

interface DashboardAssignment extends Assignment {
    courseCode: string;
    uiStatus: DashboardStatus;
    submission?: Submission;
}

// Assignments Card Component — matches Assignments page styling
const DashboardAssignmentsCard: React.FC<{ assignments: DashboardAssignment[] }> = ({ assignments }) => {
    const navigate = useNavigate();
    const t = useT();
    // Gate the "view all" / row-tap navigation on the same permission category
    // the /student/assignments sidebar entry uses. If an admin disables the
    // category in the matrix, the card stays visible (the data is still
    // relevant on the dashboard) but loses its drill-through.
    const canOpenAssignments = useHasPermission('Materials', 'read');
    const [activeFilter, setActiveFilter] = useState<'All' | DashboardStatus>('All');
    const filters: ('All' | DashboardStatus)[] = ['All', 'Due Soon', 'Submitted', 'Graded', 'Missing'];

    // Map the (English-only) internal filter key to a translated label.
    const filterLabel = (f: 'All' | DashboardStatus): string => {
        switch (f) {
            case 'All':       return t('dashboard.filterAll');
            case 'Due Soon':  return t('dashboard.filterDueSoon');
            case 'Submitted': return t('dashboard.filterSubmitted');
            case 'Graded':    return t('dashboard.filterGraded');
            case 'Missing':   return t('dashboard.filterMissing');
        }
    };

    const filteredAssignments = assignments.filter(item => {
        if (activeFilter === 'All') return true;
        return item.uiStatus === activeFilter;
    });

    // One source of truth for the badge — same colours as the Assignments page.
    const getBadge = (
        s: DashboardStatus,
        score?: number | null,
        maxScore?: number,
        latePenalty?: number
    ) => {
        switch (s) {
            case 'Due Soon':
                return {
                    label: t('dashboard.badgeDueSoon'),
                    style: 'bg-[#6A3FF4]/20 text-[#6A3FF4] dark:text-[#bda8ff] border border-[#6A3FF4]/30',
                };
            case 'Submitted':
                return {
                    label: t('dashboard.badgeSubmitted'),
                    style: 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30',
                };
            case 'Graded':
                return {
                    label:
                        score != null
                            ? maxScore
                                ? t('dashboard.badgeGradedScore', { score, max: maxScore })
                                : t('dashboard.badgeGradedNoMax', { score })
                            : t('dashboard.badgeGraded'),
                    style: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30',
                };
            case 'Missing':
            default:
                return {
                    label:
                        latePenalty && latePenalty !== 0
                            ? t('dashboard.badgeMissingPenalty', { penalty: latePenalty })
                            : t('dashboard.badgeMissing'),
                    style: 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30',
                };
        }
    };

    return (
        <div className={`${glassCardStyle} p-4 sm:p-6 flex flex-col h-fit w-full`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 gap-4">
                <h2 className="text-black dark:text-white text-xl font-bold flex items-center">
                    <i className="ph-bold ph-clipboard-text mr-2 text-[#6A3FF4]"></i>
                    {t('dashboard.assignmentsTitle')}
                </h2>
                <div className="flex items-center gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
                    {filters.map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setActiveFilter(filter)}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-colors relative ${activeFilter !== filter ? 'text-black dark:text-gray-300 hover:text-black dark:hover:text-white' : 'text-white'
                                }`}
                        >
                            {activeFilter === filter && (
                                <motion.div
                                    layoutId="activeAssignmentFilter"
                                    className="absolute inset-0 bg-[#6A3FF4] rounded-md shadow-lg"
                                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                />
                            )}
                            <span className="relative z-10">{filterLabel(filter)}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-3 min-h-[5rem]">
                <AnimatePresence mode="popLayout" initial={false}>
                    {filteredAssignments.slice(0, 4).map((assignment) => {
                        const badge = getBadge(
                            assignment.uiStatus,
                            assignment.submission?.score,
                            assignment.submission?.maxScore ?? assignment.maxScore,
                            assignment.latePenalty
                        );
                        return (
                            <motion.div
                                key={assignment.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{
                                    duration: 0.3,
                                    ease: "easeInOut",
                                    layout: { type: "spring", stiffness: 300, damping: 25 }
                                }}
                                onClick={canOpenAssignments ? () => navigate('/student/assignments') : undefined}
                                className={`p-4 bg-white/10 dark:bg-black/20 rounded-xl border border-white/20 dark:border-white/10 transition-all group ${canOpenAssignments ? 'hover:border-[#6A3FF4]/50 hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'}`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <p className="text-black dark:text-white font-bold text-sm group-hover:text-[#6A3FF4] dark:group-hover:text-[#c89eff] transition-colors">{assignment.title}</p>
                                    <span className={`text-[10px] font-semibold px-3 py-1 rounded-full whitespace-nowrap ${badge.style}`}>
                                        {badge.label}
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                                    <span className="flex items-center gap-1">
                                        <i className="ph-bold ph-book-open text-[#6A3FF4]"></i>
                                        {assignment.courseCode || t('dashboard.courseFallback')}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <i className="ph-bold ph-calendar-blank"></i>
                                        {t('dashboard.dueLabel')} {new Date(assignment.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {canOpenAssignments && (
                <button
                    onClick={() => navigate('/student/assignments')}
                    className="mt-5 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2"
                >
                    <i className="ph-bold ph-arrow-right"></i>
                    {t('dashboard.viewAllAssignments')}
                </button>
            )}
        </div>
    );
};

// Notifications Card Component
const DashboardNotificationsCard: React.FC = () => {
    const navigate = useNavigate();
    const t = useT();
    const { notifications: liveNotifications, markAsRead } = useNotifications();
    const [dbNotifications, setDbNotifications] = useState<{
        id: string;
        title: string;
        content: string;
        type: string;
        timestamp: string;
        isRead: boolean;
        courseCode: undefined;
        // Raw ISO timestamp for sorting + freshness; isStale flips to true
        // when the row is older than the freshness cutoff so the renderer
        // can drop it without re-parsing the formatted string.
        _rawTs?: string;
        isStale?: boolean;
    }[]>([]);

    // Helper to format timestamp using translated relative-time strings.
    const formatTimestamp = (timestamp: string): string => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

        if (diffMins < 1) return t('dashboard.justNow');
        if (diffMins < 60) return t('dashboard.minAgo', { n: diffMins });
        if (diffHours < 24) return t('dashboard.hoursAgo', { n: diffHours });
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    useEffect(() => {
        const fetchDbNotifications = async () => {
            try {
                const userId = localStorage.getItem('currentUserId') || localStorage.getItem('currentUserEmail') || '';
                const token = localStorage.getItem('authToken');
                if (!userId || !token) return;
                const res = await fetch(
                    `${API_URLS.notification()}/api/notifications/${encodeURIComponent(userId)}`,
                    { credentials: 'include', headers: { Authorization: `Bearer ${token}` } }
                );
                if (!res.ok) return;
                const data = await res.json();
                const notifications = Array.isArray(data) ? data : (data.notifications ?? []);
                const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
                type ApiNotification = {
                    id: string | number;
                    title?: string;
                    content?: string;
                    message?: string;
                    type?: string;
                    createdAt?: string;
                    timestamp?: string;
                    isRead?: boolean;
                };
                setDbNotifications(
                    (notifications as ApiNotification[]).map((n) => {
                        const raw = n.createdAt ?? n.timestamp ?? new Date().toISOString();
                        const ts = new Date(raw).getTime();
                        return {
                            id: String(n.id),
                            title: n.title ?? 'Notification',
                            content: n.content ?? n.message ?? '',
                            type: n.type ?? 'info',
                            timestamp: formatTimestamp(raw),
                            isRead: Boolean(n.isRead),
                            courseCode: undefined,
                            _rawTs: raw,
                            // Stale flag — same 14-day rule the live-notification
                            // filter uses. Drops zombie rows from announcements
                            // deleted before the cascade-clean was wired.
                            isStale: !Number.isFinite(ts) || ts < cutoff,
                        };
                    })
                );
            } catch {
                // non-critical — DB notifications simply won't appear
            }
        };
        fetchDbNotifications();
    // formatTimestamp is defined in the same scope and stable — no dep needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Recent-activity freshness filter — anything older than 14 days is
    // dropped before display. Without this, deleted announcements that the
    // backend no longer cascade-cleans (older rows) keep haunting the
    // "Recent Activity" card weeks after they were posted.
    const FRESHNESS_DAYS = 14;
    const freshnessCutoff = Date.now() - FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
    const isFresh = (rawTimestamp: string | undefined) => {
        if (!rawTimestamp) return false;
        const t = new Date(rawTimestamp).getTime();
        return Number.isFinite(t) && t >= freshnessCutoff;
    };

    // Merge live notifications + DB notifications, deduped by id, capped at 2.
    const liveNormalized = liveNotifications
        .filter(n => isFresh(n.timestamp))
        .map(n => ({
            id: n.id,
            title: n.title,
            content: n.content,
            type: n.type === 'chat' ? 'message' : n.type,
            timestamp: formatTimestamp(n.timestamp),
            isLive: true,
            courseCode: n.courseCode,
            originalType: n.type,
            isRead: n.isRead,
            // Keep the raw timestamp around so we can sort by it before
            // slicing to top 2 (formatTimestamp returns "5m ago" strings
            // that don't sort correctly).
            _rawTs: n.timestamp,
        }));
    // dbNotifications already store the formatted string in `timestamp`, so
    // freshness can't be re-derived from that field. We probe the DB row's
    // raw createdAt at fetch time (see fetchDbNotifications below).
    const dbNormalized = dbNotifications
        .filter(n => !liveNormalized.some(l => l.id === n.id))
        .filter(n => !n.isStale)
        .map(n => ({
            ...n,
            isLive: false,
            originalType: n.type,
            _rawTs: n._rawTs,
        }));
    const combinedNotifications = [...liveNormalized, ...dbNormalized]
        .sort((a, b) => new Date(b._rawTs ?? 0).getTime() - new Date(a._rawTs ?? 0).getTime())
        .slice(0, 2);

    const handleNotificationClick = (notification: { isLive: boolean; id: string | number; originalType: string; courseCode?: string; type: string }) => {
        // Mark as read if it's a live notification
        if (notification.isLive && typeof notification.id === 'string') {
            markAsRead(notification.id);
        }

        // Navigate based on notification type
        if (notification.originalType === 'chat' && notification.courseCode) {
            const courseCode = notification.courseCode.split('-')[0];
            navigate(`/student/chatroom/${courseCode}`);
        } else if (notification.type === 'announcement') {
            navigate('/student/announcements');
        } else {
            navigate('/student/notifications');
        }
    };

    const getNotificationDotColor = (type: string) => {
        switch (type) {
            case 'critical': return 'bg-red-500';
            case 'message': case 'chat': return 'bg-[#6A3FF4]';
            case 'announcement': return 'bg-orange-500';
            default: return 'bg-gray-400';
        }
    };

    return (
        <ParticleCard
            className={`${glassCardStyle} p-5 flex flex-col h-fit`}
            enableTilt={true}
            enableMagnetism={true}
            clickEffect={true}
            particleCount={10}
            glowColor="132, 0, 255"
        >
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-black dark:text-white text-lg font-bold">{t('dashboard.recentActivity')}</h2>
                {liveNotifications.filter(n => !n.isRead).length > 0 && (
                    <span className="bg-[#6A3FF4] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {liveNotifications.filter(n => !n.isRead).length} {t('dashboard.new')}
                    </span>
                )}
            </div>
            <div className="space-y-2">
                {combinedNotifications.length > 0 ? (
                    combinedNotifications.map((notification) => (
                        <div
                            key={notification.id}
                            onClick={() => handleNotificationClick(notification)}
                            className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-white/10 dark:hover:bg-black/20 transition-colors cursor-pointer group"
                        >
                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${getNotificationDotColor(notification.type)} ${notification.isLive ? 'animate-pulse' : ''}`}></div>
                            <div className="flex-1 min-w-0">
                                <p className="text-black dark:text-white text-sm font-semibold group-hover:text-[#6A3FF4] dark:group-hover:text-[#c89eff] transition-colors line-clamp-1">{notification.title}</p>
                                <p className="text-black dark:text-gray-300 text-xs mt-0.5 line-clamp-1">{notification.content}</p>
                                <p className="text-gray-600 dark:text-gray-400 text-[10px] mt-0.5">{notification.timestamp}</p>
                            </div>
                            {notification.isLive && !notification.isRead && (
                                <span className="text-[#6A3FF4] text-[10px] font-medium">{t('dashboard.newBadge')}</span>
                            )}
                        </div>
                    ))
                ) : (
                    <p className="text-gray-500 text-sm text-center py-4">{t('dashboard.noRecentActivity')}</p>
                )}
            </div>

            <button
                onClick={() => navigate('/student/notifications')}
                className="mt-4 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-xs"
            >
                {t('dashboard.viewAll')}
            </button>
        </ParticleCard>
    );
};

// Last Semester Results Card — shows course grades with quiz/midterm marks from transcript breakdown
const DashboardGradesCard: React.FC<{ grades: TranscriptCourse[], semesterName?: string }> = ({ grades, semesterName }) => {
    const navigate = useNavigate();
    const t = useT();
    // Mirrors the /student/full-transcript and /student/gpa-calculator sidebar
    // entries — both gate on Grades:read. Disable the row tap + "View Full
    // Transcript" button when the user lacks that permission.
    const canOpenTranscript = useHasPermission('Grades', 'read');
    const displayGrades = grades.slice(0, 2);

    const getGradeStyle = (g: string) => {
        if (g.startsWith('A')) return 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30';
        if (g.startsWith('B')) return 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30';
        if (g.startsWith('C')) return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30';
        return 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30';
    };

    return (
        <ParticleCard
            className={`${glassCardStyle} p-5 flex flex-col h-fit`}
            enableTilt={true}
            enableMagnetism={true}
            clickEffect={true}
            particleCount={10}
            glowColor="132, 0, 255"
        >
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
                    <i className="ph-bold ph-exam mr-2 text-[#6A3FF4]"></i>
                    {t('dashboard.lastSemesterResults')}
                </h2>
                {semesterName && (
                    <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-2 py-0.5 rounded-full">
                        {semesterName}
                    </span>
                )}
            </div>

            <div className="space-y-3">
                {displayGrades.length > 0 ? displayGrades.map((course, index) => {
                    return (
                        <div
                            key={index}
                            onClick={canOpenTranscript ? () => navigate('/student/full-transcript') : undefined}
                            className={`p-3 bg-white/10 dark:bg-black/20 rounded-xl border border-white/20 dark:border-white/10 transition-all ${canOpenTranscript ? 'hover:border-[#6A3FF4]/30 cursor-pointer hover:-translate-y-0.5' : 'cursor-default'}`}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex-1 min-w-0">
                                    <p className="text-black dark:text-white font-semibold text-xs truncate">{course.title}</p>
                                    <p className="text-gray-500 text-[10px]">{course.code} • {course.credits} {t('dashboard.creditsAbbr')}</p>
                                </div>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ml-2 ${getGradeStyle(course.grade)}`}>
                                    {course.grade}
                                </div>
                            </div>
                        </div>
                    );
                }) : (
                    <div className="text-center py-6">
                        <i className="ph-bold ph-exam text-3xl block mb-2 opacity-50 text-gray-500"></i>
                        <p className="text-gray-500 text-sm">{t('dashboard.noSemesterResults')}</p>
                    </div>
                )}
            </div>

            {canOpenTranscript && (
                <button
                    onClick={() => navigate('/student/full-transcript')}
                    className="mt-4 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-xs flex items-center justify-center gap-2"
                >
                    <i className="ph-bold ph-arrow-right"></i>
                    {t('dashboard.viewFullTranscript')}
                </button>
            )}
        </ParticleCard>
    );
};

// Main Dashboard Page Component
const Dashboard: React.FC = () => {
    const t = useT();
    // State for real data
    const [assignments, setAssignments] = useState<DashboardAssignment[]>([]);
    const [gpaSummary, setGpaSummary] = useState<GpaSummary | null>(null);
    const [recentGrades, setRecentGrades] = useState<TranscriptCourse[]>([]);
    const [semesterName, setSemesterName] = useState<string>('');
    // Raw attendance numbers — the displayed text (including "N/A" and
    // "No data available") is derived in render from these so a language
    // switch updates instantly. Storing translated strings in state used
    // to require a refresh because the loader useEffect doesn't depend
    // on `language`.
    const [attendanceData, setAttendanceData] = useState<
        | { state: 'loading' }
        | { state: 'unauth' }
        | { state: 'no-data' }
        | { state: 'ok'; pct: number; absent: number }
    >({ state: 'loading' });
    const attendancePercentage = (() => {
        if (attendanceData.state === 'loading') return '…';
        if (attendanceData.state === 'unauth' || attendanceData.state === 'no-data') return t('common.notAvailable');
        return `${attendanceData.pct}%`;
    })();
    const attendanceDesc = (() => {
        if (attendanceData.state === 'loading') return t('dashboard.loading');
        if (attendanceData.state === 'unauth') return t('dashboard.notAuthenticated');
        if (attendanceData.state === 'no-data') return t('dashboard.noDataAvailable');
        return attendanceData.absent === 0
            ? t('dashboard.perfectAttendance')
            : t('dashboard.missedLectures', { n: attendanceData.absent, s: attendanceData.absent === 1 ? '' : 's' });
    })();
    // Same source as the Assignments page — keeps the dashboard card and the
    // full page in lockstep regardless of what the transcript shows.
    const { registeredCourses } = useRegistration();

    useEffect(() => {
        const loadDashboardData = async () => {
            const studentEmail = localStorage.getItem('currentUserEmail');
            const userIdForSubs = localStorage.getItem('currentUserId') || studentEmail || '';
            if (!studentEmail) {
                setAttendanceData({ state: 'unauth' });
                return;
            }

            try {
                // Fetch GPA
                const gpaData = await fetchGpaSummary(studentEmail);
                // Only set GPA if it's valid and has a gpa property that's a number
                if (gpaData && typeof gpaData.gpa === 'number') {
                    setGpaSummary(gpaData);
                } else {
                    setGpaSummary(null);
                }

                // Fetch Transcript for recent grades.
                //
                // Owner directive (2026-05-17): show the latest 2 grades
                // from the latest semester that is NOT the current one.
                // The transcript array is chronological — most recent at
                // the end — so we reverse, skip any semester whose name
                // matches the system's current semester (e.g. "Spring
                // 2026") AND any semester with no graded courses (IP-only
                // rows from in-progress current term), and take the first
                // semester that has at least one graded course.
                const transcriptData = await fetchTranscript(studentEmail);
                if (transcriptData && transcriptData.semesters && transcriptData.semesters.length > 0) {
                    let currentSemesterName = '';
                    try {
                        const pubRes = await fetch(`${API_URLS.userProfile()}/api/public-settings`, { credentials: 'include' });
                        if (pubRes.ok) {
                            const pub = await pubRes.json();
                            currentSemesterName = (pub?.currentSemester || '').toString().toLowerCase();
                        }
                    } catch { /* fall through — no current-semester filter */ }
                    const reversed = [...transcriptData.semesters].reverse();
                    const isCurrent = (n: string) =>
                        !!currentSemesterName && n.trim().toLowerCase() === currentSemesterName;
                    const hasGradedCourse = (sem: { courses: TranscriptCourse[] }) =>
                        sem.courses.some((c) => c.grade && c.grade !== 'IP');
                    const previousGraded = reversed.find(
                        (sem) => !isCurrent(sem.name || '') && hasGradedCourse(sem),
                    );
                    if (previousGraded) {
                        // Sort by quality points descending so the two grades
                        // shown lead with the best — keeps the dashboard
                        // motivational rather than highlighting a low score.
                        const ranked = [...previousGraded.courses]
                            .filter((c) => c.grade && c.grade !== 'IP')
                            .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
                        setRecentGrades(ranked.slice(0, 2));
                        setSemesterName(previousGraded.name || '');
                    } else {
                        setRecentGrades([]);
                        setSemesterName('');
                    }
                }

                // Fetch Assignments — pull from the student's CURRENT enrolled courses
                // (same source the Assignments page uses) and join with submissions
                // so each card carries the real submission row + score.
                const enrolledCourseCodes = Array.from(
                    new Set(registeredCourses.map(r => r.courseCode))
                );
                const submissionsList = userIdForSubs
                    ? await fetchUserSubmissions(userIdForSubs)
                    : [];
                const submissionsByAssignmentId = new Map<string, Submission>(
                    submissionsList.map(s => [s.assignmentId, s])
                );

                let allFetchedAssignments: DashboardAssignment[] = [];
                for (const code of enrolledCourseCodes) {
                    const courseAssignments = await fetchCourseAssignments(code, userIdForSubs);
                    const now = new Date();
                    const tagged: DashboardAssignment[] = courseAssignments.map(a => {
                        const sub = submissionsByAssignmentId.get(a.id);
                        const isPastDue = new Date(a.dueDate) < now;
                        const isGraded =
                            sub?.score != null ||
                            sub?.status === 'graded' ||
                            a.status === 'graded';
                        const isSubmitted =
                            !!sub || a.status === 'submitted' || a.status === 'graded';
                        const uiStatus: DashboardStatus = isGraded
                            ? 'Graded'
                            : isSubmitted
                            ? 'Submitted'
                            : isPastDue
                            ? 'Missing'
                            : 'Due Soon';
                        return { ...a, courseCode: code, uiStatus, submission: sub };
                    });
                    allFetchedAssignments = [...allFetchedAssignments, ...tagged];
                }
                // Sort by due date
                allFetchedAssignments.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
                setAssignments(allFetchedAssignments);

                // Fetch Attendance
                const attSummary = await getAttendanceSummary(studentEmail);

                if (attSummary && attSummary.length > 0) {
                    // Aggregate data from all courses
                    let totalPresent = 0;
                    let totalLate = 0;
                    let totalAbsent = 0;
                    let totalExcused = 0;
                    let totalExpected = 0;

                    attSummary.forEach(course => {
                        totalPresent += course.present;
                        totalLate += course.late;
                        totalAbsent += course.absent;
                        totalExpected += course.total;
                        // Excused is not tracked in the summary object keys I saw?
                        // Wait, I need to check if 'excused' IS in the response.
                        // Based on attendance-server.js, it IS:
                        // summary[courseCode] = { ..., excused: ... }
                        // So I need to make sure I add it.
                        totalExcused += course.excused || 0;
                    });

                    // Calculate overall percentage
                    // (Present + Late + Excused) / Total * 100
                    const attended = totalPresent + totalLate + totalExcused;
                    const overallRate = totalExpected > 0 ? Math.round((attended / totalExpected) * 100) : 100;

                    setAttendanceData({ state: 'ok', pct: overallRate, absent: totalAbsent });
                } else {
                    setAttendanceData({ state: 'no-data' });
                }

            } catch (error) {
                console.error("Failed to load dashboard data", error);
            }
        };

        loadDashboardData();
        // Re-run whenever the student's enrolled course list changes so the
        // dashboard assignments card always reflects the same set as the page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registeredCourses]);

    return (
        <div className="space-y-4 sm:space-y-6 pb-16">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1">{t('dashboard.title')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('common.welcomeBack')}</p>
            </AnimateOnView>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <AnimateOnView delay={0.1}>
                    <DashboardStatCard
                        title={t('dashboard.gpa')}
                        value={gpaSummary && typeof gpaSummary.gpa === 'number' ? gpaSummary.gpa.toFixed(2) : "..."}
                        description={
                            gpaSummary
                                ? t('dashboard.cumulativeGpaDesc', { x: gpaSummary.totalCredits })
                                : t('dashboard.loading')
                        }
                        tagText={
                            gpaSummary && typeof gpaSummary.gpa === 'number' && gpaSummary.gpa >= 3.5
                                ? t('dashboard.tagExcellent')
                                : t('dashboard.tagGood')
                        }
                        targetPage="GPA Calculator"
                        requires={{ category: 'Grades', action: 'read' }}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.2}>
                    <DashboardStatCard
                        title={t('dashboard.attendance')}
                        value={attendancePercentage}
                        description={attendanceDesc}
                        tagText={
                            !isNaN(parseInt(attendancePercentage)) && parseInt(attendancePercentage) >= 90
                                ? t('dashboard.tagExcellent')
                                : !isNaN(parseInt(attendancePercentage)) && parseInt(attendancePercentage) >= 75
                                ? t('dashboard.tagGood')
                                : t('dashboard.tagWarning')
                        }
                        targetPage="Attendance"
                        requires={{ category: 'Attendance', action: 'read' }}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.3}>
                    <DashboardStatCard
                        title={t('dashboard.creditsTitle')}
                        value={gpaSummary ? `${gpaSummary.totalCredits}` : "..."}
                        description={
                            gpaSummary
                                ? t('dashboard.creditsDescription', { x: gpaSummary.creditsThisSemester })
                                : t('dashboard.loading')
                        }
                        tagText={t('dashboard.tagOnTrack')}
                        targetPage="Full Transcript"
                        requires={{ category: 'Grades', action: 'read' }}
                    />
                </AnimateOnView>
            </div>

            <LayoutGroup>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6 items-start">
                    <AnimateOnView delay={0.4} className="xl:col-span-2 w-full">
                        <DashboardAssignmentsCard assignments={assignments} />
                    </AnimateOnView>

                    <div className="flex flex-col gap-4 sm:gap-6 w-full">
                        <AnimateOnView delay={0.5}>
                            <DashboardNotificationsCard />
                        </AnimateOnView>
                        <AnimateOnView delay={0.6}>
                            <DashboardGradesCard grades={recentGrades} semesterName={semesterName} />
                        </AnimateOnView>
                        <AnimateOnView delay={0.7}>
                            <DashboardQuickLinksCard />
                        </AnimateOnView>
                    </div>
                </div>
            </LayoutGroup>
        </div>
    );
};

// Quick Links card — SA / admin can curate the list from SA → Categories →
// Student quick links. Hides itself entirely when nothing is configured so
// dashboards in fresh tenants don't show an empty section.
const DashboardQuickLinksCard: React.FC = () => {
    const t = useT();
    const [links, setLinks] = useState<Array<{ label: string; url: string; icon?: string }>>([]);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_URLS.studentAffairs()}/api/student/quick-links`, {
                    credentials: 'include',
                    headers: { ...authHeaders() },
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (Array.isArray(data?.links)) setLinks(data.links);
            } catch { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, []);
    if (links.length === 0) return null;
    return (
        <ParticleCard className="bg-white/5 dark:bg-black/20 backdrop-blur-md border border-white/10 dark:border-white/5 rounded-3xl p-6 sm:p-8 w-full">
            <h3 className="text-black dark:text-white text-xl sm:text-2xl font-bold mb-4 flex items-center gap-2">
                <i className="ph-bold ph-link-simple text-[#6A3FF4]"></i>
                {t('dashboard.quickLinksTitle') === 'dashboard.quickLinksTitle' ? 'Quick Links' : t('dashboard.quickLinksTitle')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {links.map((link, i) => (
                    <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 dark:bg-black/30 border border-white/10 dark:border-white/5 hover:bg-[#6A3FF4]/10 hover:border-[#6A3FF4]/40 transition-colors group"
                    >
                        <div className="w-9 h-9 rounded-lg bg-[#6A3FF4]/15 text-[#6A3FF4] flex items-center justify-center flex-shrink-0">
                            <i className={`ph-bold ${link.icon || 'ph-link'} text-base`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-black dark:text-white font-bold text-sm truncate group-hover:text-[#6A3FF4] dark:group-hover:text-[#c89eff] transition-colors">{link.label}</div>
                            <div className="text-gray-500 dark:text-gray-400 text-xs truncate">{link.url}</div>
                        </div>
                        <i className="ph-bold ph-arrow-up-right text-gray-400 group-hover:text-[#6A3FF4] transition-colors flex-shrink-0"></i>
                    </a>
                ))}
            </div>
        </ParticleCard>
    );
};

export default Dashboard;
