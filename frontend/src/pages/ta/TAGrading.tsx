import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface Submission {
    id: string;
    studentId: string;
    studentName: string;
    studentEmail: string;
    courseCode: string;
    courseName: string;
    assignmentId: string;
    assignmentTitle: string;
    dueDate: string | null;
    maxScore: number;
    submittedAt: string;
    isLate: boolean;
    status: string;
    score: number | null;
    proposedScore: number | null;
    feedback: string;
    // local edit state
    gradeInput: string;
    feedbackInput: string;
}

const statusLabel = (s: Submission): 'Pending' | 'Graded' | 'Proposed' => {
    if (s.status === 'graded' && s.score != null) return 'Graded';
    if (s.status === 'pending_review') return 'Proposed';
    return 'Pending';
};

// --- Static preview data ---
const MOCK_SUBMISSIONS: Submission[] = [
    {
        id: 's1', studentId: 'st1', studentName: 'Omar Farouk', studentEmail: 'omar.farouk@uniflow.edu',
        courseCode: 'CS201', courseName: 'Data Structures', assignmentId: 'a1', assignmentTitle: 'Assignment 3 — Binary Search Trees',
        dueDate: '2026-04-12', maxScore: 100, submittedAt: '2026-04-11', isLate: false, status: 'submitted',
        score: null, proposedScore: null, feedback: '', gradeInput: '', feedbackInput: '',
    },
    {
        id: 's2', studentId: 'st2', studentName: 'Nour El-Din', studentEmail: 'nour.eldin@uniflow.edu',
        courseCode: 'MA205', courseName: 'Linear Algebra', assignmentId: 'a3', assignmentTitle: 'Problem Set 2 — Eigenvectors',
        dueDate: '2026-04-15', maxScore: 100, submittedAt: '2026-04-16', isLate: true, status: 'pending_review',
        score: null, proposedScore: 82, feedback: 'Good work overall, recheck Q4.', feedbackInput: 'Good work overall, recheck Q4.', gradeInput: '',
    },
    {
        id: 's3', studentId: 'st3', studentName: 'Yara Mahmoud', studentEmail: 'yara.mahmoud@uniflow.edu',
        courseCode: 'CS201', courseName: 'Data Structures', assignmentId: 'a2', assignmentTitle: 'Lab 5 — Graph Traversal',
        dueDate: '2026-04-20', maxScore: 50, submittedAt: '2026-04-19', isLate: false, status: 'graded',
        score: 46, proposedScore: 46, feedback: 'Excellent — clean BFS implementation.', feedbackInput: 'Excellent — clean BFS implementation.', gradeInput: '',
    },
    {
        id: 's4', studentId: 'st4', studentName: 'Ziad Tarek', studentEmail: 'ziad.tarek@uniflow.edu',
        courseCode: 'CS101', courseName: 'Intro to Programming', assignmentId: 'a4', assignmentTitle: 'Assignment 1 — Control Flow',
        dueDate: '2026-04-10', maxScore: 100, submittedAt: '2026-04-09', isLate: false, status: 'submitted',
        score: null, proposedScore: null, feedback: '', gradeInput: '', feedbackInput: '',
    },
    {
        id: 's5', studentId: 'st5', studentName: 'Salma Adel', studentEmail: 'salma.adel@uniflow.edu',
        courseCode: 'CS101', courseName: 'Intro to Programming', assignmentId: 'a4', assignmentTitle: 'Assignment 1 — Control Flow',
        dueDate: '2026-04-10', maxScore: 100, submittedAt: '2026-04-10', isLate: false, status: 'graded',
        score: 91, proposedScore: 91, feedback: 'Very thorough, well documented.', feedbackInput: 'Very thorough, well documented.', gradeInput: '',
    },
];

