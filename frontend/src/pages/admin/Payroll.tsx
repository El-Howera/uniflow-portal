import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { formatMoney, useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface PayrollRun {
    id: string;
    period: string;
    runDate: string;
    status: 'draft' | 'finalized' | 'paid' | 'cancelled';
    totalGross: number;
    totalNet: number;
    totalDeductions: number;
    currency: string;
    notes?: string | null;
    runByName?: string | null;
    payslipCount: number;
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Realistic payroll runs in EGP.
const MOCK_RUNS: PayrollRun[] = [
    { id: 'run_2026_03', period: '2026-03', runDate: '2026-03-28T09:00:00.000Z', status: 'paid', totalGross: 1_240_000, totalNet: 1_046_400, totalDeductions: 193_600, currency: 'EGP', notes: 'March payroll — all staff', runByName: 'Mariam El-Sayed', payslipCount: 86 },
    { id: 'run_2026_02', period: '2026-02', runDate: '2026-02-27T09:00:00.000Z', status: 'paid', totalGross: 1_232_000, totalNet: 1_039_840, totalDeductions: 192_160, currency: 'EGP', notes: null, runByName: 'Mariam El-Sayed', payslipCount: 85 },
    { id: 'run_2026_04', period: '2026-04', runDate: '2026-04-25T09:00:00.000Z', status: 'finalized', totalGross: 1_252_000, totalNet: 1_056_900, totalDeductions: 195_100, currency: 'EGP', notes: 'Includes 2 new hires', runByName: 'Mariam El-Sayed', payslipCount: 88 },
    { id: 'run_2026_01', period: '2026-01', runDate: '2026-01-29T09:00:00.000Z', status: 'paid', totalGross: 1_218_000, totalNet: 1_028_300, totalDeductions: 189_700, currency: 'EGP', notes: null, runByName: 'Omar Hassan', payslipCount: 84 },
];

const STATUS_PILL: Record<string, string> = {
    draft:     'bg-yellow-500/10 text-yellow-400',
    finalized: 'bg-blue-500/10 text-blue-400',
    paid:      'bg-green-500/10 text-green-400',
    cancelled: 'bg-red-500/10 text-red-400',
};

// Compute "YYYY-MM" defaults for the New-Run picker.
const periodOptions = (() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        out.push({ value, label });
    }
    return out;
})();

