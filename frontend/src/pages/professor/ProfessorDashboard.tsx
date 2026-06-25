import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import MiniNotificationComposer from '../../components/MiniNotificationComposer';
import RecentActivityCard from '../../components/RecentActivityCard';
import { API_URLS } from '@shared/config';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// â”€â”€â”€ Interfaces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface DashboardData {
    professorName: string;
    stats: {
        courses: number;
        students: number;
        pending: number;
        sessions: number;
        // Plan 4 Phase 8 — students whose `academic_advisor_id` points at
        // this professor. Wired into a 5th stat card on the dashboard.
        advisees: number;
    };
    schedule: {
        course: string;
        code: string;
        time: string;
        room: string;
        students: number;
    }[];
    recentActivity: {
        id: number;
        icon?: string;
        text: string;
        time: string;
        type: string;
        courseCode?: string | null;
    }[];
}

// â”€â”€â”€ Shared sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
                    <div className="h-10 w-20 bg-white/10 animate-pulse rounded-lg"></div>
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

// ─── Tab: Overview ────────────────────────────────────────────────────────────

const OverviewTab: React.FC<{ data: DashboardData | null; isLoading: boolean; currentTerm: string }> = ({ data, isLoading, currentTerm }) => {
    const t = useT();
    return (
        <div className="space-y-6">
            {/* Stat Cards — 5 tiles total: Courses, Students, Pending, Sessions,
                Advisees. At lg+ they wrap to 2 rows (4 + 1) which keeps the
                grid balanced without forcing a 5-col layout that crushes on
                narrow desktops. Advisees fills the row when wrapped. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                <AnimateOnView delay={0.1} enabled={false}>
                    <StatCard
                        title={t('staff.courses')}
                        value={data?.stats.courses || 0}
                        description={t('professor.statCoursesDesc')}
                        tagText={currentTerm || t('professor.loadingShort')}
                        icon="ph-book-open"
                        targetPath="/professor/course-overview"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.15} enabled={false}>
                    <StatCard
                        title={t('professor.studentsLabel')}
                        value={data?.stats.students || 0}
                        description={t('professor.statStudentsDesc')}
                        tagText={t('professor.statTagActive')}
                        icon="ph-users"
                        targetPath="/professor/course-overview"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.2} enabled={false}>
                    <StatCard
                        title={t('professor.statPendingTitle')}
                        value={data?.stats.pending || 0}
                        description={t('professor.statPendingDesc')}
                        tagText={t('professor.statTagAction')}
                        icon="ph-clipboard-text"
                        targetPath="/professor/grading"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.25} enabled={false}>
                    <StatCard
                        title={t('professor.statSessionsTitle')}
                        value={data?.stats.sessions || 0}
                        description={t('professor.statSessionsDesc')}
                        tagText={t('professor.statTagToday')}
                        icon="ph-video-camera"
                        targetPath="/professor/live-sessions"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                {/* Plan 4 Phase 8 follow-up — My Advisees card restored.
                    Click-through goes to the dedicated advisees review queue
                    where the prof approves or rejects pending registrations
                    for the students assigned to them. */}
                <AnimateOnView delay={0.3} enabled={false}>
                    <StatCard
                        title={t('professor.statAdviseesTitle')}
                        value={data?.stats.advisees || 0}
                        description={t('professor.statAdviseesDesc')}
                        tagText={t('professor.statTagAdvisees')}
                        icon="ph-user-focus"
                        targetPath="/professor/advisees"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
            </div>

            {/* Notify Students composer + Activity. The mini composer
                replaces the previous "Quick Actions" card. Both the composer
                and the activity card are shared with the TA dashboard so the
                two surfaces stay structurally identical. */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <AnimateOnView delay={0.3} enabled={false} className="xl:col-span-1 h-full">
                    <MiniNotificationComposer role="professor" />
                </AnimateOnView>

                <AnimateOnView delay={0.4} enabled={false} className="xl:col-span-2 h-full">
                    <RecentActivityCard
                        items={data?.recentActivity || []}
                        isLoading={isLoading}
                        roleSlug="professor"
                    />
                </AnimateOnView>
            </div>

            {/* Today's Schedule */}
            <AnimateOnView delay={0.5} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center">
                        <i className="ph-bold ph-calendar mr-2 text-[#6A3FF4]"></i>
                        {t('professor.todayHeading')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {isLoading ? (
                            [1, 2, 3].map(i => (
                                <div key={i} className="h-24 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>
                            ))
                        ) : data?.schedule.length === 0 ? (
                            <div className="col-span-full py-8 text-center text-gray-500 dark:text-gray-400 italic">
                                {t('professor.todayNoSessions')}
                            </div>
                        ) : (
                            data?.schedule.map((item, i) => (
                                <motion.div key={i} whileHover={{ y: -2 }} className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-black dark:text-white font-bold text-sm">{item.course}</h4>
                                        <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-2 py-0.5 rounded-full">{item.code}</span>
                                    </div>
                                    <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <p className="flex items-center gap-1.5"><i className="ph-bold ph-clock text-[#6A3FF4]"></i>{item.time}</p>
                                        <p className="flex items-center gap-1.5"><i className="ph-bold ph-map-pin text-[#6A3FF4]"></i>{item.room}</p>
                                        <p className="flex items-center gap-1.5"><i className="ph-bold ph-users text-[#6A3FF4]"></i>{item.students} {t('professor.studentsSuffix')}</p>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </div>
            </AnimateOnView>
        </div>
    );
};

// ─── Main Professor Dashboard Component ────────────────────────────────────────

const ProfessorDashboard: React.FC = () => {
    const t = useT();
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string>('');
    const [currentTerm, setCurrentTerm] = useState<string>('');

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setFetchError('');
            const email = localStorage.getItem('currentUserEmail') || '';
            if (!email) {
                setFetchError(t('professor.noEmailFound'));
                setIsLoading(false);
                return;
            }
            try {
                const token = localStorage.getItem('authToken');
                const overviewRes = await fetch(`${API_URLS.courseContent()}/api/professor/overview/${email}`, {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (overviewRes.ok) {
                    const data = await overviewRes.json();
                    setDashboardData(data);
                }
            } catch {
                setFetchError(t('professor.failedToLoadDashboard'));
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const fetchTerm = async () => {
            try {
                const res = await fetch(`${API_URLS.registration()}/api/registration/current-term`, { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    setCurrentTerm(data?.term?.semester?.name ?? '');
                }
            } catch {
                // Non-critical — term badge stays empty
            }
        };
        fetchTerm();
    }, []);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Header */}
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.dashboardTitle')}</h2>
                        <p className="text-black dark:text-gray-300 text-sm">
                            {isLoading
                                ? t('professor.loadingYourProfile')
                                : fetchError
                                ? fetchError
                                : t('professor.welcomeBack', { name: dashboardData?.professorName.split(' ')[0] || t('professor.professorBadge') })}
                        </p>
                    </div>
                </div>
            </AnimateOnView>

            <OverviewTab data={dashboardData} isLoading={isLoading} currentTerm={currentTerm} />
        </div>
    );
};

export default ProfessorDashboard;

