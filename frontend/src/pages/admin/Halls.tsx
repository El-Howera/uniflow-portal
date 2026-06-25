// Halls — admin CRUD page for the BssidLocation table (renamed mental model).
// Each hall ties a physical room to its router BSSID + a seat capacity.
// CourseSection.hallId now references this table; new sections require one.

import React, { useState, useEffect, useCallback } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle = 'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors';
const labelStyle = 'block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

interface Hall {
    id: string;
    name: string;
    building?: string | null;
    floor?: string | null;
    room?: string | null;
    bssid: string;
    capacity: number;
    isActive: boolean;
    createdAt: string;
}

const empty = (): Omit<Hall, 'id' | 'createdAt'> => ({
    name: '',
    building: '',
    floor: '',
    room: '',
    bssid: '',
    capacity: 30,
    isActive: true,
});

// Preview mock — realistic FCDS lecture halls + labs tied to router BSSIDs.
const MOCK_HALLS: Hall[] = [
    { id: 'h-a101', name: 'Hall A101', building: 'Main Building', floor: '1', room: 'A101', bssid: '00:1A:2B:3C:4D:5E', capacity: 200, isActive: true, createdAt: '2026-01-10T08:00:00.000Z' },
    { id: 'h-a205', name: 'Hall A205', building: 'Main Building', floor: '2', room: 'A205', bssid: '00:1A:2B:3C:4D:6F', capacity: 120, isActive: true, createdAt: '2026-01-10T08:00:00.000Z' },
    { id: 'h-lab1', name: 'Computer Lab 1', building: 'IT Block', floor: '1', room: 'L1', bssid: '00:1A:2B:3C:4D:7A', capacity: 40, isActive: true, createdAt: '2026-01-12T08:00:00.000Z' },
    { id: 'h-lab2', name: 'Computer Lab 2', building: 'IT Block', floor: '1', room: 'L2', bssid: '00:1A:2B:3C:4D:7B', capacity: 40, isActive: true, createdAt: '2026-01-12T08:00:00.000Z' },
    { id: 'h-b310', name: 'Hall B310', building: 'Science Building', floor: '3', room: 'B310', bssid: '00:1A:2B:3C:4D:8C', capacity: 80, isActive: false, createdAt: '2026-02-01T08:00:00.000Z' },
];

const BSSID_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

