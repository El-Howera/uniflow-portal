/* ════════════════════════════════════════════════════════════════════
 * SAAttendanceExcuses — SA review queue for absence excuses / appeals.
 * --------------------------------------------------------------------
 * Lists every AttendanceExcuse row (defaulting to status=pending) with
 * the student name, course, reason, and (when present) the disputed
 * record's date + recorded status. SA picks approve or reject; an
 * optional note is appended to the excuse's reason field and a system
 * notification fires back to the student.
 *
 * Approve flips the linked AttendanceRecord to 'excused' so the absence
 * stops counting in the attendance %. Reject leaves the record as-is.
 * ════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

interface ExcuseRow {
  id: string;
  reason: string;
  status: 'pending' | 'completed' | 'rejected' | 'in_progress';
  evidenceUrl: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  session: {
    courseCode: string | null;
    courseName: string | null;
    date: string | null;
  } | null;
  attendanceRecord: {
    id: string;
    status: string;
    date: string;
    courseCode: string | null;
  } | null;
}

const glassCard =
  'bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 ' +
  'rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

const STATUS_PILL: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  completed: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
  rejected: 'bg-red-500/20 text-red-700 dark:text-red-300 border border-red-500/30',
  in_progress: 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/30',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_EXCUSES: ExcuseRow[] = [
  {
    id: 'exc-1', reason: 'I had a medical appointment and have attached the doctor\'s note.',
    status: 'pending', evidenceUrl: null, reviewedAt: null, createdAt: new Date(Date.now() - 6 * 3600000).toISOString(),
    user: { id: 'stu-001', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.edu' },
    session: { courseCode: 'CS301', courseName: 'Algorithms & Data Structures', date: new Date(Date.now() - 7 * 86400000).toISOString() },
    attendanceRecord: { id: 'rec-1', status: 'absent', date: new Date(Date.now() - 7 * 86400000).toISOString(), courseCode: 'CS301' },
  },
  {
    id: 'exc-2', reason: 'Family emergency required me to travel out of the city.',
    status: 'pending', evidenceUrl: null, reviewedAt: null, createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    user: { id: 'stu-002', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.edu' },
    session: { courseCode: 'MA205', courseName: 'Linear Algebra', date: new Date(Date.now() - 2 * 86400000).toISOString() },
    attendanceRecord: { id: 'rec-2', status: 'absent', date: new Date(Date.now() - 2 * 86400000).toISOString(), courseCode: 'MA205' },
  },
  {
    id: 'exc-3', reason: 'The QR scan failed during the session but I was present the whole time.',
    status: 'completed', evidenceUrl: null, reviewedAt: new Date(Date.now() - 5 * 86400000).toISOString(), createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    user: { id: 'stu-004', firstName: 'Salma', lastName: 'Mahmoud', email: 'salma.mahmoud@uniflow.edu' },
    session: { courseCode: 'CS340', courseName: 'Database Systems', date: new Date(Date.now() - 7 * 86400000).toISOString() },
    attendanceRecord: { id: 'rec-3', status: 'excused', date: new Date(Date.now() - 7 * 86400000).toISOString(), courseCode: 'CS340' },
  },
  {
    id: 'exc-4', reason: 'Overslept after a late-night study session — requesting leniency.',
    status: 'rejected', evidenceUrl: null, reviewedAt: new Date(Date.now() - 10 * 86400000).toISOString(), createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    user: { id: 'stu-007', firstName: 'Karim', lastName: 'Fouad', email: 'karim.fouad@uniflow.edu' },
    session: { courseCode: 'CS301', courseName: 'Algorithms & Data Structures', date: new Date(Date.now() - 13 * 86400000).toISOString() },
    attendanceRecord: { id: 'rec-4', status: 'absent', date: new Date(Date.now() - 13 * 86400000).toISOString(), courseCode: 'CS301' },
  },
];

const SAAttendanceExcuses: React.FC = () => {
  const t = useT();
  const STATUS_OPTIONS = [
    { value: 'pending', label: t('sa.statusOptPending') },
    { value: 'completed', label: t('sa.statusOptApproved') },
    { value: 'rejected', label: t('sa.statusOptRejected') },
    { value: 'all', label: t('sa.statusOptAll') },
  ];
  const STATUS_LABEL: Record<string, string> = {
    pending: t('sa.statusLabelPending'),
    completed: t('sa.statusLabelApproved'),
    rejected: t('sa.statusLabelRejected'),
    in_progress: t('sa.statusLabelInProgress'),
  };
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [excuses, setExcuses] = useState<ExcuseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // The id whose decision is currently in flight — used to disable buttons
  // and show a spinner without locking out the rest of the list.
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchExcuses = useCallback(async () => {
    // MVP build: populate from static mock data, no backend. Apply the
    // status filter locally.
    setLoading(true);
    setError(null);
    const filtered = statusFilter === 'all'
      ? MOCK_EXCUSES
      : MOCK_EXCUSES.filter((e) => e.status === statusFilter);
    setExcuses(filtered);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    fetchExcuses();
  }, [fetchExcuses]);

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setPendingAction(id);
    setFlash(null);
    // MVP build: flip the row's status locally; no backend.
    setFlash({
      type: 'success',
      text: action === 'approve' ? t('sa.excuseApprovedSuccess') : t('sa.excuseRejectedSuccess'),
    });
    setNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (statusFilter === 'pending') {
      // No longer pending — drop from the pending list.
      setExcuses((prev) => prev.filter((e) => e.id !== id));
    } else {
      const nextStatus = action === 'approve' ? 'completed' : 'rejected';
      setExcuses((prev) => prev.map((e) =>
        e.id === id ? { ...e, status: nextStatus, reviewedAt: new Date().toISOString() } : e));
    }
    setPendingAction(null);
    setTimeout(() => setFlash(null), 4500);
  };

  const sectionTitle = useMemo(() => {
    if (statusFilter === 'pending') return t('sa.pendingExcusesSection');
    if (statusFilter === 'completed') return t('sa.approvedExcusesSection');
    if (statusFilter === 'rejected') return t('sa.rejectedExcusesSection');
    return t('sa.allExcusesSection');
  }, [statusFilter, t]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-white">{t('sa.attendanceExcusesTitle')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('sa.attendanceExcusesSubtitleA')}{' '}
            <span className="font-semibold">{t('sa.excusedWord')}</span> {t('sa.attendanceExcusesSubtitleB')}
          </p>
        </div>
        <div className="min-w-[200px]">
          <GlassDropdown
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
            direction="down"
            className="w-full"
          />
        </div>
      </div>

      {flash && (
        <div
          className={`rounded-xl px-4 py-3 text-sm border flex items-center gap-2 ${
            flash.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
          }`}
        >
          <i
            className={`ph-bold ${flash.type === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}`}
          />
          {flash.text}
        </div>
      )}

      <div className={`${glassCard} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
            <i className="ph-bold ph-clipboard-text text-[#6A3FF4]" />
            {sectionTitle}
            <span className="text-xs font-medium text-gray-500 ml-2">
              {loading ? '…' : t('sa.recordCount', { count: excuses.length, plural: excuses.length === 1 ? '' : 's' })}
            </span>
          </h2>
          <button
            onClick={fetchExcuses}
            disabled={loading}
            className="text-xs font-semibold text-[#6A3FF4] hover:text-[#5A2AD4] disabled:opacity-50"
          >
            <i className="ph-bold ph-arrows-clockwise mr-1" /> {t('sa.refreshBtn')}
          </button>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-700 dark:text-red-300 mb-4">
            <i className="ph-bold ph-warning-circle mr-1" /> {error}
          </div>
        )}

        {loading && !error && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-white/5 dark:bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && !error && excuses.length === 0 && (
          <div className="text-center py-12">
            <i className="ph-light ph-tray text-5xl text-gray-400" />
            <p className="text-sm text-gray-500 mt-3">
              {statusFilter === 'pending' ? t('sa.noPendingExcuses') : t('sa.noExcusesFilterMatch')}
            </p>
          </div>
        )}

        {!loading && !error && excuses.length > 0 && (
          <ul className="space-y-3">
            {excuses.map((ex) => {
              const studentName = ex.user
                ? `${ex.user.firstName} ${ex.user.lastName}`.trim()
                : t('sa.unknownStudent');
              const courseCode =
                ex.attendanceRecord?.courseCode || ex.session?.courseCode || null;
              const sessionDate =
                ex.attendanceRecord?.date || ex.session?.date || null;
              const isPending = ex.status === 'pending';
              const isThisInFlight = pendingAction === ex.id;

              return (
                <li
                  key={ex.id}
                  className="rounded-xl p-4 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold text-black dark:text-white">
                          {studentName}
                        </span>
                        {ex.user?.email && (
                          <span className="text-xs text-gray-500">{ex.user.email}</span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[ex.status] || ''}`}
                        >
                          {STATUS_LABEL[ex.status] || ex.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400 mb-2">
                        {courseCode && (
                          <span>
                            <i className="ph-bold ph-book-open mr-1" />
                            <span className="font-semibold text-black dark:text-white">
                              {courseCode}
                            </span>
                          </span>
                        )}
                        {sessionDate && (
                          <span>
                            <i className="ph-bold ph-calendar-blank mr-1" />
                            {t('sa.sessionLblShort', { date: new Date(sessionDate).toLocaleDateString() })}
                          </span>
                        )}
                        {ex.attendanceRecord?.status && (
                          <span>
                            <i className="ph-bold ph-info mr-1" />
                            {t('sa.markedLblShort')}{' '}
                            <span className="font-semibold">{ex.attendanceRecord.status}</span>
                          </span>
                        )}
                        <span>
                          <i className="ph-bold ph-clock mr-1" />
                          {t('sa.filedLblShort', { date: new Date(ex.createdAt).toLocaleString() })}
                        </span>
                      </div>
                      <p className="text-sm text-black dark:text-white whitespace-pre-wrap leading-relaxed">
                        {ex.reason}
                      </p>
                      {ex.evidenceUrl && (
                        <a
                          href={ex.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[#6A3FF4] hover:text-[#5A2AD4]"
                        >
                          <i className="ph-bold ph-paperclip" /> {t('sa.viewEvidenceBtn')}
                        </a>
                      )}
                    </div>
                  </div>

                  {isPending && (
                    <div className="mt-4 space-y-2">
                      <textarea
                        value={notes[ex.id] || ''}
                        onChange={(e) => setNotes((prev) => ({ ...prev, [ex.id]: e.target.value }))}
                        placeholder={t('sa.optionalReviewerNote')}
                        rows={2}
                        className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 px-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => decide(ex.id, 'approve')}
                          disabled={isThisInFlight}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/80 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <i className="ph-bold ph-check mr-1" />
                          {isThisInFlight ? t('sa.approvingDots') : t('sa.approveBtn')}
                        </button>
                        <button
                          onClick={() => decide(ex.id, 'reject')}
                          disabled={isThisInFlight}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/80 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <i className="ph-bold ph-x mr-1" />
                          {isThisInFlight ? t('sa.rejectingDots') : t('sa.rejectBtn')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SAAttendanceExcuses;
