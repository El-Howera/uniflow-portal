import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface Session {
    id: string;
    title: string;
    date: string;
    time: string;
    participants: number;
    status: 'live' | 'upcoming' | 'completed';
    meetingLink?: string;
    courseCode?: string;
    courseName?: string;
    recordingUrl?: string;
}

// --- Static preview data ---
const MOCK_MY_COURSES: { code: string; name: string }[] = [
    { code: 'CS201', name: 'Data Structures' },
    { code: 'MA205', name: 'Linear Algebra' },
    { code: 'CS101', name: 'Intro to Programming' },
];

const MOCK_SESSIONS: Session[] = [
    { id: 'sess1', title: 'CS201 Office Hours — BST Review', date: 'April 22, 2026', time: '01:00 PM', participants: 12, status: 'live', courseCode: 'CS201', courseName: 'Data Structures' },
    { id: 'sess2', title: 'MA205 Eigenvectors Q&A', date: 'April 25, 2026', time: '11:00 AM', participants: 0, status: 'upcoming', courseCode: 'MA205', courseName: 'Linear Algebra' },
    { id: 'sess3', title: 'CS101 Control Flow Walkthrough', date: 'April 28, 2026', time: '02:00 PM', participants: 0, status: 'upcoming', courseCode: 'CS101', courseName: 'Intro to Programming' },
    { id: 'sess4', title: 'CS201 Graph Traversal Recap', date: 'April 15, 2026', time: '01:00 PM', participants: 34, status: 'completed', courseCode: 'CS201', courseName: 'Data Structures', recordingUrl: 'https://example.com/recordings/cs201-graph-recap.mp4' },
    { id: 'sess5', title: 'MA205 Midterm Review', date: 'April 10, 2026', time: '10:00 AM', participants: 41, status: 'completed', courseCode: 'MA205', courseName: 'Linear Algebra' },
];

