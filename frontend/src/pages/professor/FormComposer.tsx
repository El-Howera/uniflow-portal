/**
 * FormComposer — shared compose page for forms with dynamic question builder.
 *
 * Drives `POST /api/forms` (create) and `PUT /api/forms/:id` (edit), plus
 * `POST /api/forms/:id/publish` (publish flag). Used by professor / ta / sa /
 * admin via thin re-export wrappers. Reads `localStorage.currentUserRole`
 * to compute the role-prefixed back-navigation path; no logic changes per
 * role.
 *
 * Features:
 *   - Title + Description + optional banner image
 *   - Start / Due date pickers
 *   - Recipient targeting (4-mode picker matching AnnouncementComposer)
 *   - Drag-to-reorder Question Builder (8 kinds)
 *   - Save draft (POST/PUT with isPublished=false) + Save & Publish
 *
 * Once published, the backend rejects question-structure changes, so the
 * builder is rendered read-only in that case.
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders, apiFetch } from '../../utils/api';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { MarkdownToolbar } from '../../components/MarkdownToolbar';
import { useAcademicSettings } from '../../utils/academicSettings';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

// Eight kinds backed by the FormQuestion schema.
type QuestionKind =
    | 'text'
    | 'textarea'
    | 'multiple-choice'
    | 'checkboxes'
    | 'dropdown'
    | 'date'
    | 'image-upload'
    | 'file-upload';

// KIND_OPTIONS is now a function that takes `t` for translation. The previous
// module-scope constant couldn't reach the hook; we wrap inside components.
const buildKindOptions = (t: (k: string) => string): { value: QuestionKind; label: string }[] => [
    { value: 'text', label: t('professor.fcKindShortText') },
    { value: 'textarea', label: t('professor.fcKindLongText') },
    { value: 'multiple-choice', label: t('professor.fcKindMultipleOne') },
    { value: 'checkboxes', label: t('professor.fcKindCheckboxesMany') },
    { value: 'dropdown', label: t('professor.fcKindDropdown') },
    { value: 'date', label: t('professor.fcKindDate') },
    { value: 'image-upload', label: t('professor.fcKindImageUpload') },
    { value: 'file-upload', label: t('professor.fcKindFileUpload') },
];

interface QuestionDraft {
    // Stable client-side id so reordering doesn't break React keys. Different
    // from the server-side `id`, which only exists for previously-saved rows.
    clientId: string;
    serverId?: string;
    kind: QuestionKind;
    label: string;
    required: boolean;
    options: string[]; // for choice / dropdown kinds
    maxLength?: number | null;
    imageUrl?: string | null;
}

type RecipientMode = 'all-students' | 'specific-levels' | 'specific-users' | 'all-users';

const buildRecipientOptions = (t: (k: string) => string): { value: RecipientMode; label: string }[] => [
    { value: 'all-students', label: t('professor.fcAllStudents') },
    { value: 'specific-levels', label: t('professor.fcSpecificLevels') },
    { value: 'specific-users', label: t('professor.fcSpecificUsers') },
    { value: 'all-users', label: t('professor.fcAllUsers') },
];

interface PickerUser {
    id: string;
    name: string;
    email: string;
    role: string;
}

function makeClientId(): string {
    return `q_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function blankQuestion(): QuestionDraft {
    return {
        clientId: makeClientId(),
        kind: 'text',
        label: '',
        required: false,
        options: [],
        maxLength: null,
        imageUrl: null,
    };
}

function toDateInput(value: string | Date | undefined): string {
    if (!value) return '';
    const d = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return '';
    // Trim seconds; <input type="datetime-local"> wants yyyy-MM-ddTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours(),
    )}:${pad(d.getMinutes())}`;
}

const FormComposer: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const { id: formIdParam } = useParams<{ id?: string }>();
    const isEdit = Boolean(formIdParam);

    const role = (localStorage.getItem('currentUserRole') || 'professor').toLowerCase();
    const rolePrefix = `/${role}`;

    // Form-level state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
    const [bannerImage, setBannerImage] = useState<string | null>(null);
    const [bannerFile, setBannerFile] = useState<File | null>(null);
    const [startDate, setStartDate] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [isPublished, setIsPublished] = useState(false);

    // Recipient targeting
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('all-students');
    const [selectedLevels, setSelectedLevels] = useState<number[]>([]);
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [userSearch, setUserSearch] = useState('');
    const [pickerUsers, setPickerUsers] = useState<PickerUser[]>([]);
    const [availableLevels, setAvailableLevels] = useState<number[]>([]);
    const [pickerLoading, setPickerLoading] = useState(false);

    // Question state
    const [questions, setQuestions] = useState<QuestionDraft[]>([blankQuestion()]);
    const [draggingId, setDraggingId] = useState<string | null>(null);

    // Async + UX
    const [loading, setLoading] = useState(isEdit);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Hydrate form in edit mode
    useEffect(() => {
        if (!isEdit || !formIdParam) return;
        let cancelled = false;
        setLoading(true);
        apiFetch(`${API_URLS.courseContent()}/api/forms/${formIdParam}`)
            .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json().catch(() => ({})))))
            .then((data) => {
                if (cancelled) return;
                const f = data.form;
                if (!f) return;
                setTitle(f.title || '');
                setDescription(f.description || '');
                setBannerImage(f.bannerImage || null);
                setStartDate(toDateInput(f.startDate));
                setDueDate(toDateInput(f.dueDate));
                setIsPublished(Boolean(f.isPublished));
                // Recipients
                if (Array.isArray(f.targetUserIds) && f.targetUserIds.length > 0) {
                    setRecipientMode('specific-users');
                    setSelectedUserIds(f.targetUserIds);
                } else if (Array.isArray(f.targetLevels) && f.targetLevels.length > 0) {
                    setRecipientMode('specific-levels');
                    setSelectedLevels(f.targetLevels);
                } else if (
                    Array.isArray(f.targetRoles) &&
                    f.targetRoles.length > 1 &&
                    f.targetRoles.includes('professor')
                ) {
                    setRecipientMode('all-users');
                } else {
                    setRecipientMode('all-students');
                }
                // Questions
                if (Array.isArray(f.questions) && f.questions.length > 0) {
                    setQuestions(
                        f.questions.map((q: {
                            id: string;
                            kind: QuestionKind;
                            label: string;
                            required: boolean;
                            options: string[];
                            maxLength: number | null;
                            imageUrl: string | null;
                        }) => ({
                            clientId: makeClientId(),
                            serverId: q.id,
                            kind: q.kind,
                            label: q.label,
                            required: q.required,
                            options: Array.isArray(q.options) ? q.options : [],
                            maxLength: q.maxLength,
                            imageUrl: q.imageUrl,
                        })),
                    );
                }
            })
            .catch((e: { error?: string }) => !cancelled && setError(e?.error || 'Could not load form.'))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [isEdit, formIdParam]);

    // Lazy-load the recipient picker when needed
    const needsPicker = recipientMode === 'specific-users' || recipientMode === 'specific-levels';
    useEffect(() => {
        if (!needsPicker || pickerUsers.length > 0) return;
        let cancelled = false;
        setPickerLoading(true);
        fetch(`${API_URLS.studentAffairs()}/api/sa/recipient-options`, {
            credentials: 'include',
            headers: authHeaders() as Record<string, string>,
        })
            .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json().catch(() => ({})))))
            .then((data) => {
                if (cancelled) return;
                const list = Array.isArray(data?.users)
                    ? data.users
                    : Array.isArray(data?.students)
                    ? data.students
                    : [];
                setPickerUsers(list);
                setAvailableLevels(Array.isArray(data?.levels) ? data.levels : []);
            })
            .catch(() => !cancelled && undefined)
            .finally(() => !cancelled && setPickerLoading(false));
        return () => {
            cancelled = true;
        };
    }, [needsPicker, pickerUsers.length]);

    const academic = useAcademicSettings();
    const levelChips = useMemo(() => {
        const configured = Array.from(
            { length: Math.max(1, academic.numberOfAcademicLevels) },
            (_, i) => i + 1,
        );
        return [...new Set([...availableLevels, ...configured])].sort((a, b) => a - b);
    }, [availableLevels, academic.numberOfAcademicLevels]);

    const filteredUsers = useMemo(() => {
        const q = userSearch.trim().toLowerCase();
        if (!q) return pickerUsers;
        return pickerUsers.filter(
            (u) =>
                u.name.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q) ||
                u.role.toLowerCase().includes(q),
        );
    }, [pickerUsers, userSearch]);

    const toggleLevel = useCallback((n: number) => {
        setSelectedLevels((prev) =>
            prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort(),
        );
    }, []);

    const toggleUser = useCallback((id: string) => {
        setSelectedUserIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }, []);

    // Question mutators
    const updateQuestion = useCallback(
        (clientId: string, patch: Partial<QuestionDraft>) => {
            setQuestions((prev) =>
                prev.map((q) => (q.clientId === clientId ? { ...q, ...patch } : q)),
            );
        },
        [],
    );

    const addQuestion = useCallback(() => {
        setQuestions((prev) => [...prev, blankQuestion()]);
    }, []);

    const removeQuestion = useCallback((clientId: string) => {
        setQuestions((prev) => prev.filter((q) => q.clientId !== clientId));
    }, []);

    const moveQuestion = useCallback((clientId: string, direction: -1 | 1) => {
        setQuestions((prev) => {
            const idx = prev.findIndex((q) => q.clientId === clientId);
            if (idx < 0) return prev;
            const target = idx + direction;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(idx, 1);
            next.splice(target, 0, moved);
            return next;
        });
    }, []);

    const onDragStart = useCallback((clientId: string) => {
        setDraggingId(clientId);
    }, []);

    const onDragOver = useCallback(
        (e: React.DragEvent, clientId: string) => {
            e.preventDefault();
            if (!draggingId || draggingId === clientId) return;
            setQuestions((prev) => {
                const fromIdx = prev.findIndex((q) => q.clientId === draggingId);
                const toIdx = prev.findIndex((q) => q.clientId === clientId);
                if (fromIdx < 0 || toIdx < 0) return prev;
                const next = [...prev];
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved);
                return next;
            });
        },
        [draggingId],
    );

    const onDragEnd = useCallback(() => {
        setDraggingId(null);
    }, []);

    const handleBannerPick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) {
            setError(t('professor.fcBannerMustBeImage'));
            return;
        }
        setBannerFile(f);
        const reader = new FileReader();
        reader.onload = (ev) =>
            setBannerImage(typeof ev.target?.result === 'string' ? ev.target.result : null);
        reader.readAsDataURL(f);
    };

    const buildPayload = useCallback(() => {
        const targetRoles: string[] = (() => {
            if (recipientMode === 'all-users')
                return ['student', 'professor', 'ta', 'sa', 'admin'];
            return ['student'];
        })();
        const targetLevels =
            recipientMode === 'specific-levels' ? selectedLevels : [];
        const targetUserIds =
            recipientMode === 'specific-users' ? selectedUserIds : [];
        return {
            title: title.trim(),
            description: description.trim() || null,
            // For now we send the data-URL preview / existing URL as-is. A
            // dedicated banner upload endpoint would be a clean follow-up.
            bannerImage: bannerImage || null,
            startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
            dueDate: dueDate ? new Date(dueDate).toISOString() : new Date().toISOString(),
            targetRoles,
            targetLevels,
            targetUserIds,
            questions: questions.map((q) => ({
                kind: q.kind,
                label: q.label.trim(),
                required: q.required,
                options: q.options.filter((o) => o.trim().length > 0),
                maxLength: q.maxLength ?? null,
                imageUrl: q.imageUrl ?? null,
            })),
        };
    }, [
        title,
        description,
        bannerImage,
        startDate,
        dueDate,
        recipientMode,
        selectedLevels,
        selectedUserIds,
        questions,
    ]);

    const validate = useCallback((): string | null => {
        if (!title.trim()) return t('professor.fcTitleRequired');
        if (!startDate || !dueDate) return t('professor.fcDatesRequired');
        if (new Date(dueDate).getTime() < new Date(startDate).getTime()) {
            return t('professor.fcDueAfterStart');
        }
        if (recipientMode === 'specific-levels' && selectedLevels.length === 0) {
            return t('professor.fcPickLevel');
        }
        if (recipientMode === 'specific-users' && selectedUserIds.length === 0) {
            return t('professor.fcPickUser');
        }
        for (const q of questions) {
            if (!q.label.trim()) return t('professor.fcQuestionNeedsLabel');
            if (
                ['multiple-choice', 'checkboxes', 'dropdown'].includes(q.kind) &&
                q.options.filter((o) => o.trim()).length < 2
            ) {
                return t('professor.fcQuestionNeedsOptions', { label: q.label || t('professor.fcQuestionLabelText') });
            }
        }
        return null;
    }, [
        title,
        startDate,
        dueDate,
        recipientMode,
        selectedLevels,
        selectedUserIds,
        questions,
        t,
    ]);

    const submit = useCallback(
        async (alsoPublish: boolean) => {
            setError('');
            setSuccess('');
            const v = validate();
            if (v) {
                setError(v);
                return;
            }
            setSubmitting(true);
            try {
                const payload = buildPayload();
                let resp: Response;
                if (isEdit && formIdParam) {
                    // After publish the backend refuses question changes.
                    const editPayload: Record<string, unknown> = { ...payload };
                    if (isPublished) delete editPayload.questions;
                    resp = await apiFetch(`${API_URLS.courseContent()}/api/forms/${formIdParam}`, {
                        method: 'PUT',
                        body: JSON.stringify(editPayload),
                    });
                } else {
                    resp = await apiFetch(`${API_URLS.courseContent()}/api/forms`, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });
                }
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    setError((data as { error?: string }).error || t('professor.fcCouldNotSave'));
                    return;
                }
                const savedId: string =
                    (data as { form?: { id?: string } }).form?.id || formIdParam || '';
                if (alsoPublish && savedId) {
                    const pubResp = await apiFetch(
                        `${API_URLS.courseContent()}/api/forms/${savedId}/publish`,
                        { method: 'POST' },
                    );
                    if (!pubResp.ok) {
                        const pubBody = await pubResp.json().catch(() => ({}));
                        setError(
                            (pubBody as { error?: string }).error || t('professor.fcPublishFailed'),
                        );
                        return;
                    }
                }
                setSuccess(alsoPublish ? t('professor.fcFormPublished') : t('professor.fcDraftSaved'));
                // Brief pause so the user sees the banner, then navigate back.
                setTimeout(() => navigate(`${rolePrefix}/forms`), 700);
            } catch (e) {
                setError(e instanceof Error ? e.message : t('professor.fcNetworkError'));
            } finally {
                setSubmitting(false);
                // Banner upload not yet wired; clear the staged File reference.
                if (bannerFile) setBannerFile(null);
            }
        },
        [
            validate,
            buildPayload,
            isEdit,
            formIdParam,
            isPublished,
            navigate,
            rolePrefix,
            bannerFile,
            t,
        ],
    );

    if (loading) {
        return (
            <div className={`${glassCardStyle} p-12 text-center text-gray-400`}>
                {t('professor.fcLoadingForm')}
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-12">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-black dark:text-white">
                        {isEdit ? t('professor.fcEditForm') : t('professor.fcNewForm')}
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {isPublished
                            ? t('professor.fcPublishedSubtitle')
                            : t('professor.fcDraftSubtitle')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`${rolePrefix}/forms`)}
                    className="px-4 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-sm font-bold text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40"
                >
                    {t('professor.fcCancel')}
                </button>
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

            {/* Form metadata */}
            <div className={`${glassCardStyle} p-6 space-y-5`}>
                <h2 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
                    <i className="ph-bold ph-info text-[#6A3FF4]"></i> {t('professor.fcFormDetails')}
                </h2>

                <div>
                    <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
                        {t('professor.fcTitle')}
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('professor.fcFormTitlePlaceholder')}
                        className={inputStyle}
                    />
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
                        {t('professor.fcDescription')}
                    </label>
                    <MarkdownToolbar textareaRef={descriptionRef} value={description} onChange={setDescription} />
                    <textarea
                        ref={descriptionRef}
                        rows={4}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('professor.fcFormDescPlaceholder')}
                        className={`${inputStyle} resize-none`}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
                            {t('professor.fcStartDateTime')}
                        </label>
                        <input
                            type="datetime-local"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className={`${inputStyle} [color-scheme:dark]`}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
                            {t('professor.fcDueDateTime')}
                        </label>
                        <input
                            type="datetime-local"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className={`${inputStyle} [color-scheme:dark]`}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
                        {t('professor.fcBannerOptional')}
                    </label>
                    <div className="flex items-center gap-4">
                        {bannerImage && (
                            <img
                                src={bannerImage}
                                alt="Banner preview"
                                className="w-24 h-24 object-cover rounded-xl border border-white/10"
                            />
                        )}
                        <label
                            htmlFor="banner-pick"
                            className="cursor-pointer px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40"
                        >
                            <i className="ph-bold ph-image mr-1"></i>
                            {bannerImage ? t('professor.fcChangeImage') : t('professor.fcPickImage')}
                            <input
                                id="banner-pick"
                                type="file"
                                accept="image/*"
                                onChange={handleBannerPick}
                                className="hidden"
                            />
                        </label>
                        {bannerImage && (
                            <button
                                type="button"
                                onClick={() => {
                                    setBannerImage(null);
                                    setBannerFile(null);
                                }}
                                className="text-sm text-red-400 hover:text-red-500"
                            >
                                {t('professor.fcRemove')}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Recipient targeting */}
            <div className={`${glassCardStyle} p-6 space-y-5`}>
                <h2 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
                    <i className="ph-bold ph-users-three text-[#6A3FF4]"></i> {t('professor.fcRecipients')}
                </h2>

                <div className="flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
                    {buildRecipientOptions(t).map((o) => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => setRecipientMode(o.value)}
                            className={`flex-1 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-colors ${
                                recipientMode === o.value
                                    ? 'bg-[#6A3FF4] text-white'
                                    : 'text-black dark:text-gray-300'
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>

                {recipientMode === 'specific-levels' && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 bg-white/5 border border-white/10 rounded-xl"
                    >
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            {t('professor.fcChooseLevels')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {levelChips.map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    onClick={() => toggleLevel(n)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                        selectedLevels.includes(n)
                                            ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                            : 'bg-white/5 text-gray-500 dark:text-gray-300 border-white/10 hover:border-[#6A3FF4]/40'
                                    }`}
                                >
                                    {t('professor.fcLevelN', { n })}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {recipientMode === 'specific-users' && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-3"
                    >
                        <input
                            type="text"
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            placeholder={t('professor.fcSearchUsers')}
                            className={inputStyle}
                        />
                        {pickerLoading ? (
                            <p className="text-xs text-gray-500">{t('professor.fcLoadingUsers')}</p>
                        ) : (
                            <div className="max-h-60 overflow-y-auto divide-y divide-white/10">
                                {filteredUsers.map((u) => {
                                    const checked = selectedUserIds.includes(u.id);
                                    return (
                                        <div
                                            key={u.id}
                                            onClick={() => toggleUser(u.id)}
                                            className={`flex items-center gap-3 px-2 py-2 cursor-pointer transition-colors ${
                                                checked
                                                    ? 'bg-[#6A3FF4]/10'
                                                    : 'hover:bg-white/5'
                                            }`}
                                        >
                                            <GlassCheckbox
                                                checked={checked}
                                                onChange={() => toggleUser(u.id)}
                                                size="sm"
                                                ariaLabel={`Toggle ${u.name}`}
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-black dark:text-white truncate">
                                                    {u.name}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">
                                                    {u.email} · {u.role}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredUsers.length === 0 && (
                                    <p className="text-xs text-gray-500 py-3 text-center">
                                        {t('professor.fcNoUsersMatch')}
                                    </p>
                                )}
                            </div>
                        )}
                        <p className="text-xs text-gray-400">
                            {t('professor.fcSelectedCount', { n: selectedUserIds.length })}
                        </p>
                    </motion.div>
                )}
            </div>

            {/* Question builder */}
            <div className={`${glassCardStyle} p-6 space-y-4`}>
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-black dark:text-white flex items-center gap-2">
                        <i className="ph-bold ph-list-bullets text-[#6A3FF4]"></i> {t('professor.fcQuestions')}
                    </h2>
                    <span className="text-xs text-gray-500">
                        {t('professor.fcQuestionsCountInline', { n: questions.length, suffix: questions.length === 1 ? '' : 's' })}
                    </span>
                </div>

                {isPublished && (
                    <div className="bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-xl px-4 py-2.5 text-sm font-medium">
                        <i className="ph-bold ph-lock"></i> {t('professor.fcStructureLocked')}
                    </div>
                )}

                <div className="space-y-3">
                    {questions.map((q, idx) => (
                        <QuestionCard
                            key={q.clientId}
                            question={q}
                            index={idx}
                            total={questions.length}
                            locked={isPublished}
                            isDragging={draggingId === q.clientId}
                            onChange={(patch) => updateQuestion(q.clientId, patch)}
                            onRemove={() => removeQuestion(q.clientId)}
                            onMoveUp={() => moveQuestion(q.clientId, -1)}
                            onMoveDown={() => moveQuestion(q.clientId, 1)}
                            onDragStart={() => onDragStart(q.clientId)}
                            onDragOver={(e) => onDragOver(e, q.clientId)}
                            onDragEnd={onDragEnd}
                        />
                    ))}
                </div>

                {!isPublished && (
                    <button
                        type="button"
                        onClick={addQuestion}
                        className="w-full py-3 rounded-xl bg-[#6A3FF4]/10 border border-dashed border-[#6A3FF4]/40 text-[#6A3FF4] font-bold text-sm hover:bg-[#6A3FF4]/20"
                    >
                        <i className="ph-bold ph-plus mr-1"></i> {t('professor.fcAddQuestion')}
                    </button>
                )}
            </div>

            {/* Footer actions */}
            <div className={`${glassCardStyle} p-6 flex flex-wrap items-center justify-between gap-3`}>
                <p className="text-xs text-gray-500">
                    {t('professor.fcFooterNotice')}
                </p>
                <div className="flex gap-3">
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submit(false)}
                        className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-bold text-gray-500 dark:text-gray-300 hover:border-[#6A3FF4]/40 disabled:opacity-50"
                    >
                        {submitting ? t('professor.fcSavingShort') : t('professor.fcSaveDraft')}
                    </button>
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={() => submit(true)}
                        className="px-5 py-2.5 rounded-xl bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-sm font-bold disabled:opacity-50"
                    >
                        {submitting ? t('professor.fcPublishing') : isPublished ? t('professor.fcSaveChanges') : t('professor.fcSaveAndPublish')}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── QuestionCard ───────────────────────────────────────────────────────────

interface QuestionCardProps {
    question: QuestionDraft;
    index: number;
    total: number;
    locked: boolean;
    isDragging: boolean;
    onChange: (patch: Partial<QuestionDraft>) => void;
    onRemove: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
    question,
    index,
    total,
    locked,
    isDragging,
    onChange,
    onRemove,
    onMoveUp,
    onMoveDown,
    onDragStart,
    onDragOver,
    onDragEnd,
}) => {
    const t = useT();
    const hasOptions = ['multiple-choice', 'checkboxes', 'dropdown'].includes(question.kind);
    const isText = question.kind === 'text' || question.kind === 'textarea';
    const isUpload = question.kind === 'image-upload' || question.kind === 'file-upload';

    const addOption = () => {
        onChange({ options: [...question.options, ''] });
    };
    const updateOption = (idx: number, val: string) => {
        const next = [...question.options];
        next[idx] = val;
        onChange({ options: next });
    };
    const removeOption = (idx: number) => {
        const next = question.options.filter((_, i) => i !== idx);
        onChange({ options: next });
    };

    return (
        <div
            draggable={!locked}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            className={`bg-white/5 dark:bg-black/10 border rounded-2xl p-4 space-y-3 transition-all ${
                isDragging
                    ? 'border-[#6A3FF4]/60 shadow-lg shadow-[#6A3FF4]/20 opacity-75'
                    : 'border-white/10'
            }`}
        >
            <div className="flex items-center gap-3">
                {!locked && (
                    <i
                        className="ph-bold ph-dots-six-vertical text-gray-400 cursor-grab"
                        title={t('professor.fcDragToReorder')}
                    ></i>
                )}
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                    {t('professor.fcQshort', { n: index + 1 })}
                </span>
                <div className="min-w-[200px] flex-1 max-w-[260px]">
                    <GlassDropdown
                        value={question.kind}
                        onChange={(v) => onChange({ kind: v as QuestionKind })}
                        options={buildKindOptions(t)}
                        direction="up"
                    />
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        disabled={locked || index === 0}
                        onClick={onMoveUp}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        title={t('professor.fcMoveUp')}
                    >
                        <i className="ph-bold ph-caret-up text-gray-400 text-sm"></i>
                    </button>
                    <button
                        type="button"
                        disabled={locked || index === total - 1}
                        onClick={onMoveDown}
                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        title={t('professor.fcMoveDown')}
                    >
                        <i className="ph-bold ph-caret-down text-gray-400 text-sm"></i>
                    </button>
                    <button
                        type="button"
                        disabled={locked}
                        onClick={onRemove}
                        className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                        title={t('professor.fcDeleteQuestion')}
                    >
                        <i className="ph-bold ph-trash text-red-400 text-sm"></i>
                    </button>
                </div>
            </div>

            <input
                type="text"
                value={question.label}
                disabled={locked}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder={t('professor.fcQuestionLabelPlaceholder')}
                className={inputStyle}
            />

            <div
                onClick={() => !locked && onChange({ required: !question.required })}
                className={`flex items-center gap-2 w-fit ${locked ? '' : 'cursor-pointer'}`}
            >
                <GlassCheckbox
                    checked={question.required}
                    onChange={(v) => onChange({ required: v })}
                    disabled={locked}
                    size="sm"
                    ariaLabel={t('professor.fcRequired')}
                />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-300">
                    {t('professor.fcRequired')}
                </span>
            </div>

            {isText && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.fcMaxLength')}
                        </label>
                        <input
                            type="number"
                            min={1}
                            disabled={locked}
                            value={question.maxLength ?? ''}
                            onChange={(e) =>
                                onChange({
                                    maxLength: e.target.value ? Number(e.target.value) : null,
                                })
                            }
                            placeholder={t('professor.fcNoLimit')}
                            className={inputStyle}
                        />
                    </div>
                </div>
            )}

            {hasOptions && (
                <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500">{t('professor.fcOptionsLabel')}</p>
                    {question.options.map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={opt}
                                disabled={locked}
                                onChange={(e) => updateOption(i, e.target.value)}
                                placeholder={t('professor.fcOptionN', { n: i + 1 })}
                                className={inputStyle}
                            />
                            <button
                                type="button"
                                disabled={locked}
                                onClick={() => removeOption(i)}
                                className="w-9 h-9 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-30 flex items-center justify-center flex-shrink-0"
                            >
                                <i className="ph-bold ph-x text-red-400 text-sm"></i>
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        disabled={locked}
                        onClick={addOption}
                        className="text-xs font-bold text-[#6A3FF4] hover:text-[#5A32D4] disabled:opacity-50"
                    >
                        <i className="ph-bold ph-plus mr-1"></i> {t('professor.fcAddOption')}
                    </button>
                </div>
            )}

            {isUpload && (
                <p className="text-xs text-gray-400 italic">
                    {question.kind === 'image-upload' ? t('professor.fcUploadHintImage') : t('professor.fcUploadHintFile')}
                </p>
            )}
        </div>
    );
};

export default FormComposer;
