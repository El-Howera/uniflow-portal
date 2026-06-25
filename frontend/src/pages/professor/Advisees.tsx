// src/pages/professor/Advisees.tsx
//
// Plan 4 Phase 8 — academic advisor queue (FCDS Article 12).
// Lists students assigned to the requesting professor (academic_advisor_id =
// req.user.userId) along with each one's pending registrations. The
// professor can Approve / Reject the advisor gate per registration; SA still
// does the final approval pass after the advisor signs off.
import { FC, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

interface PendingReg {
  id: string;
  userId: string;
  sectionId: string;
  status: string;
  pendingReason: string | null;
  pendingNote: string | null;
  advisorApproved: boolean;
  advisorApprovedAt: string | null;
  createdAt: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  sectionLabel: string;
  sectionType: string;
}

interface Advisee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  pendingRegistrations: PendingReg[];
}

const REASON_BADGE: Record<string, string> = {
  advisor_approval:    'bg-purple-500/15 text-purple-300 border-purple-500/30',
  level_below_course:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  late_registration:   'bg-blue-500/15 text-blue-300 border-blue-500/30',
};

const Advisees: FC = () => {
  const t = useT();
  const [advisees, setAdvisees] = useState<Advisee[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reviewFor, setReviewFor] = useState<{ regId: string; action: 'approve' | 'reject' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const flash = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    window.setTimeout(() => setActionMsg(null), 5000);
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URLS.registration()}/api/professor/advisees`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const data = res.ok ? await res.json() : { advisees: [] };
      setAdvisees(Array.isArray(data.advisees) ? data.advisees : []);
    } catch {
      flash('error', t('professor.failedToLoadAdvisees'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Mount-only fetch; refresh is defined in component body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doReview = async (regId: string, action: 'approve' | 'reject', note: string) => {
    try {
      const res = await fetch(`${API_URLS.registration()}/api/registrations/${regId}/advisor-approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify({ action, reviewNote: note || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash('error', json?.error || t('professor.failedWithStatus', { code: res.status }));
        return;
      }
      flash('success', action === 'approve' ? t('professor.registrationApproved') : t('professor.registrationRejected'));
      setReviewFor(null);
      setReviewNote('');
      await refresh();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('professor.failedReviewMsg'));
    }
  };

  const totalPending = advisees.reduce(
    (sum, a) => sum + a.pendingRegistrations.length, 0,
  );

  return (
    <div className="pb-16">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-3xl font-bold text-black dark:text-white">{t('professor.adviseesTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('professor.fcdsArticle12Hint')}
        </p>
      </motion.div>

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className={`mb-4 p-3 rounded-xl text-sm border ${actionMsg.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}
          >
            <i className={`ph-bold ${actionMsg.type === 'success' ? 'ph-check-circle' : 'ph-warning'} mr-1.5`} />
            {actionMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p className="text-gray-500 text-center py-10">{t('professor.loadingDots')}</p>
      ) : advisees.length === 0 ? (
        <div className={`${glassCardStyle} p-10 text-center`}>
          <i className="ph-bold ph-user-focus text-4xl text-[#6A3FF4]/60 mb-3 inline-block" />
          <p className="text-black dark:text-white font-bold text-base">{t('professor.noAdviseesAssigned')}</p>
          <p className="text-xs text-gray-500 mt-1">
            {t('professor.advisorAssignedHint')}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-4">
            {advisees.length !== 1
              ? t('professor.adviseesCountPlural', { n: advisees.length })
              : t('professor.adviseesCountSingular', { n: advisees.length })}
            {' · '}
            {totalPending !== 1
              ? t('professor.pendingRegistrationCountPlural', { n: totalPending })
              : t('professor.pendingRegistrationCountSingular', { n: totalPending })}
          </p>

          {advisees.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`${glassCardStyle} p-5 mb-4`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-black dark:text-white font-bold text-base">
                    {a.firstName} {a.lastName}
                  </p>
                  <p className="text-xs text-gray-500">{a.email}</p>
                </div>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10">
                  {t('professor.pendingCount', { n: a.pendingRegistrations.length })}
                </span>
              </div>

              {a.pendingRegistrations.length === 0 ? (
                <p className="text-xs text-gray-500 italic">{t('professor.noPendingRegistrations')}</p>
              ) : (
                <div className="space-y-3">
                  {a.pendingRegistrations.map((r) => {
                    const reasonCls = r.pendingReason ? REASON_BADGE[r.pendingReason] : 'bg-gray-500/15 text-gray-300 border-gray-500/30';
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-white/10 bg-white/5 dark:bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="text-black dark:text-white font-medium">
                              {r.courseCode} — {r.courseTitle}
                            </p>
                            <p className="text-xs text-gray-500">
                              {r.sectionType} · section {r.sectionLabel} · {r.credits} cr
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {r.pendingReason && (
                              <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${reasonCls}`}>
                                {r.pendingReason.replaceAll('_', ' ')}
                              </span>
                            )}
                            {r.advisorApproved && (
                              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                                {t('professor.advisorBadge')}
                              </span>
                            )}
                          </div>
                        </div>
                        {r.pendingNote && (
                          <p className="text-xs text-gray-500 italic mb-2">{r.pendingNote}</p>
                        )}
                        <p className="text-[10px] text-gray-500">
                          {t('professor.submittedShortLabel', { date: new Date(r.createdAt).toLocaleDateString() })}
                        </p>

                        {!r.advisorApproved && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              onClick={() => setReviewFor({ regId: r.id, action: 'approve' })}
                              className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-4 py-1.5 rounded-lg text-xs font-bold"
                            >
                              <i className="ph-bold ph-check mr-1.5" />{t('professor.approveBtn')}
                            </button>
                            <button
                              onClick={() => setReviewFor({ regId: r.id, action: 'reject' })}
                              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 px-4 py-1.5 rounded-lg text-xs font-bold"
                            >
                              <i className="ph-bold ph-x mr-1.5" />{t('professor.rejectBtn')}
                            </button>
                          </div>
                        )}

                        {reviewFor?.regId === r.id && (
                          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 dark:bg-black/20 p-3">
                            <textarea
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              placeholder={reviewFor.action === 'approve' ? t('professor.noteForApproval') : t('professor.noteForRejection')}
                              rows={2}
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                            />
                            <div className="flex justify-end gap-2 mt-2">
                              <button
                                onClick={() => { setReviewFor(null); setReviewNote(''); }}
                                className="text-xs text-gray-500 hover:text-black dark:hover:text-white"
                              >
                                {t('professor.cancelBtn')}
                              </button>
                              <button
                                onClick={() => doReview(r.id, reviewFor.action, reviewNote)}
                                className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white px-4 py-1.5 rounded-lg text-xs font-bold"
                              >
                                {reviewFor.action === 'approve' ? t('professor.confirmApproval') : t('professor.confirmRejection')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ))}
        </>
      )}
    </div>
  );
};

export default Advisees;
