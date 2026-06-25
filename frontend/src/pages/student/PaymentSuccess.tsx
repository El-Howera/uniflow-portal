import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  getStripeSessionStatus,
  formatCurrency,
} from '../../utils/paymentsService';
import type { Transaction } from '../../utils/paymentsService';

const glassCardStyle =
  'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

/**
 * Landing page after Stripe Checkout. Reads `session_id` from the URL,
 * polls the backend until the webhook has created the Transaction row,
 * then shows a success summary with links back to Payments.
 *
 * Webhook latency is usually <1 second but Stripe doesn't guarantee
 * synchronous delivery, so we poll for up to 30 seconds before giving up
 * and showing a "still processing" state (the payment will land later,
 * the user just won't see it on this page).
 */
const PaymentSuccess: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get('session_id');

  const [state, setState] = useState<'polling' | 'success' | 'pending' | 'error' | 'no-session'>(
    sessionId ? 'polling' : 'no-session',
  );
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let attempts = 0;
    const maxAttempts = 20; // 20 polls × 1.5s = 30s max
    let stopped = false;

    const poll = async () => {
      if (stopped) return;
      attempts += 1;
      const result = await getStripeSessionStatus(sessionId);

      if (stopped) return;

      if (!result.success) {
        setErrorMsg(result.error || 'Could not check payment status');
        setState('error');
        return;
      }

      setPaymentStatus(result.paymentStatus || null);

      if (result.transaction) {
        setTransaction(result.transaction);
        setState('success');
        return;
      }

      if (result.paymentStatus === 'paid') {
        // Stripe says paid but webhook hasn't recorded the transaction yet.
        // Keep polling.
      }

      if (attempts >= maxAttempts) {
        // Stripe usually delivers webhooks in <1s but they're allowed to be
        // delayed. Show a friendly "still processing" state — the payment
        // WILL land; the user just won't see it on this page.
        setState('pending');
        return;
      }

      pollRef.current = window.setTimeout(poll, 1500);
    };

    poll();

    return () => {
      stopped = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [sessionId]);

  return (
    // Use min-h-screen-d instead of an arbitrary 60vh so the card vertically
    // centres on long-content viewports without compressing on phones. Card
    // sits directly inside the flex container with its own size — no wrapper
    // div that collapses its width.
    <div className="flex-1 px-4 sm:px-6 py-10 flex items-center justify-center min-h-[calc(100vh-12rem)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className={`${glassCardStyle} w-full max-w-md p-6 sm:p-8 text-center space-y-5`}
      >
        {state === 'no-session' && (
          <div className="space-y-3">
            <i className="ph-bold ph-question text-yellow-500 text-6xl block" />
            <h2 className="text-2xl font-bold text-black dark:text-white">
              Missing payment reference
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              We couldn't find a payment session in the URL. If you just completed a payment,
              head back to Payments — it'll show up there shortly.
            </p>
          </div>
        )}

        {state === 'polling' && (
          <div className="space-y-3">
            <i className="ph-bold ph-spinner ph-spin text-[#6A3FF4] text-6xl block" />
            <h2 className="text-2xl font-bold text-black dark:text-white">
              Confirming payment…
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              Stripe is processing your payment. This usually takes a second or two.
            </p>
            {paymentStatus === 'paid' && (
              <p className="text-xs text-green-500">
                ✓ Stripe confirmed the charge. Updating your account…
              </p>
            )}
          </div>
        )}

        {state === 'success' && transaction && (
          <div className="space-y-4">
            <motion.i
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16 }}
              className="ph-bold ph-check-circle text-green-500 text-6xl block"
            />
            <h2 className="text-2xl font-bold text-black dark:text-white">
              Payment successful
            </h2>
            <div className="bg-white/30 dark:bg-white/5 border border-white/10 rounded-xl p-4 text-left text-sm space-y-2">
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-500">Amount</span>
                <span className="font-bold text-green-500 whitespace-nowrap">
                  {formatCurrency(Number(transaction.amount))}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-500 flex-shrink-0">Reference</span>
                <span className="font-mono text-xs text-black dark:text-white truncate text-right">
                  {/* Backend returns the Prisma Transaction row directly, so the
                      canonical field is `referenceNumber`; the older `receiptNumber`
                      alias kept for any legacy callers. */}
                  {(transaction as unknown as { referenceNumber?: string }).referenceNumber
                    || transaction.receiptNumber
                    || transaction.id.slice(0, 12)}
                </span>
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-gray-500">Method</span>
                <span className="text-black dark:text-white whitespace-nowrap">
                  Card{transaction.cardLast4 ? ` •••• ${transaction.cardLast4}` : ''}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              If your account had a sign-in lock for unpaid fees, it's been released automatically.
            </p>
          </div>
        )}

        {state === 'pending' && (
          <div className="space-y-3">
            <i className="ph-bold ph-clock text-yellow-500 text-6xl block" />
            <h2 className="text-2xl font-bold text-black dark:text-white">
              Still processing
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              Stripe accepted your payment but our server hasn't finished updating
              your account yet. This is rare — please refresh the Payments page in a minute.
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-3">
            <i className="ph-bold ph-x-circle text-red-500 text-6xl block" />
            <h2 className="text-2xl font-bold text-black dark:text-white">
              Couldn't check status
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">
              {errorMsg || 'We hit an error checking your payment.'}
            </p>
          </div>
        )}

        <button
          onClick={() => navigate('/student/payments')}
          className="w-full bg-[#6A3FF4] text-white font-bold py-3 rounded-xl shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity"
        >
          Back to Payments
        </button>
      </motion.div>
    </div>
  );
};

export default PaymentSuccess;
