// src/pages/sa/SAEnrollmentWorkflows.tsx
//
// Plan 4 Phase 6 — single SA review page covering all three enrollment
// workflows (Articles 20, 21, 23). Tab switcher across the top:
//   1. Suspensions  — POST→pending, SA approves with cap check.
//   2. Cancellations — same lifecycle + secondary re-enrollment phase.
//   3. Programme Changes — approve atomically updates AcademicProfile.program.
//
// Each tab is a list of pending rows with approve/reject inline. Approving a
// suspension fires a cap check on the server (FCDS Article 20a — max 4
// suspensions); the UI surfaces the structured 409 message.
import React, { FC, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

type TabKey = 'suspensions' | 'cancellations' | 'programme-changes';

interface BaseRow {
  id: string;
  user_id: string;
  status: string;
  reason?: string;
  review_note?: string | null;
  created_at: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail?: string;
}
interface SuspensionRow extends BaseRow {
  semesters: number;
  is_military: boolean;
}
interface CancellationRow extends BaseRow {
  re_enrollment_requested_at?: string | null;
  re_enrollment_approved_at?: string | null;
  re_enrollment_reason?: string | null;
}
interface ProgrammeChangeRow extends BaseRow {
  from_program_code?: string | null;
  to_program_code: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  approved:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected:  'bg-red-500/15 text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_SUSPENSIONS: SuspensionRow[] = [
  { id: 'susp-1', user_id: 'stu-002', status: 'pending', reason: 'Medical leave — surgery and recovery', created_at: new Date(Date.now() - 2 * 86400000).toISOString(), userFirstName: 'Omar', userLastName: 'Hassan', userEmail: 'omar.hassan@uniflow.edu', semesters: 1, is_military: false },
  { id: 'susp-2', user_id: 'stu-005', status: 'pending', reason: 'Mandatory military service', created_at: new Date(Date.now() - 5 * 86400000).toISOString(), userFirstName: 'Ahmed', userLastName: 'Tarek', userEmail: 'ahmed.tarek@uniflow.edu', semesters: 2, is_military: true },
  { id: 'susp-3', user_id: 'stu-007', status: 'approved', reason: 'Family relocation abroad', review_note: 'Approved per Article 20a.', created_at: new Date(Date.now() - 14 * 86400000).toISOString(), userFirstName: 'Karim', userLastName: 'Fouad', userEmail: 'karim.fouad@uniflow.edu', semesters: 1, is_military: false },
];

const MOCK_CANCELLATIONS: CancellationRow[] = [
  { id: 'canc-1', user_id: 'stu-003', status: 'pending', reason: 'Transferring to another institution', created_at: new Date(Date.now() - 1 * 86400000).toISOString(), userFirstName: 'Youssef', userLastName: 'Ibrahim', userEmail: 'youssef.ibrahim@uniflow.edu', re_enrollment_requested_at: null, re_enrollment_approved_at: null, re_enrollment_reason: null },
  { id: 'canc-2', user_id: 'stu-006', status: 'approved', reason: 'Financial hardship', created_at: new Date(Date.now() - 30 * 86400000).toISOString(), userFirstName: 'Nour', userLastName: 'Abdelrahman', userEmail: 'nour.abdelrahman@uniflow.edu', re_enrollment_requested_at: new Date(Date.now() - 3 * 86400000).toISOString(), re_enrollment_approved_at: null, re_enrollment_reason: 'Financial situation resolved; requesting re-enrollment for Spring 2026.' },
];

const MOCK_PROGRAMME_CHANGES: ProgrammeChangeRow[] = [
  { id: 'pc-1', user_id: 'stu-004', status: 'pending', reason: 'Stronger interest in AI research', created_at: new Date(Date.now() - 12 * 3600000).toISOString(), userFirstName: 'Salma', userLastName: 'Mahmoud', userEmail: 'salma.mahmoud@uniflow.edu', from_program_code: 'CS', to_program_code: 'AI' },
  { id: 'pc-2', user_id: 'stu-008', status: 'rejected', reason: 'Wants to switch to Data Science', review_note: 'GPA below program threshold.', created_at: new Date(Date.now() - 20 * 86400000).toISOString(), userFirstName: 'Habiba', userLastName: 'Gamal', userEmail: 'habiba.gamal@uniflow.edu', from_program_code: 'AI', to_program_code: 'DS' },
];

const SAEnrollmentWorkflows: FC = () => {
  const t = useT();
  const [tab, setTab] = useState<TabKey>('suspensions');
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');

  const [suspensions, setSuspensions] = useState<SuspensionRow[]>([]);
  const [cancellations, setCancellations] = useState<CancellationRow[]>([]);
  const [programmeChanges, setProgrammeChanges] = useState<ProgrammeChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [reviewNoteFor, setReviewNoteFor] = useState<{ tab: TabKey; id: string; action: 'approve' | 'reject' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const refresh = async () => {
    setLoading(true);
    // MVP build: populate from static mock data, no backend. Apply the
    // pending/all filter locally.
    const byFilter = <T extends BaseRow>(rows: T[]) =>
      filter === 'pending' ? rows.filter((r) => r.status === 'pending') : rows;
    setSuspensions(byFilter(MOCK_SUSPENSIONS));
    setCancellations(byFilter(MOCK_CANCELLATIONS));
    setProgrammeChanges(byFilter(MOCK_PROGRAMME_CHANGES));
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // refresh is defined in component body; we only re-run when the filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const flash = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    window.setTimeout(() => setActionMsg(null), 4000);
  };

  const counts = useMemo(() => ({
    suspensions:     suspensions.filter((s) => s.status === 'pending').length,
    cancellations:   cancellations.filter((c) => c.status === 'pending').length,
    'programme-changes': programmeChanges.filter((p) => p.status === 'pending').length,
  }), [suspensions, cancellations, programmeChanges]);

  const submitReview = async (whichTab: TabKey, id: string, action: 'approve' | 'reject', note: string) => {
    // MVP build: mutate the row's status locally; no backend.
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const applyUpdate = <T extends BaseRow>(rows: T[]): T[] => {
      const updated = rows.map((r) =>
        r.id === id ? { ...r, status: nextStatus, review_note: note || r.review_note || null } : r);
      // When viewing the pending-only filter, drop the row now that it's resolved.
      return filter === 'pending' ? updated.filter((r) => r.status === 'pending') : updated;
    };
    if (whichTab === 'suspensions') setSuspensions((prev) => applyUpdate(prev));
    else if (whichTab === 'cancellations') setCancellations((prev) => applyUpdate(prev));
    else setProgrammeChanges((prev) => applyUpdate(prev));

    flash('success', action === 'approve' ? t('sa.requestApproved') : t('sa.requestRejected'));
    setReviewNoteFor(null);
    setReviewNote('');
  };

  const labelForStatus = (status: string): string => {
    switch (status) {
      case 'pending': return t('sa.saPendingStatus');
      case 'approved': return t('sa.saApprovedStatus');
      case 'rejected': return t('sa.saRejectedStatus');
      case 'withdrawn': return t('sa.saWithdrawnStatus');
      default: return status;
    }
  };

  const renderRow = (row: BaseRow, body: React.ReactNode, whichTab: TabKey) => {
    const studentName = `${row.userFirstName || ''} ${row.userLastName || ''}`.trim() || row.userEmail || row.user_id;
    return (
      <motion.div
        key={row.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`${glassCardStyle} p-5 mb-3`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-black dark:text-white font-bold text-base">{studentName}</p>
            <p className="text-xs text-gray-500">{row.userEmail || ''}</p>
          </div>
          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full border ${STATUS_BADGE[row.status] || STATUS_BADGE.pending}`}>
            {labelForStatus(row.status)}
          </span>
        </div>
        {body}
        <p className="text-xs text-gray-500 mt-2">
          {t('sa.submittedAt', { date: new Date(row.created_at).toLocaleString() })}
        </p>
        {row.review_note && (
          <p className="text-xs text-gray-500 mt-1 italic">{t('sa.reviewNotePrefix', { note: row.review_note })}</p>
        )}

        {row.status === 'pending' && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => setReviewNoteFor({ tab: whichTab, id: row.id, action: 'approve' })}
              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-4 py-1.5 rounded-lg text-sm font-bold"
            >
              <i className="ph-bold ph-check mr-1.5" /> {t('sa.approveBtnIcon')}
            </button>
            <button
              onClick={() => setReviewNoteFor({ tab: whichTab, id: row.id, action: 'reject' })}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 px-4 py-1.5 rounded-lg text-sm font-bold"
            >
              <i className="ph-bold ph-x mr-1.5" /> {t('sa.rejectBtnIcon')}
            </button>
          </div>
        )}

        {reviewNoteFor?.id === row.id && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 dark:bg-black/20 p-3">
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={reviewNoteFor.action === 'approve' ? t('sa.optionalNoteApproval') : t('sa.optionalNoteRejection')}
              rows={2}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]"
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => { setReviewNoteFor(null); setReviewNote(''); }}
                className="text-xs text-gray-500 hover:text-black dark:hover:text-white"
              >
                {t('sa.cancelBtn')}
              </button>
              <button
                onClick={() => submitReview(reviewNoteFor.tab, row.id, reviewNoteFor.action, reviewNote)}
                className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white px-4 py-1.5 rounded-lg text-xs font-bold"
              >
                {reviewNoteFor.action === 'approve' ? t('sa.confirmApproval') : t('sa.confirmRejection')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="pb-16">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold text-black dark:text-white">{t('sa.enrollmentWorkflowsTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('sa.workflowsSubtitleArt')}
        </p>
      </motion.div>

      {/* Tab switcher */}
      <div className="flex flex-wrap gap-2 mb-4">
        {([
          ['suspensions', t('sa.suspensionsTabLbl')],
          ['cancellations', t('sa.cancellationsTabLbl')],
          ['programme-changes', t('sa.programmeChangesTabLbl')],
        ] as Array<[TabKey, string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              tab === k
                ? 'bg-[#6A3FF4] text-white'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            {label}
            {counts[k] > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-amber-500 text-black text-[10px] px-1.5">
                {counts[k]}
              </span>
            )}
          </button>
        ))}
        <div className="flex-1" />
        <div className="min-w-[160px]">
          <GlassDropdown
            value={filter}
            onChange={(v) => setFilter(v as 'pending' | 'all')}
            options={[
              { value: 'pending', label: t('sa.pendingOnlyOpt') },
              { value: 'all', label: t('sa.allStatusesOpt') },
            ]}
            direction="down"
            className="w-full"
          />
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className={`mb-4 p-3 rounded-xl text-sm border ${
              actionMsg.type === 'success'
                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}
          >
            <i className={`ph-bold ${actionMsg.type === 'success' ? 'ph-check-circle' : 'ph-warning'} mr-1.5`} />
            {actionMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="text-gray-500 text-sm py-10 text-center">
          <i className="ph-bold ph-spinner animate-spin text-3xl text-[#6A3FF4]" />
          <p className="mt-2">{t('sa.loadingEllipsis')}</p>
        </div>
      ) : (
        <>
          {tab === 'suspensions' && (
            suspensions.length === 0
              ? <p className="text-gray-500 text-center py-10">{t('sa.noSuspensionRequests')}</p>
              : suspensions.map((s) => renderRow(s, (
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <p>{t('sa.requestingSemesters', { n: s.semesters, plural: s.semesters === 1 ? '' : 's', military: s.is_military ? t('sa.militarySuffix') : '' })}</p>
                    <p className="text-gray-500 mt-1">{t('sa.reasonPrefix', { reason: s.reason || '' })}</p>
                  </div>
                ), 'suspensions'))
          )}

          {tab === 'cancellations' && (
            cancellations.length === 0
              ? <p className="text-gray-500 text-center py-10">{t('sa.noCancellationRequests')}</p>
              : cancellations.map((c) => renderRow(c, (
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <p className="text-gray-500">{t('sa.reasonPrefix', { reason: c.reason || '' })}</p>
                    {c.re_enrollment_requested_at && (
                      <p className="mt-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs">
                        <strong>{t('sa.reEnrollmentRequested')}</strong>{' '}
                        {new Date(c.re_enrollment_requested_at).toLocaleString()}
                        {c.re_enrollment_approved_at && (
                          <span className="ml-2 text-emerald-400">{t('sa.approvedOn', { date: new Date(c.re_enrollment_approved_at).toLocaleString() })}</span>
                        )}
                        {c.re_enrollment_reason && <p className="mt-1 italic">"{c.re_enrollment_reason}"</p>}
                      </p>
                    )}
                  </div>
                ), 'cancellations'))
          )}

          {tab === 'programme-changes' && (
            programmeChanges.length === 0
              ? <p className="text-gray-500 text-center py-10">{t('sa.noProgrammeChangeRequests')}</p>
              : programmeChanges.map((pc) => renderRow(pc, (
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <p>
                      <span className="text-gray-500">{t('sa.fromLbl')}</span>{' '}
                      <span className="text-black dark:text-white font-mono">{pc.from_program_code || t('sa.unsetProgramCode')}</span>
                      <i className="ph-bold ph-arrow-right mx-2 text-[#6A3FF4]" />
                      <span className="text-gray-500">{t('sa.toLbl')}</span>{' '}
                      <span className="text-black dark:text-white font-mono">{pc.to_program_code}</span>
                    </p>
                    <p className="text-gray-500 mt-1">{t('sa.reasonPrefix', { reason: pc.reason || '' })}</p>
                  </div>
                ), 'programme-changes'))
          )}
        </>
      )}
    </div>
  );
};

export default SAEnrollmentWorkflows;
