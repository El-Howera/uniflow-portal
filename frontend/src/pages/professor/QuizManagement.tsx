import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useT } from '../../i18n';
import {
    Quiz,
    QuizQuestion,
    QuizSubmission,
    fetchQuizzes,
    createQuiz,
    deleteQuiz,
    fetchQuizSubmissions,
    gradeQuizSubmission,
} from '../../utils/courseContentService';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { GlassDateTimePicker } from '../../components/GlassDateTimePicker';
import { MarkdownToolbar } from '../../components/MarkdownToolbar';
import { API_URLS } from '@shared/config';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const glassInputStyle = "bg-white/5 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#6A3FF4]/50 transition-all text-black dark:text-white placeholder-gray-400";

interface CourseOption {
    code: string;
    name: string;
}

interface StudentOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

// --- COMPONENTS ---

const QuizList: React.FC<{
    quizzes: Quiz[];
    courseFilter: string;
    onCourseFilter: (v: string) => void;
    courseOptions: CourseOption[];
    onCreate: () => void;
    onSelect: (quiz: Quiz) => void;
    onEdit: (quiz: Quiz) => void;
    onDelete: (id: string) => void;
}> = ({ quizzes, courseFilter, onCourseFilter, courseOptions, onCreate, onSelect, onEdit, onDelete }) => {
    const t = useT();
    const filterDropdownOptions = useMemo(() => [
        { value: 'all', label: t('professor.qmAllCoursesOpt') },
        ...courseOptions.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` })),
    ], [courseOptions, t]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <h2 className="text-xl font-bold text-black dark:text-white">{t('professor.qmAllQuizzes')}</h2>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="min-w-[220px]">
                        <GlassDropdown
                            value={courseFilter}
                            onChange={onCourseFilter}
                            options={filterDropdownOptions}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                    <button
                        onClick={onCreate}
                        disabled={courseOptions.length === 0}
                        className="bg-[#6A3FF4] hover:bg-[#5835CC] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold transition-all shadow-lg shadow-purple-500/20"
                    >
                        <i className="ph-bold ph-plus"></i> {t('professor.qmCreateQuizBtn')}
                    </button>
                </div>
            </div>

            <div className="grid gap-4">
                {quizzes.map(quiz => (
                    <div key={quiz.id} className={`${glassCardStyle} p-5 flex justify-between items-center group`}>
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-1 rounded-md">
                                    {quiz.courseCode}
                                </span>
                                <h3 className="text-lg font-bold text-black dark:text-white">{quiz.title}</h3>
                            </div>
                            <div className="flex gap-4 text-xs text-gray-500">
                                <span><i className="ph-bold ph-clock"></i> {quiz.timeLimit}m</span>
                                <span><i className="ph-bold ph-list-numbers"></i> {quiz.questions?.length ?? quiz.questionCount ?? 0} Qs</span>
                                <span><i className="ph-bold ph-calendar-blank"></i> {t('professor.qmDueShort', { date: new Date(quiz.dueDate).toLocaleDateString() })}</span>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onSelect(quiz)}
                                className="p-2 text-gray-400 hover:text-[#6A3FF4] bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                                title={t('professor.qmGradeSubmissions')}
                            >
                                <i className="ph-bold ph-check-square-offset text-xl"></i>
                            </button>
                            <button
                                onClick={() => onEdit(quiz)}
                                className="p-2 text-gray-400 hover:text-[#7B5AFF] bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                                title={t('professor.qmEditQuizTooltip')}
                            >
                                <i className="ph-bold ph-pencil-simple text-xl"></i>
                            </button>
                            <button
                                onClick={() => onDelete(quiz.id)}
                                className="p-2 text-gray-400 hover:text-red-500 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                                title={t('professor.qmDeleteQuizTooltip')}
                            >
                                <i className="ph-bold ph-trash text-xl"></i>
                            </button>
                        </div>
                    </div>
                ))}
                {quizzes.length === 0 && (
                    <div className="text-center py-10 text-gray-500 bg-white/5 rounded-xl border border-dashed border-gray-300 dark:border-white/10">
                        {courseOptions.length === 0
                            ? t('professor.qmNoCoursesYet')
                            : t('professor.qmNoQuizzesYet')}
                    </div>
                )}
            </div>
        </div>
    );
};

const QuizCreator: React.FC<{
    onCancel: () => void;
    onSave: (quiz: Omit<Quiz, 'id'> & {
        audienceUserIds?: string[];
        startsAt?: string | null;
        totalPoints?: number | null;
    }) => Promise<void>;
    courseOptions: CourseOption[];
    /**
     * When provided, the form is pre-populated and the title flips to
     * "Edit Quiz" — same component, two modes. The parent decides whether
     * onSave PATCHes (edit) or POSTs (create).
     */
    initialQuiz?: Quiz | null;
    mode?: 'create' | 'edit';
}> = ({ onCancel, onSave, courseOptions, initialQuiz = null, mode = 'create' }) => {
    const t = useT();
    /**
     * Convert a UTC-ISO string from the API back into the picker's
     * `YYYY-MM-DDTHH:MM` local-wall-clock contract. Symmetric to the
     * localToUtcIso conversion used on save — the round-trip is lossless
     * within the picker's per-minute resolution.
     */
    const utcIsoToLocalInput = (iso?: string | null): string => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const [formData, setFormData] = useState<Omit<Quiz, 'id'>>({
        courseCode: initialQuiz?.courseCode ?? courseOptions[0]?.code ?? '',
        title: initialQuiz?.title ?? '',
        description: initialQuiz?.description ?? '',
        timeLimit: initialQuiz?.timeLimit ?? 30,
        dueDate: utcIsoToLocalInput(initialQuiz?.dueDate),
        questions: (initialQuiz?.questions ?? []).map((q) => ({
            ...q,
            // Normalise — backend may return options as a JSON string in
            // some Prisma versions; the form expects string[].
            options: Array.isArray(q.options) ? q.options : (q.options ? Object.values(q.options as object) as string[] : undefined),
        })),
        createdBy: initialQuiz?.createdBy ?? localStorage.getItem('currentUserId') ?? '',
    });
    // Scheduled-quiz controls. `startsAt` ISO-local string from the date+time
    // picker. The total marks figure is now derived from Σ question.points
    // — the staff sets points per question, the total updates live.
    const [startsAt, setStartsAt] = useState<string>(utcIsoToLocalInput(initialQuiz?.startsAt));

    const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
    const questionTextRef = useRef<HTMLTextAreaElement | null>(null);
    const [newQuestion, setNewQuestion] = useState<Partial<QuizQuestion>>({
        type: 'mcq',
        text: '',
        points: 5,
        options: ['', '', '', ''],
        correctAnswer: '',
    });

    // Whole-course (default) vs specific-students audience picker. When
    // editing a quiz that already has audience targeting saved, restore
    // the picker into "specific" mode with the same selection.
    const initialAudienceIds = initialQuiz?.audienceUserIds ?? [];
    const [audienceMode, setAudienceMode] = useState<'all' | 'specific'>(
        initialAudienceIds.length > 0 ? 'specific' : 'all'
    );
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [studentSearch, setStudentSearch] = useState('');
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
        new Set(initialAudienceIds)
    );

    // Fetch enrolled students for the chosen course when in specific-mode.
    useEffect(() => {
        if (audienceMode !== 'specific' || !formData.courseCode) return;
        const token = localStorage.getItem('authToken');
        const url = `${API_URLS.courseContent()}/api/courses/${formData.courseCode}/enrolled-students`;
        fetch(url, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => (r.ok ? r.json() : []))
            .then((rows: StudentOption[]) => {
                setStudents(Array.isArray(rows) ? rows : []);
                setSelectedStudentIds(new Set());
            })
            .catch(() => setStudents([]));
    }, [audienceMode, formData.courseCode]);

    const filteredStudents = useMemo(() => {
        const q = studentSearch.toLowerCase().trim();
        if (!q) return students;
        return students.filter(s =>
            `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase().includes(q)
        );
    }, [students, studentSearch]);

    const addQuestion = () => {
        if (!newQuestion.text) return alert(t('professor.qmQuestionTextRequired'));
        if (newQuestion.type === 'mcq' && (!newQuestion.correctAnswer || !newQuestion.options?.every(o => o)))
            return alert(t('professor.qmMcqOptionsRequired'));

        const q: QuizQuestion = {
            id: `q${Date.now()}`,
            type: newQuestion.type as 'mcq' | 'written',
            text: newQuestion.text!,
            points: newQuestion.points || 5,
            options: newQuestion.type === 'mcq' ? newQuestion.options : undefined,
            correctAnswer: newQuestion.type === 'mcq' ? newQuestion.correctAnswer : undefined,
        };

        setFormData(prev => ({ ...prev, questions: [...prev.questions, q] }));
        setNewQuestion({ type: 'mcq', text: '', points: 5, options: ['', '', '', ''], correctAnswer: '' });
    };

    /**
     * Convert a `YYYY-MM-DDTHH:MM` local-wall-clock string from the picker
     * into a full UTC ISO-8601 string for transport.
     *
     * Why we don't trust `new Date(local)`: implementations disagree about
     * whether a date-time literal without a `Z` is local or UTC (modern
     * browsers say local, but some Node builds and older browsers say UTC).
     * We sidestep the ambiguity by parsing the components ourselves and
     * feeding them to the numeric Date constructor — that one is documented
     * to use local time on every runtime, so the conversion is deterministic.
     */
    const localToUtcIso = (local: string): string | null => {
        if (!local) return null;
        const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) {
            const fallback = new Date(local);
            return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
        }
        const [, y, mo, d, h, mi, s] = m;
        const dt = new Date(
            Number(y),
            Number(mo) - 1,
            Number(d),
            Number(h),
            Number(mi),
            s ? Number(s) : 0,
            0,
        );
        return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
    };

    const handleSubmit = async () => {
        // All fields are required — the staff scheduling a quiz needs to be
        // explicit about every piece. Soft-validates here with a single
        // alert listing every missing field so the user fixes them in one
        // pass instead of one error at a time.
        const missing: string[] = [];
        if (!formData.title.trim()) missing.push(t('professor.qmRequiredTitle'));
        if (!formData.description?.trim()) missing.push(t('professor.qmRequiredDescription'));
        if (!formData.timeLimit || formData.timeLimit < 1) missing.push(t('professor.qmRequiredTimeLimit'));
        if (!formData.dueDate) missing.push(t('professor.qmRequiredDueDate'));
        if (!startsAt) missing.push(t('professor.qmRequiredStartsAt'));
        if (formData.questions.length === 0) missing.push(t('professor.qmRequiredQuestions'));
        if (audienceMode === 'specific' && selectedStudentIds.size === 0) {
            missing.push(t('professor.qmRequiredSpecificStudent'));
        }
        if (missing.length > 0) {
            return alert(t('professor.qmFillRequiredFields', { fields: missing.join('\n• ') }));
        }

        // Cross-field sanity: startsAt must not be after dueDate.
        if (startsAt && formData.dueDate) {
            const startMs = new Date(startsAt).getTime();
            const dueMs = new Date(formData.dueDate).getTime();
            if (startMs > dueMs) {
                return alert(t('professor.qmStartBeforeDue'));
            }
        }

        await onSave({
            ...formData,
            // Send full UTC ISO strings so the server stores the exact
            // moment the user picked instead of double-converting through
            // an ambiguous "no-tz" datetime literal.
            dueDate: localToUtcIso(formData.dueDate) ?? formData.dueDate,
            audienceUserIds: audienceMode === 'specific' ? Array.from(selectedStudentIds) : undefined,
            startsAt: localToUtcIso(startsAt),
            // Total marks derive from Σ question.points server-side. We
            // omit it here so the backend computes the canonical figure.
            totalPoints: null,
        });
    };

    // Live-derived total marks from the per-question points. Surfaced as
    // a read-only badge so the staff sees the running sum as they build
    // the quiz — replaces the old "Total Marks" required input.
    const derivedTotal = formData.questions.reduce(
        (acc, q) => acc + (Number.isFinite(q.points) ? Number(q.points) : 0),
        0,
    );

    const courseDropdownOptions = useMemo(
        () => courseOptions.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` })),
        [courseOptions]
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-black dark:text-white">
                    {mode === 'edit' ? t('professor.qmEditQuiz') : t('professor.qmCreateNew')}
                </h2>
                <button onClick={onCancel} className="text-gray-500 hover:text-black dark:hover:text-white">{t('professor.qmCancel')}</button>
            </div>

            <div className={`${glassCardStyle} p-6 space-y-4`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmCourseLabel')} <span className="text-red-500 font-normal">*</span>
                        </label>
                        <GlassDropdown
                            value={formData.courseCode}
                            onChange={code => setFormData({ ...formData, courseCode: code })}
                            options={courseDropdownOptions}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmTitleLabel')} <span className="text-red-500 font-normal">*</span>
                        </label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                            className={`${glassInputStyle} w-full`}
                            placeholder={t('professor.qmTitlePlaceholder')}
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">
                        {t('professor.qmDescriptionLabel')} <span className="text-red-500 font-normal">*</span>
                    </label>
                    <MarkdownToolbar
                        textareaRef={descriptionRef}
                        value={formData.description}
                        onChange={(next) => setFormData({ ...formData, description: next })}
                    />
                    <textarea
                        ref={descriptionRef}
                        value={formData.description}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        className={`${glassInputStyle} w-full h-24 resize-none`}
                        placeholder={t('professor.qmDescPlaceholder')}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmTimeLimitLabel')} <span className="text-red-500 font-normal">*</span>
                        </label>
                        <input
                            type="number"
                            min={1}
                            value={formData.timeLimit}
                            onChange={e => setFormData({ ...formData, timeLimit: Number(e.target.value) })}
                            className={`${glassInputStyle} w-full`}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmDueDateLabel')} <span className="text-red-500 font-normal">*</span>
                        </label>
                        <GlassDateTimePicker
                            value={formData.dueDate}
                            onChange={v => setFormData({ ...formData, dueDate: v })}
                            placeholder={t('professor.qmDueDatePicker')}
                        />
                    </div>
                </div>

                {/* Scheduled-window + derived total row.
                    `Starts At` anchors a global timer — once it passes, every
                    student shares the same end (startsAt + timeLimit). The
                    Total Marks figure is now derived from the running sum of
                    per-question points (no more two-numbers-out-of-sync). */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmStartsAtLabel')} <span className="text-red-500 font-normal">*</span>
                        </label>
                        <GlassDateTimePicker
                            value={startsAt}
                            onChange={setStartsAt}
                            placeholder={t('professor.qmStartsAtPicker')}
                        />
                        <p className="text-[11px] text-[#7B5AFF] mt-1.5 flex items-center gap-1">
                            <i className="ph-bold ph-info"></i>
                            {t('professor.qmTimerHint')}
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">
                            {t('professor.qmTotalMarksLabel')}
                        </label>
                        <div className={`${glassInputStyle} w-full flex items-center justify-between`}>
                            <span className="text-2xl font-bold text-[#6A3FF4]">{derivedTotal}</span>
                            <span className="text-[10px] uppercase tracking-wider text-gray-500">
                                {t('professor.qmSumQuestionPoints')}
                            </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1.5">
                            {t('professor.qmPointsHint')}
                        </p>
                    </div>
                </div>

                {/* Audience picker — whole class vs. specific students */}
                <div className="pt-2 border-t border-white/5">
                    <label className="block text-xs font-bold text-gray-500 mb-2">{t('professor.qmAudienceLabel')}</label>
                    <div className="flex gap-2 mb-3">
                        <button
                            type="button"
                            onClick={() => setAudienceMode('all')}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                audienceMode === 'all'
                                    ? 'bg-[#6A3FF4] text-white'
                                    : 'bg-white/5 hover:bg-[#6A3FF4]/20 text-gray-400'
                            }`}
                        >
                            <i className="ph-bold ph-users mr-1"></i> {t('professor.qmWholeClass')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAudienceMode('specific')}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                audienceMode === 'specific'
                                    ? 'bg-[#6A3FF4] text-white'
                                    : 'bg-white/5 hover:bg-[#6A3FF4]/20 text-gray-400'
                            }`}
                        >
                            <i className="ph-bold ph-user-focus mr-1"></i> {t('professor.qmSpecificStudents')}
                        </button>
                    </div>

                    {audienceMode === 'specific' && (
                        <div className="space-y-2">
                            <input
                                type="text"
                                value={studentSearch}
                                onChange={e => setStudentSearch(e.target.value)}
                                placeholder={t('professor.qmSearchByNameEmail')}
                                className={`${glassInputStyle} w-full py-2`}
                            />
                            <div className="max-h-56 overflow-y-auto border border-white/10 rounded-xl">
                                {filteredStudents.length === 0 && (
                                    <div className="p-4 text-center text-xs text-gray-500">
                                        {students.length === 0 ? t('professor.qmNoEnrolledForCourse') : t('professor.qmNoStudentsMatch')}
                                    </div>
                                )}
                                {filteredStudents.map(s => {
                                    const checked = selectedStudentIds.has(s.id);
                                    const toggle = () => {
                                        setSelectedStudentIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(s.id)) next.delete(s.id);
                                            else next.add(s.id);
                                            return next;
                                        });
                                    };
                                    return (
                                        <div
                                            key={s.id}
                                            onClick={toggle}
                                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                                                checked ? 'bg-[#6A3FF4]/15' : 'hover:bg-white/5'
                                            }`}
                                        >
                                            <GlassCheckbox checked={checked} onChange={toggle} size="sm" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-black dark:text-white truncate">
                                                    {s.firstName} {s.lastName}
                                                </p>
                                                <p className="text-[11px] text-gray-500 truncate">{s.email}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[11px] text-gray-500">
                                {t('professor.qmStudentsSelected', { n: selectedStudentIds.size, suffix: selectedStudentIds.size === 1 ? '' : 's' })}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Question Builder */}
            <div className={`${glassCardStyle} p-6 space-y-4 border-l-4 border-l-[#6A3FF4]`}>
                <h3 className="font-bold text-black dark:text-white">{t('professor.qmAddQuestionHeader')}</h3>

                <div className="flex flex-wrap gap-3">
                    <div className="min-w-[180px]">
                        <GlassDropdown
                            value={newQuestion.type ?? 'mcq'}
                            onChange={v => setNewQuestion({ ...newQuestion, type: v as 'mcq' | 'written' })}
                            options={[
                                { value: 'mcq', label: t('professor.qmMcqType') },
                                { value: 'written', label: t('professor.qmWrittenType') },
                            ]}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                    <input
                        type="number"
                        value={newQuestion.points}
                        onChange={e => setNewQuestion({ ...newQuestion, points: Number(e.target.value) })}
                        className={`${glassInputStyle} w-24`}
                        placeholder={t('professor.qmPointsShort')}
                    />
                </div>

                <div>
                    <MarkdownToolbar
                        textareaRef={questionTextRef}
                        value={newQuestion.text || ''}
                        onChange={(next) => setNewQuestion({ ...newQuestion, text: next })}
                        compact
                    />
                    <textarea
                        ref={questionTextRef}
                        value={newQuestion.text || ''}
                        onChange={e => setNewQuestion({ ...newQuestion, text: e.target.value })}
                        className={`${glassInputStyle} w-full resize-none`}
                        rows={3}
                        placeholder={t('professor.qmQuestionTextPlaceholder')}
                    />
                </div>

                {newQuestion.type === 'mcq' && (
                    <div className="space-y-2 pl-4">
                        {newQuestion.options?.map((opt, i) => (
                            <div key={i} className="flex gap-2 items-center">
                                <input
                                    type="radio"
                                    name="correct-opt"
                                    checked={newQuestion.correctAnswer === opt && opt !== ''}
                                    onChange={() => setNewQuestion({ ...newQuestion, correctAnswer: opt })}
                                />
                                <input
                                    type="text"
                                    value={opt}
                                    onChange={e => {
                                        const newOpts = [...newQuestion.options!];
                                        newOpts[i] = e.target.value;
                                        setNewQuestion({ ...newQuestion, options: newOpts });
                                    }}
                                    className={`${glassInputStyle} flex-1 py-1`}
                                    placeholder={t('professor.qmOptionLabel', { n: i + 1 })}
                                />
                            </div>
                        ))}
                    </div>
                )}

                <button
                    onClick={addQuestion}
                    className="w-full py-2 bg-gray-200 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 rounded-lg font-bold transition-colors"
                >
                    {t('professor.qmAddQuestionBtn')}
                </button>
            </div>

            {/* Questions Preview */}
            <div className="space-y-2">
                {formData.questions.map((q, i) => (
                    <div key={q.id} className="p-3 bg-white/5 rounded-lg flex justify-between items-center">
                        <span className="font-medium text-sm"><span className="text-[#6A3FF4] font-bold mr-2">Q{i + 1}</span> {q.text}</span>
                        <span className="text-xs bg-black/20 px-2 py-1 rounded">{q.type} • {q.points}pts</span>
                    </div>
                ))}
            </div>

            <button
                onClick={handleSubmit}
                className="w-full py-3 bg-[#6A3FF4] hover:bg-[#5835CC] text-white rounded-xl font-bold shadow-lg shadow-purple-500/20"
            >
                {mode === 'edit' ? t('professor.qmSaveChanges') : t('professor.qmSaveQuiz')}
            </button>
        </div>
    );
};

