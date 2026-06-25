import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { generatePayslipPDF } from '../../utils/pdfGenerator';
import { formatMoney } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface Deduction {
    id: string;
    type: 'tax' | 'insurance' | 'loan' | 'advance' | 'custom';
    amount: number;
    description?: string | null;
}

interface Payslip {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    userRole: string;
    gross: number;
    deductionsTotal: number;
    net: number;
    generatedAt: string;
    deductions: Deduction[];
}

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
    payslips: Payslip[];
}

const STATUS_PILL: Record<string, string> = {
    draft:     'bg-yellow-500/10 text-yellow-400',
    finalized: 'bg-blue-500/10 text-blue-400',
    paid:      'bg-green-500/10 text-green-400',
    cancelled: 'bg-red-500/10 text-red-400',
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A realistic payroll run with payslips.
function makePayslip(
    id: string, name: string, email: string, role: string, gross: number,
    deductions: Deduction[],
): Payslip {
    const deductionsTotal = deductions.reduce((acc, d) => acc + d.amount, 0);
    return {
        id, userId: `usr_${id}`, userName: name, userEmail: email, userRole: role,
        gross, deductionsTotal, net: gross - deductionsTotal,
        generatedAt: '2026-04-25T09:00:00.000Z', deductions,
    };
}

function buildMockRun(id: string): PayrollRun {
    const payslips: Payslip[] = [
        makePayslip('ps_1', 'Prof. Mahmoud Adel', 'mahmoud.adel@uniflow.edu', 'professor', 32000, [
            { id: 'd_1', type: 'tax', amount: 4800, description: 'Income tax' },
            { id: 'd_2', type: 'insurance', amount: 1600, description: 'Health insurance' },
        ]),
        makePayslip('ps_2', 'Dr. Heba Mostafa', 'heba.mostafa@uniflow.edu', 'professor', 30000, [
            { id: 'd_3', type: 'tax', amount: 4500, description: 'Income tax' },
            { id: 'd_4', type: 'insurance', amount: 1500, description: 'Health insurance' },
        ]),
        makePayslip('ps_3', 'Karim Fawzy', 'karim.fawzy@uniflow.edu', 'ta', 14000, [
            { id: 'd_5', type: 'tax', amount: 1400, description: 'Income tax' },
        ]),
        makePayslip('ps_4', 'Sara Lotfy', 'sara.lotfy@uniflow.edu', 'ta', 13500, [
            { id: 'd_6', type: 'tax', amount: 1350, description: 'Income tax' },
            { id: 'd_7', type: 'loan', amount: 2000, description: 'Staff loan repayment' },
        ]),
        makePayslip('ps_5', 'Mona Saleh', 'mona.saleh@uniflow.edu', 'sa', 16000, [
            { id: 'd_8', type: 'tax', amount: 1600, description: 'Income tax' },
            { id: 'd_9', type: 'insurance', amount: 800, description: 'Health insurance' },
        ]),
    ];
    const totalGross = payslips.reduce((acc, p) => acc + p.gross, 0);
    const totalDeductions = payslips.reduce((acc, p) => acc + p.deductionsTotal, 0);
    return {
        id,
        period: '2026-04',
        runDate: '2026-04-25T09:00:00.000Z',
        status: 'finalized',
        totalGross,
        totalNet: totalGross - totalDeductions,
        totalDeductions,
        currency: 'EGP',
        notes: 'April payroll — includes 2 new hires',
        runByName: 'Mariam El-Sayed',
        payslips,
    };
}

// Recompute roll-up totals after a local payslip change so the stat cards stay
// consistent with the per-row figures.
function recomputeRunTotals(run: PayrollRun): PayrollRun {
    const payslips = run.payslips.map((p) => {
        const deductionsTotal = p.deductions.reduce((acc, d) => acc + d.amount, 0);
        return { ...p, deductionsTotal, net: p.gross - deductionsTotal };
    });
    const totalGross = payslips.reduce((acc, p) => acc + p.gross, 0);
    const totalDeductions = payslips.reduce((acc, p) => acc + p.deductionsTotal, 0);
    return { ...run, payslips, totalGross, totalDeductions, totalNet: totalGross - totalDeductions };
}

const PayrollRunDetailPage: React.FC = () => {
    const t = useT();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    // Aliased under /admin/payroll/:id and /financial/payroll/:id.
    const location = useLocation();
    const rolePrefix = location.pathname.startsWith('/financial') ? '/financial' : '/admin';
    const [run, setRun] = useState<PayrollRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [err] = useState<string | null>(null);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [expandedSlipId, setExpandedSlipId] = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        // Preview: build a static run for this id, no backend.
        setRun(buildMockRun(id));
        setLoading(false);
    }, [id]);

    // Preview: status changes mutate local state only (optimistic), no network.
    const updateStatus = (next: PayrollRun['status']) => {
        if (!id) return;
        setStatusUpdating(true);
        setRun((prev) => (prev ? { ...prev, status: next } : prev));
        setStatusUpdating(false);
    };

    if (loading) return <div className={`${glassCardStyle} p-12 text-center text-gray-500 animate-pulse`}>{t('admin.payrollLoadingRun')}</div>;
    if (err)     return <div className={`${glassCardStyle} p-8 text-center text-red-400`}>{err}</div>;
    if (!run)    return null;

    const isLocked = run.status === 'paid' || run.status === 'cancelled';
    const statusLabel: Record<string, string> = {
        draft:     t('admin.payrollStatusDraft'),
        finalized: t('admin.payrollStatusFinalized'),
        paid:      t('admin.payrollStatusPaid'),
        cancelled: t('admin.payrollStatusCancelled'),
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <button
                            onClick={() => navigate(`${rolePrefix}/payroll`)}
                            className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                        >
                            <i className="ph-bold ph-arrow-left" /> {t('admin.payrollBackToRuns')}
                        </button>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">
                            {t('admin.payrollTitle')} — {run.period}
                        </h1>
                        <p className="text-gray-500 text-sm">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase mr-2 ${STATUS_PILL[run.status]}`}>{statusLabel[run.status] ?? run.status}</span>
                            {t('admin.payrollRunByPrefix')} {run.runByName ?? '—'} {t('admin.payrollRunByOn')} {new Date(run.runDate).toLocaleDateString()}
                        </p>
                    </div>
                    {!isLocked && (
                        <div className="flex gap-2">
                            {run.status === 'draft' && (
                                <button
                                    onClick={() => updateStatus('finalized')}
                                    disabled={statusUpdating}
                                    className="px-4 py-2 rounded-xl bg-blue-500 text-white font-bold text-sm hover:opacity-90 disabled:opacity-50"
                                >
                                    {t('admin.payrollFinalize')}
                                </button>
                            )}
                            {run.status === 'finalized' && (
                                <button
                                    onClick={() => updateStatus('paid')}
                                    disabled={statusUpdating}
                                    className="px-4 py-2 rounded-xl bg-green-500 text-white font-bold text-sm hover:opacity-90 disabled:opacity-50"
                                >
                                    {t('admin.payrollMarkPaid')}
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (window.confirm(t('admin.payrollConfirmCancelRun'))) updateStatus('cancelled');
                                }}
                                disabled={statusUpdating}
                                className="px-4 py-2 rounded-xl bg-white/5 border border-red-500/30 text-red-400 font-bold text-sm hover:bg-red-500/10 disabled:opacity-50"
                            >
                                {t('admin.payrollCancelRunBtn')}
                            </button>
                        </div>
                    )}
                </div>
            </AnimateOnView>

            {/* Totals */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="59, 130, 246" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatPayslips')}</p>
                    <p className="text-2xl font-bold text-blue-400">{run.payslips.length}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="34, 197, 94" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatTotalGrossShort')}</p>
                    <p className="text-xl font-bold text-green-500 truncate">{formatMoney(run.totalGross, { code: run.currency })}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="239, 68, 68" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatDeductionsShort')}</p>
                    <p className="text-xl font-bold text-red-400 truncate">−{formatMoney(run.totalDeductions, { code: run.currency })}</p>
                </ParticleCard>
                <ParticleCard className={`${glassCardStyle} p-5`} glowColor="106, 63, 244" enableTilt={false} enableMagnetism={false}>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-1">{t('admin.payrollStatTotalNetShort')}</p>
                    <p className="text-xl font-bold text-[#6A3FF4] truncate">{formatMoney(run.totalNet, { code: run.currency })}</p>
                </ParticleCard>
            </div>

            {/* Payslips list */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.payrollPayslipsHeading')}</h3>
                {run.payslips.length === 0 ? (
                    <p className="text-gray-500 text-sm py-8 text-center">{t('admin.payrollNoPayslips')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollSlipColStaff')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.payrollSlipColRole')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollSlipColGross')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollSlipColDeductions')}</th>
                                    <th className="text-right py-2 pr-4 font-bold">{t('admin.payrollSlipColNet')}</th>
                                    <th className="text-right py-2 font-bold">{t('admin.payrollSlipColActions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {run.payslips.map((p) => {
                                    const selected = expandedSlipId === p.id;
                                    return (
                                        <tr
                                            key={p.id}
                                            className={`transition-colors cursor-pointer ${
                                                selected ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5'
                                            }`}
                                            onClick={() => setExpandedSlipId(selected ? null : p.id)}
                                        >
                                            <td className="py-2 pr-4">
                                                <div className="text-black dark:text-white font-medium">{p.userName}</div>
                                                <div className="text-gray-500 text-xs">{p.userEmail}</div>
                                            </td>
                                            <td className="py-2 pr-4">
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white/5 text-gray-400">{p.userRole}</span>
                                            </td>
                                            <td className="py-2 pr-4 text-right text-gray-400">{formatMoney(p.gross, { code: run.currency })}</td>
                                            <td className="py-2 pr-4 text-right text-red-400">−{formatMoney(p.deductionsTotal, { code: run.currency })}</td>
                                            <td className="py-2 pr-4 text-right font-bold text-black dark:text-white">{formatMoney(p.net, { code: run.currency })}</td>
                                            <td className="py-2 text-right">
                                                <div className="flex gap-3 justify-end items-center">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); setExpandedSlipId(selected ? null : p.id); }}
                                                        className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                                    >
                                                        {selected ? t('admin.payrollSlipActionHide') : t('admin.payrollSlipActionEdit')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // Preview: build the payslip PDF directly from the
                                                            // mock payslip data — no fetch.
                                                            generatePayslipPDF({
                                                                period: run.period,
                                                                status: run.status,
                                                                currency: run.currency,
                                                                generatedAt: p.generatedAt,
                                                                employee: {
                                                                    name: p.userName,
                                                                    email: p.userEmail,
                                                                    position: p.userRole,
                                                                },
                                                                gross: p.gross,
                                                                deductions: p.deductions.map((d) => ({
                                                                    type: d.type,
                                                                    amount: d.amount,
                                                                    description: d.description,
                                                                })),
                                                                deductionsTotal: p.deductionsTotal,
                                                                net: p.net,
                                                                notes: run.notes,
                                                            });
                                                        }}
                                                        className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                                    >
                                                        {t('admin.payrollSlipActionPdf')}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Phase 10 — selected payslip's deduction editor lives outside the
                table so the GlassDropdown menu can paint without being clipped
                by the table wrapper's overflow-x-auto. Rendered only when a
                row is expanded. */}
            {(() => {
                const selected = run.payslips.find((p) => p.id === expandedSlipId);
                if (!selected) return null;
                return (
                    <div className={`${glassCardStyle} p-6`}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-black dark:text-white">
                                    {t('admin.payrollEditingTitle', { name: selected.userName })}
                                </h3>
                                <p className="text-gray-500 text-xs">
                                    {selected.userEmail} · {t('admin.payrollEditingGrossNet', { gross: formatMoney(selected.gross, { code: run.currency }), net: formatMoney(selected.net, { code: run.currency }) })}
                                </p>
                            </div>
                            <button
                                onClick={() => setExpandedSlipId(null)}
                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-gray-400 flex items-center justify-center transition-colors"
                                title={t('admin.payrollCloseTitle')}
                            >
                                <i className="ph-bold ph-x text-base" />
                            </button>
                        </div>
                        <DeductionsPanel
                            payslip={selected}
                            currency={run.currency}
                            locked={isLocked}
                            onAddDeduction={(d) => {
                                setRun((prev) => {
                                    if (!prev) return prev;
                                    const payslips = prev.payslips.map((p) =>
                                        p.id === selected.id ? { ...p, deductions: [...p.deductions, d] } : p,
                                    );
                                    return recomputeRunTotals({ ...prev, payslips });
                                });
                            }}
                            onRemoveDeduction={(deductionId) => {
                                setRun((prev) => {
                                    if (!prev) return prev;
                                    const payslips = prev.payslips.map((p) =>
                                        p.id === selected.id
                                            ? { ...p, deductions: p.deductions.filter((d) => d.id !== deductionId) }
                                            : p,
                                    );
                                    return recomputeRunTotals({ ...prev, payslips });
                                });
                            }}
                        />
                    </div>
                );
            })()}
        </div>
    );
};

const DeductionsPanel: React.FC<{
    payslip: Payslip;
    currency: string;
    locked: boolean;
    onAddDeduction: (d: Deduction) => void;
    onRemoveDeduction: (id: string) => void;
}> = ({ payslip, currency, locked, onAddDeduction, onRemoveDeduction }) => {
    const t = useT();
    const [type, setType] = useState<Deduction['type']>('tax');
    const [amount, setAmount] = useState('');
    const [desc, setDesc] = useState('');
    const [busy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    // Preview: add mutates parent state only (optimistic), no network.
    const addDeduction = () => {
        const n = parseFloat(amount);
        if (Number.isNaN(n) || n <= 0) { setErr(t('admin.payrollDeductionAmountMustBePositive')); return; }
        setErr(null);
        onAddDeduction({
            id: `d_${Date.now()}`,
            type,
            amount: n,
            description: desc.trim() || null,
        });
        setAmount('');
        setDesc('');
    };

    // Preview: remove mutates parent state only, no network.
    const removeDeduction = (id: string) => {
        onRemoveDeduction(id);
    };

    const typeLabel: Record<Deduction['type'], string> = {
        tax:       t('admin.payrollDeductionTypeTax'),
        insurance: t('admin.payrollDeductionTypeInsurance'),
        loan:      t('admin.payrollDeductionTypeLoan'),
        advance:   t('admin.payrollDeductionTypeAdvance'),
        custom:    t('admin.payrollDeductionTypeCustom'),
    };
    return (
        <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">{t('admin.payrollDeductionsLabel')}</p>
            {payslip.deductions.length === 0 ? (
                <p className="text-gray-500 text-xs mb-3">{t('admin.payrollDeductionsNone')}</p>
            ) : (
                <ul className="space-y-1 mb-3">
                    {payslip.deductions.map((d) => (
                        <li key={d.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-xs">
                            <div>
                                <span className="px-2 py-0.5 rounded-full bg-white/5 text-gray-400 uppercase font-bold mr-2">{typeLabel[d.type] ?? d.type}</span>
                                <span className="text-gray-400">{d.description || ''}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-red-400 font-bold">−{formatMoney(d.amount, { code: currency })}</span>
                                {!locked && (
                                    <button
                                        onClick={() => removeDeduction(d.id)}
                                        disabled={busy}
                                        className="text-gray-500 hover:text-red-400"
                                        title={t('admin.payrollDeductionRemoveTitle')}
                                    >
                                        <i className="ph-bold ph-x" />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {!locked && (
                <div className="space-y-3">
                    {/* Row 1 — type + amount side-by-side. Each takes half on
                        desktop, stacked on phone. Description gets its own
                        full-width row so the GlassDropdown menu has room to
                        paint without clashing with the next field. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('admin.payrollDeductionType')}</label>
                            <GlassDropdown
                                value={type}
                                onChange={(v) => setType(v as Deduction['type'])}
                                options={[
                                    { value: 'tax',       label: t('admin.payrollDeductionTypeTax') },
                                    { value: 'insurance', label: t('admin.payrollDeductionTypeInsurance') },
                                    { value: 'loan',      label: t('admin.payrollDeductionTypeLoan') },
                                    { value: 'advance',   label: t('admin.payrollDeductionTypeAdvance') },
                                    { value: 'custom',    label: t('admin.payrollDeductionTypeCustom') },
                                ]}
                                direction="auto"
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{t('admin.payrollDeductionAmount')}</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={t('admin.payrollDeductionPhAmount')}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                            />
                        </div>
                    </div>
                    {/* Row 2 — description full width */}
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                            {t('admin.payrollDeductionDescription')} <span className="text-gray-500 dark:text-gray-500 normal-case">{t('admin.payrollDeductionOptional')}</span>
                        </label>
                        <input
                            type="text"
                            placeholder={t('admin.payrollDeductionPhDescription')}
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                        />
                    </div>
                    {/* Row 3 — action right-aligned */}
                    <div className="flex justify-end">
                        <button
                            onClick={addDeduction}
                            disabled={busy}
                            className="px-5 py-2 rounded-xl bg-[#6A3FF4] text-white font-bold text-xs hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            <i className="ph-bold ph-plus mr-1" /> {t('admin.payrollAddDeduction')}
                        </button>
                    </div>
                </div>
            )}
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
        </div>
    );
};

export default PayrollRunDetailPage;
