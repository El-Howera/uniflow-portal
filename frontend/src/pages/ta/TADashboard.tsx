import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import MiniNotificationComposer from '../../components/MiniNotificationComposer';
import RecentActivityCard from '../../components/RecentActivityCard';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- Interfaces ---
interface OfficeHour {
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    location: string;
    mode: string;
}

interface TADashboardData {
    taName: string;
    stats: {
        courses: number;
        students: number;
        pending: number;
        proposals: number;
        sessions: number;
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

// --- Static preview data ---
const MOCK_TERM = 'Spring 2026';

const MOCK_DASHBOARD: TADashboardData = {
    taName: 'Layla Hassan',
    stats: {
        courses: 3,
        students: 142,
        pending: 7,
        proposals: 4,
        sessions: 2,
    },
    schedule: [
        { course: 'Data Structures', code: 'CS201', time: '09:00 – 10:30 AM', room: 'Lab B-204', students: 48 },
        { course: 'Linear Algebra', code: 'MA205', time: '11:00 – 12:30 PM', room: 'Hall A-101', students: 56 },
        { course: 'Intro to Programming', code: 'CS101', time: '02:00 – 03:30 PM', room: 'Lab C-110', students: 38 },
    ],
    recentActivity: [
        { id: 1, icon: 'ph-clipboard-text', text: 'Omar Farouk submitted Assignment 3 in CS201', time: '12 min ago', type: 'submission', courseCode: 'CS201' },
        { id: 2, icon: 'ph-check-circle', text: 'You proposed a grade for Nour El-Din in MA205', time: '1 hr ago', type: 'grade', courseCode: 'MA205' },
        { id: 3, icon: 'ph-chat-circle-dots', text: 'New message in CS101 course chatroom', time: '2 hrs ago', type: 'chat', courseCode: 'CS101' },
        { id: 4, icon: 'ph-clipboard-text', text: 'Yara Mahmoud submitted Lab 5 in CS201', time: '3 hrs ago', type: 'submission', courseCode: 'CS201' },
        { id: 5, icon: 'ph-calendar-check', text: 'Office hours session completed for MA205', time: 'Yesterday', type: 'session', courseCode: 'MA205' },
    ],
};

const MOCK_OFFICE_HOURS: OfficeHour[] = [
    { dayOfWeek: 'Monday', startTime: '01:00 PM', endTime: '03:00 PM', location: 'Office 312, CS Building', mode: 'in-person' },
    { dayOfWeek: 'Wednesday', startTime: '10:00 AM', endTime: '12:00 PM', location: 'Zoom Room A', mode: 'online' },
    { dayOfWeek: 'Thursday', startTime: '02:00 PM', endTime: '04:00 PM', location: 'Office 312, CS Building', mode: 'in-person' },
];

// --- Stat Card ---
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


// --- Main Component ---
const TADashboard: React.FC = () => {
    const navigate = useNavigate();
    const t = useT();
    const [data, setData] = useState<TADashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentTerm, setCurrentTerm] = useState<string | null>(null);
    const [officeHours, setOfficeHours] = useState<OfficeHour[]>([]);
    const [officeHoursLoading, setOfficeHoursLoading] = useState(true);

    useEffect(() => {
        // MVP build — populate from static mock data, no backend calls.
        setData(MOCK_DASHBOARD);
        setCurrentTerm(MOCK_TERM);
        setOfficeHours(MOCK_OFFICE_HOURS);
        setIsLoading(false);
        setOfficeHoursLoading(false);
    }, []);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.dashboardHeading')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">
                    {isLoading ? t('ta.loadingOverview') : t('ta.welcomeBack', { name: data?.taName.split(' ')[0] ?? '' })}
                </p>
            </AnimateOnView>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                <AnimateOnView delay={0.1} enabled={false}>
                    <StatCard
                        title={t('ta.coursesCard')}
                        value={data?.stats.courses || 0}
                        description={t('ta.coursesDesc')}
                        tagText={currentTerm || t('ta.loadingShort')}
                        icon="ph-book-open"
                        targetPath="/ta/courses"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.15} enabled={false}>
                    <StatCard
                        title={t('ta.studentsCard')}
                        value={data?.stats.students || 0}
                        description={t('ta.studentsDesc')}
                        tagText={t('ta.tagActive')}
                        icon="ph-users"
                        targetPath="/ta/courses"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.2} enabled={false}>
                    <StatCard
                        title={t('ta.pendingCard')}
                        value={(data?.stats.pending ?? 0) + (data?.stats.proposals ?? 0)}
                        description={t('ta.pendingDesc')}
                        tagText={t('ta.tagAction')}
                        icon="ph-clipboard-text"
                        targetPath="/ta/gradebook"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
                <AnimateOnView delay={0.25} enabled={false}>
                    <StatCard
                        title={t('ta.sessionsCard')}
                        value={data?.stats.sessions || 0}
                        description={t('ta.sessionsDesc')}
                        tagText={t('ta.tagToday')}
                        icon="ph-calendar-check"
                        targetPath="/ta/schedule"
                        isLoading={isLoading}
                    />
                </AnimateOnView>
            </div>

            {/* Notify Students composer + Activity. Identical layout to the
                Professor dashboard — both use the shared MiniNotificationComposer
                and RecentActivityCard so the two surfaces stay structurally
                in lock-step. The previous Pending-Proposals / Today's-Sessions
                stack is removed; those counts are still surfaced via the
                "Pending" stat card and the dedicated Today's Schedule below. */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <AnimateOnView delay={0.3} enabled={false} className="xl:col-span-1 h-full">
                    <MiniNotificationComposer role="ta" />
                </AnimateOnView>

                <AnimateOnView delay={0.4} enabled={false} className="xl:col-span-2 h-full">
                    <RecentActivityCard
                        items={data?.recentActivity || []}
                        isLoading={isLoading}
                        roleSlug="ta"
                    />
                </AnimateOnView>
            </div>

            {/* Upcoming Schedule */}
            <AnimateOnView delay={0.5} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center">
                        <i className="ph-bold ph-calendar mr-2 text-[#6A3FF4]"></i>
                        {t('ta.todayScheduleHeading')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {isLoading ? (
                            [1, 2, 3].map(i => <div key={i} className="h-24 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>)
                        ) : data?.schedule.length === 0 ? (
                            <div className="col-span-full py-8 text-center text-gray-500 dark:text-gray-400 italic">
                                {t('ta.todayNoSessions')}
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
                                        <p className="flex items-center gap-1.5"><i className="ph-bold ph-users text-[#6A3FF4]"></i>{item.students} {t('ta.studentsSuffix')}</p>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </div>
                </div>
            </AnimateOnView>

            {/* Live Sessions */}
            <AnimateOnView delay={0.6} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center">
                            <i className="ph-bold ph-video-camera mr-2 text-[#6A3FF4]"></i>
                            {t('ta.liveSessionsHeading')}
                        </h3>
                        <button
                            onClick={() => navigate('/ta/live-sessions')}
                            className="text-xs text-[#7B5AFF] hover:text-[#6A3FF4] font-semibold transition-colors flex items-center gap-1"
                        >
                            {t('ta.manageBtn')} <i className="ph-bold ph-arrow-right text-[10px]"></i>
                        </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {officeHoursLoading ? (
                            [1, 2, 3].map(i => (
                                <div key={i} className="h-20 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>
                            ))
                        ) : officeHours.length === 0 ? (
                            <div className="col-span-full py-8 text-center text-gray-500 dark:text-gray-400 italic">
                                {t('ta.noOfficeHours')}
                            </div>
                        ) : (
                            officeHours.map((oh, i) => (
                                <motion.div
                                    key={i}
                                    whileHover={{ y: -2 }}
                                    className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-black dark:text-white font-bold text-sm">{oh.dayOfWeek}</span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${oh.mode === 'online' ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' : 'text-green-400 bg-green-500/10 border-green-500/30'}`}>
                                            {oh.mode}
                                        </span>
                                    </div>
                                    <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                                        <p className="flex items-center gap-1.5">
                                            <i className="ph-bold ph-clock text-[#6A3FF4]"></i>
                                            {oh.startTime} – {oh.endTime}
                                        </p>
                                        <p className="flex items-center gap-1.5">
                                            <i className="ph-bold ph-map-pin text-[#6A3FF4]"></i>
                                            {oh.location}
                                        </p>
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

export default TADashboard;
