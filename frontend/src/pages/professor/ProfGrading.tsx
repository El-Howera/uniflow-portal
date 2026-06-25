/**
 * ProfGrading — assignment grading for professors.
 *
 * Backed by:
 *   - GET /api/professor/submissions/:email  — every assignment submission
 *                                               on the prof's courses
 *   - PUT /api/submissions/:id/grade         — final grade write
 *   - POST /api/grades/:code/:studentId/approve — approve a TA proposal
 *
 * Differs from the legacy version: reads from `assignmentSubmission` (not
 * the gradebook entries table) so a student-uploaded PDF actually shows
 * up here. Adds a glass-styled course filter on top + a "Proposals"
 * filter chip surfacing TA-proposed grades awaiting professor review.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

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
  status: string; // 'submitted' | 'pending_review' | 'graded'
  score: number | null;
  proposedScore: number | null;
  feedback: string;
  filePath: string | null;
  originalFileName: string | null;
  // Local edit state.
  gradeInput: string;
  feedbackInput: string;
}

type FilterKey = 'all' | 'pending' | 'proposals' | 'graded';

const labelFor = (s: Submission): 'Pending' | 'Graded' | 'Proposed' => {
  if (s.status === 'graded' && s.score != null) return 'Graded';
  if (s.status === 'pending_review' && s.proposedScore != null) return 'Proposed';
  return 'Pending';
};

const SubmissionCard: React.FC<{
  submission: Submission;
  onGradeChange: (id: string, grade: string) => void;
  onFeedbackChange: (id: string, feedback: string) => void;
  onSubmitGrade: (id: string) => void;
  onApproveProposal: (id: string) => void;
  onDelete: (id: string, reason: string) => void;
}> = ({ submission, onGradeChange, onFeedbackChange, onSubmitGrade, onApproveProposal, onDelete }) => {
  const t = useT();
  // Confirmation flow: first click flips the row into "confirm" mode and
  // surfaces a reason input + confirm/cancel buttons. The actual delete
  // only fires from the explicit Confirm click — so a stray click never
  // wipes a submission accidentally.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const lbl = labelFor(submission);
  const lblDisplay = lbl === 'Graded'
    ? t('professor.filterGraded')
    : lbl === 'Proposed'
    ? t('professor.proposedBadge')
    : t('professor.filterPending');
  const fileUrl = submission.filePath
    ? `${API_URLS.courseContent()}/files/${submission.filePath.split(/[\\/]/).pop() ?? ''}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${glassCardStyle} p-6`}
    >
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Initials avatar — no third-party random faces. */}
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-xs font-bold"
            aria-label={submission.studentName}
          >
            {(submission.studentName || '?')
              .split(' ')
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s.charAt(0).toUpperCase())
              .join('')}
          </div>
          <div className="min-w-0">
            <h4 className="text-black dark:text-white font-bold text-sm truncate">
              {submission.courseCode} — {submission.assignmentTitle}
            </h4>
            <p className="text-gray-500 dark:text-gray-400 text-xs truncate">{submission.studentName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {submission.isLate && (
            <span className="text-[10px] font-bold text-red-500 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
              <i className="ph-bold ph-warning"></i> {t('professor.lateBadge')}
            </span>
          )}
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              lbl === 'Graded'
                ? 'text-green-500 bg-green-500/10 border-green-500/30'
                : lbl === 'Proposed'
                ? 'text-blue-500 bg-blue-500/10 border-blue-500/30'
                : 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30'
            }`}
          >
            {lblDisplay}
          </span>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mb-4">
        <span className="flex items-center gap-1">
          <i className="ph-bold ph-calendar text-[#6A3FF4]"></i>
          {t('professor.submittedDateLabel', { date: new Date(submission.submittedAt).toLocaleDateString() })}
        </span>
        {submission.dueDate && (
          <span>· {t('professor.dueDateLabel2', { date: new Date(submission.dueDate).toLocaleDateString() })}</span>
        )}
        <span>· {t('professor.maxScoreLabel', { n: submission.maxScore })}</span>
      </div>

      {submission.score != null && (
        <div className="mb-3 text-xs text-green-500 font-medium">
          {t('professor.currentGradeLabel', { score: submission.score, max: submission.maxScore })}
        </div>
      )}

      {submission.proposedScore != null && submission.status === 'pending_review' && (
        <div className="mb-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-between gap-2">
          <div>
            <span className="text-blue-400 text-xs font-bold block">
              {t('professor.taProposedLabel', { score: submission.proposedScore, max: submission.maxScore })}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {t('professor.awaitingYourApproval')}
            </span>
          </div>
          <button
            onClick={() => onApproveProposal(submission.id)}
            className="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 transition-colors flex items-center gap-1"
          >
            <i className="ph-bold ph-check"></i> {t('professor.approveBtn')}
          </button>
        </div>
      )}

      {fileUrl && (
        <div className="mb-3">
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 text-black dark:text-white hover:border-[#6A3FF4]/60 hover:bg-[#6A3FF4]/10 transition-colors"
          >
            <i className="ph-fill ph-file-arrow-down text-[#6A3FF4]"></i>
            <span className="truncate max-w-[20rem]">
              {submission.originalFileName || t('professor.submittedFile')}
            </span>
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
            {t('professor.gradeOutOf', { n: submission.maxScore })}
          </label>
          <input
            type="number"
            min="0"
            max={submission.maxScore}
            step="0.5"
            value={submission.gradeInput}
            onChange={(e) => onGradeChange(submission.id, e.target.value)}
            placeholder={t('professor.enterGradePlaceholder')}
            className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-colors"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
            {t('professor.feedback')}
          </label>
          <input
            type="text"
            value={submission.feedbackInput}
            onChange={(e) => onFeedbackChange(submission.id, e.target.value)}
            placeholder={t('professor.feedbackInputPlaceholder')}
            className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]/50 transition-colors"
          />
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 text-xs font-bold transition-colors flex items-center gap-1.5"
            title={t('professor.deleteSubmission')}
          >
            <i className="ph-bold ph-trash"></i> {t('professor.deleteSubmission')}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <input
              type="text"
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              placeholder={t('professor.deleteReasonPlaceholder')}
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
              <i className="ph-bold ph-check"></i> {t('professor.confirmDeleteShort')}
            </button>
            <button
              onClick={() => { setConfirmDelete(false); setDeleteReason(''); }}
              className="px-3 py-2 rounded-xl border border-white/20 text-gray-500 hover:bg-white/5 text-xs font-bold"
            >
              {t('professor.cancelBtn')}
            </button>
          </div>
        )}
        <button
          onClick={() => onSubmitGrade(submission.id)}
          disabled={!submission.gradeInput || confirmDelete}
          className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold text-xs hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <i className="ph-bold ph-floppy-disk"></i>
          {t('professor.submitGradeBtn')}
        </button>
      </div>
    </motion.div>
  );
};

const ProfGrading: React.FC = () => {
  const t = useT();
  const FILTERS: { value: FilterKey; label: string }[] = [
    { value: 'all', label: t('professor.filterAll') },
    { value: 'pending', label: t('professor.filterPending') },
    { value: 'proposals', label: t('professor.taProposals') },
    { value: 'graded', label: t('professor.filterGraded') },
  ];
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const email = localStorage.getItem('currentUserEmail') || '';
        if (!email) {
          setError(t('professor.notAuthenticated'));
          return;
        }
        const res = await fetch(
          `${API_URLS.courseContent()}/api/professor/submissions/${encodeURIComponent(email)}`,
          { credentials: 'include', headers: authHeaders() as Record<string, string> },
        );
        if (!res.ok) {
          setError(t('professor.couldNotLoadSubmissions', { code: res.status }));
          return;
        }
        const data = (await res.json()) as Submission[];
        setSubmissions(
          data.map((s) => ({
            ...s,
            gradeInput: s.score != null ? String(s.score) : '',
            feedbackInput: s.feedback ?? '',
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : t('professor.networkErr'));
      } finally {
        setIsLoading(false);
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Course filter source — derive from the actual loaded list. That way
  // the dropdown only ever shows courses the prof actually has
  // submissions on, and stays in sync if the data refreshes.
  const courseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of submissions) {
      if (!seen.has(s.courseCode)) seen.set(s.courseCode, s.courseName);
    }
    return [
      { value: 'all', label: t('professor.allCoursesShort'), icon: 'ph-stack' },
      ...[...seen.entries()].map(([code, name]) => ({
        value: code,
        label: `${code} — ${name}`,
        icon: 'ph-book-open',
      })),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions]);

  const filtered = useMemo(() => {
    return submissions.filter((s) => {
      if (courseFilter !== 'all' && s.courseCode !== courseFilter) return false;
      const lbl = labelFor(s);
      if (filter === 'pending') return lbl === 'Pending';
      if (filter === 'graded') return lbl === 'Graded';
      if (filter === 'proposals') return lbl === 'Proposed';
      return true;
    });
  }, [submissions, courseFilter, filter]);

  const counts = useMemo(() => {
    const c = { pending: 0, proposals: 0, graded: 0 };
    for (const s of submissions) {
      const lbl = labelFor(s);
      if (lbl === 'Pending') c.pending++;
      else if (lbl === 'Proposed') c.proposals++;
      else if (lbl === 'Graded') c.graded++;
    }
    return c;
  }, [submissions]);

  const graded = submissions.filter((s) => s.score != null);
  const avgGrade =
    graded.length > 0
      ? Math.round(graded.reduce((acc, s) => acc + (s.score! / s.maxScore) * 100, 0) / graded.length)
      : 0;

  const handleGradeChange = (id: string, grade: string) =>
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, gradeInput: grade } : s)));
  const handleFeedbackChange = (id: string, feedback: string) =>
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, feedbackInput: feedback } : s)));

  const handleSubmitGrade = async (id: string) => {
    const sub = submissions.find((s) => s.id === id);
    if (!sub) return;
    const score = parseFloat(sub.gradeInput);
    if (Number.isNaN(score)) return;
    try {
      const res = await fetch(`${API_URLS.courseContent()}/api/submissions/${id}/grade`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(authHeaders() as Record<string, string>) },
        body: JSON.stringify({ score, feedback: sub.feedbackInput }),
      });
      if (res.ok) {
        setSubmissions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, score, status: 'graded', feedback: sub.feedbackInput } : s,
          ),
        );
      }
    } catch (e) {
      console.error('grade submit failed', e);
    }
  };

  const handleDeleteSubmission = async (id: string, reason: string) => {
    try {
      const res = await fetch(`${API_URLS.courseContent()}/api/submissions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeaders() as Record<string, string>),
        },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setSubmissions(prev => prev.filter(s => s.id !== id));
      }
    } catch (e) {
      console.error('delete submission failed', e);
    }
  };

  const handleApproveProposal = async (id: string) => {
    const sub = submissions.find((s) => s.id === id);
    if (!sub) return;
    try {
      const res = await fetch(
        `${API_URLS.courseContent()}/api/grades/${sub.courseCode}/${sub.studentId}/approve`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeaders() as Record<string, string>),
          },
          body: JSON.stringify({ assignmentId: sub.assignmentId }),
        },
      );
      if (res.ok) {
        setSubmissions((prev) =>
          prev.map((s) =>
            s.id === id
              ? { ...s, status: 'graded', score: s.proposedScore, gradeInput: String(s.proposedScore ?? '') }
              : s,
          ),
        );
      }
    } catch (e) {
      console.error('approve proposal failed', e);
    }
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView enabled={false}>
        <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">
          {t('professor.assignmentGradingTitle')}
        </h2>
        <p className="text-black dark:text-gray-300 text-sm">
          {t('professor.assignmentGradingSubtitle')}
        </p>
      </AnimateOnView>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-warning-circle"></i>
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: t('professor.filterPending'), value: counts.pending, icon: 'ph-clipboard-text', bg: 'bg-yellow-500/20', color: 'text-yellow-500', note: t('professor.statPendingNote') },
          { label: t('staff.proposals'), value: counts.proposals, icon: 'ph-hourglass-medium', bg: 'bg-blue-500/20', color: 'text-blue-500', note: t('professor.statProposalsNote') },
          { label: t('professor.filterGraded'), value: counts.graded, icon: 'ph-check-circle', bg: 'bg-green-500/20', color: 'text-green-500', note: t('professor.statGradedNote') },
          { label: t('professor.avgGradeStat'), value: avgGrade > 0 ? `${avgGrade}%` : 'N/A', icon: 'ph-chart-bar', bg: 'bg-[#6A3FF4]/20', color: 'text-[#6A3FF4]', note: t('professor.statAvgNote') },
        ].map((stat, i) => (
          <AnimateOnView key={stat.label} delay={0.1 + i * 0.04} enabled={false}>
            <ParticleCard
              className={`${glassCardStyle} p-5`}
              enableTilt={false}
              enableMagnetism={false}
              clickEffect
              particleCount={8}
              glowColor="132, 0, 255"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center`}>
                  <i className={`ph-fill ${stat.icon} text-xl ${stat.color}`}></i>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{stat.label}</p>
                  <p className="text-2xl font-bold text-black dark:text-white">
                    {isLoading ? '—' : stat.value}
                  </p>
                  <p className="text-[10px] text-gray-500">{stat.note}</p>
                </div>
              </div>
            </ParticleCard>
          </AnimateOnView>
        ))}
      </div>

      {/* Filter row — course dropdown (glass) + status pill bar.
          Both follow the design-system rule: no native <select>. */}
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
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-colors relative ${
                  filter !== f.value ? 'text-black dark:text-gray-300 hover:text-black dark:hover:text-white' : 'text-white'
                }`}
              >
                {filter === f.value && (
                  <motion.div
                    layoutId="profGradingFilter"
                    className="absolute inset-0 bg-[#6A3FF4] rounded-md shadow-lg"
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </AnimateOnView>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-20">
          <i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i>
        </div>
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
                  onApproveProposal={handleApproveProposal}
                  onDelete={handleDeleteSubmission}
                />
              </AnimateOnView>
            ))}
          </AnimatePresence>
          {filtered.length === 0 && (
            <div className={`${glassCardStyle} p-12 text-center`}>
              <i className="ph-bold ph-clipboard-text text-4xl text-gray-400 mb-3 block"></i>
              <p className="text-gray-500">
                {submissions.length === 0
                  ? t('professor.noSubmissionsYet')
                  : t('professor.noSubmissionsMatchFilter')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProfGrading;
