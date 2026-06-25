import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Quiz,
    QuizSubmission,
    fetchQuizzes,
    fetchQuizDetail,
    submitQuiz
} from '../../utils/courseContentService';
import { API_URLS } from '@shared/config';
import { useAppContext } from '../../context/AppContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { renderMarkdown } from '../../components/MarkdownToolbar';
import { useT } from '../../i18n';

// --- STYLES ---
const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const glassInputStyle = "bg-white/5 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#6A3FF4]/50 transition-all text-black dark:text-white placeholder-gray-400";

// --- COMPONENTS ---

const QuizCard: React.FC<{ quiz: Quiz; onClick: () => void; submission?: QuizSubmission }> = ({ quiz, onClick, submission }) => {
    const isCompleted = !!submission;
    const isGraded = submission?.status === 'graded';
    // Schedule state — drives the badge + click-blocker. Re-evaluates on every
    // render so a card visible at start time auto-flips from "Scheduled" to
    // "Live" without a refresh.
    const now = Date.now();
    const startsAtMs = quiz.startsAt ? new Date(quiz.startsAt).getTime() : null;
    const endAtMs = startsAtMs != null
        ? startsAtMs + (quiz.timeLimit ?? 30) * 60 * 1000
        : null;
    const isScheduledFuture = startsAtMs != null && startsAtMs > now;
    const isScheduledLive = startsAtMs != null && endAtMs != null && now >= startsAtMs && now < endAtMs;
    const isScheduledClosed = startsAtMs != null && endAtMs != null && now >= endAtMs;
    const blocked = isScheduledFuture || isScheduledClosed || isCompleted;

    return (
        <motion.div
            whileHover={!blocked ? { scale: 1.01, y: -2 } : undefined}
            whileTap={!blocked ? { scale: 0.99 } : undefined}
            onClick={() => { if (!blocked) onClick(); }}
            className={`${glassCardStyle} p-5 transition-all group relative overflow-hidden ${
                blocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:border-[#6A3FF4]/50'
            }`}
        >
            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <i className="ph-fill ph-exam text-6xl text-[#6A3FF4]"></i>
            </div>

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-3">
                    <span className="text-xs font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-1 rounded-md">
                        {quiz.courseCode}
                    </span>
                    {isCompleted ? (
                        <span className={`text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 ${isGraded ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                            }`}>
                            {isGraded ? (
                                <><i className="ph-bold ph-check-circle"></i> Graded: {submission.totalScore}/{submission.maxPoints}</>
                            ) : (
                                <><i className="ph-bold ph-clock"></i> Pending Review</>
                            )}
                        </span>
                    ) : isScheduledFuture ? (
                        <span className="text-xs font-bold bg-[#6A3FF4]/10 text-[#6A3FF4] px-2 py-1 rounded-md flex items-center gap-1">
                            <i className="ph-bold ph-clock-countdown"></i> Starts {new Date(quiz.startsAt!).toLocaleString()}
                        </span>
                    ) : isScheduledLive ? (
                        <span className="text-xs font-bold bg-green-500/20 text-green-600 dark:text-green-400 px-2 py-1 rounded-md flex items-center gap-1 animate-pulse">
                            <i className="ph-bold ph-broadcast"></i> Live now
                        </span>
                    ) : isScheduledClosed ? (
                        <span className="text-xs font-bold bg-red-500/10 text-red-500 px-2 py-1 rounded-md flex items-center gap-1">
                            <i className="ph-bold ph-lock-key"></i> Window closed
                        </span>
                    ) : (
                        <span className="text-xs font-bold bg-gray-500/10 text-gray-500 px-2 py-1 rounded-md">
                            Not Started
                        </span>
                    )}
                </div>

                <h3 className="text-lg font-bold text-black dark:text-white mb-1">{quiz.title}</h3>
                <div className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-4">{renderMarkdown(quiz.description)}</div>

                <div className="flex items-center gap-4 text-xs text-gray-500 font-medium">
                    <span className="flex items-center gap-1">
                        <i className="ph-bold ph-clock"></i> {quiz.timeLimit} min
                    </span>
                    <span className="flex items-center gap-1">
                        <i className="ph-bold ph-list-numbers"></i> {quiz.questionCount || '?'} Questions
                    </span>
                    <span className="flex items-center gap-1">
                        <i className="ph-bold ph-calendar-blank"></i> Due {new Date(quiz.dueDate).toLocaleDateString()}
                    </span>
                </div>
            </div>
        </motion.div>
    );
};

