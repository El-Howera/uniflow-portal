import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const inputStyle = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500";
const labelStyle = "block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider";
const primaryBtn = "px-4 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50";
const secondaryBtn = "px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-semibold text-sm hover:bg-white/10 transition-colors";

interface RequestTypeRow {
    id: string;
    typeKey: string | null;
    name: string;
    department: string | null;
    description: string | null;
    estimatedDays: number;
    isActive: boolean;
}

interface ComplaintCategoryRow {
    id: string;
    categoryKey: string;
    name: string;
    description: string | null;
    icon: string | null;
    defaultSeverity: 'low' | 'medium' | 'high' | 'urgent';
    isActive: boolean;
}

type Tab = 'requests' | 'complaints' | 'contacts' | 'quicklinks';

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_REQUEST_TYPES: RequestTypeRow[] = [
    { id: 'rt-1', typeKey: 'transcript', name: 'Official Transcript', department: 'Registrar', description: 'Request an official sealed transcript.', estimatedDays: 3, isActive: true },
    { id: 'rt-2', typeKey: 'enrollment', name: 'Enrollment Verification', department: 'Student Affairs', description: 'Letter confirming current enrollment status.', estimatedDays: 2, isActive: true },
    { id: 'rt-3', typeKey: 'withdrawal', name: 'Course Withdrawal', department: 'Registrar', description: 'Withdraw from a registered course.', estimatedDays: 1, isActive: true },
    { id: 'rt-4', typeKey: 'document', name: 'Document Request', department: 'Registrar', description: 'Stamped copies of academic documents.', estimatedDays: 5, isActive: false },
];

const MOCK_COMPLAINT_CATEGORIES: ComplaintCategoryRow[] = [
    { id: 'cc-1', categoryKey: 'academic', name: 'Academic / Grading', description: 'Grade appeals and academic disputes.', icon: 'ph-graduation-cap', defaultSeverity: 'high', isActive: true },
    { id: 'cc-2', categoryKey: 'facility', name: 'Facilities', description: 'Issues with labs, halls, and equipment.', icon: 'ph-buildings', defaultSeverity: 'medium', isActive: true },
    { id: 'cc-3', categoryKey: 'conduct', name: 'Conduct / Harassment', description: 'Behavioral concerns and harassment reports.', icon: 'ph-shield-warning', defaultSeverity: 'urgent', isActive: true },
    { id: 'cc-4', categoryKey: 'attendance', name: 'Attendance', description: 'Disputes over attendance marking.', icon: 'ph-calendar-x', defaultSeverity: 'low', isActive: true },
];

const MOCK_CONTACTS: DepartmentContactRow[] = [
    { id: 'dc-1', deptKey: 'registrar', department: 'Registrar', title: 'Registrar Office', name: 'Mona Saleh', role: 'Head Registrar', email: 'registrar@uniflow.edu', phone: '+20 3 555 0101', office: 'Admin Building, Room 12', hours: 'Sun–Thu 9:00–15:00', location: 'Ground Floor', description: 'Transcripts, enrollment, and records.' },
    { id: 'dc-2', deptKey: 'finance', department: 'Finance', title: 'Finance Office', name: 'Tarek Adel', role: 'Finance Manager', email: 'finance@uniflow.edu', phone: '+20 3 555 0102', office: 'Admin Building, Room 8', hours: 'Sun–Thu 9:00–14:00', location: 'Ground Floor', description: 'Tuition, fees, and payment plans.' },
    { id: 'dc-3', deptKey: 'sa', department: 'Student Affairs', title: 'Student Affairs Desk', name: 'Laila Mansour', role: 'SA Coordinator', email: 'studentaffairs@uniflow.edu', phone: '+20 3 555 0103', office: 'Student Center, Room 3', hours: 'Sun–Thu 9:00–16:00', location: 'First Floor', description: 'Requests, complaints, and student support.' },
];

const MOCK_QUICK_LINKS: QuickLink[] = [
    { label: 'Library Portal', url: 'https://library.uniflow.edu', icon: 'ph-books' },
    { label: 'Academic Calendar', url: 'https://uniflow.edu/calendar', icon: 'ph-calendar' },
    { label: 'IT Help Desk', url: 'https://it.uniflow.edu', icon: 'ph-lifebuoy' },
];

