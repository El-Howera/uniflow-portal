import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useGradingRules, percentToLetter } from '../../utils/gradingRules';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface Entry {
    id: string;
    component: string | null;
    score: number | null;
    maxScore: number | null;
    gradePoints: number | null;
    letterGrade: string | null;
    isFinal: boolean;
    comments: string | null;
    updatedAt: string;
}

interface TranscriptRow {
    id: string;
    grade: string;
    qualityPoints: number;
    credits: number;
    semester: { id: string; name: string };
}

interface OverrideHistoryRow {
    id: string;
    oldGrade: string | null;
    newGrade: string;
    reason: string;
    createdAt: string;
    overriddenBy: string | null;
}

interface DetailData {
    student: { id: string; name: string; email: string; major: string | null; level: number | null; gpa: number | null };
    course: { id: string; code: string; title: string; credits: number };
    entries: Entry[];
    transcript: TranscriptRow[];
    overrides: OverrideHistoryRow[];
}

// LETTER_OPTIONS used to be hardcoded here. The grading scale is now
// pulled from `SystemSettings.gradingRules.scale` via `useGradingRules()`
// inside the page component, so admin scale edits in Settings flow through
// without a redeploy.

const GRADE_PILL: Record<string, string> = {
    'A':  'bg-green-500/15 text-green-400',
    'A-': 'bg-green-500/15 text-green-400',
    'B+': 'bg-emerald-500/15 text-emerald-400',
    'B':  'bg-emerald-500/15 text-emerald-400',
    'B-': 'bg-blue-500/15 text-blue-400',
    'C+': 'bg-blue-500/15 text-blue-400',
    'C':  'bg-yellow-500/15 text-yellow-400',
    'C-': 'bg-yellow-500/15 text-yellow-400',
    'D+': 'bg-orange-500/15 text-orange-400',
    'D':  'bg-orange-500/15 text-orange-400',
    'F':  'bg-red-500/15 text-red-400',
};

// Per-component edit draft. Mirrors what the user typed; submitted alongside
// the final letter override in a single POST. No per-row letter — the
// "New Final Grade" dropdown below is the single source of truth for the
// final letter, which the cascade syncs onto the Final gradebook entry.
type EntryDraft = {
    id: string;
    score: string;       // string so the input stays controlled while empty
    maxScore: string;
};

// Preview mock — synthesised per-student gradebook detail. Course meta + the
// student identity come from the route param so the header reads correctly.
const MOCK_STUDENTS: Record<string, { name: string; email: string; major: string | null; level: number | null; gpa: number | null }> = {
    'u-omar': { name: 'Omar Khaled', email: 'omar.khaled@fcds.edu', major: 'Computer Science', level: 2, gpa: 3.42 },
    'u-sara': { name: 'Sara Mahmoud', email: 'sara.mahmoud@fcds.edu', major: 'Computer Science', level: 2, gpa: 3.88 },
    'u-youssef': { name: 'Youssef Tarek', email: 'youssef.tarek@fcds.edu', major: 'Data Science', level: 3, gpa: 2.97 },
    'u-nour': { name: 'Nour Hassan', email: 'nour.hassan@fcds.edu', major: 'Computer Science', level: 1, gpa: 3.15 },
    'u-laila': { name: 'Laila Ibrahim', email: 'laila.ibrahim@fcds.edu', major: 'Mathematics', level: 2, gpa: 3.60 },
    'u-karim': { name: 'Karim Adel', email: 'karim.adel@fcds.edu', major: 'Cybersecurity', level: 3, gpa: 2.45 },
    'u-mariam': { name: 'Mariam Saeed', email: 'mariam.saeed@fcds.edu', major: 'Data Science', level: 2, gpa: 3.71 },
    'u-ali': { name: 'Ali Mostafa', email: 'ali.mostafa@fcds.edu', major: 'Computer Science', level: 1, gpa: 1.92 },
};

