// src/pages/admin/SignInLocks.tsx
//
// Admin Sign-In Locks management UI.
//
// MVP BUILD — pure front-end mockup. No backend calls. Locks, departments,
// and the user picker run on static mock data; create / release / delete are
// local-only state mutations.
//
// Allows admin/it to block specific users / levels / departments /
// roles / programs from signing in. Three lock types:
//   - permanent      → blocks indefinitely until released
//   - expires-at     → blocks until a wall-clock timestamp
//   - time-window    → blocks OUTSIDE the [openFrom, openTo] window
import { FC, useEffect, useMemo, useState } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

// ── Style tokens (mirrors Halls.tsx convention) ────────────────────────────
const glassCardStyle =
    'bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-2xl backdrop-blur-xl';
const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 px-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl';
const dateInputStyle = `${inputStyle} [color-scheme:dark]`;
const labelStyle =
    'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

// ── Types ──────────────────────────────────────────────────────────────────
type TargetKind = 'user' | 'level' | 'department' | 'role' | 'program';

interface SignInLock {
    id: string;
    targetKind: TargetKind;
    targetId: string;
    targetLabel?: string | null;
    reason: string;
    isTimeWindow: boolean;
    openFrom: string | null;
    openTo: string | null;
    expiresAt: string | null;
    createdBy?: string | null;
    createdAt: string;
    releasedAt?: string | null;
    releasedBy?: string | null;
}

interface Department {
    id: string;
    code: string;
    name: string;
}

