import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { AttendanceRoster } from '../../components/AttendanceRoster';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- Local QR type + helpers (MVP build — no attendanceService) ---
interface QRCodeData {
    qrData: string;
    timestamp: number;
}

const formatTimeRemaining = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
};

// --- Static preview data ---
const MOCK_COURSES = ['CS201', 'MA205', 'CS101'];

const MOCK_WEEKLY: Record<string, { week: string; percentage: number }[]> = {
    CS201: [
        { week: 'Wk 1', percentage: 92 },
        { week: 'Wk 2', percentage: 88 },
        { week: 'Wk 3', percentage: 95 },
        { week: 'Wk 4', percentage: 84 },
        { week: 'Wk 5', percentage: 90 },
        { week: 'Wk 6', percentage: 87 },
    ],
    MA205: [
        { week: 'Wk 1', percentage: 80 },
        { week: 'Wk 2', percentage: 85 },
        { week: 'Wk 3', percentage: 78 },
        { week: 'Wk 4', percentage: 82 },
        { week: 'Wk 5', percentage: 88 },
        { week: 'Wk 6', percentage: 91 },
    ],
    CS101: [
        { week: 'Wk 1', percentage: 76 },
        { week: 'Wk 2', percentage: 81 },
        { week: 'Wk 3', percentage: 79 },
        { week: 'Wk 4', percentage: 85 },
        { week: 'Wk 5', percentage: 83 },
        { week: 'Wk 6', percentage: 89 },
    ],
};

// --- QR Code Display ---
// Countdown driven by the staff-chosen refresh cadence (mirrors
// ProfAttendance's QRDisplay). The visible "refreshes in" lines up with
// the dropdown.
const QRDisplay: React.FC<{
    qrData: QRCodeData | null;
    onRefresh: () => void;
    isRefreshing: boolean;
    refreshSeconds: number;
}> = ({ qrData, onRefresh, isRefreshing, refreshSeconds }) => {
    const t = useT();
    const [timeRemaining, setTimeRemaining] = useState(refreshSeconds * 1000);

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
                        alt={t('ta.qrCodeAlt')}
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
                {qrData ? <>{t('ta.refreshesIn')} <span className={`font-bold ${timeRemaining > 3000 ? 'text-[#6A3FF4]' : 'text-red-500'}`}>{formatTimeRemaining(timeRemaining)}</span></> : t('ta.scanToMark')}
            </p>
        </div>
    );
};