const SessionCard: React.FC<{ session: Session; onDelete: (id: string) => void }> = ({ session, onDelete }) => {
    const t = useT();
    const navigate = useNavigate();
    const statusConfig = {
        live: { label: t('professor.liveBadge'), color: 'bg-red-500 text-white', icon: 'ph-broadcast' },
        upcoming: { label: t('professor.upcomingBadge'), color: 'bg-[#6A3FF4]/20 text-[#6A3FF4] border border-[#6A3FF4]/30', icon: 'ph-calendar' },
        completed: { label: t('professor.completedBadge'), color: 'bg-green-500/20 text-green-500 border border-green-500/30', icon: 'ph-check-circle' },
    };
    const config = statusConfig[session.status];

    return (
        <motion.div whileHover={{ y: -2 }} className={`${glassCardStyle} p-4 sm:p-6`}>
            <div className="flex items-start justify-between gap-2 mb-3">
                <h4 className="text-black dark:text-white font-bold text-base break-words flex-1 min-w-0">{session.title}</h4>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0 whitespace-nowrap ${config.color}`}>
                    <i className={`ph-bold ${config.icon}`}></i>
                    {config.label}
                </span>
            </div>
            <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400 mb-4">
                <p className="flex items-center gap-2"><i className="ph-bold ph-calendar text-[#6A3FF4]"></i>{session.date}, {session.time}</p>
                <p className="flex items-center gap-2"><i className="ph-bold ph-users text-[#6A3FF4]"></i>{session.participants} Participants</p>
                {(session.courseName || session.courseCode) && (
                    <p className="flex items-center gap-2">
                        <i className="ph-bold ph-book text-[#6A3FF4]"></i>
                        {session.courseName || session.courseCode}
                    </p>
                )}
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
                {session.status === 'live' && (
                    // Route into the in-app LiveKit room so the TA gets the
                    // same UniFlow chrome + working controls. Replaces the
                    // earlier external-tab Jitsi href.
                    <button
                        onClick={() => navigate(`/ta/live-session/${session.id}`)}
                        className="flex-1 bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
                    >
                        <i className="ph-bold ph-play"></i> {t('ta.joinSession')}
                    </button>
                )}
                {session.status === 'upcoming' && (
                    <button onClick={() => onDelete(session.id)} className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-500 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2">
                        <i className="ph-bold ph-trash"></i> {t('ta.cancelSessionBtn')}
                    </button>
                )}
                {session.status === 'completed' && session.recordingUrl && (
                    <a
                        href={session.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 rounded-xl border border-white/20 dark:border-white/10 text-black dark:text-white font-semibold text-sm hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="ph-bold ph-eye"></i> {t('ta.viewRecording')}
                    </a>
                )}
                {session.status === 'completed' && !session.recordingUrl && (
                    <span className="flex-1 py-2.5 rounded-xl border border-dashed border-white/15 text-gray-500 font-medium text-xs flex items-center justify-center gap-2 cursor-not-allowed">
                        <i className="ph-bold ph-video-camera-slash"></i> {t('ta.noRecordingUploaded')}
                    </span>
                )}
                {session.status === 'completed' && (
                    // Permanently delete a past session (DB row + any
                    // recording reference). Mirrors ProfLiveSessions per
                    // owner directive that TA dashboard tracks prof exactly.
                    <button
                        onClick={() => {
                            if (window.confirm(t('ta.confirmDeletePastSession', { title: session.title }))) {
                                onDelete(session.id);
                            }
                        }}
                        className="py-2.5 px-4 rounded-xl border border-red-500/30 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                        title={t('ta.permanentDeletePastTooltip')}
                    >
                        <i className="ph-bold ph-trash"></i> {t('ta.deleteBtn')}
                    </button>
                )}
            </div>
        </motion.div>
    );
};

const TALiveSessions: React.FC = () => {
    const t = useT();
    const [newTitle, setNewTitle] = useState('');
    const [newDate, setNewDate] = useState('');
    const [newTime, setNewTime] = useState('10:00');
    const [newCourseCode, setNewCourseCode] = useState('');
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [myCourses, setMyCourses] = useState<{ code: string; name: string }[]>([]);

    useEffect(() => {
        // MVP build — populate courses + sessions from static mock data.
        setIsLoading(true);
        setMyCourses(MOCK_MY_COURSES);
        if (MOCK_MY_COURSES.length > 0) setNewCourseCode(MOCK_MY_COURSES[0].code);
        setSessions(MOCK_SESSIONS);
        setIsLoading(false);
    }, []);

    const handleSchedule = () => {
        // MVP build — local-only schedule, no backend call.
        if (!newTitle.trim() || !newCourseCode) return;
        const scheduled = new Date(`${newDate}T${newTime}`);
        const courseEntry = myCourses.find(c => c.code === newCourseCode);
        setSessions(prev => [...prev, {
            id: `local-sess-${Date.now()}`,
            title: newTitle,
            date: scheduled.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            participants: 0,
            status: 'upcoming',
            courseCode: newCourseCode,
            courseName: courseEntry?.name,
        }]);
        setNewTitle('');
    };

    const handleDelete = (sessionId: string) => {
        // MVP build — local-only delete.
        setSessions(prev => prev.filter(s => s.id !== sessionId));
    };

    const activeSessions = sessions.filter(s => s.status === 'live');
    const scheduledSessions = sessions.filter(s => s.status === 'upcoming');
    const completedSessions = sessions.filter(s => s.status === 'completed');

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.liveSessionsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('ta.liveSessionsSubtitle')}</p>
            </AnimateOnView>

            {/* Schedule New Session */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} p-4 sm:p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-2">{t('ta.scheduleNew')}</h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-5">{t('ta.scheduleNewDesc')}</p>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('ta.sessionTitleLabel')}</label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder={t('ta.sessionTitlePlaceholder')}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('staff.course')}</label>
                                <GlassDropdown
                                    value={newCourseCode}
                                    onChange={setNewCourseCode}
                                    options={
                                        myCourses.length === 0
                                            ? [{ value: '', label: t('ta.noCoursesAssigned') }]
                                            : myCourses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))
                                    }
                                    direction="up"
                                    className="w-full"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('staff.date')}</label>
                                <input
                                    type="date"
                                    value={newDate}
                                    onChange={e => setNewDate(e.target.value)}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('staff.time')}</label>
                                <input
                                    type="time"
                                    value={newTime}
                                    onChange={e => setNewTime(e.target.value)}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50 transition-all"
                                />
                            </div>
                        </div>
                        <button
                            onClick={handleSchedule}
                            disabled={!newTitle.trim() || !newDate || myCourses.length === 0}
                            className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-3 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <i className="ph-bold ph-video-camera"></i>
                            {t('ta.scheduleBtn')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="text-center py-20"><i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i></div>
            ) : (
                <>
                    {activeSessions.length > 0 && (
                        <AnimateOnView delay={0.2} enabled={false}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.activeSessions')}</h3>
                            <div className="space-y-4">
                                {activeSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {scheduledSessions.length > 0 && (
                        <AnimateOnView delay={0.3} enabled={false}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.scheduledSessions')}</h3>
                            <div className="space-y-4">
                                {scheduledSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {completedSessions.length > 0 && (
                        <AnimateOnView delay={0.4} enabled={false}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('ta.completedSection')}</h3>
                            <div className="space-y-4">
                                {completedSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {sessions.length === 0 && (
                        <div className={`${glassCardStyle} p-12 text-center`}>
                            <i className="ph-bold ph-video-camera text-4xl text-gray-400 mb-3 block"></i>
                            <p className="text-gray-500">{t('ta.noSessionsYet')}</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default TALiveSessions;
