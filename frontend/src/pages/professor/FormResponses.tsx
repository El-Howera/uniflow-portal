/**
 * FormResponses — staff-facing response browser for a single form.
 * Used by professor / ta / sa / admin via thin re-export wrappers.
 * Reads `localStorage.currentUserRole` to compute the back-navigation prefix.
 *
 * Renders a table of respondents and opens a modal with the full
 * question-by-question answer set on demand. CSV export is also exposed
 * here (shares the helper with FormsList).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { apiFetch, openAuthedFile } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface ListResponseRow {
    id: string;
    respondent: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    submittedAt: string;
    updatedAt: string;
    answerCount: number;
}

interface ResponseAnswer {
    id: string;
    questionId: string;
    textValue: string | null;
    choiceValues: string[];
    fileUrl: string | null;
    question: {
        id: string;
        label: string;
        kind: string;
        options: string[];
    };
}

interface ResponseDetail {
    id: string;
    submittedAt: string;
    updatedAt: string;
    respondent: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    answers: ResponseAnswer[];
}

interface FormInfo {
    id: string;
    title: string;
    description: string | null;
}

function fmtDateTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function renderAnswerValue(a: ResponseAnswer, attachmentLabel: string, noAnswerLabel: string): React.ReactNode {
    if (a.fileUrl) {
        const url = a.fileUrl.startsWith('http')
            ? a.fileUrl
            : `${API_URLS.courseContent()}${a.fileUrl}`;
        return (
            <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-[#6A3FF4] hover:text-[#5A32D4] underline text-sm break-all"
            >
                <i className="ph-bold ph-paperclip mr-1"></i>
                {a.fileUrl.split('/').pop() || attachmentLabel}
            </a>
        );
    }
    if (a.choiceValues && a.choiceValues.length > 0) {
        return (
            <div className="flex flex-wrap gap-1.5">
                {a.choiceValues.map((c, i) => (
                    <span
                        key={i}
                        className="px-2 py-0.5 bg-[#6A3FF4]/15 border border-[#6A3FF4]/30 text-[#6A3FF4] rounded-full text-xs font-medium"
                    >
                        {c}
                    </span>
                ))}
            </div>
        );
    }
    if (a.textValue) {
        return (
            <p className="text-sm text-black dark:text-white whitespace-pre-wrap break-words">
                {a.textValue}
            </p>
        );
    }
    return <span className="text-xs text-gray-500 italic">{noAnswerLabel}</span>;
}

const FormResponses: React.FC = () => {
    const navigate = useNavigate();
    const t = useT();
    const { id: formId } = useParams<{ id: string }>();
    const role = (localStorage.getItem('currentUserRole') || 'professor').toLowerCase();
    const rolePrefix = `/${role}`;

    const [form, setForm] = useState<FormInfo | null>(null);
    const [responses, setResponses] = useState<ListResponseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [openDetail, setOpenDetail] = useState<ResponseDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const load = useCallback(async () => {
        if (!formId) return;
        setLoading(true);
        setError('');
        try {
            const [formResp, listResp] = await Promise.all([
                apiFetch(`${API_URLS.courseContent()}/api/forms/${formId}`),
                apiFetch(`${API_URLS.courseContent()}/api/forms/${formId}/responses`),
            ]);
            const formData = await formResp.json().catch(() => ({}));
            const listData = await listResp.json().catch(() => ({}));
            if (!formResp.ok) {
                setError((formData as { error?: string }).error || t('professor.couldNotLoadForm'));
                return;
            }
            if (!listResp.ok) {
                setError((listData as { error?: string }).error || t('professor.couldNotLoadResponses'));
                return;
            }
            const f = (formData as { form?: FormInfo }).form;
            if (f) setForm({ id: f.id, title: f.title, description: f.description ?? null });
            setResponses(Array.isArray(listData?.responses) ? listData.responses : []);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('professor.networkErrShort'));
        } finally {
            setLoading(false);
        }
    }, [formId, t]);

    useEffect(() => {
        load();
    }, [load]);

    const openResponse = useCallback(
        async (userId: string) => {
            if (!formId) return;
            setDetailLoading(true);
            try {
                const resp = await apiFetch(
                    `${API_URLS.courseContent()}/api/forms/${formId}/responses/${userId}`,
                );
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    setError(
                        (data as { error?: string }).error || t('professor.couldNotLoadResponse'),
                    );
                    return;
                }
                setOpenDetail((data as { response: ResponseDetail }).response);
            } catch (e) {
                setError(e instanceof Error ? e.message : t('professor.networkErrShort'));
            } finally {
                setDetailLoading(false);
            }
        },
        [formId, t],
    );

    const handleExport = useCallback(async () => {
        if (!formId || !form) return;
        const safe = form.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40) || 'form';
        await openAuthedFile(
            `${API_URLS.courseContent()}/api/forms/${formId}/export.csv`,
            `${safe}_responses.csv`,
        );
    }, [formId, form]);

    return (
        <div className="space-y-6 pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <button
                        type="button"
                        onClick={() => navigate(`${rolePrefix}/forms`)}
                        className="text-xs font-bold text-gray-500 hover:text-[#6A3FF4] mb-2"
                    >
                        <i className="ph-bold ph-arrow-left mr-1"></i> {t('professor.backToFormsLink')}
                    </button>
                    <h1 className="text-2xl md:text-3xl font-bold text-black dark:text-white">
                        {form?.title || t('professor.responsesDefault')}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('professor.responsesSubmittedCount', { n: responses.length, suffix: responses.length === 1 ? '' : 's' })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleExport}
                    disabled={responses.length === 0}
                    className="px-4 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                >
                    <i className="ph-bold ph-download-simple"></i> {t('professor.exportCsvBtn')}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                    <i className="ph-bold ph-x-circle"></i> {error}
                </div>
            )}

            {loading ? (
                <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                    {t('professor.loadingResponses')}
                </div>
            ) : responses.length === 0 ? (
                <div className={`${glassCardStyle} p-12 text-center`}>
                    <i className="ph-bold ph-chat-circle-text text-5xl text-gray-400 mb-3"></i>
                    <p className="text-gray-500 dark:text-gray-400">
                        {t('professor.noResponsesShareForm')}
                    </p>
                </div>
            ) : (
                <div className={`${glassCardStyle} overflow-hidden`}>
                    <table className="w-full text-sm">
                        <thead className="bg-white/5 dark:bg-black/20">
                            <tr className="text-left text-gray-500 dark:text-gray-400">
                                <th className="px-4 py-3 font-bold">{t('professor.respondent')}</th>
                                <th className="px-4 py-3 font-bold hidden md:table-cell">{t('professor.emailCol')}</th>
                                <th className="px-4 py-3 font-bold">{t('professor.submittedCol')}</th>
                                <th className="px-4 py-3 font-bold text-center">{t('professor.answersCol')}</th>
                                <th className="px-4 py-3 font-bold text-right">{t('professor.actionCol')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {responses.map((r) => {
                                const name = r.respondent
                                    ? `${r.respondent.firstName} ${r.respondent.lastName}`.trim()
                                    : '—';
                                return (
                                    <tr key={r.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-4 py-3 font-medium text-black dark:text-white">
                                            {name}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                                            {r.respondent?.email || '—'}
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                                            {fmtDateTime(r.submittedAt)}
                                        </td>
                                        <td className="px-4 py-3 text-center text-gray-500 dark:text-gray-400">
                                            {r.answerCount}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {r.respondent && (
                                                <button
                                                    type="button"
                                                    onClick={() => openResponse(r.respondent!.id)}
                                                    className="px-3 py-1.5 rounded-lg bg-[#6A3FF4]/15 border border-[#6A3FF4]/40 text-xs font-bold text-[#6A3FF4] hover:bg-[#6A3FF4]/25"
                                                >
                                                    {t('professor.viewBtn')}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Response detail modal */}
            {openDetail && (
                <div
                    className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setOpenDetail(null)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => e.stopPropagation()}
                        className={`${glassCardStyle} max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-4`}
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-black dark:text-white">
                                    {openDetail.respondent
                                        ? `${openDetail.respondent.firstName} ${openDetail.respondent.lastName}`
                                        : t('professor.responseShort')}
                                </h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {openDetail.respondent?.email} {t('professor.submittedAtDot', { date: fmtDateTime(openDetail.submittedAt) })}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpenDetail(null)}
                                className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center"
                            >
                                <i className="ph-bold ph-x text-gray-400"></i>
                            </button>
                        </div>
                        <div className="space-y-4">
                            {openDetail.answers.map((a) => (
                                <div
                                    key={a.id}
                                    className="bg-white/5 border border-white/10 rounded-xl p-4"
                                >
                                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">
                                        {a.question.label}
                                    </p>
                                    {renderAnswerValue(a, t('professor.attachmentLabel'), t('professor.noAnswerItalic'))}
                                </div>
                            ))}
                            {openDetail.answers.length === 0 && (
                                <p className="text-sm text-gray-500 italic">{t('professor.noAnswersInResponse')}</p>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}

            {detailLoading && (
                <p className="text-xs text-gray-500 italic">{t('professor.loadingResponse')}</p>
            )}
        </div>
    );
};

export default FormResponses;
