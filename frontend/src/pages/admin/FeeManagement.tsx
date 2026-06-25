// src/pages/admin/FeeManagement.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { ParticleCard } from '../../components/MagicBento';
import { IssueInvoiceModal } from '../../components/IssueInvoiceModal';
import { useHasPermission } from '../../utils/permissions';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
    "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// ─── Types ────────────────────────────────────────────────────────────────────

// Mirrors backend/prisma/schema.prisma → enum FeeCategory.
// Keep this list in sync with the backend Zod schema.
const FEE_CATEGORIES = [
    'registration', 'document', 'lab', 'tuition', 'library',
    'housing', 'exam', 'sports', 'other',
] as const;
type FeeCategory = typeof FEE_CATEGORIES[number];

interface ServiceFee {
    id: string;
    name: string;
    description?: string | null;
    /** Decimal string from Prisma — the canonical amount column */
    amount: string | number;
    category: FeeCategory;
    processingDays: number;
    variable: boolean;
    isActive: boolean;
}

interface FinancialSummary {
    paid: number;
    pending: number;
    total: number;
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Realistic FCDS service fee catalog (EGP).
const MOCK_FEES: ServiceFee[] = [
    { id: 'fee_1', name: 'Tuition — Computer Science', description: 'Per-semester tuition for the CS program', amount: 42500, category: 'tuition', processingDays: 0, variable: false, isActive: true },
    { id: 'fee_2', name: 'Lab Access Fee', description: 'Physics & engineering lab usage per term', amount: 1500, category: 'lab', processingDays: 0, variable: false, isActive: true },
    { id: 'fee_3', name: 'Library Late Return', description: 'Daily late fee for overdue items', amount: 50, category: 'library', processingDays: 0, variable: true, isActive: true },
    { id: 'fee_4', name: 'Transcript Copy', description: 'Official transcript document', amount: 200, category: 'document', processingDays: 3, variable: false, isActive: true },
    { id: 'fee_5', name: 'Dorm Housing — Block C', description: 'On-campus housing per semester', amount: 9500, category: 'housing', processingDays: 0, variable: false, isActive: true },
    { id: 'fee_6', name: 'Exam Re-sit', description: 'Per-course supplementary exam', amount: 600, category: 'exam', processingDays: 0, variable: false, isActive: true },
    { id: 'fee_7', name: 'Sports Facility Membership', description: 'Gym & courts access per term', amount: 800, category: 'sports', processingDays: 0, variable: false, isActive: true },
    { id: 'fee_8', name: 'Course Registration', description: 'One-time registration processing', amount: 350, category: 'registration', processingDays: 1, variable: false, isActive: true },
];

const MOCK_FINANCIAL_SUMMARY: FinancialSummary = {
    paid: 4_820_000,
    pending: 1_240_000,
    total: 6_060_000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAmount(fee: ServiceFee): number {
    return parseFloat(String(fee.amount ?? 0)) || 0;
}

const CATEGORY_COLORS: Record<FeeCategory, string> = {
    registration: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    document:     'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
    lab:          'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    tuition:      'bg-[#6A3FF4]/20 text-[#7B5AFF] border border-[#6A3FF4]/30',
    library:      'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    housing:      'bg-pink-500/20 text-pink-400 border border-pink-500/30',
    exam:         'bg-red-500/20 text-red-400 border border-red-500/30',
    sports:       'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    other:        'bg-gray-500/20 text-gray-400 border border-gray-500/30',
};

function categoryBadgeClass(category: string): string {
    const key = (category ?? 'other').toLowerCase() as FeeCategory;
    return CATEGORY_COLORS[key] ?? CATEGORY_COLORS.other;
}

const CATEGORY_ICONS: Record<FeeCategory, string> = {
    registration: 'ph-clipboard-text',
    document:     'ph-file-text',
    lab:          'ph-flask',
    tuition:      'ph-graduation-cap',
    library:      'ph-books',
    housing:      'ph-house',
    exam:         'ph-exam',
    sports:       'ph-soccer-ball',
    other:        'ph-tag',
};

function categoryIcon(category: string): string {
    const key = (category ?? 'other').toLowerCase() as FeeCategory;
    return CATEGORY_ICONS[key] ?? CATEGORY_ICONS.other;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => (
    <div className={`${glassCardStyle} p-6 animate-pulse`}>
        <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-white/10" />
            <div className="w-20 h-6 rounded-full bg-white/10" />
        </div>
        <div className="w-3/4 h-5 rounded bg-white/10 mb-2" />
        <div className="w-1/2 h-4 rounded bg-white/10 mb-4" />
        <div className="w-1/3 h-8 rounded bg-white/10" />
    </div>
);

const SkeletonStat: React.FC = () => (
    <div className={`${glassCardStyle} p-5 animate-pulse`}>
        <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white/10" />
            <div className="w-28 h-4 rounded bg-white/10" />
        </div>
        <div className="w-20 h-8 rounded bg-white/10 mb-1" />
        <div className="w-16 h-3 rounded bg-white/10" />
    </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface FeeForm {
    name: string;
    amount: string;
    category: FeeCategory;
    description: string;
}

const FeeManagement: React.FC = () => {
    const t = useT();
    const currency = useCurrency();
    const canDelete = useHasPermission('Financial Management', 'delete');
    const canWrite = useHasPermission('Financial Management', 'write');
    const [fees, setFees] = useState<ServiceFee[]>([]);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [financials, setFinancials] = useState<FinancialSummary | null>(null);
    const [isLoadingFees, setIsLoadingFees] = useState(true);
    const [isLoadingFinancials, setIsLoadingFinancials] = useState(true);
    const [fetchError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [editingFee, setEditingFee] = useState<ServiceFee | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<FeeForm>({ name: '', amount: '', category: 'other', description: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Issue-invoice modal — populated from a fee row (per-card "Issue") OR
    // empty (top-level "Issue Invoice" button for ad-hoc charges).
    const [issueFor, setIssueFor] = useState<{
        title?: string;
        amount?: string | number;
        category?: 'tuition' | 'fees' | 'deposit' | 'service' | 'other';
        description?: string;
        serviceFeeId?: string;
    } | null>(null);
    const [issueToast, setIssueToast] = useState<string | null>(null);

    // Map a ServiceFee category to the InvoiceCategory enum the backend
    // accepts. Most don't share names — collapse everything except the four
    // semantic matches into 'fees' / 'service' / 'other'.
    const feeCategoryToInvoice = (c: string): 'tuition' | 'fees' | 'deposit' | 'service' | 'other' => {
        const k = (c || '').toLowerCase();
        if (k === 'tuition') return 'tuition';
        if (k === 'deposit') return 'deposit';
        if (['document', 'exam', 'library', 'lab', 'sports'].includes(k)) return 'service';
        return 'fees';
    };

    // Preview: load static service fees + financial summary, no backend.
    useEffect(() => {
        setFees(MOCK_FEES);
        setIsLoadingFees(false);
        setFinancials(MOCK_FINANCIAL_SUMMARY);
        setIsLoadingFinancials(false);
    }, []);

    // Derive categories for filter pills
    const categories = useMemo(() => {
        const seen = new Set<string>();
        fees.forEach((f) => {
            if (f.category) seen.add(f.category.toLowerCase());
        });
        return Array.from(seen).sort();
    }, [fees]);

    // Filtered + searched fees
    const visible = useMemo(() => {
        return fees.filter((f) => {
            const q = search.trim().toLowerCase();
            const matchesSearch =
                q === '' ||
                f.name.toLowerCase().includes(q) ||
                (f.category ?? '').toLowerCase().includes(q) ||
                (f.description ?? '').toLowerCase().includes(q);
            const matchesCategory =
                selectedCategory === 'all' ||
                (f.category ?? '').toLowerCase() === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [fees, search, selectedCategory]);

    const openAdd = () => {
        setEditingFee(null);
        setForm({ name: '', amount: '', category: 'other', description: '' });
        setSaveError(null);
        setShowForm(true);
    };
    const openEdit = (f: ServiceFee) => {
        setEditingFee(f);
        setForm({
            name: f.name,
            amount: String(resolveAmount(f)),
            category: (FEE_CATEGORIES as readonly string[]).includes(f.category) ? f.category : 'other',
            description: f.description ?? '',
        });
        setSaveError(null);
        setShowForm(true);
    };

    // Preview: save mutates local state only (optimistic), no network.
    const saveFee = () => {
        if (!form.name.trim()) { setSaveError(t('admin.feeMgmtValName')); return; }
        const amountNum = parseFloat(form.amount);
        if (Number.isNaN(amountNum) || amountNum < 0) {
            setSaveError(t('admin.feeMgmtValAmount'));
            return;
        }
        setIsSaving(true);
        setSaveError(null);
        if (editingFee) {
            setFees((prev) =>
                prev.map((f) =>
                    f.id === editingFee.id
                        ? { ...f, name: form.name.trim(), amount: amountNum, category: form.category, description: form.description.trim() || null }
                        : f,
                ),
            );
        } else {
            const newFee: ServiceFee = {
                id: `fee_${Date.now()}`,
                name: form.name.trim(),
                amount: amountNum,
                category: form.category,
                description: form.description.trim() || null,
                processingDays: 0,
                variable: false,
                isActive: true,
            };
            setFees((prev) => [...prev, newFee]);
        }
        setShowForm(false);
        setIsSaving(false);
    };

    // Preview: soft toggle mutates local state only — mirrors Manage Courses'
    // disable/re-enable pattern. No network.
    const toggleActiveFee = (fee: ServiceFee, nextActive: boolean) => {
        if (!nextActive) {
            // Active list filters out !isActive — just drop locally.
            setFees((prev) => prev.filter((f) => f.id !== fee.id));
        } else {
            setFees((prev) => prev.map((f) => (f.id === fee.id ? { ...f, isActive: true } : f)));
        }
    };

    // Preview: hard delete mutates local state only, no network. Returns a result
    // shape compatible with the existing caller (which branches on status).
    const hardDeleteFee = (id: string, _force: boolean) => {
        setFees((prev) => prev.filter((f) => f.id !== id));
        return { ok: true as const };
    };

    // Summary stats derived from fee list
    const totalFeeTypes = fees.length;
    const highestFee = fees.reduce(
        (max, f) => Math.max(max, resolveAmount(f)),
        0
    );
    const avgFee =
        totalFeeTypes > 0
            ? fees.reduce((sum, f) => sum + resolveAmount(f), 0) / totalFeeTypes
            : 0;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Add/Edit Fee Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className={`${glassCardStyle} p-6 w-full max-w-md`}>
                        <h3 className="text-black dark:text-white font-bold text-lg mb-4">
                            {editingFee ? t('admin.feeMgmtModalEdit') : t('admin.feeMgmtModalAdd')}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('admin.feeMgmtLblName')}
                                </label>
                                <input
                                    value={form.name}
                                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                    placeholder={t('admin.feeMgmtPhName')}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4] placeholder:text-gray-500 dark:placeholder:text-gray-400"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('admin.feeMgmtLblAmount', { currency })}
                                </label>
                                <input
                                    value={form.amount}
                                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                                    placeholder={t('admin.feeMgmtPhAmount')}
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4] placeholder:text-gray-500 dark:placeholder:text-gray-400"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('admin.feeMgmtLblCategory')}
                                </label>
                                <GlassDropdown
                                    value={form.category}
                                    onChange={(v) => setForm((p) => ({ ...p, category: v as FeeCategory }))}
                                    options={FEE_CATEGORIES.map((c) => ({
                                        value: c,
                                        label: c.charAt(0).toUpperCase() + c.slice(1),
                                        icon: CATEGORY_ICONS[c],
                                    }))}
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('admin.feeMgmtLblDescription')} <span className="text-gray-500 dark:text-gray-500 normal-case">{t('admin.feeMgmtLblOptional')}</span>
                                </label>
                                <input
                                    value={form.description}
                                    onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                                    placeholder={t('admin.feeMgmtPhDescription')}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-black dark:text-white text-sm focus:outline-none focus:border-[#6A3FF4] placeholder:text-gray-500 dark:placeholder:text-gray-400"
                                />
                            </div>
                        </div>
                        {saveError && (
                            <div className="mt-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs whitespace-pre-line">
                                {saveError}
                            </div>
                        )}
                        <div className="flex gap-3 mt-5">
                            <button onClick={saveFee} disabled={isSaving} className="flex-1 bg-[#6A3FF4] text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                                {isSaving ? t('admin.feeMgmtSaving') : editingFee ? t('admin.feeMgmtSaveChanges') : t('admin.feeMgmtAddFee')}
                            </button>
                            <button onClick={() => setShowForm(false)} className="flex-1 bg-white/10 dark:bg-white/5 text-black dark:text-white font-bold py-2.5 rounded-xl text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors">
                                {t('admin.feeMgmtCancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Page header */}
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1">
                            {t('admin.feeMgmtTitle')}
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {t('admin.feeMgmtSubtitle')}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setIssueFor({})}
                            className="flex items-center gap-2 bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 text-black dark:text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors shrink-0"
                            title="Issue a one-off invoice to a specific student"
                        >
                            <i className="ph-bold ph-receipt" /> Issue Invoice
                        </button>
                        <button onClick={openAdd} className="flex items-center gap-2 bg-[#6A3FF4] text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity shrink-0">
                            <i className="ph-bold ph-plus" /> {t('admin.feeMgmtAddFeeBtn')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Summary stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                    {
                        label: t('admin.feeMgmtStatFeeTypes'),
                        value: isLoadingFees ? '—' : String(totalFeeTypes),
                        sub: t('admin.feeMgmtStatFeeTypesSub'),
                        icon: 'ph-tag',
                        glowColor: '106, 63, 244',
                        iconBg: 'bg-[#6A3FF4]/20',
                        iconColor: 'text-[#6A3FF4]',
                    },
                    {
                        label: t('admin.feeMgmtStatHighest'),
                        value: isLoadingFees ? '—' : formatMoney(highestFee),
                        sub: t('admin.feeMgmtStatHighestSub'),
                        icon: 'ph-arrow-fat-up',
                        glowColor: '239, 68, 68',
                        iconBg: 'bg-red-500/20',
                        iconColor: 'text-red-500',
                    },
                    {
                        label: t('admin.feeMgmtStatAvg'),
                        value: isLoadingFees ? '—' : formatMoney(Math.round(avgFee)),
                        sub: t('admin.feeMgmtStatAvgSub'),
                        icon: 'ph-chart-bar',
                        glowColor: '168, 85, 247',
                        iconBg: 'bg-purple-500/20',
                        iconColor: 'text-purple-400',
                    },
                    {
                        label: t('admin.feeMgmtStatCollected'),
                        value: isLoadingFinancials
                            ? '—'
                            : financials
                            ? formatMoney(financials.paid)
                            : 'N/A',
                        sub: t('admin.feeMgmtStatCollectedSub'),
                        icon: 'ph-currency-dollar',
                        glowColor: '34, 197, 94',
                        iconBg: 'bg-green-500/20',
                        iconColor: 'text-green-500',
                    },
                ].map((stat, i) =>
                    isLoadingFees && i < 3 ? (
                        <SkeletonStat key={stat.label} />
                    ) : (
                        <AnimateOnView key={stat.label} delay={i * 0.05} enabled={false}>
                            <ParticleCard
                                className={`${glassCardStyle} p-5 flex flex-col justify-between h-full`}
                                enableTilt={false}
                                enableMagnetism={false}
                                clickEffect
                                particleCount={10}
                                glowColor={stat.glowColor}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <div
                                        className={`w-10 h-10 rounded-xl ${stat.iconBg} flex items-center justify-center`}
                                    >
                                        <i
                                            className={`ph-fill ${stat.icon} text-xl ${stat.iconColor}`}
                                        />
                                    </div>
                                    <span className="text-black dark:text-gray-300 font-bold text-xs uppercase tracking-wider">
                                        {stat.label}
                                    </span>
                                </div>
                                <p className="text-black dark:text-white text-xl sm:text-2xl font-bold mt-1 truncate">
                                    {stat.value}
                                </p>
                                <span className="text-gray-600 dark:text-gray-400 text-xs font-medium mt-1">
                                    {stat.sub}
                                </span>
                            </ParticleCard>
                        </AnimateOnView>
                    )
                )}
            </div>

            {/* Search + filter bar */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center`}>
                    {/* Search input */}
                    <div className="relative flex-1 w-full sm:w-auto">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            placeholder={t('admin.feeMgmtSearchPh')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full bg-white/50 dark:bg-black/20 rounded-xl py-2.5 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] border border-white/20 dark:border-white/10"
                        />
                    </div>
                    {/* Category pills */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setSelectedCategory('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                selectedCategory === 'all'
                                    ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                    : 'bg-white/5 dark:bg-black/10 text-gray-600 dark:text-gray-300 border-white/20 dark:border-white/10 hover:bg-[#6A3FF4]/20 hover:text-[#7B5AFF]'
                            }`}
                        >
                            {t('admin.feeMgmtFilterAll')}
                        </button>
                        {categories.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${
                                    selectedCategory === cat
                                        ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                        : 'bg-white/5 dark:bg-black/10 text-gray-600 dark:text-gray-300 border-white/20 dark:border-white/10 hover:bg-[#6A3FF4]/20 hover:text-[#7B5AFF]'
                                }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                </div>
            </AnimateOnView>

            {/* Fee card grid */}
            {isLoadingFees ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <SkeletonCard key={i} />
                    ))}
                </div>
            ) : fetchError ? (
                <AnimateOnView enabled={false}>
                    <div className={`${glassCardStyle} p-10 text-center`}>
                        <i className="ph-fill ph-warning text-4xl text-red-400 mb-3 block" />
                        <p className="text-black dark:text-white font-semibold mb-1">{fetchError}</p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {t('admin.feeMgmtCheckService')}
                        </p>
                    </div>
                </AnimateOnView>
            ) : visible.length === 0 ? (
                <AnimateOnView enabled={false}>
                    <div className={`${glassCardStyle} p-12 text-center`}>
                        <i className="ph-fill ph-tag text-5xl text-gray-400 mb-4 block" />
                        {fees.length === 0 ? (
                            <>
                                <p className="text-black dark:text-white font-semibold text-lg mb-2">
                                    {t('admin.feeMgmtNoneConfigured')}
                                </p>
                                <p className="text-gray-600 dark:text-gray-400 text-sm">
                                    {t('admin.feeMgmtNoneConfiguredBody')}
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-black dark:text-white font-semibold text-lg mb-2">
                                    {t('admin.feeMgmtNoResults')}
                                </p>
                                <p className="text-gray-600 dark:text-gray-400 text-sm">
                                    {t('admin.feeMgmtNoResultsBody')}
                                </p>
                                <button
                                    onClick={() => {
                                        setSearch('');
                                        setSelectedCategory('all');
                                    }}
                                    className="mt-4 px-5 py-2 rounded-xl bg-[#6A3FF4] text-white text-sm font-semibold hover:bg-[#5A32D4] transition-colors"
                                >
                                    {t('admin.feeMgmtClearFilters')}
                                </button>
                            </>
                        )}
                    </div>
                </AnimateOnView>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {visible.map((fee, i) => {
                        const amount = resolveAmount(fee);
                        const badgeClass = categoryBadgeClass(fee.category);
                        const icon = categoryIcon(fee.category);
                        return (
                            <AnimateOnView key={fee.id} delay={Math.min(i * 0.04, 0.3)} enabled={false}>
                                <ParticleCard
                                    className={`${glassCardStyle} p-6 flex flex-col justify-between h-full`}
                                    enableTilt={false}
                                    enableMagnetism={false}
                                    clickEffect
                                    particleCount={8}
                                    glowColor="106, 63, 244"
                                >
                                    {/* Top row: icon + category badge */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center flex-shrink-0">
                                            <i className={`ph-fill ${icon} text-xl text-[#7B5AFF]`} />
                                        </div>
                                        <span
                                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide capitalize ${badgeClass}`}
                                        >
                                            {fee.category || t('admin.feeMgmtBadgeOther')}
                                        </span>
                                    </div>

                                    {/* Fee name */}
                                    <h3 className="text-black dark:text-white font-semibold text-base leading-snug mb-1">
                                        {fee.name}
                                    </h3>

                                    {/* Optional description */}
                                    {fee.description && (
                                        <p className="text-gray-600 dark:text-gray-400 text-xs mb-3 line-clamp-2">
                                            {fee.description}
                                        </p>
                                    )}

                                    {/* Amount — the star of the card */}
                                    <div className="mt-auto pt-4 border-t border-white/10 flex items-end justify-between">
                                        <div>
                                            <p className="text-gray-600 dark:text-gray-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                                                {fee.variable ? t('admin.feeMgmtStartingFrom') : t('admin.feeMgmtFixedCharge')}
                                            </p>
                                            <motion.p
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}
                                                className="text-[#6A3FF4] text-2xl font-bold"
                                            >
                                                {amount > 0 ? formatMoney(amount) : t('admin.feeMgmtVariable')}
                                            </motion.p>
                                        </div>
                                        {deletingId === fee.id ? (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => {
                                                        // Preview: local-only delete, no network.
                                                        hardDeleteFee(fee.id, false);
                                                        setDeletingId(null);
                                                    }}
                                                    className="px-3 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-colors"
                                                >
                                                    {t('admin.feeMgmtConfirm')}
                                                </button>
                                                <button
                                                    onClick={() => setDeletingId(null)}
                                                    className="px-3 py-1 rounded-lg bg-white/10 text-gray-400 text-xs font-bold hover:bg-white/20 transition-colors"
                                                >
                                                    {t('admin.feeMgmtCancel')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                {canWrite && fee.isActive && resolveAmount(fee) > 0 && (
                                                    <button
                                                        onClick={() => setIssueFor({
                                                            title:       fee.name,
                                                            amount:      resolveAmount(fee),
                                                            category:    feeCategoryToInvoice(fee.category),
                                                            description: fee.description || undefined,
                                                            serviceFeeId: fee.id,
                                                        })}
                                                        className="w-8 h-8 rounded-lg bg-[#6A3FF4]/15 hover:bg-[#6A3FF4]/25 text-[#7B5AFF] flex items-center justify-center transition-colors"
                                                        title="Issue this fee to a student"
                                                    >
                                                        <i className="ph-bold ph-receipt text-sm" />
                                                    </button>
                                                )}
                                                <button onClick={() => openEdit(fee)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] text-gray-400 flex items-center justify-center transition-colors" title={t('admin.feeMgmtTitleEdit')}>
                                                    <i className="ph-bold ph-pencil text-sm" />
                                                </button>
                                                {/* Disable / re-enable — soft, preserves data */}
                                                {canWrite && (
                                                    <button
                                                        onClick={() => toggleActiveFee(fee, !fee.isActive)}
                                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                                            fee.isActive
                                                                ? 'bg-white/10 text-gray-400 hover:bg-yellow-500/20 hover:text-yellow-400'
                                                                : 'bg-yellow-500/20 text-yellow-400 hover:bg-green-500/20 hover:text-green-400'
                                                        }`}
                                                        title={fee.isActive ? t('admin.feeMgmtTitleDisable') : t('admin.feeMgmtTitleReEnable')}
                                                    >
                                                        <i className={`ph-bold ${fee.isActive ? 'ph-pause-circle' : 'ph-play-circle'} text-sm`} />
                                                    </button>
                                                )}
                                                {/* Permanent delete — irreversible, refuses on dependents unless forced */}
                                                {canDelete && (
                                                    <button
                                                        onClick={() => setDeletingId(fee.id)}
                                                        className="w-8 h-8 rounded-lg bg-white/10 hover:bg-red-500/20 hover:text-red-400 text-gray-400 flex items-center justify-center transition-colors"
                                                        title={t('admin.feeMgmtTitleDelete')}
                                                    >
                                                        <i className="ph-bold ph-trash text-sm" />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </ParticleCard>
                            </AnimateOnView>
                        );
                    })}
                </div>
            )}

            {/* Issue Invoice modal — opened either by the top-level button (empty prefill)
                or by a per-card receipt button (prefill from that fee). */}
            <IssueInvoiceModal
                open={issueFor != null}
                onClose={() => setIssueFor(null)}
                onIssued={(payload) => {
                    // Single-mode passes the new invoice id; bulk-mode passes
                    // "<issued>|<skipped>" so we can show a useful summary.
                    if (typeof payload === 'string' && payload.includes('|')) {
                        const [issued, skipped] = payload.split('|').map(Number);
                        setIssueToast(
                            `Issued ${issued} invoice${issued === 1 ? '' : 's'}` +
                            (skipped > 0 ? ` (${skipped} skipped — already had this invoice).` : '.')
                        );
                    } else {
                        setIssueToast('Invoice issued. The student will see it in their Payments tab.');
                    }
                    setTimeout(() => setIssueToast(null), 5500);
                }}
                prefill={issueFor || undefined}
            />

            {/* Success toast */}
            {issueToast && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-6 right-6 z-[70] px-4 py-3 rounded-xl shadow-lg border bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 text-sm font-semibold max-w-sm"
                >
                    <i className="ph-bold ph-check-circle mr-2" />
                    {issueToast}
                </motion.div>
            )}
        </div>
    );
};

export default FeeManagement;
