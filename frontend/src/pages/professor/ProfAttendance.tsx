import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { AttendanceRoster } from '../../components/AttendanceRoster';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { API_URLS } from '@shared/config';
import { useT } from '../../i18n';
import {
    createDemoSession,
    getCurrentQR,
    QRCodeData,
    formatTimeRemaining,
} from '../../utils/attendanceService';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- QR Code Display ---
// QRDisplay countdown is now driven by the staff-chosen refresh interval
// (5–30 s) rather than the server-side JWT TTL. The two are decoupled
// on purpose: the server token always expires in 15 s as a security
// floor (no replay), but the displayed "refreshes in" matches whatever
// cadence the staff picked, so the visible timer lines up with the
// dropdown above.
const QRDisplay: React.FC<{
    qrData: QRCodeData | null;
    onRefresh: () => void;
    isRefreshing: boolean;
    refreshSeconds: number;
}> = ({ qrData, onRefresh, isRefreshing, refreshSeconds }) => {
    const t = useT();
    const [timeRemaining, setTimeRemaining] = useState(refreshSeconds * 1000);

    // Reset the countdown the moment a fresh QR arrives. We can't rely
    // on `qrData.expiresAt` here because that's the JWT TTL, not the
    // refresh cadence — using `qrData.timestamp` (set on the server
    // when the token was minted) keeps the timer accurate across clock
    // skew between the two browsers.
    useEffect(() => {
        if (!qrData) return;
        const issuedAt = qrData.timestamp ?? Date.now();
        const refreshesAt = issuedAt + refreshSeconds * 1000;
        const tick = () => {
            const remaining = Math.max(0, refreshesAt - Date.now());
            setTimeRemaining(remaining);
            if (remaining <= 0) onRefresh();
        };
        tick();
        const interval = setInterval(tick, 100);
        return () => clearInterval(interval);
    }, [qrData, onRefresh, refreshSeconds]);

    return (
        <div className="flex flex-col items-center">
            <div className="relative bg-white p-3 rounded-2xl shadow-xl shadow-black/5">
                {qrData ? (
                    <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData.qrData)}`}
                        alt="Attendance QR Code"
                        className="w-44 h-44"
                    />
                ) : (
                    <div className="w-44 h-44 flex items-center justify-center bg-gray-100 rounded-xl">
                        <i className="ph-bold ph-qr-code text-6xl text-gray-300"></i>
                    </div>
                )}
                {isRefreshing && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-2xl">
                        <i className="ph-bold ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i>
                    </div>
                )}
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                {qrData ? <>{t('professor.paRefreshesIn')} <span className={`font-bold ${timeRemaining > 3000 ? 'text-[#6A3FF4]' : 'text-red-500'}`}>{formatTimeRemaining(timeRemaining)}</span></> : t('professor.paScanToMark')}
            </p>
        </div>
    );
};

// --- Historical Attendance Chart ---
// One bar per AttendanceSession (in chronological order). Bar height is
// attendance percentage. Tooltip on hover shows present / late / absent.
interface SessionBar {
    sessionId: string;
    index: number;
    date: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    total: number;
    percentage: number;
}

const AttendanceChart: React.FC<{ data: SessionBar[]; loading: boolean }> = ({ data, loading }) => {
    const t = useT();
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    // Absolute pixel ceiling for a 100% bar. Using px avoids the
    // "bars look like lines" bug we had with `height: X%` — that resolved
    // against the column's intrinsic content height (the label heights),
    // collapsing real bars into ~14 px stubs.
    const BAR_MAX_PX = 180;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-56 text-gray-400 text-sm gap-2">
                <i className="ph-bold ph-spinner animate-spin text-xl" />
                {t('professor.paLoadingChart')}
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-56 text-gray-400 text-sm gap-2">
                <i className="ph-bold ph-chart-bar text-3xl opacity-30" />
                {t('professor.paNoSessionsYet')}
            </div>
        );
    }

    const fmtDate = (iso: string) =>
        new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
        <div className="relative">
            <div className="flex items-end gap-2 overflow-x-auto pb-1 px-1" style={{ minHeight: BAR_MAX_PX + 40 }}>
                {data.map((item, i) => {
                    const barHeight = Math.max(4, Math.round((item.percentage / 100) * BAR_MAX_PX));
                    return (
                        <div
                            key={item.sessionId}
                            className="flex-shrink-0 flex flex-col items-center group cursor-pointer"
                            style={{ minWidth: Math.max(44, Math.floor(640 / Math.max(data.length, 8))) }}
                            onMouseEnter={() => setHoveredIdx(i)}
                            onMouseLeave={() => setHoveredIdx(null)}
                        >
                            {/* Percent label above the bar */}
                            <span className="text-[10px] font-bold text-gray-400 mb-1">{item.percentage}%</span>
                            {/* Bar — explicit px height, animates up from 0 */}
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: barHeight }}
                                transition={{ delay: i * 0.04, type: 'spring', stiffness: 200, damping: 22 }}
                                className="w-full bg-gradient-to-t from-[#5A2AD4] to-[#7B5AFF] rounded-t-lg group-hover:from-[#4A22B0] group-hover:to-[#6A4AEE] transition-colors"
                            />
                            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-1 truncate w-full text-center">
                                {fmtDate(item.date)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {hoveredIdx !== null && data[hoveredIdx] && (
                <div className="absolute top-1 right-1 bg-black/90 dark:bg-black/95 text-white text-xs rounded-lg px-3 py-2 shadow-lg border border-white/10 min-w-[140px] z-10 pointer-events-none">
                    <div className="font-bold mb-1">
                        {t('professor.paChartSession', { n: data[hoveredIdx].index, date: fmtDate(data[hoveredIdx].date) })}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-emerald-300">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        {t('professor.paChartPresent')} {data[hoveredIdx].present}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-amber-300">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        {t('professor.paChartLate')} {data[hoveredIdx].late}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-red-300">
                        <span className="w-2 h-2 rounded-full bg-red-400" />
                        {t('professor.paChartAbsent')} {data[hoveredIdx].absent}
                    </div>
                    {data[hoveredIdx].excused > 0 && (
                        <div className="flex items-center gap-2 text-[11px] text-blue-300">
                            <span className="w-2 h-2 rounded-full bg-blue-400" />
                            {t('professor.paChartExcused')} {data[hoveredIdx].excused}
                        </div>
                    )}
                    <div className="mt-1 pt-1 border-t border-white/10 text-[11px] text-gray-300">
                        {t('professor.paChartTotalMarked')} <span className="font-bold text-white">{data[hoveredIdx].total}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Weekly data helpers ---
interface AttendanceSession {
    sessionId?: string;
    courseCode?: string;
    startTime?: string;
    createdAt?: string;
    markedCount?: number;
    totalStudents?: number;
}

// (Weekly grouping helper retired — the chart now renders per-session bars
// fetched from /api/attendance/course/:code/sessions-stats.)

// --- Main Component ---
const ProfAttendance: React.FC = () => {
    const t = useT();
    const [sessionActive, setSessionActive] = useState(false);
    // Click-guard for the Start button — prevents the double-fire that
    // was creating two sessions ~50 ms apart (the backend dedupe is a
    // findFirst-then-create, which races when both requests arrive
    // simultaneously). Disabled while a session-start is in-flight.
    const [isStarting, setIsStarting] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [currentQR, setCurrentQR] = useState<QRCodeData | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [sessionTimer, setSessionTimer] = useState('00:00:00');
    const [studentsPresent, setStudentsPresent] = useState(0);
    // Session-duration as a "MM:SS" string so the existing GlassDropdown
    // option list / timer math keeps working unchanged.
    const [selectedDuration, setSelectedDuration] = useState('10:00');
    // QR auto-refresh cadence in seconds. The QR token expires after 15s
    // server-side, so anything from 5 to 30s makes sense — 30s cuts QR
    // bandwidth, 5s feels live. Default 10s.
    const [qrRefreshSeconds, setQrRefreshSeconds] = useState(10);
    const [selectedCourse, setSelectedCourse] = useState('');
    const [exportStart, setExportStart] = useState('');
    const [exportEnd, setExportEnd] = useState('');
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const qrRefreshRef = useRef<NodeJS.Timeout | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    // Auto-end timer — expires the session after `selectedDuration` so
    // the prof never has to manually click End. Cleared on a manual end
    // or when the prof navigates away.
    const sessionEndTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Per-session chart data — one bar per AttendanceSession in
    // chronological order. Replaces the previous weekly-bucket chart
    // which hid individual sessions.
    const [sessionBars, setSessionBars] = useState<SessionBar[]>([]);
    const [chartLoading, setChartLoading] = useState(true);
    const [chartCourse, setChartCourse] = useState('');
    const [myCourses, setMyCourses] = useState<{ code: string; name: string }[]>([]);

    // Restricted-session controls. When `isRestricted` is on AND
    // `restrictedIds` is non-empty, the session-start payload includes
    // restrictedToUserIds — the mark endpoint refuses anyone outside
    // the list, and the auto-absent fan-out on session-end only files
    // for those students (not the whole class).
    const [isRestricted, setIsRestricted] = useState(false);
    const [restrictedIds, setRestrictedIds] = useState<string[]>([]);
    const [eligibleStudents, setEligibleStudents] = useState<
        { id: string; name: string; email: string }[]
    >([]);
    const [loadingEligible, setLoadingEligible] = useState(false);
    const [restrictSearch, setRestrictSearch] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    // Fetch enrolled-students whenever the prof flips Restrict on
    // (and the selected course is known). Skipped while a session is
    // already active — the toggle is locked then.
    useEffect(() => {
        if (!isRestricted || !selectedCourse || sessionActive) return;
        let cancelled = false;
        setLoadingEligible(true);
        fetch(
            `${API_URLS.attendance()}/api/attendance/course/${encodeURIComponent(selectedCourse)}/eligible-students`,
            {
                credentials: 'include',
                headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
            },
        )
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((data) => {
                if (cancelled) return;
                setEligibleStudents(Array.isArray(data?.students) ? data.students : []);
            })
            .catch(() => !cancelled && setEligibleStudents([]))
            .finally(() => !cancelled && setLoadingEligible(false));
        return () => { cancelled = true; };
    }, [isRestricted, selectedCourse, sessionActive]);

    // Fetch per-session attendance bars. /sessions-stats returns ALL
    // sessions for the course (up to 100) with present/late/absent
    // breakdowns; the chart renders one bar per session with a
    // tooltip on hover showing the full breakdown.
    const fetchSessionStats = useCallback(async (course: string) => {
        setChartLoading(true);
        try {
            const res = await fetch(
                `${API_URLS.attendance()}/api/attendance/course/${encodeURIComponent(course)}/sessions-stats`,
                { credentials: 'include', headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
            );
            if (!res.ok) throw new Error('fetch failed');
            const data = await res.json();
            setSessionBars(Array.isArray(data?.sessions) ? data.sessions : []);
        } catch {
            setSessionBars([]);
        } finally {
            setChartLoading(false);
        }
    }, []);

    // Fetch professor's courses on mount
    useEffect(() => {
        const email = localStorage.getItem('currentUserEmail') || '';
        const token = localStorage.getItem('authToken');
        if (!email) return;
        fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => res.ok ? res.json() : Promise.reject())
            .then((data: { code: string; name: string }[]) => {
                setMyCourses(data);
                if (data.length > 0) {
                    setSelectedCourse(data[0].code);
                    setChartCourse(data[0].code);
                }
            })
            .catch(() => setMyCourses([]));
    }, []);

    useEffect(() => {
        if (!chartCourse) return;
        // Initial fetch + 30 s poll so manual marks made via the
        // roster surface in the chart without a manual reload.
        fetchSessionStats(chartCourse);
        const t = setInterval(() => fetchSessionStats(chartCourse), 30_000);
        return () => clearInterval(t);
    }, [chartCourse, fetchSessionStats]);

    const fetchQR = useCallback(async () => {
        if (!sessionId) return;
        setIsRefreshing(true);
        const qr = await getCurrentQR(sessionId);
        if (qr) setCurrentQR(qr);
        setIsRefreshing(false);
    }, [sessionId]);

    const pollAttendance = useCallback(async () => {
        if (!sessionId) return;
        try {
            const response = await fetch(
                `${API_URLS.attendance()}/api/attendance/sessions`,
                { credentials: 'include', headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
            );
            const sessions: AttendanceSession[] = await response.json();
            const current = sessions.find(s => s.sessionId === sessionId);
            if (current) setStudentsPresent(current.markedCount || 0);
        } catch { /* ignore */ }
    }, [sessionId]);

    useEffect(() => {
        if (sessionActive && sessionId) {
            fetchQR();
            // QR refresh interval is staff-configurable (5–30 s). Clamped
            // to 1 s minimum so a bad value doesn't lock the UI.
            const refreshMs = Math.max(1, qrRefreshSeconds) * 1000;
            qrRefreshRef.current = setInterval(fetchQR, refreshMs);
            // 1s poll for the live "Students Present" counter — every scan
            // hits the count within a second. Lightweight: just hits the
            // sessions list and pulls one row.
            pollRef.current = setInterval(pollAttendance, 1000);
            timerRef.current = setInterval(() => {
                setTimerSeconds(prev => prev + 1);
            }, 1000);
        }
        return () => {
            if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [sessionActive, sessionId, fetchQR, pollAttendance, qrRefreshSeconds]);

    useEffect(() => {
        const hrs = Math.floor(timerSeconds / 3600).toString().padStart(2, '0');
        const mins = Math.floor((timerSeconds % 3600) / 60).toString().padStart(2, '0');
        const secs = (timerSeconds % 60).toString().padStart(2, '0');
        setSessionTimer(`${hrs}:${mins}:${secs}`);
    }, [timerSeconds]);

    // Convert "MM:SS" → integer minutes, rounding up so 5:30 still
    // produces 6 minutes of session life rather than 5.
    const durationMinutesFromSelected = (): number => {
        const [m, s] = selectedDuration.split(':').map((x) => parseInt(x, 10) || 0);
        return Math.max(1, m + (s > 0 ? 1 : 0));
    };

    const handleStartSession = async () => {
        // Bail if already starting OR a session is active. Both
        // conditions are also reflected in the disabled prop on the
        // button, but a belt-and-braces guard catches the case where
        // a click event fires twice before the disabled prop applies
        // (which is exactly how the duplicate sessions were spawning).
        if (isStarting || sessionActive) return;
        setIsStarting(true);
        const instructorEmail = localStorage.getItem('currentUserEmail') || '';
        const minutes = durationMinutesFromSelected();
        try {
            // Primary path — hit the real attendance server.
            try {
                const res = await fetch(`${API_URLS.attendance()}/api/attendance/session/start`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${localStorage.getItem('authToken')}`,
                    },
                    body: JSON.stringify({
                        courseCode: selectedCourse,
                        location: 'Lecture Hall',
                        instructorEmail,
                        durationMinutes: minutes,
                        // Pass the restricted list ONLY when the toggle is
                        // on AND at least one student is picked. Empty
                        // restrictedToUserIds = full-class (legacy) session.
                        restrictedToUserIds: isRestricted ? restrictedIds : [],
                    }),
                });
                if (res.ok) {
                    // Real response shape is { session, qrToken, qrUrl, reused }.
                    const data = (await res.json()) as { session?: { id: string } };
                    const newId = data.session?.id;
                    if (newId) {
                        setSessionId(newId);
                        setSessionActive(true);
                        setTimerSeconds(0);
                        setStudentsPresent(0);
                        armAutoEnd(minutes);
                        return;
                    }
                }
            } catch { /* fall through to preview */ }

            // Fallback: preview session when the real server is unreachable.
            const result = await createDemoSession(selectedCourse);
            if (result.success && result.sessionId) {
                setSessionId(result.sessionId);
                setSessionActive(true);
                setTimerSeconds(0);
                setStudentsPresent(0);
                armAutoEnd(minutes);
            }
        } finally {
            // Release the guard regardless of which branch ran — the
            // outer try/finally is the only place it's safe to do this
            // because every successful branch either returns or
            // continues into the preview path.
            setIsStarting(false);
        }
    };

    // Schedule the auto-end. The setTimeout runs `handleEndSession` so
    // the closing logic stays in one place (clears intervals, POSTs the
    // /end endpoint, resets local state). Reset on every Start click in
    // case the prof restarts before the previous timer fires.
    const armAutoEnd = useCallback(
        (minutes: number) => {
            if (sessionEndTimerRef.current) clearTimeout(sessionEndTimerRef.current);
            sessionEndTimerRef.current = setTimeout(() => {
                handleEndSession();
            }, Math.max(1, minutes) * 60 * 1000);
        },
        // handleEndSession is stable enough — it reads from refs / state setters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const handleEndSession = async () => {
        // Snapshot the id before we clear local state — the POST below
        // needs the real id, and React state updates are async.
        const idToEnd = sessionId;

        // Tear down local UI first so the prof sees the session card
        // collapse instantly. The DB write is fire-and-forget; if it
        // fails, the session auto-expires after its expiresAt anyway.
        setSessionActive(false);
        setSessionId(null);
        setCurrentQR(null);
        setTimerSeconds(0);
        if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        if (sessionEndTimerRef.current) {
            clearTimeout(sessionEndTimerRef.current);
            sessionEndTimerRef.current = null;
        }

        if (!idToEnd) return;
        try {
            const token = localStorage.getItem('authToken');
            await fetch(
                `${API_URLS.attendance()}/api/attendance/sessions/${idToEnd}/end`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
        } catch {
            // Session will auto-expire server-side (1 h after start).
        }
    };

    // Hard-delete a session by id. Used by:
    //   1. The active-session "Delete (opened by mistake)" button → deletes
    //      the live session AND tears down the timers/polling.
    //   2. The "Past sessions" list under the chart → deletes a historic
    //      session and refreshes the chart.
    // The backend handles ownership/cascade in both cases.
    const deleteSessionById = useCallback(
        async (idToDelete: string, opts?: { isActive?: boolean; confirmMessage?: string }) => {
            const isActive = !!opts?.isActive;
            const msg =
                opts?.confirmMessage ||
                (isActive
                    ? t('professor.paConfirmDeleteActive')
                    : t('professor.paConfirmDeletePast'));
            if (!window.confirm(msg)) return false;
            setIsDeleting(true);
            try {
                const token = localStorage.getItem('authToken');
                const res = await fetch(
                    `${API_URLS.attendance()}/api/attendance/sessions/${idToDelete}`,
                    {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { Authorization: `Bearer ${token}` },
                    },
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
                }
                if (isActive) {
                    // Tear down identical to handleEndSession but without the /end POST.
                    setSessionActive(false);
                    setSessionId(null);
                    setCurrentQR(null);
                    setTimerSeconds(0);
                    setStudentsPresent(0);
                    if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
                    if (pollRef.current) clearInterval(pollRef.current);
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (sessionEndTimerRef.current) {
                        clearTimeout(sessionEndTimerRef.current);
                        sessionEndTimerRef.current = null;
                    }
                }
                // Refresh the chart so the deleted session disappears from
                // the bar list.
                if (chartCourse) fetchSessionStats(chartCourse);
                return true;
            } catch (err) {
                window.alert(err instanceof Error ? err.message : t('professor.paFailedToDeleteSession'));
                return false;
            } finally {
                setIsDeleting(false);
            }
        },
        [chartCourse, fetchSessionStats, t],
    );

    const handleDeleteSession = async () => {
        if (!sessionId) return;
        await deleteSessionById(sessionId, { isActive: true });
    };

    // Download CSV of attendance records for the chart-selected course
    // and the date filters. Uses fetch + blob + anchor so the JWT auth
    // header rides on the request (a plain <a href> can't carry one).
    const handleExportCsv = async () => {
        if (!chartCourse) {
            setExportError(t('professor.paPickCourseFirst'));
            return;
        }
        setExporting(true);
        setExportError(null);
        try {
            const params = new URLSearchParams({ courseCode: chartCourse });
            if (exportStart) params.set('startDate', exportStart);
            if (exportEnd) params.set('endDate', exportEnd);
            const url = `${API_URLS.attendance()}/api/attendance/export.csv?${params.toString()}`;
            const token = localStorage.getItem('authToken');
            const res = await fetch(url, {
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const filename =
                `UniFlow_Attendance_${chartCourse}${exportStart ? '_' + exportStart : ''}${exportEnd ? '_' + exportEnd : ''}.csv`;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Revoke the object URL on next tick — browsers handle the download synchronously.
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : t('professor.paExportFailed'));
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.attendanceTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('professor.attendanceManageDesc')}</p>
            </AnimateOnView>

            {/* Live Attendance Session */}
            <AnimateOnView delay={0.1}>
                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                        <div>
                            <h3 className="text-black dark:text-white text-xl font-bold">{t('professor.liveAttendanceSession')}</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm">{t('professor.attendanceManageDesc')}</p>
                        </div>
                        {/* Filter row — every dropdown is a GlassDropdown
                            (project rule: no native <select>). Disabled
                            while a session is running so the staff can't
                            change the course/duration mid-session and
                            confuse the timer. The QR-refresh dropdown
                            stays enabled because it's safe to retune
                            on the fly. */}
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[220px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('staff.course')}</label>
                                <GlassDropdown
                                    value={selectedCourse}
                                    onChange={(v) => !sessionActive && setSelectedCourse(v)}
                                    options={myCourses.length === 0
                                        ? [{ value: '', label: t('professor.paNoCoursesAssignedShort') }]
                                        : myCourses.map((c) => ({
                                            value: c.code,
                                            label: `${c.code} — ${c.name}`,
                                            icon: 'ph-book-open',
                                        }))
                                    }
                                    direction="auto"
                                    className={`w-full ${sessionActive ? 'opacity-50 pointer-events-none' : ''}`}
                                />
                            </div>
                            <div className="min-w-[160px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('professor.paSessionDuration')}</label>
                                <GlassDropdown
                                    value={selectedDuration}
                                    onChange={(v) => !sessionActive && setSelectedDuration(v)}
                                    options={[
                                        { value: '5:00',  label: t('professor.paFiveMins'),  icon: 'ph-timer' },
                                        { value: '10:00', label: t('professor.paTenMins'), icon: 'ph-timer' },
                                        { value: '15:00', label: t('professor.paFifteenMins'), icon: 'ph-timer' },
                                        { value: '30:00', label: t('professor.paThirtyMins'), icon: 'ph-timer' },
                                    ]}
                                    direction="auto"
                                    className={`w-full ${sessionActive ? 'opacity-50 pointer-events-none' : ''}`}
                                />
                            </div>
                            <div className="min-w-[160px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('professor.paQrRefreshEvery')}</label>
                                <GlassDropdown
                                    value={String(qrRefreshSeconds)}
                                    onChange={(v) => setQrRefreshSeconds(parseInt(v, 10) || 10)}
                                    options={[
                                        { value: '5',  label: t('professor.paFiveSec'),  icon: 'ph-arrows-clockwise' },
                                        { value: '10', label: t('professor.paTenSec'), icon: 'ph-arrows-clockwise' },
                                        { value: '15', label: t('professor.paFifteenSec'), icon: 'ph-arrows-clockwise' },
                                        { value: '20', label: t('professor.paTwentySec'), icon: 'ph-arrows-clockwise' },
                                        { value: '30', label: t('professor.paThirtySec'), icon: 'ph-arrows-clockwise' },
                                    ]}
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                        {/* QR Side */}
                        <div className="flex justify-center">
                            <div className="bg-black/30 p-6 rounded-2xl border border-white/5">
                                <QRDisplay
                                    qrData={currentQR}
                                    onRefresh={fetchQR}
                                    isRefreshing={isRefreshing}
                                    refreshSeconds={qrRefreshSeconds}
                                />
                            </div>
                        </div>
                        {/* Info Side */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm">
                                <i className="ph-bold ph-timer text-[#6A3FF4]"></i>
                                <span className="text-gray-500 dark:text-gray-400">{t('professor.sessionTimerLabel')}</span>
                                <span className="text-[#6A3FF4] font-bold text-lg font-mono">{sessionTimer}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <i className="ph-bold ph-users text-[#6A3FF4]"></i>
                                <span className="text-gray-500 dark:text-gray-400">{t('professor.studentsPresentLabel')}</span>
                                <span className="text-[#6A3FF4] font-bold text-lg">{studentsPresent}</span>
                            </div>

                            {/* Restrict toggle — only available before a
                                session starts. When ON, only the picked
                                students count for this session: the rest of
                                the class won't be filed absent on end. */}
                            {!sessionActive && (
                                <div className="bg-white/5 dark:bg-black/20 border border-white/10 rounded-xl p-3 space-y-3">
                                    <div
                                        onClick={() => setIsRestricted((v) => !v)}
                                        className="flex items-center gap-3 cursor-pointer select-none"
                                    >
                                        <GlassCheckbox
                                            checked={isRestricted}
                                            onChange={setIsRestricted}
                                            size="sm"
                                            ariaLabel={t('professor.paRestrictAria')}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-black dark:text-white">
                                                {t('professor.paRestrictToggle')}
                                            </p>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                                                {t('professor.paRestrictHint')}
                                            </p>
                                        </div>
                                    </div>

                                    {isRestricted && (
                                        <div className="border-t border-white/10 pt-3">
                                            {loadingEligible ? (
                                                <div className="text-xs text-gray-500 flex items-center gap-2 py-2">
                                                    <i className="ph-bold ph-spinner animate-spin" /> {t('professor.paLoadingEnrolled')}
                                                </div>
                                            ) : eligibleStudents.length === 0 ? (
                                                <p className="text-xs text-gray-500 py-2">
                                                    {t('professor.paNoEnrolledForCourse')}
                                                </p>
                                            ) : (
                                                <>
                                                    {/* Search box — filters the picker by name / email / id.
                                                        Case-insensitive substring match. Doesn't change
                                                        which students are SELECTED, only which are visible. */}
                                                    <div className="relative mb-2">
                                                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
                                                        <input
                                                            type="text"
                                                            value={restrictSearch}
                                                            onChange={(e) => setRestrictSearch(e.target.value)}
                                                            placeholder={t('professor.paSearchByNameEmailId')}
                                                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-lg py-1.5 pl-8 pr-3 text-xs text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]"
                                                        />
                                                    </div>
                                                    {(() => {
                                                        const q = restrictSearch.trim().toLowerCase();
                                                        const visible = q
                                                            ? eligibleStudents.filter((s) =>
                                                                  s.name.toLowerCase().includes(q) ||
                                                                  s.email.toLowerCase().includes(q) ||
                                                                  s.id.toLowerCase().includes(q),
                                                              )
                                                            : eligibleStudents;
                                                        return (
                                                            <>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                                                                        {t('professor.paSelectedNofM', { n: restrictedIds.length, total: eligibleStudents.length })}
                                                                        {q && (
                                                                            <span className="ml-2 normal-case text-gray-400 font-normal">
                                                                                {t('professor.paShowingN', { n: visible.length })}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            onClick={() => {
                                                                                // Select all matches visible (preserve any selections outside the filter).
                                                                                setRestrictedIds((prev) => {
                                                                                    const next = new Set(prev);
                                                                                    visible.forEach((s) => next.add(s.id));
                                                                                    return [...next];
                                                                                });
                                                                            }}
                                                                            className="text-[11px] font-semibold text-[#6A3FF4] hover:underline"
                                                                        >
                                                                            {q ? t('professor.paSelectShown') : t('professor.paSelectAll')}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setRestrictedIds([])}
                                                                            className="text-[11px] font-semibold text-gray-500 hover:text-red-500"
                                                                        >
                                                                            {t('professor.paClear')}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                {visible.length === 0 ? (
                                                                    <p className="text-xs text-gray-500 py-2 text-center italic">
                                                                        {t('professor.paNoStudentsMatch')}
                                                                    </p>
                                                                ) : (
                                                                    <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                                                                        {visible.map((s) => {
                                                                            const checked = restrictedIds.includes(s.id);
                                                                            const toggle = () => {
                                                                                setRestrictedIds((prev) =>
                                                                                    checked
                                                                                        ? prev.filter((id) => id !== s.id)
                                                                                        : [...prev, s.id],
                                                                                );
                                                                            };
                                                                            return (
                                                                                <div
                                                                                    key={s.id}
                                                                                    onClick={toggle}
                                                                                    className={`flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                                                                                        checked
                                                                                            ? 'bg-[#6A3FF4]/15 border border-[#6A3FF4]/40'
                                                                                            : 'bg-white/5 hover:bg-white/10 border border-transparent'
                                                                                    }`}
                                                                                >
                                                                                    <GlassCheckbox
                                                                                        checked={checked}
                                                                                        onChange={toggle}
                                                                                        size="sm"
                                                                                        ariaLabel={t('professor.paSelectAriaLabel', { name: s.name })}
                                                                                    />
                                                                                    <div className="flex-1 min-w-0">
                                                                                        <p className="text-sm text-black dark:text-white truncate">{s.name}</p>
                                                                                        <p className="text-[10px] text-gray-500 truncate">{s.email}</p>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </>
                                                        );
                                                    })()}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Status pill while a restricted session is live */}
                            {sessionActive && restrictedIds.length > 0 && (
                                <div className="bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 rounded-xl px-3 py-2 text-xs text-[#6A3FF4] dark:text-[#bda8ff] flex items-center gap-2">
                                    <i className="ph-bold ph-user-list" />
                                    {t('professor.paRestrictedPill', { n: restrictedIds.length, suffix: restrictedIds.length === 1 ? '' : 's' })}
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleStartSession}
                                    disabled={sessionActive || isStarting || !selectedCourse || (isRestricted && restrictedIds.length === 0)}
                                    className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                                        sessionActive || isStarting || !selectedCourse || (isRestricted && restrictedIds.length === 0)
                                            ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                                            : 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90 shadow-lg shadow-purple-500/20'
                                    }`}
                                >
                                    <i className={`ph-bold ${isStarting ? 'ph-spinner animate-spin' : 'ph-play'}`}></i>
                                    {isStarting ? t('professor.paStarting') : t('professor.paStartSession')}
                                </button>
                                <button
                                    onClick={handleEndSession}
                                    disabled={!sessionActive}
                                    className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border ${!sessionActive ? 'border-gray-500/20 text-gray-500 cursor-not-allowed' : 'border-white/20 dark:border-white/10 text-black dark:text-white hover:bg-white/10'}`}
                                >
                                    <i className="ph-bold ph-stop"></i> {t('professor.paEndSession')}
                                </button>
                            </div>

                            {/* Delete is a separate row so it visually
                                reads as the "danger" action — wider hit area
                                than a small icon, red-tinted on hover. */}
                            {sessionActive && (
                                <button
                                    onClick={handleDeleteSession}
                                    disabled={isDeleting}
                                    className="w-full py-2.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <i className={`ph-bold ${isDeleting ? 'ph-spinner animate-spin' : 'ph-trash'}`}></i>
                                    {isDeleting ? t('professor.paDeleting') : t('professor.paDeleteOpenedByMistake')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </AnimateOnView>

            {/* Manual mark roster — staff can flip a student between
                present / late / absent / excused without QR. Polls the
                roster every 5 s while a session is active so QR scans
                show up in the same grid. */}
            <AnimateOnView delay={0.15}>
                <AttendanceRoster sessionId={sessionId} courseCode={selectedCourse} />
            </AnimateOnView>

            {/* Bottom Row: Historical + Export */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                <AnimateOnView delay={0.2} className="xl:col-span-2">
                    <div className={`${glassCardStyle} p-4 sm:p-6`}>
                        {/* Stack on mobile so the course dropdown doesn't
                            squeeze the title. Original flex justify-between
                            kept them on the same row even at 360 px wide,
                            squishing both. */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
                            <h3 className="text-black dark:text-white text-lg sm:text-xl font-bold">{t('professor.paHistoricalTitle')}</h3>
                            <div className="w-full sm:w-auto sm:min-w-[200px]">
                                <GlassDropdown
                                    value={chartCourse}
                                    onChange={setChartCourse}
                                    options={myCourses.length === 0
                                        ? [{ value: '', label: t('professor.paNoCoursesAssignedShort') }]
                                        : myCourses.map((c) => ({
                                            value: c.code,
                                            label: `${c.code} — ${c.name}`,
                                            icon: 'ph-book-open',
                                        }))
                                    }
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                        </div>
                        <AttendanceChart data={sessionBars} loading={chartLoading} />
                        {sessionBars.length > 0 && (
                            <div className="flex items-center justify-center gap-2 mt-4">
                                <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-[#5A2AD4] to-[#7B5AFF]"></div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">{t('professor.paPerSessionLegend')}</span>
                            </div>
                        )}

                        {/* Past-sessions management — compact scrollable list
                            of every recorded session for this course with a
                            delete button per row. Newest first. */}
                        {sessionBars.length > 0 && (
                            <div className="mt-6 pt-4 border-t border-white/10">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
                                        <i className="ph-bold ph-list-checks text-[#6A3FF4]" />
                                        {t('professor.paPastSessions')}
                                    </h4>
                                    <span className="text-[11px] text-gray-500">
                                        {t('professor.paSessionCount', { n: sessionBars.length, suffix: sessionBars.length === 1 ? '' : 's' })}
                                    </span>
                                </div>
                                <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                                    {[...sessionBars]
                                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                        .map((s) => {
                                            const dateLabel = new Date(s.date).toLocaleDateString('en-US', {
                                                weekday: 'short',
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            });
                                            return (
                                                <div
                                                    key={s.sessionId}
                                                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 dark:bg-black/20 border border-white/10 dark:border-white/5"
                                                >
                                                    <span className="text-[10px] font-bold text-gray-500 w-8">#{s.index}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-black dark:text-white">
                                                            {dateLabel}
                                                        </p>
                                                        <p className="text-[11px] text-gray-500">
                                                            <span className="text-emerald-500 font-semibold">{s.present}</span> present ·{' '}
                                                            <span className="text-amber-500 font-semibold">{s.late}</span> late ·{' '}
                                                            <span className="text-red-500 font-semibold">{s.absent}</span> absent
                                                            {s.excused > 0 && (
                                                                <> · <span className="text-blue-500 font-semibold">{s.excused}</span> excused</>
                                                            )}
                                                        </p>
                                                    </div>
                                                    <span className="text-xs font-bold text-[#6A3FF4] dark:text-[#bda8ff] w-12 text-right">
                                                        {s.percentage}%
                                                    </span>
                                                    <button
                                                        onClick={() => deleteSessionById(s.sessionId, { isActive: false })}
                                                        disabled={isDeleting}
                                                        title={t('professor.paDeleteSessionTip')}
                                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                                                    >
                                                        <i className="ph-bold ph-trash text-sm" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}
                    </div>
                </AnimateOnView>

                {/* Export */}
                <AnimateOnView delay={0.3}>
                    <div className={`${glassCardStyle} p-6`}>
                        <h3 className="text-black dark:text-white text-xl font-bold mb-2">{t('professor.paExportTitle')}</h3>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">{t('professor.paExportSubtitle')}</p>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('professor.paStartDate')}</label>
                                <input type="date" value={exportStart} onChange={e => setExportStart(e.target.value)} className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('professor.paEndDate')}</label>
                                <input type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)} className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50" />
                            </div>
                            {exportError && (
                                <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                                    <i className="ph-bold ph-warning-circle mr-1" />
                                    {exportError}
                                </div>
                            )}
                            <button
                                onClick={handleExportCsv}
                                disabled={exporting || !chartCourse}
                                className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-3 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className={`ph-bold ${exporting ? 'ph-spinner animate-spin' : 'ph-download'}`}></i>
                                {exporting ? t('professor.paExporting') : t('professor.paExportToCsv')}
                            </button>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center">
                                {t('professor.paCsvOpenHint')}
                            </p>
                        </div>
                    </div>
                </AnimateOnView>
            </div>
        </div>
    );
};

export default ProfAttendance;