const SACategories: React.FC = () => {
    const t = useT();
    const [tab, setTab] = useState<Tab>('requests');
    const tabLabel = (tabKey: Tab) => {
        if (tabKey === 'requests') return t('sa.requestTypesTabLabel');
        if (tabKey === 'complaints') return t('sa.complaintCategoriesTabLabel');
        if (tabKey === 'contacts') return t('sa.contactsTabLabel');
        return t('sa.quickLinksTabLabel');
    };
    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.categoriesTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">
                    {t('sa.categoriesPageHint')}
                </p>
            </AnimateOnView>

            <div className={`${glassCardStyle} p-1 inline-flex flex-wrap w-fit gap-1`}>
                {(['requests', 'complaints', 'contacts', 'quicklinks'] as Tab[]).map((tabKey) => (
                    <button
                        key={tabKey}
                        onClick={() => setTab(tabKey)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                            tab === tabKey ? 'bg-[#6A3FF4] text-white shadow-lg' : 'text-gray-500 hover:bg-white/5'
                        }`}
                    >
                        {tabLabel(tabKey)}
                    </button>
                ))}
            </div>

            {tab === 'requests' && <RequestTypesPanel />}
            {tab === 'complaints' && <ComplaintCategoriesPanel />}
            {tab === 'contacts' && <DepartmentContactsPanel />}
            {tab === 'quicklinks' && <QuickLinksPanel />}
        </div>
    );
};

// ─── Request Types Panel ─────────────────────────────────────────────────────

const RequestTypesPanel: React.FC = () => {
    const t = useT();
    const [rows, setRows] = useState<RequestTypeRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<RequestTypeRow | null>(null);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        // MVP build: populate from static mock data, no backend.
        setLoading(true);
        setError(null);
        setRows(MOCK_REQUEST_TYPES);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (row: RequestTypeRow) => {
        if (!window.confirm(t('sa.confirmDeleteHardDeleteRow', { name: row.name }))) return;
        // MVP build: optimistic local removal; no backend.
        setRows((prev) => prev.filter((r) => r.id !== row.id));
    };

    const handleToggleActive = async (row: RequestTypeRow) => {
        // MVP build: toggle the row's active flag locally; no backend.
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-gray-500">
                    {loading ? t('sa.loadingDotsShort') : t('sa.requestTypeCount', { count: rows.length, plural: rows.length === 1 ? '' : 's' })}
                </div>
                <button onClick={() => { setEditing(null); setShowCreate(true); }} className={primaryBtn}>
                    <i className="ph-bold ph-plus mr-1" /> {t('sa.newRequestTypeBtn')}
                </button>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white/5 animate-pulse rounded-2xl" />)}
                </div>
            ) : rows.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-10 text-center">{t('sa.noRequestTypes')}</p>
            ) : (
                <div className="space-y-2">
                    {rows.map((r) => (
                        <div key={r.id} className={`${glassCardStyle} p-4 flex items-center justify-between gap-3 flex-wrap`}>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[11px] font-mono font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md">
                                        {r.typeKey || '—'}
                                    </span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${r.isActive ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-400'}`}>
                                        {r.isActive ? t('sa.activeStatus') : t('sa.disabledStatus')}
                                    </span>
                                    {r.department && (
                                        <span className="text-[10px] text-gray-500">→ {r.department}</span>
                                    )}
                                </div>
                                <p className="text-black dark:text-white font-semibold text-sm mt-1">{r.name}</p>
                                {r.description && (
                                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">{r.description}</p>
                                )}
                                <p className="text-gray-500 text-[10px] mt-0.5">{t('sa.estimatedTurnaround', { days: r.estimatedDays, plural: r.estimatedDays === 1 ? '' : 's' })}</p>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                                <button
                                    onClick={() => handleToggleActive(r)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                        r.isActive
                                            ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                                            : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                                    }`}
                                >
                                    {r.isActive ? t('sa.disableBtn') : t('sa.enableBtn')}
                                </button>
                                <button
                                    onClick={() => { setEditing(r); setShowCreate(false); }}
                                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] transition-colors"
                                    title={t('sa.editTooltip')}
                                >
                                    <i className="ph-bold ph-pencil" />
                                </button>
                                <button
                                    onClick={() => handleDelete(r)}
                                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
                                    title={t('sa.deleteTooltip')}
                                >
                                    <i className="ph-bold ph-trash" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {(showCreate || editing) && (
                    <RequestTypeFormModal
                        editing={editing}
                        onCancel={() => { setShowCreate(false); setEditing(null); }}
                        onSaved={(row) => {
                            setShowCreate(false);
                            setEditing(null);
                            // MVP build: merge the saved row into local state.
                            setRows((prev) => prev.some((r) => r.id === row.id)
                                ? prev.map((r) => (r.id === row.id ? row : r))
                                : [...prev, row]);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const RequestTypeFormModal: React.FC<{
    editing: RequestTypeRow | null;
    onCancel: () => void;
    onSaved: (row: RequestTypeRow) => void;
}> = ({ editing, onCancel, onSaved }) => {
    const t = useT();
    const [typeKey, setTypeKey] = useState(editing?.typeKey ?? '');
    const [name, setName] = useState(editing?.name ?? '');
    const [department, setDepartment] = useState(editing?.department ?? '');
    const [description, setDescription] = useState(editing?.description ?? '');
    const [estimatedDays, setEstimatedDays] = useState(String(editing?.estimatedDays ?? 5));
    const [isActive, setIsActive] = useState(editing?.isActive ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing && (!typeKey.trim() || !name.trim())) {
            setErr(t('sa.typeKeyAndNameRequired'));
            return;
        }
        setSaving(true);
        setErr(null);
        // MVP build: build the row locally and hand it up; no backend.
        const row: RequestTypeRow = {
            id: editing?.id ?? `rt-${Date.now()}`,
            typeKey: editing?.typeKey ?? typeKey.trim(),
            name: name.trim(),
            department: department.trim() || null,
            description: description.trim() || null,
            estimatedDays: Number(estimatedDays),
            isActive,
        };
        onSaved(row);
        setSaving(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onCancel}
        >
            <motion.form
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className={`${glassCardStyle} max-w-md w-full p-6 space-y-4`}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleSave}
            >
                <h3 className="text-black dark:text-white text-lg font-bold">
                    {editing ? t('sa.editRequestType') : t('sa.newRequestType')}
                </h3>

                <div>
                    <label className={labelStyle}>{t('sa.typeKeyLabel')}</label>
                    <input
                        type="text"
                        value={typeKey}
                        onChange={(e) => setTypeKey(e.target.value)}
                        disabled={!!editing}
                        className={`${inputStyle} ${editing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        placeholder={t('sa.typeKeyPlaceholder')}
                    />
                    <p className="text-[10px] text-gray-500 mt-1">{t('sa.typeKeyHint')}</p>
                </div>

                <div>
                    <label className={labelStyle}>{t('sa.displayNameLabel')}</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputStyle} placeholder={t('sa.displayNameRequestPlaceholder')} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelStyle}>{t('sa.departmentInputLabel')}</label>
                        <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} className={inputStyle} placeholder={t('sa.departmentInputPlaceholder')} />
                    </div>
                    <div>
                        <label className={labelStyle}>{t('sa.estimatedDaysLabel')}</label>
                        <input type="number" min={1} max={60} value={estimatedDays} onChange={(e) => setEstimatedDays(e.target.value)} className={inputStyle} />
                    </div>
                </div>

                <div>
                    <label className={labelStyle}>{t('sa.descriptionLabel')}</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        className={`${inputStyle} resize-none`}
                        placeholder={t('sa.descriptionRequestPlaceholder')}
                    />
                </div>

                <div
                    className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
                    onClick={() => setIsActive(!isActive)}
                >
                    <GlassCheckbox checked={isActive} onChange={setIsActive} size="sm" />
                    {t('sa.activeVisibleToStudents')}
                </div>

                {err && (
                    <p className="text-red-400 text-xs">{err}</p>
                )}

                <div className="flex gap-2 pt-2">
                    <button type="button" onClick={onCancel} className={`flex-1 ${secondaryBtn}`}>{t('sa.cancelBtn')}</button>
                    <button type="submit" disabled={saving} className={`flex-1 ${primaryBtn}`}>
                        {saving ? t('sa.savingDotsShort') : editing ? t('sa.saveChangesShort') : t('sa.createShort')}
                    </button>
                </div>
            </motion.form>
        </motion.div>
    );
};

