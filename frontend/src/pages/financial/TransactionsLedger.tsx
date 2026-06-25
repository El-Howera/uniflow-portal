// src/pages/financial/TransactionsLedger.tsx
//
// Standalone transaction ledger page for the financial sub-role. Lifted
// out of Financials.tsx (where the same ledger lives as one section of
// many) so the "Transactions" sidebar entry isn't a duplicate of
// "Revenue Overview".
//
// Endpoint: GET /api/admin/transactions (paginated, filterable). Uses
// the same query shape as the embedded ledger so it stays in lockstep.

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatMoney, useCurrency } from '../../utils/format';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface LedgerTransaction {
  id: string;
  amount: number;
  type: string;
  method: string;
  status: string;
  description: string;
  receiptNumber?: string;
  createdAt: string;
  userId?: string | null;
  userName: string;
  userEmail: string;
  invoiceId?: string | null;
  invoiceTitle?: string;
}

const PAGE_SIZE = 20;

// ── Preview mock data (pure front-end, no backend) ──────────────────────────
const FIRST_NAMES = ['Mariam', 'Omar', 'Salma', 'Youssef', 'Nour', 'Aya', 'Khaled', 'Hana', 'Tarek', 'Layla', 'Karim', 'Farida', 'Ahmed', 'Mona', 'Hassan', 'Rana'];
const LAST_NAMES = ['Hassan', 'Tarek', 'Adel', 'Nabil', 'El-Din', 'Mostafa', 'Samir', 'Fathy', 'Mansour', 'Ibrahim', 'Saleh', 'Gamal', 'Reda', 'Aziz', 'Sherif', 'Kamel'];
const METHODS = ['credit_card', 'bank_transfer', 'paypal', 'apple_pay', 'cash'];
const STATUSES = ['completed', 'completed', 'completed', 'pending', 'failed', 'refunded'];
const DESCRIPTIONS = [
  'Spring 2026 Tuition — Installment 1',
  'Spring 2026 Tuition — Installment 2',
  'Spring 2026 Tuition — Full payment',
  'Lab equipment deposit',
  'Transcript issuance fee',
  'Re-examination fee — MATH201',
  'Library fine settlement',
  'Course withdrawal refund — CS305',
  'Student activity fee',
  'Certificate replacement fee',
];

const buildMockLedger = (): LedgerTransaction[] => {
  const rows: LedgerTransaction[] = [];
  for (let i = 0; i < 64; i += 1) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 3) % LAST_NAMES.length];
    const status = STATUSES[i % STATUSES.length];
    const isRefund = status === 'refunded';
    const type = isRefund ? 'refund' : i % 11 === 0 ? 'financial_aid' : 'payment';
    const baseAmount = [24_500, 32_000, 18_000, 3_500, 1_200, 900, 6_500, 12_000, 2_400, 5_000][i % 10];
    const amount = isRefund ? -baseAmount : baseAmount;
    // Dates spread across 2026, most recent first.
    const day = 28 - (i % 28);
    const month = 6 - Math.floor(i / 12);
    const mm = String(Math.max(1, month)).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    rows.push({
      id: `txn-${2100 - i}`,
      amount,
      type,
      method: METHODS[(i * 2) % METHODS.length],
      status,
      description: DESCRIPTIONS[i % DESCRIPTIONS.length],
      receiptNumber: `RCT-2026-${String(2100 - i).padStart(5, '0')}`,
      createdAt: `2026-${mm}-${dd}T${String(8 + (i % 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00Z`,
      userId: `usr-${1000 + i}`,
      userName: `${first} ${last}`,
      userEmail: `${first.toLowerCase()}.${last.toLowerCase().replace('-', '')}@uniflow.edu`,
      invoiceId: `inv-${5000 + i}`,
      invoiceTitle: DESCRIPTIONS[i % DESCRIPTIONS.length],
    });
  }
  return rows;
};

const MOCK_LEDGER_ALL = buildMockLedger();