const MOCK_COURSE_META: Record<string, { title: string; credits: number }> = {
    CS101: { title: 'Introduction to Computer Science', credits: 3 },
    CS102: { title: 'Programming Fundamentals', credits: 4 },
    CS201: { title: 'Data Structures & Algorithms', credits: 4 },
    CS305: { title: 'Database Systems', credits: 3 },
    DS210: { title: 'Statistical Foundations of Data Science', credits: 3 },
    DS340: { title: 'Machine Learning', credits: 4 },
    MA205: { title: 'Linear Algebra', credits: 3 },
    MA110: { title: 'Calculus I', credits: 4 },
    CY301: { title: 'Network Security', credits: 3 },
};

const buildMockDetail = (courseCode: string, userId: string): DetailData => {
    const code = courseCode.toUpperCase();
    const meta = MOCK_COURSE_META[code] ?? { title: 'Course', credits: 3 };
    const student = MOCK_STUDENTS[userId] ?? {
        name: 'Student', email: 'student@fcds.edu', major: 'Computer Science', level: 1, gpa: 3.0,
    };
    const semester = { id: 'sem-spring-2026', name: 'Spring 2026' };
    return {
        student: { id: userId, ...student },
        course: { id: `c-${code}`, code, title: meta.title, credits: meta.credits },
        entries: [
            { id: `${userId}-quiz1`, component: 'Quiz 1', score: 8, maxScore: 10, gradePoints: null, letterGrade: null, isFinal: false, comments: null, updatedAt: '2026-03-02T10:00:00.000Z' },
            { id: `${userId}-quiz2`, component: 'Quiz 2', score: 7, maxScore: 10, gradePoints: null, letterGrade: null, isFinal: false, comments: null, updatedAt: '2026-03-20T10:00:00.000Z' },
            { id: `${userId}-assign`, component: 'Assignments', score: 18, maxScore: 20, gradePoints: null, letterGrade: null, isFinal: false, comments: null, updatedAt: '2026-04-05T10:00:00.000Z' },
            { id: `${userId}-mid`, component: 'Midterm', score: 21, maxScore: 25, gradePoints: null, letterGrade: null, isFinal: false, comments: null, updatedAt: '2026-04-12T10:00:00.000Z' },
            { id: `${userId}-final`, component: 'Final', score: 30, maxScore: 35, gradePoints: 3.0, letterGrade: 'B', isFinal: true, comments: null, updatedAt: '2026-05-10T10:00:00.000Z' },
        ],
        transcript: [
            { id: `${userId}-tc`, grade: 'B', qualityPoints: 3.0 * meta.credits, credits: meta.credits, semester },
        ],
        overrides: [],
    };
};

