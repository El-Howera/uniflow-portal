import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface FinancialSummary {
    id: string;
    name: string;
    email: string;
    odId?: string;
    balance: number;
    status: string;
    invoiceCount: number;
}

interface Invoice {
    id: string;
    description?: string;
    amount: number;
    status: string;
    dueDate?: string;
}

interface AccountData {
    invoices?: Invoice[];
    balance?: number;
    totalDue?: number;
}

interface SelectedStudent {
    id: string;
    odId: string;
    name: string;
}

const invoiceStatusColor: Record<string, string> = {
    paid: 'bg-green-500/10 text-green-500 border-green-500/20',
    pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    overdue: 'bg-red-500/10 text-red-500 border-red-500/20',
    cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_SUMMARIES: FinancialSummary[] = [
    { id: 'stu-001', name: 'Mariam El-Sayed', email: 'mariam.elsayed@uniflow.edu', odId: 'CS-2024-0042', balance: 0, status: 'cleared', invoiceCount: 3 },
    { id: 'stu-002', name: 'Omar Hassan', email: 'omar.hassan@uniflow.edu', odId: 'DS-2023-0019', balance: 4500, status: 'unpaid', invoiceCount: 4 },
    { id: 'stu-003', name: 'Youssef Ibrahim', email: 'youssef.ibrahim@uniflow.edu', odId: 'CYS-2025-0118', balance: 12000, status: 'unpaid', invoiceCount: 2 },
    { id: 'stu-004', name: 'Salma Mahmoud', email: 'salma.mahmoud@uniflow.edu', odId: 'AI-2024-0077', balance: 0, status: 'cleared', invoiceCount: 3 },
    { id: 'stu-005', name: 'Ahmed Tarek', email: 'ahmed.tarek@uniflow.edu', odId: 'CS-2022-0008', balance: 1800, status: 'unpaid', invoiceCount: 5 },
    { id: 'stu-006', name: 'Nour Abdelrahman', email: 'nour.abdelrahman@uniflow.edu', odId: 'DS-2025-0203', balance: 0, status: 'cleared', invoiceCount: 1 },
];

const MOCK_ACCOUNTS: Record<string, AccountData> = {
    'CS-2024-0042': {
        balance: 0,
        invoices: [
            { id: 'inv-1', description: 'Tuition — Fall 2025', amount: 18000, status: 'paid', dueDate: '2025-09-15' },
            { id: 'inv-2', description: 'Lab Fee — Fall 2025', amount: 1200, status: 'paid', dueDate: '2025-09-15' },
            { id: 'inv-3', description: 'Library Fee', amount: 300, status: 'paid', dueDate: '2025-09-15' },
        ],
    },
    'DS-2023-0019': {
        balance: 4500,
        invoices: [
            { id: 'inv-4', description: 'Tuition — Fall 2025', amount: 18000, status: 'paid', dueDate: '2025-09-15' },
            { id: 'inv-5', description: 'Tuition — Spring 2026', amount: 18000, status: 'pending', dueDate: '2026-02-01' },
            { id: 'inv-6', description: 'Lab Fee — Spring 2026', amount: 1200, status: 'overdue', dueDate: '2026-01-10' },
            { id: 'inv-7', description: 'Late Penalty', amount: 300, status: 'overdue', dueDate: '2026-01-20' },
        ],
    },
    'CYS-2025-0118': {
        balance: 12000,
        invoices: [
            { id: 'inv-8', description: 'Tuition — Spring 2026', amount: 18000, status: 'pending', dueDate: '2026-02-01' },
            { id: 'inv-9', description: 'Registration Fee', amount: 600, status: 'overdue', dueDate: '2026-01-05' },
        ],
    },
};

const MOCK_DEFAULT_ACCOUNT: AccountData = {
    balance: 0,
    invoices: [
        { id: 'inv-x1', description: 'Tuition — Fall 2025', amount: 18000, status: 'paid', dueDate: '2025-09-15' },
    ],
};

const SAPayments: React.FC = () => {
    const t = useT();
    const [summaries, setSummaries] = useState<FinancialSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<SelectedStudent | null>(null);
    const [invoiceModal, setInvoiceModal] = useState(false);
    const [accountData, setAccountData] = useState<AccountData | null>(null);
    const [loadingAccount, setLoadingAccount] = useState(false);

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setSummaries(MOCK_SUMMARIES);
        setIsLoading(false);
    }, []);

    const openInvoiceModal = async (s: FinancialSummary) => {
        const odId = s.odId ?? s.id;
        setSelectedStudent({ id: s.id, odId, name: s.name });
        setInvoiceModal(true);
        setLoadingAccount(false);
        // MVP build: look up the student's account from static mock data.
        setAccountData(MOCK_ACCOUNTS[odId] ?? { ...MOCK_DEFAULT_ACCOUNT, balance: s.balance });
    };

    const closeModal = () => {
        setInvoiceModal(false);
        setSelectedStudent(null);
        setAccountData(null);
    };

    const filtered = summaries.filter(s =>
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const invoices: Invoice[] = accountData?.invoices ?? [];
    const totalBalance = accountData?.balance ?? accountData?.totalDue ?? 0;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.paymentsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.paymentsPageSubtitle')}</p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="relative w-full sm:w-64">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                        <input
                            type="text"
                            placeholder={t('sa.searchByStudent')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                        />
                    </div>
                    <button className="px-6 py-2.5 rounded-xl bg-[#6A3FF4] text-white font-bold text-sm shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity">
                        {t('sa.generateFeeSchedule')}
                    </button>
                </div>
            </AnimateOnView>

            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('sa.studentCol2')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('sa.invoicesCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('sa.totalBalanceCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('sa.statusCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('sa.actionsCol')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                [1, 2, 3].map(i => <tr key={i}><td colSpan={5} className="p-10 animate-pulse bg-white/5"></td></tr>)
                            ) : filtered.map((s) => (
                                <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="p-4">
                                        <p className="text-sm font-bold text-white">{s.name}</p>
                                        <p className="text-[10px] text-gray-500">{s.email}</p>
                                    </td>
                                    <td className="p-4 text-sm text-gray-300">{t('sa.itemsLbl', { n: s.invoiceCount })}</td>
                                    <td className="p-4 text-sm font-bold text-[#6A3FF4]">${s.balance.toLocaleString()}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                            s.balance > 0 ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-green-500/10 text-green-500 border-green-500/20'
                                        }`}>
                                            {s.balance > 0 ? t('sa.unpaidStatus') : t('sa.clearedStatus')}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button
                                            onClick={() => openInvoiceModal(s)}
                                            className="text-gray-400 hover:text-[#6A3FF4] transition-colors"
                                            aria-label={t('sa.viewInvoicesAria', { name: s.name })}
                                        >
                                            <i className="ph-bold ph-eye"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invoice Modal */}
            <AnimatePresence>
                {invoiceModal && selectedStudent && (
                    <motion.div
                        key="invoice-modal-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                        onClick={closeModal}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                            className={`${glassCardStyle} w-full max-w-lg p-6 space-y-4 max-h-[80vh] overflow-y-auto`}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="text-black dark:text-white text-lg font-bold">{selectedStudent.name}</h3>
                                    <p className="text-gray-500 text-xs">{t('sa.invoiceDetailsHeading')}</p>
                                </div>
                                <button
                                    onClick={closeModal}
                                    className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/20 transition-all"
                                    aria-label={t('sa.closeModalAria')}
                                >
                                    <i className="ph-bold ph-x"></i>
                                </button>
                            </div>

                            {loadingAccount ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map(i => <div key={i} className="h-14 bg-white/5 animate-pulse rounded-xl"></div>)}
                                </div>
                            ) : invoices.length === 0 ? (
                                <div className="text-center py-10">
                                    <i className="ph-duotone ph-receipt text-4xl text-gray-400 mb-2 block"></i>
                                    <p className="text-gray-500 text-sm">{t('sa.noInvoicesFound')}</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {invoices.map(inv => (
                                        <div key={inv.id} className="p-4 bg-white/5 rounded-xl border border-white/10 flex justify-between items-center">
                                            <div>
                                                <p className="text-black dark:text-white text-sm font-semibold">{inv.description ?? t('sa.invoiceFallback')}</p>
                                                {inv.dueDate && (
                                                    <p className="text-gray-500 text-[10px]">{t('sa.dueLbl', { date: new Date(inv.dueDate).toLocaleDateString() })}</p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[#6A3FF4] font-bold text-sm">${inv.amount.toLocaleString()}</p>
                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${invoiceStatusColor[inv.status] ?? invoiceStatusColor.pending}`}>
                                                    {inv.status.toUpperCase()}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                                <span className="text-gray-500 font-bold text-sm">{t('sa.totalBalanceLbl')}</span>
                                <span className="text-[#6A3FF4] font-bold text-xl">${totalBalance.toLocaleString()}</span>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SAPayments;
