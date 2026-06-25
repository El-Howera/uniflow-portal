import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { useRegistration } from '../../context/RegistrationContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

/**
 * SeatsBlock — single-row occupancy indicator for a section type.
 *
 *   ≤ 50%   → green   (open)
 *   50–80%  → yellow  (filling)
 *   80–99%  → orange  (almost full)
 *   = 100%  → red     (FULL pill)
 *
 * Used twice per course card: once for the lecture roster, once for the lab
 * roster. Lecture and lab capacities are tracked independently in the DB
 * (CourseSection.capacity per row) so they get their own bars here.
 */
const SeatsRow: React.FC<{ label: string; icon: string; enrolled: number; capacity: number }> = ({ label, icon, enrolled, capacity }) => {
    const pct = capacity > 0 ? Math.min(100, Math.round((enrolled / capacity) * 100)) : 0;
    const isFull = enrolled >= capacity;
    const remaining = Math.max(0, capacity - enrolled);
    let level: 'open' | 'filling' | 'almost' | 'full' = 'open';
    if (isFull) level = 'full';
    else if (pct >= 80) level = 'almost';
    else if (pct >= 50) level = 'filling';

    const tone = {
        open:    { bar: 'bg-green-500',  text: 'text-green-600 dark:text-green-400',   chipBg: 'bg-green-500/15 border-green-500/30',   chipText: 'text-green-600 dark:text-green-300',  label: 'Open' },
        filling: { bar: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', chipBg: 'bg-yellow-500/15 border-yellow-500/30', chipText: 'text-yellow-700 dark:text-yellow-300', label: 'Filling' },
        almost:  { bar: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', chipBg: 'bg-orange-500/15 border-orange-500/30', chipText: 'text-orange-600 dark:text-orange-300', label: 'Almost full' },
        full:    { bar: 'bg-red-500',    text: 'text-red-600 dark:text-red-400',       chipBg: 'bg-red-500/15 border-red-500/30',       chipText: 'text-red-600 dark:text-red-300',       label: 'FULL' },
    }[level];

    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                    <i className={`ph-bold ${icon} ${tone.text} text-sm`}></i>
                    <span className="font-semibold text-black dark:text-white text-[11px] uppercase tracking-wider">
                        {label}
                    </span>
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${tone.chipBg} ${tone.chipText}`}>
                    {tone.label}
                </span>
            </div>
            <div className="flex items-center gap-2.5">
                <div className="flex-1 h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                        className={`h-full ${tone.bar} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                    ></div>
                </div>
                <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${tone.text}`}>
                    {enrolled}/{capacity}
                </span>
            </div>
            <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-1 ml-0.5">
                {isFull
                    ? 'Full — no seats remaining'
                    : `${remaining} seat${remaining === 1 ? '' : 's'} left · ${pct}% occupied`}
            </p>
        </div>
    );
};

/**
 * SeatsBlock — wraps one or two SeatsRow children (lecture + optional lab).
 * Renders nothing when neither side has capacity data.
 */
const SeatsBlock: React.FC<{
    lecture: { enrolled: number; capacity: number } | null;
    lab: { enrolled: number; capacity: number } | null;
}> = ({ lecture, lab }) => {
    if (!lecture && !lab) return null;
    return (
        <div className="bg-white/30 dark:bg-[#0d0d0d] p-3 rounded-xl border border-white/50 dark:border-[#363636] space-y-3">
            {lecture && (
                <SeatsRow
                    label="Lecture seats"
                    icon="ph-chalkboard-teacher"
                    enrolled={lecture.enrolled}
                    capacity={lecture.capacity}
                />
            )}
            {lab && (
                <SeatsRow
                    label="Lab seats"
                    icon="ph-flask"
                    enrolled={lab.enrolled}
                    capacity={lab.capacity}
                />
            )}
        </div>
    );
};

const Courses: React.FC = () => {
    const { searchTerm } = useAppContext();
    const { registeredCourses, isLoading, fetchRegistrations } = useRegistration();
    const navigate = useNavigate();
    const t = useT();

    // First-login race fix — RegistrationProvider's auto-fetch at boot
    // runs with userId='' (localStorage hasn't been written yet), so the
    // initial registrations call returns empty. The provider DOES refetch
    // after AppContext updates (userId changes → useCallback invalidates),
    // but Courses can mount during that brief window and freeze on the
    // empty-state CTA before the refetch resolves. Re-firing here on
    // mount makes Courses self-sufficient — mirrors what Registrations.tsx
    // already does. Idempotent + cheap (the context dedupes via isLoading).
    React.useEffect(() => {
        fetchRegistrations();
    }, [fetchRegistrations]);

    // Build display data from registered courses.
    //
    // The backend returns one Registration row per section, so a course with
    // both lecture and lab arrives as TWO entries with the same courseCode.
    // Group by courseCode and bucket each row's section into the lecture or
    // lab slot — otherwise the page renders two half-empty cards per course.
    // Translation keys captured outside the memo so the dependency array can
    // include `t` without dragging in the whole context object.
    const tbaLabel = t('coursesPage.tba');
    const lectureLabel = t('coursesPage.lecture');
    const labLabel = t('coursesPage.lab');

    const coursesData = useMemo(() => {
        // Format slot list as e.g. "Tue 11:30 AM, Thu 9:00 AM"
        const formatSlots = (slots: { day: string; start: string; end: string }[] | undefined) => {
            if (!slots || slots.length === 0) return '';
            return slots.map(s => {
                const [h, m] = s.start.split(':').map(Number);
                const ampm = h >= 12 ? 'PM' : 'AM';
                const displayH = h % 12 || 12;
                return `${s.day.slice(0, 3)} ${displayH}:${m < 10 ? '0' + m : m} ${ampm}`;
            }).join(', ');
        };

        type Section = NonNullable<typeof registeredCourses[number]['section']>;
        const byCourse = new Map<string, {
            courseCode: string;
            title: string;
            credits: number;
            lecture: Section | null;
            lab: Section | null;
            // True when ANY underlying registration row is held for SA review with
            // pendingReason === 'level_below_course'. Promoted up to the course
            // card so the student sees one unified status, not one chip per section.
            levelGatePending: boolean;
        }>();

        for (const reg of registeredCourses) {
            const key = reg.courseCode;
            if (!byCourse.has(key)) {
                byCourse.set(key, {
                    courseCode: reg.courseCode,
                    title: reg.courseName,
                    credits: reg.credits,
                    lecture: null,
                    lab: null,
                    levelGatePending: false,
                });
            }
            const entry = byCourse.get(key)!;
            const sectionType = reg.section?.type || '';
            if (sectionType.toLowerCase().includes('lab')) {
                entry.lab = reg.section ?? null;
            } else {
                // Lecture / Tutorial / Seminar / unknown all go to the lecture slot
                entry.lecture = reg.section ?? null;
            }
            // Backend tags pending rows with `pendingReason='level_below_course'`
            // when the student's level is below the course's level. The whole
            // registration (lecture + lab) shares one verdict, so any tagged row
            // flips the card.
            if (reg.status === 'pending' && reg.pendingReason === 'level_below_course') {
                entry.levelGatePending = true;
            }
        }

        // Prefix the displayed name with the role label that matches the
        // section type so students see "Prof. Sara Hassan" (lecture) vs
        // "TA Karim Salah" (lab). Backend stores just the name; the prefix
        // is purely presentational.
        const withRole = (name: string | undefined | null, role: 'prof' | 'ta'): string => {
            if (!name) return tbaLabel;
            return role === 'prof' ? `Prof. ${name}` : `TA ${name}`;
        };

        return Array.from(byCourse.values()).map(({ courseCode, title, credits, lecture, lab, levelGatePending }) => {
            // Seats are tracked per CourseSection in the DB. Lecture and lab
            // run independent rosters (a 60-seat lecture may split into 4×15
            // labs), so we surface BOTH bars on the card. Each side returns
            // null when its capacity numbers are missing so the UI can hide
            // that row gracefully.
            const lectureSeats = (lecture?.capacity != null && lecture?.enrolled != null)
                ? { capacity: lecture.capacity ?? 0, enrolled: lecture.enrolled ?? 0 }
                : null;
            const labSeats = (lab?.capacity != null && lab?.enrolled != null)
                ? { capacity: lab.capacity ?? 0, enrolled: lab.enrolled ?? 0 }
                : null;
            return {
                courseCode,
                title,
                credits,
                lectureInstructor: withRole(lecture?.instructor, 'prof'),
                lectureLabel,
                labInstructor: lab?.instructor ? withRole(lab.instructor, 'ta') : null,
                labLabel,
                lectureSchedule: formatSlots(lecture?.slots),
                labSchedule: formatSlots(lab?.slots),
                lectureLocation: lecture?.location || '',
                labLocation: lab?.location || '',
                hasLab: !!lab,
                levelGatePending,
                lectureSeats,
                labSeats,
            };
        });
    }, [registeredCourses, tbaLabel, lectureLabel, labLabel]);

    const filteredCourses = coursesData.filter(course => {
        const matchesSearch = course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            course.courseCode.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
    });

    return (
        <div className="flex-1 pb-16">
            <AnimateOnView>
                <div className="flex justify-between items-end mb-6">
                    <div>
                        <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('coursesPage.title')}</h2>
                        <p className="text-gray-600 dark:text-gray-400">
                            {coursesData.length > 0
                                ? t(coursesData.length === 1 ? 'coursesPage.enrolledCount' : 'coursesPage.enrolledCountPlural', { n: coursesData.length })
                                : t('coursesPage.emptyHint')
                            }
                        </p>
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className={`${glassCardStyle} p-6 animate-pulse`}>
                            <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
                            <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/4 mb-6"></div>
                            <div className="space-y-3">
                                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-full"></div>
                                <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-2/3"></div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : filteredCourses.length === 0 ? (
                <AnimateOnView delay={0.1}>
                    <div className={`${glassCardStyle} p-12 text-center`}>
                        <i className="ph-bold ph-books text-6xl text-gray-400 dark:text-gray-600 mb-4 block"></i>
                        <h3 className="text-xl font-bold text-gray-600 dark:text-gray-400 mb-2">
                            {searchTerm ? t('coursesPage.noMatch') : t('coursesPage.noCourses')}
                        </h3>
                        <p className="text-gray-500 dark:text-gray-500 text-sm mb-6">
                            {searchTerm
                                ? t('coursesPage.tryDifferent')
                                : t('coursesPage.headToRegistration')
                            }
                        </p>
                        {!searchTerm && (
                            <button
                                onClick={() => navigate('/student/registrations')}
                                className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white py-3 px-6 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
                            >
                                <i className="ph-bold ph-plus mr-2"></i>
                                {t('coursesPage.registerCta')}
                            </button>
                        )}
                    </div>
                </AnimateOnView>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCourses.map((course, index) => (
                        <AnimateOnView key={course.courseCode} delay={index * 0.1}>
                            <div className={`${glassCardStyle} p-6 flex flex-col h-full hover:-translate-y-1 transition-transform duration-200`}>
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <h3 className="text-black dark:text-white font-bold text-xl mb-1">{course.title}</h3>
                                        <p className="text-[#6A3FF4] font-medium text-sm">{course.courseCode}</p>
                                    </div>
                                    <span className="text-xs font-bold px-3 py-1 rounded-full border bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30">
                                        {t('coursesPage.creditsLabel', { n: course.credits })}
                                    </span>
                                </div>

                                {course.levelGatePending && (
                                    // Amber pending banner — fires when the row is a pending
                                    // SA review with pendingReason === 'level_below_course'.
                                    // Backend now surfaces `pendingReason` / `pendingNote`
                                    // on GET /api/registrations/:userId; see
                                    // RegistrationContext.fetchRegistrations for the
                                    // regression-probe console.warn that fires only when
                                    // those fields are missing.
                                    <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                        <i className="ph-bold ph-clock text-amber-400 mt-0.5"></i>
                                        <div className="flex-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                                {t('registrationsPage.awaitingSaApproval')}
                                            </span>
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                                                {t('registrationsPage.levelGateCardNote')}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3 text-gray-600 dark:text-gray-400 text-sm mb-6 flex-grow">
                                    <div className="bg-white/30 dark:bg-[#0d0d0d] p-3 rounded-xl border border-white/50 dark:border-[#363636]">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <i className="ph-bold ph-chalkboard-teacher text-[#6A3FF4]"></i>
                                            <span className="font-semibold text-black dark:text-white text-xs uppercase tracking-wider">{course.lectureLabel}</span>
                                        </div>
                                        <div className="flex items-center gap-2 ml-5">
                                            <i className="ph-bold ph-user w-4 text-center text-gray-500"></i>
                                            <span>{course.lectureInstructor}</span>
                                        </div>
                                        {course.lectureSchedule && (
                                            <div className="flex items-center gap-2 ml-5 mt-1">
                                                <i className="ph-bold ph-clock w-4 text-center text-gray-500"></i>
                                                <span className="text-xs">{course.lectureSchedule}</span>
                                            </div>
                                        )}
                                    </div>

                                    {course.hasLab && (
                                        <div className="bg-white/30 dark:bg-[#0d0d0d] p-3 rounded-xl border border-white/50 dark:border-[#363636]">
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <i className="ph-bold ph-flask text-[#A855F7]"></i>
                                                <span className="font-semibold text-black dark:text-white text-xs uppercase tracking-wider">{course.labLabel}</span>
                                            </div>
                                            <div className="flex items-center gap-2 ml-5">
                                                <i className="ph-bold ph-user w-4 text-center text-gray-500"></i>
                                                <span>{course.labInstructor || t('coursesPage.tba')}</span>
                                            </div>
                                            {course.labSchedule && (
                                                <div className="flex items-center gap-2 ml-5 mt-1">
                                                    <i className="ph-bold ph-clock w-4 text-center text-gray-500"></i>
                                                    <span className="text-xs">{course.labSchedule}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {((course.lectureSeats && course.lectureSeats.capacity > 0) ||
                                      (course.labSeats && course.labSeats.capacity > 0)) && (
                                        <SeatsBlock
                                            lecture={course.lectureSeats && course.lectureSeats.capacity > 0 ? course.lectureSeats : null}
                                            lab={course.labSeats && course.labSeats.capacity > 0 ? course.labSeats : null}
                                        />
                                    )}
                                </div>

                                <div className="flex flex-col gap-3 mt-auto">
                                    <button onClick={() => navigate(`/student/view-course/${course.courseCode}`)}
                                        className="bg-white/50 dark:bg-[#0d0d0d] text-black dark:text-white py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:bg-gray-300/50 dark:hover:bg-[#2d2d2d] transition-colors border border-gray-300/50 dark:border-[#2d2d2d]">
                                        <i className="ph-bold ph-eye text-lg"></i>
                                        {t('coursesPage.viewCourse')}
                                    </button>

                                    <button
                                        onClick={() => navigate(`/student/chatroom/${course.courseCode}`)}
                                        className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
                                    >
                                        <i className="ph-bold ph-chat-dots text-lg"></i>
                                        {t('coursesPage.chatroom')}
                                    </button>
                                </div>
                            </div>
                        </AnimateOnView>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Courses;
