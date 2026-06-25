/**
 * FinancialAidDetail — Plan 7 Phase 6 single-request review page.
 *
 * Shows applicant, requested amount, optional income / dependents,
 * justification, supporting documents (download links), and an Approve /
 * Reject form. Approve requires `awardedAmount > 0` and an optional note;
 * Reject requires a note (max length follows backend Zod). After action
 * the page refetches and disables the action buttons.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatMoney } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
  'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

type AidStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

interface UserStub {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface SupportingDoc {
  name: string;
  url: string;
  sizeBytes?: number;
}

interface AidRequest {
  id: string;
  userId: string;
  requestedAmount: string | number;
  awardedAmount?: string | number | null;
  justification: string;
  applicantIncome?: string | number | null;
  dependents?: number | null;
  supportingDocs?: SupportingDoc[];
  status: AidStatus;
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  user?: UserStub | null;
  reviewer?: UserStub | null;
}

const STATUS_PILL: Record<AidStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-500 dark:text-gray-400 border-gray-500/30',
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Records keyed by id so any aid request
// the queue links to renders fully; unknown ids fall back to a generated one.
const MOCK_AID_DETAILS: Record<string, AidRequest> = {
  aid_5001: {
    id: 'aid_5001', userId: 'usr_2010', requestedAmount: 25000, awardedAmount: null,
    justification: 'Family income reduced after parent lost employment; requesting tuition assistance for Spring 2026. Currently working part-time to cover living expenses but unable to meet the full tuition obligation.',
    applicantIncome: 84000, dependents: 2,
    supportingDocs: [
      { name: 'income-statement-2025.pdf', url: '/files/aid/income-statement-2025.pdf', sizeBytes: 248_320 },
      { name: 'employment-letter.pdf', url: '/files/aid/employment-letter.pdf', sizeBytes: 96_512 },
    ],
    status: 'pending', reviewNote: null, createdAt: '2026-03-12T09:00:00.000Z', reviewedAt: null,
    user: { id: 'usr_2010', firstName: 'Aya', lastName: 'Sami', email: 'aya.sami@student.uniflow.edu' },
    reviewer: null,
  },
  aid_5002: {
    id: 'aid_5002', userId: 'usr_2011', requestedAmount: 18000, awardedAmount: null,
    justification: 'Single-parent household; requesting partial coverage of lab and housing fees for the current term.',
    applicantIncome: 62000, dependents: 1,
    supportingDocs: [
      { name: 'household-affidavit.pdf', url: '/files/aid/household-affidavit.pdf', sizeBytes: 134_144 },
    ],
    status: 'pending', reviewNote: null, createdAt: '2026-03-15T14:30:00.000Z', reviewedAt: null,
    user: { id: 'usr_2011', firstName: 'Hassan', lastName: 'Tarek', email: 'hassan.tarek@student.uniflow.edu' },
    reviewer: null,
  },
  aid_5003: {
    id: 'aid_5003', userId: 'usr_2012', requestedAmount: 30000, awardedAmount: 22000,
    justification: 'Outstanding academic record; merit-based aid request for continued enrollment.',
    applicantIncome: 110000, dependents: 0,
    supportingDocs: [],
    status: 'approved', reviewNote: 'Approved at partial amount per available aid budget.',
    createdAt: '2026-02-20T10:00:00.000Z', reviewedAt: '2026-02-25T11:00:00.000Z',
    user: { id: 'usr_2012', firstName: 'Farida', lastName: 'Nabil', email: 'farida.nabil@student.uniflow.edu' },
    reviewer: { id: 'usr_fin1', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test' },
  },
};

function fallbackAidDetail(id: string): AidRequest {
  return {
    id, userId: 'usr_2099', requestedAmount: 20000, awardedAmount: null,
    justification: 'Requesting financial assistance to continue enrollment for the upcoming term.',
    applicantIncome: 75000, dependents: 1,
    supportingDocs: [
      { name: 'supporting-document.pdf', url: '/files/aid/supporting-document.pdf', sizeBytes: 180_224 },
    ],
    status: 'pending', reviewNote: null, createdAt: '2026-03-10T10:00:00.000Z', reviewedAt: null,
    user: { id: 'usr_2099', firstName: 'Student', lastName: 'Applicant', email: 'applicant@student.uniflow.edu' },
    reviewer: null,
  };
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const FinancialAidDetail: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  // Aliased under /admin/financial-aid/:id, /financial/financial-aid/:id,
  // and /sa/financial-aid/:id — keep the back-button inside the same prefix.
  const location = useLocation();
  const rolePrefix = location.pathname.startsWith('/financial')
    ? '/financial'
    : location.pathname.startsWith('/sa')
    ? '/sa'
    : '/admin';

  const [request, setRequest] = useState<AidRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [awardedAmount, setAwardedAmount] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    if (!id) return;
    // Preview: resolve the mock record for this id (fallback to a generated one),
    // overriding its id so the page reflects the route param.
    const base = MOCK_AID_DETAILS[id] ?? fallbackAidDetail(id);
    setRequest({ ...base, id });
    setLoading(false);
  }, [id]);

  const isPending = request?.status === 'pending';

  // Preview: approve mutates local state only (optimistic), no network.
  const handleApprove = () => {
    if (!request) return;
    const amt = Number(awardedAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('admin.aidDetailAwardedAmtMustBePositive'));
      return;
    }
    setSubmitting('approve');
    setError('');
    setSuccess('');
    setRequest((prev) =>
      prev
        ? {
            ...prev,
            status: 'approved',
            awardedAmount: amt,
            reviewNote: approveNote.trim() || prev.reviewNote,
            reviewedAt: new Date().toISOString(),
            reviewer: { id: 'usr_admin1', firstName: 'Admin', lastName: 'User', email: 'admin@uniflow.test' },
          }
        : prev,
    );
    setSuccess(t('admin.aidDetailRequestApproved'));
    setApproveNote('');
    setSubmitting(null);
    setTimeout(() => setSuccess(''), 4000);
  };

  // Preview: reject mutates local state only (optimistic), no network.
  const handleReject = () => {
    if (!request) return;
    if (!rejectNote.trim()) {
      setError(t('admin.aidDetailNoteRequired'));
      return;
    }
    setSubmitting('reject');
    setError('');
    setSuccess('');
    setRequest((prev) =>
      prev
        ? {
            ...prev,
            status: 'rejected',
            reviewNote: rejectNote.trim(),
            reviewedAt: new Date().toISOString(),
            reviewer: { id: 'usr_admin1', firstName: 'Admin', lastName: 'User', email: 'admin@uniflow.test' },
          }
        : prev,
    );
    setSuccess(t('admin.aidDetailRequestRejected'));
    setRejectNote('');
    setSubmitting(null);
    setTimeout(() => setSuccess(''), 4000);
  };

  const statusLabel: Record<AidStatus, string> = {
    pending: t('admin.aidStatusPending'),
    approved: t('admin.aidStatusApproved'),
    rejected: t('admin.aidStatusRejected'),
    withdrawn: t('admin.aidStatusWithdrawn'),
  };

  return (
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`${glassCardStyle} p-6 flex items-start justify-between gap-4 flex-wrap`}
      >
        <div>
          <h1 className="text-black dark:text-white text-2xl font-bold flex items-center gap-2">
            <i className="ph-bold ph-hand-coins text-[#6A3FF4]"></i>
            {t('admin.financialAidDetailTitle')}
          </h1>
          {request && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {t('admin.aidDetailRequestIdLabel')} <code className="text-xs">{request.id}</code>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => navigate(`${rolePrefix}/financial-aid`)}
          className="px-4 py-2 rounded-xl bg-white/30 dark:bg-black/30 border border-white/20 dark:border-white/10 text-black dark:text-white font-bold text-sm hover:bg-white/40 dark:hover:bg-black/40 transition-colors flex items-center gap-2"
        >
          <i className="ph-bold ph-arrow-left"></i> {t('admin.aidDetailBackToQueue')}
        </button>
      </motion.div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-x-circle"></i> {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i> {success}
        </div>
      )}

      {loading ? (
        <div className={`${glassCardStyle} p-8 animate-pulse`}>
          <div className="h-4 w-1/3 bg-white/10 rounded mb-3"></div>
          <div className="h-3 w-2/3 bg-white/10 rounded"></div>
        </div>
      ) : !request ? (
        <div className={`${glassCardStyle} p-10 text-center`}>
          <i className="ph-bold ph-warning-circle text-4xl text-amber-500 block mb-3"></i>
          <h3 className="text-black dark:text-white font-bold mb-1">{t('admin.aidDetailRequestNotFound')}</h3>
        </div>
      ) : (
        <>
          <div className={`${glassCardStyle} p-6 space-y-4`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wide ${STATUS_PILL[request.status]}`}
              >
                {statusLabel[request.status] ?? request.status}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('admin.aidDetailSubmittedAt', { date: fmtDate(request.createdAt) })}
              </span>
              {request.reviewedAt && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t('admin.aidDetailReviewedAt', { date: fmtDate(request.reviewedAt) })}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Detail label={t('admin.aidDetailLblApplicant')}>
                {request.user ? (
                  <>
                    <div className="text-black dark:text-white font-medium">
                      {request.user.firstName} {request.user.lastName}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {request.user.email}
                    </div>
                  </>
                ) : (
                  t('admin.aidDetailDash')
                )}
              </Detail>
              <Detail label={t('admin.aidDetailLblReviewer')}>
                {request.reviewer ? (
                  <>
                    <div className="text-black dark:text-white font-medium">
                      {request.reviewer.firstName} {request.reviewer.lastName}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {request.reviewer.email}
                    </div>
                  </>
                ) : (
                  <span className="text-gray-500">{t('admin.aidDetailNotYetReviewed')}</span>
                )}
              </Detail>
              <Detail label={t('admin.aidDetailLblRequestedAmount')}>
                <span className="text-black dark:text-white font-bold">
                  {formatMoney(request.requestedAmount, { fractional: true })}
                </span>
              </Detail>
              <Detail label={t('admin.aidDetailLblAwardedAmount')}>
                {request.awardedAmount != null ? (
                  <span className="text-emerald-600 dark:text-emerald-300 font-bold">
                    {formatMoney(request.awardedAmount, { fractional: true })}
                  </span>
                ) : (
                  <span className="text-gray-500">{t('admin.aidDetailDash')}</span>
                )}
              </Detail>
              <Detail label={t('admin.aidDetailLblApplicantIncome')}>
                {request.applicantIncome != null
                  ? formatMoney(request.applicantIncome, { fractional: true })
                  : <span className="text-gray-500">{t('admin.aidDetailNotProvided')}</span>}
              </Detail>
              <Detail label={t('admin.aidDetailLblDependents')}>
                {request.dependents != null ? request.dependents : <span className="text-gray-500">{t('admin.aidDetailNotProvided')}</span>}
              </Detail>
            </div>

            <Detail label={t('admin.aidDetailLblJustification')}>
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white whitespace-pre-wrap">
                {request.justification || t('admin.aidDetailDash')}
              </div>
            </Detail>

            <Detail label={t('admin.aidDetailLblSupportingDocs')}>
              {Array.isArray(request.supportingDocs) && request.supportingDocs.length > 0 ? (
                <ul className="space-y-1.5">
                  {request.supportingDocs.map((d, i) => (
                    <li
                      key={`${d.url}-${i}`}
                      className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm"
                    >
                      <span className="flex items-center gap-2 min-w-0 text-black dark:text-white">
                        <i className="ph-bold ph-file text-[#6A3FF4]"></i>
                        <span className="truncate">{d.name}</span>
                        {d.sizeBytes ? (
                          <span className="text-xs text-gray-500 flex-shrink-0">
                            ({formatBytes(d.sizeBytes)})
                          </span>
                        ) : null}
                      </span>
                      {/* Preview: supporting docs are mock references; link is a
                          no-op placeholder (no backend file store). */}
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-xs font-bold text-[#7B5AFF] hover:text-[#6A3FF4]"
                      >
                        {t('admin.aidDetailOpenDoc')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm text-gray-500">{t('admin.aidDetailNoDocs')}</span>
              )}
            </Detail>

            {request.reviewNote && (
              <Detail label={t('admin.aidDetailLblReviewerNote')}>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white whitespace-pre-wrap">
                  {request.reviewNote}
                </div>
              </Detail>
            )}
          </div>

          {isPending && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className={`${glassCardStyle} p-5 space-y-3`}>
                <h2 className="text-black dark:text-white font-bold flex items-center gap-2">
                  <i className="ph-bold ph-check-circle text-emerald-500"></i>
                  {t('admin.aidDetailApproveHeading')}
                </h2>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                    {t('admin.aidDetailLblAwardedRequired')} <span className="text-red-500">{t('admin.aidDetailRequiredMark')}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={awardedAmount}
                    onChange={(e) => setAwardedAmount(e.target.value)}
                    placeholder={t('admin.aidDetailPhAwardedExample', { amount: formatMoney(request.requestedAmount, { fractional: true }) })}
                    className={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                    {t('admin.aidDetailLblNoteOptional')}
                  </label>
                  <textarea
                    rows={3}
                    value={approveNote}
                    onChange={(e) => setApproveNote(e.target.value)}
                    placeholder={t('admin.aidDetailPhApproveNote')}
                    className={`${inputStyle} resize-none`}
                  />
                </div>
                <button
                  type="button"
                  disabled={submitting !== null}
                  onClick={handleApprove}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <i
                    className={`ph-bold ${
                      submitting === 'approve' ? 'ph-spinner animate-spin' : 'ph-check'
                    }`}
                  ></i>
                  {submitting === 'approve' ? t('admin.aidDetailApproving') : t('admin.aidDetailApproveBtn')}
                </button>
              </div>

              <div className={`${glassCardStyle} p-5 space-y-3`}>
                <h2 className="text-black dark:text-white font-bold flex items-center gap-2">
                  <i className="ph-bold ph-x-circle text-red-500"></i>
                  {t('admin.aidDetailRejectHeading')}
                </h2>
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">
                    {t('admin.aidDetailLblReason')} <span className="text-red-500">{t('admin.aidDetailRequiredMark')}</span>
                  </label>
                  <textarea
                    rows={4}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder={t('admin.aidDetailPhRejectReason')}
                    className={`${inputStyle} resize-none`}
                  />
                </div>
                <button
                  type="button"
                  disabled={submitting !== null}
                  onClick={handleReject}
                  className="w-full py-2.5 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <i
                    className={`ph-bold ${
                      submitting === 'reject' ? 'ph-spinner animate-spin' : 'ph-x'
                    }`}
                  ></i>
                  {submitting === 'reject' ? t('admin.aidDetailRejecting') : t('admin.aidDetailRejectBtn')}
                </button>
              </div>
            </div>
          )}

          {!isPending && (
            <div className={`${glassCardStyle} p-5 text-center text-sm text-gray-500 dark:text-gray-400`}>
              {t('admin.aidDetailStatusNoticePrefix')} <strong className="uppercase">{statusLabel[request.status] ?? request.status}</strong> {t('admin.aidDetailStatusNoticeSuffix')}
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
      {label}
    </div>
    <div className="text-sm">{children}</div>
  </div>
);

export default FinancialAidDetail;