const GradeOverrideStudentPage: React.FC = () => {
    const t = useT();
    const { courseCode, userId } = useParams<{ courseCode: string; userId: string }>();
    const navigate = useNavigate();
    // Grading rules drive the letter dropdown options AND the live
    // percentage→letter mapping. Pulled from SystemSettings.gradingRules.
    const rules = useGradingRules();
    const [data, setData] = useState<DetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    // Override form state — bundles the final letter + the per-component
    // drafts so a single Apply button confirms both.
    const [newGrade, setNewGrade] = useState('A');
    // Tracks whether the admin has manually picked a letter from the
    // dropdown. While false, the auto-sync from live percentage drives
    // newGrade; once the admin overrides, we stop overwriting their choice.
    const [letterManuallyOverridden, setLetterManuallyOverridden] = useState(false);
    const [reason, setReason] = useState('');
    const [drafts, setDrafts] = useState<Record<string, EntryDraft>>({});
    const [submitting, setSubmitting] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveOk, setSaveOk] = useState<string | null>(null);

    // Build dropdown options from the active scale (descending minPercent so
    // the menu reads top → bottom from highest letter to lowest).
    const letterOptions = (() => {
        const sorted = [...rules.scale].sort((a, b) => b.minPercent - a.minPercent);
        return sorted.map((row) => ({ value: row.letter, label: row.letter }));
    })();

    // Build the initial draft set from server data so the form starts where
    // the user left off, not blank.
    const seedDrafts = (entries: Entry[]) => {
        const out: Record<string, EntryDraft> = {};
        entries.forEach((e) => {
            out[e.id] = {
                id: e.id,
                score:    e.score    != null ? String(e.score)    : '',
                maxScore: e.maxScore != null ? String(e.maxScore) : '',
            };
        });
        return out;
    };

    const load = useCallback(async () => {
        if (!courseCode || !userId) return;
        setLoading(true);
        setErr(null);
        // Preview mode — synthesise the gradebook detail from static mock data.
        const json = buildMockDetail(courseCode, userId);
        setData(json);
        setDrafts(seedDrafts(json.entries));
        // Pre-fill the dropdown with the most recent transcript grade if any.
        if (json.transcript[0]?.grade) {
            setNewGrade(json.transcript[0].grade);
        }
        setLoading(false);
    }, [courseCode, userId]);

    useEffect(() => { load(); }, [load]);

    // Compute which drafts actually differ from the server values so we
    // only POST rows that have been touched. Per-row letter is no longer
    // editable here — the chosen Final Grade syncs onto the Final entry
    // via the cascade — so we only diff score + maxScore.
    const dirtyEntries = (() => {
        if (!data) return [];
        const out: { id: string; score?: number | null; maxScore?: number }[] = [];
        for (const e of data.entries) {
            const d = drafts[e.id];
            if (!d) continue;
            // Clamp maxScore to [0, 100] and score to [0, maxScore] so a paste
            // or dev-tools bypass can't push values past the input's max attr.
            const rawMax      = d.maxScore === '' ? undefined : Number(d.maxScore);
            const newMaxScore = rawMax !== undefined && Number.isFinite(rawMax)
                ? Math.min(100, Math.max(0, rawMax))
                : undefined;
            const ceiling     = newMaxScore ?? (e.maxScore ?? 100);
            const rawScore    = d.score === '' ? null : Number(d.score);
            const newScore    = rawScore !== null && Number.isFinite(rawScore)
                ? Math.min(ceiling, Math.max(0, rawScore))
                : rawScore;
            const scoreChanged    = (e.score ?? null) !== newScore;
            const maxChanged      = newMaxScore !== undefined && (e.maxScore ?? null) !== newMaxScore;
            if (scoreChanged || maxChanged) {
                out.push({
                    id: e.id,
                    ...(scoreChanged ? { score: newScore } : {}),
                    ...(maxChanged   ? { maxScore: newMaxScore } : {}),
                });
            }
        }
        return out;
    })();

    // Live preview: total earned / max + derived percent. Helps the admin
    // see what the natural letter would be from the marks they've entered.
    const totals = (() => {
        let earned = 0;
        let max = 0;
        for (const e of data?.entries ?? []) {
            const d = drafts[e.id];
            if (!d) continue;
            const s = Number(d.score);
            const m = Number(d.maxScore);
            if (Number.isFinite(s)) earned += s;
            if (Number.isFinite(m)) max += m;
        }
        const pct = max > 0 ? (earned / max) * 100 : 0;
        return { earned, max, pct };
    })();

    // Letter that the active grading scale assigns to the live percentage.
    // Empty string when there are no marks to compute against.
    const derivedLetter = totals.max > 0 ? percentToLetter(totals.pct, rules) : '';

    // Auto-sync: while the admin hasn't manually overridden, keep newGrade
    // pinned to the derived letter. Once they pick from the dropdown we
    // stop pushing — they take control.
    useEffect(() => {
        if (letterManuallyOverridden) return;
        if (derivedLetter && derivedLetter !== newGrade) {
            setNewGrade(derivedLetter);
        }
    }, [derivedLetter, letterManuallyOverridden, newGrade]);

    const updateDraft = (id: string, patch: Partial<EntryDraft>) =>
        setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    const handleApply = async () => {
        if (!data) return;
        if (!reason.trim()) { setSaveError(t('admin.goReasonRequiredError')); return; }
        if (!newGrade)      { setSaveError(t('admin.goPickFinalLetterError')); return; }
        setSubmitting(true);
        setSaveError(null);
        setSaveOk(null);

        // Preview mode — apply the override locally. No network call. Mutate the
        // transcript grade + any edited component scores in place and append a
        // history row so the page reflects the change immediately.
        const currentTranscript = data.transcript[0] ?? null;
        const oldGrade = currentTranscript?.grade ?? null;
        const dirtyMap = new Map(dirtyEntries.map((d) => [d.id, d]));

        setData((prev) => {
            if (!prev) return prev;
            const updatedEntries = prev.entries.map((e) => {
                const patch = dirtyMap.get(e.id);
                const next: Entry = {
                    ...e,
                    ...(patch && 'score' in patch ? { score: patch.score ?? null } : {}),
                    ...(patch && 'maxScore' in patch ? { maxScore: patch.maxScore ?? e.maxScore } : {}),
                };
                if (e.isFinal) next.letterGrade = newGrade;
                return next;
            });
            const updatedTranscript = prev.transcript.map((t0, idx) =>
                idx === 0 ? { ...t0, grade: newGrade } : t0,
            );
            const newOverride: OverrideHistoryRow = {
                id: `local-${Date.now()}`,
                oldGrade,
                newGrade,
                reason: reason.trim(),
                createdAt: new Date().toISOString(),
                overriddenBy: 'Admin (Mohamed Howera)',
            };
            return {
                ...prev,
                entries: updatedEntries,
                transcript: updatedTranscript,
                overrides: [newOverride, ...prev.overrides],
            };
        });

        const editsLabel = dirtyEntries.length > 0
            ? t('admin.goComponentEditsApplied', { n: dirtyEntries.length })
            : '';
        setSaveOk(
            t('admin.goOverrideAppliedTpl', {
                edits: editsLabel,
                semGpa: (data.student.gpa ?? 0).toFixed(2),
                cumGpa: (data.student.gpa ?? 0).toFixed(2),
                acadGpa: (data.student.gpa ?? 0).toFixed(2),
            }),
        );
        setReason('');
        setSubmitting(false);
    };

    if (loading) return <div className={`${glassCardStyle} p-12 text-center text-gray-500 animate-pulse`}>{t('admin.goLoadingStudent')}</div>;
    if (err)     return <div className={`${glassCardStyle} p-8 text-center text-red-400`}>{err}</div>;
    if (!data)   return null;

    const currentTranscript = data.transcript[0];

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div>
                    <button
                        onClick={() => navigate(`/admin/grade-override/${encodeURIComponent(data.course.code)}`)}
                        className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                    >
                        <i className="ph-bold ph-arrow-left" /> {t('admin.goRosterBack', { code: data.course.code })}
                    </button>
                    <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">{data.student.name}</h1>
                    <p className="text-gray-500 text-sm">
                        {data.student.email} · {data.course.code} {data.course.title}
                    </p>
                </div>
            </AnimateOnView>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryTile
                    label={t('admin.goSummaryCurrentGrade')}
                    value={currentTranscript?.grade ?? '—'}
                    accent={currentTranscript?.grade
                        ? GRADE_PILL[currentTranscript.grade]?.replace('bg-', 'text-').replace('/15', '').split(' ')[0]
                        : 'text-gray-400'}
                />
                <SummaryTile label={t('admin.goSummaryQualityPoints')} value={currentTranscript?.qualityPoints?.toFixed(3) ?? '—'} />
                <SummaryTile label={t('admin.goSummaryCredits')} value={currentTranscript?.credits?.toString() ?? data.course.credits.toString()} />
                <SummaryTile label={t('admin.goSummaryCumulativeGpa')} value={data.student.gpa != null ? data.student.gpa.toFixed(2) : '—'} />
            </div>

            {/* Unified Apply Override panel — component edits + final letter
                + reason all confirmed by a single button. */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.goApplyOverrideHeading')}</h3>
                <p className="text-gray-500 text-xs mb-4">
                    {t('admin.goApplyOverrideHint1')}
                    <span className="text-gray-300"> {t('admin.goApplyHintTranscriptCourse')}</span> →
                    <span className="text-gray-300"> {t('admin.goApplyHintSemesterGpa')}</span> →
                    <span className="text-gray-300"> {t('admin.goApplyHintAcademicGpa')}</span>{t('admin.goApplyHintAuditSuffix')}
                </p>

                {/* Component editor table — score + max only. The "New Final
                    Grade" dropdown below is the single source of truth for
                    the letter; the cascade syncs it onto the Final entry. */}
                {data.entries.length === 0 ? (
                    <p className="text-gray-500 text-sm py-6 text-center bg-white/5 rounded-xl mb-4">
                        {t('admin.goNoGradebookEntries')}
                    </p>
                ) : (
                    <div className="overflow-x-auto mb-4">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-3 font-bold">{t('admin.goColComponent')}</th>
                                    <th className="text-right py-2 pr-3 font-bold">{t('admin.goColScore')}</th>
                                    <th className="text-right py-2 pr-3 font-bold">{t('admin.goColMax')}</th>
                                    <th className="text-left py-2 font-bold">{t('admin.goColStatus')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {data.entries.map((e) => {
                                    const d = drafts[e.id];
                                    if (!d) return null;
                                    const draftScore    = d.score    === '' ? null : Number(d.score);
                                    const draftMax      = d.maxScore === '' ? null : Number(d.maxScore);
                                    const dirty =
                                        (e.score    ?? null) !== draftScore  ||
                                        (e.maxScore ?? null) !== draftMax;
                                    return (
                                        <tr key={e.id} className={`transition-colors ${dirty ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5'}`}>
                                            <td className="py-2 pr-3">
                                                <div className="text-black dark:text-white font-medium">{e.component ?? '—'}</div>
                                                {dirty && <div className="text-[10px] text-[#7B5AFF] uppercase tracking-wider">{t('admin.goRowEdited')}</div>}
                                            </td>
                                            <td className="py-2 pr-3">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max={Number(d.maxScore) > 0 ? Number(d.maxScore) : 100}
                                                    value={d.score}
                                                    onChange={(ev) => updateDraft(e.id, { score: ev.target.value })}
                                                    // Select-all on every focus AND every click so typing
                                                    // always replaces the existing value. onFocus alone
                                                    // misses re-clicks while the input already has focus,
                                                    // which previously let "14" become "1014".
                                                    onFocus={(ev) => ev.currentTarget.select()}
                                                    onClick={(ev) => ev.currentTarget.select()}
                                                    className="w-20 bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-2 py-1 text-right text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                                                />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    value={d.maxScore}
                                                    onChange={(ev) => updateDraft(e.id, { maxScore: ev.target.value })}
                                                    onFocus={(ev) => ev.currentTarget.select()}
                                                    onClick={(ev) => ev.currentTarget.select()}
                                                    className="w-20 bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-2 py-1 text-right text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]"
                                                />
                                            </td>
                                            <td className="py-2">
                                                {e.isFinal ? (
                                                    <span className="inline-flex items-center gap-2">
                                                        <span className="text-[10px] font-bold uppercase text-[#7B5AFF]">{t('admin.goFinalLabel')}</span>
                                                        <span className="text-[10px] text-gray-500">{t('admin.goSyncsTo')}</span>
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${GRADE_PILL[newGrade] ?? 'bg-white/5 text-gray-400'}`}>
                                                            {newGrade}
                                                        </span>
                                                    </span>
                                                ) : <span className="text-gray-500 text-xs">—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            {totals.max > 0 && (
                                <tfoot>
                                    <tr className="border-t border-white/10">
                                        <td className="py-2 pr-3 text-gray-500 uppercase text-xs font-bold">{t('admin.goLiveTotal')}</td>
                                        <td className="py-2 pr-3 text-right text-gray-300 font-bold">{totals.earned.toFixed(1)}</td>
                                        <td className="py-2 pr-3 text-right text-gray-300 font-bold">{totals.max.toFixed(1)}</td>
                                        <td className="py-2 pr-3 text-[#7B5AFF] font-bold text-xs">
                                            {t('admin.goPreviewPct', { pct: totals.pct.toFixed(1) })}
                                        </td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}

                {/* Final letter + semester */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                            {t('admin.oldGrade')}
                        </label>
                        <div className={`${glassCardStyle} px-4 py-2 text-sm text-black dark:text-white`}>
                            {currentTranscript?.grade ?? <span className="italic text-gray-500">{t('admin.goNoneItalic')}</span>}
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-2">
                            {t('admin.goNewFinalGrade')}
                            {!letterManuallyOverridden && totals.max > 0 && (
                                <span className="text-[9px] normal-case bg-[#6A3FF4]/20 text-[#7B5AFF] px-1.5 py-0.5 rounded uppercase tracking-wider">
                                    {t('admin.goAutoFromPct', { pct: totals.pct.toFixed(1) })}
                                </span>
                            )}
                            {letterManuallyOverridden && (
                                <button
                                    type="button"
                                    onClick={() => setLetterManuallyOverridden(false)}
                                    className="text-[9px] normal-case bg-white/5 text-gray-400 hover:bg-[#6A3FF4]/20 hover:text-[#7B5AFF] px-1.5 py-0.5 rounded uppercase tracking-wider"
                                    title={t('admin.goResumeAutoSync')}
                                >
                                    {t('admin.goManualReset')}
                                </button>
                            )}
                        </label>
                        <GlassDropdown
                            value={newGrade}
                            onChange={(v) => { setLetterManuallyOverridden(true); setNewGrade(v); }}
                            options={letterOptions}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                            {t('admin.goColSemester')}
                        </label>
                        <div className={`${glassCardStyle} px-4 py-2 text-sm text-black dark:text-white`}>
                            {currentTranscript?.semester.name ?? <span className="italic text-gray-500">{t('admin.goNoSemesterFallback')}</span>}
                        </div>
                    </div>
                </div>

                <div className="mb-4">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                        {t('admin.goReasonRequired')} <span className="text-red-400 normal-case">{t('admin.goReasonRequiredHint')}</span>
                    </label>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                        placeholder={t('admin.goReasonPlaceholder')}
                        className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                    />
                </div>

                {saveError && (
                    <div className="mb-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs whitespace-pre-line">
                        {saveError}
                    </div>
                )}
                {saveOk && (
                    <div className="mb-3 p-3 rounded-xl bg-green-500/15 border border-green-500/30 text-green-300 text-xs">
                        {saveOk}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-gray-500 text-xs">
                        {dirtyEntries.length > 0
                            ? (dirtyEntries.length === 1
                                ? t('admin.goPendingEditCount', { n: dirtyEntries.length })
                                : t('admin.goPendingEditsCount', { n: dirtyEntries.length }))
                            : t('admin.goNoComponentEdits')}
                        {t('admin.goFinalLetterWillBe', { letter: newGrade })}
                    </p>
                    <div className="flex gap-2">
                        {dirtyEntries.length > 0 && (
                            <button
                                onClick={() => setDrafts(seedDrafts(data.entries))}
                                disabled={submitting}
                                className="px-4 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 text-black dark:text-white font-bold text-xs hover:bg-white/10 transition-colors disabled:opacity-50"
                            >
                                {t('admin.goResetEdits')}
                            </button>
                        )}
                        <button
                            onClick={handleApply}
                            disabled={submitting}
                            className="px-5 py-2 rounded-xl bg-[#6A3FF4] text-white font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {submitting ? t('admin.goApplying') : t('admin.goApplyOverrideBtn')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Past overrides for this (student, course) */}
            {data.overrides.length > 0 && (
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.goPastOverridesHeading')}</h3>
                    <p className="text-gray-500 text-xs mb-4">
                        {data.overrides.length === 1
                            ? t('admin.goPastOverrideCount', { n: data.overrides.length })
                            : t('admin.goPastOverridesCount', { n: data.overrides.length })}
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColWhen')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColBy')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColOldNew')}</th>
                                    <th className="text-left py-2 font-bold">{t('admin.goColReason')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {data.overrides.map((o) => (
                                    <tr key={o.id} className="hover:bg-white/5 transition-colors">
                                        <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                                            {new Date(o.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400">{o.overriddenBy ?? '—'}</td>
                                        <td className="py-2 pr-4">
                                            <span className="text-gray-500">{o.oldGrade ?? '—'}</span>
                                            <span className="mx-2 text-gray-500">→</span>
                                            <span className="text-[#7B5AFF] font-bold">{o.newGrade}</span>
                                        </td>
                                        <td className="py-2 text-gray-400 max-w-[400px] truncate">{o.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

const SummaryTile: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
    <ParticleCard
        className={`${glassCardStyle} p-5`}
        glowColor="106, 63, 244"
        enableTilt={false}
        enableMagnetism={false}
    >
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">{label}</p>
        <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-2xl font-bold truncate ${accent ?? 'text-black dark:text-white'}`}
        >
            {value}
        </motion.p>
    </ParticleCard>
);

export default GradeOverrideStudentPage;
