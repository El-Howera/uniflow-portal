import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { ParticleCard } from '../../components/MagicBento';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface FinancialStats {
    summary: { paid: number; pending: number; total: number };
    chart: { months: string[]; paid: number[]; pending: number[] };
    byDepartment?: { department: string; paid: number; outstanding: number }[];
    currency?: string;
}

interface CategoryRow { category: string; paid: number; outstanding: number; count: number }
interface DefaulterRow { userId: string; name: string; email: string; major: string; outstanding: number; invoiceCount: number }
interface AgingBucket { bucket: string; total: number; count: number }

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

const LEDGER_PAGE = 20;
const DEFAULTERS_PAGE = 10;

interface ChartEntry { label: string; paid: number; pending: number }

function generateChartData(data: FinancialStats | null): ChartEntry[] {
    const now = new Date();
    const base: ChartEntry[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
        base.push({ label, paid: 0, pending: 0 });
    }
    if (data?.chart?.months) {
        data.chart.months.forEach((m, idx) => {
            const entry = base.find((e) => e.label === m);
            if (entry) {
                entry.paid = data.chart.paid[idx] ?? 0;
                entry.pending = data.chart.pending[idx] ?? 0;
            }
        });
    }
    return base;
}

const CATEGORY_PALETTE = ['#6A3FF4', '#A855F7', '#22C55E', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#8B5CF6'];
const AGING_COLORS: Record<string, string> = {
    current: '#22C55E',
    '0-30':  '#A3E635',
    '31-60': '#F59E0B',
    '61-90': '#F97316',
    '90+':   '#EF4444',
};

const TOOLTIP_STYLE = {
    backgroundColor: '#1A1A1A',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#E5E5E5',
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Realistic FCDS-scale financials (EGP).
// Build the trailing 6-month labels so the revenue trend lines up with "now".
const MOCK_FINANCIAL_STATS: FinancialStats = (() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short', year: 'numeric' }));
    }
    const paid = [3_120_000, 3_480_000, 3_950_000, 4_210_000, 4_580_000, 4_820_000];
    const pending = [1_410_000, 1_320_000, 1_280_000, 1_360_000, 1_290_000, 1_240_000];
    return {
        summary: { paid: 4_820_000, pending: 1_240_000, total: 6_060_000 },
        chart: { months, paid, pending },
        byDepartment: [
            { department: 'Computer Science', paid: 1_620_000, outstanding: 380_000 },
            { department: 'Data Science', paid: 1_240_000, outstanding: 290_000 },
            { department: 'Information Systems', paid: 940_000, outstanding: 210_000 },
            { department: 'Cybersecurity', paid: 620_000, outstanding: 180_000 },
            { department: 'Software Engineering', paid: 400_000, outstanding: 110_000 },
        ],
        currency: 'EGP',
    };
})();

const MOCK_BY_CATEGORY: CategoryRow[] = [
    { category: 'Tuition', paid: 3_600_000, outstanding: 820_000, count: 1142 },
    { category: 'Housing', paid: 540_000, outstanding: 180_000, count: 312 },
    { category: 'Lab Fees', paid: 280_000, outstanding: 90_000, count: 488 },
    { category: 'Library', paid: 120_000, outstanding: 60_000, count: 240 },
    { category: 'Exam Fees', paid: 180_000, outstanding: 70_000, count: 196 },
    { category: 'Other', paid: 100_000, outstanding: 20_000, count: 84 },
];

const MOCK_REFUNDS: { months: string[]; refunds: number[]; counts: number[] } = (() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short', year: 'numeric' }));
    }
    return { months, refunds: [24_000, 18_000, 36_000, 12_000, 28_000, 20_000], counts: [3, 2, 5, 1, 4, 2] };
})();

const MOCK_AGING: AgingBucket[] = [
    { bucket: 'current', total: 480_000, count: 142 },
    { bucket: '0-30', total: 320_000, count: 96 },
    { bucket: '31-60', total: 240_000, count: 58 },
    { bucket: '61-90', total: 130_000, count: 31 },
    { bucket: '90+', total: 70_000, count: 18 },
];

