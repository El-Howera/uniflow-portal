import React, { useState, useMemo, useEffect } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { generateTimetablePDF, TimetableData } from '../../utils/pdfGenerator';
import { useRegistration } from '../../context/RegistrationContext';
import { useT } from '../../i18n';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';

// NOTE: Schedule data comes entirely from getScheduleForTimetable() which queries registered courses
// from the database. If student has no registrations, scheduleData will be an empty array
// and page will show "No Courses Registered" message. No mock data is used.

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

// Course color palette - different colors for each course
// Course code palette retired in favor of type-based coloring (Lecture
// green, Lab orange) — see getCardStyle() inside the component below.

// Map between full day names (used by Schedule Policy + DB) and the 3-letter
// labels the timetable visually uses. Order matches a typical Sat-Fri week.
const DAY_ORDER: Array<{ short: string; full: string }> = [
    { short: 'Sat', full: 'Saturday' },
    { short: 'Sun', full: 'Sunday' },
    { short: 'Mon', full: 'Monday' },
    { short: 'Tue', full: 'Tuesday' },
    { short: 'Wed', full: 'Wednesday' },
    { short: 'Thu', full: 'Thursday' },
    { short: 'Fri', full: 'Friday' },
];

// Module-scope so the reference is stable across renders and useMemo deps
// don't have to include it (which would also trigger an exhaustive-deps warning).
const FULL_TO_SHORT: Record<string, string> = {
    Saturday: 'Sat', Sunday: 'Sun', Monday: 'Mon', Tuesday: 'Tue',
    Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri',
};

interface SchedulePolicy {
    workingDays: string[];
    slotMinutes: number;
    dayStart: string;
    dayEnd: string;
}

const POLICY_FALLBACK: SchedulePolicy = {
    workingDays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    slotMinutes: 60,
    dayStart: '08:00',
    dayEnd: '20:00',
};

