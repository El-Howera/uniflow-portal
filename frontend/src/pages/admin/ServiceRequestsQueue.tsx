// frontend/src/pages/admin/ServiceRequestsQueue.tsx
//
// Admin review queue for student service requests (e.g. transcript copy,
// late-fee waiver request, lab-fee adjustment). Approving auto-issues an
// invoice in the student's Payments tab via the backend's atomic transaction.
//
// Visible to: admin, sa, financial (server gate enforces — frontend hides
// the page from sidebars without the permission, but unauthorised hits hit
// 403 from the backend regardless).

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface ServiceRequest {
  id: string;
  serviceName?: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  amount?: string | number | null;
  description?: string | null;
  notes?: string | null;
  createdAt: string;
  serviceFee?: {
    id: string;
    name: string;
    amount: string | number;
    category: string;
    description?: string | null;
  } | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    odId?: string | null;
  };
  processedBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

const toNum = (v: unknown): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A realistic service-request review queue.
const MOCK_REQUESTS: ServiceRequest[] = [
  {
    id: 'sr_7001', serviceName: 'Transcript Copy', status: 'pending', amount: 200,
    description: 'Requesting an official transcript copy for a scholarship application.',
    notes: null, createdAt: '2026-03-20T10:15:00.000Z',
    serviceFee: { id: 'fee_4', name: 'Transcript Copy', amount: 200, category: 'document', description: 'Official transcript document' },
    user: { id: 'usr_2001', firstName: 'Yousef', lastName: 'Mahmoud', email: 'yousef.mahmoud@student.uniflow.edu', odId: 'OD-2023-0301' },
    processedBy: null,
  },
  {
    id: 'sr_7002', serviceName: 'Late Fee Waiver', status: 'pending', amount: null,
    description: 'Requesting a waiver of the library late fee due to a documented medical absence.',
    notes: null, createdAt: '2026-03-22T13:40:00.000Z',
    serviceFee: null,
    user: { id: 'usr_2003', firstName: 'Khaled', lastName: 'Abdullah', email: 'khaled.abdullah@student.uniflow.edu', odId: 'OD-2023-0451' },
    processedBy: null,
  },
  {
    id: 'sr_7003', serviceName: 'Exam Re-sit', status: 'approved', amount: 600,
    description: 'Requesting a supplementary exam for CS305.',
    notes: 'Approved — invoice issued.', createdAt: '2026-03-10T09:00:00.000Z',
    serviceFee: { id: 'fee_6', name: 'Exam Re-sit', amount: 600, category: 'exam', description: 'Per-course supplementary exam' },
    user: { id: 'usr_2005', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@student.uniflow.edu', odId: 'OD-2024-0233' },
    processedBy: { id: 'usr_fin1', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test' },
  },
  {
    id: 'sr_7004', serviceName: 'Lab Fee Adjustment', status: 'rejected', amount: 1500,
    description: 'Requesting a reduction of the lab fee — not enrolled in the lab section.',
    notes: 'Student is enrolled in the lab section per registration records.',
    createdAt: '2026-03-12T15:20:00.000Z',
    serviceFee: { id: 'fee_2', name: 'Lab Access Fee', amount: 1500, category: 'lab', description: 'Physics & engineering lab usage per term' },
    user: { id: 'usr_2002', firstName: 'Mariam', lastName: 'Hassan', email: 'mariam.hassan@student.uniflow.edu', odId: 'OD-2024-0112' },
    processedBy: { id: 'usr_fin1', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test' },
  },
];

// Status options derived at render time so labels follow the active locale.

const ServiceRequestsQueue: React.FC = () => {
  const t = useT();
  const currency = useCurrency();
  const STATUS_FILTERS = useMemo(() => [
    { value: 'pending',  label: t('sa.srqStatPending') },
    { value: 'approved', label: t('sa.srqStatApproved') },
    { value: 'rejected', label: t('sa.srqStatRejected') },
    { value: 'all',      label: t('sa.srqStatAll') },
  ], [t]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [noteByRow, setNoteByRow] = useState<Record<string, string>>({});
  const [amountByRow, setAmountByRow] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const showToast = (kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4500);
  };

  // Preview: filter the static mock requests client-side (no backend).
  useEffect(() => {
    setLoading(true);
    const filtered =
      statusFilter === 'all'
        ? MOCK_REQUESTS
        : MOCK_REQUESTS.filter((r) => r.status === statusFilter);
    setRequests(filtered);
    setLoading(false);
  }, [statusFilter]);

  // Preview: review mutates local state only (optimistic), no network.
  const review = (req: ServiceRequest, action: 'approve' | 'reject') => {
    setReviewingId(req.id);
    const overrideAmount = amountByRow[req.id];
    const note = noteByRow[req.id]?.trim();
    const nextStatus: ServiceRequest['status'] = action === 'approve' ? 'approved' : 'rejected';
    let appliedAmount: number | null = null;
    if (action === 'approve' && overrideAmount) {
      const n = parseFloat(overrideAmount);
      if (Number.isFinite(n) && n > 0) appliedAmount = n;
    }
    setRequests((prev) =>
      prev.map((r) =>
        r.id === req.id
          ? {
              ...r,
              status: nextStatus,
              amount: appliedAmount != null ? appliedAmount : r.amount,
              notes: note || r.notes,
              processedBy: { id: 'usr_admin1', firstName: 'Admin', lastName: 'User', email: 'admin@uniflow.test' },
            }
          : r,
      ),
    );
    showToast(
      'success',
      action === 'approve'
        ? t('sa.srqApprovedDetail', { tail: '' })
        : t('sa.srqRejectedDetail'),
    );
    setReviewingId(null);
  };

  const visible = useMemo(() => requests, [requests]);

  return (
    <div className="flex-1 p-6 pb-16 space-y-6">
      <AnimateOnView enabled={false}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1">
              {t('sa.srqPageTitle')}
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              {t('sa.srqPageHint')}
            </p>
          </div>
          <div className="w-48">
            <GlassDropdown
              value={statusFilter}
              onChange={(v) => setStatusFilter(String(v))}
              options={STATUS_FILTERS}
              direction="down"
              className="w-full"
            />
          </div>
        </div>
      </AnimateOnView>

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`${glassCardStyle} h-32 animate-pulse`}></div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className={`${glassCardStyle} p-12 text-center`}>
          <i className="ph-bold ph-tray text-5xl text-gray-400 mb-4 block" />
          <p className="text-black dark:text-white font-semibold text-lg mb-1">
            {statusFilter === 'pending' ? t('sa.srqEmptyPending') : t('sa.srqEmptyOther', { status: statusFilter })}
          </p>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t('sa.srqEmptyHintLong')}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {visible.map((req) => {
            const amount = toNum(req.amount ?? req.serviceFee?.amount);
            const isPending = req.status === 'pending';
            const isThisRowBusy = reviewingId === req.id;
            const statusClass =
              req.status === 'approved' ? 'text-green-500 bg-green-500/15 border-green-500/30'
              : req.status === 'rejected' ? 'text-red-500 bg-red-500/15 border-red-500/30'
              : 'text-yellow-500 bg-yellow-500/15 border-yellow-500/30';

            return (
              <motion.div
                key={req.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`${glassCardStyle} p-5`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-black dark:text-white font-bold text-base">
                        {req.serviceFee?.name || req.serviceName || t('sa.srqServiceFallback')}
                      </h3>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${statusClass}`}>
                        {STATUS_FILTERS.find(f => f.value === req.status)?.label ?? req.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      <span className="font-semibold text-black dark:text-white">{req.user.firstName} {req.user.lastName}</span>
                      <span> · {req.user.email}</span>
                      {req.user.odId && <span> · {req.user.odId}</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {t('sa.srqSubmittedOn', { date: new Date(req.createdAt).toLocaleString() })}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t('sa.srqDefaultAmount')}</div>
                    <div className="text-[#6A3FF4] text-xl font-bold">
                      {amount > 0 ? formatMoney(amount) : '—'}
                    </div>
                    <div className="text-[10px] text-gray-500">{currency}</div>
                  </div>
                </div>

                {req.description && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 bg-white/5 dark:bg-black/20 rounded-lg p-3">
                    {req.description}
                  </p>
                )}
                {req.notes && (
                  <p className="text-[11px] text-gray-500 italic mb-2 whitespace-pre-wrap">
                    {req.notes}
                  </p>
                )}
                {req.processedBy && (
                  <p className="text-[11px] text-gray-500 mb-2">
                    {t('sa.srqReviewedBy', { first: req.processedBy.firstName, last: req.processedBy.lastName })}
                  </p>
                )}

                {isPending && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                        {t('sa.srqOverrideAmount')} <span className="normal-case text-gray-500">{t('sa.srqOverrideHint')}</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={amountByRow[req.id] || ''}
                        onChange={(e) => setAmountByRow((p) => ({ ...p, [req.id]: e.target.value }))}
                        placeholder={amount > 0 ? formatMoney(amount) : t('sa.srqAmountPh')}
                        className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                        {t('sa.srqNoteToStudent')} <span className="normal-case text-gray-500">{t('sa.srqNoteOptional')}</span>
                      </label>
                      <input
                        value={noteByRow[req.id] || ''}
                        onChange={(e) => setNoteByRow((p) => ({ ...p, [req.id]: e.target.value }))}
                        placeholder={t('sa.srqNotePh')}
                        className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                      />
                    </div>
                    <div className="sm:col-span-2 flex gap-2 mt-1">
                      <button
                        onClick={() => review(req, 'approve')}
                        disabled={isThisRowBusy}
                        className="flex-1 bg-[#6A3FF4] text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {isThisRowBusy ? t('sa.srqWorking') : t('sa.srqApproveLong')}
                      </button>
                      <button
                        onClick={() => review(req, 'reject')}
                        disabled={isThisRowBusy}
                        className="flex-1 bg-red-500/20 text-red-400 border border-red-500/30 font-bold py-2.5 rounded-xl text-sm hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        {t('sa.srqRejectBtn')}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className={`fixed bottom-6 end-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold max-w-sm ${
            toast.kind === 'success'
              ? 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30'
              : 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30'
          }`}
        >
          <i className={`ph-bold ${toast.kind === 'success' ? 'ph-check-circle' : 'ph-x-circle'} mr-2`} />
          {toast.text}
        </motion.div>
      )}
    </div>
  );
};

export default ServiceRequestsQueue;
