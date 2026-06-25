// frontend/src/pages/admin/IssuedInvoices.tsx
//
// Admin view of every issued invoice with per-row actions:
//   - Mark as Paid (cash / cheque / bank transfer recorded by financial office)
//   - Delete (admin-only; refuses when transactions exist)
//
// This is where admins land when a student walks in and pays at the counter,
// or when an invoice needs to be cleared without going through Stripe.
//
// Filters: status pill bar + search input. Search runs server-side against
// invoice title + student name/email/odId so a 1000-row tenant stays usable.

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { GlassDropdown } from '../../components/GlassDropdown';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface AdminInvoice {
  id: string;
  title: string;
  description?: string | null;
  amount: string | number;
  totalAmount: string | number;
  paid: string | number;
  balance: string | number;
  status: 'pending' | 'partial' | 'paid' | 'overdue' | string;
  dueDate: string;
  semester?: string | null;
  category?: string;
  createdAt: string;
  paidAt?: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    odId?: string | null;
  };
  _count: { transactions: number };
}

const toNum = (v: unknown): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A realistic mix of issued invoices (EGP).
const MOCK_INVOICES: AdminInvoice[] = [
  {
    id: 'inv_6001', title: 'Tuition Fees — Spring 2026', description: 'Per-semester tuition',
    amount: 42500, totalAmount: 42500, paid: 30000, balance: 12500, status: 'partial',
    dueDate: '2026-02-28T00:00:00.000Z', semester: 'Spring 2026', category: 'tuition',
    createdAt: '2026-01-15T00:00:00.000Z', paidAt: null,
    user: { id: 'usr_2003', firstName: 'Khaled', lastName: 'Abdullah', email: 'khaled.abdullah@student.uniflow.edu', odId: 'OD-2023-0451' },
    _count: { transactions: 1 },
  },
  {
    id: 'inv_6002', title: 'Lab Fee — Physics 201', description: 'Lab access per term',
    amount: 1500, totalAmount: 1500, paid: 0, balance: 1500, status: 'pending',
    dueDate: '2026-03-15T00:00:00.000Z', semester: 'Spring 2026', category: 'lab',
    createdAt: '2026-02-10T00:00:00.000Z', paidAt: null,
    user: { id: 'usr_2002', firstName: 'Mariam', lastName: 'Hassan', email: 'mariam.hassan@student.uniflow.edu', odId: 'OD-2024-0112' },
    _count: { transactions: 0 },
  },
  {
    id: 'inv_6003', title: 'Library Late Fee', description: 'Overdue items',
    amount: 16000, totalAmount: 16000, paid: 0, balance: 16000, status: 'overdue',
    dueDate: '2026-01-15T00:00:00.000Z', semester: 'Fall 2025', category: 'library',
    createdAt: '2025-12-20T00:00:00.000Z', paidAt: null,
    user: { id: 'usr_2003', firstName: 'Khaled', lastName: 'Abdullah', email: 'khaled.abdullah@student.uniflow.edu', odId: 'OD-2023-0451' },
    _count: { transactions: 0 },
  },
  {
    id: 'inv_6004', title: 'Housing Fee — Dorm Block A', description: 'On-campus housing',
    amount: 9500, totalAmount: 9500, paid: 0, balance: 9500, status: 'overdue',
    dueDate: '2026-03-05T00:00:00.000Z', semester: 'Spring 2026', category: 'housing',
    createdAt: '2026-02-01T00:00:00.000Z', paidAt: null,
    user: { id: 'usr_2007', firstName: 'Layla', lastName: 'Mostafa', email: 'layla.mostafa@student.uniflow.edu', odId: 'OD-2024-0188' },
    _count: { transactions: 0 },
  },
  {
    id: 'inv_6005', title: 'Tuition Fees — Spring 2026', description: 'Per-semester tuition',
    amount: 42500, totalAmount: 42500, paid: 42500, balance: 0, status: 'paid',
    dueDate: '2026-02-28T00:00:00.000Z', semester: 'Spring 2026', category: 'tuition',
    createdAt: '2026-01-15T00:00:00.000Z', paidAt: '2026-02-14T10:24:00.000Z',
    user: { id: 'usr_2001', firstName: 'Yousef', lastName: 'Mahmoud', email: 'yousef.mahmoud@student.uniflow.edu', odId: 'OD-2023-0301' },
    _count: { transactions: 1 },
  },
  {
    id: 'inv_6006', title: 'Exam Re-sit Fee — CS305', description: 'Supplementary exam',
    amount: 600, totalAmount: 600, paid: 0, balance: 600, status: 'pending',
    dueDate: '2026-04-10T00:00:00.000Z', semester: 'Spring 2026', category: 'exam',
    createdAt: '2026-03-20T00:00:00.000Z', paidAt: null,
    user: { id: 'usr_2005', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@student.uniflow.edu', odId: 'OD-2024-0233' },
    _count: { transactions: 0 },
  },
];

// Filter + method options are derived at render time so the labels follow
// the active locale (the t() helper is only available inside the component).

const STATUS_PILL: Record<string, string> = {
  paid:    'text-green-500 bg-green-500/15 border-green-500/30',
  partial: 'text-blue-500 bg-blue-500/15 border-blue-500/30',
  pending: 'text-yellow-500 bg-yellow-500/15 border-yellow-500/30',
  overdue: 'text-red-500 bg-red-500/15 border-red-500/30',
};

const IssuedInvoices: React.FC = () => {
  const t = useT();
  const currency = useCurrency();
  const STATUS_FILTERS = useMemo(() => [
    { value: 'pending',  label: t('sa.invoicesStatusPending') },
    { value: 'partial',  label: t('sa.invoicesStatusPartial') },
    { value: 'overdue',  label: t('sa.invoicesStatusOverdue') },
    { value: 'paid',     label: t('sa.invoicesStatusPaid') },
    { value: 'all',      label: t('sa.invoicesStatusAll') },
  ], [t]);
  const PAYMENT_METHODS = useMemo(() => [
    { value: 'cash',          label: t('sa.invoicesMethodCash') },
    { value: 'cheque',        label: t('sa.invoicesMethodCheque') },
    { value: 'bank_transfer', label: t('sa.invoicesMethodBankTransfer') },
    { value: 'other',         label: t('sa.invoicesMethodOther') },
  ], [t]);
  const [invoices, setInvoices] = useState<AdminInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Per-row payment-form state. Open one row at a time.
  const [openPayId, setOpenPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);

  // Debounce search by 300ms so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const showToast = (kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4500);
  };

  // Preview: filter the static mock invoices client-side (no backend). Mirrors the
  // server-side status + search filters the page previously requested.
  useEffect(() => {
    setLoading(true);
    const q = debouncedSearch.trim().toLowerCase();
    const filtered = MOCK_INVOICES.filter((inv) => {
      const matchesStatus = statusFilter === 'all' || inv.status === statusFilter;
      const matchesSearch =
        q === '' ||
        inv.title.toLowerCase().includes(q) ||
        `${inv.user.firstName} ${inv.user.lastName}`.toLowerCase().includes(q) ||
        inv.user.email.toLowerCase().includes(q) ||
        (inv.user.odId ?? '').toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
    setInvoices(filtered);
    setLoading(false);
  }, [statusFilter, debouncedSearch]);

  const openPaymentFor = (inv: AdminInvoice) => {
    setOpenPayId(inv.id);
    // Default to full outstanding balance — admin can override to record a partial.
    setPayAmount(String(toNum(inv.balance)));
    setPayMethod('cash');
    setPayReference('');
    setPayNotes('');
  };

  const cancelPayment = () => {
    setOpenPayId(null);
    setPayAmount('');
    setPayReference('');
    setPayNotes('');
  };

  // Preview: recording a payment mutates local state only (optimistic), no network.
  const submitPayment = (invId: string) => {
    const numeric = parseFloat(payAmount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      showToast('error', t('sa.invoicesToastAmount'));
      return;
    }
    setPaying(true);
    let fullyPaid = false;
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invId) return inv;
        const newPaid = toNum(inv.paid) + numeric;
        const total = toNum(inv.totalAmount);
        const newBalance = Math.max(0, total - newPaid);
        fullyPaid = newBalance <= 0;
        return {
          ...inv,
          paid: newPaid,
          balance: newBalance,
          status: fullyPaid ? 'paid' : 'partial',
          paidAt: fullyPaid ? new Date().toISOString() : inv.paidAt,
          _count: { transactions: inv._count.transactions + 1 },
        };
      }),
    );
    showToast('success', fullyPaid ? t('sa.invoicesToastFullPaid') : t('sa.invoicesToastPartial'));
    cancelPayment();
    setPaying(false);
  };

  // Preview: delete mutates local state only, no network.
  const deleteInvoice = (inv: AdminInvoice) => {
    if (!window.confirm(t('sa.invoicesConfirmDelete', { title: inv.title, first: inv.user.firstName, last: inv.user.lastName }))) {
      return;
    }
    setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
    showToast('success', t('sa.invoicesToastDeleted'));
  };

  // Summary tiles across the visible list.
  const summary = useMemo(() => {
    let outstanding = 0;
    let collected = 0;
    let overdueCount = 0;
    for (const inv of invoices) {
      outstanding += toNum(inv.balance);
      collected   += toNum(inv.paid);
      if (inv.status === 'overdue') overdueCount += 1;
    }
    return { outstanding, collected, overdueCount, total: invoices.length };
  }, [invoices]);

  return (
    <div className="flex-1 p-6 pb-16 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1">
            {t('sa.invoicesPageTitle')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t('sa.invoicesPageHint')}
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className={`${glassCardStyle} p-4`}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesStatShowing')}</div>
          <div className="text-2xl font-bold text-black dark:text-white">{summary.total}</div>
        </div>
        <div className={`${glassCardStyle} p-4`}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesStatOutstanding')}</div>
          <div className="text-2xl font-bold text-red-500">{formatMoney(summary.outstanding)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{currency}</div>
        </div>
        <div className={`${glassCardStyle} p-4`}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesStatCollected')}</div>
          <div className="text-2xl font-bold text-green-500">{formatMoney(summary.collected)}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{currency}</div>
        </div>
        <div className={`${glassCardStyle} p-4`}>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesStatOverdue')}</div>
          <div className="text-2xl font-bold text-orange-500">{summary.overdueCount}</div>
        </div>
      </div>

      {/* Filters */}
      <div className={`${glassCardStyle} p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center`}>
        <div className="relative flex-1 w-full">
          <i className="ph-bold ph-magnifying-glass absolute start-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('sa.invoicesSearchPlaceholder')}
            className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl py-2.5 ps-10 pe-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]"
          />
        </div>
        <div className="min-w-[180px]">
          <GlassDropdown
            value={statusFilter}
            onChange={(v) => setStatusFilter(String(v))}
            options={STATUS_FILTERS}
            direction="down"
            className="w-full"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`${glassCardStyle} h-24 animate-pulse`} />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className={`${glassCardStyle} p-12 text-center`}>
          <i className="ph-bold ph-receipt text-5xl text-gray-400 mb-4 block" />
          <p className="text-black dark:text-white font-semibold text-lg mb-1">
            {t('sa.invoicesEmptyTitle')}
          </p>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            {t('sa.invoicesEmptyHint')}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {invoices.map((inv) => {
            const balance = toNum(inv.balance);
            const total   = toNum(inv.totalAmount);
            const paid    = toNum(inv.paid);
            const isOpen  = openPayId === inv.id;
            const dueDateStr = new Date(inv.dueDate).toLocaleDateString();
            const isOverdue = inv.status === 'overdue';

            return (
              <motion.div
                key={inv.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`${glassCardStyle} p-5`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-black dark:text-white font-bold text-base">{inv.title}</h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${STATUS_PILL[inv.status] || STATUS_PILL.pending}`}>
                        {STATUS_FILTERS.find(f => f.value === inv.status)?.label ?? inv.status}
                      </span>
                      {inv.category && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#6A3FF4]/10 text-[#7B5AFF] uppercase">
                          {inv.category}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      <span className="font-semibold text-black dark:text-white">
                        {inv.user.firstName} {inv.user.lastName}
                      </span>
                      <span> · {inv.user.email}</span>
                      {inv.user.odId && <span> · {inv.user.odId}</span>}
                      {inv.semester && <span> · {inv.semester}</span>}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-500'}`}>
                      {t('sa.invoicesDueLabel')} {dueDateStr}
                      {inv._count.transactions > 0 && ` · ${t('sa.invoicesTxnSuffix', { n: inv._count.transactions })}`}
                    </div>
                  </div>

                  <div className="text-end whitespace-nowrap">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">{t('sa.invoicesBalanceLabel')}</div>
                    <div className={`text-xl font-bold ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {formatMoney(balance)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {t('sa.invoicesPaidOfTotal', { paid: formatMoney(paid), total: formatMoney(total) })}
                    </div>
                  </div>
                </div>

                {/* Per-row inline payment form */}
                {isOpen ? (
                  <div className="mt-3 p-4 rounded-xl bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesAmountLabel')}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max={balance}
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="w-full bg-white/10 dark:bg-black/30 border border-white/20 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesMethodLabel')}</label>
                      <GlassDropdown
                        value={payMethod}
                        onChange={(v) => setPayMethod(String(v))}
                        options={PAYMENT_METHODS}
                        direction="up"
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesReferenceLabel')} <span className="normal-case text-gray-500">{t('sa.invoicesOpt')}</span></label>
                      <input
                        value={payReference}
                        onChange={(e) => setPayReference(e.target.value)}
                        placeholder={t('sa.invoicesReferencePh')}
                        className="w-full bg-white/10 dark:bg-black/30 border border-white/20 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('sa.invoicesNotesLabel')} <span className="normal-case text-gray-500">{t('sa.invoicesOpt')}</span></label>
                      <input
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                        placeholder={t('sa.invoicesNotesPh')}
                        className="w-full bg-white/10 dark:bg-black/30 border border-white/20 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                      />
                    </div>
                    <div className="sm:col-span-4 flex gap-2 mt-1">
                      <button
                        onClick={() => submitPayment(inv.id)}
                        disabled={paying}
                        className="flex-1 bg-[#6A3FF4] text-white font-bold py-2 rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {paying ? t('sa.invoicesRecordingBtn') : t('sa.invoicesRecordBtn')}
                      </button>
                      <button
                        onClick={cancelPayment}
                        disabled={paying}
                        className="px-4 bg-white/10 dark:bg-white/5 text-black dark:text-white font-bold py-2 rounded-lg text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors"
                      >
                        {t('sa.invoicesCancelBtn')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3">
                    {balance > 0 && (
                      <button
                        onClick={() => openPaymentFor(inv)}
                        className="flex items-center gap-2 bg-[#6A3FF4]/15 hover:bg-[#6A3FF4]/25 text-[#7B5AFF] font-bold py-2 px-4 rounded-lg text-xs transition-colors"
                      >
                        <i className="ph-bold ph-money" />
                        {t('sa.invoicesRecordCashBtn')}
                      </button>
                    )}
                    <button
                      onClick={() => deleteInvoice(inv)}
                      className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold py-2 px-3 rounded-lg text-xs transition-colors"
                      title={t('sa.invoicesDeleteTip')}
                    >
                      <i className="ph-bold ph-trash" />
                    </button>
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

export default IssuedInvoices;
