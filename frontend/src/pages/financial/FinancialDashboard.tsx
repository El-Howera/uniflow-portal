// src/pages/financial/FinancialDashboard.tsx
//
// Landing page for the `financial` sub-role. Read-only financial-ops view —
// summarises revenue + outstanding + recent ledger volume, then surfaces
// quick-jump cards to the working pages that already exist under the admin
// surface (revenue overview, fee management, payroll, financial aid,
// transactions).
//
// Backend reuse: /api/admin/financial-stats (paid / pending / total +
// monthly chart) and /api/admin/transactions (recent ledger sample).
// requireScope('financial') accepts both `financial` and `admin` roles on
// the backend, so this dashboard works without any extra endpoints.

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ParticleCard } from '../../components/MagicBento';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface FinancialStats {
  summary: { paid: number; pending: number; total: number };
  chart: { months: string[]; paid: number[]; pending: number[] };
  byDepartment?: { department: string; paid: number; outstanding: number }[];
  currency?: string;
}

interface LedgerTransaction {
  id: string;
  amount: number;
  status: string;
  method: string;
  description: string;
  createdAt: string;
  userName: string;
}

// ── Preview mock data (pure front-end, no backend) ──────────────────────────
const MOCK_STATS: FinancialStats = {
  summary: { paid: 4_812_500, pending: 1_236_750, total: 6_049_250 },
  chart: {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    paid: [612_000, 698_500, 740_250, 805_000, 921_750, 1_035_000],
    pending: [210_000, 188_500, 235_000, 201_250, 196_000, 205_000],
  },
  byDepartment: [
    { department: 'Computer Science', paid: 1_840_000, outstanding: 412_000 },
    { department: 'Data Science', paid: 1_512_500, outstanding: 388_750 },
    { department: 'Cybersecurity', paid: 980_000, outstanding: 256_000 },
    { department: 'AI & Robotics', paid: 480_000, outstanding: 180_000 },
  ],
  currency: 'EGP',
};

const MOCK_LEDGER: LedgerTransaction[] = [
  { id: 'txn-2041', amount: 24_500, status: 'completed', method: 'credit_card', description: 'Spring 2026 Tuition — Installment 2', createdAt: '2026-06-18T10:24:00Z', userName: 'Mariam Hassan' },
  { id: 'txn-2040', amount: 1_200, status: 'completed', method: 'cash', description: 'Transcript issuance fee', createdAt: '2026-06-17T14:05:00Z', userName: 'Omar Tarek' },
  { id: 'txn-2039', amount: 18_000, status: 'completed', method: 'bank_transfer', description: 'Lab equipment deposit', createdAt: '2026-06-16T09:42:00Z', userName: 'Salma Adel' },
  { id: 'txn-2038', amount: -6_500, status: 'refunded', method: 'credit_card', description: 'Course withdrawal refund — CS305', createdAt: '2026-06-15T16:30:00Z', userName: 'Youssef Nabil' },
  { id: 'txn-2037', amount: 32_000, status: 'completed', method: 'credit_card', description: 'Spring 2026 Tuition — Full payment', createdAt: '2026-06-14T11:18:00Z', userName: 'Nour El-Din' },
  { id: 'txn-2036', amount: 900, status: 'completed', method: 'cash', description: 'Library fine settlement', createdAt: '2026-06-13T13:55:00Z', userName: 'Aya Mostafa' },
  { id: 'txn-2035', amount: 24_500, status: 'completed', method: 'bank_transfer', description: 'Spring 2026 Tuition — Installment 1', createdAt: '2026-06-12T08:40:00Z', userName: 'Khaled Samir' },
  { id: 'txn-2034', amount: 3_500, status: 'completed', method: 'paypal', description: 'Re-examination fee — MATH201', createdAt: '2026-06-11T17:12:00Z', userName: 'Hana Fathy' },
];

