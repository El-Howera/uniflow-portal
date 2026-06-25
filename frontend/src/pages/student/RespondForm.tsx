/**
 * RespondForm — student-facing form response page. Renders each question
 * with the appropriate input control (text / textarea / dropdown / radio /
 * checkboxes / date / file upload) and POSTs answers to
 * `/api/forms/:id/responses`. Pre-fills from the student's prior response
 * when present.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_URLS } from '@shared/config';
import { apiFetch, authHeaders } from '../../utils/api';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { renderMarkdown } from '../../components/MarkdownToolbar';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

type QuestionKind =
    | 'text'
    | 'textarea'
    | 'multiple-choice'
    | 'checkboxes'
    | 'dropdown'
    | 'date'
    | 'image-upload'
    | 'file-upload';

interface FormQuestion {
    id: string;
    kind: QuestionKind;
    label: string;
    required: boolean;
    options: string[];
    maxLength: number | null;
    imageUrl: string | null;
    order: number;
}

interface FormDetail {
    id: string;
    title: string;
    description: string | null;
    bannerImage: string | null;
    startDate: string;
    dueDate: string;
    isPublished: boolean;
    questions: FormQuestion[];
    hasResponded?: boolean;
}

interface AnswerState {
    questionId: string;
    textValue: string;
    choiceValues: string[];
    fileUrl: string | null;
    fileName: string | null;
}

function blankAnswer(qid: string): AnswerState {
    return {
        questionId: qid,
        textValue: '',
        choiceValues: [],
        fileUrl: null,
        fileName: null,
    };
}

const RespondForm: React.FC = () => {
    const navigate = useNavigate();
    const { id: formId } = useParams<{ id: string }>();
    const t = useT();

    const [form, setForm] = useState<FormDetail | null>(null);
    const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [readOnly, setReadOnly] = useState(false);

    const userId = localStorage.getItem('currentUserId') || '';

    const loadFormAndResponse = useCallback(async () => {
        if (!formId) return;
        setLoading(true);
        setError('');
        try {
            const fResp = await apiFetch(`${API_URLS.courseContent()}/api/forms/${formId}`);
            const fData = await fResp.json().catch(() => ({}));
            if (!fResp.ok) {
                setError((fData as { error?: string }).error || t('respondFormPage.errLoad'));
                return;
            }
            const f: FormDetail = (fData as { form: FormDetail }).form;
            setForm(f);

            // Seed empty answer state per question.
            const seed: Record<string, AnswerState> = {};
            for (const q of f.questions) seed[q.id] = blankAnswer(q.id);

            // If the student already responded, hydrate the saved answers and
            // flip into view-only mode.
            if (f.hasResponded && userId) {
                const rResp = await apiFetch(
                    `${API_URLS.courseContent()}/api/forms/${formId}/responses/${userId}`,
                );
                const rData = await rResp.json().catch(() => ({}));
                if (rResp.ok) {
                    const resp = (rData as {
                        response: {
                            answers: {
                                questionId: string;
                                textValue: string | null;
                                choiceValues: string[];
                                fileUrl: string | null;
                            }[];
                        };
                    }).response;
                    for (const a of resp.answers) {
                        seed[a.questionId] = {
                            questionId: a.questionId,
                            textValue: a.textValue || '',
                            choiceValues: Array.isArray(a.choiceValues) ? a.choiceValues : [],
                            fileUrl: a.fileUrl,
                            fileName: a.fileUrl ? a.fileUrl.split('/').pop() || null : null,
                        };
                    }
                }
                setReadOnly(true);
            }
            setAnswers(seed);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('respondFormPage.errNetwork'));
        } finally {
            setLoading(false);
        }
    }, [formId, userId, t]);

    useEffect(() => {
        loadFormAndResponse();
    }, [loadFormAndResponse]);

    const updateAnswer = useCallback((qid: string, patch: Partial<AnswerState>) => {
        setAnswers((prev) => ({
            ...prev,
            [qid]: { ...prev[qid], ...patch },
        }));
    }, []);

    const toggleChoice = useCallback((qid: string, value: string) => {
        setAnswers((prev) => {
            const cur = prev[qid] ?? blankAnswer(qid);
            const next = cur.choiceValues.includes(value)
                ? cur.choiceValues.filter((v) => v !== value)
                : [...cur.choiceValues, value];
            return { ...prev, [qid]: { ...cur, choiceValues: next } };
        });
    }, []);

    const uploadFile = useCallback(
        async (qid: string, file: File) => {
            if (!formId) return;
            setError('');
            const fd = new FormData();
            fd.append('file', file);
            try {
                const resp = await fetch(
                    `${API_URLS.courseContent()}/api/forms/${formId}/upload`,
                    {
                        method: 'POST',
                        credentials: 'include',
                        headers: authHeaders() as Record<string, string>,
                        body: fd,
                    },
                );
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    setError((data as { error?: string }).error || t('respondFormPage.errUpload'));
                    return;
                }
                updateAnswer(qid, {
                    fileUrl: (data as { url: string }).url,
                    fileName: (data as { name?: string }).name || file.name,
                });
            } catch (e) {
                setError(e instanceof Error ? e.message : t('respondFormPage.errUpload'));
            }
        },
        [formId, updateAnswer, t],
    );

    const validate = useCallback((): string | null => {
        if (!form) return null;
        for (const q of form.questions) {
            if (!q.required) continue;
            const a = answers[q.id];
            if (!a) return t('respondFormPage.requiredField', { label: q.label });
            const hasText = a.textValue.trim().length > 0;
            const hasChoice = a.choiceValues.length > 0;
            const hasFile = Boolean(a.fileUrl);
            if (!hasText && !hasChoice && !hasFile) {
                return t('respondFormPage.requiredField', { label: q.label });
            }
        }
        return null;
    }, [form, answers, t]);

    const handleSubmit = useCallback(async () => {
        if (!formId || !form) return;
        setError('');
        setSuccess('');
        const v = validate();
        if (v) {
            setError(v);
            return;
        }
        setSubmitting(true);
        try {
            const payload = {
                answers: form.questions
                    .map((q) => {
                        const a = answers[q.id];
                        if (!a) return null;
                        return {
                            questionId: q.id,
                            textValue: a.textValue || null,
                            choiceValues: a.choiceValues,
                            fileUrl: a.fileUrl,
                        };
                    })
                    .filter(Boolean),
            };
            const resp = await apiFetch(
                `${API_URLS.courseContent()}/api/forms/${formId}/responses`,
                {
                    method: 'POST',
                    body: JSON.stringify(payload),
                },
            );
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                setError((data as { error?: string }).error || t('respondFormPage.errSubmit'));
                return;
            }
            setSuccess(t('respondFormPage.submitted'));
            setTimeout(() => navigate('/student/forms'), 800);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('respondFormPage.errNetwork'));
        } finally {
            setSubmitting(false);
        }
    }, [formId, form, validate, answers, navigate, t]);

    const dueText = useMemo(() => {
        if (!form?.dueDate) return '';
        return new Date(form.dueDate).toLocaleString();
    }, [form?.dueDate]);

    if (loading) {
        return (
            <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                {t('respondFormPage.loading')}
            </div>
        );
    }

    if (!form) {
        return (
            <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                {t('respondFormPage.notFound')}
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            <button
                type="button"
                onClick={() => navigate('/student/forms')}
                className="text-xs font-bold text-gray-500 hover:text-[#6A3FF4]"
            >
                <i className="ph-bold ph-arrow-left mr-1"></i> {t('respondFormPage.backToForms')}
            </button>

            {form.bannerImage && (
                <div className={`${glassCardStyle} overflow-hidden`}>
                    <img
                        src={form.bannerImage}
                        alt={form.title}
                        className="w-full h-40 md:h-56 object-cover"
                    />
                </div>
            )}

            <div className={`${glassCardStyle} p-6`}>
                <h1 className="text-2xl font-bold text-black dark:text-white">{form.title}</h1>
                {form.description && (
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        {renderMarkdown(form.description)}
                    </div>
                )}
                <p className="text-xs text-gray-400 mt-3">
                    <i className="ph-bold ph-calendar mr-1"></i> {t('respondFormPage.dueAt', { date: dueText })}
                </p>
                {readOnly && (
                    <div className="mt-4 bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium">
                        <i className="ph-bold ph-check-circle mr-1"></i> {t('respondFormPage.alreadySubmitted')}
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                    <i className="ph-bold ph-x-circle"></i> {error}
                </div>
            )}
            {success && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                    <i className="ph-bold ph-check-circle"></i> {success}
                </div>
            )}

            <div className="space-y-4">
                {form.questions.map((q, idx) => {
                    const a = answers[q.id] ?? blankAnswer(q.id);
                    return (
                        <div key={q.id} className={`${glassCardStyle} p-5 space-y-3`}>
                            <div>
                                <div className="text-sm font-bold text-black dark:text-white flex flex-wrap gap-1 items-start">
                                    <span>{idx + 1}.</span>
                                    <div className="flex-1 min-w-0">{renderMarkdown(q.label)}</div>
                                    {q.required && <span className="text-red-400">*</span>}
                                </div>
                                {q.imageUrl && (
                                    <img
                                        src={q.imageUrl}
                                        alt=""
                                        className="mt-2 max-w-full rounded-lg border border-white/10"
                                    />
                                )}
                            </div>

                            {q.kind === 'text' && (
                                <input
                                    type="text"
                                    value={a.textValue}
                                    disabled={readOnly}
                                    maxLength={q.maxLength ?? undefined}
                                    onChange={(e) => updateAnswer(q.id, { textValue: e.target.value })}
                                    placeholder={t('respondFormPage.yourAnswer')}
                                    className={inputStyle}
                                />
                            )}

                            {q.kind === 'textarea' && (
                                <textarea
                                    rows={4}
                                    value={a.textValue}
                                    disabled={readOnly}
                                    maxLength={q.maxLength ?? undefined}
                                    onChange={(e) => updateAnswer(q.id, { textValue: e.target.value })}
                                    placeholder={t('respondFormPage.yourAnswer')}
                                    className={`${inputStyle} resize-none`}
                                />
                            )}

                            {q.kind === 'multiple-choice' && (
                                <div className="space-y-2">
                                    {q.options.map((opt) => {
                                        const selected = a.choiceValues[0] === opt;
                                        return (
                                            <div
                                                key={opt}
                                                onClick={() =>
                                                    !readOnly &&
                                                    updateAnswer(q.id, { choiceValues: [opt] })
                                                }
                                                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                                                    selected
                                                        ? 'bg-[#6A3FF4]/15 border-[#6A3FF4]/40'
                                                        : 'bg-white/5 border-white/10 hover:border-[#6A3FF4]/30'
                                                } ${readOnly ? 'cursor-not-allowed opacity-80' : ''}`}
                                            >
                                                <span
                                                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                                                        selected
                                                            ? 'border-[#6A3FF4] bg-[#6A3FF4]'
                                                            : 'border-white/30'
                                                    }`}
                                                ></span>
                                                <span className="text-sm text-black dark:text-white">
                                                    {opt}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {q.kind === 'checkboxes' && (
                                <div className="space-y-2">
                                    {q.options.map((opt) => {
                                        const checked = a.choiceValues.includes(opt);
                                        return (
                                            <div
                                                key={opt}
                                                onClick={() => !readOnly && toggleChoice(q.id, opt)}
                                                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                                                    checked
                                                        ? 'bg-[#6A3FF4]/15 border-[#6A3FF4]/40'
                                                        : 'bg-white/5 border-white/10 hover:border-[#6A3FF4]/30'
                                                } ${readOnly ? 'cursor-not-allowed opacity-80' : ''}`}
                                            >
                                                <GlassCheckbox
                                                    checked={checked}
                                                    onChange={() => !readOnly && toggleChoice(q.id, opt)}
                                                    disabled={readOnly}
                                                    size="sm"
                                                    ariaLabel={opt}
                                                />
                                                <span className="text-sm text-black dark:text-white">
                                                    {opt}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {q.kind === 'dropdown' && (
                                <GlassDropdown
                                    value={a.choiceValues[0] || ''}
                                    onChange={(v) => updateAnswer(q.id, { choiceValues: [v] })}
                                    options={[
                                        { value: '', label: t('respondFormPage.choosePlaceholder') },
                                        ...q.options.map((o) => ({ value: o, label: o })),
                                    ]}
                                    direction="up"
                                />
                            )}

                            {q.kind === 'date' && (
                                <input
                                    type="date"
                                    value={a.textValue}
                                    disabled={readOnly}
                                    onChange={(e) => updateAnswer(q.id, { textValue: e.target.value })}
                                    className={`${inputStyle} [color-scheme:dark]`}
                                />
                            )}

                            {(q.kind === 'image-upload' || q.kind === 'file-upload') && (
                                <div className="space-y-2">
                                    {a.fileUrl ? (
                                        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                            <i className="ph-bold ph-paperclip text-[#6A3FF4]"></i>
                                            <span className="text-sm text-black dark:text-white truncate flex-1">
                                                {a.fileName || a.fileUrl}
                                            </span>
                                            {!readOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        updateAnswer(q.id, {
                                                            fileUrl: null,
                                                            fileName: null,
                                                        })
                                                    }
                                                    className="text-xs text-red-400 hover:text-red-500"
                                                >
                                                    {t('respondFormPage.removeFile')}
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <label
                                            htmlFor={`file-${q.id}`}
                                            className={`block px-4 py-3 rounded-lg border border-dashed cursor-pointer text-center text-sm font-bold ${
                                                readOnly
                                                    ? 'opacity-50 cursor-not-allowed border-white/10 text-gray-500'
                                                    : 'border-[#6A3FF4]/40 bg-[#6A3FF4]/5 text-[#6A3FF4] hover:bg-[#6A3FF4]/15'
                                            }`}
                                        >
                                            <i className="ph-bold ph-upload mr-1"></i>
                                            {q.kind === 'image-upload' ? t('respondFormPage.uploadImage') : t('respondFormPage.uploadFile')}
                                            <input
                                                id={`file-${q.id}`}
                                                type="file"
                                                disabled={readOnly}
                                                accept={
                                                    q.kind === 'image-upload' ? 'image/*' : undefined
                                                }
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) uploadFile(q.id, file);
                                                }}
                                                className="hidden"
                                            />
                                        </label>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {!readOnly && (
                <div className={`${glassCardStyle} p-5 flex items-center justify-end gap-3`}>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={handleSubmit}
                        className="px-6 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold disabled:opacity-50"
                    >
                        {submitting ? t('respondFormPage.submitting') : t('respondFormPage.submitResponse')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default RespondForm;
