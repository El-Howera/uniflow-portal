import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- Interfaces ---
interface EnrollmentRequest {
    id: string;
    userId?: string;
    courseId?: string;
    user: {
        firstName: string;
        lastName: string;
        email: string;
        odId: string;
    };
    course: {
        id?: string;
        code: string;
        title: string;
        credits?: number;
    };
    section?: {
        id?: string;
        sectionId?: string;
        type?: string;
    };
    status: string;
    createdAt: string;
    /**
     * Hydrated by `GET /api/sa/registrations/pending`. When the row is held
     * for SA review because the course's level is above the student's level,
     * the backend tags it `'level_below_course'` with a free-text note
     * (e.g. "Course level is 3, your level is 2"). Null = ordinary review.
     * Forward-compat: any other string is rendered as a neutral chip.
     */
    pendingReason?: string | null;
    pendingNote?: string | null;
}

// One card per (student × course). Multiple section rows from the backend
// collapse into one of these so SA approves the whole course in one click.
interface PendingCourseGroup {
    key: string;          // `${userId}::${courseId}`
    seedId: string;       // any registration id; backend processes all siblings
    user: EnrollmentRequest['user'];
    course: EnrollmentRequest['course'];
    sections: { id: string; type: string; sectionId: string }[];
    earliestCreatedAt: string;
    pendingReason: string | null;
    pendingNote: string | null;
}

interface CourseCapacity {
    id: string;
    code: string;
    title: string;
    enrolled: number;
    capacity: number;
}

type Decision = 'approve' | 'reject';

