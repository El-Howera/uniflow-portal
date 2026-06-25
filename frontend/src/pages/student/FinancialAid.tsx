/**
 * FinancialAid — Plan 7 Phase 6 student-facing list page.
 *
 * Lists the student's financial aid history (newest first) with status pills,
 * the awarded amount on approved rows, the review note on rejected rows, and
 * a withdraw action for pending rows. The "Apply for aid" CTA links to
 * `/student/financial-aid/apply`. While a pending request exists the button
 * is disabled with a hint — the backend will 409 anyway, this just front-runs
 * the friction.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { apiFetch } from '../../utils/api';
import { formatMoney } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

type AidStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

interface AidRequest {
  id: string;
  requestedAmount: string | number;
  awardedAmount?: string | number | null;
  justification: string;
  applicantIncome?: string | number | null;
  dependents?: number | null;
  supportingDocs?: { name: string; url: string; sizeBytes?: number }[];
  status: AidStatus;
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

const STATUS_PILL: Record<AidStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-500 dark:text-gray-400 border-gray-500/30',
};

// Status labels are resolved via the t() hook below — these are
// fallback values used only if the translation lookup ever misses.
const STATUS_LABEL: Record<AidStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const FinancialAid: React.FC = () => {
  const navigate = useNavigate();
  const t = useT();
  const [requests, setRequests] = useState<AidRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusLabelFor = (s: AidStatus): string => {
    switch (s) {
      case 'pending':   return t('financialAidPage.statusPending');
      case 'approved':  return t('financialAidPage.statusApproved');
      case 'rejected':  return t('financialAidPage.statusRejected');
      case 'withdrawn': return t('financialAidPage.statusWithdrawn');
      default:          return STATUS_LABEL[s];
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URLS.payments()}/api/financial-aid/me`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || t('financialAidPage.errLoad'));
        return;
      }
      setRequests(Array.isArray((data as { requests?: AidRequest[] }).requests) ? (data as { requests: AidRequest[] }).requests : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('financialAidPage.errNetwork'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const hasPending = requests.some((r) => r.status === 'pending');

  const handleWithdraw = async (id: string) => {
    if (!window.confirm(t('financialAidPage.withdrawConfirm'))) return;
    setBusyId(id);
    try {
      const res = await apiFetch(`${API_URLS.payments()}/api/financial-aid/me/${id}/withdraw`, {
        method: 'PATCH',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert((data as { error?: string; message?: string }).message
          || (data as { error?: string }).error
          || t('financialAidPage.withdrawError'));
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 pb-16 space-y-5 p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`${glassCardStyle} p-6 flex flex-col md:flex-row md:items-center justify-between gap-4`}
      >
        <div>
          <h1 className="text-black dark:text-white text-2xl font-bold flex items-center gap-2">
            <i className="ph-bold ph-hand-coins text-[#6A3FF4]"></i>
            {t('financialAidPage.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
            {t('financialAidPage.subtitle')}
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-1">
          <button
            type="button"
            disabled={hasPending}
            onClick={() => navigate('/student/financial-aid/apply')}
            title={hasPending ? t('financialAidPage.applyDisabledHint') : t('financialAidPage.applyTooltipNew')}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="ph-bold ph-plus"></i> {t('financialAidPage.applyBtn')}
          </button>
          {hasPending && (
            <p className="text-xs text-amber-600 dark:text-amber-300">
              {t('financialAidPage.applyDisabledHint')}
            </p>
          )}
        </div>
      </motion.div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-x-circle"></i> {error}
        </div>
      )}

      {loading ? (
        <div className={`${glassCardStyle} p-8 animate-pulse`}>
          <div className="h-4 w-1/3 bg-white/10 rounded mb-3"></div>
          <div className="h-3 w-2/3 bg-white/10 rounded"></div>
        </div>
      ) : requests.length === 0 ? (
        <div className={`${glassCardStyle} p-10 text-center`}>
          <i className="ph-bold ph-folder-open text-4xl text-[#6A3FF4] block mb-3"></i>
          <h3 className="text-black dark:text-white font-bold mb-1">{t('financialAidPage.emptyTitle')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('financialAidPage.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r, idx) => {
            const pillCls = STATUS_PILL[r.status];
            const isPending = r.status === 'pending';
            const isApproved = r.status === 'approved';
            const isRejected = r.status === 'rejected';
            return (
              <motion.article
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.18) }}
                className={`${glassCardStyle} p-5`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wide ${pillCls}`}
                      >
                        {statusLabelFor(r.status)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t('financialAidPage.submittedAt', { date: fmtDate(r.createdAt) })}
                      </span>
                      {r.reviewedAt && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t('financialAidPage.reviewedAt', { date: fmtDate(r.reviewedAt) })}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-black dark:text-white">
                      {t('financialAidPage.requested')} <span className="font-bold">{formatMoney(r.requestedAmount, { fractional: true })}</span>
                      {isApproved && r.awardedAmount != null && (
                        <>
                          {' '}· {t('financialAidPage.awarded')}{' '}
                          <span className="font-bold text-emerald-600 dark:text-emerald-300">
                            {formatMoney(r.awardedAmount, { fractional: true })}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {r.justification}
                    </p>
                    {isRejected && r.reviewNote && (
                      <div className="mt-2 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-500 dark:text-red-300">
                        <strong>{t('financialAidPage.reviewerNote')}</strong> {r.reviewNote}
                      </div>
                    )}
                    {isApproved && r.reviewNote && (
                      <div className="mt-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300">
                        <strong>{t('financialAidPage.reviewerNote')}</strong> {r.reviewNote}
                      </div>
                    )}
                    {Array.isArray(r.supportingDocs) && r.supportingDocs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.supportingDocs.map((d, i) => (
                          <span
                            key={`${r.id}-doc-${i}`}
                            className="inline-flex items-center gap-1 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-[11px] text-gray-500 dark:text-gray-300"
                          >
                            <i className="ph-bold ph-paperclip text-[10px]"></i> {d.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {isPending && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => handleWithdraw(r.id)}
                      className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 font-bold text-xs hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      {busyId === r.id ? (
                        <>
                          <i className="ph-bold ph-spinner animate-spin mr-1"></i> {t('financialAidPage.withdrawing')}
                        </>
                      ) : (
                        <>
                          <i className="ph-bold ph-x mr-1"></i> {t('financialAidPage.withdrawBtn')}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FinancialAid;