const SubmissionCard: React.FC<{
    submission: Submission;
    onGradeChange: (id: string, grade: string) => void;
    onFeedbackChange: (id: string, feedback: string) => void;
    onSubmitGrade: (id: string) => void;
    onDelete: (id: string, reason: string) => void;
}> = ({ submission, onGradeChange, onFeedbackChange, onSubmitGrade, onDelete }) => {
    const t = useT();
    const label = statusLabel(submission);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteReason, setDeleteReason] = useState('');
    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`${glassCardStyle} p-6`}>
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    {/* Initials avatar — no third-party random faces. */}
                    <div
                        className="w-10 h-10 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        aria-label={submission.studentName}
                    >
                        {(submission.studentName || '?')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((s) => s.charAt(0).toUpperCase())
                            .join('')}
                    </div>
                    <div>
                        <h4 className="text-black dark:text-white font-bold text-sm">{submission.courseName} — {submission.assignmentTitle}</h4>
                        <p className="text-gray-500 dark:text-gray-400 text-xs">{submission.studentName}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {submission.isLate && (
                        <span className="text-[10px] font-bold text-red-500 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <i className="ph-bold ph-warning"></i> {t('ta.lateLabel')}
                        </span>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        label === 'Graded'   ? 'text-green-500 bg-green-500/10 border-green-500/30' :
                        label === 'Proposed' ? 'text-blue-500 bg-blue-500/10 border-blue-500/30' :
                                              'text-yellow-500 bg-yellow-500/10 border-yellow-500/30'
                    }`}>
                        {label === 'Graded' ? t('ta.gradedLabelStatus') : label === 'Proposed' ? t('ta.proposedLabelStatus') : t('ta.pendingLabelStatus')}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-4">
                <i className="ph-bold ph-calendar text-[#6A3FF4]"></i>
                <span>{t('ta.submissionLabel')} {new Date(submission.submittedAt).toLocaleDateString()}</span>
                {submission.dueDate && (
                    <span className="text-gray-400">· {t('ta.dueShortLabel')} {new Date(submission.dueDate).toLocaleDateString()}</span>
                )}
                <span className="text-gray-400">· {t('ta.maxPtsLabel', { n: submission.maxScore })}</span>
            </div>

            {submission.score != null && (
                <div className="mb-3 text-xs text-green-500 font-medium">
                    {t('ta.currentGradeLabel', { score: submission.score, max: submission.maxScore })}
                </div>
            )}
            {submission.proposedScore != null && submission.status === 'pending_review' && (
                <div className="mb-3 text-xs text-blue-400 font-medium">
                    {t('ta.proposedAwaitingProfessor', { score: submission.proposedScore, max: submission.maxScore })}
                </div>
            )}

            <div className="mb-3">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                    {t('ta.proposedGradeOutOfLabel', { max: submission.maxScore })}
                </label>
                <input
                    type="number"
                    min={0}
                    max={submission.maxScore}
                    value={submission.gradeInput}
                    onChange={e => onGradeChange(submission.id, e.target.value)}
                    placeholder={submission.proposedScore != null ? String(submission.proposedScore) : t('ta.enterGradePlaceholder')}
                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-all"
                />
            </div>
            <div className="mb-4">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">{t('ta.feedbackLabelLong')}</label>
                <textarea
                    value={submission.feedbackInput}
                    onChange={e => onFeedbackChange(submission.id, e.target.value)}
                    placeholder={t('ta.addDetailedFeedbackPlaceholder')}
                    rows={3}
                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-all resize-y"
                />
            </div>
            <div className="flex flex-wrap gap-2 justify-between items-center">
                {!confirmDelete ? (
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="px-3 py-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 text-xs font-bold transition-colors flex items-center gap-1.5"
                        title={t('ta.deleteSubmissionTooltip')}
                    >
                        <i className="ph-bold ph-trash"></i> {t('ta.deleteSubmissionBtn')}
                    </button>
                ) : (
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                        <input
                            type="text"
                            value={deleteReason}
                            onChange={e => setDeleteReason(e.target.value)}
                            placeholder={t('ta.reasonOptionalPlaceholder')}
                            className="flex-1 min-w-[200px] bg-white/5 dark:bg-black/20 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
                        />
                        <button
                            onClick={() => {
                                onDelete(submission.id, deleteReason);
                                setConfirmDelete(false);
                                setDeleteReason('');
                            }}
                            className="px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold flex items-center gap-1.5"
                        >
                            <i className="ph-bold ph-check"></i> {t('ta.confirmDeleteBtn')}
                        </button>
                        <button
                            onClick={() => { setConfirmDelete(false); setDeleteReason(''); }}
                            className="px-3 py-2 rounded-xl border border-white/20 text-gray-500 hover:bg-white/5 text-xs font-bold"
                        >
                            {t('ta.cancelBtn')}
                        </button>
                    </div>
                )}
                <button
                    onClick={() => onSubmitGrade(submission.id)}
                    disabled={!submission.gradeInput || confirmDelete}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold text-xs hover:opacity-90 disabled:opacity-40 transition-opacity shadow-lg shadow-purple-500/20"
                >
                    {t('ta.proposeGrade')}
                </button>
            </div>
        </motion.div>
    );
};

type FilterType = 'All' | 'Pending' | 'Graded';

const TAGrading: React.FC = () => {
    const t = useT();
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [filter, setFilter] = useState<FilterType>('All');
    const [courseFilter, setCourseFilter] = useState<string>('all');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // MVP build — populate from static mock data, no backend calls.
        setSubmissions(MOCK_SUBMISSIONS.map(s => ({ ...s, gradeInput: '', feedbackInput: s.feedback ?? '' })));
        setIsLoading(false);
    }, []);

    const pendingCount = submissions.filter(s => statusLabel(s) !== 'Graded').length;
    const gradedCount  = submissions.filter(s => statusLabel(s) === 'Graded').length;
    const graded       = submissions.filter(s => s.score != null);
    const avgGrade     = graded.length > 0
        ? Math.round(graded.reduce((acc, s) => acc + (s.score! / s.maxScore) * 100, 0) / graded.length)
        : 0;

    // Course filter source — derived from the TA's actual loaded list.
    const courseOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const s of submissions) {
            if (!seen.has(s.courseCode)) seen.set(s.courseCode, s.courseName);
        }
        return [
            { value: 'all', label: t('ta.allCoursesFilter'), icon: 'ph-stack' },
            ...[...seen.entries()].map(([code, name]) => ({
                value: code,
                label: `${code} — ${name}`,
                icon: 'ph-book-open',
            })),
        ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submissions]);

    const filtered = submissions.filter(s => {
        if (courseFilter !== 'all' && s.courseCode !== courseFilter) return false;
        if (filter === 'Pending') return statusLabel(s) !== 'Graded';
        if (filter === 'Graded')  return statusLabel(s) === 'Graded';
        return true;
    });

    const handleGradeChange    = (id: string, grade: string)    => setSubmissions(prev => prev.map(s => s.id === id ? { ...s, gradeInput: grade } : s));
    const handleFeedbackChange = (id: string, feedback: string) => setSubmissions(prev => prev.map(s => s.id === id ? { ...s, feedbackInput: feedback } : s));

    const handleDeleteSubmission = (id: string, _reason: string) => {
        // MVP build — local-only delete.
        setSubmissions(prev => prev.filter(s => s.id !== id));
    };

    const handleSubmitGrade = (id: string) => {
        // MVP build — local-only grade proposal.
        const sub = submissions.find(s => s.id === id);
        if (!sub?.assignmentId || !sub.studentId || !sub.courseCode || !sub.gradeInput) return;
        const score = parseFloat(sub.gradeInput);
        if (isNaN(score)) return;
        setSubmissions(prev => prev.map(s => s.id === id
            ? { ...s, proposedScore: score, status: 'pending_review', gradeInput: '' }
            : s
        ));
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.gradingTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('ta.gradingPageSubtitle')}</p>
            </AnimateOnView>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                    { label: t('ta.pendingReviewLabel'), value: pendingCount, icon: 'ph-clipboard-text', color: 'bg-yellow-500/20', iconColor: 'text-yellow-500', note: t('ta.awaitingYourGrade') },
                    { label: t('ta.gradedLabelStatus'),         value: gradedCount,  icon: 'ph-check-circle',   color: 'bg-green-500/20',  iconColor: 'text-green-500',  note: t('ta.gradedSoFar') },
                    { label: t('ta.averageGradeLabel'),  value: avgGrade > 0 ? `${avgGrade}%` : t('ta.naLabel'), icon: 'ph-chart-bar', color: 'bg-[#6A3FF4]/20', iconColor: 'text-[#6A3FF4]', note: t('ta.acrossAllGraded') },
                ].map((stat, i) => (
                    <AnimateOnView key={stat.label} delay={0.1 + i * 0.05} enabled={false}>
                        <ParticleCard className={`${glassCardStyle} p-5`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={8} glowColor="132, 0, 255">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center`}>
                                    <i className={`ph-fill ${stat.icon} text-xl ${stat.iconColor}`}></i>
                                </div>
                                <div>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{stat.label}</p>
                                    <p className="text-2xl font-bold text-black dark:text-white">{isLoading ? '—' : stat.value}</p>
                                    <p className="text-[10px] text-gray-500">{stat.note}</p>
                                </div>
                            </div>
                        </ParticleCard>
                    </AnimateOnView>
                ))}
            </div>

            <AnimateOnView delay={0.25} enabled={false}>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="min-w-[220px]">
                        <GlassDropdown
                            value={courseFilter}
                            onChange={setCourseFilter}
                            options={courseOptions}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
                        {(['All', 'Pending', 'Graded'] as const).map(f => (
                            <button key={f} onClick={() => setFilter(f)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors relative ${filter !== f ? 'text-black dark:text-gray-300' : 'text-white'}`}>
                                {filter === f && <motion.div layoutId="activeTAGradingFilter" className="absolute inset-0 bg-[#6A3FF4] rounded-md shadow-lg" transition={{ type: 'spring', stiffness: 300, damping: 25 }} />}
                                <span className="relative z-10">{f === 'All' ? t('ta.allFilter') : f === 'Pending' ? t('ta.pendingFilter') : t('ta.gradedFilter')}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="text-center py-20"><i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i></div>
            ) : (
                <div className="space-y-4">
                    <AnimatePresence mode="popLayout">
                        {filtered.map((submission, i) => (
                            <AnimateOnView key={submission.id} delay={0.3 + i * 0.03} enabled={false}>
                                <SubmissionCard
                                    submission={submission}
                                    onGradeChange={handleGradeChange}
                                    onFeedbackChange={handleFeedbackChange}
                                    onSubmitGrade={handleSubmitGrade}
                                    onDelete={handleDeleteSubmission}
                                />
                            </AnimateOnView>
                        ))}
                    </AnimatePresence>
                    {filtered.length === 0 && (
                        <div className={`${glassCardStyle} p-12 text-center`}>
                            <i className="ph-bold ph-clipboard-text text-4xl text-gray-400 mb-3 block"></i>
                            <p className="text-gray-500">{filter === 'All' ? t('ta.noSubmissionsFoundAll') : t('ta.noSubmissionsFoundFilter', { filter: filter === 'Pending' ? t('ta.pendingFilter') : t('ta.gradedFilter') })}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TAGrading;
