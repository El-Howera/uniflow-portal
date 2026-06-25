import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useNotifications } from '../../context/NotificationContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';
import { motion, AnimatePresence } from 'framer-motion';
import { generatePaymentReceiptPDF, PaymentInfo } from '../../utils/pdfGenerator';
import { API_URLS } from '@shared/config';
import { apiFetch } from '../../utils/api';
import {
  getPaymentDashboard,
  getInvoices,
  createStripeCheckoutSession,
  formatCurrency,
  getStatusColor,
  formatDate,
  daysUntilDue,
  Invoice,
  PaymentDashboard,
  AccountSummary,
} from '../../utils/paymentsService';

interface CatalogFee {
  id: string;
  name: string;
  description?: string | null;
  amount: string | number;
  category: string;
  processingDays?: number;
}

interface StudentServiceRequest {
  id: string;
  serviceName?: string | null;
  status: string;
  amount?: string | number | null;
  createdAt: string;
  serviceFee?: { id: string; name: string; amount: string | number } | null;
}

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

// Prisma Decimal fields are serialised as strings over JSON; coerce safely so
// `.toFixed()` / arithmetic / comparisons don't blow up.
const toNum = (v: unknown): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// ──────────────────────────────────────────────────────────────────────────────
// Account Summary (4 stat columns)
// ──────────────────────────────────────────────────────────────────────────────
const AccountSummaryCard: React.FC<{ summary: AccountSummary | null; isLoading: boolean }> = ({ summary, isLoading }) => {
  const t = useT();
  if (isLoading || !summary) {
    return (
      <div className={`${glassCardStyle} p-6`}>
        <div className="animate-pulse grid grid-cols-2 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/2"></div>
              <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const balance = summary.outstandingBalance;
  const hasDebt = balance !== 0;
  const balanceColor = hasDebt ? 'text-red-500' : 'text-gray-500';
  const balanceLabel = hasDebt ? t('paymentsPage.amountDue') : t('paymentsPage.paidUp');
  const balanceDisplay = hasDebt ? `-${formatCurrency(Math.abs(balance))}` : formatCurrency(0);
  const overdue = summary.overdueAmount;

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">{t('paymentsPage.outstanding')}</p>
          <p className={`text-2xl font-bold ${balanceColor}`}>{balanceDisplay}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{balanceLabel}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">{t('paymentsPage.totalPaid')}</p>
          <p className="text-2xl font-bold text-green-500">{formatCurrency(Math.abs(summary.totalPaid))}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">{t('paymentsPage.financialAid')}</p>
          <p className="text-2xl font-bold text-[#6A3FF4]">{formatCurrency(Math.abs(summary.totalAid))}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">{t('paymentsPage.overdue')}</p>
          <p className={`text-2xl font-bold ${overdue !== 0 ? 'text-red-500' : 'text-gray-500'}`}>
            {overdue !== 0 ? `-${formatCurrency(Math.abs(overdue))}` : formatCurrency(0)}
          </p>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Invoice Card — Pay Now button now redirects to Stripe Checkout
// ──────────────────────────────────────────────────────────────────────────────
const InvoiceCard: React.FC<{
  invoice: Invoice;
  payingInvoiceId: string | null;
  onPay: (invoice: Invoice) => void;
  onDownloadReceipt: (invoice: Invoice) => void;
}> = ({ invoice, payingInvoiceId, onPay, onDownloadReceipt }) => {
  const amount = toNum(invoice.amount);
  const paid = toNum(invoice.paid);
  const balance = toNum(invoice.balance);
  const daysLeft = daysUntilDue(invoice.dueDate);
  const isOverdue = daysLeft < 0 && balance > 0;
  const isPaying = payingInvoiceId === invoice.id;

  return (
    <motion.div whileHover={{ y: -2 }} className={`${glassCardStyle} p-6 flex flex-col space-y-4 hover:border-[#6A3FF4]/30 transition-all`}>
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h3 className="text-black dark:text-white font-bold text-lg leading-tight">{invoice.title}</h3>
          <p className="text-gray-500 text-xs mt-1">{invoice.semester}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusColor(invoice.status)}`}>
          {invoice.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Total</span>
          <span className="font-semibold text-black dark:text-white">{formatCurrency(amount)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Paid</span>
          <span className="font-semibold text-green-500">{formatCurrency(paid)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">Balance</span>
          <span className={`font-bold ${balance > 0 ? 'text-red-500' : 'text-green-500'}`}>
            {balance > 0 ? `-${formatCurrency(balance)}` : formatCurrency(0)}
          </span>
        </div>
      </div>

      <div className="flex items-center text-[10px] font-bold">
        <i className="ph-bold ph-calendar-blank mr-2 text-gray-500"></i>
        <span className={`${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
          {invoice.status === 'paid' ? 'PAID' : `DUE ${formatDate(invoice.dueDate)}`}
        </span>
      </div>

      <div className="flex gap-2 pt-2">
        {balance > 0 ? (
          <button
            onClick={() => onPay(invoice)}
            disabled={isPaying}
            className="flex-1 bg-[#6A3FF4] text-white font-bold py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 text-xs flex items-center justify-center gap-2"
          >
            {isPaying ? (
              <>
                <i className="ph-bold ph-spinner ph-spin"></i>
                Redirecting...
              </>
            ) : (
              <>
                <i className="ph-bold ph-credit-card"></i>
                Pay with Card
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => onDownloadReceipt(invoice)}
            className="flex-1 bg-green-500/20 text-green-500 font-bold py-2.5 rounded-xl hover:bg-green-500/30 transition-colors text-xs flex items-center justify-center gap-2"
          >
            <i className="ph-bold ph-check-circle"></i> Download Receipt
          </button>
        )}
      </div>
    </motion.div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────
const StudentPayments: React.FC = () => {
  const { searchTerm } = useAppContext();
  const t = useT();
  const [dashboard, setDashboard] = useState<PaymentDashboard | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Service catalog (admin-managed list of fees a student can request) and the
  // student's own pending requests. Both are loaded in fetchData below.
  const [catalog, setCatalog] = useState<CatalogFee[]>([]);
  const [myRequests, setMyRequests] = useState<StudentServiceRequest[]>([]);
  const [requestingFeeId, setRequestingFeeId] = useState<string | null>(null);

  const odId = localStorage.getItem('currentUserOdId') || localStorage.getItem('currentUserId') || 'current';

  const showToast = (kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Parallel: account dashboard + invoices + service-fee catalog + the
      // student's own service-request history (so we can show "Requested" /
      // "Approved" badges next to each catalog item).
      const [dashboardData, invoicesData, catalogRes, requestsRes] = await Promise.all([
        getPaymentDashboard(odId),
        getInvoices(odId),
        apiFetch(`${API_URLS.payments()}/api/payments/service-fees`).catch(() => null),
        apiFetch(`${API_URLS.payments()}/api/payments/service-requests/${encodeURIComponent(odId)}`).catch(() => null),
      ]);

      if (dashboardData) setDashboard(dashboardData);
      const invs = invoicesData && Array.isArray(invoicesData.invoices) ? invoicesData.invoices : [];
      setInvoices(invs);

      if (catalogRes && catalogRes.ok) {
        const j = await catalogRes.json().catch(() => null);
        const arr: CatalogFee[] = Array.isArray(j?.data) ? j.data : [];
        setCatalog(arr);
      } else {
        setCatalog([]);
      }

      if (requestsRes && requestsRes.ok) {
        const j = await requestsRes.json().catch(() => null);
        const arr: StudentServiceRequest[] = Array.isArray(j?.data) ? j.data : [];
        setMyRequests(arr);
      } else {
        setMyRequests([]);
      }
    } catch (err) {
      console.error('Error fetching payment data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [odId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh when the tab regains focus or becomes visible — picks up any
  // payments the admin records server-side (manual cash entry, Stripe webhook
  // landing) without the student having to hard-reload the page.
  useEffect(() => {
    const onFocus = () => fetchData();
    const onVis = () => { if (document.visibilityState === 'visible') fetchData(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchData]);

  // Notification-triggered refresh — when the student receives any new
  // notification (admin recorded payment, Stripe webhook fired, etc.), pull
  // fresh invoices. We hash the notification stream by length so the effect
  // only fires when a NEW one arrives, not on every re-render.
  const { notifications } = useNotifications();
  const lastSeenCountRef = useRef(notifications.length);
  useEffect(() => {
    if (notifications.length !== lastSeenCountRef.current) {
      lastSeenCountRef.current = notifications.length;
      fetchData();
    }
  }, [notifications, fetchData]);

  /**
   * Click handler for "Request" on a catalog fee. Posts a ServiceRequest and
   * shows a toast. The request lands in the admin's queue → on approval an
   * invoice appears in the Invoices list above + the student gets a
   * notification. Until then the catalog card shows "Pending review".
   */
  const handleRequestService = async (fee: CatalogFee) => {
    setRequestingFeeId(fee.id);
    try {
      const res = await apiFetch(`${API_URLS.payments()}/api/payments/service-request`, {
        method: 'POST',
        body: JSON.stringify({ odID: odId, serviceId: fee.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
      }
      showToast('success', `Requested "${fee.name}". You'll see an invoice once it's approved.`);
      // Refresh so the new request shows under "Your Requests".
      const requestsRes = await apiFetch(`${API_URLS.payments()}/api/payments/service-requests/${encodeURIComponent(odId)}`).catch(() => null);
      if (requestsRes && requestsRes.ok) {
        const j = await requestsRes.json().catch(() => null);
        const arr: StudentServiceRequest[] = Array.isArray(j?.data) ? j.data : [];
        setMyRequests(arr);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Could not submit request');
    } finally {
      setRequestingFeeId(null);
    }
  };

  // Helper: has the student already requested this fee and is it still pending?
  const pendingRequestFor = (feeId: string): StudentServiceRequest | undefined =>
    myRequests.find((r) => r.status === 'pending' && (r.serviceFee?.id === feeId));

  /**
   * Click handler for "Pay with Card". Calls the backend, then redirects the
   * browser to the Stripe Checkout URL it returns. Stripe handles all card
   * collection + 3DS; the webhook updates the DB; the user lands back on
   * /student/payments/success.
   */
  const handlePay = async (invoice: Invoice) => {
    setPayingInvoiceId(invoice.id);
    const result = await createStripeCheckoutSession(invoice.id);
    if (result.success && result.url) {
      // Hard navigation off-app to Stripe. State is preserved by the success
      // page reloading the invoice list on return.
      window.location.href = result.url;
      return;
    }
    setPayingInvoiceId(null);
    showToast('error', result.error || 'Could not start payment');
  };

  const handleDownloadReceipt = (invoice: Invoice) => {
    const paid = toNum(invoice.paid);
    const amount = toNum(invoice.amount);
    const paidAmount = paid > 0 ? paid : amount;

    const studentName = `${localStorage.getItem('currentUserFirstName') || ''} ${
      localStorage.getItem('currentUserLastName') || ''
    }`.trim() || 'Student';

    const receiptData: PaymentInfo = {
      receiptNumber: `RCP-${invoice.id.substring(0, 6).toUpperCase()}`,
      date: invoice.paidDate || new Date().toISOString(),
      studentName,
      studentId: localStorage.getItem('currentUserOdId') || 'STU',
      items: [{ description: invoice.title, amount: paidAmount }],
      paymentMethod: 'Stripe (Card)',
      totalAmount: paidAmount,
      status: invoice.status === 'paid' ? 'Paid' : invoice.status === 'overdue' ? 'Overdue' : 'Pending',
    };
    try {
      generatePaymentReceiptPDF(receiptData);
    } catch (err) {
      console.error('Receipt PDF failed:', err);
      showToast('error', 'Could not generate receipt PDF.');
    }
  };

  const filteredInvoices = invoices.filter((i) => i.title.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="flex-1 pb-16 space-y-8 p-6">
      <AnimateOnView>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-black dark:text-white text-3xl font-bold">{t('paymentsPage.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t('paymentsPage.subtitle')}</p>
          </div>
          <button
            onClick={() => fetchData()}
            disabled={isLoading}
            title="Pull latest payments"
            className="flex items-center gap-2 bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 text-black dark:text-white text-sm font-semibold px-3 py-2 rounded-xl hover:bg-white/20 dark:hover:bg-white/10 transition-colors disabled:opacity-50 shrink-0"
          >
            <i className={`ph-bold ph-arrows-clockwise ${isLoading ? 'ph-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </AnimateOnView>

      <AnimateOnView delay={0.1}>
        <AccountSummaryCard summary={dashboard?.summary || null} isLoading={isLoading} />
      </AnimateOnView>

      <AnimateOnView delay={0.15}>
        <div className={`${glassCardStyle} p-5 flex items-start gap-3 border-[#6A3FF4]/20`}>
          <i className="ph-bold ph-lock-key text-[#6A3FF4] text-2xl mt-0.5"></i>
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-semibold text-black dark:text-white mb-0.5">Secure payment via Stripe</p>
            <p className="text-xs">
              Card details are entered on Stripe's hosted page — we never see or store your card number.
              Test cards: <span className="font-mono bg-white/30 dark:bg-white/10 px-1.5 py-0.5 rounded text-xs">4242 4242 4242 4242</span>, any future expiry, any CVC.
            </p>
          </div>
        </div>
      </AnimateOnView>

      <div>
        <h3 className="text-black dark:text-white text-xl font-bold mb-3">{t('paymentsPage.invoices')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            [1, 2, 3].map((i) => <div key={i} className="h-48 w-full bg-white/5 animate-pulse rounded-2xl"></div>)
          ) : filteredInvoices.length === 0 ? (
            <div className={`${glassCardStyle} p-10 text-center text-gray-500 col-span-full`}>
              <i className="ph-bold ph-receipt text-4xl mb-2 block opacity-40"></i>
              {searchTerm ? t('paymentsPage.subtitle') : t('paymentsPage.noInvoices')}
            </div>
          ) : (
            filteredInvoices.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                invoice={invoice}
                payingInvoiceId={payingInvoiceId}
                onPay={handlePay}
                onDownloadReceipt={handleDownloadReceipt}
              />
            ))
          )}
        </div>
      </div>

      {/* Available Services — catalog of fees a student can request. Submitting
          creates a ServiceRequest the admin reviews; on approval, an invoice
          appears in the Invoices grid above. */}
      {catalog.length > 0 && (
        <div>
          <h3 className="text-black dark:text-white text-xl font-bold mb-1">Available Services</h3>
          <p className="text-gray-600 dark:text-gray-400 text-xs mb-3">
            Need something specific? Request it and an invoice will be added to your account once approved.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.map((fee) => {
              const amount = toNum(fee.amount);
              const pending = pendingRequestFor(fee.id);
              const isRequesting = requestingFeeId === fee.id;
              return (
                <motion.div
                  key={fee.id}
                  whileHover={{ y: -2 }}
                  className={`${glassCardStyle} p-5 flex flex-col gap-3`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-black dark:text-white font-bold text-sm leading-snug">{fee.name}</h4>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{fee.category}</p>
                    </div>
                    <span className="text-[#6A3FF4] font-bold text-base whitespace-nowrap">
                      {amount > 0 ? formatCurrency(amount) : 'Variable'}
                    </span>
                  </div>
                  {fee.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{fee.description}</p>
                  )}
                  {pending ? (
                    <div className="bg-yellow-500/15 border border-yellow-500/30 text-yellow-500 text-xs font-semibold py-2 px-3 rounded-xl text-center">
                      <i className="ph-bold ph-clock mr-1.5" />
                      Awaiting approval
                    </div>
                  ) : (
                    <button
                      onClick={() => handleRequestService(fee)}
                      disabled={isRequesting}
                      className="bg-[#6A3FF4]/15 hover:bg-[#6A3FF4]/25 text-[#7B5AFF] font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {isRequesting ? (
                        <>
                          <i className="ph-bold ph-spinner ph-spin" />
                          Requesting…
                        </>
                      ) : (
                        <>
                          <i className="ph-bold ph-paper-plane-tilt" />
                          Request this service
                        </>
                      )}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Student's own service-request history (any state). Hidden until first request. */}
      {myRequests.length > 0 && (
        <div>
          <h3 className="text-black dark:text-white text-xl font-bold mb-3">Your Service Requests</h3>
          <div className={`${glassCardStyle} divide-y divide-white/5`}>
            {myRequests.map((req) => {
              const statusClass =
                req.status === 'approved' ? 'text-green-500 bg-green-500/15 border-green-500/30'
                : req.status === 'rejected' ? 'text-red-500 bg-red-500/15 border-red-500/30'
                : 'text-yellow-500 bg-yellow-500/15 border-yellow-500/30';
              return (
                <div key={req.id} className="flex items-center justify-between p-4 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-black dark:text-white truncate">
                      {req.serviceFee?.name || req.serviceName || 'Service request'}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Submitted {formatDate(req.createdAt)}
                      {req.status === 'approved' && ' · invoice issued — see above'}
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase ${statusClass}`}>
                    {req.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-semibold max-w-sm ${
              toast.kind === 'success'
                ? 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30'
                : 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30'
            }`}
          >
            <i className={`ph-bold ${toast.kind === 'success' ? 'ph-check-circle' : 'ph-x-circle'} mr-2`}></i>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StudentPayments;