const MOCK_DEFAULTERS: DefaulterRow[] = [
    { userId: 'usr_2003', name: 'Khaled Abdullah', email: 'khaled.abdullah@student.uniflow.edu', major: 'Computer Science', outstanding: 30500, invoiceCount: 3 },
    { userId: 'usr_2007', name: 'Layla Mostafa', email: 'layla.mostafa@student.uniflow.edu', major: 'Data Science', outstanding: 19500, invoiceCount: 2 },
    { userId: 'usr_2021', name: 'Tarek Saad', email: 'tarek.saad@student.uniflow.edu', major: 'Information Systems', outstanding: 17800, invoiceCount: 2 },
    { userId: 'usr_2022', name: 'Rania Fouad', email: 'rania.fouad@student.uniflow.edu', major: 'Cybersecurity', outstanding: 15200, invoiceCount: 2 },
    { userId: 'usr_2023', name: 'Hossam Nasser', email: 'hossam.nasser@student.uniflow.edu', major: 'Computer Science', outstanding: 14000, invoiceCount: 1 },
    { userId: 'usr_2024', name: 'Dina Magdy', email: 'dina.magdy@student.uniflow.edu', major: 'Data Science', outstanding: 12600, invoiceCount: 2 },
    { userId: 'usr_2025', name: 'Bassem Ali', email: 'bassem.ali@student.uniflow.edu', major: 'Software Engineering', outstanding: 11400, invoiceCount: 1 },
    { userId: 'usr_2026', name: 'Habiba Sherif', email: 'habiba.sherif@student.uniflow.edu', major: 'Information Systems', outstanding: 9800, invoiceCount: 1 },
    { userId: 'usr_2027', name: 'Ziad Helmy', email: 'ziad.helmy@student.uniflow.edu', major: 'Cybersecurity', outstanding: 8200, invoiceCount: 1 },
    { userId: 'usr_2028', name: 'Nada Kamal', email: 'nada.kamal@student.uniflow.edu', major: 'Computer Science', outstanding: 6500, invoiceCount: 1 },
    { userId: 'usr_2029', name: 'Sherif Adel', email: 'sherif.adel@student.uniflow.edu', major: 'Data Science', outstanding: 5400, invoiceCount: 1 },
    { userId: 'usr_2030', name: 'Yara Ezzat', email: 'yara.ezzat@student.uniflow.edu', major: 'Software Engineering', outstanding: 3200, invoiceCount: 1 },
];

const MOCK_LEDGER: LedgerTransaction[] = (() => {
    const rows: LedgerTransaction[] = [];
    const names = [
        ['Yousef Mahmoud', 'yousef.mahmoud@student.uniflow.edu'],
        ['Mariam Hassan', 'mariam.hassan@student.uniflow.edu'],
        ['Khaled Abdullah', 'khaled.abdullah@student.uniflow.edu'],
        ['Nour Ibrahim', 'nour.ibrahim@student.uniflow.edu'],
        ['Salma Farouk', 'salma.farouk@student.uniflow.edu'],
        ['Tarek Saad', 'tarek.saad@student.uniflow.edu'],
        ['Rania Fouad', 'rania.fouad@student.uniflow.edu'],
        ['Hossam Nasser', 'hossam.nasser@student.uniflow.edu'],
    ];
    const methods = ['credit_card', 'bank_transfer', 'cash', 'apple_pay', 'paypal'];
    const statuses = ['completed', 'completed', 'completed', 'pending', 'refunded', 'failed'];
    const types = ['payment', 'payment', 'payment', 'refund', 'financial_aid'];
    const descriptions = [
        'Tuition Fees — Spring 2026', 'Lab Fee — Physics 201', 'Housing Fee — Dorm Block C',
        'Refund — Course withdrawal', 'Financial Aid Award', 'Exam Re-sit Fee', 'Library Late Fee',
    ];
    for (let i = 0; i < 34; i++) {
        const [name, email] = names[i % names.length];
        const type = types[i % types.length];
        const status = type === 'refund' ? 'refunded' : statuses[i % statuses.length];
        const method = methods[i % methods.length];
        const d = new Date(2026, 1 + (i % 3), 1 + (i % 27), 9 + (i % 8), (i * 7) % 60);
        const baseAmount = [42500, 1500, 9500, 8000, 30000, 600, 16000][i % 7];
        rows.push({
            id: `txn_led_${1000 + i}`,
            amount: baseAmount,
            type,
            method,
            status,
            description: descriptions[i % descriptions.length],
            receiptNumber: `RCP-2026-${String(1000 + i).padStart(6, '0')}`,
            createdAt: d.toISOString(),
            userId: `usr_led_${2000 + (i % names.length)}`,
            userName: name,
            userEmail: email,
            invoiceId: `inv_led_${3000 + i}`,
            invoiceTitle: descriptions[i % descriptions.length],
        });
    }
    return rows;
})();