const TransactionsLedger: React.FC = () => {
  const t = useT();
  const currency = useCurrency();
  const navigate = useNavigate();
  // Aliased under /financial/transactions and (via App.tsx) any future
  // /admin/transactions route — keep detail-page navigation in the same prefix.
  const location = useLocation();
  const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';

  const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [method, setMethod] = useState('all');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback((offset: number) => {
    setLoading(true);
    // MVP build: filter + paginate the inline mock ledger, no backend.
    const term = search.trim().toLowerCase();
    const filtered = MOCK_LEDGER_ALL.filter((txn) => {
      if (term) {
        const haystack = `${txn.userName} ${txn.userEmail} ${txn.description} ${txn.receiptNumber ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (status !== 'all' && txn.status !== status) return false;
      if (method !== 'all' && txn.method !== method) return false;
      if (type !== 'all' && txn.type !== type) return false;
      if (from && txn.createdAt.slice(0, 10) < from) return false;
      if (to && txn.createdAt.slice(0, 10) > to) return false;
      return true;
    });
    const page = filtered.slice(offset, offset + PAGE_SIZE);
    setLedger((prev) => (offset > 0 ? [...prev, ...page] : page));
    setTotal(filtered.length);
    setLoading(false);
  }, [search, status, method, type, from, to]);

  // Initial load
  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch on filter change (debounced 350ms)
  useEffect(() => {
    const id = setTimeout(() => load(0), 350);
    return () => clearTimeout(id);
  }, [search, status, method, type, from, to, load]);

  // Quick summary tallies (computed off the loaded rows so they reflect
  // the current filter set).
  const summary = ledger.reduce(
    (acc, txn) => {
      const amt = txn.amount || 0;
      if (txn.type === 'refund' || amt < 0) acc.refunds += Math.abs(amt);
      else if (txn.status === 'completed') acc.collected += amt;
      else if (txn.status === 'pending') acc.pending += amt;
      return acc;
    },
    { collected: 0, refunds: 0, pending: 0 }
  );

  return (
    <div className="space-y-6 pb-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-3xl font-bold text-black dark:text-white mb-1 flex items-center gap-2">
          <i className="ph-fill ph-list-magnifying-glass text-[#6A3FF4]" />
          {t('financial.transactionsTitle')}
        </h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {t('financial.qaTxnsDesc')}
        </p>
      </motion.div>

      {/* Filtered summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${glassCardStyle} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('financial.tileCollected')}</p>
              <p className="text-2xl font-bold text-emerald-500 mt-1">
                {formatMoney(summary.collected, { code: currency })}
              </p>
            </div>
            <i className="ph-fill ph-check-circle text-emerald-500 text-3xl opacity-50" />
          </div>
        </div>
        <div className={`${glassCardStyle} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('financial.tileRefunded')}</p>
              <p className="text-2xl font-bold text-red-500 mt-1">
                {formatMoney(summary.refunds, { code: currency })}
              </p>
            </div>
            <i className="ph-fill ph-arrow-u-up-left text-red-500 text-3xl opacity-50" />
          </div>
        </div>
        <div className={`${glassCardStyle} p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('financial.tilePending')}</p>
              <p className="text-2xl font-bold text-amber-500 mt-1">
                {formatMoney(summary.pending, { code: currency })}
              </p>
            </div>
            <i className="ph-fill ph-clock text-amber-500 text-3xl opacity-50" />
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className={`${glassCardStyle} p-6`}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-black dark:text-white">{t('financial.allTransactions')}</h2>
            <p className="text-gray-500 text-xs">
              {t('financial.showingOf', { shown: ledger.length, total: total })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <div className="relative lg:col-span-2">
            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('financial.searchPlaceholder')}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
            />
          </div>
          <GlassDropdown
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('financial.allStatuses') },
              { value: 'completed', label: t('financial.statusCompleted') },
              { value: 'pending', label: t('financial.statusPending') },
              { value: 'failed', label: t('financial.statusFailed') },
              { value: 'refunded', label: t('financial.statusRefunded') },
            ]}
            direction="auto"
            className="w-full"
          />
          <GlassDropdown
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: t('financial.allTypes') },
              { value: 'payment', label: t('financial.typePayment') },
              { value: 'refund', label: t('financial.typeRefund') },
              { value: 'financial_aid', label: t('financial.financialAidLink') },
            ]}
            direction="auto"
            className="w-full"
          />
          <GlassDropdown
            value={method}
            onChange={setMethod}
            options={[
              { value: 'all', label: t('financial.allMethods') },
              { value: 'credit_card', label: t('financial.methodCard') },
              { value: 'bank_transfer', label: t('financial.methodBank') },
              { value: 'paypal', label: 'PayPal' },
              { value: 'apple_pay', label: 'Apple Pay' },
              { value: 'cash', label: t('financial.methodCash') },
            ]}
            direction="auto"
            className="w-full"
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-2 py-2 text-xs text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl [color-scheme:dark]"
              title={t('financial.fromDate')}
            />
            <span className="text-gray-500 text-xs">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-2 py-2 text-xs text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl [color-scheme:dark]"
              title={t('financial.toDate')}
            />
          </div>
        </div>

        {ledger.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-12">
            {loading ? t('staff.loading') : t('financial.noFilterMatch')}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                    <th className="text-left py-2 pr-4 font-bold">{t('financial.txnDate')}</th>
                    <th className="text-left py-2 pr-4 font-bold">{t('financial.txnStudent')}</th>
                    <th className="text-left py-2 pr-4 font-bold">{t('financial.txnDescription')}</th>
                    <th className="text-left py-2 pr-4 font-bold">{t('financial.txnMethod')}</th>
                    <th className="text-left py-2 pr-4 font-bold">{t('financial.txnStatus')}</th>
                    <th className="text-right py-2 pr-4 font-bold">{t('financial.txnAmount')}</th>
                    <th className="text-right py-2 font-bold">{t('staff.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {ledger.map((txn) => (
                    <tr key={txn.id} className="hover:bg-white/5 transition-colors">
                      <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                        {new Date(txn.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4 text-black dark:text-white font-medium">
                        {txn.userName}
                      </td>
                      <td className="py-2 pr-4 text-gray-400 max-w-[260px] truncate">
                        {txn.description || txn.invoiceTitle || '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/5 text-gray-400 uppercase">
                          {txn.method}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                            txn.status === 'completed'
                              ? 'bg-green-500/10 text-green-400'
                              : txn.status === 'refunded'
                              ? 'bg-red-500/10 text-red-400'
                              : txn.status === 'failed'
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-yellow-500/10 text-yellow-400'
                          }`}
                        >
                          {txn.status}
                        </span>
                      </td>
                      <td
                        className={`py-2 pr-4 text-right font-bold ${
                          txn.type === 'refund' || txn.amount < 0
                            ? 'text-red-400'
                            : 'text-black dark:text-white'
                        }`}
                      >
                        {txn.type === 'refund' || txn.amount < 0 ? '−' : ''}
                        {formatMoney(Math.abs(txn.amount), { code: currency })}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => navigate(`${rolePrefix}/financials/transactions/${txn.id}`)}
                          className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                        >
                          {t('staff.viewDetails')} →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ledger.length < total && (
              <div className="mt-4 text-center">
                <button
                  onClick={() => load(ledger.length)}
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-bold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  {loading ? t('staff.loading') : t('financial.viewMoreRemaining', { n: total - ledger.length })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TransactionsLedger;