// --- Historical Attendance Chart ---
const AttendanceChart: React.FC<{ data: { week: string; percentage: number }[] }> = ({ data }) => {
    const t = useT();
    const maxPct = 100;
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400 text-sm italic">
                {t('ta.noAttendanceData')}
            </div>
        );
    }
    return (
        <div className="flex items-end gap-3 h-48">
            {data.map((item, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-400">{item.percentage}%</span>
                    <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${(item.percentage / maxPct) * 100}%` }}
                        transition={{ delay: i * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
                        className="w-full bg-gradient-to-t from-[#5A2AD4] to-[#7B5AFF] rounded-t-lg min-h-[4px]"
                    />
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-1">{item.week}</span>
                </div>
            ))}
        </div>
    );
};

// --- Main Component ---
const TAAttendance: React.FC = () => {
    const t = useT();
    const [sessionActive, setSessionActive] = useState(false);
    const [isStarting, setIsStarting] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [currentQR, setCurrentQR] = useState<QRCodeData | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [sessionTimer, setSessionTimer] = useState('00:00:00');
    const [studentsPresent, setStudentsPresent] = useState(0);
    const [selectedDuration, setSelectedDuration] = useState('10:00');
    // QR auto-refresh cadence (5–30 s).
    const [qrRefreshSeconds, setQrRefreshSeconds] = useState(10);
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [exportStart, setExportStart] = useState(weekAgo);
    const [exportEnd, setExportEnd] = useState(today);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const qrRefreshRef = useRef<NodeJS.Timeout | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const sessionEndTimerRef = useRef<NodeJS.Timeout | null>(null);

    const [courses, setCourses] = useState<string[]>([]);
    const [coursesLoading, setCoursesLoading] = useState(true);
    const [selectedCourse, setSelectedCourse] = useState('');
    const [weeklyData, setWeeklyData] = useState<{ week: string; percentage: number }[]>([]);
    const [sessionStartedMessage, setSessionStartedMessage] = useState<string | null>(null);
    const [startError, setStartError] = useState<string | null>(null);

    useEffect(() => {
        // MVP build — populate course list from static mock data.
        setCourses(MOCK_COURSES);
        setSelectedCourse(MOCK_COURSES[0]);
        setCoursesLoading(false);
    }, []);

    useEffect(() => {
        if (!selectedCourse) return;
        // MVP build — load weekly attendance from static mock data.
        setWeeklyData(MOCK_WEEKLY[selectedCourse] ?? []);
    }, [selectedCourse]);

    const fetchQR = useCallback(() => {
        if (!sessionId) return;
        // MVP build — regenerate a mock QR token locally.
        setIsRefreshing(true);
        setCurrentQR({
            qrData: `uniflow-preview:${sessionId}:${Date.now()}`,
            timestamp: Date.now(),
        });
        setIsRefreshing(false);
    }, [sessionId]);

    const pollAttendance = useCallback(() => {
        if (!sessionId) return;
        // MVP build — simulate students trickling in.
        setStudentsPresent(prev => (prev < 42 ? prev + Math.floor(Math.random() * 3) : prev));
    }, [sessionId]);

    useEffect(() => {
        if (sessionActive && sessionId) {
            fetchQR();
            // Configurable QR refresh cadence — controlled by the
            // GlassDropdown filter on the page.
            const refreshMs = Math.max(1, qrRefreshSeconds) * 1000;
            qrRefreshRef.current = setInterval(fetchQR, refreshMs);
            pollRef.current = setInterval(pollAttendance, 3000);
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

    const handleStartSession = () => {
        // MVP build — start a local-only session, no backend call.
        if (isStarting || sessionActive) return;
        if (!selectedCourse) return;
        setStartError(null);
        setIsStarting(true);
        const newId = `preview-session-${Date.now()}`;
        setSessionId(newId);
        setSessionActive(true);
        setTimerSeconds(0);
        setStudentsPresent(0);
        setSessionStartedMessage(t('ta.sessionStartedMessage', { courseCode: selectedCourse }));
        const [minsStr, secsStr] = selectedDuration.split(':');
        const totalMs = (parseInt(minsStr, 10) * 60 + parseInt(secsStr, 10)) * 1000;
        sessionEndTimerRef.current = setTimeout(() => handleEndSession(), totalMs);
        setIsStarting(false);
    };

    const handleEndSession = () => {
        // MVP build — tear down local session state only.
        setSessionActive(false);
        setSessionId(null);
        setCurrentQR(null);
        setTimerSeconds(0);
        setSessionStartedMessage(null);
        setStartError(null);
        if (qrRefreshRef.current) clearInterval(qrRefreshRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        if (sessionEndTimerRef.current) clearTimeout(sessionEndTimerRef.current);
    };

    const handleExport = () => {
        if (!selectedCourse) return;
        // MVP build — build CSV from local mock data (no backend call).
        const rows = MOCK_WEEKLY[selectedCourse] ?? [];
        const csv = ['Week,Attendance %', ...rows.map(r => `${r.week},${r.percentage}`)].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_${selectedCourse}_${exportStart}_to_${exportEnd}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.attendanceTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('professor.attendanceManageDesc')}</p>
            </AnimateOnView>

            {!coursesLoading && courses.length === 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm px-4 py-3 rounded-xl mb-4">
                    <i className="ph-bold ph-warning mr-2"></i>
                    {t('ta.noCoursesAdminContact')}
                </div>
            )}

            {/* Live Attendance Session */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                        <div>
                            <h3 className="text-black dark:text-white text-xl font-bold">{t('professor.liveAttendanceSession')}</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm">{t('professor.attendanceManageDesc')}</p>
                        </div>
                        {/* Filter row — every dropdown is a GlassDropdown
                            (project rule: no native <select>). Course +
                            duration lock during a live session so the
                            timer stays consistent; refresh is always
                            tunable. */}
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[200px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('staff.course')}</label>
                                <GlassDropdown
                                    value={selectedCourse}
                                    onChange={(v) => !sessionActive && setSelectedCourse(v)}
                                    options={
                                        coursesLoading || courses.length === 0
                                            ? [{ value: '', label: coursesLoading ? t('staff.loading') : t('ta.noCoursesAssigned') }]
                                            : courses.map((c) => ({ value: c, label: c, icon: 'ph-book-open' }))
                                    }
                                    direction="auto"
                                    className={`w-full ${sessionActive ? 'opacity-50 pointer-events-none' : ''}`}
                                />
                            </div>
                            <div className="min-w-[160px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('professor.sessionDurationLabel')}</label>
                                <GlassDropdown
                                    value={selectedDuration}
                                    onChange={(v) => !sessionActive && setSelectedDuration(v)}
                                    options={[
                                        { value: '5:00',  label: t('ta.minutes5'),  icon: 'ph-timer' },
                                        { value: '10:00', label: t('ta.minutes10'), icon: 'ph-timer' },
                                        { value: '15:00', label: t('ta.minutes15'), icon: 'ph-timer' },
                                        { value: '30:00', label: t('ta.minutes30'), icon: 'ph-timer' },
                                    ]}
                                    direction="auto"
                                    className={`w-full ${sessionActive ? 'opacity-50 pointer-events-none' : ''}`}
                                />
                            </div>
                            <div className="min-w-[160px]">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{t('professor.qrRefreshEvery')}</label>
                                <GlassDropdown
                                    value={String(qrRefreshSeconds)}
                                    onChange={(v) => setQrRefreshSeconds(parseInt(v, 10) || 10)}
                                    options={[
                                        { value: '5',  label: t('ta.seconds5'),  icon: 'ph-arrows-clockwise' },
                                        { value: '10', label: t('ta.seconds10'), icon: 'ph-arrows-clockwise' },
                                        { value: '15', label: t('ta.seconds15'), icon: 'ph-arrows-clockwise' },
                                        { value: '20', label: t('ta.seconds20'), icon: 'ph-arrows-clockwise' },
                                        { value: '30', label: t('ta.seconds30'), icon: 'ph-arrows-clockwise' },
                                    ]}
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                        {/* QR Side */}
                        <div className="flex flex-col items-center gap-4">
                            <div className="bg-black/30 p-6 rounded-2xl border border-white/5">
                                <QRDisplay
                                    qrData={currentQR}
                                    onRefresh={fetchQR}
                                    isRefreshing={isRefreshing}
                                    refreshSeconds={qrRefreshSeconds}
                                />
                            </div>
                            {sessionStartedMessage && (
                                <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold px-4 py-2.5 rounded-xl w-full justify-center">
                                    <i className="ph-bold ph-check-circle text-base"></i>
                                    {sessionStartedMessage}
                                </div>
                            )}
                        </div>
                        {/* Info Side */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-sm">
                                <i className="ph-bold ph-map-trifold text-green-500"></i>
                                <span className="text-gray-500 dark:text-gray-400">{t('ta.gpsStatusLabel')}</span>
                                <span className="text-green-500 font-semibold">{t('ta.gpsEnabledStatus')}</span>
                            </div>
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
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={handleStartSession}
                                    disabled={sessionActive || isStarting || !selectedCourse}
                                    className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                                        sessionActive || isStarting || !selectedCourse
                                            ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                                            : 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90 shadow-lg shadow-purple-500/20'
                                    }`}
                                >
                                    <i className={`ph-bold ${isStarting ? 'ph-spinner animate-spin' : 'ph-play'}`}></i>
                                    {isStarting ? t('ta.startingBtn') : t('ta.startSessionBtn')}
                                </button>
                                <button
                                    onClick={handleEndSession}
                                    disabled={!sessionActive}
                                    className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all border ${!sessionActive ? 'border-gray-500/20 text-gray-500 cursor-not-allowed' : 'border-white/20 dark:border-white/10 text-black dark:text-white hover:bg-white/10'}`}
                                >
                                    <i className="ph-bold ph-stop"></i> {t('ta.endSessionBtn')}
                                </button>
                            </div>
                            {startError && (
                                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold px-4 py-2.5 rounded-xl w-full">
                                    <i className="ph-bold ph-warning-circle text-base"></i>
                                    {startError}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </AnimateOnView>

            {/* Manual mark roster — staff can flip a student between
                present / late / absent / excused without QR. Shared
                component with the Professor surface so both stay in
                lock-step. */}
            <AnimateOnView delay={0.15} enabled={false}>
                <AttendanceRoster sessionId={sessionId} courseCode={selectedCourse} />
            </AnimateOnView>

            {/* Bottom Row: Historical + Export */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                {/* Historical Chart */}
                <AnimateOnView delay={0.2} enabled={false} className="xl:col-span-2">
                    <div className={`${glassCardStyle} p-4 sm:p-6`}>
                        {/* Stack title + course dropdown vertically on
                            mobile so the dropdown doesn't squeeze the
                            "Historical Attendance" heading. */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
                            <h3 className="text-black dark:text-white text-lg sm:text-xl font-bold">{t('ta.historicalAttendance')}</h3>
                            <div className="w-full sm:w-auto sm:min-w-[180px]">
                                <GlassDropdown
                                    value={selectedCourse}
                                    onChange={setSelectedCourse}
                                    options={
                                        coursesLoading || courses.length === 0
                                            ? [{ value: '', label: coursesLoading ? t('staff.loading') : t('ta.noCoursesAssigned') }]
                                            : courses.map((c) => ({ value: c, label: c, icon: 'ph-book-open' }))
                                    }
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                        </div>
                        <AttendanceChart data={weeklyData} />
                        <div className="flex items-center justify-center gap-2 mt-4">
                            <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-[#5A2AD4] to-[#7B5AFF]"></div>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{t('ta.attendancePercentage')}</span>
                        </div>
                    </div>
                </AnimateOnView>

                {/* Export */}
                <AnimateOnView delay={0.3} enabled={false}>
                    <div className={`${glassCardStyle} p-6`}>
                        <h3 className="text-black dark:text-white text-xl font-bold mb-2">{t('ta.exportData')}</h3>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">{t('ta.exportDataDesc')}</p>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('ta.startDate')}</label>
                                <input type="date" value={exportStart} onChange={e => setExportStart(e.target.value)} className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('ta.endDate')}</label>
                                <input type="date" value={exportEnd} onChange={e => setExportEnd(e.target.value)} className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50" />
                            </div>
                            <button onClick={handleExport} className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-3 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-sm flex items-center justify-center gap-2">
                                <i className="ph-bold ph-download"></i>
                                {t('ta.exportToExcel')}
                            </button>
                        </div>
                    </div>
                </AnimateOnView>
            </div>
        </div>
    );
};

export default TAAttendance;
