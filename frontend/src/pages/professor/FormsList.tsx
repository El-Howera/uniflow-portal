/**
 * FormsList — staff-facing index of forms. Used by professor / ta / sa / admin
 * via thin re-export wrappers. Reads `localStorage.currentUserRole` to compute
 * the role-prefixed navigation paths; same component for every staff role.
 *
 * Each card: title, description (truncated), banner image, due date,
 * response count, published badge, Edit / Responses / Export CSV / Delete.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { apiFetch, openAuthedFile } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface FormRow {
    id: string;
    title: string;
    description: string | null;
    bannerImage: string | null;
    startDate: string;
    dueDate: string;
    isPublished: boolean;
    createdBy: { firstName: string; lastName: string } | null;
    responseCount: number;
    questionCount: number;
}

function fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const FormsList: React.FC = () => {
    const navigate = useNavigate();
    const t = useT();
    const role = (localStorage.getItem('currentUserRole') || 'professor').toLowerCase();
    const rolePrefix = `/${role}`;

    const [forms, setForms] = useState<FormRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const resp = await apiFetch(`${API_URLS.courseContent()}/api/forms`);
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                setError((data as { error?: string }).error || t('professor.couldNotLoadForms'));
                setForms([]);
                return;
            }
            setForms(Array.isArray(data?.forms) ? data.forms : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('professor.networkErrShort'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        load();
    }, [load]);

    const handleDelete = useCallback(
        async (id: string) => {
            try {
                const resp = await apiFetch(`${API_URLS.courseContent()}/api/forms/${id}`, {
                    method: 'DELETE',
                });
                if (!resp.ok) {
                    const body = await resp.json().catch(() => ({}));
                    setError((body as { error?: string }).error || t('professor.couldNotDeleteForm'));
                    return;
                }
                setConfirmingDelete(null);
                load();
            } catch (e) {
                setError(e instanceof Error ? e.message : t('professor.networkErrShort'));
            }
        },
        [load, t],
    );

    const handleExport = useCallback(async (id: string, title: string) => {
        const safe = title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40) || 'form';
        await openAuthedFile(
            `${API_URLS.courseContent()}/api/forms/${id}/export.csv`,
            `${safe}_responses.csv`,
        );
    }, []);

    return (
        <div className="space-y-6 pb-12">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-black dark:text-white">
                        {t('professor.formsPageTitle')}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('professor.formsPageSubtitle')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`${rolePrefix}/forms/composer`)}
                    className="px-4 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold flex items-center gap-2"
                >
                    <i className="ph-bold ph-plus"></i> {t('professor.newFormBtn')}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                    <i className="ph-bold ph-x-circle"></i> {error}
                </div>
            )}

            {loading ? (
                <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                    {t('professor.loadingForms')}
                </div>
            ) : forms.length === 0 ? (
                <div className={`${glassCardStyle} p-12 text-center`}>
                    <i className="ph-bold ph-clipboard-text text-5xl text-gray-400 mb-3"></i>
                    <p className="text-gray-500 dark:text-gray-400 mb-4">
                        {t('professor.noFormsYet')}
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate(`${rolePrefix}/forms/composer`)}
                        className="px-4 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold"
                    >
                        {t('professor.createFirstForm')}
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {forms.map((f) => (
                        <motion.div
                            key={f.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`${glassCardStyle} overflow-hidden flex flex-col`}
                        >
                            {f.bannerImage && (
                                <img
                                    src={f.bannerImage}
                                    alt={f.title}
                                    className="w-full h-32 object-cover"
                                />
                            )}
                            <div className="p-5 flex-1 flex flex-col">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <h2 className="font-bold text-black dark:text-white text-base leading-tight line-clamp-2">
                                        {f.title}
                                    </h2>
                                    <span
                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
                                            f.isPublished
                                                ? 'bg-green-500/15 text-green-500 border border-green-500/30'
                                                : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                                        }`}
                                    >
                                        {f.isPublished ? t('professor.publishedPill') : t('professor.draftPill')}
                                    </span>
                                </div>
                                {f.description && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-3">
                                        {f.description}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 mb-4">
                                    <span>
                                        <i className="ph-bold ph-calendar mr-1"></i>
                                        {t('professor.dueShortFormat', { date: fmtDate(f.dueDate) })}
                                    </span>
                                    <span>
                                        <i className="ph-bold ph-chat-circle-text mr-1"></i>
                                        {f.responseCount === 1
                                            ? t('professor.responseCountSingular', { n: f.responseCount })
                                            : t('professor.responseCountPlural', { n: f.responseCount })}
                                    </span>
                                    <span>
                                        <i className="ph-bold ph-list-numbers mr-1"></i>
                                        {f.questionCount === 1
                                            ? t('professor.questionCountSingular', { n: f.questionCount })
                                            : t('professor.questionCountPlural', { n: f.questionCount })}
                                    </span>
                                </div>
                                <div className="mt-auto pt-3 border-t border-white/10 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => navigate(`${rolePrefix}/forms/composer/${f.id}`)}
                                        className="flex-1 min-w-[80px] px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40"
                                    >
                                        <i className="ph-bold ph-pencil-simple-line mr-1"></i> {t('professor.editFormShort')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            navigate(`${rolePrefix}/forms/${f.id}/responses`)
                                        }
                                        className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg bg-[#6A3FF4]/15 border border-[#6A3FF4]/40 text-xs font-bold text-[#6A3FF4] hover:bg-[#6A3FF4]/25"
                                    >
                                        <i className="ph-bold ph-eye mr-1"></i> {t('professor.responsesBtn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleExport(f.id, f.title)}
                                        title={t('professor.exportCsvTitle')}
                                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40"
                                    >
                                        <i className="ph-bold ph-download-simple"></i>
                                    </button>
                                    {confirmingDelete === f.id ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(f.id)}
                                                className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-xs font-bold text-red-400 hover:bg-red-500/30"
                                            >
                                                {t('professor.confirmShort')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmingDelete(null)}
                                                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-gray-500 dark:text-gray-300"
                                            >
                                                {t('professor.cancelBtn')}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmingDelete(f.id)}
                                            title={t('professor.deleteFormTitle')}
                                            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-bold text-red-400 hover:bg-red-500/20"
                                        >
                                            <i className="ph-bold ph-trash"></i>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FormsList;