const Timetable: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [mobileSelectedDay, setMobileSelectedDay] = useState<string | null>(null);
    const { getScheduleForTimetable } = useRegistration();
    const t = useT();

    // Pull the schedule grid scoped to this student (department + level).
    // The /me endpoint applies any per-(dept, level) slot-length override
    // the admin saved in the Timetable page → these students see the
    // matching slot length automatically. Falls back to /api/public-settings
    // (then to the FCDS default) if /me/schedule-grid is unreachable.
    const [policy, setPolicy] = useState<SchedulePolicy>(POLICY_FALLBACK);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            // Primary: scoped grid from /api/me/schedule-grid.
            try {
                const res = await fetch(`${API_URLS.userProfile()}/api/me/schedule-grid`, {
                    credentials: 'include',
                    headers: authHeaders(),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (cancelled || !data?.grid) return;
                    setPolicy({
                        workingDays: Array.isArray(data.grid.workingDays) && data.grid.workingDays.length
                            ? data.grid.workingDays
                            : POLICY_FALLBACK.workingDays,
                        slotMinutes: Number.isInteger(data.grid.slotMinutes) ? data.grid.slotMinutes : POLICY_FALLBACK.slotMinutes,
                        dayStart: data.grid.dayStart || POLICY_FALLBACK.dayStart,
                        dayEnd: data.grid.dayEnd || POLICY_FALLBACK.dayEnd,
                    });
                    return;
                }
            } catch { /* fall through to public-settings */ }

            // Fallback: top-level policy from /api/public-settings.
            try {
                const res = await fetch(`${API_URLS.userProfile()}/api/public-settings`, { credentials: 'include' });
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled || !data?.schedulePolicy) return;
                setPolicy({
                    workingDays: Array.isArray(data.schedulePolicy.workingDays) && data.schedulePolicy.workingDays.length
                        ? data.schedulePolicy.workingDays
                        : POLICY_FALLBACK.workingDays,
                    slotMinutes: Number.isInteger(data.schedulePolicy.slotMinutes) ? data.schedulePolicy.slotMinutes : POLICY_FALLBACK.slotMinutes,
                    dayStart: data.schedulePolicy.dayStart || POLICY_FALLBACK.dayStart,
                    dayEnd: data.schedulePolicy.dayEnd || POLICY_FALLBACK.dayEnd,
                });
            } catch { /* keep fallback */ }
        })();
        return () => { cancelled = true; };
    }, []);

    // Derive the day columns + time-slot rows from the policy. Days keep
    // their Sat→Fri visual order but only working days are rendered.
    const days: string[] = useMemo(() => {
        const workingFullSet = new Set(policy.workingDays);
        const cols = DAY_ORDER.filter((d) => workingFullSet.has(d.full)).map((d) => d.short);
        // Fall back to all 7 columns if the policy isn't readable yet so
        // the grid renders something sensible during first paint.
        return cols.length > 0 ? cols : DAY_ORDER.map((d) => d.short);
    }, [policy.workingDays]);

    const fullDays: Record<string, string> = useMemo(() => {
        const map: Record<string, string> = {};
        for (const d of DAY_ORDER) map[d.short] = d.full;
        return map;
    }, []);

    // Time slots are evenly spaced by policy.slotMinutes from policy.dayStart
    // to policy.dayEnd. Rebuilt whenever the policy changes.
    const timeSlots: string[] = useMemo(() => {
        const toMin = (s: string) => {
            const [h, m] = s.split(':').map(Number);
            return h * 60 + m;
        };
        const fromMin = (n: number) => {
            const h = Math.floor(n / 60);
            const m = n % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        const start = toMin(policy.dayStart);
        const end = toMin(policy.dayEnd);
        if (start >= end || policy.slotMinutes <= 0) return ['08:00'];
        const out: string[] = [];
        for (let t = start; t < end; t += policy.slotMinutes) out.push(fromMin(t));
        return out;
    }, [policy]);

    const ROW_HEIGHT = 100;

    // Get schedule data - ONLY show registered courses, empty array if none
    const scheduleData = useMemo(() => {
      return getScheduleForTimetable();
    }, [getScheduleForTimetable]);

    const handleExportPDF = () => {
        const studentName = localStorage.getItem('currentUserFirstName') || 'Student';
        const studentLastName = localStorage.getItem('currentUserLastName') || '';
        const fullName = `${studentName} ${studentLastName}`.trim();

        const timetableData: TimetableData = {
            studentName: fullName,
            semester: 'Spring 2026',
            slots: scheduleData.map(session => ({
                day: fullDays[session.day] || session.day,
                time: session.startTime,
                course: `${session.courseCode} - ${session.title}`,
                instructor: session.instructor ?? '',
                room: session.location ?? ''
            }))
        };
        generateTimetablePDF(timetableData);
    };

    const getSaturdayOfWeek = (d: Date) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = (day + 1) % 7;
        const sat = new Date(date);
        sat.setDate(date.getDate() - diff);
        return sat;
    };

    const formatDateRange = (d: Date) => {
        const start = getSaturdayOfWeek(d);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}, ${start.getFullYear()}`;
    };

    const changeWeek = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        setCurrentDate(newDate);
    };

    const getBlockPosition = (timeStr: string) => {
        // First try exact match
        const index = timeSlots.indexOf(timeStr);
        if (index !== -1) return index * ROW_HEIGHT;

        // If no exact match, find the closest time slot
        const parseTime = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };

        const targetMinutes = parseTime(timeStr);
        let closestIndex = 0;
        let closestDiff = Math.abs(parseTime(timeSlots[0]) - targetMinutes);

        for (let i = 1; i < timeSlots.length; i++) {
            const diff = Math.abs(parseTime(timeSlots[i]) - targetMinutes);
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = i;
            }
        }

        return closestIndex * ROW_HEIGHT;
    };

    const formatDisplayTime = (time: string) => {
        const [h, m] = time.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 || 12;
        return `${displayH}:${m < 10 ? '0'+m : m} ${ampm}`;
    };

    // Type-based palette — Lecture green, Lab orange. Mirrors the admin
    // timetable so a glance tells you what the cell is.
    //
    // Text color is mode-split: dark mode uses the light-tinted shade
    // (green-200 / orange-200) which reads well on the dark backdrop;
    // light mode uses the deep shade (green-800 / orange-800) which
    // gives proper contrast on the pale glass card.
    const getCardStyle = (type: string) => {
        if (type === 'Lecture') {
            return 'bg-green-500/15 border-green-500/60 text-green-800 dark:text-green-200';
        }
        if (type === 'Lab') {
            return 'bg-orange-500/15 border-orange-500/60 text-orange-800 dark:text-orange-200';
        }
        return 'bg-[#6A3FF4]/15 border-[#6A3FF4]/60 text-[#5A2AD4] dark:text-[#bda8ff]';
    };

    // Build the (day, snapped-startTime) cell index once. Snapping uses the
    // existing getBlockPosition, then converted back to a HH:MM key from
    // timeSlots so the lookup matches the column header exactly.
    const cellIndex = new Map<string, typeof scheduleData>();
    for (const ev of scheduleData) {
        const fullDay = Object.entries(FULL_TO_SHORT).find(([, s]) => s === ev.day)?.[0] ?? ev.day;
        const topPos = getBlockPosition(ev.startTime);
        if (topPos < 0) continue;
        const rowIdx = Math.round(topPos / ROW_HEIGHT);
        const snapStart = timeSlots[Math.min(rowIdx, timeSlots.length - 1)];
        if (!snapStart) continue;
        const k = `${fullDay}|${snapStart}`;
        const list = cellIndex.get(k) ?? [];
        list.push(ev);
        cellIndex.set(k, list);
    }
    const slotEnd = (i: number): string => {
        if (i + 1 < timeSlots.length) return timeSlots[i + 1];
        return policy.dayEnd;
    };

    const DAY_COL_WIDTH = 80;
    const TIME_COL_MIN_WIDTH = 140;

    // ---- Mobile-only derivations ----
    // Group events per working day for the agenda view. Sort by start time
    // so the day list reads top-to-bottom in chronological order.
    const eventsByDay = useMemo(() => {
        const map = new Map<string, typeof scheduleData>();
        for (const ev of scheduleData) {
            const fullDay = Object.entries(FULL_TO_SHORT).find(([, s]) => s === ev.day)?.[0] ?? ev.day;
            const list = map.get(fullDay) ?? [];
            list.push(ev);
            map.set(fullDay, list);
        }
        for (const list of map.values()) {
            list.sort((a, b) => a.startTime.localeCompare(b.startTime));
        }
        return map;
    }, [scheduleData]);

    // Working-day full names in calendar order so the day picker matches
    // the desktop grid (Sat → Fri filtered to policy.workingDays).
    const mobileDayList: string[] = useMemo(() => {
        return Object.keys(FULL_TO_SHORT).filter((full) => days.includes(FULL_TO_SHORT[full]));
    }, [days]);

    // Default the day picker to today when today is a working day,
    // otherwise to the first day that actually has events, otherwise
    // to the first working day. Re-pick whenever the working set or
    // event list changes.
    useEffect(() => {
        if (mobileDayList.length === 0) return;
        const todayFull = new Date().toLocaleDateString('en-US', { weekday: 'long' });
        if (mobileSelectedDay && mobileDayList.includes(mobileSelectedDay)) return;
        if (mobileDayList.includes(todayFull)) {
            setMobileSelectedDay(todayFull);
            return;
        }
        const firstWithEvents = mobileDayList.find((d) => (eventsByDay.get(d) ?? []).length > 0);
        setMobileSelectedDay(firstWithEvents ?? mobileDayList[0]);
    }, [mobileDayList, eventsByDay, mobileSelectedDay]);

    // Derive a visual end-time for an agenda event by mapping its start to
    // the closest slot row and reading slotEnd(i) — mirrors the desktop
    // grid so the displayed range matches what students see on web.
    const agendaEndTime = (startTime: string): string => {
        const topPos = getBlockPosition(startTime);
        const rowIdx = Math.round(topPos / ROW_HEIGHT);
        return slotEnd(Math.min(rowIdx, timeSlots.length - 1));
    };

    return (
        <div className="flex flex-col pb-24">
            <AnimateOnView>
                <div className="mb-6">
                    <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('timetablePage.title')}</h2>
                    <p className="text-gray-600 dark:text-gray-400">{t('timetablePage.subtitle')}</p>
                </div>
            </AnimateOnView>

            <AnimateOnView delay={0.1}>
                <div className={`${glassCardStyle} flex flex-col overflow-x-hidden`}>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 p-4 sm:p-6 border-b border-gray-300/50 dark:border-[#2d2d2d]">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                            <div className="flex flex-shrink-0 bg-white/30 dark:bg-black/20 backdrop-blur-lg rounded-lg p-1 border border-white/20 dark:border-white/10 shadow-lg">
                                <button onClick={() => changeWeek('prev')} aria-label={t('timetablePage.prevWeek')} className="p-2 hover:bg-gray-300/50 dark:hover:bg-[#2d2d2d] rounded-md transition-colors text-black dark:text-white">
                                    <i className="ph-bold ph-caret-left text-lg"></i>
                                </button>
                                <button onClick={() => changeWeek('next')} aria-label={t('timetablePage.nextWeek')} className="p-2 hover:bg-gray-300/50 dark:hover:bg-[#2d2d2d] rounded-md transition-colors text-black dark:text-white">
                                    <i className="ph-bold ph-caret-right text-lg"></i>
                                </button>
                            </div>
                            <h2 className="text-base sm:text-xl font-bold text-black dark:text-white truncate">{formatDateRange(currentDate)}</h2>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                            <button
                                onClick={() => setCurrentDate(new Date())}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-[#6A3FF4] px-3 sm:px-4 py-2 rounded-lg font-semibold text-white hover:bg-[#5833CD] transition-colors shadow-lg shadow-purple-500/20 text-xs sm:text-sm"
                            >
                                <i className="ph-bold ph-calendar"></i>
                                This Week
                            </button>
                            <button
                                onClick={handleExportPDF}
                                aria-label={t('gpaCalculatorPage.exportPdf')}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white/50 dark:bg-[#262626] border border-gray-300/50 dark:border-[#363636] px-3 sm:px-4 py-2 rounded-lg font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-[#363636] transition-colors text-xs sm:text-sm"
                            >
                                <i className="ph-bold ph-file-pdf"></i>
                                <span>{t('gpaCalculatorPage.exportPdf')}</span>
                            </button>
                        </div>
                    </div>

                    {/* Mobile (<lg): day picker + per-day agenda. The
                        desktop grid below is 12+ time-slot columns wide
                        and unreadable on a phone, so on small screens we
                        flip to a vertical list grouped by day. */}
                    <div className="lg:hidden">
                        {/* Day picker — horizontally scrollable pills, only
                            renders working days. Active pill in brand purple. */}
                        <div className="px-4 pt-4 pb-3 border-b border-gray-300/30 dark:border-[#2d2d2d]/30">
                            <div className="flex gap-2 overflow-x-auto scrollbar-hidden -mx-1 px-1">
                                {mobileDayList.map((fullDay) => {
                                    const short = FULL_TO_SHORT[fullDay];
                                    const count = (eventsByDay.get(fullDay) ?? []).length;
                                    const active = mobileSelectedDay === fullDay;
                                    return (
                                        <button
                                            key={fullDay}
                                            onClick={() => setMobileSelectedDay(fullDay)}
                                            className={`flex-shrink-0 flex flex-col items-center justify-center min-w-[64px] px-3 py-2 rounded-xl border transition-colors ${
                                                active
                                                    ? 'bg-[#6A3FF4] border-[#6A3FF4] text-white shadow-md shadow-[#6A3FF4]/30'
                                                    : 'bg-white/40 dark:bg-black/20 border-white/20 dark:border-white/10 text-black dark:text-gray-300 hover:bg-white/60 dark:hover:bg-black/40'
                                            }`}
                                        >
                                            <span className="text-xs font-bold leading-none">{short}</span>
                                            <span className={`text-[10px] mt-1 leading-none ${active ? 'text-white/80' : 'text-gray-500 dark:text-gray-500'}`}>
                                                {count === 0 ? '—' : count === 1 ? '1 class' : `${count} classes`}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Agenda for selected day. Each card mirrors a desktop
                            grid cell's content + adds the time range up top so
                            students can read the schedule top-to-bottom. */}
                        <div className="p-4 space-y-3">
                            {mobileSelectedDay && (eventsByDay.get(mobileSelectedDay) ?? []).length === 0 && (
                                <div className="text-center py-10 text-gray-500 dark:text-gray-400 text-sm">
                                    <i className="ph ph-coffee text-3xl block mb-2 opacity-60"></i>
                                    No classes scheduled for {mobileSelectedDay}.
                                </div>
                            )}
                            {mobileSelectedDay && (eventsByDay.get(mobileSelectedDay) ?? []).map((event) => {
                                const sectionLabel = event.sectionLabel
                                    || (event.type === 'Lecture' ? 'L' : event.type === 'Lab' ? 'S' : '');
                                const endTime = agendaEndTime(event.startTime);
                                return (
                                    <div
                                        key={event.id}
                                        className={`rounded-xl border-l-4 px-3 py-3 ${getCardStyle(event.type)}`}
                                    >
                                        <div className="flex justify-between items-start gap-2 mb-1">
                                            <div className="font-bold text-sm leading-tight min-w-0 flex-1 break-words">
                                                {event.courseCode} · {event.title}
                                            </div>
                                            <span className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded bg-black/10 dark:bg-white/10">
                                                {event.type}{sectionLabel ? ` · ${sectionLabel}` : ''}
                                            </span>
                                        </div>
                                        <div className="text-xs font-semibold opacity-90 mb-1">
                                            {formatDisplayTime(event.startTime)} – {formatDisplayTime(endTime)}
                                        </div>
                                        {event.location && (
                                            <div className="text-xs opacity-80 flex items-center gap-1">
                                                <i className="ph-bold ph-door-open" />
                                                <span className="truncate">{event.location}</span>
                                            </div>
                                        )}
                                        {event.instructor && (
                                            <div className="text-xs opacity-75 flex items-center gap-1">
                                                <i className={`ph-bold ${event.type === 'Lab' ? 'ph-graduation-cap' : 'ph-chalkboard-teacher'}`} />
                                                <span className="truncate">{event.instructor}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Flipped grid: days on the left as rows, time slots
                        on top as columns. Mirrors /admin/timetable. Hidden
                        on mobile in favour of the day-picker agenda above. */}
                    <div
                        className="hidden lg:flex flex-col overflow-x-auto scrollbar-hidden"
                        style={{ minWidth: '100%' }}
                    >
                        {/* Header row — corner + each time-slot column with start / end */}
                        <div
                            className="flex sticky top-0 z-20 bg-white/10 dark:bg-[#1a1a1a] border-b border-gray-300/50 dark:border-[#2d2d2d]"
                            style={{ minWidth: DAY_COL_WIDTH + timeSlots.length * TIME_COL_MIN_WIDTH }}
                        >
                            <div
                                className="flex-shrink-0 border-r border-gray-300/50 dark:border-[#2d2d2d]"
                                style={{ width: DAY_COL_WIDTH }}
                            />
                            {timeSlots.map((time, i) => (
                                <div
                                    key={time}
                                    className="flex-1 border-r border-gray-300/50 dark:border-[#2d2d2d] text-center py-2"
                                    style={{ minWidth: TIME_COL_MIN_WIDTH }}
                                >
                                    <div className="text-xs font-bold text-black dark:text-gray-300">
                                        {formatDisplayTime(time)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-500">
                                        –{formatDisplayTime(slotEnd(i))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* One row per working day */}
                        {Object.keys(FULL_TO_SHORT)
                            .filter((full) => days.includes(FULL_TO_SHORT[full]))
                            .map((fullDay) => (
                                <div
                                    key={fullDay}
                                    className="flex border-b border-gray-300/30 dark:border-[#2d2d2d]/30"
                                    style={{ minWidth: DAY_COL_WIDTH + timeSlots.length * TIME_COL_MIN_WIDTH }}
                                >
                                    <div
                                        className="flex-shrink-0 sticky left-0 z-10 bg-white/10 dark:bg-[#1a1a1a] border-r border-gray-300/50 dark:border-[#2d2d2d] flex items-center justify-center font-bold text-black dark:text-gray-300"
                                        style={{ width: DAY_COL_WIDTH, height: ROW_HEIGHT }}
                                    >
                                        {FULL_TO_SHORT[fullDay]}
                                    </div>
                                    {timeSlots.map((slot) => {
                                        const cellKey = `${fullDay}|${slot}`;
                                        const occupants = cellIndex.get(cellKey) ?? [];
                                        return (
                                            <div
                                                key={cellKey}
                                                className="flex-1 border-r border-gray-300/30 dark:border-[#2d2d2d]/30 bg-white/5 dark:bg-[#0d0d0d]/50"
                                                style={{ minWidth: TIME_COL_MIN_WIDTH, height: ROW_HEIGHT }}
                                            >
                                                <div className="flex flex-col h-full p-1 gap-1">
                                                    {occupants.map((event) => {
                                                        // Per-event display: course code · course name ·
                                                        // section label on top; hall on the second line;
                                                        // prof / TA on the third. The card height adapts
                                                        // when 2+ events share the cell — `flex-1` splits
                                                        // the vertical space evenly + truncate keeps long
                                                        // names from spilling.
                                                        const sectionLabel = event.sectionLabel
                                                            || (event.type === 'Lecture' ? 'L' : event.type === 'Lab' ? 'S' : '');
                                                        return (
                                                        <div
                                                            key={event.id}
                                                            title={`${event.courseCode} · ${event.title} · ${sectionLabel}\n${event.location || ''}\n${event.instructor || ''}`}
                                                            className={`flex-1 min-h-0 rounded border-l-[3px] px-1.5 py-1 text-xs cursor-default hover:brightness-110 transition-all shadow-sm flex flex-col justify-center select-none overflow-hidden ${getCardStyle(event.type)}`}
                                                        >
                                                            <div className="font-bold truncate text-[11px] leading-tight">
                                                                {event.courseCode} · {event.title} · {sectionLabel}
                                                            </div>
                                                            {event.location && (
                                                                <div className="truncate opacity-80 text-[9px] leading-tight mt-0.5">
                                                                    <i className="ph-bold ph-door-open mr-0.5" />{event.location}
                                                                </div>
                                                            )}
                                                            {event.instructor && (
                                                                <div className="truncate opacity-75 text-[9px] leading-tight">
                                                                    <i className={`ph-bold ${event.type === 'Lab' ? 'ph-graduation-cap' : 'ph-chalkboard-teacher'} mr-0.5`} />{event.instructor}
                                                                </div>
                                                            )}
                                                        </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                    </div>

                    {/* Empty state message — desktop only; the mobile agenda
                        renders its own per-day empty state above. */}
                    {scheduleData.length === 0 && (
                        <div className="hidden lg:flex absolute inset-0 items-center justify-center bg-white/50 dark:bg-black/50 backdrop-blur-sm z-40">
                            <div className="text-center p-8">
                                <i className="ph-bold ph-calendar-blank text-6xl text-gray-400 dark:text-gray-600 mb-4"></i>
                                <h3 className="text-xl font-bold text-gray-600 dark:text-gray-400 mb-2">{t('timetablePage.noEvents')}</h3>
                                <p className="text-gray-500 dark:text-gray-500 text-sm">
                                    Register for courses to see them appear on your timetable.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </AnimateOnView>
        </div>
    );
};

export default Timetable;
