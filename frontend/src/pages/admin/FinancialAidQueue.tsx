/**
 * FinancialAidQueue — Plan 7 Phase 6 admin/financial queue.
 *
 * Lists every financial aid request with a status filter (`GlassDropdown`).
 * Each row links to `/admin/financial-aid/:id` for the approve/reject form.
 * Backend gates this page on the `financial` scope (admin >
 * financial), so dispatching to other admin pages with the same chrome.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatMoney } from '../../utils/format';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

type AidStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

interface UserStub {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface AidRequestRow {
  id: string;
  userId: string;
  requestedAmount: string | number;
  awardedAmount?: string | number | null;
  justification: string;
  status: AidStatus;
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  user?: UserStub | null;
}

// Status options are localised at render-time inside the component.

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A realistic financial-aid queue.
const MOCK_AID_REQUESTS: AidRequestRow[] = [
  {
    id: 'aid_5001', userId: 'usr_2010', requestedAmount: 25000, awardedAmount: null,
    justification: 'Family income reduced after parent lost employment; requesting tuition assistance for Spring 2026.',
    status: 'pending', reviewNote: null, createdAt: '2026-03-12T09:00:00.000Z', reviewedAt: null,
    user: { id: 'usr_2010', firstName: 'Aya', lastName: 'Sami', email: 'aya.sami@student.uniflow.edu' },
  },
  {
    id: 'aid_5002', userId: 'usr_2011', requestedAmount: 18000, awardedAmount: null,
    justification: 'Single-parent household; requesting partial coverage of lab and housing fees.',
    status: 'pending', reviewNote: null, createdAt: '2026-03-15T14:30:00.000Z', reviewedAt: null,
    user: { id: 'usr_2011', firstName: 'Hassan', lastName: 'Tarek', email: 'hassan.tarek@student.uniflow.edu' },
  },
  {
    id: 'aid_5003', userId: 'usr_2012', requestedAmount: 30000, awardedAmount: 22000,
    justification: 'Outstanding academic record; merit-based aid request for continued enrollment.',
    status: 'approved', reviewNote: 'Approved at partial amount per available aid budget.',
    createdAt: '2026-02-20T10:00:00.000Z', reviewedAt: '2026-02-25T11:00:00.000Z',
    user: { id: 'usr_2012', firstName: 'Farida', lastName: 'Nabil', email: 'farida.nabil@student.uniflow.edu' },
  },
  {
    id: 'aid_5004', userId: 'usr_2013', requestedAmount: 12000, awardedAmount: null,
    justification: 'Requesting emergency aid for unexpected medical expenses.',
    status: 'rejected', reviewNote: 'Insufficient supporting documentation provided.',
    createdAt: '2026-02-18T08:45:00.000Z', reviewedAt: '2026-02-22T16:20:00.000Z',
    user: { id: 'usr_2013', firstName: 'Omar', lastName: 'Gamal', email: 'omar.gamal@student.uniflow.edu' },
  },
  {
    id: 'aid_5005', userId: 'usr_2014', requestedAmount: 20000, awardedAmount: null,
    justification: 'Requesting tuition assistance; withdrew after securing external scholarship.',
    status: 'withdrawn', reviewNote: null,
    createdAt: '2026-03-01T12:00:00.000Z', reviewedAt: '2026-03-08T09:30:00.000Z',
    user: { id: 'usr_2014', firstName: 'Mona', lastName: 'Adel', email: 'mona.adel@student.uniflow.edu' },
  },
];

const STATUS_PILL: Record<AidStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-500 dark:text-gray-400 border-gray-500/30',
};

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const FinancialAidQueue: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  // Aliased under /admin/financial-aid, /financial/financial-aid, and
  // /sa/financial-aid — keep detail-page navigation in the same prefix.
  const location = useLocation();
  const rolePrefix = location.pathname.startsWith('/financial')
    ? '/financial'
    : location.pathname.startsWith('/sa')
    ? '/sa'
    : '/admin';
  const [status, setStatus] = useState<string>('pending');
  const [rows, setRows] = useState<AidRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState('');

  useEffect(() => {
    // Preview: load static aid requests, no backend. The status dropdown filters
    // the TABLE client-side; the stat tiles always reflect full totals.
    setRows(MOCK_AID_REQUESTS);
    setLoading(false);
  }, []);

  const counts = useMemo(() => {
    const c: Record<AidStatus, number> = { pending: 0, approved: 0, rejected: 0, withdrawn: 0 };
    rows.forEach((r) => {
      if (r.status in c) c[r.status]++;
    });
    return c;
  }, [rows]);

  // Table is filtered client-side; tiles above always show full totals.
  const visibleRows = useMemo(
    () => (status === 'all' ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

  const statusOptions = [
    { value: 'all', label: t('admin.aidQueueStatusAll') },
    { value: 'pending', label: t('admin.aidQueueStatusPending') },
    { value: 'approved', label: t('admin.aidQueueStatusApproved') },
    { value: 'rejected', label: t('admin.aidQueueStatusRejected') },
    { value: 'withdrawn', label: t('admin.aidQueueStatusWithdrawn') },
  ];

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
        className={`${glassCardStyle} p-6`}
      >
        <h1 className="text-black dark:text-white text-2xl font-bold flex items-center gap-2">
          <i className="ph-bold ph-hand-coins text-[#6A3FF4]"></i>
          {t('admin.financialAidQueue')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('admin.aidQueueSubtitle')}
        </p>
      </motion.div>

      <div className={`${glassCardStyle} p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center`}>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatTile label={t('admin.aidQueueTilePending')} value={counts.pending} color="amber" />
          <StatTile label={t('admin.aidQueueTileApproved')} value={counts.approved} color="emerald" />
          <StatTile label={t('admin.aidQueueTileRejected')} value={counts.rejected} color="red" />
          <StatTile label={t('admin.aidQueueTileWithdrawn')} value={counts.withdrawn} color="gray" />
        </div>
        <div className="min-w-[200px]">
          <GlassDropdown
            value={status}
            onChange={setStatus}
            options={statusOptions}
            direction="up"
            className="w-full"
          />
        </div>
      </div>

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
      ) : visibleRows.length === 0 ? (
        <div className={`${glassCardStyle} p-10 text-center`}>
          <i className="ph-bold ph-folder-open text-4xl text-[#6A3FF4] block mb-3"></i>
          <h3 className="text-black dark:text-white font-bold mb-1">{t('admin.aidQueueNoRequestsFound')}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('admin.aidQueueNoRequestsHint')}
          </p>
        </div>
      ) : (
        <div className={`${glassCardStyle} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-white/10">
                <tr>
                  <th className="px-4 py-3">{t('admin.aidQueueColApplicant')}</th>
                  <th className="px-4 py-3">{t('admin.aidQueueColRequested')}</th>
                  <th className="px-4 py-3">{t('admin.aidQueueColAwarded')}</th>
                  <th className="px-4 py-3">{t('admin.aidQueueColSubmitted')}</th>
                  <th className="px-4 py-3">{t('admin.aidQueueColStatus')}</th>
                  <th className="px-4 py-3 text-right">{t('admin.aidQueueColAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleRows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 text-black dark:text-white">
                      <div className="font-medium truncate max-w-[260px]">
                        {r.user ? `${r.user.firstName} ${r.user.lastName}` : t('admin.aidQueueDash')}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-[260px]">
                        {r.user?.email || ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-black dark:text-white font-medium">
                      {formatMoney(r.requestedAmount, { fractional: true })}
                    </td>
                    <td className="px-4 py-3 text-emerald-600 dark:text-emerald-300">
                      {r.awardedAmount != null
                        ? formatMoney(r.awardedAmount, { fractional: true })
                        : t('admin.aidQueueDash')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wide ${STATUS_PILL[r.status]}`}
                      >
                        {statusLabel[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`${rolePrefix}/financial-aid/${r.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-[#6A3FF4]/15 text-[#6A3FF4] dark:text-[#bda8ff] border border-[#6A3FF4]/30 hover:bg-[#6A3FF4]/25 transition-colors text-xs font-bold"
                      >
                        {t('admin.aidQueueReview')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const TILE_COLORS: Record<string, string> = {
  amber: 'text-amber-600 dark:text-amber-300 border-amber-500/30',
  emerald: 'text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  red: 'text-red-500 dark:text-red-400 border-red-500/30',
  gray: 'text-gray-500 dark:text-gray-400 border-gray-500/30',
};

const StatTile: React.FC<{ label: string; value: number; color: keyof typeof TILE_COLORS }> = ({ label, value, color }) => (
  <div
    className={`bg-white/5 border ${TILE_COLORS[color]} rounded-xl px-3 py-2 flex items-center justify-between`}
  >
    <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
    <span className="text-lg font-bold text-black dark:text-white">{value}</span>
  </div>
);

export default FinancialAidQueue;