interface UserLite {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

type StatusFilter = 'active' | 'released' | 'all';
type TargetKindFilter = 'all' | TargetKind;
type LockType = 'permanent' | 'expires' | 'window';
// Origin filter — separates locks created automatically by the unpaid-fees
// cron (reason='unpaid_fees') from locks an admin created manually. Useful
// when the queue gets long and you want to spot which ones need human review.
type OriginFilter = 'all' | 'auto' | 'manual';
const UNPAID_FEES_REASON = 'unpaid_fees';

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_LOCKS: SignInLock[] = [
    {
        id: 'lock-1',
        targetKind: 'user',
        targetId: 'stu-1182',
        targetLabel: 'Mariam El-Sayed (mariam.elsayed@uniflow.test)',
        reason: UNPAID_FEES_REASON,
        isTimeWindow: false,
        openFrom: null,
        openTo: null,
        expiresAt: null,
        createdBy: null,
        createdAt: '2026-04-26T03:00:00.000Z',
        releasedAt: null,
    },
    {
        id: 'lock-2',
        targetKind: 'user',
        targetId: 'stu-1190',
        targetLabel: 'Omar Hassan (omar.hassan@uniflow.test)',
        reason: UNPAID_FEES_REASON,
        isTimeWindow: false,
        openFrom: null,
        openTo: null,
        expiresAt: null,
        createdBy: null,
        createdAt: '2026-04-26T03:00:00.000Z',
        releasedAt: null,
    },
    {
        id: 'lock-3',
        targetKind: 'role',
        targetId: 'student',
        targetLabel: 'Student',
        reason: 'Scheduled maintenance — student portal frozen during grade migration.',
        isTimeWindow: true,
        openFrom: '2026-05-01T18:00:00.000Z',
        openTo: '2026-05-01T22:00:00.000Z',
        expiresAt: null,
        createdBy: 'admin-1',
        createdAt: '2026-04-24T12:30:00.000Z',
        releasedAt: null,
    },
    {
        id: 'lock-4',
        targetKind: 'department',
        targetId: 'CS',
        targetLabel: 'CS — Computer Science',
        reason: 'Disciplinary review pending for the department cohort.',
        isTimeWindow: false,
        openFrom: null,
        openTo: null,
        expiresAt: '2026-05-15T00:00:00.000Z',
        createdBy: 'admin-1',
        createdAt: '2026-04-20T09:00:00.000Z',
        releasedAt: null,
    },
    {
        id: 'lock-5',
        targetKind: 'level',
        targetId: '1',
        targetLabel: 'Level 1',
        reason: 'Orientation hold lifted after onboarding session.',
        isTimeWindow: false,
        openFrom: null,
        openTo: null,
        expiresAt: null,
        createdBy: 'admin-1',
        createdAt: '2026-04-10T08:00:00.000Z',
        releasedAt: '2026-04-15T08:00:00.000Z',
        releasedBy: 'admin-1',
    },
];

const MOCK_DEPARTMENTS: Department[] = [
    { id: 'dept-cs', code: 'CS', name: 'Computer Science' },
    { id: 'dept-ds', code: 'DS', name: 'Data Science' },
    { id: 'dept-cy', code: 'CY', name: 'Cybersecurity' },
    { id: 'dept-ma', code: 'MA', name: 'Mathematics' },
    { id: 'dept-bu', code: 'BU', name: 'Business Informatics' },
];

const MOCK_USERS: UserLite[] = [
    { id: 'stu-1182', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.test' },
    { id: 'stu-1190', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.test' },
    { id: 'stu-1204', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@uniflow.test' },
    { id: 'stu-1212', firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.test' },
    { id: 'stu-1220', firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.test' },
    { id: 'stu-1233', firstName: 'Karim', lastName: 'Mostafa', email: 'karim.mostafa@uniflow.test' },
];

// Option arrays are now computed inside the component via useMemo so labels
// flow through useT() and switch with the active locale.

// ── Helpers ────────────────────────────────────────────────────────────────
const formatDateTime = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString();
    } catch {
        return '—';
    }
};

type TFn = (key: string, params?: Record<string, string | number>) => string;

const timeAgo = (iso: string | null | undefined, t: TFn): string => {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        const diff = Date.now() - d.getTime();
        if (diff < 0) return formatDateTime(iso);
        const minute = 60_000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < minute) return t('admin.silJustNow');
        if (diff < hour) return t('admin.silMinAgo', { n: Math.floor(diff / minute) });
        if (diff < day) return t('admin.silHrAgo', { n: Math.floor(diff / hour) });
        const days = Math.floor(diff / day);
        if (days < 30) return days === 1 ? t('admin.silDayAgo', { n: days }) : t('admin.silDaysAgo', { n: days });
        return formatDateTime(iso);
    } catch {
        return '—';
    }
};

const targetKindBadge = (kind: TargetKind): string => {
    switch (kind) {
        case 'user': return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
        case 'level': return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
        case 'department': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
        case 'role': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
        case 'program': return 'bg-pink-500/15 text-pink-300 border-pink-500/30';
        default: return 'bg-gray-500/15 text-gray-300 border-gray-500/30';
    }
};

// Compute display status from the row's timestamps. A row counts as "expired"
// when its expiresAt has passed but it hasn't been explicitly released.
type DisplayStatus = 'active' | 'released' | 'expired';
const computeStatus = (lock: SignInLock): DisplayStatus => {
    if (lock.releasedAt) return 'released';
    if (lock.expiresAt) {
        const exp = new Date(lock.expiresAt).getTime();
        if (!Number.isNaN(exp) && exp < Date.now()) return 'expired';
    }
    return 'active';
};

const statusPill = (status: DisplayStatus): string => {
    switch (status) {
        case 'active': return 'bg-red-500/15 text-red-300';
        case 'released': return 'bg-emerald-500/15 text-emerald-300';
        case 'expired': return 'bg-gray-500/15 text-gray-300';
        default: return 'bg-gray-500/15 text-gray-300';
    }
};

const lockTypeLabel = (lock: SignInLock, t: TFn): string => {
    if (lock.isTimeWindow) return t('admin.silLockTypeWindow');
    if (lock.expiresAt) return t('admin.silLockTypeExpires');
    return t('admin.silLockTypePermanent');
};

// ── Component ──────────────────────────────────────────────────────────────
const SignInLocks: FC = () => {
    const t = useT();
    const [locks, setLocks] = useState<SignInLock[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
    const [targetKindFilter, setTargetKindFilter] = useState<TargetKindFilter>('all');
    const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
    const [search, setSearch] = useState('');

    // Modal
    const [showAdd, setShowAdd] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [successFlash, setSuccessFlash] = useState<string | null>(null);

    // Form state
    const [targetKind, setTargetKind] = useState<TargetKind>('user');
    const [targetId, setTargetId] = useState<string>('');
    const [targetLabelHint, setTargetLabelHint] = useState<string>('');
    const [reason, setReason] = useState<string>('');
    const [lockType, setLockType] = useState<LockType>('permanent');
    const [expiresAt, setExpiresAt] = useState<string>('');
    const [openFrom, setOpenFrom] = useState<string>('');
    const [openTo, setOpenTo] = useState<string>('');

    // User picker (debounced over mock data)
    const [userSearch, setUserSearch] = useState<string>('');
    const [userResults, setUserResults] = useState<UserLite[]>([]);
    const [userSearchLoading, setUserSearchLoading] = useState(false);

    // Department list (mock)
    const [departments] = useState<Department[]>(MOCK_DEPARTMENTS);

    // Locale-aware option arrays.
    const TARGET_KIND_OPTIONS = useMemo<{ value: TargetKind; label: string }[]>(() => [
        { value: 'user', label: t('admin.silKindUser') },
        { value: 'level', label: t('admin.silKindLevel') },
        { value: 'department', label: t('admin.silKindDepartment') },
        { value: 'role', label: t('admin.silKindRole') },
        { value: 'program', label: t('admin.silKindProgram') },
    ], [t]);
    const TARGET_KIND_FILTER_OPTIONS = useMemo<{ value: TargetKindFilter; label: string }[]>(() => [
        { value: 'all', label: t('admin.silAllTargetKinds') },
        ...TARGET_KIND_OPTIONS,
    ], [t, TARGET_KIND_OPTIONS]);
    const STATUS_OPTIONS = useMemo<{ value: StatusFilter; label: string }[]>(() => [
        { value: 'active', label: t('admin.silStatusActive') },
        { value: 'released', label: t('admin.silStatusReleased') },
        { value: 'all', label: t('admin.silStatusAll') },
    ], [t]);
    // Origin filter labels — kept English-only on purpose; the i18n keys for
    // these would be on a separate translation pass.
    const ORIGIN_OPTIONS = useMemo<{ value: OriginFilter; label: string }[]>(() => [
        { value: 'all',    label: 'All sources' },
        { value: 'auto',   label: 'Auto (unpaid fees)' },
        { value: 'manual', label: 'Manual' },
    ], []);
    const ROLE_OPTIONS = useMemo<{ value: string; label: string }[]>(() => [
        { value: 'student', label: t('admin.silRoleStudent') },
        { value: 'professor', label: t('admin.silRoleProfessor') },
        { value: 'ta', label: t('admin.silRoleTA') },
        { value: 'sa', label: t('admin.silRoleSA') },
        { value: 'admin', label: t('admin.silRoleAdmin') },
        { value: 'financial', label: t('admin.silRoleFinancial') },
        { value: 'it', label: t('admin.silRoleIT') },
    ], [t]);
    const LEVEL_OPTIONS = useMemo<{ value: string; label: string }[]>(() => [
        { value: '1', label: t('admin.silLevel1') },
        { value: '2', label: t('admin.silLevel2') },
        { value: '3', label: t('admin.silLevel3') },
        { value: '4', label: t('admin.silLevel4') },
    ], [t]);

    // ── Load locks (mock) ──────────────────────────────────────────────────
    useEffect(() => {
        setLocks(MOCK_LOCKS);
        setLoading(false);
    }, []);

    // ── Debounced user search over the mock list ──────────────────────────
    useEffect(() => {
        if (targetKind !== 'user' || !showAdd) return;
        const q = userSearch.trim().toLowerCase();
        if (!q) {
            setUserResults([]);
            return;
        }
        setUserSearchLoading(true);
        const timer = window.setTimeout(() => {
            const list = MOCK_USERS.filter(
                (u) =>
                    `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
                    u.email.toLowerCase().includes(q),
            ).slice(0, 20);
            setUserResults(list);
            setUserSearchLoading(false);
        }, 300);
        return () => window.clearTimeout(timer);
    }, [userSearch, targetKind, showAdd]);

    // ── When target kind switches, reset target ───────────────────────────
    useEffect(() => {
        if (!showAdd) return;
        setTargetId('');
        setTargetLabelHint('');
        setUserSearch('');
        setUserResults([]);
    }, [targetKind, showAdd]);

    // ── Modal open / close ────────────────────────────────────────────────
    const openAdd = () => {
        setTargetKind('user');
        setTargetId('');
        setTargetLabelHint('');
        setReason('');
        setLockType('permanent');
        setExpiresAt('');
        setOpenFrom('');
        setOpenTo('');
        setUserSearch('');
        setUserResults([]);
        setFormError(null);
        setShowAdd(true);
    };

    const closeAdd = () => {
        if (submitting) return;
        setShowAdd(false);
        setFormError(null);
    };

    // ── Client-side validation (mirrors backend Zod) ──────────────────────
    const validate = (): string | null => {
        if (!targetKind) return t('admin.silValPickKind');
        if (!targetId.trim()) return t('admin.silValPickTarget');
        const r = reason.trim();
        if (r.length < 3) return t('admin.silValReasonShort');
        if (r.length > 500) return t('admin.silValReasonLong');

        if (lockType === 'expires') {
            if (!expiresAt) return t('admin.silValPickExpiry');
            const ts = new Date(expiresAt).getTime();
            if (Number.isNaN(ts)) return t('admin.silValInvalidExpiry');
            if (ts < Date.now()) return t('admin.silValFutureExpiry');
        }

        if (lockType === 'window') {
            if (!openFrom) return t('admin.silValPickOpenFrom');
            if (!openTo) return t('admin.silValPickOpenTo');
            const from = new Date(openFrom).getTime();
            const to = new Date(openTo).getTime();
            if (Number.isNaN(from)) return t('admin.silValInvalidOpenFrom');
            if (Number.isNaN(to)) return t('admin.silValInvalidOpenTo');
            if (from >= to) return t('admin.silValOpenOrder');
        }

        return null;
    };

    // ── Submit (local-only) ────────────────────────────────────────────────
    const submit = () => {
        const err = validate();
        if (err) {
            setFormError(err);
            return;
        }
        setFormError(null);
        setSubmitting(true);
        // Simulate a brief save, then prepend the new lock to local state.
        window.setTimeout(() => {
            const newLock: SignInLock = {
                id: `lock-${Date.now()}`,
                targetKind,
                targetId: targetId.trim(),
                targetLabel: targetLabelHint || targetId.trim(),
                reason: reason.trim(),
                isTimeWindow: lockType === 'window',
                openFrom: lockType === 'window' ? new Date(openFrom).toISOString() : null,
                openTo: lockType === 'window' ? new Date(openTo).toISOString() : null,
                expiresAt: lockType === 'expires' ? new Date(expiresAt).toISOString() : null,
                createdBy: 'admin-1',
                createdAt: new Date().toISOString(),
                releasedAt: null,
            };
            setLocks((prev) => [newLock, ...prev]);
            setSubmitting(false);
            setShowAdd(false);
            setSuccessFlash(t('admin.silLockCreated'));
            window.setTimeout(() => setSuccessFlash(null), 2000);
        }, 400);
    };

    // ── Release / delete actions (local-only) ──────────────────────────────
    const release = (id: string) => {
        if (!window.confirm(t('admin.silReleaseConfirm'))) return;
        setLocks((prev) =>
            prev.map((l) =>
                l.id === id
                    ? { ...l, releasedAt: new Date().toISOString(), releasedBy: 'admin-1' }
                    : l,
            ),
        );
    };

    const remove = (id: string) => {
        if (!window.confirm(t('admin.silDeleteConfirm'))) return;
        setLocks((prev) => prev.filter((l) => l.id !== id));
    };

    // ── Client-side filters (status + kind + origin + search) ─────────────
    const filteredLocks = useMemo(() => {
        const q = search.trim().toLowerCase();
        return locks.filter((l) => {
            // Status filter (was server-side; now applied locally).
            const status = computeStatus(l);
            if (statusFilter === 'active' && status !== 'active') return false;
            if (statusFilter === 'released' && status === 'active') return false;
            // Target-kind filter
            if (targetKindFilter !== 'all' && l.targetKind !== targetKindFilter) return false;
            // Origin filter
            const isAuto = (l.reason || '') === UNPAID_FEES_REASON;
            if (originFilter === 'auto'   && !isAuto) return false;
            if (originFilter === 'manual' &&  isAuto) return false;
            // Search filter
            if (!q) return true;
            const label = (l.targetLabel || l.targetId || '').toLowerCase();
            const reasonLower = (l.reason || '').toLowerCase();
            return label.includes(q) || reasonLower.includes(q) || l.targetId.toLowerCase().includes(q);
        });
    }, [locks, search, originFilter, statusFilter, targetKindFilter]);

    // ── Render target picker for the modal based on selected kind ────────
    const renderTargetPicker = () => {
        if (targetKind === 'user') {
            return (
                <div className="space-y-2">
                    <div className="relative">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            placeholder={t('admin.silSearchUsersPh')}
                            className={`${inputStyle} pl-10`}
                        />
                    </div>
                    {targetId && targetLabelHint && (
                        <div className="text-xs flex items-center gap-2 px-3 py-2 rounded-lg bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 text-[#c89eff]">
                            <i className="ph-bold ph-check-circle" />
                            <span>{t('admin.silSelected')} <strong>{targetLabelHint}</strong></span>
                            <button
                                type="button"
                                onClick={() => { setTargetId(''); setTargetLabelHint(''); }}
                                className="ml-auto text-xs underline opacity-80 hover:opacity-100"
                            >
                                {t('admin.silClear')}
                            </button>
                        </div>
                    )}
                    {userSearchLoading && (
                        <div className="text-xs text-gray-500 italic">{t('admin.silSearching')}</div>
                    )}
                    {!userSearchLoading && userSearch.trim() && userResults.length === 0 && (
                        <div className="text-xs text-gray-500 italic">{t('admin.silNoMatchesUsers')}</div>
                    )}
                    {userResults.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 dark:border-white/5 divide-y divide-white/5">
                            {userResults.map((u) => {
                                const label = `${u.firstName} ${u.lastName}`.trim();
                                const isSelected = targetId === u.id;
                                return (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => {
                                            setTargetId(u.id);
                                            setTargetLabelHint(`${label} (${u.email})`);
                                            setUserResults([]);
                                            setUserSearch('');
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                            isSelected
                                                ? 'bg-[#6A3FF4]/20 text-[#c89eff]'
                                                : 'text-black dark:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        <div className="font-medium">{label || u.email}</div>
                                        <div className="text-[11px] text-gray-500">{u.email}</div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        if (targetKind === 'department') {
            const options = departments.length === 0
                ? [{ value: '', label: t('admin.silLoadingDepts') }]
                : [
                    { value: '', label: t('admin.silSelectDept') },
                    ...departments.map((d) => ({
                        value: d.code,
                        label: `${d.code} — ${d.name}`,
                    })),
                ];
            return (
                <div>
                    <GlassDropdown
                        value={targetId}
                        onChange={(v) => {
                            setTargetId(v);
                            const dept = departments.find((d) => d.code === v);
                            setTargetLabelHint(dept ? `${dept.code} — ${dept.name}` : '');
                        }}
                        options={options}
                        direction="up"
                        className="w-full"
                    />
                </div>
            );
        }

        if (targetKind === 'level') {
            return (
                <GlassDropdown
                    value={targetId}
                    onChange={(v) => {
                        setTargetId(v);
                        setTargetLabelHint(t('admin.silLevelN' as never) && `${t('admin.silKindLevel')} ${v}`);
                    }}
                    options={[
                        { value: '', label: t('admin.silSelectLevel') },
                        ...LEVEL_OPTIONS,
                    ]}
                    direction="up"
                    className="w-full"
                />
            );
        }

        if (targetKind === 'role') {
            return (
                <GlassDropdown
                    value={targetId}
                    onChange={(v) => {
                        setTargetId(v);
                        const role = ROLE_OPTIONS.find((r) => r.value === v);
                        setTargetLabelHint(role?.label || v);
                    }}
                    options={[
                        { value: '', label: t('admin.silSelectRole') },
                        ...ROLE_OPTIONS,
                    ]}
                    direction="up"
                    className="w-full"
                />
            );
        }

        // program — free text input
        return (
            <input
                type="text"
                value={targetId}
                onChange={(e) => {
                    setTargetId(e.target.value);
                    setTargetLabelHint(e.target.value);
                }}
                placeholder={t('admin.silProgramPh')}
                className={inputStyle}
            />
        );
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
                    <div>
                        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">
                            {t('admin.signInLocksTitle')}
                        </h1>
                        <p className="text-black dark:text-gray-300 text-sm max-w-3xl">
                            {t('admin.signInLocksSubtitle')} {t('admin.silLocksDetail')}
                        </p>
                    </div>
                    <button
                        onClick={openAdd}
                        className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 self-start sm:self-auto"
                    >
                        <i className="ph-bold ph-plus" /> {t('admin.silAddLockBtn')}
                    </button>
                </div>
            </AnimateOnView>

            {successFlash && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
                    {successFlash}
                </div>
            )}

            {/* Filters */}
            <div className={`${glassCardStyle} p-4`}>
                <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-end">
                    <div className="lg:w-48">
                        <label className={labelStyle}>{t('admin.silFilterStatus')}</label>
                        <GlassDropdown
                            value={statusFilter}
                            onChange={(v) => setStatusFilter(v as StatusFilter)}
                            options={STATUS_OPTIONS}
                            direction="up"
                            className="w-full"
                        />
                    </div>
                    <div className="lg:w-56">
                        <label className={labelStyle}>{t('admin.silFilterTargetKind')}</label>
                        <GlassDropdown
                            value={targetKindFilter}
                            onChange={(v) => setTargetKindFilter(v as TargetKindFilter)}
                            options={TARGET_KIND_FILTER_OPTIONS}
                            direction="up"
                            className="w-full"
                        />
                    </div>
                    <div className="lg:w-56">
                        <label className={labelStyle}>Source</label>
                        <GlassDropdown
                            value={originFilter}
                            onChange={(v) => setOriginFilter(v as OriginFilter)}
                            options={ORIGIN_OPTIONS}
                            direction="up"
                            className="w-full"
                        />
                    </div>
                    <div className="flex-1">
                        <label className={labelStyle}>{t('admin.silFilterSearch')}</label>
                        <div className="relative">
                            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('admin.silFilterPh')}
                                className={`${inputStyle} pl-10`}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Locks table */}
            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColTargetKind')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColTarget')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColReason')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColType')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColCreated')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.silColStatus')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('admin.silColActions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center animate-pulse text-gray-500">
                                        {t('admin.silLoading')}
                                    </td>
                                </tr>
                            ) : filteredLocks.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-12 text-center text-gray-500 italic">
                                        {t('admin.silNoMatches')}
                                    </td>
                                </tr>
                            ) : (
                                filteredLocks.map((lock) => {
                                    const status = computeStatus(lock);
                                    const label = lock.targetLabel || lock.targetId;
                                    const kindLabelMap: Record<TargetKind, string> = {
                                        user: t('admin.silKindUser'),
                                        level: t('admin.silKindLevel'),
                                        department: t('admin.silKindDepartment'),
                                        role: t('admin.silKindRole'),
                                        program: t('admin.silKindProgram'),
                                    };
                                    const statusLabel = status === 'active' ? t('admin.silStatusActive')
                                        : status === 'released' ? t('admin.silStatusReleased')
                                        : t('admin.silStatusExpired');
                                    return (
                                        <tr key={lock.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="p-4">
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase border ${targetKindBadge(lock.targetKind)}`}>
                                                    {kindLabelMap[lock.targetKind]}
                                                </span>
                                            </td>
                                            <td className="p-4 text-sm text-black dark:text-white font-medium max-w-xs truncate" title={label}>
                                                {label}
                                            </td>
                                            <td className="p-4 text-xs text-gray-700 dark:text-gray-300 max-w-sm" title={lock.reason}>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {lock.reason === UNPAID_FEES_REASON && (
                                                        <span
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/15 text-amber-500 border border-amber-500/30"
                                                            title="Created automatically by the unpaid-fees cron"
                                                        >
                                                            <i className="ph-bold ph-robot text-[10px]"></i> Auto
                                                        </span>
                                                    )}
                                                    <span className="truncate">{lock.reason}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                                                {lockTypeLabel(lock, t)}
                                                {lock.expiresAt && !lock.isTimeWindow && (
                                                    <div className="text-[10px] text-gray-500">
                                                        {t('admin.silUntil', { date: formatDateTime(lock.expiresAt) })}
                                                    </div>
                                                )}
                                                {lock.isTimeWindow && (
                                                    <div className="text-[10px] text-gray-500">
                                                        {t('admin.silOpenRange', { from: formatDateTime(lock.openFrom), to: formatDateTime(lock.openTo) })}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-4 text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap" title={formatDateTime(lock.createdAt)}>
                                                {timeAgo(lock.createdAt, t)}
                                            </td>
                                            <td className="p-4">
                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${statusPill(status)}`}>
                                                    {statusLabel}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {status === 'active' && (
                                                        <button
                                                            onClick={() => release(lock.id)}
                                                            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/30 transition-all"
                                                        >
                                                            {t('admin.silReleaseBtn')}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => remove(lock.id)}
                                                        className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-all"
                                                    >
                                                        {t('admin.silDeleteBtn')}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Lock modal — outer wrapper scrolls; inner card uses
                overflow-visible so GlassDropdown menus aren't clipped by the
                modal bounds. */}
            {showAdd && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto"
                    onClick={closeAdd}
                >
                    <div
                        className={`${glassCardStyle} w-full max-w-xl p-6 space-y-4 my-8 mx-auto overflow-visible`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-bold text-black dark:text-white">{t('admin.silModalTitle')}</h2>
                            <button
                                onClick={closeAdd}
                                className="text-gray-400 hover:text-white transition-colors"
                                aria-label={t('admin.silClose')}
                            >
                                <i className="ph-bold ph-x text-lg" />
                            </button>
                        </div>

                        {formError && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                                {formError}
                            </div>
                        )}

                        <div>
                            <label className={labelStyle}>{t('admin.silFieldTargetKind')}</label>
                            <GlassDropdown
                                value={targetKind}
                                onChange={(v) => setTargetKind(v as TargetKind)}
                                options={TARGET_KIND_OPTIONS}
                                direction="down"
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label className={labelStyle}>{t('admin.silFieldTarget')}</label>
                            {renderTargetPicker()}
                        </div>

                        <div>
                            <label className={labelStyle}>{t('admin.silFieldReason')}</label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder={t('admin.silReasonPh')}
                                rows={3}
                                className={`${inputStyle} resize-none`}
                                maxLength={500}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                {t('admin.silReasonHint')}
                                <span className="ml-2 opacity-70">{reason.length}/500</span>
                            </p>
                        </div>

                        <div>
                            <label className={labelStyle}>{t('admin.silFieldLockType')}</label>
                            <div className="space-y-2">
                                {/* Permanent — glass radio (button-styled, matches project convention) */}
                                <button
                                    type="button"
                                    onClick={() => setLockType('permanent')}
                                    aria-pressed={lockType === 'permanent'}
                                    className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                                        lockType === 'permanent'
                                            ? 'bg-[#6A3FF4]/10 border-[#6A3FF4]/60'
                                            : 'bg-white/5 dark:bg-black/10 border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/40'
                                    }`}
                                >
                                    <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                                        lockType === 'permanent'
                                            ? 'border-[#7B5AFF] bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] shadow-md shadow-[#6A3FF4]/40'
                                            : 'border-white/30 dark:border-white/20 bg-white/5 dark:bg-black/20'
                                    }`}>
                                        {lockType === 'permanent' && <span className="w-2 h-2 rounded-full bg-white" />}
                                    </span>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-black dark:text-white">{t('admin.silTypePermanent')}</div>
                                        <div className="text-[11px] text-gray-500">
                                            {t('admin.silTypePermanentDesc')}
                                        </div>
                                    </div>
                                </button>

                                {/* Expires at */}
                                <div
                                    onClick={() => setLockType('expires')}
                                    className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                                        lockType === 'expires'
                                            ? 'bg-[#6A3FF4]/10 border-[#6A3FF4]/60'
                                            : 'bg-white/5 dark:bg-black/10 border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/40'
                                    }`}
                                >
                                    <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                                        lockType === 'expires'
                                            ? 'border-[#7B5AFF] bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] shadow-md shadow-[#6A3FF4]/40'
                                            : 'border-white/30 dark:border-white/20 bg-white/5 dark:bg-black/20'
                                    }`}>
                                        {lockType === 'expires' && <span className="w-2 h-2 rounded-full bg-white" />}
                                    </span>
                                    <div className="flex-1 space-y-2">
                                        <div>
                                            <div className="text-sm font-medium text-black dark:text-white">{t('admin.silTypeExpires')}</div>
                                            <div className="text-[11px] text-gray-500">
                                                {t('admin.silTypeExpiresDesc')}
                                            </div>
                                        </div>
                                        {lockType === 'expires' && (
                                            <input
                                                type="datetime-local"
                                                value={expiresAt}
                                                onChange={(e) => setExpiresAt(e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                className={dateInputStyle}
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Time window */}
                                <div
                                    onClick={() => setLockType('window')}
                                    className={`flex items-start gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${
                                        lockType === 'window'
                                            ? 'bg-[#6A3FF4]/10 border-[#6A3FF4]/60'
                                            : 'bg-white/5 dark:bg-black/10 border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/40'
                                    }`}
                                >
                                    <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                                        lockType === 'window'
                                            ? 'border-[#7B5AFF] bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] shadow-md shadow-[#6A3FF4]/40'
                                            : 'border-white/30 dark:border-white/20 bg-white/5 dark:bg-black/20'
                                    }`}>
                                        {lockType === 'window' && <span className="w-2 h-2 rounded-full bg-white" />}
                                    </span>
                                    <div className="flex-1 space-y-2">
                                        <div>
                                            <div className="text-sm font-medium text-black dark:text-white">{t('admin.silTypeWindow')}</div>
                                            <div className="text-[11px] text-gray-500">
                                                {t('admin.silTypeWindowDesc')}
                                            </div>
                                        </div>
                                        {lockType === 'window' && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                                                <div>
                                                    <label className={labelStyle}>{t('admin.silOpenFrom')}</label>
                                                    <input
                                                        type="datetime-local"
                                                        value={openFrom}
                                                        onChange={(e) => setOpenFrom(e.target.value)}
                                                        className={dateInputStyle}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>{t('admin.silOpenTo')}</label>
                                                    <input
                                                        type="datetime-local"
                                                        value={openTo}
                                                        onChange={(e) => setOpenTo(e.target.value)}
                                                        className={dateInputStyle}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={closeAdd}
                                disabled={submitting}
                                className="px-4 py-2 rounded-xl text-sm bg-white/10 text-gray-300 hover:bg-white/15 disabled:opacity-50"
                            >
                                {t('admin.silCancel')}
                            </button>
                            <button
                                onClick={submit}
                                disabled={submitting}
                                className="px-4 py-2 rounded-xl text-sm bg-[#6A3FF4] text-white hover:bg-[#5A32D4] disabled:opacity-50"
                            >
                                {submitting ? t('admin.silCreating') : t('admin.silCreateLock')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SignInLocks;