const PayrollPage: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const currency = useCurrency();
    // Aliased under /admin/payroll and /financial/payroll — keep internal
    // navigation inside whichever prefix the user entered through.
    const location = useLocation();
    const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [error] = useState<string | null>(null);

    // New-run modal state
    const [showNew, setShowNew] = useState(false);
    const [newPeriod, setNewPeriod] = useState(periodOptions[0]?.value ?? '');
    const [newNotes, setNewNotes] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    useEffect(() => {
        // Preview: load static payroll runs, no backend.
        setRuns(MOCK_RUNS);
        setLoading(false);
    }, []);

    // Preview: creating a run mutates local state only (optimistic), no network.
    const handleCreate = () => {
        if (!newPeriod) return;
        setCreating(true);
        setCreateError(null);
        // Guard against duplicate periods so the preview behaves believably.
        if (runs.some((r) => r.period === newPeriod)) {
            setCreateError(t('admin.payrollCouldNotCreateRun'));
            setCreating(false);
            return;
        }
        const newRun: PayrollRun = {
            id: `run_${newPeriod.replace('-', '_')}`,
            period: newPeriod,
            runDate: new Date().toISOString(),
            status: 'draft',
            totalGross: 0,
            totalNet: 0,
            totalDeductions: 0,
            currency: 'EGP',
            notes: newNotes.trim() || null,
            runByName: 'Admin User',
            payslipCount: 0,
        };
        setRuns((prev) => [newRun, ...prev]);
        setShowNew(false);
        setNewNotes('');
        setCreating(false);
        // Jump straight to the run detail so the admin can review payslips.
        navigate(`${rolePrefix}/payroll/${newRun.id}`);
    };

    // Roll up totals across all runs for a stat row.
    const totalsAcrossRuns = runs.reduce(
        (acc, r) => ({
            gross: acc.gross + r.totalGross,
            net:   acc.net   + r.totalNet,
            ded:   acc.ded   + r.totalDeductions,
        }),
        { gross: 0, net: 0, ded: 0 }
    );

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.payrollTitle')}</h1>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {t('admin.payrollSubtitle')}
                        </p>
                    </div>
                    <button
                        onClick={() => { setShowNew(true); setCreateError(null); }}
                        className="inline-flex items-center gap-2 bg-[#6A3FF4] text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity"
                    >
                        <i className="ph-bold ph-plus" /> {t('admin.payrollNewRunBtn')}
                    </button>
                </div>
            </AnimateOnView>

            {/* Aggregate stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="106, 63, 244" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatRuns')}</p>
                    <p className="text-2xl font-bold text-[#6A3FF4]">{runs.length}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="34, 197, 94" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatTotalGross')}</p>
                    <p className="text-2xl font-bold text-green-500 truncate">{formatMoney(totalsAcrossRuns.gross)}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="239, 68, 68" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatTotalDeductions')}</p>
                    <p className="text-2xl font-bold text-red-400 truncate">{formatMoney(totalsAcrossRuns.ded)}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="59, 130, 246" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatTotalNet')}</p>
                    <p className="text-2xl font-bold text-blue-400 truncate">{formatMoney(totalsAcrossRuns.net)}</p>
                </ParticleCard>
            </div>

            {/* Runs table */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.payrollRunsHeading')}</h3>
                {loading ? (
                    <div className="animate-pulse h-24 bg-white/5 rounded-xl" />
                ) : error ? (
                    <div className="text-red-400 text-sm">{error}</div>
                ) : runs.length === 0 ? (
                    <p className="text-gray-500 text-sm py-8 text-center">
                        {t('admin.payrollNoRuns', { action: t('admin.payrollNewRunBtn') })}
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollColPeriod')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollColStatus')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollColRunDate')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollColBy')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollColPayslips')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollColGross')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollColDeductions')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollColNet')}</th>
                                    <th className="text-right py-2 font-bold">{t('admin.payrollColActions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {runs.map((r) => {
                                    const statusLabel: Record<string, string> = {
                                        draft:     t('admin.payrollStatusDraft'),
                                        finalized: t('admin.payrollStatusFinalized'),
                                        paid:      t('admin.payrollStatusPaid'),
                                        cancelled: t('admin.payrollStatusCancelled'),
                                    };
                                    return (
                                    <motion.tr
                                        key={r.id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="hover:bg-white/5 transition-colors"
                                    >
                                        <td className="py-2 pr-4 text-black dark:text-white font-bold">{r.period}</td>
                                        <td className="py-2 pr-4">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_PILL[r.status]}`}>
                                                {statusLabel[r.status] ?? r.status}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">{new Date(r.runDate).toLocaleDateString()}</td>
                                        <td className="py-2 pr-4 text-gray-400">{r.runByName ?? '—'}</td>
                                        <td className="py-2 pr-4 text-right text-gray-400">{r.payslipCount}</td>
                                        <td className="py-2 pr-4 text-right text-gray-400">{formatMoney(r.totalGross, { code: r.currency })}</td>
                                        <td className="py-2 pr-4 text-right text-red-400">−{formatMoney(r.totalDeductions, { code: r.currency })}</td>
                                        <td className="py-2 pr-4 text-right font-bold text-black dark:text-white">{formatMoney(r.totalNet, { code: r.currency })}</td>
                                        <td className="py-2 text-right">
                                            <button
                                                onClick={() => navigate(`${rolePrefix}/payroll/${r.id}`)}
                                                className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                            >
                                                {t('admin.payrollViewArrow')}
                                            </button>
                                        </td>
                                    </motion.tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* New Run modal */}
            {showNew && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !creating && setShowNew(false)}>
                    <div className={`${glassCardStyle} p-6 w-full max-w-md`} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-black dark:text-white font-bold text-lg">{t('admin.payrollNewRunModalTitle')}</h3>
                                <p className="text-gray-500 text-xs">{t('admin.payrollNewRunModalDesc', { currency })}</p>
                            </div>
                            <button
                                onClick={() => setShowNew(false)}
                                disabled={creating}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-gray-400 flex items-center justify-center transition-colors"
                            >
                                <i className="ph-bold ph-x" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{t('admin.payrollLblPeriod')}</label>
                                <GlassDropdown
                                    value={newPeriod}
                                    onChange={setNewPeriod}
                                    options={periodOptions}
                                    direction="auto"
                                    className="w-full"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{t('admin.payrollLblNotesOptional')}</label>
                                <textarea
                                    value={newNotes}
                                    onChange={(e) => setNewNotes(e.target.value)}
                                    rows={3}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                                    placeholder={t('admin.payrollPhNotes')}
                                />
                            </div>
                        </div>
                        {createError && (
                            <div className="mt-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs whitespace-pre-line">
                                {createError}
                            </div>
                        )}
                        <div className="flex gap-3 mt-5">
                            <button onClick={handleCreate} disabled={creating} className="flex-1 bg-[#6A3FF4] text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                                {creating ? t('admin.payrollCreating') : t('admin.payrollCreateRun')}
                            </button>
                            <button onClick={() => setShowNew(false)} disabled={creating} className="flex-1 bg-white/10 dark:bg-white/5 text-black dark:text-white font-bold py-2.5 rounded-xl text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors disabled:opacity-50">
                                {t('admin.payrollCancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PayrollPage;
