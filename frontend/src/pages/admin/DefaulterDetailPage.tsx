import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { formatMoney, useCurrency } from '../../utils/format';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface Invoice {
    id: string;
    title: string;
    category: string;
    amount: number;
    paid: number;
    balance: number;
    status: string;
    dueDate: string;
    semester?: string | null;
    daysPastDue: number;
}

interface DefaulterDetail {
    user: {
        id: string;
        name: string;
        email: string;
        odId?: string | null;
        major?: string | null;
        level?: number | null;
        gpa?: number | string | null;
    };
    outstandingTotal: number;
    invoiceCount: number;
    invoices: Invoice[];
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A small catalog keyed by userId so the
// page renders fully for any defaulter the Financials table links to. Unknown
// ids fall back to a generated record built from the route param.
const MOCK_DEFAULTERS: Record<string, DefaulterDetail> = {
    usr_2003: {
        user: {
            id: 'usr_2003', name: 'Khaled Abdullah', email: 'khaled.abdullah@student.uniflow.edu',
            odId: 'OD-2023-0451', major: 'Computer Science', level: 3, gpa: 2.85,
        },
        outstandingTotal: 30500,
        invoiceCount: 3,
        invoices: [
            { id: 'inv_4001', title: 'Tuition Fees — Spring 2026', category: 'tuition', amount: 42500, paid: 30000, balance: 12500, status: 'partial', dueDate: '2026-02-28T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 24 },
            { id: 'inv_4002', title: 'Lab Fee — CS305', category: 'lab', amount: 2000, paid: 0, balance: 2000, status: 'overdue', dueDate: '2026-03-01T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 23 },
            { id: 'inv_4003', title: 'Library Late Fee', category: 'library', amount: 16000, paid: 0, balance: 16000, status: 'overdue', dueDate: '2026-01-15T00:00:00.000Z', semester: 'Fall 2025', daysPastDue: 68 },
        ],
    },
    usr_2007: {
        user: {
            id: 'usr_2007', name: 'Layla Mostafa', email: 'layla.mostafa@student.uniflow.edu',
            odId: 'OD-2024-0188', major: 'Data Science', level: 2, gpa: 3.42,
        },
        outstandingTotal: 19500,
        invoiceCount: 2,
        invoices: [
            { id: 'inv_4101', title: 'Tuition Fees — Spring 2026', category: 'tuition', amount: 38000, paid: 28000, balance: 10000, status: 'partial', dueDate: '2026-02-28T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 24 },
            { id: 'inv_4102', title: 'Housing Fee — Dorm Block A', category: 'housing', amount: 9500, paid: 0, balance: 9500, status: 'overdue', dueDate: '2026-03-05T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 19 },
        ],
    },
};

function fallbackDefaulter(userId: string): DefaulterDetail {
    return {
        user: {
            id: userId, name: 'Omar El-Sayed', email: 'omar.elsayed@student.uniflow.edu',
            odId: 'OD-2023-0902', major: 'Information Systems', level: 4, gpa: 2.61,
        },
        outstandingTotal: 14000,
        invoiceCount: 2,
        invoices: [
            { id: 'inv_4901', title: 'Tuition Fees — Spring 2026', category: 'tuition', amount: 40000, paid: 32000, balance: 8000, status: 'partial', dueDate: '2026-02-28T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 24 },
            { id: 'inv_4902', title: 'Exam Re-sit Fee', category: 'exam', amount: 6000, paid: 0, balance: 6000, status: 'overdue', dueDate: '2026-03-10T00:00:00.000Z', semester: 'Spring 2026', daysPastDue: 14 },
        ],
    };
}

const DefaulterDetailPage: React.FC = () => {
    const t = useT();
    const { userId } = useParams<{ userId: string }>();
    const navigate = useNavigate();
    const currency = useCurrency();
    // Aliased under /admin/financials/defaulters/:userId and
    // /financial/financials/defaulters/:userId.
    const location = useLocation();
    const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';
    const [data, setData] = useState<DefaulterDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error] = useState<string | null>(null);

    useEffect(() => {
        if (!userId) return;
        // Preview: resolve the mock record for this userId, overriding the id so the
        // page reflects the route param.
        const base = MOCK_DEFAULTERS[userId] ?? fallbackDefaulter(userId);
        setData({ ...base, user: { ...base.user, id: userId } });
        setIsLoading(false);
    }, [userId]);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <button
                            onClick={() => navigate(-1)}
                            className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                        >
                            <i className="ph-bold ph-arrow-left" /> {t('admin.ddBack')}
                        </button>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">
                            {t('admin.ddOutstandingBalance')}
                        </h1>
                        <p className="text-gray-500 text-sm">
                            {data ? `${data.user.name}${data.user.email ? ` · ${data.user.email}` : ''}` : userId}
                        </p>
                    </div>
                    {/* Admin-only — financial sub-role doesn't get user
                        edit access, so hide the button when not under /admin. */}
                    {data && rolePrefix === '/admin' && (
                        <button
                            onClick={() => navigate(`/admin/users/${data.user.id}/edit`)}
                            className="px-4 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white text-sm font-bold hover:bg-white/10 transition-colors"
                        >
                            {t('admin.ddOpenStudentProfile')}
                        </button>
                    )}
                </div>
            </AnimateOnView>

            {isLoading ? (
                <div className={`${glassCardStyle} p-12 text-center text-gray-500 animate-pulse`}>
                    {t('admin.ddLoadingDetails')}
                </div>
            ) : error ? (
                <div className={`${glassCardStyle} p-8 text-center`}>
                    <i className="ph-fill ph-warning text-4xl text-red-400 mb-3 block" />
                    <p className="text-black dark:text-white font-bold mb-1">{t('admin.ddCouldNotLoadStudent')}</p>
                    <p className="text-gray-500 text-sm">{error}</p>
                </div>
            ) : data ? (
                <>
                    {/* Summary stat row */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <ParticleCard
                            className={`${glassCardStyle} p-5`}
                            glowColor="239, 68, 68"
                            enableTilt={false}
                            enableMagnetism={false}
                        >
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                                {t('admin.ddTotalOutstanding')}
                            </p>
                            <p className="text-2xl font-bold text-red-400 truncate">
                                {formatMoney(data.outstandingTotal)}
                            </p>
                            <p className="text-gray-500 text-xs mt-1">{t('admin.ddInCurrency', { currency })}</p>
                        </ParticleCard>
                        <SummaryStat label={t('admin.ddOpenInvoices')} value={String(data.invoiceCount)} />
                        <SummaryStat label={t('admin.ddMajor')}  value={data.user.major ?? '—'} />
                        <SummaryStat
                            label={t('admin.ddLevelGpa')}
                            value={
                                (data.user.level ? t('admin.ddLevelN', { n: data.user.level }) : '—') +
                                (data.user.gpa != null ? ` · ${t('admin.ddGpaN', { gpa: Number(data.user.gpa).toFixed(2) })}` : '')
                            }
                        />
                    </div>

                    {/* Invoice breakdown */}
                    <div className={`${glassCardStyle} p-6`}>
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.ddInvoiceBreakdown')}</h3>
                                <p className="text-gray-500 text-xs">{t('admin.ddOpenInvoicesByDue')}</p>
                            </div>
                        </div>
                        {data.invoices.length === 0 ? (
                            <p className="text-gray-500 text-sm py-8 text-center">
                                {t('admin.ddNoOutstandingInvoices')}
                            </p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                            <th className="text-left py-2 pr-3 font-bold">{t('admin.ddColInvoice')}</th>
                                            <th className="text-left py-2 pr-3 font-bold">{t('admin.ddColCategory')}</th>
                                            <th className="text-left py-2 pr-3 font-bold">{t('admin.ddColSemester')}</th>
                                            <th className="text-left py-2 pr-3 font-bold">{t('admin.ddColDue')}</th>
                                            <th className="text-left py-2 pr-3 font-bold">{t('admin.ddColStatus')}</th>
                                            <th className="text-right py-2 pr-3 font-bold">{t('admin.ddColTotal')}</th>
                                            <th className="text-right py-2 pr-3 font-bold">{t('admin.ddColPaid')}</th>
                                            <th className="text-right py-2 font-bold">{t('admin.ddColBalance')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {data.invoices.map((inv) => (
                                            <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                                                <td className="py-2 pr-3 text-black dark:text-white font-medium">{inv.title}</td>
                                                <td className="py-2 pr-3">
                                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white/5 text-gray-400">
                                                        {inv.category}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                                                    {inv.semester || '—'}
                                                </td>
                                                <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                                                    {new Date(inv.dueDate).toLocaleDateString()}
                                                    {inv.daysPastDue > 0 && (
                                                        <span className="ml-1 text-[10px] text-red-400">
                                                            {t('admin.ddDaysLate', { days: inv.daysPastDue })}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2 pr-3">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                            inv.status === 'overdue'
                                                                ? 'bg-red-500/10 text-red-400'
                                                                : inv.status === 'partial'
                                                                ? 'bg-yellow-500/10 text-yellow-400'
                                                                : 'bg-white/5 text-gray-400'
                                                        }`}
                                                    >
                                                        {inv.status}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-right text-gray-400">{formatMoney(inv.amount)}</td>
                                                <td className="py-2 pr-3 text-right text-green-400">{formatMoney(inv.paid)}</td>
                                                <td className="py-2 text-right font-bold text-red-400">{formatMoney(inv.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t border-white/10">
                                            <td colSpan={7} className="py-3 pr-3 text-right text-gray-500 uppercase text-xs font-bold">
                                                {t('admin.ddTotalOutstanding')}
                                            </td>
                                            <td className="py-3 text-right font-bold text-red-400 text-base">
                                                {formatMoney(data.outstandingTotal)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            ) : null}
        </div>
    );
};

const SummaryStat: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
    <div className={`${glassCardStyle} p-5`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{label}</p>
        <p className={`text-sm font-bold truncate ${accent ?? 'text-black dark:text-white'}`}>{value}</p>
    </div>
);

export default DefaulterDetailPage;