const Halls: React.FC = () => {
    const t = useT();
    const [halls, setHalls] = useState<Hall[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Hall | null>(null);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState(empty());
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const load = useCallback(() => {
        // Preview mode — load static halls, no backend.
        setLoading(true);
        setError(null);
        setHalls(MOCK_HALLS);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => {
        setForm(empty());
        setEditing(null);
        setFormError(null);
        setCreating(true);
    };

    const openEdit = (h: Hall) => {
        setForm({
            name: h.name,
            building: h.building || '',
            floor: h.floor || '',
            room: h.room || '',
            bssid: h.bssid,
            capacity: h.capacity,
            isActive: h.isActive,
        });
        setEditing(h);
        setCreating(false);
        setFormError(null);
    };

    const close = () => {
        setEditing(null);
        setCreating(false);
        setFormError(null);
    };

    const submit = async () => {
        setFormError(null);
        if (!form.name.trim()) return setFormError(t('admin.hallsValNameRequired'));
        if (!BSSID_RE.test(form.bssid.trim())) {
            return setFormError(t('admin.hallsValBssid'));
        }
        if (!Number.isInteger(form.capacity) || form.capacity < 1) {
            return setFormError(t('admin.hallsValCapacity'));
        }

        // Preview mode — persist into local state only. No network.
        setSubmitting(true);
        const payload = {
            name: form.name.trim(),
            building: form.building?.trim() || null,
            floor: form.floor?.trim() || null,
            room: form.room?.trim() || null,
            bssid: form.bssid.trim(),
            capacity: form.capacity,
            isActive: form.isActive,
        };
        if (editing) {
            const targetId = editing.id;
            setHalls((prev) => prev.map((h) => (h.id === targetId ? { ...h, ...payload } : h)));
        } else {
            const created: Hall = {
                id: `h-${Date.now()}`,
                createdAt: new Date().toISOString(),
                ...payload,
            };
            setHalls((prev) => [...prev, created]);
        }
        setSubmitting(false);
        close();
    };

    const remove = async (h: Hall) => {
        if (!window.confirm(t('admin.hallsConfirmDelete', { name: h.name }))) return;
        // Preview mode — remove from local state only.
        setHalls((prev) => prev.filter((x) => x.id !== h.id));
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex justify-between items-end">
                    <div>
                        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('admin.hallsTitle')}</h1>
                        <p className="text-black dark:text-gray-300 text-sm">
                            {t('admin.hallsLongSubtitle')}
                        </p>
                    </div>
                    <button
                        onClick={openCreate}
                        className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2"
                    >
                        <i className="ph-bold ph-plus" /> {t('admin.hallsAddBtn')}
                    </button>
                </div>
            </AnimateOnView>

            {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                    {error}
                </div>
            )}

            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.hallName')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.hallsBuildingRoom')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.hallBssid')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.hallCapacity')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.courseStatus')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('admin.courseActions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} className="p-12 text-center animate-pulse">{t('admin.hallsLoading')}</td></tr>
                            ) : halls.length === 0 ? (
                                <tr><td colSpan={6} className="p-12 text-center text-gray-500 italic">{t('admin.hallsNoneYet')}</td></tr>
                            ) : halls.map((h) => (
                                <tr key={h.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="p-4 text-sm font-bold text-black dark:text-white">{h.name}</td>
                                    <td className="p-4 text-sm text-gray-700 dark:text-gray-300">
                                        {[h.building, h.floor && t('admin.hallsFloorPrefix', { floor: h.floor }), h.room].filter(Boolean).join(' · ') || <span className="text-gray-500">—</span>}
                                    </td>
                                    <td className="p-4 text-xs font-mono text-gray-700 dark:text-gray-300">{h.bssid}</td>
                                    <td className="p-4 text-sm font-bold text-[#7B5AFF]">{h.capacity}</td>
                                    <td className="p-4">
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${
                                            h.isActive
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-gray-500/20 text-gray-400'
                                        }`}>
                                            {h.isActive ? t('admin.hallsStatusActive') : t('admin.hallsStatusInactive')}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => openEdit(h)}
                                                className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 text-xs font-bold hover:bg-blue-500/30 transition-all"
                                            >
                                                {t('admin.hallsEditBtn')}
                                            </button>
                                            <button
                                                onClick={() => remove(h)}
                                                className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/30 transition-all"
                                            >
                                                {t('admin.hallsDeleteBtn')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {(creating || editing) && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
                    <div
                        className={`${glassCardStyle} w-full max-w-lg p-6 space-y-4`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-lg font-bold text-black dark:text-white">
                            {editing ? t('admin.hallsModalEditTitle', { name: editing.name }) : t('admin.hallsModalAddTitle')}
                        </h2>
                        {formError && (
                            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
                                {formError}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className={labelStyle}>{t('admin.hallsLblName')}</label>
                                <input className={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('admin.hallsPhName')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.hallsLblBuilding')}</label>
                                <input className={inputStyle} value={form.building || ''} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder={t('admin.hallsPhBuilding')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.hallsLblFloor')}</label>
                                <input className={inputStyle} value={form.floor || ''} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder={t('admin.hallsPhFloor')} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelStyle}>{t('admin.hallsLblRoom')}</label>
                                <input className={inputStyle} value={form.room || ''} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder={t('admin.hallsPhRoom')} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelStyle}>{t('admin.hallsLblBssid')}</label>
                                <input
                                    className={`${inputStyle} font-mono`}
                                    value={form.bssid}
                                    onChange={(e) => setForm({ ...form, bssid: e.target.value })}
                                    placeholder={t('admin.hallsPhBssid')}
                                />
                                <p className="text-[10px] text-gray-500 mt-1">{t('admin.hallsBssidHint')}</p>
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.hallsLblCapacity')}</label>
                                <input
                                    className={inputStyle}
                                    type="number"
                                    min={1}
                                    value={form.capacity}
                                    onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value, 10) || 0 })}
                                />
                            </div>
                            <div className="flex items-end">
                                <div
                                    className="flex items-center gap-2 text-sm text-black dark:text-white pb-2 cursor-pointer"
                                    onClick={() => setForm({ ...form, isActive: !form.isActive })}
                                >
                                    <GlassCheckbox
                                        checked={form.isActive}
                                        onChange={(v) => setForm({ ...form, isActive: v })}
                                        size="sm"
                                    />
                                    {t('admin.hallsLblActive')}
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={close} className="px-4 py-2 rounded-xl text-sm bg-white/10 text-gray-300 hover:bg-white/15">
                                {t('admin.hallsCancel')}
                            </button>
                            <button
                                onClick={submit}
                                disabled={submitting}
                                className="px-4 py-2 rounded-xl text-sm bg-[#6A3FF4] text-white hover:bg-[#5A32D4] disabled:opacity-50"
                            >
                                {submitting ? t('admin.hallsSaving') : editing ? t('admin.hallsSaveBtn') : t('admin.hallsCreateBtn')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Halls;
