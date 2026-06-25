import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";
import { AnimateOnView } from "../../components/AnimateOnView";
import { GlassDropdown } from "../../components/GlassDropdown";
import { fetchStudentLiveSessions, LiveSessionItem } from "../../utils/courseContentService";
import { useT } from "../../i18n";
import { API_URLS } from "@shared/config";
// Shared player with mobile-aware controls + iOS-safe fullscreen fallback.
// Replaces the in-page inline controls that were too wide for mobile and
// pushed the fullscreen button off-screen in portrait orientation.
import UniFlowVideoPlayer from "../../components/UniFlowVideoPlayer";

// Plan 7 follow-up — poll live participant count + elapsed time for a session
// the student is viewing. Mirror of the prof-side hook; placed here so both
// dashboards display the same "live now: 14 watching · 12:34 elapsed" badge.
function useStudentLiveStats(sessionId: string, enabled: boolean) {
    const [stats, setStats] = useState<{ participants: number; elapsedSec: number; startedAt: string | null } | null>(null);
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
                if (!r.ok || cancelled) return;
                const data = await r.json();
                setStats({
                    participants: data.participants ?? 0,
                    elapsedSec: data.elapsedSec ?? 0,
                    startedAt: data.startedAt ?? null,
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

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

type LectureStatus = 'Live' | 'Upcoming' | 'Completed';

interface OnlineLecture {
    id: string | number;
    title: string;
    dateTime: string;
    instructor: string;
    courseCode: string;
    courseTitle?: string;       // human-readable course name; displayed in preference to the code
    status: LectureStatus;
    duration?: string;
    videoUrl?: string;          // recording URL when status === 'Completed'
    meetingUrl?: string | null; // join link when status === 'Live'
    startedAt?: string | null;  // ISO timestamp when status === 'Live' — feeds the elapsed counter
}

interface Participant {
    id: number;
    name: string;
    imageUrl: string;
    isProfessor?: boolean;
    isMuted?: boolean;
    isCameraOff?: boolean;
}


export const OnlineLecturesContent: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [pastLectures, setPastLectures] = useState<OnlineLecture[]>([]);
    const [upcomingLecturesData, setUpcomingLecturesData] = useState<OnlineLecture[]>([]);
    // Plan 7 follow-up — course filter (default 'all').
    const [courseFilter, setCourseFilter] = useState<string>('__all__');
    const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch real LiveSession rows from the backend, scoped to the student's
    // active registrations. Replaces the older "synthesize from registered
    // courses + read past materials as videos" approach.
    useEffect(() => {
        const load = async () => {
            const userId = localStorage.getItem('currentUserId')
                || localStorage.getItem('currentUserEmail')
                || '';
            if (!userId) {
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            try {
                const { upcoming, past } = await fetchStudentLiveSessions(userId);
                const toLecture = (s: LiveSessionItem, status: LectureStatus): OnlineLecture => ({
                    id: s.id,
                    title: s.title,
                    courseCode: s.courseCode,
                    courseTitle: s.courseTitle,
                    instructor: s.hostName,
                    dateTime: s.scheduledFor
                        ? new Date(s.scheduledFor).toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                        })
                        : 'TBA',
                    status,
                    duration: `${s.duration} min`,
                    // Plan 7 follow-up — backend stores recordingUrl as a path
                    // (e.g. "/files/recordings/xxx.webm"); prepend the course-
                    // content server origin so the <source> tag resolves against
                    // the right host. Already-absolute URLs (legacy seed data
                    // pointing at meet.jit.si or full http(s)://) pass through.
                    videoUrl: s.recordingUrl
                        ? (/^https?:\/\//.test(s.recordingUrl) ? s.recordingUrl : `${API_URLS.courseContent()}${s.recordingUrl}`)
                        : undefined,
                    meetingUrl: s.meetingUrl || null,
                    // Plan 7 follow-up — surface startedAt so the LectureCard can
                    // render the elapsed counter immediately without waiting for
                    // the live-stats poll round-trip.
                    startedAt: s.startedAt ?? null,
                });

                setUpcomingLecturesData(
                    upcoming.map((s) => {
                        const isLiveNow = s.status === 'live' || s.status === 'active';
                        return toLecture(s, isLiveNow ? 'Live' : 'Upcoming');
                    })
                );
                setPastLectures(past.map((s) => toLecture(s, 'Completed')));
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, []);

    const LectureStatusBadge: React.FC<{ status: LectureStatus }> = ({ status }) => {
        const styles = {
            Live: 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20 animate-pulse',
            Upcoming: 'bg-[#6A3FF4]/10 text-[#6A3FF4] dark:text-[#6A3FF4] border-[#6A3FF4]/20',
            Completed: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
        };

        const icons = {
            Live: 'ph-broadcast',
            Upcoming: 'ph-calendar-blank',
            Completed: 'ph-check-circle',
        };

        return (
            <span className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border ${styles[status]}`}>
                <i className={`ph-fill ${icons[status]}`}></i>
                {status}
            </span>
        );
    };

    const LectureCard: React.FC<{ lecture: OnlineLecture; onJoin: () => void }> = ({ lecture, onJoin }) => {
        const isPast = lecture.status === 'Completed';
        const isLive = lecture.status === 'Live';
        const hasRecording = !!lecture.videoUrl;
        // Plan 7 follow-up — live participant count from polling endpoint.
        const liveStats = useStudentLiveStats(String(lecture.id), isLive);
        // Plan 7 follow-up — elapsed counter ticks LOCALLY from lecture.startedAt
        // (independent of the poll) so the clock renders the instant the card
        // mounts and updates every second. The poll only contributes the live
        // participant count.
        const [localElapsedSec, setLocalElapsedSec] = useState(() => {
            if (!isLive || !lecture.startedAt) return 0;
            return Math.max(0, Math.floor((Date.now() - new Date(lecture.startedAt).getTime()) / 1000));
        });
        useEffect(() => {
            if (!isLive || !lecture.startedAt) return;
            const id = window.setInterval(() => {
                setLocalElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(lecture.startedAt!).getTime()) / 1000)));
            }, 1000);
            return () => window.clearInterval(id);
        }, [isLive, lecture.startedAt]);
        const sessionStartLabel = lecture.startedAt
            ? new Date(lecture.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;

        return (
            <div className={`${glassCardStyle} p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:-translate-y-1 transition-transform duration-200 group`}>

                {/* Left Info */}
                <div className="flex gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${isLive ? 'bg-red-500/20 text-red-500' : 'bg-white/50 dark:bg-[#262626] text-gray-600 dark:text-gray-400'}`}>
                        <i className={`ph-duotone ${isLive ? 'ph-video-camera' : 'ph-presentation'}`}></i>
                    </div>

                    <div>
                        <h3 className="text-lg font-bold text-black dark:text-white mb-1 group-hover:text-[#6A3FF4] transition-colors">{lecture.title}</h3>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                            {(lecture.courseTitle || lecture.courseCode) && (
                                <span className="flex items-center gap-1.5 text-[#6A3FF4] font-medium">
                                    <i className="ph-bold ph-book-open"></i> {lecture.courseTitle || lecture.courseCode}
                                </span>
                            )}
                            <span className="flex items-center gap-1.5">
                                <i className="ph-bold ph-calendar"></i> {lecture.dateTime}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <i className="ph-bold ph-chalkboard-teacher"></i> {lecture.instructor}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <i className="ph-bold ph-clock"></i> {lecture.duration}
                            </span>
                            {isLive && (
                                <>
                                    {/* Participants — only when the poll has landed (no fake zero). */}
                                    {liveStats && (
                                        <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                                            <i className="ph-bold ph-users"></i> {liveStats.participants} watching
                                        </span>
                                    )}
                                    {/* Elapsed counter — renders immediately when lecture.startedAt is
                                        present, independent of the poll. Falls back to the poll's
                                        elapsedSec if startedAt is missing for some reason. */}
                                    {(lecture.startedAt || liveStats) && (
                                        <span className="flex items-center gap-1.5 text-red-400 font-mono tabular-nums">
                                            <i className="ph-bold ph-broadcast animate-pulse"></i>
                                            {formatElapsed(lecture.startedAt ? localElapsedSec : (liveStats?.elapsedSec ?? 0))}
                                            <span className="text-[10px] font-sans text-gray-500">elapsed</span>
                                        </span>
                                    )}
                                    {sessionStartLabel && (
                                        <span className="flex items-center gap-1.5 text-gray-500 text-xs">
                                            <i className="ph-bold ph-clock"></i> Started at {sessionStartLabel}
                                        </span>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Action */}
                <div className="flex flex-col md:items-end gap-3 w-full md:w-auto">
                    <LectureStatusBadge status={lecture.status} />

                    {isPast ? (
                        hasRecording ? (
                            <button
                                onClick={onJoin}
                                className="px-6 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-[#262626] border border-gray-300/50 dark:border-[#363636] rounded-lg hover:bg-gray-300/50 dark:hover:bg-[#333] hover:text-black dark:hover:text-white transition-all w-full md:w-auto flex items-center justify-center gap-2"
                            >
                                <i className="ph-bold ph-play-circle"></i> Watch Replay
                            </button>
                        ) : (
                            // Plan 7 follow-up — completed sessions without a recording show
                            // an honest disabled hint. Avoids the "click does nothing" bug
                            // where the button always rendered regardless of recording state.
                            <span
                                className="px-6 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-500 bg-white/30 dark:bg-[#1a1a1a] border border-dashed border-gray-300/50 dark:border-[#363636] rounded-lg w-full md:w-auto flex items-center justify-center gap-2 cursor-not-allowed"
                                title={t('onlineLecturesPage.noRecordingTooltip')}
                            >
                                <i className="ph-bold ph-video-camera-slash"></i> Recording not available
                            </span>
                        )
                    ) : (
                        <button
                            onClick={isLive ? onJoin : undefined}
                            className={`px-6 py-2.5 text-sm font-semibold text-white rounded-lg transition-all w-full md:w-auto flex items-center justify-center gap-2 shadow-lg ${isLive
                                ? 'bg-gradient-to-r from-red-500 to-red-600 hover:opacity-90 shadow-red-500/20 cursor-pointer'
                                : 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] opacity-50 grayscale-[20%] cursor-not-allowed shadow-none'
                                }`}>
                            <i className={`ph-bold ${isLive ? 'ph-broadcast' : 'ph-video'}`}></i>
                            {isLive ? 'Join Live Class' : 'Join Meeting'}
                        </button>
                    )}
                </div>
            </div>
        );
    };
    // Preview participants strip — placeholder data for the "Watch Replay"
    // preview tile. Real participants come from the live session room
    // (LiveSessionRoom.tsx via LiveKit), not this view. All third-party
    // pravatar URLs replaced with empty strings; the Thumbnail renders
    // initials when imageUrl is empty.
    const participantsData: Participant[] = [
        { id: 1, name: 'Professor Anya Sharma', imageUrl: '', isProfessor: true },
        { id: 2, name: 'Alice Smith', imageUrl: '' },
        { id: 3, name: 'Bob Johnson', imageUrl: '', isMuted: true },
        { id: 4, name: 'Catherine Lee', imageUrl: '', isCameraOff: true },
        { id: 5, name: 'David Kim', imageUrl: '' },
        { id: 6, name: 'Eve White', imageUrl: '' },
    ];
    const ParticipantThumbnail: React.FC<{ participant: Participant }> = ({ participant }) => {
        const borderClass = participant.isProfessor ? 'p-1 bg-gradient-to-br from-[#6B4EFF] to-[#8B70FF] rounded-xl' : '';
        const imageAlt = participant.isCameraOff ? `Camera off` : `Video feed`;

        const initials = (participant.name || '?')
            .split(' ').filter(Boolean).slice(0, 2)
            .map((s) => s.charAt(0).toUpperCase()).join('');
        return (
            <div className={`relative flex-shrink-0 w-[200px] h-[120px] ${borderClass}`}>
                <div className="relative w-full h-full rounded-lg overflow-hidden bg-black">
                    {participant.imageUrl ? (
                        <img src={participant.imageUrl} alt={imageAlt} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-3xl font-bold">
                            {initials}
                        </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 p-2">
                        <span className="text-white text-sm font-medium">{participant.name}</span>
                    </div>
                    {participant.isMuted && (
                        <div className="absolute top-2 right-2 bg-black/50 rounded-full p-1 w-6 h-6 flex items-center justify-center">
                            <i className="ph-fill ph-microphone-slash text-red-500 text-xs"></i>
                        </div>
                    )}
                    {participant.isCameraOff && (
                        <div className="absolute top-2 right-2 bg-black/50 rounded-full p-1 w-6 h-6 flex items-center justify-center">
                            <i className="ph-fill ph-video-camera-slash text-red-500 text-xs"></i>
                        </div>
                    )}
                </div>
            </div>
        );
    };


    const [viewState, setViewState] = useState<'list' | 'live' | 'replay'>('list');
    const { searchTerm } = useAppContext(); // Retrieve global search term
    // Replay view — delegates to the shared `<UniFlowVideoPlayer>` so the
    // mobile-friendly control fixes (hidden volume slider / rewind / skip
    // on `<sm`, iOS-Safari fullscreen fallback, playsInline so the player
    // doesn't yank to native chrome on Play) all apply here. Previously
    // this view had its own duplicate inline controls strip — fine on
    // desktop but too wide for portrait mobile, which pushed the
    // fullscreen button off-screen.
    const WatchReplayContent: React.FC<{ onBack: () => void, videoUrl: string }> = ({ onBack, videoUrl }) => {
        return (
            <div className="flex-1 overflow-y-auto pb-16 space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                <button
                    onClick={onBack}
                    className="flex items-center text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors gap-2 mb-2 group"
                >
                    <i className="ph-bold ph-arrow-left group-hover:-translate-x-1 transition-transform"></i>
                    <span>{t('onlineLecturesPage.backToLectures')}</span>
                </button>
                <UniFlowVideoPlayer src={videoUrl} className="w-full" />
                <div className="bg-[#6A3FF4] rounded-2xl p-6">
                    <h1 className="text-3xl font-bold mb-2 text-white">{t('onlineLecturesPage.lectureRecordingTitle')}</h1>
                    <p className="text-purple-200 mb-4 text-sm">{t('onlineLecturesPage.nowPlaying')}</p>
                    <p className="text-purple-100 leading-relaxed text-sm">
                        {t('onlineLecturesPage.recordingBody')}
                    </p>
                </div>
            </div>
        );
    };

    const VideoConference: React.FC<{ onLeave: () => void }> = ({ onLeave }) => {
        return (
            <div className="flex flex-col h-full animate-in fade-in zoom-in duration-300">
                <div className="relative w-full flex-grow bg-black rounded-2xl overflow-hidden mb-6">
                    <img src="https://placehold.co/1200x675/333333/FFFFFF?text=+" alt="Main video feed" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 border-2 border-white/80 rounded-full flex items-center justify-center bg-black/20">
                            <i className="ph-fill ph-play text-white text-2xl ml-1"></i>
                        </div>
                    </div>
                    <div className="absolute bottom-4 left-4 bg-red-600/80 text-white px-3 py-1 rounded-md text-sm font-semibold">{t('onlineLecturesPage.live')}</div>
                    <div className="absolute bottom-4 right-4 flex items-center space-x-4 text-white text-xl">
                        <i className="ph-bold ph-speaker-high cursor-pointer hover:text-gray-300"></i>
                        <i className="ph-bold ph-gear cursor-pointer hover:text-gray-300"></i>
                        <i className="ph-bold ph-corners-out cursor-pointer hover:text-gray-300"></i>
                    </div>
                </div>

                <div className="flex space-x-4 mb-6 overflow-x-auto pb-2 -mx-4 px-4">
                    {participantsData.map((p) => (
                        <ParticipantThumbnail key={p.id} participant={p} />
                    ))}
                </div>

                <div className="flex justify-center">
                    <div className="bg-[#212124] p-3 rounded-2xl flex items-center space-x-4 shadow-[0_0_20px_rgba(107,78,255,0.2)]">
                        <button className="w-12 h-12 bg-[#6B4EFF] rounded-full flex items-center justify-center text-white text-xl hover:bg-opacity-80">
                            <i className="ph-bold ph-microphone"></i>
                        </button>
                        <button className="w-12 h-12 bg-[#6B4EFF] rounded-full flex items-center justify-center text-white text-xl hover:bg-opacity-80">
                            <i className="ph-bold ph-video-camera"></i>
                        </button>
                        <button className="w-12 h-12 bg-[#3A3A3C] rounded-full flex items-center justify-center text-white text-xl hover:bg-opacity-80">
                            <i className="ph-bold ph-hand-waving"></i>
                        </button>
                        <button onClick={onLeave} className="bg-[#FF5B5B] text-white font-semibold px-6 py-3 rounded-lg flex items-center space-x-2 hover:bg-opacity-90">
                            <i className="ph-bold ph-phone-disconnect"></i>
                            <span>{t('onlineLecturesPage.leave')}</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Plan 7 follow-up — course dropdown options derive from every courseCode
    // present in the loaded lectures (no extra API call). Defined BEFORE the
    // early returns to satisfy the Rules of Hooks (useMemo must always be
    // called in the same order).
    const courseOptions = useMemo(() => {
        // Map courseCode -> human-readable label so the dropdown shows
        // names (with a fallback to the code if no title was carried).
        const byCode = new Map<string, string>();
        for (const l of [...upcomingLecturesData, ...pastLectures]) {
            if (l.courseCode && !byCode.has(l.courseCode)) {
                byCode.set(l.courseCode, l.courseTitle || l.courseCode);
            }
        }
        return [
            { value: '__all__', label: 'All courses', icon: 'ph-list' },
            ...Array.from(byCode.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, label]) => ({ value: code, label, icon: 'ph-book-open' })),
        ];
    }, [upcomingLecturesData, pastLectures]);

    if (viewState === 'live') { return <VideoConference onLeave={() => setViewState('list')} />; }
    if (viewState === 'replay' && activeVideoUrl) {
        return <WatchReplayContent onBack={() => { setViewState('list'); setActiveVideoUrl(null); }} videoUrl={activeVideoUrl} />;
    }

    // --- Filtering Logic — course filter + universal search term ---
    const filterLecture = (lecture: OnlineLecture) => {
        if (courseFilter !== '__all__' && lecture.courseCode !== courseFilter) return false;
        const term = searchTerm.toLowerCase();
        if (!term) return true;
        return lecture.title.toLowerCase().includes(term) ||
            lecture.instructor.toLowerCase().includes(term) ||
            lecture.status.toLowerCase().includes(term) ||
            (lecture.courseCode || '').toLowerCase().includes(term);
    };

    const filteredUpcomingLectures = upcomingLecturesData.filter(filterLecture);
    const filteredPastLectures = pastLectures.filter(filterLecture);
    // ---------------------------------

    return (
        <div className="flex-1 pb-16 space-y-8 animate-in fade-in duration-500">
            <AnimateOnView>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                        <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('onlineLecturesPage.title')}</h2>
                        <p className="text-gray-600 dark:text-gray-400">{t('onlineLecturesPage.subtitle')}</p>
                    </div>
                    {/* Plan 7 follow-up — course filter dropdown. Options derived
                        from courseCodes present in the loaded lectures. */}
                    <div className="w-full sm:w-56">
                        <GlassDropdown
                            value={courseFilter}
                            onChange={setCourseFilter}
                            options={courseOptions}
                            direction="down"
                            className="w-full"
                        />
                    </div>
                </div>
            </AnimateOnView>

            <AnimateOnView delay={0.1}>
                <section>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center gap-2">
                        <i className="ph-fill ph-calendar-check text-[#6A3FF4]"></i> {t('onlineLecturesPage.upcoming')}
                    </h3>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="text-center py-5 text-gray-500"><i className="ph-bold ph-spinner animate-spin text-2xl"></i></div>
                        ) : filteredUpcomingLectures.length > 0 ? (
                            filteredUpcomingLectures.map((lecture, index) => (
                                <AnimateOnView key={lecture.id} delay={index * 0.1}>
                                    <LectureCard
                                        lecture={lecture}
                                        onJoin={() => {
                                            // Route to the in-app LiveKit session room. The room
                                            // mints its own JWT token via the backend and joins
                                            // via @livekit/components-react — every meeting
                                            // control is a native function call.
                                            navigate(`/student/live-session/${lecture.id}`);
                                        }}
                                    />
                                </AnimateOnView>
                            ))
                        ) : (
                            <div className={`${glassCardStyle} text-center py-8 px-4`}>
                                <i className="ph-bold ph-video-camera-slash text-4xl text-gray-400 dark:text-gray-600 mb-3 block"></i>
                                <p className="text-gray-600 dark:text-gray-400 font-semibold">
                                    {searchTerm
                                        ? t('coursesPage.noMatch')
                                        : t('onlineLecturesPage.noUpcoming')}
                                </p>
                                {!searchTerm && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        When a professor schedules a session in one of your courses, it will appear here.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </AnimateOnView>

            <AnimateOnView delay={0.2}>
                <section>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center gap-2">
                        <i className="ph-fill ph-clock-counter-clockwise text-gray-400"></i> {t('onlineLecturesPage.past')}
                    </h3>
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="text-center py-5 text-gray-500"><i className="ph-bold ph-spinner animate-spin text-2xl"></i></div>
                        ) : filteredPastLectures.length > 0 ? (
                            filteredPastLectures.map((lecture, index) => (
                                <AnimateOnView key={lecture.id} delay={index * 0.1}>
                                    <LectureCard
                                        lecture={lecture}
                                        onJoin={() => {
                                            if (!lecture.videoUrl) return;
                                            setActiveVideoUrl(lecture.videoUrl);
                                            setViewState('replay');
                                        }}
                                    />
                                </AnimateOnView>
                            ))
                        ) : (
                            <div className={`${glassCardStyle} text-center py-8 px-4`}>
                                <i className="ph-bold ph-clock text-4xl text-gray-400 dark:text-gray-600 mb-3 block"></i>
                                <p className="text-gray-600 dark:text-gray-400 font-semibold">
                                    {searchTerm
                                        ? t('coursesPage.noMatch')
                                        : t('onlineLecturesPage.noPast')}
                                </p>
                                {!searchTerm && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        Recordings appear here once a session ends and the host uploads one.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </section>
            </AnimateOnView>
        </div>
    );
};

