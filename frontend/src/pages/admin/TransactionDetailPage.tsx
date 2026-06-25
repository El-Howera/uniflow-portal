import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { formatMoney, useCurrency } from '../../utils/format';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface TransactionDetail {
    id: string;
    amount: number;
    type: string;
    method: string;
    status: string;
    description: string;
    referenceNumber?: string;
    cardLast4?: string | null;
    createdAt: string;
    user?: { id: string; firstName: string; lastName: string; email: string } | null;
    invoice?: {
        id: string; title: string; amount: number; balance: number;
        status: string; dueDate: string; category: string;
    } | null;
    paymentMethod?: { id: string; type: string; brand?: string | null; last4?: string | null } | null;
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A small catalog of realistic
// transactions keyed by id so the detail page renders fully populated for any
// id the ledger links to. Unknown ids fall back to the first record.
const MOCK_TRANSACTIONS: Record<string, TransactionDetail> = {
    txn_1001: {
        id: 'txn_1001',
        amount: 42500,
        type: 'payment',
        method: 'credit_card',
        status: 'completed',
        description: 'Tuition Fees — Spring 2026',
        referenceNumber: 'RCP-2026-001001',
        cardLast4: '4242',
        createdAt: '2026-02-14T10:24:00.000Z',
        user: { id: 'usr_2001', firstName: 'Yousef', lastName: 'Mahmoud', email: 'yousef.mahmoud@student.uniflow.edu' },
        invoice: {
            id: 'inv_3001', title: 'Tuition Fees — Spring 2026', amount: 42500, balance: 0,
            status: 'paid', dueDate: '2026-02-28T00:00:00.000Z', category: 'tuition',
        },
        paymentMethod: { id: 'pm_1', type: 'credit_card', brand: 'Visa', last4: '4242' },
    },
    txn_1002: {
        id: 'txn_1002',
        amount: 1500,
        type: 'payment',
        method: 'cash',
        status: 'completed',
        description: 'Lab Fee — Physics 201',
        referenceNumber: 'RCP-2026-001002',
        cardLast4: null,
        createdAt: '2026-02-20T13:05:00.000Z',
        user: { id: 'usr_2002', firstName: 'Mariam', lastName: 'Hassan', email: 'mariam.hassan@student.uniflow.edu' },
        invoice: {
            id: 'inv_3002', title: 'Lab Fee — Physics 201', amount: 1500, balance: 0,
            status: 'paid', dueDate: '2026-03-01T00:00:00.000Z', category: 'lab',
        },
        paymentMethod: null,
    },
    txn_1003: {
        id: 'txn_1003',
        amount: 8000,
        type: 'refund',
        method: 'bank_transfer',
        status: 'refunded',
        description: 'Refund — Course withdrawal CS305',
        referenceNumber: 'REF-2026-000045',
        cardLast4: null,
        createdAt: '2026-03-02T09:40:00.000Z',
        user: { id: 'usr_2003', firstName: 'Khaled', lastName: 'Abdullah', email: 'khaled.abdullah@student.uniflow.edu' },
        invoice: {
            id: 'inv_3003', title: 'Tuition Fees — Spring 2026', amount: 42500, balance: 12000,
            status: 'partial', dueDate: '2026-02-28T00:00:00.000Z', category: 'tuition',
        },
        paymentMethod: null,
    },
    txn_1004: {
        id: 'txn_1004',
        amount: 30000,
        type: 'financial_aid',
        method: 'bank_transfer',
        status: 'completed',
        description: 'Financial Aid Award — Merit Scholarship',
        referenceNumber: 'AID-2026-000012',
        cardLast4: null,
        createdAt: '2026-03-10T11:15:00.000Z',
        user: { id: 'usr_2004', firstName: 'Nour', lastName: 'Ibrahim', email: 'nour.ibrahim@student.uniflow.edu' },
        invoice: {
            id: 'inv_3004', title: 'Tuition Fees — Spring 2026', amount: 42500, balance: 12500,
            status: 'partial', dueDate: '2026-02-28T00:00:00.000Z', category: 'tuition',
        },
        paymentMethod: null,
    },
    txn_1005: {
        id: 'txn_1005',
        amount: 9500,
        type: 'payment',
        method: 'apple_pay',
        status: 'pending',
        description: 'Housing Fee — Dorm Block C',
        referenceNumber: 'RCP-2026-001005',
        cardLast4: null,
        createdAt: '2026-03-18T16:50:00.000Z',
        user: { id: 'usr_2005', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@student.uniflow.edu' },
        invoice: {
            id: 'inv_3005', title: 'Housing Fee — Dorm Block C', amount: 9500, balance: 9500,
            status: 'pending', dueDate: '2026-04-01T00:00:00.000Z', category: 'housing',
        },
        paymentMethod: { id: 'pm_2', type: 'apple_pay', brand: 'Apple Pay', last4: null },
    },
};

const FALLBACK_TRANSACTION = MOCK_TRANSACTIONS.txn_1001;

const STATUS_PILL: Record<string, string> = {
    completed: 'bg-green-500/10 text-green-400',
    pending:   'bg-yellow-500/10 text-yellow-400',
    failed:    'bg-red-500/10 text-red-400',
    refunded:  'bg-red-500/10 text-red-400',
};

const TYPE_PILL: Record<string, string> = {
    payment:       'bg-[#6A3FF4]/15 text-[#7B5AFF] border border-[#6A3FF4]/30',
    refund:        'bg-red-500/15 text-red-400 border border-red-500/30',
    financial_aid: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
};

const TransactionDetailPage: React.FC = () => {
    const t = useT();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const currency = useCurrency();
    // Aliased under /admin/financials/transactions/:id and
    // /financial/financials/transactions/:id — keep internal nav inside
    // the same role prefix.
    const location = useLocation();
    const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';
    const [txn, setTxn] = useState<TransactionDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        // Preview: resolve the mock record for this id (fallback to first record),
        // overriding its id so the page reflects the route param.
        const base = MOCK_TRANSACTIONS[id] ?? FALLBACK_TRANSACTION;
        setTxn({ ...base, id });
        setIsLoading(false);
    }, [id]);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Header + back */}
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <button
                            onClick={() => navigate(-1)}
                            className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                        >
                            <i className="ph-bold ph-arrow-left" /> {t('admin.ddBack')}
                        </button>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.tdTransactionDetail')}</h1>
                        <p className="text-gray-500 text-sm">{txn?.referenceNumber ?? id}</p>
                    </div>
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className={`${glassCardStyle} p-12 text-center text-gray-500 animate-pulse`}>
                    {t('admin.tdLoadingTxn')}
                </div>
            ) : error ? (
                <div className={`${glassCardStyle} p-8 text-center`}>
                    <i className="ph-fill ph-warning text-4xl text-red-400 mb-3 block" />
                    <p className="text-black dark:text-white font-bold mb-1">{t('admin.tdCouldNotLoadTxn')}</p>
                    <p className="text-gray-500 text-sm">{error}</p>
                </div>
            ) : txn ? (
                <>
                    {/* Hero amount card */}
                    <ParticleCard
                        className={`${glassCardStyle} p-8`}
                        glowColor={txn.type === 'refund' ? '239, 68, 68' : '106, 63, 244'}
                        enableTilt={false}
                        enableMagnetism={false}
                    >
                        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                                    {txn.type === 'refund' ? t('admin.tdRefundAmount') : t('admin.tdTransactionAmount')}
                                </p>
                                <motion.h2
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4 }}
                                    className={`text-4xl sm:text-5xl font-bold ${
                                        txn.type === 'refund' ? 'text-red-400' : 'text-[#6A3FF4]'
                                    }`}
                                >
                                    {txn.type === 'refund' ? '−' : ''}{formatMoney(txn.amount)}
                                </motion.h2>
                                <p className="text-gray-500 text-xs mt-2">{t('admin.tdAllValuesIn', { currency })}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${TYPE_PILL[txn.type] ?? 'bg-white/5 text-gray-400'}`}>
                                    {txn.type.replace('_', ' ')}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${STATUS_PILL[txn.status] ?? 'bg-white/5 text-gray-400'}`}>
                                    {txn.status}
                                </span>
                            </div>
                        </div>
                    </ParticleCard>

                    {/* Two-column metadata + linked records */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Transaction metadata */}
                        <div className={`${glassCardStyle} p-6`}>
                            <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.tdTxnHeading')}</h3>
                            <DetailRow label={t('admin.tdReference')} value={txn.referenceNumber || txn.id} />
                            <DetailRow label={t('admin.tdMethod')} value={txn.method?.replace('_', ' ') || '—'} />
                            {txn.cardLast4 && <DetailRow label={t('admin.tdCard')} value={`•••• ${txn.cardLast4}`} />}
                            <DetailRow label={t('admin.tdDate')} value={new Date(txn.createdAt).toLocaleString()} />
                            <DetailRow label={t('admin.tdDescription')} value={txn.description || '—'} multi />
                        </div>

                        {/* Student card */}
                        <div className={`${glassCardStyle} p-6`}>
                            <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.tdStudentHeading')}</h3>
                            {txn.user ? (
                                <>
                                    <DetailRow label={t('admin.tdName')} value={`${txn.user.firstName} ${txn.user.lastName}`} />
                                    <DetailRow label={t('admin.tdEmail')} value={txn.user.email} />
                                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                                        <button
                                            onClick={() => navigate(`${rolePrefix}/financials/defaulters/${txn.user!.id}`)}
                                            className="px-4 py-2 rounded-xl bg-[#6A3FF4] text-white text-sm font-bold hover:opacity-90 transition-opacity"
                                        >
                                            {t('admin.tdViewOutstandingBal')}
                                        </button>
                                        {/* Admin-only — financial sub-role doesn't get user
                                            edit access, so hide the button when not under /admin. */}
                                        {rolePrefix === '/admin' && (
                                            <button
                                                onClick={() => navigate(`/admin/users/${txn.user!.id}/edit`)}
                                                className="px-4 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white text-sm font-bold hover:bg-white/10 transition-colors"
                                            >
                                                {t('admin.ddOpenStudentProfile')}
                                            </button>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <p className="text-gray-500 text-sm">{t('admin.tdNoStudentLinked')}</p>
                            )}
                        </div>
                    </div>

                    {/* Invoice card (only when linked) */}
                    {txn.invoice && (
                        <div className={`${glassCardStyle} p-6`}>
                            <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.tdLinkedInvoice')}</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6">
                                <DetailRow label={t('admin.tdInvTitle')} value={txn.invoice.title} />
                                <DetailRow label={t('admin.tdInvCategory')} value={txn.invoice.category} />
                                <DetailRow label={t('admin.tdInvAmount')} value={formatMoney(txn.invoice.amount)} />
                                <DetailRow
                                    label={t('admin.tdInvBalance')}
                                    value={formatMoney(txn.invoice.balance)}
                                    accent={txn.invoice.balance > 0 ? 'text-red-400' : 'text-green-400'}
                                />
                                <DetailRow label={t('admin.tdInvStatus')} value={txn.invoice.status} />
                                <DetailRow label={t('admin.tdInvDueDate')} value={new Date(txn.invoice.dueDate).toLocaleDateString()} />
                            </div>
                        </div>
                    )}
                </>
            ) : null}
        </div>
    );
};

const DetailRow: React.FC<{ label: string; value: string; accent?: string; multi?: boolean }> = ({ label, value, accent, multi }) => (
    <div className={`flex ${multi ? 'flex-col gap-1 py-2' : 'justify-between gap-3 py-1.5'} border-b border-white/5 last:border-b-0`}>
        <span className="text-gray-500 text-xs uppercase tracking-wider font-bold">{label}</span>
        <span className={`${accent ?? 'text-black dark:text-white'} text-sm ${multi ? '' : 'text-right truncate'}`}>
            {value}
        </span>
    </div>
);

export default TransactionDetailPage;