// Collapse the per-section pending registrations into one card per
// (student × course). Multiple section rows for the same course share the
// same userId+courseId — we group and pick the earliest createdAt as the
// card's submission date. The seed id can be any of the row ids; the
// backend approve handler processes every sibling for the (user, course).
function groupRequestsByCourse(rows: EnrollmentRequest[]): PendingCourseGroup[] {
    const map = new Map<string, PendingCourseGroup>();
    for (const r of rows) {
        const userId = r.userId || r.user?.email || '';
        const courseId = r.courseId || r.course?.id || r.course?.code || '';
        if (!userId || !courseId) continue;
        const key = `${userId}::${courseId}`;
        const existing = map.get(key);
        const sectionEntry = r.section
            ? {
                  id: r.section.id || r.id,
                  type: (r.section.type || 'Section'),
                  sectionId: r.section.sectionId || '',
              }
            : { id: r.id, type: 'Section', sectionId: '' };
        if (existing) {
            existing.sections.push(sectionEntry);
            if (new Date(r.createdAt).getTime() < new Date(existing.earliestCreatedAt).getTime()) {
                existing.earliestCreatedAt = r.createdAt;
                existing.seedId = r.id;
            }
            // Promote the most informative pending reason to the group level.
            if (!existing.pendingReason && r.pendingReason) {
                existing.pendingReason = r.pendingReason;
                existing.pendingNote = r.pendingNote || null;
            }
        } else {
            map.set(key, {
                key,
                seedId: r.id,
                user: r.user,
                course: r.course,
                sections: [sectionEntry],
                earliestCreatedAt: r.createdAt,
                pendingReason: r.pendingReason || null,
                pendingNote: r.pendingNote || null,
            });
        }
    }
    return Array.from(map.values()).sort(
        (a, b) => new Date(a.earliestCreatedAt).getTime() - new Date(b.earliestCreatedAt).getTime(),
    );
}

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_REQUESTS: EnrollmentRequest[] = [
    {
        id: 'reg-101', userId: 'stu-001', courseId: 'cs301',
        user: { firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.edu', odId: 'CS-2024-0042' },
        course: { id: 'cs301', code: 'CS301', title: 'Algorithms & Data Structures', credits: 3 },
        section: { id: 'sec-cs301-lec', sectionId: 'L1', type: 'Lecture' },
        status: 'pending', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), pendingReason: null, pendingNote: null,
    },
    {
        id: 'reg-102', userId: 'stu-001', courseId: 'cs301',
        user: { firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.edu', odId: 'CS-2024-0042' },
        course: { id: 'cs301', code: 'CS301', title: 'Algorithms & Data Structures', credits: 3 },
        section: { id: 'sec-cs301-lab', sectionId: 'S2', type: 'Lab' },
        status: 'pending', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), pendingReason: null, pendingNote: null,
    },
    {
        id: 'reg-103', userId: 'stu-003', courseId: 'cs420',
        user: { firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.edu', odId: 'CYS-2025-0118' },
        course: { id: 'cs420', code: 'CS420', title: 'Advanced Cryptography', credits: 3 },
        section: { id: 'sec-cs420-lec', sectionId: 'L1', type: 'Lecture' },
        status: 'pending', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        pendingReason: 'level_below_course', pendingNote: 'Course level is 4, your level is 2',
    },
    {
        id: 'reg-104', userId: 'stu-006', courseId: 'ds210',
        user: { firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.edu', odId: 'DS-2025-0203' },
        course: { id: 'ds210', code: 'DS210', title: 'Statistical Foundations', credits: 3 },
        section: { id: 'sec-ds210-lec', sectionId: 'L2', type: 'Lecture' },
        status: 'pending', createdAt: new Date(Date.now() - 6 * 3600000).toISOString(), pendingReason: null, pendingNote: null,
    },
];

const MOCK_COURSES: CourseCapacity[] = [
    { id: 'cs301', code: 'CS301', title: 'Algorithms & Data Structures', enrolled: 142, capacity: 160 },
    { id: 'ma205', code: 'MA205', title: 'Linear Algebra', enrolled: 98, capacity: 120 },
    { id: 'cs340', code: 'CS340', title: 'Database Systems', enrolled: 155, capacity: 160 },
    { id: 'cs420', code: 'CS420', title: 'Advanced Cryptography', enrolled: 40, capacity: 40 },
    { id: 'ds210', code: 'DS210', title: 'Statistical Foundations', enrolled: 76, capacity: 100 },
    { id: 'ai330', code: 'AI330', title: 'Neural Networks', enrolled: 88, capacity: 90 },
];

// --- Helper Components ---
const CapacityBar: React.FC<{ enrolled: number; capacity: number }> = ({ enrolled, capacity }) => {
    const pct = (enrolled / capacity) * 100;
    const color = pct >= 100 ? 'from-red-500 to-red-400' : pct >= 85 ? 'from-amber-500 to-amber-400' : 'from-[#7B5AFF] to-[#5A2AD4]';
    return (
        <div className="w-full h-1.5 bg-white/10 dark:bg-black/20 rounded-full overflow-hidden">
            <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(pct, 100)}%` }} className={`h-full bg-gradient-to-r ${color} rounded-full`} />
        </div>
    );
};

const SAEnrollment: React.FC = () => {
    const t = useT();
    const [requests, setRequests] = useState<EnrollmentRequest[]>([]);
    const [courses, setCourses] = useState<CourseCapacity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'requests' | 'courses'>('requests');
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setRequests(MOCK_REQUESTS);
        setCourses(MOCK_COURSES);
        setIsLoading(false);
    }, []);

    const handleDecision = async (id: string, decision: Decision) => {
        setPendingId(id);
        setActionMsg(null);
        // MVP build: optimistic local removal of all sibling rows for the
        // same (user, course); no backend.
        setRequests((prev) => {
            const seed = prev.find((r) => r.id === id);
            if (!seed) return prev.filter((r) => r.id !== id);
            const userId = seed.userId || seed.user?.email;
            const courseId = seed.courseId || seed.course?.id || seed.course?.code;
            return prev.filter((r) => {
                const ru = r.userId || r.user?.email;
                const rc = r.courseId || r.course?.id || r.course?.code;
                return !(ru === userId && rc === courseId);
            });
        });
        setActionMsg({
            kind: 'success',
            text: decision === 'approve' ? t('sa.registrationApproved') : t('sa.registrationRejected')
        });
        setPendingId(null);
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-3xl font-bold mb-1">{t('sa.enrollmentTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.enrollmentPageSubtitle')}</p>
            </AnimateOnView>

            <AnimatePresence>
                {actionMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`${glassCardStyle} px-4 py-3 flex items-center justify-between gap-3 ${
                            actionMsg.kind === 'success' ? 'border-green-500/30' : 'border-red-500/30'
                        }`}
                    >
                        <div className={`flex items-center gap-2 text-sm font-semibold ${
                            actionMsg.kind === 'success' ? 'text-green-400' : 'text-red-400'
                        }`}>
                            <i className={`ph-bold ${actionMsg.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}`}></i>
                            {actionMsg.text}
                        </div>
                        <button onClick={() => setActionMsg(null)} className="text-gray-500 hover:text-white text-xs">
                            <i className="ph-bold ph-x"></i>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={`${glassCardStyle} p-1 flex w-fit`}>
                {(['requests', 'courses'] as const).map(tab => {
                    const tabLabel = tab === 'requests' ? t('sa.requestsTabSa') : t('sa.coursesTabSa');
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-6 py-2 rounded-xl text-sm font-bold capitalize transition-all ${
                                activeTab === tab ? 'bg-[#6A3FF4] text-white shadow-lg' : 'text-gray-500 hover:bg-white/5'
                            }`}
                        >
                            {tabLabel} {tab === 'requests' && `(${groupRequestsByCourse(requests).length})`}
                        </button>
                    );
                })}
            </div>

            <AnimatePresence mode="wait">
                {activeTab === 'requests' ? (
                    <motion.div key="reqs" className="space-y-4">
                        {isLoading ? (
                            [1, 2].map(i => <div key={i} className="h-24 w-full bg-white/5 animate-pulse rounded-2xl"></div>)
                        ) : (() => {
                            const groups = groupRequestsByCourse(requests);
                            if (groups.length === 0) {
                                return <div className={`${glassCardStyle} p-12 text-center text-gray-500`}>{t('sa.allProcessedLbl')}</div>;
                            }
                            return groups.map((g) => {
                                const reason = g.pendingReason;
                                const note = g.pendingNote;
                                // Above-level registration — student level <
                                // course level. The reason key is preserved for
                                // backend compatibility but the user-facing
                                // chip surfaces the new priority semantics:
                                // SA confirms after course-level students have
                                // first pick of the seats.
                                const isLevelGate = reason === 'level_below_course';
                                const chipClass = isLevelGate
                                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                    : 'bg-white/10 text-gray-300 border border-white/15';
                                const chipLabel = isLevelGate ? t('sa.aboveLevelChip') : reason;
                                const credits = g.course.credits ?? null;
                                const isBusy = pendingId === g.seedId;
                                return (
                                    <div key={g.key} className={`${glassCardStyle} p-5 flex items-start justify-between gap-4 flex-wrap`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-white font-bold">{g.user.firstName} {g.user.lastName}</p>
                                                {reason && (
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${chipClass}`}>
                                                        {chipLabel}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[#6A3FF4] text-xs font-bold uppercase mt-0.5">{g.course.code} — {g.course.title}</p>
                                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                                {g.sections.map((s) => (
                                                    <span key={s.id} className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-white/5 text-gray-400 border border-white/10">
                                                        {s.type}{s.sectionId ? ` · ${s.sectionId}` : ''}
                                                    </span>
                                                ))}
                                                {credits != null && (
                                                    <span className="text-[10px] text-gray-400">{credits} {t('sa.creditsAbbr')}</span>
                                                )}
                                            </div>
                                            {note && (
                                                <p className="text-gray-400 text-xs mt-1">{note}</p>
                                            )}
                                            <p className="text-gray-500 text-[10px] mt-1">{t('sa.submittedLblShort', { date: new Date(g.earliestCreatedAt).toLocaleDateString() })}</p>
                                        </div>
                                        <div className="flex gap-2 flex-shrink-0">
                                            <button
                                                onClick={() => handleDecision(g.seedId, 'reject')}
                                                disabled={isBusy}
                                                className="px-4 py-2 rounded-lg border border-red-500/30 text-red-500 text-xs font-bold hover:bg-red-500/10 disabled:opacity-50"
                                            >
                                                {isBusy ? '…' : t('sa.rejectBtn')}
                                            </button>
                                            <button
                                                onClick={() => handleDecision(g.seedId, 'approve')}
                                                disabled={isBusy}
                                                className="px-4 py-2 rounded-lg bg-green-500 text-white text-xs font-bold hover:opacity-90 disabled:opacity-50"
                                            >
                                                {isBusy ? '…' : t('sa.approveBtn')}
                                            </button>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </motion.div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {courses.map(c => (
                            <div key={c.id} className={`${glassCardStyle} p-6`}>
                                <div className="flex justify-between items-start mb-3">
                                    <h4 className="text-white font-bold">{c.code}</h4>
                                    <span className="text-[10px] font-bold text-gray-500">{c.enrolled}/{c.capacity}</span>
                                </div>
                                <p className="text-gray-400 text-xs mb-4 truncate">{c.title}</p>
                                <CapacityBar enrolled={c.enrolled} capacity={c.capacity} />
                            </div>
                        ))}
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SAEnrollment;