// ─── Complaint Categories Panel ──────────────────────────────────────────────

const ComplaintCategoriesPanel: React.FC = () => {
    const t = useT();
    const [rows, setRows] = useState<ComplaintCategoryRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<ComplaintCategoryRow | null>(null);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        // MVP build: populate from static mock data, no backend.
        setLoading(true);
        setError(null);
        setRows(MOCK_COMPLAINT_CATEGORIES);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (row: ComplaintCategoryRow) => {
        if (!window.confirm(t('sa.confirmDeleteHardDeleteRow2', { name: row.name }))) return;
        // MVP build: optimistic local removal; no backend.
        setRows((prev) => prev.filter((r) => r.id !== row.id));
    };

    const handleToggleActive = async (row: ComplaintCategoryRow) => {
        // MVP build: toggle the row's active flag locally; no backend.
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, isActive: !r.isActive } : r)));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-gray-500">
                    {loading ? t('sa.loadingDotsShort') : t('sa.categoryCount', { count: rows.length, plural: rows.length === 1 ? 'y' : 'ies' })}
                </div>
                <button onClick={() => { setEditing(null); setShowCreate(true); }} className={primaryBtn}>
                    <i className="ph-bold ph-plus mr-1" /> {t('sa.newCategoryBtn')}
                </button>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
            )}

            {loading ? (
                <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-white/5 animate-pulse rounded-2xl" />)}
                </div>
            ) : rows.length === 0 ? (
                <p className="text-sm text-gray-500 italic py-10 text-center">{t('sa.noComplaintCategories')}</p>
            ) : (
                <div className="space-y-2">
                    {rows.map((r) => (
                        <div key={r.id} className={`${glassCardStyle} p-4 flex items-center justify-between gap-3 flex-wrap`}>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    {r.icon && (
                                        <i className={`ph-fill ${r.icon} text-[#6A3FF4]`} />
                                    )}
                                    <span className="text-[11px] font-mono font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md">
                                        {r.categoryKey}
                                    </span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${r.isActive ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-400'}`}>
                                        {r.isActive ? t('sa.activeStatus') : t('sa.disabledStatus')}
                                    </span>
                                    <span className="text-[10px] text-gray-500 capitalize">{t('sa.defaultSeverityLabel', { sev: r.defaultSeverity })}</span>
                                </div>
                                <p className="text-black dark:text-white font-semibold text-sm mt-1">{r.name}</p>
                                {r.description && (
                                    <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">{r.description}</p>
                                )}
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                                <button
                                    onClick={() => handleToggleActive(r)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                        r.isActive
                                            ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                                            : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                                    }`}
                                >
                                    {r.isActive ? t('sa.disableBtn') : t('sa.enableBtn')}
                                </button>
                                <button
                                    onClick={() => { setEditing(r); setShowCreate(false); }}
                                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] transition-colors"
                                    title={t('sa.editTooltip')}
                                >
                                    <i className="ph-bold ph-pencil" />
                                </button>
                                <button
                                    onClick={() => handleDelete(r)}
                                    className="p-1.5 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
                                    title={t('sa.deleteTooltip')}
                                >
                                    <i className="ph-bold ph-trash" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {(showCreate || editing) && (
                    <ComplaintCategoryFormModal
                        editing={editing}
                        onCancel={() => { setShowCreate(false); setEditing(null); }}
                        onSaved={(row) => {
                            setShowCreate(false);
                            setEditing(null);
                            // MVP build: merge the saved row into local state.
                            setRows((prev) => prev.some((r) => r.id === row.id)
                                ? prev.map((r) => (r.id === row.id ? row : r))
                                : [...prev, row]);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const ComplaintCategoryFormModal: React.FC<{
    editing: ComplaintCategoryRow | null;
    onCancel: () => void;
    onSaved: (row: ComplaintCategoryRow) => void;
}> = ({ editing, onCancel, onSaved }) => {
    const t = useT();
    const [categoryKey, setCategoryKey] = useState(editing?.categoryKey ?? '');
    const [name, setName] = useState(editing?.name ?? '');
    const [description, setDescription] = useState(editing?.description ?? '');
    const [icon, setIcon] = useState(editing?.icon ?? 'ph-warning');
    const [defaultSeverity, setDefaultSeverity] = useState<'low' | 'medium' | 'high' | 'urgent'>(editing?.defaultSeverity ?? 'medium');
    const [isActive, setIsActive] = useState(editing?.isActive ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editing && (!categoryKey.trim() || !name.trim())) {
            setErr(t('sa.categoryKeyAndNameRequired'));
            return;
        }
        setSaving(true);
        setErr(null);
        // MVP build: build the row locally and hand it up; no backend.
        const row: ComplaintCategoryRow = {
            id: editing?.id ?? `cc-${Date.now()}`,
            categoryKey: editing?.categoryKey ?? categoryKey.trim(),
            name: name.trim(),
            description: description.trim() || null,
            icon: icon.trim() || null,
            defaultSeverity,
            isActive,
        };
        onSaved(row);
        setSaving(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onCancel}
        >
            <motion.form
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className={`${glassCardStyle} max-w-md w-full p-6 space-y-4`}
                onClick={(e) => e.stopPropagation()}
                onSubmit={handleSave}
            >
                <h3 className="text-black dark:text-white text-lg font-bold">
                    {editing ? t('sa.editComplaintCategory') : t('sa.newComplaintCategory')}
                </h3>

                <div>
                    <label className={labelStyle}>{t('sa.categoryKeyLabel2')}</label>
                    <input
                        type="text"
                        value={categoryKey}
                        onChange={(e) => setCategoryKey(e.target.value)}
                        disabled={!!editing}
                        className={`${inputStyle} ${editing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        placeholder={t('sa.categoryKeyPlaceholder')}
                    />
                    <p className="text-[10px] text-gray-500 mt-1">{t('sa.typeKeyHint')}</p>
                </div>

                <div>
                    <label className={labelStyle}>{t('sa.displayNameLabel')}</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputStyle} placeholder={t('sa.displayNameCategoryPlaceholder')} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className={labelStyle}>{t('sa.iconPhosphorLabel')}</label>
                        <input type="text" value={icon} onChange={(e) => setIcon(e.target.value)} className={inputStyle} placeholder={t('sa.iconPhosphorPlaceholder')} />
                    </div>
                    <div>
                        <label className={labelStyle}>{t('sa.defaultSeveritySelectorLabel')}</label>
                        <GlassDropdown
                            value={defaultSeverity}
                            onChange={(v) => setDefaultSeverity(v as 'low' | 'medium' | 'high' | 'urgent')}
                            options={[
                                { value: 'low',    label: t('sa.severityLowOpt') },
                                { value: 'medium', label: t('sa.severityMediumOpt') },
                                { value: 'high',   label: t('sa.severityHighOpt') },
                                { value: 'urgent', label: t('sa.severityUrgentOpt') },
                            ]}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                </div>

                <div>
                    <label className={labelStyle}>{t('sa.descriptionLabel')}</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        className={`${inputStyle} resize-none`}
                        placeholder={t('sa.descriptionCategoryPlaceholder')}
                    />
                </div>

                <div
                    className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
                    onClick={() => setIsActive(!isActive)}
                >
                    <GlassCheckbox checked={isActive} onChange={setIsActive} size="sm" />
                    {t('sa.activeVisibleToStudents')}
                </div>

                {err && (
                    <p className="text-red-400 text-xs">{err}</p>
                )}

                <div className="flex gap-2 pt-2">
                    <button type="button" onClick={onCancel} className={`flex-1 ${secondaryBtn}`}>{t('sa.cancelBtn')}</button>
                    <button type="submit" disabled={saving} className={`flex-1 ${primaryBtn}`}>
                        {saving ? t('sa.savingDotsShort') : editing ? t('sa.saveChangesShort') : t('sa.createShort')}
                    </button>
                </div>
            </motion.form>
        </motion.div>
    );
};

// ─── Department Contacts Panel ───────────────────────────────────────────────

interface DepartmentContactRow {
    id: string;
    deptKey: string | null;
    department: string;
    title: string;
    name: string | null;
    role: string | null;
    email: string | null;
    phone: string | null;
    office: string | null;
    hours: string | null;
    location: string | null;
    description: string | null;
}

const BLANK_CONTACT: Omit<DepartmentContactRow, 'id'> = {
    deptKey: '', department: '', title: '', name: '', role: '',
    email: '', phone: '', office: '', hours: '', location: '', description: '',
};

const DepartmentContactsPanel: React.FC = () => {
    const t = useT();
    const [rows, setRows] = useState<DepartmentContactRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<DepartmentContactRow | null>(null);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        // MVP build: populate from static mock data, no backend.
        setLoading(true);
        setError(null);
        setRows(MOCK_CONTACTS);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleDelete = async (row: DepartmentContactRow) => {
        if (!window.confirm(t('sa.contactsDeletePrompt', { dept: row.department, title: row.title }))) return;
        // MVP build: optimistic local removal; no backend.
        setRows((prev) => prev.filter((r) => r.id !== row.id));
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center gap-2 flex-wrap">
                <div>
                    <h3 className="text-lg font-bold text-black dark:text-white">{t('sa.contactsPanelTitle')}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('sa.contactsPanelHint')}
                    </p>
                </div>
                <button onClick={() => setShowCreate(true)} className={primaryBtn}>
                    <i className="ph-bold ph-plus mr-1"></i> {t('sa.contactsAddBtn')}
                </button>
            </div>

            {error && (
                <div className="text-red-500 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">{error}</div>
            )}

            {loading ? (
                <div className="text-center py-10 text-gray-500">{t('sa.commonLoadingShort')}</div>
            ) : rows.length === 0 ? (
                <div className={`${glassCardStyle} p-6 text-center text-sm text-gray-500`}>
                    {t('sa.contactsEmptyTitle')}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rows.map((row) => (
                        <div key={row.id} className={`${glassCardStyle} p-4 flex flex-col gap-2`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-[#6A3FF4] uppercase tracking-wider">{row.department}</div>
                                    <div className="text-black dark:text-white font-bold text-base truncate">{row.title}</div>
                                    {row.name && <div className="text-gray-500 dark:text-gray-400 text-sm truncate">{row.name}{row.role ? ` · ${row.role}` : ''}</div>}
                                </div>
                                <div className="flex gap-1 flex-shrink-0">
                                    <button onClick={() => setEditing(row)} title="Edit" className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex items-center justify-center">
                                        <i className="ph-bold ph-pencil-simple text-sm"></i>
                                    </button>
                                    <button onClick={() => handleDelete(row)} title="Delete" className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 transition-colors flex items-center justify-center">
                                        <i className="ph-bold ph-trash text-sm"></i>
                                    </button>
                                </div>
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                                {row.email && <div><i className="ph-bold ph-envelope mr-1"></i>{row.email}</div>}
                                {row.phone && <div><i className="ph-bold ph-phone mr-1"></i>{row.phone}</div>}
                                {row.office && <div><i className="ph-bold ph-map-pin mr-1"></i>{row.office}</div>}
                                {row.hours && <div><i className="ph-bold ph-clock mr-1"></i>{row.hours}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AnimatePresence>
                {(showCreate || editing) && (
                    <ContactEditor
                        initial={editing || (BLANK_CONTACT as DepartmentContactRow)}
                        onClose={() => { setShowCreate(false); setEditing(null); }}
                        onSaved={(row) => {
                            setShowCreate(false);
                            setEditing(null);
                            // MVP build: merge the saved row into local state.
                            setRows((prev) => prev.some((r) => r.id === row.id)
                                ? prev.map((r) => (r.id === row.id ? row : r))
                                : [...prev, row]);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const ContactEditor: React.FC<{
    initial: DepartmentContactRow;
    onClose: () => void;
    onSaved: (row: DepartmentContactRow) => void;
}> = ({ initial, onClose, onSaved }) => {
    const t = useT();
    const isEdit = Boolean(initial.id);
    const [form, setForm] = useState({ ...initial });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const set = (k: keyof DepartmentContactRow, v: string) => setForm((p) => ({ ...p, [k]: v }));

    const handleSave = async () => {
        setSaving(true);
        setErr(null);
        // MVP build: build the row locally and hand it up; no backend.
        const row: DepartmentContactRow = { ...form, id: initial.id || `dc-${Date.now()}` };
        onSaved(row);
        setSaving(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className={`${glassCardStyle} p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto`}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-lg font-bold text-black dark:text-white mb-4">
                    {isEdit ? t('sa.contactsEditTitle') : t('sa.contactsNewTitle')}
                </h3>
                {err && <div className="text-red-500 text-sm mb-3">{err}</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className={labelStyle}>{t('sa.contactsField_department')} *</label><input className={inputStyle} value={form.department || ''} onChange={(e) => set('department', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_title')} *</label><input className={inputStyle} value={form.title || ''} onChange={(e) => set('title', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_name')}</label><input className={inputStyle} value={form.name || ''} onChange={(e) => set('name', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_role')}</label><input className={inputStyle} value={form.role || ''} onChange={(e) => set('role', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_email')}</label><input className={inputStyle} value={form.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_phone')}</label><input className={inputStyle} value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_office')}</label><input className={inputStyle} value={form.office || ''} onChange={(e) => set('office', e.target.value)} /></div>
                    <div><label className={labelStyle}>{t('sa.contactsField_hours')}</label><input className={inputStyle} value={form.hours || ''} onChange={(e) => set('hours', e.target.value)} /></div>
                    <div className="sm:col-span-2"><label className={labelStyle}>{t('sa.contactsField_location')}</label><input className={inputStyle} value={form.location || ''} onChange={(e) => set('location', e.target.value)} /></div>
                    <div className="sm:col-span-2"><label className={labelStyle}>{t('sa.contactsField_description')}</label><textarea rows={2} className={inputStyle} value={form.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
                </div>
                <div className="flex gap-2 justify-end mt-5">
                    <button onClick={onClose} className={secondaryBtn}>{t('sa.commonCancel')}</button>
                    <button onClick={handleSave} disabled={saving || !form.department || !form.title} className={primaryBtn}>
                        {saving ? t('sa.commonSavingShort') : isEdit ? t('sa.commonSaveChanges') : t('sa.commonCreate')}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

// ─── Quick Links Panel ───────────────────────────────────────────────────────

interface QuickLink { label: string; url: string; icon?: string }

const QuickLinksPanel: React.FC = () => {
    const t = useT();
    const [links, setLinks] = useState<QuickLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);

    const load = useCallback(async () => {
        // MVP build: populate from static mock data, no backend.
        setLoading(true);
        setLinks(MOCK_QUICK_LINKS);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const updateLink = (idx: number, patch: Partial<QuickLink>) => {
        setLinks((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    };
    const removeLink = (idx: number) => setLinks((prev) => prev.filter((_, i) => i !== idx));
    const addLink = () => setLinks((prev) => [...prev, { label: '', url: '', icon: 'ph-link' }]);

    const handleSave = async () => {
        setSaving(true);
        setErr(null);
        // MVP build: clean + persist locally; no backend.
        const cleaned = links
            .map((l) => ({ label: l.label.trim(), url: l.url.trim(), icon: (l.icon || '').trim() || undefined }))
            .filter((l) => l.label && l.url);
        setLinks(cleaned);
        setFlash(t('sa.quickLinksFlashSaved'));
        setTimeout(() => setFlash(null), 2000);
        setSaving(false);
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center gap-2 flex-wrap">
                <div>
                    <h3 className="text-lg font-bold text-black dark:text-white">{t('sa.quickLinksPanelTitle')}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('sa.quickLinksPanelHint')}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={addLink} className={secondaryBtn}>
                        <i className="ph-bold ph-plus mr-1"></i> {t('sa.quickLinksAddBtn')}
                    </button>
                    <button onClick={handleSave} disabled={saving} className={primaryBtn}>
                        {saving ? t('sa.commonSavingShort') : t('sa.quickLinksSaveBtn')}
                    </button>
                </div>
            </div>

            {err && <div className="text-red-500 text-sm bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">{err}</div>}
            {flash && <div className="text-green-500 text-sm bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-2.5">{flash}</div>}

            {loading ? (
                <div className="text-center py-10 text-gray-500">{t('sa.commonLoadingShort')}</div>
            ) : links.length === 0 ? (
                <div className={`${glassCardStyle} p-6 text-center text-sm text-gray-500`}>
                    {t('sa.quickLinksEmptyTitle')}
                </div>
            ) : (
                <div className="space-y-2">
                    {links.map((link, idx) => (
                        <div key={idx} className={`${glassCardStyle} p-3 grid grid-cols-1 md:grid-cols-[1fr_2fr_180px_auto] gap-2 items-end`}>
                            <div>
                                <label className={labelStyle}>{t('sa.quickLinksField_label')}</label>
                                <input className={inputStyle} placeholder="e.g. Library" value={link.label} onChange={(e) => updateLink(idx, { label: e.target.value })} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.quickLinksField_url')}</label>
                                <input className={inputStyle} placeholder="https://…" value={link.url} onChange={(e) => updateLink(idx, { url: e.target.value })} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.quickLinksField_icon')}</label>
                                <input className={inputStyle} placeholder="ph-link" value={link.icon || ''} onChange={(e) => updateLink(idx, { icon: e.target.value })} />
                            </div>
                            <button onClick={() => removeLink(idx)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 transition-colors flex items-center justify-center self-end">
                                <i className="ph-bold ph-trash text-sm"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SACategories;
