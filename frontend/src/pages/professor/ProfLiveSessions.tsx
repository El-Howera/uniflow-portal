import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { API_URLS } from '@shared/config';
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
    startedAt?: string | null;
}

// Plan 7 follow-up — live polling hook for participant count + elapsed time.
// Active only while `enabled` is true (i.e. the card is currently live).
// Polls every 7s; ticks elapsed seconds locally every 1s in between so the
// counter feels smooth.
function useLiveSessionStats(sessionId: string, enabled: boolean) {
    const [stats, setStats] = useState<{ participants: number; elapsedSec: number; startedAt: string | null; status: string | null; recordingUrl: string | null } | null>(null);

    useEffect(() => {
        if (!enabled || !sessionId) return;
        let cancelled = false;
        const token = localStorage.getItem('authToken');

        const fetchStats = async () => {
            try {
                const r = await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}/live-stats`, {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!r.ok) return;
                const data = await r.json();
                if (cancelled) return;
                setStats({
                    participants: data.participants ?? 0,
                    elapsedSec: data.elapsedSec ?? 0,
                    startedAt: data.startedAt ?? null,
                    status: data.status ?? null,
                    recordingUrl: data.recordingUrl ?? null,
                });
            } catch { /* swallow */ }
        };
        fetchStats();
        const pollId = window.setInterval(fetchStats, 7000);
        const tickId = window.setInterval(() => {
            setStats((s) => (s && s.startedAt ? { ...s, elapsedSec: s.elapsedSec + 1 } : s));
        }, 1000);
        return () => {
            cancelled = true;
            window.clearInterval(pollId);
            window.clearInterval(tickId);
        };
    }, [sessionId, enabled]);

    return stats;
}

function formatElapsed(totalSec: number): string {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const SessionCard: React.FC<{
    session: Session;
    onDelete: (id: string) => void;
    onStart: (id: string) => void;
    onEnd: (id: string) => void;
}> = ({ session, onDelete, onStart, onEnd }) => {
    const navigate = useNavigate();
    const t = useT();
    const statusConfig = {
        live: { label: t('professor.statusLiveNow'), color: 'bg-red-500 text-white', icon: 'ph-broadcast' },
        upcoming: { label: t('professor.statusUpcoming'), color: 'bg-[#6A3FF4]/20 text-[#6A3FF4] border border-[#6A3FF4]/30', icon: 'ph-calendar' },
        completed: { label: t('professor.statusCompleted'), color: 'bg-green-500/20 text-green-500 border border-green-500/30', icon: 'ph-check-circle' },
    };
    const config = statusConfig[session.status];
    // Plan 7 follow-up — live participant count from polling endpoint.
    const liveStats = useLiveSessionStats(session.id, session.status === 'live');
    const displayParticipants = session.status === 'live' && liveStats ? liveStats.participants : session.participants;
    // Local elapsed counter — ticks from session.startedAt directly so the clock
    // renders the moment the session goes live, independent of the poll. Falls
    // back to the poll's elapsedSec when startedAt is unavailable (e.g. legacy
    // rows where the column was null).
    const [localElapsedSec, setLocalElapsedSec] = useState(() => {
        if (session.status !== 'live' || !session.startedAt) return 0;
        return Math.max(0, Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000));
    });
    useEffect(() => {
        if (session.status !== 'live' || !session.startedAt) return;
        const id = window.setInterval(() => {
            setLocalElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(session.startedAt!).getTime()) / 1000)));
        }, 1000);
        return () => window.clearInterval(id);
    }, [session.status, session.startedAt]);
    const elapsedToShow = session.startedAt ? localElapsedSec : (liveStats?.elapsedSec ?? 0);
    const sessionStartLabel = session.startedAt
        ? new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

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
                <p className="flex items-center gap-2">
                    <i className="ph-bold ph-users text-[#6A3FF4]"></i>
                    <span className={session.status === 'live' ? 'text-emerald-400 font-semibold' : ''}>
                        {displayParticipants} {t('professor.plsParticipantsSuffix')}
                    </span>
                    {session.status === 'live' && (
                        <span className="text-[10px] text-emerald-400 animate-pulse">{t('professor.plsLiveDot')}</span>
                    )}
                </p>
                {session.status === 'live' && (
                    <p className="flex items-center gap-2 flex-wrap">
                        <i className="ph-bold ph-clock text-[#6A3FF4]"></i>
                        <span className="font-mono tabular-nums text-red-400">{formatElapsed(elapsedToShow)}</span>
                        <span className="text-[10px] text-gray-500">{t('professor.plsElapsedLabel')}</span>
                        {sessionStartLabel && (
                            <span className="text-[10px] text-gray-500">{t('professor.plsStartedShort', { time: sessionStartLabel })}</span>
                        )}
                    </p>
                )}
                {(session.courseName || session.courseCode) && (
                    <p className="flex items-center gap-2">
                        <i className="ph-bold ph-book text-[#6A3FF4]"></i>
                        {session.courseName || session.courseCode}
                    </p>
                )}
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
                {session.status === 'live' && session.meetingLink && (
                    // Plan 7 follow-up — in-app live session room. Route resolves
                    // meetingLink + host metadata by sessionId.
                    <button
                        onClick={() => navigate(`/professor/live-session/${session.id}`)}
                        className="flex-1 bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold py-2.5 rounded-xl hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
                    >
                        <i className="ph-bold ph-play"></i> {t('professor.plsJoinSession')}
                    </button>
                )}
                {session.status === 'live' && (
                    <button onClick={() => onEnd(session.id)} className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-500 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2">
                        <i className="ph-bold ph-stop-circle"></i> {t('professor.plsEndSession')}
                    </button>
                )}
                {session.status === 'upcoming' && (
                    <>
                        <button onClick={() => onStart(session.id)} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20">
                            <i className="ph-bold ph-play"></i> {t('professor.plsStartNow')}
                        </button>
                        <button onClick={() => onDelete(session.id)} className="flex-1 py-2.5 rounded-xl border border-red-500/30 text-red-500 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2">
                            <i className="ph-bold ph-trash"></i> {t('professor.plsCancelBtn')}
                        </button>
                    </>
                )}
                {session.status === 'completed' && session.recordingUrl && (
                    <a
                        href={/^https?:\/\//.test(session.recordingUrl) ? session.recordingUrl : `${API_URLS.courseContent()}${session.recordingUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 rounded-xl border border-white/20 dark:border-white/10 text-black dark:text-white font-semibold text-sm hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="ph-bold ph-eye"></i> {t('professor.plsViewRecording')}
                    </a>
                )}
                {session.status === 'completed' && !session.recordingUrl && (
                    <span className="flex-1 py-2.5 rounded-xl border border-dashed border-white/15 text-gray-500 font-medium text-xs flex items-center justify-center gap-2 cursor-not-allowed">
                        <i className="ph-bold ph-video-camera-slash"></i> {t('professor.plsNoRecording')}
                    </span>
                )}
                {session.status === 'completed' && (
                    // Plan 7 follow-up — fully delete a past session (DB row +
                    // any recording reference). Confirm before firing because
                    // it's destructive.
                    <button
                        onClick={() => {
                            if (window.confirm(t('professor.plsDeleteConfirm', { title: session.title }))) {
                                onDelete(session.id);
                            }
                        }}
                        className="py-2.5 px-4 rounded-xl border border-red-500/30 text-red-400 font-semibold text-sm hover:bg-red-500/10 transition-colors flex items-center justify-center gap-2"
                        title={t('professor.plsDeleteTooltip')}
                    >
                        <i className="ph-bold ph-trash"></i> {t('professor.plsDeleteBtn')}
                    </button>
                )}
            </div>
        </motion.div>
    );
};

const ProfLiveSessions: React.FC = () => {
    const t = useT();
    const [newTitle, setNewTitle] = useState('');
    const [newDate, setNewDate] = useState('');
    const [newTime, setNewTime] = useState('10:00');
    const [newCourseCode, setNewCourseCode] = useState('');
    const [sessions, setSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [myCourses, setMyCourses] = useState<{ code: string; name: string }[]>([]);
    // Recording lifecycle lives inside LiveSessionRoom now — no per-page
    // recorder state needed here.
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
    const flashFeedback = React.useCallback((kind: 'success' | 'error' | 'info', text: string) => {
        setFeedback({ kind, text });
        window.setTimeout(() => setFeedback(null), 4000);
    }, []);

    const token = localStorage.getItem('authToken');
    const email = localStorage.getItem('currentUserEmail') || '';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            try {
                // Load my courses
                const coursesRes = await fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, { credentials: 'include', headers });
                if (coursesRes.ok) {
                    type CourseItem = { code: string; name: string };
                    const courses: CourseItem[] = await coursesRes.json() as CourseItem[];
                    setMyCourses(courses.map(c => ({ code: c.code, name: c.name })));
                    if (courses.length > 0) setNewCourseCode(courses[0].code);

                    // Load sessions for all courses
                    const allSessions: Session[] = [];
                    await Promise.all(courses.map(async (course) => {
                        try {
                            const sessRes = await fetch(`${API_URLS.courseContent()}/api/sessions/${course.code}`, { credentials: 'include', headers });
                            if (!sessRes.ok) return;
                            type ApiSession = {
                                id: string;
                                title: string;
                                scheduledAt: string;
                                participants?: number;
                                status?: string;
                                meetingLink?: string;
                                courseCode?: string;
                                recordingUrl?: string;
                                startedAt?: string | null;
                            };
                            const data: ApiSession[] = await sessRes.json();
                            data.forEach((s) => {
                                const scheduledAt = new Date(s.scheduledAt);
                                // Only the BACKEND's status is authoritative.
                                // We used to auto-promote `scheduledAt < now`
                                // to 'completed', which made an unused-but-
                                // not-cancelled session disappear into the
                                // completed pile when the prof simply
                                // navigated away and came back later. Drop
                                // that heuristic — a scheduled session stays
                                // scheduled until the prof either starts it
                                // (-> live) or deletes it. 'ended' from the
                                // backend also counts as completed.
                                let status: Session['status'] = 'upcoming';
                                if (s.status === 'completed' || s.status === 'ended') status = 'completed';
                                if (s.status === 'live') status = 'live';

                                allSessions.push({
                                    id: s.id,
                                    title: s.title,
                                    date: scheduledAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                                    time: scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                    participants: s.participants || 0,
                                    status,
                                    meetingLink: s.meetingLink,
                                    courseCode: s.courseCode || course.code,
                                    // Pull the human-readable name from the course
                                    // we just iterated; the sessions endpoint only
                                    // exposes the code on the row.
                                    courseName: course.name,
                                    recordingUrl: s.recordingUrl,
                                    startedAt: s.startedAt ?? null,
                                });
                            });
                        } catch { /* skip */ }
                    }));
                    setSessions(allSessions);
                }
            } catch (err) {
                console.error('Failed to load sessions', err);
            } finally {
                setIsLoading(false);
            }
        };
        load();
        // Mount-only fetch; email and headers are derived from localStorage and stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSchedule = async () => {
        if (!newTitle.trim() || !newCourseCode) return;
        try {
            const scheduledAt = new Date(`${newDate}T${newTime}`).toISOString();
            const res = await fetch(`${API_URLS.courseContent()}/api/sessions`, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({ courseCode: newCourseCode, title: newTitle, scheduledAt, duration: 60, type: 'lecture' })
            });
            if (res.ok) {
                const { session } = await res.json();
                const scheduled = new Date(session.scheduledAt);
                const courseEntry = myCourses.find(c => c.code === newCourseCode);
                setSessions(prev => [...prev, {
                    id: session.id,
                    title: session.title,
                    date: scheduled.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
                    time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    participants: session.participants || 0,
                    status: 'upcoming',
                    meetingLink: session.meetingLink,
                    courseCode: session.courseCode || newCourseCode,
                    courseName: courseEntry?.name,
                }]);
                setNewTitle('');
            }
        } catch (err) {
            console.error('Failed to create session', err);
        }
    };

    const handleDelete = async (sessionId: string) => {
        try {
            await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}`, { method: 'DELETE', credentials: 'include', headers });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch { /* ignore */ }
    };

    const handleStart = async (sessionId: string) => {
        // PATCH session to 'live' and navigate straight to the in-app room.
        // Recording is opt-in from inside the room (handled by LiveSessionRoom)
        // so there's a single screen-share prompt + recording survives across
        // navigation (the prof tab is the recording owner regardless of which
        // UniFlow page is currently visible).
        try {
            const res = await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers,
                body: JSON.stringify({ status: 'live' }),
            });
            if (!res.ok) {
                flashFeedback('error', t('professor.plsCouldNotStart'));
                return;
            }
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'live' as const, startedAt: new Date().toISOString() } : s));
            // Auto-navigate into the room so the host lands in the meeting
            // immediately without an extra click.
            window.location.href = `/professor/live-session/${sessionId}`;
        } catch {
            flashFeedback('error', t('professor.plsNetworkStart'));
        }
    };

    const handleEnd = async (sessionId: string) => {
        // The recording lifecycle now lives entirely inside LiveSessionRoom —
        // this handler only flips the DB state to 'ended' when the host clicks
        // "End Session" from the card list (rather than from inside the room).
        try {
            const res = await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers,
                body: JSON.stringify({ status: 'ended' }),
            });
            if (res.ok) {
                setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'completed' as const } : s));
            }
        } catch { /* ignore */ }
    };

    const activeSessions = sessions.filter(s => s.status === 'live');
    const scheduledSessions = sessions.filter(s => s.status === 'upcoming');
    const completedSessions = sessions.filter(s => s.status === 'completed');

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.liveSessionsDashboardTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('professor.liveSessionsDashboardSubtitle')}</p>
            </AnimateOnView>

            {/* Plan 7 follow-up — feedback toast for recording start / upload events. */}
            {feedback && (
                <div
                    className={`rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${
                        feedback.kind === 'success'
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : feedback.kind === 'error'
                            ? 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400'
                            : 'bg-blue-500/10 border border-blue-500/30 text-blue-600 dark:text-blue-400'
                    }`}
                >
                    <i className={`ph-bold ${feedback.kind === 'success' ? 'ph-check-circle' : feedback.kind === 'error' ? 'ph-warning-circle' : 'ph-info'}`}></i>
                    {feedback.text}
                </div>
            )}

            {/* Schedule New Session */}
            <AnimateOnView delay={0.1}>
                <div className={`${glassCardStyle} p-4 sm:p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-2">{t('professor.scheduleNew')}</h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mb-5">{t('professor.scheduleNewSubtitle')}</p>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('professor.sessionTitleLabel')}</label>
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={e => setNewTitle(e.target.value)}
                                    placeholder={t('professor.plsSessionTitlePh')}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-all"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('staff.course')}</label>
                                <GlassDropdown
                                    value={newCourseCode}
                                    onChange={setNewCourseCode}
                                    options={myCourses.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))}
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
                            disabled={!newTitle.trim() || !newDate}
                            className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-3 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            <i className="ph-bold ph-video-camera"></i>
                            {t('professor.plsScheduleSession')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="text-center py-20"><i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i></div>
            ) : (
                <>
                    {activeSessions.length > 0 && (
                        <AnimateOnView delay={0.2}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.activeSessions')}</h3>
                            <div className="space-y-4">
                                {activeSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} onStart={handleStart} onEnd={handleEnd} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {scheduledSessions.length > 0 && (
                        <AnimateOnView delay={0.3}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.scheduledSessions')}</h3>
                            <div className="space-y-4">
                                {scheduledSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} onStart={handleStart} onEnd={handleEnd} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {completedSessions.length > 0 && (
                        <AnimateOnView delay={0.4}>
                            <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.plsCompletedSessions')}</h3>
                            <div className="space-y-4">
                                {completedSessions.map(s => <SessionCard key={s.id} session={s} onDelete={handleDelete} onStart={handleStart} onEnd={handleEnd} />)}
                            </div>
                        </AnimateOnView>
                    )}
                    {sessions.length === 0 && (
                        <div className={`${glassCardStyle} p-12 text-center`}>
                            <i className="ph-bold ph-video-camera text-4xl text-gray-400 mb-3 block"></i>
                            <p className="text-gray-500">{t('professor.plsNoSessionsYet')}</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ProfLiveSessions;