const Financials: React.FC = () => {
    const t = useT();
    const currency = useCurrency();
    const navigate = useNavigate();
    // Page is mounted under both /admin/revenue-overview and
    // /financial/revenue-overview (Plan 5 financial sub-role surface).
    // Internal nav targets must stay inside whichever prefix the user
    // entered through — derive it from the current pathname so the back
    // route guard doesn't bounce the user out of their role.
    const location = useLocation();
    const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';
    const [data, setData] = useState<FinancialStats | null>(null);
    const [byCategory, setByCategory] = useState<CategoryRow[]>([]);
    const [refunds, setRefunds] = useState<{ months: string[]; refunds: number[]; counts: number[] }>({
        months: [], refunds: [], counts: [],
    });
    const [aging, setAging] = useState<AgingBucket[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // ── Top Defaulters state ─────────────────────────────────────────────
    const [defaulters, setDefaulters] = useState<DefaulterRow[]>([]);
    const [defaultersTotal, setDefaultersTotal] = useState(0);
    const [defLoading, setDefLoading] = useState(false);
    const [defSearch, setDefSearch] = useState('');
    const [defMajor, setDefMajor]   = useState('all');

    // ── Transaction Ledger state ─────────────────────────────────────────
    const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
    const [ledgerTotal, setLedgerTotal] = useState(0);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [ledgerSearch, setLedgerSearch] = useState('');
    const [ledgerStatus, setLedgerStatus] = useState('all');
    const [ledgerMethod, setLedgerMethod] = useState('all');
    const [ledgerType,   setLedgerType]   = useState('all');
    const [ledgerFrom,   setLedgerFrom]   = useState('');
    const [ledgerTo,     setLedgerTo]     = useState('');

    // ── Available majors for defaulter filter dropdown ──────────────────
    const majorOptions = useMemo(() => {
        const set = new Set<string>();
        defaulters.forEach((d) => d.major && set.add(d.major));
        return ['all', ...Array.from(set).sort()];
    }, [defaulters]);

    // ── Loaders (preview — filter/slice the static mock arrays, no backend) ──
    // Offset is passed explicitly so the View More button appends the next
    // page. `offset === 0` resets the list; anything else appends.
    const loadDefaulters = useCallback((offset: number) => {
        setDefLoading(true);
        const q = defSearch.trim().toLowerCase();
        const filtered = MOCK_DEFAULTERS.filter((d) => {
            const matchesSearch = q === '' || d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q);
            const matchesMajor = defMajor === 'all' || d.major === defMajor;
            return matchesSearch && matchesMajor;
        });
        const page = filtered.slice(offset, offset + DEFAULTERS_PAGE);
        setDefaulters((prev) => (offset > 0 ? [...prev, ...page] : page));
        setDefaultersTotal(filtered.length);
        setDefLoading(false);
    }, [defSearch, defMajor]);

    const loadLedger = useCallback((offset: number) => {
        setLedgerLoading(true);
        const q = ledgerSearch.trim().toLowerCase();
        const fromTs = ledgerFrom ? new Date(ledgerFrom).getTime() : null;
        const toTs = ledgerTo ? new Date(ledgerTo).getTime() : null;
        const filtered = MOCK_LEDGER.filter((row) => {
            const matchesSearch =
                q === '' ||
                row.userName.toLowerCase().includes(q) ||
                row.userEmail.toLowerCase().includes(q) ||
                (row.description ?? '').toLowerCase().includes(q);
            const matchesStatus = ledgerStatus === 'all' || row.status === ledgerStatus;
            const matchesMethod = ledgerMethod === 'all' || row.method === ledgerMethod;
            const matchesType = ledgerType === 'all' || row.type === ledgerType;
            const ts = new Date(row.createdAt).getTime();
            const matchesFrom = fromTs == null || ts >= fromTs;
            const matchesTo = toTs == null || ts <= toTs + 86_400_000; // include the "to" day
            return matchesSearch && matchesStatus && matchesMethod && matchesType && matchesFrom && matchesTo;
        });
        const page = filtered.slice(offset, offset + LEDGER_PAGE);
        setLedger((prev) => (offset > 0 ? [...prev, ...page] : page));
        setLedgerTotal(filtered.length);
        setLedgerLoading(false);
    }, [ledgerSearch, ledgerStatus, ledgerMethod, ledgerType, ledgerFrom, ledgerTo]);

    useEffect(() => {
        // Preview: load all static chart/summary data, no backend.
        setData(MOCK_FINANCIAL_STATS);
        setByCategory(MOCK_BY_CATEGORY);
        setRefunds(MOCK_REFUNDS);
        setAging(MOCK_AGING);
        setIsLoading(false);
        loadDefaulters(0);
        loadLedger(0);
        // Initial load on mount only — filter changes handled by the effects
        // below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-filter on filter change (debounced 350ms for free-text search).
    useEffect(() => {
        const id = setTimeout(() => loadDefaulters(0), 350);
        return () => clearTimeout(id);
    }, [defSearch, defMajor, loadDefaulters]);

    useEffect(() => {
        const id = setTimeout(() => loadLedger(0), 350);
        return () => clearTimeout(id);
    }, [ledgerSearch, ledgerStatus, ledgerMethod, ledgerType, ledgerFrom, ledgerTo, loadLedger]);

    const chartData = useMemo(() => generateChartData(data), [data]);
    const refundChartData = useMemo(
        () => refunds.months.map((m, i) => ({ label: m, refunds: refunds.refunds[i] ?? 0, count: refunds.counts[i] ?? 0 })),
        [refunds]
    );
    // Recharts' Formatter accepts ValueType | undefined; coerce to a number
    // for the formatter and return a single-cell array Recharts will render.
    const moneyTooltipFormatter = (v: unknown): [string] => [formatMoney(Number(v ?? 0))];
    // Compact currency-prefixed axis tick (e.g. "EGP 12k") so charts and
    // tooltips are unambiguous about the unit.
    const moneyAxisTick = (v: number): string => {
        if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(1)}M`;
        if (Math.abs(v) >= 1_000)     return `${currency} ${(v / 1_000).toFixed(0)}k`;
        return `${currency} ${v}`;
    };

    if (isLoading) return <div className="p-10 text-center animate-pulse">{t('admin.finLoadingData')}</div>;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h1 className="text-3xl font-bold text-black dark:text-white mb-2">{t('admin.financialsTitle')}</h1>
                <p className="text-gray-600 dark:text-gray-400">
                    {t('admin.financialsSubtitle')} ({currency})
                </p>
            </AnimateOnView>

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <ParticleCard className={`${glassCardStyle} p-6`} glowColor="34, 197, 94" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.finTotalCollected')}</p>
                    <h2 className="text-3xl font-bold text-green-500">{formatMoney(data?.summary.paid)}</h2>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-6`} glowColor="234, 179, 8" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.finOutstandingBalance')}</p>
                    <h2 className="text-3xl font-bold text-yellow-500">{formatMoney(data?.summary.pending)}</h2>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-6`} glowColor="106, 63, 244" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.finTotalBilling')}</p>
                    <h2 className="text-3xl font-bold text-[#6A3FF4]">{formatMoney(data?.summary.total)}</h2>
                </ParticleCard>
            </div>

            {/* Revenue trend (existing) */}
            <div className={`${glassCardStyle} p-8`}>
                <h3 className="text-xl font-bold text-black dark:text-white mb-6">{t('admin.finRevenueTrend')}</h3>
                <ResponsiveContainer width="100%" height={256}>
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="label" stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                        <YAxis
                            stroke="#9CA3AF"
                            tick={{ fill: '#9CA3AF', fontSize: 11 }}
                            tickFormatter={moneyAxisTick}
                        />
                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={moneyTooltipFormatter} />
                        <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
                        <Bar dataKey="paid" name={t('admin.finBarCollected')} fill="#6A3FF4" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="pending" name={t('admin.finBarOutstanding')} fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* Two-column row: Revenue by Category (donut) + Aging Buckets (bar) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.finRevenueByCategory')}</h3>
                    <p className="text-gray-500 text-xs mb-4">{t('admin.finRevenueByCategorySub')}</p>
                    {byCategory.length === 0 ? (
                        <p className="text-gray-500 text-sm py-12 text-center">{t('admin.finNoCategoryData')}</p>
                    ) : (
                        <div style={{ height: 280 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={byCategory}
                                        dataKey="paid"
                                        nameKey="category"
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={100}
                                        innerRadius={60}
                                        paddingAngle={2}
                                    >
                                        {byCategory.map((_, i) => (
                                            <Cell key={i} fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={moneyTooltipFormatter} />
                                    <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>

                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.finAgingTitle')}</h3>
                    <p className="text-gray-500 text-xs mb-4">
                        {t('admin.finAgingSubtitlePre')}<span className="text-green-400">{t('admin.finAgingSubtitleGreen')}</span>{t('admin.finAgingSubtitleMiddle')}
                        <span className="text-red-400">{t('admin.finAgingSubtitleRed')}</span>{t('admin.finAgingSubtitleEnd')}
                    </p>
                    {aging.every((b) => b.total === 0) ? (
                        <p className="text-gray-500 text-sm py-12 text-center">{t('admin.finAgingEmpty')}</p>
                    ) : (
                        <div style={{ height: 280 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={aging} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                    <XAxis dataKey="bucket" stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                                    <YAxis
                                        stroke="#9CA3AF"
                                        tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                        tickFormatter={moneyAxisTick}
                                    />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={moneyTooltipFormatter} />
                                    <Bar dataKey="total" name={t('admin.finBarOutstanding')} radius={[4, 4, 0, 0]}>
                                        {aging.map((b) => (
                                            <Cell key={b.bucket} fill={AGING_COLORS[b.bucket] ?? '#6A3FF4'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            </div>

            {/* Refund trend (line) */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.finRefundTrend')}</h3>
                <p className="text-gray-500 text-xs mb-4">{t('admin.finRefundSubtitle')}</p>
                {refundChartData.length === 0 ? (
                    <p className="text-gray-500 text-sm py-12 text-center">{t('admin.finNoRefunds')}</p>
                ) : (
                    <ResponsiveContainer width="100%" height={240}>
                        <LineChart data={refundChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                            <XAxis dataKey="label" stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 11 }} />
                            <YAxis
                                stroke="#9CA3AF"
                                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                                tickFormatter={moneyAxisTick}
                            />
                            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={moneyTooltipFormatter} />
                            <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
                            <Line type="monotone" dataKey="refunds" name={t('admin.finRefundsLine')} stroke="#EF4444" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* Top Defaulters — always visible, filterable, paginated */}
            <div className={`${glassCardStyle} p-6`}>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.finTopDefaulters')}</h3>
                        <p className="text-gray-500 text-xs">
                            {t('admin.finDefaultersCount', { shown: defaulters.length, total: defaultersTotal, s: defaultersTotal === 1 ? '' : 's' })}
                        </p>
                    </div>
                </div>
                {/* Filters — glass morphism convention (see docs/design-system.md) */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                    <div className="relative flex-1">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={defSearch}
                            onChange={(e) => setDefSearch(e.target.value)}
                            placeholder={t('admin.finDefSearchPh')}
                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                        />
                    </div>
                    <div className="min-w-[180px]">
                        <GlassDropdown
                            value={defMajor}
                            onChange={setDefMajor}
                            options={majorOptions.map((m) => ({
                                value: m,
                                label: m === 'all' ? t('admin.finAllMajors') : m,
                            }))}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                </div>
                {defaulters.length === 0 ? (
                    <p className="text-gray-500 text-sm py-8 text-center">
                        {defLoading ? t('admin.finLoading') : t('admin.finDefEmpty')}
                    </p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColIndex')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColStudent')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColMajor')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColInvoices')}</th>
                                        <th className="text-right py-2 pr-4 font-bold">{t('admin.finColOutstanding')}</th>
                                        <th className="text-right py-2 font-bold">{t('admin.finColActions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {defaulters.map((d, i) => (
                                        <tr key={d.userId} className="hover:bg-white/5 transition-colors">
                                            <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
                                            <td className="py-2 pr-4">
                                                <div className="text-black dark:text-white font-medium">{d.name}</div>
                                                <div className="text-gray-500 text-xs">{d.email}</div>
                                            </td>
                                            <td className="py-2 pr-4 text-gray-400">{d.major}</td>
                                            <td className="py-2 pr-4 text-gray-400">{d.invoiceCount}</td>
                                            <td className="py-2 pr-4 text-right font-bold text-red-400">{formatMoney(d.outstanding)}</td>
                                            <td className="py-2 text-right">
                                                <button
                                                    onClick={() => navigate(`${rolePrefix}/financials/defaulters/${d.userId}`)}
                                                    className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                                    title={t('admin.finViewDetailsTitle')}
                                                >
                                                    {t('admin.finViewDetails')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {defaulters.length < defaultersTotal && (
                            <div className="mt-4 text-center">
                                <button
                                    onClick={() => loadDefaulters(defaulters.length)}
                                    disabled={defLoading}
                                    className="px-5 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-bold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    {defLoading ? t('admin.finLoading') : t('admin.finViewMore', { remaining: defaultersTotal - defaulters.length })}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Revenue by Department (existing) */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.finRevenueByDept')}</h3>
                {data?.byDepartment && data.byDepartment.length > 0 ? (
                    <div
                        style={{ height: Math.max(200, data.byDepartment.length * 50) }}
                        aria-label={t('admin.finRevByDeptAria')}
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart layout="vertical" data={data.byDepartment} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                                <XAxis
                                    type="number"
                                    stroke="#9CA3AF"
                                    tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                    tickFormatter={moneyAxisTick}
                                />
                                <YAxis type="category" dataKey="department" width={120} stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 12 }} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={moneyTooltipFormatter} />
                                <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
                                <Bar dataKey="paid" name={t('admin.finBarCollected')} fill="#6A3FF4" radius={[0, 4, 4, 0]} />
                                <Bar dataKey="outstanding" name={t('admin.finBarOutstanding')} fill="#F59E0B" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <p className="text-gray-400 text-sm">{t('admin.finNoDeptData')}</p>
                )}
            </div>

            {/* Transaction Ledger — always visible, filterable, paginated */}
            <div className={`${glassCardStyle} p-6`}>
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.finTransactionLedger')}</h3>
                        <p className="text-gray-500 text-xs">
                            {t('admin.finLedgerCount', { shown: ledger.length, total: ledgerTotal, s: ledgerTotal === 1 ? '' : 's' })}
                        </p>
                    </div>
                </div>
                {/* Filters — glass morphism convention. Native dropdowns
                    are forbidden; use GlassDropdown. Date inputs are kept as
                    native <input type="date"> (no glass picker exists yet)
                    but wear glass classes so they match the row visually. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
                    <div className="relative lg:col-span-2">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={ledgerSearch}
                            onChange={(e) => setLedgerSearch(e.target.value)}
                            placeholder={t('admin.finLedgerSearchPh')}
                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                        />
                    </div>
                    <GlassDropdown
                        value={ledgerStatus}
                        onChange={setLedgerStatus}
                        options={[
                            { value: 'all',       label: t('admin.finStatusAll') },
                            { value: 'completed', label: t('admin.finStatusCompleted') },
                            { value: 'pending',   label: t('admin.finStatusPending') },
                            { value: 'failed',    label: t('admin.finStatusFailed') },
                            { value: 'refunded',  label: t('admin.finStatusRefunded') },
                        ]}
                        direction="auto"
                        className="w-full"
                    />
                    <GlassDropdown
                        value={ledgerType}
                        onChange={setLedgerType}
                        options={[
                            { value: 'all',           label: t('admin.finTypeAll') },
                            { value: 'payment',       label: t('admin.finTypePayment') },
                            { value: 'refund',        label: t('admin.finTypeRefund') },
                            { value: 'financial_aid', label: t('admin.finTypeAid') },
                        ]}
                        direction="auto"
                        className="w-full"
                    />
                    <GlassDropdown
                        value={ledgerMethod}
                        onChange={setLedgerMethod}
                        options={[
                            { value: 'all',           label: t('admin.finMethodAll') },
                            { value: 'credit_card',   label: t('admin.finMethodCard') },
                            { value: 'bank_transfer', label: t('admin.finMethodBank') },
                            { value: 'paypal',        label: t('admin.finMethodPaypal') },
                            { value: 'apple_pay',     label: t('admin.finMethodApple') },
                            { value: 'cash',          label: t('admin.finMethodCash') },
                        ]}
                        direction="auto"
                        className="w-full"
                    />
                    <div className="flex items-center gap-2">
                        <input
                            type="date"
                            value={ledgerFrom}
                            onChange={(e) => setLedgerFrom(e.target.value)}
                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-2 py-2 text-xs text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl [color-scheme:dark]"
                            title={t('admin.finDateFrom')}
                        />
                        <span className="text-gray-500 text-xs">→</span>
                        <input
                            type="date"
                            value={ledgerTo}
                            onChange={(e) => setLedgerTo(e.target.value)}
                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-2 py-2 text-xs text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl [color-scheme:dark]"
                            title={t('admin.finDateTo')}
                        />
                    </div>
                </div>
                {ledger.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-6">
                        {ledgerLoading ? t('admin.finLoading') : t('admin.finLedgerEmpty')}
                    </p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColDate')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColStudent')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColDescription')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColMethod')}</th>
                                        <th className="text-left py-2 pr-4 font-bold">{t('admin.finColStatus')}</th>
                                        <th className="text-right py-2 pr-4 font-bold">{t('admin.finColAmount')}</th>
                                        <th className="text-right py-2 font-bold">{t('admin.finColActions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {ledger.map((row) => (
                                        <tr key={row.id} className="hover:bg-white/5 transition-colors">
                                            <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                                                {new Date(row.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="py-2 pr-4 text-black dark:text-white font-medium">{row.userName}</td>
                                            <td className="py-2 pr-4 text-gray-400 max-w-[200px] truncate">{row.description || row.invoiceTitle || '—'}</td>
                                            <td className="py-2 pr-4">
                                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/5 text-gray-400 uppercase">{row.method}</span>
                                            </td>
                                            <td className="py-2 pr-4">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                                    row.status === 'completed' ? 'bg-green-500/10 text-green-400'
                                                    : row.status === 'refunded' ? 'bg-red-500/10 text-red-400'
                                                    : row.status === 'failed'   ? 'bg-red-500/10 text-red-400'
                                                    : 'bg-yellow-500/10 text-yellow-400'
                                                }`}>{row.status}</span>
                                            </td>
                                            <td className={`py-2 pr-4 text-right font-bold ${
                                                row.type === 'refund' ? 'text-red-400' : 'text-black dark:text-white'
                                            }`}>
                                                {row.type === 'refund' ? '−' : ''}{formatMoney(row.amount)}
                                            </td>
                                            <td className="py-2 text-right">
                                                <button
                                                    onClick={() => navigate(`${rolePrefix}/financials/transactions/${row.id}`)}
                                                    className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                                >
                                                    {t('admin.finViewDetails')}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {ledger.length < ledgerTotal && (
                            <div className="mt-4 text-center">
                                <button
                                    onClick={() => loadLedger(ledger.length)}
                                    disabled={ledgerLoading}
                                    className="px-5 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-bold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    {ledgerLoading ? t('admin.finLoading') : t('admin.finViewMore', { remaining: ledgerTotal - ledger.length })}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

        </div>
    );
};

export default Financials;
