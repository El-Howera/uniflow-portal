// frontend/src/components/IssueInvoiceModal.tsx
//
// Reusable "Issue Invoice" modal for admin / SA / financial staff.
//
// Usage:
//   <IssueInvoiceModal
//     open={open}
//     onClose={() => setOpen(false)}
//     onIssued={() => refresh()}
//     prefill={{ title, amount, category, serviceFeeId }}  // optional
//   />
//
// Two entry points:
//   1. From Fee Management — pass `prefill` so the title/amount/category come
//      from a ServiceFee row. Admin only needs to pick a student + due date.
//   2. Standalone — no prefill, admin fills everything from scratch.
//
// Student picker hits GET /api/admin/users?role=student with a debounced
// query. Picker reuses the existing admin user-list endpoint so any name
// change / new student appears automatically.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassDropdown } from './GlassDropdown';
import { GlassCheckbox } from './GlassCheckbox';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { useAcademicSettings } from '../utils/academicSettings';

type TargetMode = 'single' | 'all-students' | 'specific-levels' | 'specific-students';

const TARGET_MODE_OPTIONS: { value: TargetMode; label: string }[] = [
    { value: 'single',             label: 'One specific student' },
    { value: 'all-students',       label: 'All students' },
    { value: 'specific-levels',    label: 'Specific levels' },
    { value: 'specific-students',  label: 'Specific students (multi-pick)' },
];

type InvoiceCategory = 'tuition' | 'fees' | 'deposit' | 'service' | 'other';

const CATEGORY_OPTIONS: { value: InvoiceCategory; label: string }[] = [
    { value: 'tuition', label: 'Tuition' },
    { value: 'fees',    label: 'Fees' },
    { value: 'deposit', label: 'Deposit' },
    { value: 'service', label: 'Service' },
    { value: 'other',   label: 'Other' },
];

interface StudentOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    odId?: string | null;
}

interface IssueInvoiceModalProps {
    open: boolean;
    onClose: () => void;
    onIssued?: (invoiceId: string) => void;
    /** Pre-fill from a ServiceFee row in Fee Management. */
    prefill?: {
        title?: string;
        amount?: string | number;
        category?: InvoiceCategory;
        description?: string;
        serviceFeeId?: string;
    };
}

const glassCard = 'bg-white/95 dark:bg-[#0d0d0d]/95 border border-white/20 dark:border-white/10 backdrop-filter backdrop-blur-2xl';
const inputCls  = 'w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] placeholder:text-gray-500';
const labelCls  = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5';

