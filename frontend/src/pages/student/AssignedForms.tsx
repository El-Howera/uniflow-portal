/**
 * AssignedForms — student-facing form inbox. Renders the same grid as the
 * staff `FormsList` but read-only. Each card surfaces either a "Respond"
 * action or a "View response" action depending on `hasResponded`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { apiFetch } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface StudentFormRow {
    id: string;
    title: string;
    description: string | null;
    bannerImage: string | null;
    startDate: string;
    dueDate: string;
    isPublished: boolean;
    questionCount: number;
    hasResponded?: boolean;
    createdBy: { firstName: string; lastName: string } | null;
}

function fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isPastDue(iso: string): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t < Date.now();
}

const AssignedForms: React.FC = () => {
    const navigate = useNavigate();
    const t = useT();
    const [forms, setForms] = useState<StudentFormRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const resp = await apiFetch(`${API_URLS.courseContent()}/api/forms`);
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                setError((data as { error?: string }).error || t('formsPage.errLoad'));
                setForms([]);
                return;
            }
            setForms(Array.isArray(data?.forms) ? data.forms : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('formsPage.errNetwork'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="space-y-6 pb-12">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-black dark:text-white">
                    {t('formsPage.title')}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {t('formsPage.subtitle')}
                </p>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                    <i className="ph-bold ph-x-circle"></i> {error}
                </div>
            )}

            {loading ? (
                <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                    {t('formsPage.loading')}
                </div>
            ) : forms.length === 0 ? (
                <div className={`${glassCardStyle} p-12 text-center`}>
                    <i className="ph-bold ph-clipboard-text text-5xl text-gray-400 mb-3"></i>
                    <p className="text-gray-500 dark:text-gray-400">
                        {t('formsPage.empty')}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {forms.map((f) => {
                        const past = isPastDue(f.dueDate);
                        return (
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
                                        {f.hasResponded ? (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-green-500/15 text-green-500 border border-green-500/30">
                                                {t('formsPage.pillSubmitted')}
                                            </span>
                                        ) : past ? (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-red-500/15 text-red-500 border border-red-500/30">
                                                {t('formsPage.pillClosed')}
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                                {t('formsPage.pillOpen')}
                                            </span>
                                        )}
                                    </div>
                                    {f.description && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 mb-3">
                                            {f.description}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 mb-4">
                                        <span>
                                            <i className="ph-bold ph-calendar mr-1"></i>
                                            {t('formsPage.dueLabel', { date: fmtDate(f.dueDate) })}
                                        </span>
                                        <span>
                                            <i className="ph-bold ph-list-numbers mr-1"></i>
                                            {f.questionCount === 1
                                                ? t('formsPage.questionCountOne', { n: f.questionCount })
                                                : t('formsPage.questionCountMany', { n: f.questionCount })}
                                        </span>
                                    </div>
                                    {f.createdBy && (
                                        <p className="text-xs text-gray-400 mb-3">
                                            {t('formsPage.fromLabel', {
                                                firstName: f.createdBy.firstName,
                                                lastName: f.createdBy.lastName,
                                            })}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/student/forms/${f.id}`)}
                                        disabled={past && !f.hasResponded}
                                        className={`mt-auto px-4 py-2 rounded-lg text-sm font-bold ${
                                            f.hasResponded
                                                ? 'bg-white/5 border border-white/10 text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40'
                                                : 'bg-[#6A3FF4] hover:bg-[#5A32D4] text-white disabled:opacity-50 disabled:cursor-not-allowed'
                                        }`}
                                    >
                                        {f.hasResponded ? t('formsPage.viewResponse') : t('formsPage.respond')}
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default AssignedForms;