/**
 * GradingView
 *
 * Loads the full quiz detail (with questions) on mount — the listing API
 * only returns summary fields, so trying to grade off the row was hitting
 * `quiz.questions.find` on undefined and crashing.
 *
 * Per-row override: any submission can have its score overridden directly.
 * Useful when the auto-graded MCQ score is fine but the staff wants to bump
 * it up, or zero-out a flagged attempt.
 *
 * Per-question grade view: still here for written answers — the staff can
 * award partial credit per question, plus see correctness markers on the
 * MCQ rows.
 */
const GradingView: React.FC<{ quiz: Quiz; onBack: () => void }> = ({ quiz, onBack }) => {
    const t = useT();
    interface SubmissionRow extends QuizSubmission {
        studentName?: string;
        studentEmail?: string;
    }
    const [fullQuiz, setFullQuiz] = useState<Quiz | null>(null);
    const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
    const [selectedSub, setSelectedSub] = useState<SubmissionRow | null>(null);
    const [perQuestionScores, setPerQuestionScores] = useState<Record<string, number>>({});
    const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
    const [overrideSavingId, setOverrideSavingId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    // Load the full quiz (with questions) AND submissions in parallel.
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        Promise.all([
            fetch(`${API_URLS.courseContent()}/api/quizzes/${quiz.id}`, {
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
            }).then(r => (r.ok ? r.json() : null)),
            fetchQuizSubmissions(quiz.id),
        ]).then(([quizData, subs]) => {
            if (quizData) setFullQuiz(quizData);
            setSubmissions(Array.isArray(subs) ? subs : []);
        });
    }, [quiz.id]);

    // Refresh just the submissions list (after a save).
    const reloadSubmissions = () => {
        fetchQuizSubmissions(quiz.id).then(s => setSubmissions(Array.isArray(s) ? s : []));
    };

    const handleGradeSubmit = async () => {
        if (!selectedSub) return;
        try {
            const success = await gradeQuizSubmission(quiz.id, selectedSub.id, perQuestionScores);
            if (success) {
                setFeedback({ kind: 'success', text: t('professor.qmPerQuestionSaved') });
                setSelectedSub(null);
                reloadSubmissions();
            } else {
                setFeedback({ kind: 'error', text: t('professor.qmCouldNotSaveGrades') });
            }
        } catch {
            setFeedback({ kind: 'error', text: t('professor.qmNetworkSavingGrades') });
        }
        setTimeout(() => setFeedback(null), 2500);
    };

    const handleOverride = async (sub: SubmissionRow) => {
        const raw = overrideInputs[sub.id];
        if (raw == null || raw === '') return;
        const score = Number(raw);
        if (!Number.isFinite(score) || score < 0) {
            setFeedback({ kind: 'error', text: t('professor.qmOverrideBadNum') });
            return;
        }
        setOverrideSavingId(sub.id);
        try {
            const token = localStorage.getItem('authToken');
            const res = await fetch(
                `${API_URLS.courseContent()}/api/quizzes/${quiz.id}/submissions/${sub.id}/override`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ score }),
                }
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setFeedback({ kind: 'error', text: body.error || t('professor.qmOverrideFailed') });
            } else {
                setFeedback({ kind: 'success', text: t('professor.qmScoreOverridden') });
                setOverrideInputs(prev => {
                    const next = { ...prev };
                    delete next[sub.id];
                    return next;
                });
                reloadSubmissions();
            }
        } catch {
            setFeedback({ kind: 'error', text: t('professor.qmOverrideNetwork') });
        } finally {
            setOverrideSavingId(null);
            setTimeout(() => setFeedback(null), 2500);
        }
    };

    // The detail view — per-question grading (only meaningful when written
    // answers exist; MCQs are auto-graded on submit).
    if (selectedSub) {
        const questions = fullQuiz?.questions ?? [];
        const answers = selectedSub.answers ?? [];
        return (
            <div className="space-y-6">
                <button
                    onClick={() => setSelectedSub(null)}
                    className="text-gray-500 hover:text-white flex items-center gap-2"
                >
                    <i className="ph-bold ph-arrow-left"></i> {t('professor.qmBackToSubmissions')}
                </button>

                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex items-start justify-between mb-4 gap-3">
                        <div>
                            <h3 className="font-bold text-lg text-black dark:text-white">
                                {selectedSub.studentName || selectedSub.userId}
                            </h3>
                            {selectedSub.studentEmail && (
                                <p className="text-xs text-gray-500">{selectedSub.studentEmail}</p>
                            )}
                        </div>
                        <span
                            className={`text-xs font-bold px-2 py-1 rounded-md ${
                                selectedSub.status === 'graded'
                                    ? 'bg-green-500/20 text-green-500'
                                    : 'bg-yellow-500/20 text-yellow-500'
                            }`}
                        >
                            {selectedSub.status === 'graded'
                                ? t('professor.qmAutoGraded', { score: selectedSub.totalScore ?? selectedSub.score ?? 0, max: selectedSub.maxPoints ?? '?' })
                                : t('professor.qmPendingReview')}
                        </span>
                    </div>

                    {answers.length === 0 ? (
                        <p className="text-sm text-gray-500 italic">
                            {t('professor.qmThisSubmissionEmpty')}
                        </p>
                    ) : (
                        <div className="space-y-6">
                            {answers.map((ans, idx) => {
                                const question = questions.find(q => q.id === ans.questionId);
                                const isMcq = (ans.type ?? question?.type) === 'mcq';
                                return (
                                    <div key={ans.questionId ?? idx} className="border-b border-white/10 pb-4">
                                        <p className="font-medium mb-2 text-black dark:text-white">
                                            <span className="text-[#6A3FF4] mr-2">Q{idx + 1}.</span>
                                            {question?.text ?? t('professor.qmQuestionMissing')}
                                        </p>
                                        <div className="bg-white/5 p-3 rounded-lg mb-2">
                                            <span className="text-xs text-gray-400 block mb-1">
                                                {t('professor.qmStudentAnswerLabel')}
                                            </span>
                                            <p className="text-sm text-black dark:text-white whitespace-pre-wrap">
                                                {ans.userAnswer ?? <span className="italic text-gray-500">{t('professor.qmNoAnswer')}</span>}
                                            </p>
                                        </div>

                                        {isMcq ? (
                                            <div className={`text-sm ${ans.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                                                {ans.isCorrect
                                                    ? t('professor.qmCorrectSuffix', { n: ans.pointsAwarded ?? question?.points ?? 0 })
                                                    : t('professor.qmIncorrectSuffix', { a: question?.correctAnswer ?? '?' })}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <label className="text-sm text-gray-500">
                                                    {t('professor.qmScoreMaxLabel', { n: question?.points ?? 0 })}
                                                </label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={question?.points ?? undefined}
                                                    className={`${glassInputStyle} w-24 py-1.5`}
                                                    value={
                                                        perQuestionScores[ans.questionId] ??
                                                        ans.pointsAwarded ??
                                                        0
                                                    }
                                                    onChange={e =>
                                                        setPerQuestionScores({
                                                            ...perQuestionScores,
                                                            [ans.questionId]: Number(e.target.value),
                                                        })
                                                    }
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <button
                        onClick={handleGradeSubmit}
                        className="mt-6 w-full py-3 bg-[#6A3FF4] hover:bg-[#5835CC] text-white rounded-xl font-bold"
                    >
                        {t('professor.qmSavePerQuestion')}
                    </button>
                </div>
            </div>
        );
    }

    // The list view — every submission with override input + grade button.
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-full hover:bg-white/10 transition-colors"
                >
                    <i className="ph-bold ph-arrow-left"></i>
                </button>
                <h2 className="text-xl font-bold text-black dark:text-white">
                    {t('professor.qmSubmissionsTitle', { title: quiz.title })}
                </h2>
            </div>

            {feedback && (
                <div
                    className={`rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${
                        feedback.kind === 'success'
                            ? 'bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400'
                            : 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400'
                    }`}
                >
                    <i className={`ph-bold ${feedback.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}`}></i>
                    {feedback.text}
                </div>
            )}

            <div className="grid gap-2">
                {submissions.map(sub => {
                    const score = sub.totalScore ?? sub.score ?? null;
                    const max = sub.maxPoints ?? quiz.totalPoints ?? null;
                    return (
                        <div key={sub.id} className={`${glassCardStyle} p-4`}>
                            <div className="flex flex-wrap justify-between items-center gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-black dark:text-white truncate">
                                        {sub.studentName || sub.userId}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {sub.studentEmail ? `${sub.studentEmail} · ` : ''}
                                        {sub.submittedAt
                                            ? t('professor.qmSubmittedPrefix', { date: new Date(sub.submittedAt).toLocaleString() })
                                            : sub.startedAt
                                            ? t('professor.qmStartedPrefix', { date: new Date(sub.startedAt).toLocaleString() })
                                            : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <span
                                        className={`px-2 py-1 rounded text-xs font-bold ${
                                            sub.status === 'graded'
                                                ? 'bg-green-500/20 text-green-500'
                                                : sub.status === 'pending_review'
                                                ? 'bg-blue-500/20 text-blue-500'
                                                : 'bg-yellow-500/20 text-yellow-500'
                                        }`}
                                    >
                                        {sub.status === 'graded'
                                            ? `${score ?? 0}${max != null ? ` / ${max}` : ''}`
                                            : sub.status === 'pending_review'
                                            ? t('professor.qmNeedsReview')
                                            : t('professor.qmInProgress')}
                                    </span>
                                    <button
                                        onClick={() => {
                                            setSelectedSub(sub);
                                            // Pre-populate per-question scores with whatever was
                                            // auto-awarded so MCQ rows aren't overwritten on save.
                                            const seed: Record<string, number> = {};
                                            (sub.answers ?? []).forEach(a => {
                                                if (a.pointsAwarded != null && a.questionId) {
                                                    seed[a.questionId] = a.pointsAwarded;
                                                }
                                            });
                                            setPerQuestionScores(seed);
                                        }}
                                        className="bg-[#6A3FF4] hover:bg-[#5835CC] text-white px-3 py-1.5 rounded-lg text-sm font-bold"
                                    >
                                        {t('professor.qmGradeBtn')}
                                    </button>
                                </div>
                            </div>
                            {/* Override row — overall score override, separate from
                                per-question grading. Confirm-on-press; the backend
                                rejects scores beyond maxPoints. */}
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                                    {t('professor.qmOverrideTotal')}
                                </span>
                                <input
                                    type="number"
                                    min={0}
                                    max={max ?? undefined}
                                    placeholder={max != null ? t('professor.qmOverrideRange', { max }) : t('professor.qmOverridePlaceholder')}
                                    value={overrideInputs[sub.id] ?? ''}
                                    onChange={e =>
                                        setOverrideInputs({
                                            ...overrideInputs,
                                            [sub.id]: e.target.value,
                                        })
                                    }
                                    className={`${glassInputStyle} w-24 py-1.5 text-xs`}
                                />
                                <button
                                    onClick={() => handleOverride(sub)}
                                    disabled={!overrideInputs[sub.id] || overrideSavingId === sub.id}
                                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {overrideSavingId === sub.id ? t('professor.qmSavingShort') : t('professor.qmOverrideBtn')}
                                </button>
                            </div>
                        </div>
                    );
                })}
                {submissions.length === 0 && (
                    <p className="text-center text-gray-500 py-8">{t('professor.qmNoSubmissions')}</p>
                )}
            </div>
        </div>
    );
};

// --- MAIN PAGE ---

const QuizManagement: React.FC = () => {
    const t = useT();
    const [view, setView] = useState<'list' | 'create' | 'edit' | 'grade'>('list');
    const [quizzes, setQuizzes] = useState<Quiz[]>([]);
    const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);
    const [editTarget, setEditTarget] = useState<Quiz | null>(null);
    const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
    const [courseFilter, setCourseFilter] = useState<string>('all');

    // Resolve the staff's role from localStorage so we can hit the right
    // course-list endpoint for the current user — page is reused at both
    // /professor/quiz-management and /ta/quiz-management.
    const role = (localStorage.getItem('currentUserRole') || '').toLowerCase();

    const loadCourses = async () => {
        const email = localStorage.getItem('currentUserEmail') || '';
        const token = localStorage.getItem('authToken');
        if (!email) return;
        const path = role === 'ta' ? 'ta' : 'professor';
        try {
            const res = await fetch(
                `${API_URLS.courseContent()}/api/${path}/courses-detailed/${email}`,
                {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            if (!res.ok) {
                setCourseOptions([]);
                return;
            }
            const data: { code: string; name: string }[] = await res.json();
            setCourseOptions(
                Array.isArray(data) ? data.map(c => ({ code: c.code, name: c.name })) : []
            );
        } catch {
            setCourseOptions([]);
        }
    };

    const loadQuizzes = async () => {
        const result = await fetchQuizzes();
        setQuizzes(Array.isArray(result) ? result : []);
    };

    useEffect(() => {
        loadCourses();
        loadQuizzes();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Visible quizzes: only those tied to a course this staff member teaches.
    // Then narrow further by the course-filter pill.
    const visibleQuizzes = useMemo(() => {
        const taughtCodes = new Set(courseOptions.map(c => c.code));
        const taught = quizzes.filter(q => taughtCodes.has(q.courseCode));
        if (courseFilter === 'all') return taught;
        return taught.filter(q => q.courseCode === courseFilter);
    }, [quizzes, courseOptions, courseFilter]);

    const handleCreate = async (
        quizData: Omit<Quiz, 'id'> & { audienceUserIds?: string[] }
    ) => {
        await createQuiz(quizData);
        await loadQuizzes();
        setView('list');
    };

    const handleEditOpen = async (quiz: Quiz) => {
        // Hydrate the row by fetching the full quiz detail (with questions
        // + audienceUserIds + startsAt) — the listing API only returns a
        // summary so we can't safely populate the editor from it.
        const token = localStorage.getItem('authToken');
        try {
            const res = await fetch(
                `${API_URLS.courseContent()}/api/quizzes/${quiz.id}`,
                {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            if (!res.ok) {
                alert(t('professor.qmCouldNotLoadQuiz'));
                return;
            }
            const full = await res.json();
            setEditTarget({ ...quiz, ...full, courseCode: quiz.courseCode });
            setView('edit');
        } catch {
            alert(t('professor.qmNetworkErrLoad'));
        }
    };

    const handleEditSave = async (
        quizData: Omit<Quiz, 'id'> & {
            audienceUserIds?: string[];
            startsAt?: string | null;
            totalPoints?: number | null;
        }
    ) => {
        if (!editTarget) return;
        const token = localStorage.getItem('authToken');
        try {
            const res = await fetch(
                `${API_URLS.courseContent()}/api/quizzes/${editTarget.id}`,
                {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(quizData),
                }
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                alert(body.error || t('professor.qmCouldNotSaveChanges'));
                return;
            }
            await loadQuizzes();
            setEditTarget(null);
            setView('list');
        } catch {
            alert(t('professor.qmNetworkErrSave'));
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm(t('professor.qmConfirmDelete'))) {
            await deleteQuiz(id);
            await loadQuizzes();
        }
    };

    return (
        <div className="container mx-auto px-4 pb-20 p-6">
            <AnimateOnView>
                <div className="mb-8">
                    <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('professor.quizMgmtTitle')}</h1>
                    <p className="text-gray-500 dark:text-gray-400">{t('professor.quizMgmtSubtitle')}</p>
                </div>
            </AnimateOnView>

            {view === 'list' && (
                <QuizList
                    quizzes={visibleQuizzes}
                    courseFilter={courseFilter}
                    onCourseFilter={setCourseFilter}
                    courseOptions={courseOptions}
                    onCreate={() => setView('create')}
                    onSelect={q => { setSelectedQuiz(q); setView('grade'); }}
                    onEdit={handleEditOpen}
                    onDelete={handleDelete}
                />
            )}

            {view === 'create' && (
                <QuizCreator
                    onCancel={() => setView('list')}
                    onSave={handleCreate}
                    courseOptions={courseOptions}
                />
            )}

            {view === 'edit' && editTarget && (
                <QuizCreator
                    onCancel={() => { setEditTarget(null); setView('list'); }}
                    onSave={handleEditSave}
                    courseOptions={courseOptions}
                    initialQuiz={editTarget}
                    mode="edit"
                />
            )}

            {view === 'grade' && selectedQuiz && (
                <GradingView
                    quiz={selectedQuiz}
                    onBack={() => { setSelectedQuiz(null); setView('list'); }}
                />
            )}
        </div>
    );
};

export default QuizManagement;