const QuizTaker: React.FC<{ quizId: string; onBack: () => void }> = ({ quizId, onBack }) => {
    const t = useT();
    const [quiz, setQuiz] = useState<Quiz | null>(null);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submissionResult, setSubmissionResult] = useState<QuizSubmission | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    // Server-anchored window. `endAt` is computed once on mount and is the
    // single source of truth for the timer — leaving and coming back the
    // student rejoins to the same end moment, regardless of how many times
    // they bounce. Server clock skew is corrected via `clockOffsetMs` (set
    // from the difference between server-reported `serverNow` and our local
    // Date.now() at the moment of /start).
    const [startsAt, setStartsAt] = useState<Date | null>(null);
    const [endAt, setEndAt] = useState<Date | null>(null);
    const [clockOffsetMs, setClockOffsetMs] = useState(0);
    const [now, setNow] = useState<number>(Date.now());
    const [startError, setStartError] = useState<string | null>(null);

    // Mobile nav bar STAYS visible while taking the quiz — the bottom
    // scroll-padding on the submit wrapper leaves enough clearance for both
    // (per owner directive). Earlier revisions hid the bar via the
    // `html.uniflow-no-mobile-nav` class; that escape hatch is no longer
    // needed here.

    // Fetch quiz details + call /start to anchor the timer.
    useEffect(() => {
        const loadQuiz = async () => {
            const data = await fetchQuizDetail(quizId);
            if (!data) return;
            setQuiz(data);

            // Call /start so the server creates (or reuses) the in-progress
            // submission and tells us the canonical anchor + serverNow. This
            // is the trick that makes the timer survive a page leave: the
            // start time is server-side, not client-side state.
            const token = localStorage.getItem('authToken');
            try {
                const res = await fetch(
                    `${API_URLS.courseContent()}/api/quizzes/${quizId}/start`,
                    {
                        method: 'POST',
                        credentials: 'include',
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setStartError(body.error || 'Could not start quiz.');
                    return;
                }
                const body = await res.json() as {
                    success: boolean;
                    submission: { id: string; startedAt: string; status: string };
                    startsAt: string | null;
                    timeLimit: number;
                    serverNow: string;
                };

                const serverNowMs = new Date(body.serverNow).getTime();
                setClockOffsetMs(serverNowMs - Date.now());

                const timeLimitMs = (body.timeLimit ?? data.timeLimit ?? 30) * 60 * 1000;
                if (body.startsAt) {
                    const sa = new Date(body.startsAt);
                    setStartsAt(sa);
                    setEndAt(new Date(sa.getTime() + timeLimitMs));
                } else {
                    const sa = new Date(body.submission.startedAt);
                    setStartsAt(sa);
                    setEndAt(new Date(sa.getTime() + timeLimitMs));
                }
            } catch {
                setStartError('Could not start quiz (network error).');
            }
        };
        loadQuiz();
    }, [quizId]);

    // Tick once a second. We compute remaining time from `endAt - now` so
    // the value is correct on every render — no drift, no need to "recover"
    // after a tab freeze.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    // Server-corrected current time (handles user clock skew).
    const serverNow = now + clockOffsetMs;
    const timeLeft = endAt
        ? Math.max(0, Math.floor((endAt.getTime() - serverNow) / 1000))
        : 0;
    const isLockedBeforeStart = !!(startsAt && startsAt.getTime() > serverNow);
    const secondsUntilStart = startsAt
        ? Math.max(0, Math.floor((startsAt.getTime() - serverNow) / 1000))
        : 0;

    // Auto-submit once the window closes. Guarded by submissionResult so it
    // only fires once per attempt.
    useEffect(() => {
        if (!quiz || isSubmitting || submissionResult || !endAt) return;
        if (isLockedBeforeStart) return;
        if (timeLeft === 0 && endAt.getTime() <= serverNow) {
            executeSubmission(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft, endAt, isLockedBeforeStart]);

    const handleAnswerChange = (questionId: string, value: string) => {
        setAnswers(prev => ({ ...prev, [questionId]: value }));
    };

    const handleSubmitClick = () => {
        setShowConfirmModal(true);
    };

    const executeSubmission = async (auto = false) => {
        if (!quiz || isSubmitting) return;

        setShowConfirmModal(false);
        setIsSubmitting(true);

        try {
            const userId = 'current'; // API handles current user from JWT
            const result = await submitQuiz(quiz.id, userId, answers);

            if (result.success && result.submission) {
                setSubmissionResult(result.submission);
                // No local addNotification call here — the backend submit
                // handler fires a system notification through the project's
                // persistent push pipeline (DB row + Socket.io + FCM). The
                // student's NotificationContext picks it up over the socket
                // and the toast renders with the rich sender styling. Going
                // through the server also persists the notification, so it
                // appears later on the Notifications page and on the
                // student's phone if FCM is configured.
                return;
            }

            // Backend rejected the submission (e.g. window closed past the
            // grace period, or max attempts hit). Before this guard the
            // button stayed locked on "Submitting…" forever because the
            // code only handled the success path.
            if (auto) {
                // Auto-submit on timer expiry: don't bounce the student
                // back into the questions — synthesise a "time-expired"
                // result so the page transitions out of the taking view.
                // The backend has the canonical record (whatever it ended
                // up persisting on /start); this stub just unblocks the UI.
                const maxPoints = quiz.questions.reduce((s, q) => s + q.points, 0);
                setSubmissionResult({
                    id: 'auto-expired',
                    quizId: quiz.id,
                    userId: '',
                    courseCode: quiz.courseCode,
                    submittedAt: new Date().toISOString(),
                    answers: [],
                    totalScore: null,
                    maxPoints,
                    status: 'pending_review',
                });
            } else {
                alert('Your answers could not be submitted. Please try again.');
                setIsSubmitting(false);
            }
        } catch (error) {
            console.error('Submission failed', error);
            // Same auto-submit rule: don't strand the student on a hung
            // button when the timer is the trigger.
            if (auto) {
                const maxPoints = quiz.questions.reduce((s, q) => s + q.points, 0);
                setSubmissionResult({
                    id: 'auto-expired',
                    quizId: quiz.id,
                    userId: '',
                    courseCode: quiz.courseCode,
                    submittedAt: new Date().toISOString(),
                    answers: [],
                    totalScore: null,
                    maxPoints,
                    status: 'pending_review',
                });
            } else {
                alert('Failed to submit quiz. Please try again.');
                setIsSubmitting(false);
            }
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!quiz) return <div className="p-10 text-center">{t('quizzesPage.loadingQuiz')}</div>;

    // Quiz blocked: server rejected /start (e.g. window closed, max attempts).
    if (startError) {
        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors mb-4">
                    <i className="ph-bold ph-arrow-left"></i> {t('quizzesPage.backToQuizzes')}
                </button>
                <div className={`${glassCardStyle} p-8 text-center`}>
                    <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="ph-fill ph-warning-circle text-4xl text-red-500"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-black dark:text-white mb-2">{t('quizzesPage.unavailableTitle')}</h2>
                    <p className="text-gray-500 mb-2">{startError}</p>
                </div>
            </div>
        );
    }

    // Locked: scheduled quiz with startsAt still in the future.
    if (isLockedBeforeStart && startsAt) {
        const days = Math.floor(secondsUntilStart / 86400);
        const hrs = Math.floor((secondsUntilStart % 86400) / 3600);
        const mins = Math.floor((secondsUntilStart % 3600) / 60);
        const secs = secondsUntilStart % 60;
        const countdown = days > 0
            ? `${days}d ${hrs}h ${mins}m`
            : hrs > 0
              ? `${hrs}h ${mins}m ${secs}s`
              : `${mins}m ${secs}s`;
        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors mb-4">
                    <i className="ph-bold ph-arrow-left"></i> {t('quizzesPage.backToQuizzes')}
                </button>
                <div className={`${glassCardStyle} p-8 text-center`}>
                    <div className="w-20 h-20 bg-[#6A3FF4]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="ph-fill ph-clock-countdown text-4xl text-[#6A3FF4]"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-black dark:text-white mb-1">{quiz.title}</h2>
                    <p className="text-xs text-gray-500 mb-5">{quiz.courseCode}</p>
                    <p className="text-sm text-gray-500 mb-2">{t('quizzesPage.quizStartsAt')}</p>
                    <p className="text-lg font-bold text-black dark:text-white mb-4">
                        {startsAt.toLocaleString()}
                    </p>
                    <div className="inline-block bg-white/5 px-6 py-3 rounded-2xl border border-[#6A3FF4]/30">
                        <p className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">{t('quizzesPage.startsIn')}</p>
                        <p className="text-2xl font-mono font-bold text-[#6A3FF4]">{countdown}</p>
                    </div>
                    <p className="text-xs text-gray-500 mt-4 max-w-md mx-auto">
                        {t('quizzesPage.timerStartsHint', { min: quiz.timeLimit })}
                    </p>
                </div>
            </div>
        );
    }

    // RESULT VIEW
    if (submissionResult) {
        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors mb-4">
                    <i className="ph-bold ph-arrow-left"></i> {t('quizzesPage.backToQuizzes')}
                </button>

                <div className={`${glassCardStyle} p-8 text-center`}>
                    <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="ph-fill ph-check-circle text-4xl text-green-500"></i>
                    </div>
                    <h2 className="text-2xl font-bold text-black dark:text-white mb-2">{t('quizzesPage.submittedTitle')}</h2>
                    <p className="text-gray-500 mb-6">{t('quizzesPage.submittedThanks', { title: quiz.title })}</p>

                    <div className="inline-block bg-white/5 p-6 rounded-2xl border border-white/10 min-w-[200px]">
                        <p className="text-sm text-gray-400 uppercase font-bold tracking-wider mb-1">{t('quizzesPage.yourScore')}</p>
                        {submissionResult.status === 'graded' ? (
                            <p className="text-4xl font-bold text-[#6A3FF4]">
                                {submissionResult.totalScore} <span className="text-lg text-gray-500">/ {submissionResult.maxPoints}</span>
                            </p>
                        ) : (
                            <p className="text-xl font-bold text-yellow-500">{t('quizzesPage.pendingReview')}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // TAKING VIEW.
    // Progress bar walks from 0 → 100 across the FULL allotted window
    // (startsAt → endAt) so every student sees the same "60% elapsed" tick
    // at the same wall-clock moment, regardless of when they joined.
    const totalWindowSec = startsAt && endAt
        ? Math.max(1, Math.round((endAt.getTime() - startsAt.getTime()) / 1000))
        : (quiz.timeLimit * 60);
    const elapsedSec = Math.max(0, totalWindowSec - timeLeft);
    const progress = Math.min(100, (elapsedSec / totalWindowSec) * 100);

    return (
        <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className={`${glassCardStyle} p-4 mb-6 flex justify-between items-center sticky top-0 z-20`}>
                <div className="min-w-0 flex-1 pr-3">
                    <h2 className="text-lg font-bold text-black dark:text-white truncate">{quiz.title}</h2>
                    <p className="text-xs text-gray-500">{quiz.courseCode}</p>
                </div>
                <div className={`flex-shrink-0 px-4 py-2 rounded-xl font-mono font-bold text-lg ${timeLeft < 60 ? 'bg-red-500/20 text-red-500' : 'bg-[#6A3FF4]/10 text-[#6A3FF4]'}`}>
                    {formatTime(timeLeft)}
                </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-white/10 h-1.5 rounded-full mb-6 overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ ease: "linear", duration: 1 }}
                    className="h-full bg-[#6A3FF4]"
                />
            </div>

            {/* Questions */}
            <div className="space-y-8">
                {quiz.questions.map((q, index) => (
                    <div key={q.id} className={`${glassCardStyle} p-6`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="text-md font-bold text-black dark:text-white flex gap-3">
                                <span className="bg-[#6A3FF4]/10 text-[#6A3FF4] w-6 h-6 rounded flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                                    {index + 1}
                                </span>
                                <div className="flex-1 min-w-0">{renderMarkdown(q.text)}</div>
                            </div>
                            <span className="text-xs font-semibold text-gray-500 bg-white/10 px-2 py-1 rounded">
                                {q.points} pts
                            </span>
                        </div>

                        {q.type === 'mcq' && q.options ? (
                            <div className="space-y-3 pl-9">
                                {q.options.map((option) => (
                                    <label
                                        key={option}
                                        className={`flex items-center p-3 rounded-xl border cursor-pointer transition-all ${answers[q.id] === option
                                            ? 'bg-[#6A3FF4]/10 border-[#6A3FF4] text-[#6A3FF4]'
                                            : 'bg-white/5 border-transparent hover:bg-white/10 text-gray-300'
                                            }`}
                                    >
                                        <input
                                            type="radio"
                                            name={`q-${q.id}`}
                                            value={option}
                                            checked={answers[q.id] === option}
                                            onChange={() => handleAnswerChange(q.id, option)}
                                            className="hidden"
                                        />
                                        <div className={`w-4 h-4 rounded-full border-2 mr-3 flex items-center justify-center ${answers[q.id] === option ? 'border-[#6A3FF4]' : 'border-gray-500'
                                            }`}>
                                            {answers[q.id] === option && <div className="w-2 h-2 bg-[#6A3FF4] rounded-full" />}
                                        </div>
                                        {option}
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <div className="pl-9">
                                <textarea
                                    className={`${glassInputStyle} w-full min-h-[120px] resize-none`}
                                    placeholder={t('quizzesPage.typeAnswerHere')}
                                    value={answers[q.id] || ''}
                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Submit — on desktop (`lg:`) the wrapper is `sticky bottom-0`
                so the button stays glued to the bottom of the viewport while
                the student scrolls through questions, with a glass backdrop
                that fades the questions passing behind it. On mobile it's a
                plain block at the end of the page (no sticky, no float) per
                owner directive — the mobile nav bar is already hidden while
                QuizTaker is mounted so there's no overlap to dodge. */}
            {/* Mobile bottom space: `safe-bottom` (env inset, custom utility)
                AND `pb-24` both set padding-bottom, so they overwrite each
                other in the cascade — only the later one wins, effectively
                killing the 96 px gap I wanted. Tailwind arbitrary value
                folds both values into a single padding-bottom declaration
                so they actually stack. `lg:pb-0` correctly overrides on
                desktop because they're the same CSS property + same
                specificity, source-ordered by breakpoint. */}
            <div className="mt-8 pb-[calc(max(env(safe-area-inset-bottom,0px),34px)+8rem)] lg:pb-0 lg:sticky lg:bottom-0 lg:-mx-8 lg:px-8 lg:py-3 lg:bg-gradient-to-t lg:from-white lg:via-white/95 lg:to-transparent lg:dark:from-[#0D0D0D] lg:dark:via-[#0D0D0D]/95 lg:dark:to-transparent lg:z-10 anim-essential">
                <button
                    onClick={handleSubmitClick}
                    disabled={isSubmitting}
                    className="w-full bg-[#6A3FF4] hover:bg-[#5835CC] text-white font-bold py-4 rounded-xl shadow-lg shadow-purple-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {isSubmitting ? (
                        <><i className="ph-bold ph-spinner animate-spin"></i> {t('quizzesPage.submitting')}</>
                    ) : (
                        <><i className="ph-bold ph-paper-plane-right"></i> {t('quizzesPage.submit')}</>
                    )}
                </button>
            </div>


            {/* Custom Confirmation Modal */}
            <AnimatePresence>
                {showConfirmModal && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className={`${glassCardStyle} max-w-sm w-full p-6 text-center border-2 border-[#6A3FF4]/30 pointer-events-auto`}
                        >
                            <div className="w-16 h-16 bg-[#6A3FF4]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="ph-fill ph-paper-plane-right text-3xl text-[#6A3FF4]"></i>
                            </div>
                            <h3 className="text-xl font-bold text-black dark:text-white mb-2">{t('quizzesPage.submitConfirmTitle')}</h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
                                {t('quizzesPage.submitConfirmBody')}
                            </p>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => setShowConfirmModal(false)}
                                    className="px-5 py-2.5 rounded-xl font-bold text-gray-500 hover:bg-gray-500/10 transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={() => executeSubmission(false)}
                                    className="px-5 py-2.5 rounded-xl font-bold bg-[#6A3FF4] hover:bg-[#5835CC] text-white shadow-lg shadow-[#6A3FF4]/30 transition-all flex items-center gap-2"
                                >
                                    {t('quizzesPage.confirmSubmit')}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

// --- MAIN PAGE ---

export const Quizzes: React.FC = () => {
    const { searchTerm } = useAppContext();
    const t = useT();
    const [quizzes, setQuizzes] = useState<Quiz[]>([]);
    const [submissions] = useState<QuizSubmission[]>([]);
    const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const visibleQuizzes = quizzes.filter((q) => {
        if (!searchTerm) return true;
        const needle = searchTerm.toLowerCase();
        return (
            q.title?.toLowerCase().includes(needle) ||
            q.courseCode?.toLowerCase().includes(needle)
        );
    });

    const fetchData = async () => {
        setIsLoading(true);

        try {
            const allQuizzes = await fetchQuizzes();
            setQuizzes(allQuizzes);
        } catch (error) {
            // leave quizzes empty on failure
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!selectedQuizId) {
            fetchData();
        }
    }, [selectedQuizId]);

    if (selectedQuizId) {
        return <QuizTaker quizId={selectedQuizId} onBack={() => setSelectedQuizId(null)} />;
    }

    return (
        <div className="container mx-auto px-4 pb-20 p-6">
            <AnimateOnView>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-black dark:text-white mb-2">{t('quizzesPage.title')}</h1>
                        <p className="text-gray-500 dark:text-gray-400">{t('quizzesPage.subtitle')}</p>
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className="text-center py-20">
                    <i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                        {visibleQuizzes.map((quiz, index) => {
                            const sub = submissions.find(s => s.quizId === quiz.id);
                            return (
                                <motion.div
                                    key={quiz.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.1 }}
                                >
                                    <QuizCard
                                        quiz={quiz}
                                        submission={sub}
                                        onClick={() => !sub && setSelectedQuizId(quiz.id)}
                                    />
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                    {quizzes.length === 0 && (
                        <div className="col-span-full text-center py-20 text-gray-500">
                            <i className="ph-duotone ph-exam text-5xl mb-4"></i>
                            <p className="font-semibold text-black dark:text-white">{t('quizzesPage.noQuizzes')}</p>
                            <p className="text-sm mt-1">{t('quizzesPage.subtitle')}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Quizzes;