export const IssueInvoiceModal: React.FC<IssueInvoiceModalProps> = ({ open, onClose, onIssued, prefill }) => {
    const { numberOfAcademicLevels } = useAcademicSettings();
    // Form state
    const [targetMode, setTargetMode] = useState<TargetMode>('single');
    const [studentQuery, setStudentQuery] = useState('');
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [picking, setPicking] = useState(false);
    const [selected, setSelected] = useState<StudentOption | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectedLevels, setSelectedLevels] = useState<Set<number>>(new Set());
    const [title, setTitle] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState<InvoiceCategory>('other');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState(() => {
        // Default: 14 days from today.
        const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        return d.toISOString().slice(0, 10);
    });
    const [semester, setSemester] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-apply prefill every time the modal opens. Reset on close.
    useEffect(() => {
        if (open) {
            setTitle(prefill?.title || '');
            setAmount(prefill?.amount != null ? String(prefill.amount) : '');
            setCategory(prefill?.category || 'other');
            setDescription(prefill?.description || '');
            setSelected(null);
            setSelectedIds(new Set());
            setSelectedLevels(new Set());
            setStudentQuery('');
            setStudents([]);
            setError(null);
            setTargetMode('single');
            const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            setDueDate(d.toISOString().slice(0, 10));
            setSemester('');
        }
    }, [open, prefill]);

    // Debounced student search (used by single + specific-students modes).
    const needsPicker = targetMode === 'single' || targetMode === 'specific-students';
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!open || !needsPicker) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            setPicking(true);
            try {
                const params = new URLSearchParams({ role: 'student' });
                if (studentQuery.trim()) params.set('search', studentQuery.trim());
                const res = await fetch(
                    `${API_URLS.userProfile()}/api/admin/users?${params.toString()}`,
                    { credentials: 'include', headers: authHeaders() }
                );
                if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
                const data = await res.json();
                const arr: StudentOption[] = Array.isArray(data) ? data : (data?.users || data?.data || []);
                setStudents(arr.slice(0, 30));
            } catch (err) {
                console.warn('student lookup failed:', err);
                setStudents([]);
            } finally {
                setPicking(false);
            }
        }, 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [studentQuery, open, needsPicker]);

    const canSubmit = useMemo(() => {
        if (!title.trim()) return false;
        const n = parseFloat(amount);
        if (!Number.isFinite(n) || n <= 0) return false;
        if (!dueDate) return false;
        if (targetMode === 'single' && !selected) return false;
        if (targetMode === 'specific-students' && selectedIds.size === 0) return false;
        if (targetMode === 'specific-levels' && selectedLevels.size === 0) return false;
        return true;
    }, [selected, title, amount, dueDate, targetMode, selectedIds, selectedLevels]);

    const handleSubmit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            // Single-student → POST /invoices. Everything else → POST /invoices/bulk.
            if (targetMode === 'single') {
                if (!selected) return;
                const body = {
                    userId:      selected.id,
                    title:       title.trim(),
                    description: description.trim() || undefined,
                    amount:      parseFloat(amount),
                    category,
                    dueDate,
                    semester:    semester.trim() || undefined,
                    serviceFeeId: prefill?.serviceFeeId,
                };
                const res = await fetch(`${API_URLS.payments()}/api/admin/invoices`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
                onIssued?.(data?.data?.id || '');
            } else {
                const body: Record<string, unknown> = {
                    targetMode,
                    title:       title.trim(),
                    description: description.trim() || undefined,
                    amount:      parseFloat(amount),
                    category,
                    dueDate,
                    semester:    semester.trim() || undefined,
                    serviceFeeId: prefill?.serviceFeeId,
                };
                if (targetMode === 'specific-students') body.userIds = Array.from(selectedIds);
                if (targetMode === 'specific-levels')   body.levels  = Array.from(selectedLevels);

                const res = await fetch(`${API_URLS.payments()}/api/admin/invoices/bulk`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || data?.detail || `Request failed (${res.status})`);
                // For bulk we surface a different "what happened" string up-stack via onIssued.
                const skipped = Number(data?.skipped) || 0;
                const issued  = Number(data?.issued)  || 0;
                onIssued?.(`${issued}|${skipped}`);
            }
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to issue invoice');
        } finally {
            setBusy(false);
        }
    };

    const toggleSelectedId = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleLevel = (lvl: number) => {
        setSelectedLevels((prev) => {
            const next = new Set(prev);
            if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
            return next;
        });
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.96 }}
                        className={`${glassCard} rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-5">
                            <div>
                                <h2 className="text-black dark:text-white text-xl font-bold">Issue invoice</h2>
                                <p className="text-gray-600 dark:text-gray-400 text-xs mt-0.5">
                                    Bill a student for a fee or one-off charge. They'll see it in their Payments tab and can pay via Stripe.
                                </p>
                            </div>
                            <button onClick={onClose} className="text-gray-500 hover:text-black dark:hover:text-white">
                                <i className="ph-bold ph-x text-lg" />
                            </button>
                        </div>

                        {/* Audience selector — single student / all / specific levels / multi-pick. */}
                        <div className="mb-4">
                            <label className={labelCls}>Bill to *</label>
                            <GlassDropdown
                                value={targetMode}
                                onChange={(v) => setTargetMode(v as TargetMode)}
                                options={TARGET_MODE_OPTIONS}
                                direction="down"
                                className="w-full"
                            />
                        </div>

                        {/* Audience-specific subfield. Conditional rendering per mode. */}
                        {targetMode === 'single' && (
                            <div className="mb-4">
                                <label className={labelCls}>Student *</label>
                                {selected ? (
                                    <div className="flex items-center justify-between bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 rounded-xl px-4 py-2.5">
                                        <div className="text-sm">
                                            <div className="font-semibold text-black dark:text-white">
                                                {selected.firstName} {selected.lastName}
                                            </div>
                                            <div className="text-gray-500 text-xs">
                                                {selected.email}{selected.odId ? ` · ${selected.odId}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => { setSelected(null); setStudentQuery(''); }}
                                            className="text-xs text-[#7B5AFF] hover:text-[#5A2AD4] font-semibold"
                                        >
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="relative">
                                            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                            <input
                                                value={studentQuery}
                                                onChange={(e) => setStudentQuery(e.target.value)}
                                                placeholder="Search by name, email, or ID…"
                                                className={`${inputCls} pl-10`}
                                                autoFocus
                                            />
                                        </div>
                                        {students.length > 0 && (
                                            <div className="mt-2 max-h-44 overflow-y-auto border border-white/10 rounded-xl divide-y divide-white/5">
                                                {students.map((s) => (
                                                    <button
                                                        key={s.id}
                                                        onClick={() => setSelected(s)}
                                                        className="w-full text-left px-3 py-2 hover:bg-[#6A3FF4]/10 transition-colors"
                                                    >
                                                        <div className="text-sm font-semibold text-black dark:text-white">
                                                            {s.firstName} {s.lastName}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {s.email}{s.odId ? ` · ${s.odId}` : ''}
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        {picking && (<p className="text-xs text-gray-500 mt-1.5">Searching…</p>)}
                                        {!picking && studentQuery && students.length === 0 && (
                                            <p className="text-xs text-gray-500 mt-1.5">No matching students.</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {targetMode === 'all-students' && (
                            <div className="mb-4 p-3 rounded-xl bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 text-sm text-black dark:text-white">
                                <i className="ph-bold ph-users-three text-[#7B5AFF] mr-2" />
                                Every active student in the system will receive this invoice. Students who already have an unpaid invoice with the same title are skipped automatically.
                            </div>
                        )}

                        {targetMode === 'specific-levels' && (
                            <div className="mb-4">
                                <label className={labelCls}>Pick one or more levels *</label>
                                <div className="flex flex-wrap gap-2">
                                    {Array.from({ length: numberOfAcademicLevels }, (_, i) => i + 1).map((lvl) => {
                                        const on = selectedLevels.has(lvl);
                                        return (
                                            <button
                                                key={lvl}
                                                onClick={() => toggleLevel(lvl)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                                    on
                                                        ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                                        : 'bg-white/5 dark:bg-black/20 text-gray-600 dark:text-gray-300 border-white/20 dark:border-white/10 hover:bg-[#6A3FF4]/15'
                                                }`}
                                            >
                                                Level {lvl}
                                            </button>
                                        );
                                    })}
                                </div>
                                {selectedLevels.size > 0 && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        {selectedLevels.size} level{selectedLevels.size > 1 ? 's' : ''} selected — all students at these levels will receive the invoice.
                                    </p>
                                )}
                            </div>
                        )}

                        {targetMode === 'specific-students' && (
                            <div className="mb-4">
                                <label className={labelCls}>Pick students *</label>
                                <div className="relative">
                                    <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input
                                        value={studentQuery}
                                        onChange={(e) => setStudentQuery(e.target.value)}
                                        placeholder="Search to add students…"
                                        className={`${inputCls} pl-10`}
                                    />
                                </div>
                                {students.length > 0 && (
                                    <div className="mt-2 max-h-44 overflow-y-auto border border-white/10 rounded-xl divide-y divide-white/5">
                                        {students.map((s) => {
                                            const on = selectedIds.has(s.id);
                                            return (
                                                <div
                                                    key={s.id}
                                                    onClick={() => toggleSelectedId(s.id)}
                                                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${on ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5'}`}
                                                >
                                                    <GlassCheckbox checked={on} onChange={() => toggleSelectedId(s.id)} size="sm" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-black dark:text-white truncate">
                                                            {s.firstName} {s.lastName}
                                                        </div>
                                                        <div className="text-xs text-gray-500 truncate">
                                                            {s.email}{s.odId ? ` · ${s.odId}` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {selectedIds.size > 0 && (
                                    <p className="text-xs text-gray-500 mt-2">
                                        {selectedIds.size} student{selectedIds.size > 1 ? 's' : ''} selected.
                                        <button onClick={() => setSelectedIds(new Set())} className="ml-2 text-[#7B5AFF] hover:text-[#5A2AD4] font-semibold">
                                            Clear
                                        </button>
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Title */}
                        <div className="mb-4">
                            <label className={labelCls}>Title *</label>
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Spring 2026 Tuition · Transcript copy · Late fee"
                                className={inputCls}
                            />
                        </div>

                        {/* Amount + Category */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className={labelCls}>Amount *</label>
                                <input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className={inputCls}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>Category *</label>
                                <GlassDropdown
                                    value={category}
                                    onChange={(v) => setCategory(v as InvoiceCategory)}
                                    options={CATEGORY_OPTIONS}
                                    direction="up"
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {/* Due date + Semester */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className={labelCls}>Due date *</label>
                                <input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className={`${inputCls} [color-scheme:dark]`}
                                />
                            </div>
                            <div>
                                <label className={labelCls}>Semester <span className="text-gray-500 normal-case">(optional)</span></label>
                                <input
                                    value={semester}
                                    onChange={(e) => setSemester(e.target.value)}
                                    placeholder="e.g. Spring 2026"
                                    className={inputCls}
                                />
                            </div>
                        </div>

                        {/* Description */}
                        <div className="mb-4">
                            <label className={labelCls}>Description <span className="text-gray-500 normal-case">(optional)</span></label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="Any notes the student should see on the invoice."
                                className={inputCls}
                            />
                        </div>

                        {error && (
                            <div className="mb-4 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs">
                                {error}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <button
                                onClick={handleSubmit}
                                disabled={!canSubmit || busy}
                                className="flex-1 bg-[#6A3FF4] text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {busy
                                    ? 'Issuing…'
                                    : targetMode === 'single'
                                        ? 'Issue invoice'
                                        : targetMode === 'all-students'
                                            ? 'Issue to all students'
                                            : targetMode === 'specific-levels'
                                                ? `Issue to selected level${selectedLevels.size > 1 ? 's' : ''}`
                                                : `Issue to ${selectedIds.size} student${selectedIds.size !== 1 ? 's' : ''}`}
                            </button>
                            <button
                                onClick={onClose}
                                disabled={busy}
                                className="flex-1 bg-white/10 dark:bg-white/5 text-black dark:text-white font-bold py-2.5 rounded-xl text-sm hover:bg-white/20 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default IssueInvoiceModal;