const StatTile: React.FC<{
  label: string;
  value: string;
  hint: string;
  icon: string;
  toPath: string;
  accent?: string;
  loading?: boolean;
}> = ({ label, value, hint, icon, toPath, accent = '#6A3FF4', loading }) => {
  const navigate = useNavigate();
  return (
    <ParticleCard
      className={`${glassCardStyle} p-6 flex flex-col justify-between h-full cursor-pointer`}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
      particleCount={8}
      glowColor="132, 0, 255"
    >
      <div className="flex justify-between items-start" onClick={() => navigate(toPath)}>
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${accent}33` }}
          >
            <i className={`ph-fill ${icon} text-xl`} style={{ color: accent }} />
          </div>
          <span className="text-black dark:text-gray-300 font-bold text-sm uppercase tracking-wider">
            {label}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(toPath);
          }}
          className="w-8 h-8 rounded-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all group"
        >
          <i className="ph-bold ph-arrow-right text-black dark:text-gray-300 group-hover:text-white transition-colors" />
        </button>
      </div>
      <div className="my-3">
        {loading ? (
          <div className="h-10 w-32 bg-white/10 animate-pulse rounded-lg" />
        ) : (
          <span className="text-black dark:text-white font-bold text-2xl sm:text-3xl">{value}</span>
        )}
      </div>
      <p className="text-black dark:text-gray-300 text-xs leading-relaxed">{hint}</p>
    </ParticleCard>
  );
};

const QuickAction: React.FC<{
  title: string;
  description: string;
  icon: string;
  toPath: string;
}> = ({ title, description, icon, toPath }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(toPath)}
      className={`${glassCardStyle} p-5 text-left hover:border-[#6A3FF4]/40 transition-all group`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center flex-shrink-0 group-hover:bg-[#6A3FF4] transition-colors">
          <i className={`ph-fill ${icon} text-xl text-[#6A3FF4] group-hover:text-white transition-colors`} />
        </div>
        <div className="min-w-0">
          <p className="text-black dark:text-white font-semibold text-sm">{title}</p>
          <p className="text-gray-600 dark:text-gray-400 text-xs mt-1 leading-relaxed">{description}</p>
        </div>
        <i className="ph-bold ph-arrow-right text-gray-500 group-hover:text-[#6A3FF4] transition-colors ml-auto flex-shrink-0" />
      </div>
    </button>
  );
};

const FinancialDashboard: React.FC = () => {
  const t = useT();
  const currency = useCurrency();
  const navigate = useNavigate();
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // MVP build: populate from inline mock data, no backend.
    setStats(MOCK_STATS);
    setLedger(MOCK_LEDGER);
    setIsLoading(false);
  }, []);

  const outstanding = stats?.summary.pending ?? 0;
  const paid = stats?.summary.paid ?? 0;
  const total = stats?.summary.total ?? 0;
  const collectionRate = total > 0 ? Math.round((paid / total) * 100) : 0;

  const recentLedgerVolume = useMemo(
    () => ledger.reduce((acc, txn) => acc + (txn.amount || 0), 0),
    [ledger]
  );

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-black dark:text-white mb-1 flex items-center gap-2">
          <i className="ph-fill ph-currency-circle-dollar text-[#6A3FF4]" />
          {t('financial.dashboardTitle')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {t('financial.dashboardSubtitle')}
        </p>
      </motion.div>

      {/* Top KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label={t('financial.totalRevenue')}
          value={formatMoney(total, { code: currency })}
          hint={t('financial.totalRevenueHint')}
          icon="ph-chart-line-up"
          toPath="/financial/revenue-overview"
          loading={isLoading}
        />
        <StatTile
          label={t('financial.totalCollected')}
          value={formatMoney(paid, { code: currency })}
          hint={t('financial.collectedHint', { rate: collectionRate })}
          icon="ph-check-circle"
          toPath="/financial/revenue-overview"
          accent="#22C55E"
          loading={isLoading}
        />
        <StatTile
          label={t('financial.totalOutstanding')}
          value={formatMoney(outstanding, { code: currency })}
          hint={t('financial.outstandingHint')}
          icon="ph-warning-circle"
          toPath="/financial/revenue-overview"
          accent="#F59E0B"
          loading={isLoading}
        />
        <StatTile
          label={t('financial.recentLedger')}
          value={formatMoney(recentLedgerVolume, { code: currency })}
          hint={t('financial.recentLedgerHint', { n: ledger.length })}
          icon="ph-receipt"
          toPath="/financial/transactions"
          accent="#A855F7"
          loading={isLoading}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <QuickAction
          title={t('financial.viewRevenueOverview')}
          description={t('financial.qaRevenueDesc')}
          icon="ph-chart-pie-slice"
          toPath="/financial/revenue-overview"
        />
        <QuickAction
          title={t('financial.manageFees')}
          description={t('financial.qaFeesDesc')}
          icon="ph-credit-card"
          toPath="/financial/fee-management"
        />
        <QuickAction
          title={t('financial.payrollLink')}
          description={t('financial.qaPayrollDesc')}
          icon="ph-receipt"
          toPath="/financial/payroll"
        />
        <QuickAction
          title={t('financial.financialAidLink')}
          description={t('financial.qaAidDesc')}
          icon="ph-hand-coins"
          toPath="/financial/financial-aid"
        />
        <QuickAction
          title={t('financial.transactionsTitle')}
          description={t('financial.qaTxnsDesc')}
          icon="ph-list-magnifying-glass"
          toPath="/financial/transactions"
        />
      </div>

      {/* Recent transactions preview */}
      <div className={`${glassCardStyle} p-6`}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-black dark:text-white text-lg font-bold flex items-center">
            <i className="ph-bold ph-receipt mr-2 text-[#6A3FF4]" />
            {t('financial.recentTransactions')}
          </h2>
          <button
            onClick={() => navigate('/financial/transactions')}
            className="text-sm text-black dark:text-gray-300 border border-white/20 dark:border-white/10 rounded-lg px-4 py-1.5 hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
          >
            {t('common.viewAll')}
          </button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 w-full bg-white/5 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : ledger.length === 0 ? (
          <div className="text-center py-10 text-gray-500 italic text-sm">
            {t('financial.noTransactions')}
          </div>
        ) : (
          <div className="space-y-2">
            {ledger.slice(0, 6).map((txn) => {
              const isCredit = txn.amount < 0 || txn.status === 'refunded';
              return (
                <div
                  key={txn.id}
                  className="flex items-center justify-between p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-black dark:text-white text-sm font-medium truncate">
                      {txn.description || '—'}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {txn.userName || t('financial.unknownUser')} · {new Date(txn.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`font-bold text-sm whitespace-nowrap ml-3 ${
                      isCredit ? 'text-red-500' : 'text-green-500'
                    }`}
                  >
                    {isCredit ? '-' : '+'}
                    {formatMoney(Math.abs(txn.amount), { code: currency })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FinancialDashboard;
