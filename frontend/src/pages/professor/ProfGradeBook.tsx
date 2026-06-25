// src/pages/professor/ProfGradeBook.tsx
//
// Live gradebook — columns are derived from posted items (Assignments,
// Quizzes) plus the always-present Midterm + Final. Students are pulled
// from approved registrations on the course (NOT from gradebook entries),
// so the table is always populated even when no grades are entered yet.
//
// Per-cell editing for assignment/quiz scores writes to the underlying
// AssignmentSubmission / QuizSubmission rows. Midterm + Final write to
// gradebookEntry rows. Midterm + Final max scores are configurable per
// course inside FCDS-defined ranges (mid 20-30, final 40-60, step 5).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { API_URLS } from '@shared/config';
import { useT } from '../../i18n';
import { useGradingRules, percentToLetter } from '../../utils/gradingRules';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface CourseOption { code: string; name: string; }
interface Column {
    key: string;
    label: string;
    type: 'assignment' | 'quiz' | 'midterm' | 'final';
    maxScore: number;
    refId?: string;
}
interface ConfirmationMeta {
    isFinal: boolean;
    confirmedById: string | null;
    confirmedAt: string | null;
    confirmedBy: { id: string; firstName: string; lastName: string } | null;
}
interface StudentRow {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    odId: string | null;
    scores: Record<string, number | null>;
    // Plan 7 Phase 1 — populated by the live endpoint when an isFinal=true row
    // exists for this student. Drives the per-row Confirm button + pill.
    finalConfirmation: ConfirmationMeta | null;
    // Parallel midterm confirmation state (added 2026-05-17). Drives a
    // separate Confirm midterm affordance per row.
    midtermConfirmation: ConfirmationMeta | null;
}
// Alias used by the bulk-confirm predicate so we can pull from either
// the live or the cached state shape without casting.
type GradebookStudent = StudentRow;
interface GradebookData {
    courseCode: string;
    courseTitle: string;
    columns: Column[];
    students: StudentRow[];
    midtermFinal: {
        midtermMax: number;
        finalMax: number;
        midtermRange: [number, number];
        finalRange: [number, number];
        step: number;
    };
}

// Letter-from-percent now respects the admin grading scale. Previously
// this was hardcoded to 93/90/87/... (US-style 10-point) which ignored
// any thresholds the admin had configured in Admin → Academics → Grading
// Rules. So an admin setting A=90 still saw the gradebook show A- at
// 90% because the frontend's hardcoded ladder put A at ≥93. The helper
// now reads the live grading scale at render time so a 90/85/80/... or
// any other configured ladder is honoured. Falls back to DEFAULT_RULES
// from gradingRules.ts when the rules haven't loaded yet.

const gradeColor = (g: string): string => {
    if (g.startsWith('A')) return 'text-green-500';
    if (g.startsWith('B')) return 'text-blue-500';
    if (g.startsWith('C')) return 'text-yellow-500';
    if (g.startsWith('D')) return 'text-orange-500';
    return 'text-red-500';
};

const ProfGradeBook: React.FC = () => {
    const t = useT();
    const gradingRules = useGradingRules();
    const [courses, setCourses] = useState<CourseOption[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<string>('');
    const [data, setData] = useState<GradebookData | null>(null);
    const [editing, setEditing] = useState<{ studentId: string; columnKey: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [savingCell, setSavingCell] = useState(false);
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    const [showConfig, setShowConfig] = useState(false);
    // Owner directive (2026-05-19): mid/final cell edits are NO LONGER
    // autosaved. Typed values land here as drafts; the per-row + bulk Confirm
    // buttons are the only writers that persist them. Map shape:
    //   studentId → { midterm?: number|null, final?: number|null }
    // A present key means the prof has touched the cell. `null` clears the
    // score on confirm. Cleared on reload + on each successful confirm.
    const [drafts, setDrafts] = useState<Map<string, { midterm?: number | null; final?: number | null }>>(new Map());

    // Load professor courses.
    useEffect(() => {
        const email = localStorage.getItem('currentUserEmail') || '';
        const token = localStorage.getItem('authToken');
        fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => (r.ok ? r.json() : []))
            .then((rows: { code: string; title?: string; name?: string }[]) => {
                const opts: CourseOption[] = (Array.isArray(rows) ? rows : []).map(c => ({
                    code: c.code,
                    name: c.title || c.name || c.code,
                }));
                setCourses(opts);
                if (opts.length > 0) setSelectedCourse(opts[0].code);
            })
            .catch(() => setCourses([]));
    }, []);

    const loadGradebook = useCallback(async () => {
        if (!selectedCourse) return;
        const token = localStorage.getItem('authToken');
        try {
            const r = await fetch(
                `${API_URLS.courseContent()}/api/gradebook/${selectedCourse}/live`,
                {
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            if (!r.ok) {
                setData(null);
                return;
            }
            const body = await r.json();
            setData(body);
            // NOTE: drafts are intentionally NOT cleared here. Owner-reported
            // bug (2026-05-19): typing both mid + final drafts and then
            // confirming only the mid would wipe the final draft because the
            // reload nuked the whole map. The per-row + bulk confirm handlers
            // already drop only the specific (studentId, kind) they confirmed,
            // so the other-kind draft must survive. Course switches clear
            // drafts in a separate effect below.
        } catch {
            setData(null);
        }
    }, [selectedCourse]);

    // Clear drafts when the prof switches courses — drafts for course A
    // would be meaningless against course B's student set / column maxes.
    useEffect(() => {
        setDrafts(new Map());
    }, [selectedCourse]);

    // Helpers — drafts take precedence over saved scores in every consumer
    // (cell rendering, overall %, confirm buttons, bulk gate). Saved score
    // surfaces when no draft exists.
    const getEffectiveMidFinal = useCallback(
        (studentId: string, kind: 'midterm' | 'final', savedScore: number | null): number | null => {
            const d = drafts.get(studentId);
            if (d && kind in d) return d[kind] ?? null;
            return savedScore;
        },
        [drafts],
    );
    const hasDraft = useCallback(
        (studentId: string, kind: 'midterm' | 'final'): boolean => {
            const d = drafts.get(studentId);
            return !!(d && kind in d);
        },
        [drafts],
    );

    useEffect(() => {
        loadGradebook();
    }, [loadGradebook]);

    // Per-row weighted percentage. Equal-weight across all visible columns
    // — staff can override individual scores; the overall is informational.
    // Mid/final drafts are included so the overall reflects what would be
    // published if the prof confirms now.
    const computeOverall = (row: StudentRow): { pct: number | null; letter: string } => {
        if (!data) return { pct: null, letter: 'N/A' };
        let earned = 0;
        let outOf = 0;
        for (const col of data.columns) {
            let v: number | null;
            if (col.type === 'midterm' || col.type === 'final') {
                v = getEffectiveMidFinal(row.id, col.type, row.scores[col.key] ?? null);
            } else {
                v = row.scores[col.key];
            }
            if (v != null && col.maxScore > 0) {
                earned += v;
                outOf += col.maxScore;
            }
        }
        if (outOf === 0) return { pct: null, letter: 'N/A' };
        const pct = (earned / outOf) * 100;
        return { pct, letter: percentToLetter(pct, gradingRules) };
    };

    // Save a single cell. Routes by column type:
    //   assignment → POST /api/gradebook/:courseCode/cell with assignmentId (autosave)
    //   quiz       → POST /api/gradebook/:courseCode/cell with quizId      (autosave)
    //   midterm/final → DRAFT ONLY. Owner directive (2026-05-19): mid/final
    //                   never autosave; the prof must click the per-row
    //                   Confirm Mid / Confirm Final button (or the bulk
    //                   variants) to persist. See `drafts` state.
    const saveCell = async () => {
        if (!editing || !data) return;
        const { studentId, columnKey } = editing;
        const col = data.columns.find(c => c.key === columnKey);
        if (!col) return;

        const numeric = editValue.trim() === '' ? null : Number(editValue);
        if (numeric != null && (Number.isNaN(numeric) || numeric < 0 || numeric > col.maxScore)) {
            setFeedback({ kind: 'error', text: t('professor.cellOutOfRange', { max: col.maxScore }) });
            return;
        }

        // Mid/final: stash as a draft and bail out. The confirm flow does the
        // actual write. This is the headline 2026-05-19 behaviour change —
        // typing a mid/final score no longer touches the backend until the
        // prof commits via the Confirm button.
        if (col.type === 'midterm' || col.type === 'final') {
            const kind = col.type as 'midterm' | 'final';
            setDrafts(prev => {
                const next = new Map(prev);
                const existing = next.get(studentId) ?? {};
                next.set(studentId, { ...existing, [kind]: numeric });
                return next;
            });
            setEditing(null);
            setEditValue('');
            setFeedback({
                kind: 'success',
                text: kind === 'midterm'
                    ? 'Draft saved — click Confirm Mid to publish.'
                    : 'Draft saved — click Confirm Final to publish.',
            });
            setTimeout(() => setFeedback(null), 2500);
            return;
        }

        setSavingCell(true);
        const token = localStorage.getItem('authToken');
        try {
            // Assignment / quiz — route through dedicated cell endpoint
            const r = await fetch(
                `${API_URLS.courseContent()}/api/gradebook/${selectedCourse}/cell`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        studentId,
                        type: col.type,
                        refId: col.refId,
                        score: numeric,
                    }),
                }
            );
            if (!r.ok) throw new Error('save failed');

            // Optimistic local update.
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    students: prev.students.map(s =>
                        s.id === studentId
                            ? { ...s, scores: { ...s.scores, [columnKey]: numeric } }
                            : s
                    ),
                };
            });
            setFeedback({ kind: 'success', text: t('professor.savedShort') });
        } catch {
            setFeedback({ kind: 'error', text: t('professor.couldNotSaveScore') });
        } finally {
            setSavingCell(false);
            setEditing(null);
            setEditValue('');
            setTimeout(() => setFeedback(null), 2000);
        }
    };

    const saveMidtermFinalConfig = async (midtermMax: number, finalMax: number) => {
        const token = localStorage.getItem('authToken');
        const r = await fetch(
            `${API_URLS.courseContent()}/api/gradebook/${selectedCourse}/midterm-final-config`,
            {
                method: 'PATCH',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ midtermMax, finalMax }),
            }
        );
        if (r.ok) {
            await loadGradebook();
            setFeedback({ kind: 'success', text: t('professor.midFinalUpdated') });
            setTimeout(() => setFeedback(null), 2000);
        } else {
            const body = await r.json().catch(() => ({}));
            setFeedback({ kind: 'error', text: body.error || t('professor.couldNotUpdateConfig') });
        }
    };

    // Per-row confirmation of a student's midterm / final grade. The
    // backend now (a) implies finalization on the confirm action (no
    // need to pre-mark `isFinal`), (b) fires the full transcript / GPA /
    // standing cascade for final confirmations, and (c) notifies the
    // student via the standard notification pipeline. Midterm confirms
    // just notify — midterm isn't on the transcript.
    const [confirmingStudentId, setConfirmingStudentId] = useState<string | null>(null);
    const confirmStudentGrade = async (studentId: string, kind: 'final' | 'midterm' = 'final') => {
        if (!selectedCourse) return;
        const token = localStorage.getItem('authToken');
        setConfirmingStudentId(`${kind}:${studentId}`);
        try {
            const path = kind === 'final' ? 'confirm' : 'confirm-mid';
            // Owner directive (2026-05-19): when a draft exists, send it in
            // the body so the backend upserts + computes the letter via the
            // admin grading rules in one atomic write. When no draft exists
            // we still send the current saved score so the backend recomputes
            // the letter from the prof's configured max (handles legacy
            // entries that stored maxScore=100 by default).
            const d = drafts.get(studentId);
            const draftScore = d && kind in d ? d[kind] : undefined;
            const fallbackScore = data?.students.find(s => s.id === studentId)?.scores?.[kind];
            const scoreToSend = draftScore !== undefined ? draftScore : (fallbackScore ?? null);
            const r = await fetch(
                `${API_URLS.courseContent()}/api/grades/${selectedCourse}/${studentId}/${path}`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ score: scoreToSend }),
                },
            );
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
                setFeedback({ kind: 'error', text: body.error || t('professor.confirmationFailed') });
                return;
            }
            // Clear this student's draft for the confirmed kind so the
            // reloaded saved score wins.
            setDrafts(prev => {
                const next = new Map(prev);
                const existing = next.get(studentId);
                if (existing && kind in existing) {
                    const { [kind]: _omit, ...rest } = existing;
                    if (Object.keys(rest).length === 0) next.delete(studentId);
                    else next.set(studentId, rest);
                }
                return next;
            });
            await loadGradebook();
            setFeedback({
                kind: 'success',
                text: kind === 'final'
                    ? t('professor.confirmingFinal')
                    : t('professor.confirmingMidterm'),
            });
            setTimeout(() => setFeedback(null), 2200);
        } catch {
            setFeedback({ kind: 'error', text: t('professor.confirmationNetwork') });
        } finally {
            setConfirmingStudentId(null);
        }
    };

    // Release Student — confirms the final grade (synthesizes F if no score
    // exists), runs the transcript cascade so the course moves from "Current
    // Semester" into the historical transcript under the active period's
    // semester name, then drops the registration so it disappears from the
    // student's in-progress view. Idempotent on the backend; the prompt is
    // here so a casual click doesn't accidentally release a roster.
    const [releasingStudentId, setReleasingStudentId] = useState<string | null>(null);
    const releaseStudent = async (studentId: string, studentName: string) => {
        if (!selectedCourse) return;
        if (!window.confirm(
            `Release ${studentName} from ${selectedCourse}?\n\n` +
            `• Their final grade will be locked in (F if blank).\n` +
            `• The course will move from "Current Semester" into their historical transcript.\n` +
            `• Their registration will be marked released.\n\n` +
            `This cannot be undone via this button.`
        )) return;
        const token = localStorage.getItem('authToken');
        setReleasingStudentId(studentId);
        try {
            const r = await fetch(
                `${API_URLS.courseContent()}/api/grades/${selectedCourse}/${studentId}/release`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({}),
                },
            );
            const body = await r.json().catch(() => ({}));
            if (!r.ok) {
                setFeedback({ kind: 'error', text: body.error || 'Failed to release student.' });
                return;
            }
            await loadGradebook();
            setFeedback({
                kind: 'success',
                text: `Released ${studentName}. Final grade is locked and the course is now on their transcript.`,
            });
            setTimeout(() => setFeedback(null), 3000);
        } catch {
            setFeedback({ kind: 'error', text: 'Network error releasing student.' });
        } finally {
            setReleasingStudentId(null);
        }
    };

    const [bulkConfirming, setBulkConfirming] = useState(false);
    const confirmAllGrades = async (kind: 'final' | 'midterm') => {
        if (!selectedCourse) return;
        // Owner directive (this batch): bulk confirm now operates on EVERY
        // student row that isn't already confirmed, not just rows with a
        // value. The backend synthesises F for empty finals on confirm, so
        // bulk confirm becomes a true "close the books on this course"
        // action. The prompt below clearly says blanks become F (or skip
        // the column for midterm) so the prof can decide.
        const meta = (s: GradebookStudent) => kind === 'final' ? s.finalConfirmation : s.midtermConfirmation;
        const eff = (s: GradebookStudent): number | null => getEffectiveMidFinal(s.id, kind, s.scores?.[kind] ?? null);
        const allRows = data?.students ?? [];
        const pending = allRows.filter(s => !meta(s)?.confirmedById);
        const withGrade = pending.filter(s => eff(s) != null).length;
        const withoutGrade = pending.length - withGrade;
        if (pending.length === 0) {
            setFeedback({ kind: 'success', text: t('professor.nothingToConfirm', { kind }) });
            setTimeout(() => setFeedback(null), 2000);
            return;
        }
        const cascadeMsg = kind === 'final'
            ? t('professor.cascadeFinal')
            : t('professor.cascadeMid');
        const blanksWarning = withoutGrade > 0
            ? `\n\n⚠ ${withoutGrade} student${withoutGrade === 1 ? '' : 's'} ha${withoutGrade === 1 ? 's' : 've'} no ${kind} grade entered yet. ${kind === 'final' ? `They will be locked at F.` : `Their ${kind} cell will be locked empty.`}`
            : '';
        if (!window.confirm(
            `Confirm ${kind === 'final' ? 'finals' : 'midterms'} for ${pending.length} student${pending.length === 1 ? '' : 's'} in ${selectedCourse}?\n\n${cascadeMsg}${blanksWarning}`
        )) return;
        const token = localStorage.getItem('authToken');
        setBulkConfirming(true);
        // Always route through the per-row endpoint so each row carries its
        // effective score (draft or saved). The legacy bulk endpoint only
        // confirms rows already persisted in the DB, which would silently
        // skip drafts — exactly the bug this change exists to prevent.
        const path = kind === 'final' ? 'confirm' : 'confirm-mid';
        let confirmed = 0;
        try {
            for (const s of pending) {
                const score = eff(s);
                try {
                    const r = await fetch(
                        `${API_URLS.courseContent()}/api/grades/${selectedCourse}/${s.id}/${path}`,
                        {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ score }),
                        },
                    );
                    if (r.ok) confirmed += 1;
                } catch { /* per-row failure, keep going */ }
            }
            // Clear the drafts for the kind we just published — successful
            // rows will reload via loadGradebook; unsuccessful rows keep
            // their drafts so the prof can retry.
            setDrafts(prev => {
                const next = new Map(prev);
                for (const s of pending.slice(0, confirmed)) {
                    const existing = next.get(s.id);
                    if (existing && kind in existing) {
                        const { [kind]: _omit, ...rest } = existing;
                        if (Object.keys(rest).length === 0) next.delete(s.id);
                        else next.set(s.id, rest);
                    }
                }
                return next;
            });
            await loadGradebook();
            setFeedback({ kind: 'success', text: t('professor.bulkConfirmedCount', { n: confirmed, kind, suffix: confirmed === 1 ? '' : 's' }) });
            setTimeout(() => setFeedback(null), 2500);
        } catch {
            setFeedback({ kind: 'error', text: t('professor.bulkConfirmNetwork') });
        } finally {
            setBulkConfirming(false);
        }
    };

    const courseOptions = useMemo(
        () => courses.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` })),
        [courses]
    );

    // Student search filter — owner directive (2026-05-17). Case-insensitive,
    // matches against first/last name, email, or od ID. Empty query returns
    // every student so existing behaviour is preserved when no search is on.
    const [studentQuery, setStudentQuery] = useState('');
    const allRows = useMemo(() => data?.students ?? [], [data?.students]);
    const rows = useMemo(() => {
        const q = studentQuery.trim().toLowerCase();
        if (!q) return allRows;
        return allRows.filter((s) => {
            const haystack = [s.firstName, s.lastName, `${s.firstName} ${s.lastName}`, s.email, s.odId ?? '']
                .join(' ')
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [allRows, studentQuery]);
    const cols = data?.columns ?? [];

    // Class stats — only meaningful when at least one cell is graded.
    const classStats = useMemo(() => {
        if (rows.length === 0) return { avg: null, pass: null, top: null };
        let totalPct = 0;
        let count = 0;
        let topPct = -Infinity;
        let passCount = 0;
        for (const r of rows) {
            const o = computeOverall(r);
            if (o.pct != null) {
                totalPct += o.pct;
                count += 1;
                if (o.pct > topPct) topPct = o.pct;
                if (o.pct >= 60) passCount += 1;
            }
        }
        return {
            avg: count > 0 ? (totalPct / count).toFixed(1) : null,
            pass: count > 0 ? Math.round((passCount / count) * 100) : null,
            top: count > 0 ? topPct.toFixed(1) : null,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, cols]);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.gradeBookTitle')}</h1>
                        <p className="text-black dark:text-gray-300 text-sm">
                            {t('professor.gradeBookSubtitle')}
                        </p>
                    </div>
                    {/* Actions row — dropdown + maxes config + bulk
                        confirmation buttons. flex-wrap so on mobile they
                        stack/wrap instead of overflowing the card. The
                        dropdown becomes full-width on mobile; min-w
                        restored at sm+. */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                        <div className="w-full sm:w-auto sm:min-w-[220px]">
                            <GlassDropdown
                                value={selectedCourse}
                                onChange={setSelectedCourse}
                                options={courseOptions}
                                direction="auto"
                                className="w-full"
                            />
                        </div>
                        <button
                            onClick={() => setShowConfig(v => !v)}
                            className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${glassCardStyle} text-black dark:text-white hover:bg-white/20`}
                        >
                            <i className="ph-bold ph-gear"></i> {t('professor.gbMidFinalMaxes')}
                        </button>
                        {/* Bulk confirmation — two buttons, one for midterm and
                            one for final. Each enables as soon as ANY row in
                            the course has the relevant value (midterm score OR
                            final letter) set and not yet confirmed. The previous
                            "every final must be isFinal first" gate left the
                            button greyed out forever on freshly-entered grades.
                            Confirming bulk fires the cascade (notification +
                            transcript + GPA + standing for finals; notification
                            only for midterms). */}
                        {/* Owner directive (2026-05-19): Confirm mids / Confirm finals
                            share the same gradient style and sit next to each other.
                            Disabled gate checks the EFFECTIVE value (draft || saved)
                            so a prof who just typed a batch of mids/finals sees the
                            button enable immediately. */}
                        <button
                            onClick={() => confirmAllGrades('midterm')}
                            disabled={bulkConfirming || !data || (data?.students ?? []).every((s) => {
                                const eff = getEffectiveMidFinal(s.id, 'midterm', s.scores?.['midterm'] ?? null);
                                return eff == null || (!!s.midtermConfirmation?.confirmedById && !hasDraft(s.id, 'midterm'));
                            })}
                            className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 transition-opacity"
                            title={t('professor.gbConfirmTooltipMid')}
                        >
                            <i className={`ph-bold ${bulkConfirming ? 'ph-spinner animate-spin' : 'ph-check-square'}`}></i>
                            {bulkConfirming ? t('professor.gbConfirming') : t('professor.gbConfirmMids')}
                        </button>
                        <button
                            onClick={() => confirmAllGrades('final')}
                            disabled={bulkConfirming || !data || (data?.students ?? []).every((s) => {
                                const eff = getEffectiveMidFinal(s.id, 'final', s.scores?.['final'] ?? null);
                                return eff == null || (!!s.finalConfirmation?.confirmedById && !hasDraft(s.id, 'final'));

                            })}
                            className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 transition-opacity"
                            title={t('professor.gbConfirmTooltipFinal')}
                        >
                            <i className={`ph-bold ${bulkConfirming ? 'ph-spinner animate-spin' : 'ph-check-square'}`}></i>
                            {bulkConfirming ? t('professor.gbConfirming') : t('professor.gbConfirmAllFinals')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Midterm + Final config panel.
                — `relative z-30` lifts this card above the stat / table cards
                  below so the GlassDropdown menus open over them rather than
                  being eaten by the next card's backdrop-blur stacking context.
                — Opacity-only animation (no height tween) so framer-motion
                  doesn't wrap the panel in overflow:hidden, which was clipping
                  the dropdown menus that flip downward. */}
            {showConfig && data && (
                <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={`${glassCardStyle} p-5 space-y-3 relative z-30`}
                    style={{ overflow: 'visible' }}
                >
                    <h3 className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
                        <i className="ph-bold ph-sliders-horizontal text-[#6A3FF4]"></i>
                        {t('professor.gbMidFinalTitle')}
                    </h3>
                    <p className="text-[11px] text-gray-500">
                        {t('professor.gbMidFinalHint')}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">{t('professor.gbMidtermMax')}</label>
                            <GlassDropdown
                                value={String(data.midtermFinal.midtermMax)}
                                onChange={v => saveMidtermFinalConfig(Number(v), data.midtermFinal.finalMax)}
                                options={[
                                    { value: '20', label: `20 ${t('professor.gbMarksUnit')}` },
                                    { value: '25', label: `25 ${t('professor.gbMarksUnit')}` },
                                    { value: '30', label: `30 ${t('professor.gbMarksUnit')}` },
                                ]}
                                direction="down"
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">{t('professor.gbFinalMax')}</label>
                            <GlassDropdown
                                value={String(data.midtermFinal.finalMax)}
                                onChange={v => saveMidtermFinalConfig(data.midtermFinal.midtermMax, Number(v))}
                                options={[
                                    { value: '40', label: `40 ${t('professor.gbMarksUnit')}` },
                                    { value: '45', label: `45 ${t('professor.gbMarksUnit')}` },
                                    { value: '50', label: `50 ${t('professor.gbMarksUnit')}` },
                                    { value: '55', label: `55 ${t('professor.gbMarksUnit')}` },
                                    { value: '60', label: `60 ${t('professor.gbMarksUnit')}` },
                                ]}
                                direction="down"
                                className="w-full"
                            />
                        </div>
                    </div>
                </motion.div>
            )}

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

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { title: t('professor.gbStudents'), value: rows.length.toString(), icon: 'ph-users', color: 'text-[#6A3FF4]', bg: 'bg-[#6A3FF4]/20' },
                    { title: t('professor.gbClassAvg'), value: classStats.avg ? `${classStats.avg}%` : '—', icon: 'ph-chart-bar', color: 'text-blue-500', bg: 'bg-blue-500/20' },
                    { title: t('professor.gbPassRate'), value: classStats.pass != null ? `${classStats.pass}%` : '—', icon: 'ph-check-circle', color: 'text-green-500', bg: 'bg-green-500/20' },
                    { title: t('professor.gbTopScore'), value: classStats.top ? `${classStats.top}%` : '—', icon: 'ph-trophy', color: 'text-yellow-500', bg: 'bg-yellow-500/20' },
                ].map((stat, i) => (
                    <AnimateOnView key={stat.title} delay={i * 0.05} enabled={false}>
                        <ParticleCard className={`${glassCardStyle} p-5`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stat.bg}`}><i className={`ph-fill ${stat.icon} text-xl ${stat.color}`}></i></div>
                                <span className="text-black dark:text-gray-300 font-bold text-xs uppercase tracking-wider">{stat.title}</span>
                            </div>
                            <p className="text-black dark:text-white text-2xl sm:text-3xl font-bold">{stat.value}</p>
                        </ParticleCard>
                    </AnimateOnView>
                ))}
            </div>

            {/* Live grade table */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} overflow-hidden`}>
                    <div className="p-5 border-b border-white/10 dark:border-white/5">
                        <h2 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-table text-[#6A3FF4]"></i>
                            {data?.courseTitle || (selectedCourse ? selectedCourse : t('professor.gbSelectCourseShort'))}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                            {t('professor.gbColCount', { n: cols.length, suffix: cols.length === 1 ? '' : 's', n2: rows.length, total: allRows.length, suffix2: allRows.length === 1 ? '' : 's' })}
                            {studentQuery && (
                                <button
                                    onClick={() => setStudentQuery('')}
                                    className="ml-2 text-[10px] font-bold text-[#6A3FF4] hover:underline"
                                >
                                    {t('professor.gbClearFilter')}
                                </button>
                            )}
                        </p>
                    </div>
                    {/* Student search filter — case-insensitive across name /
                        email / od ID. Lives just above the table so the result
                        count above reflects the filter state. */}
                    {selectedCourse && allRows.length > 0 && (
                        <div className="px-5 pt-3">
                            <div className="relative max-w-md">
                                <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input
                                    type="text"
                                    value={studentQuery}
                                    onChange={(e) => setStudentQuery(e.target.value)}
                                    placeholder={t('professor.gbSearchStudent')}
                                    className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                                />
                            </div>
                        </div>
                    )}
                    <div className="overflow-x-auto">
                        {rows.length === 0 ? (
                            <div className="p-10 text-center text-gray-500 text-sm">
                                {!selectedCourse
                                    ? t('professor.gbPickCourseEmpty')
                                    : studentQuery
                                    ? t('professor.gbNoMatch', { q: studentQuery })
                                    : t('professor.gbNoEnrolledStudents')}
                            </div>
                        ) : (
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="bg-white/5 dark:bg-black/10 border-b border-white/10 dark:border-white/5">
                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-wider sticky left-0 bg-white/10 dark:bg-black/30 backdrop-blur-xl z-10">{t('professor.gbStudentCol')}</th>
                                        {cols.map(col => (
                                            <th key={col.key} className="p-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center min-w-[110px]">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <span className="truncate max-w-[110px]" title={col.label}>{col.label}</span>
                                                    <span className="text-[10px] text-[#6A3FF4]/70">/{col.maxScore}</span>
                                                </div>
                                            </th>
                                        ))}
                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">{t('professor.gbOverallCol')}</th>
                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">{t('professor.gbGradeCol')}</th>
                                        {/* Plan 7 Phase 1 — publish gate for the
                                            student-facing transcript. */}
                                        <th className="p-3 text-xs font-bold text-gray-500 uppercase tracking-wider text-center min-w-[260px]">{t('professor.gbConfirmationCol')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => {
                                        const overall = computeOverall(r);
                                        return (
                                            <tr key={r.id} className="border-b border-white/5 hover:bg-white/5 dark:hover:bg-black/10 transition-colors">
                                                <td className="p-3 text-black dark:text-white font-medium whitespace-nowrap sticky left-0 bg-white/10 dark:bg-black/30 backdrop-blur-xl z-10">
                                                    <div className="flex flex-col">
                                                        <span>{r.firstName} {r.lastName}</span>
                                                        <span className="text-[10px] text-[#6A3FF4]/80 font-mono">{r.odId ?? r.email}</span>
                                                    </div>
                                                </td>
                                                {cols.map(col => {
                                                    const isEditing = editing?.studentId === r.id && editing.columnKey === col.key;
                                                    // Drafts only apply to midterm / final cells.
                                                    const isMidOrFinal = col.type === 'midterm' || col.type === 'final';
                                                    const draftKind = col.type as 'midterm' | 'final';
                                                    const savedVal = r.scores[col.key];
                                                    const effectiveVal = isMidOrFinal
                                                        ? getEffectiveMidFinal(r.id, draftKind, savedVal)
                                                        : savedVal;
                                                    const isDraftDirty = isMidOrFinal && hasDraft(r.id, draftKind) && effectiveVal !== savedVal;
                                                    return (
                                                        <td key={col.key} className="p-2 text-center">
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editValue}
                                                                    onChange={e => setEditValue(e.target.value)}
                                                                    onBlur={saveCell}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') saveCell();
                                                                        if (e.key === 'Escape') { setEditing(null); setEditValue(''); }
                                                                    }}
                                                                    className="w-16 bg-[#6A3FF4]/10 border border-[#6A3FF4] rounded-lg px-2 py-1.5 text-center text-sm text-black dark:text-white font-bold focus:outline-none"
                                                                    autoFocus
                                                                    min={0}
                                                                    max={col.maxScore}
                                                                    disabled={savingCell}
                                                                />
                                                            ) : (
                                                                <button
                                                                    onClick={() => {
                                                                        setEditing({ studentId: r.id, columnKey: col.key });
                                                                        setEditValue(effectiveVal != null ? String(effectiveVal) : '');
                                                                    }}
                                                                    className={`w-16 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                                                        isDraftDirty
                                                                            ? 'border border-amber-400 bg-amber-400/10 text-amber-700 dark:text-amber-300 font-bold hover:bg-amber-400/20'
                                                                            : 'hover:bg-[#6A3FF4]/10 hover:text-[#6A3FF4] text-black dark:text-gray-300'
                                                                    }`}
                                                                    title={
                                                                        isDraftDirty
                                                                            ? `Draft — click Confirm ${draftKind === 'midterm' ? t('professor.gbConfirmLabelMid') : t('professor.gbConfirmLabelFinal')} to publish (max ${col.maxScore})`
                                                                            : t('professor.gbCellEditTooltip', { max: col.maxScore })
                                                                    }
                                                                >
                                                                    {effectiveVal != null ? effectiveVal : '—'}
                                                                </button>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                                <td className="p-3 text-center text-black dark:text-white font-bold">
                                                    {overall.pct != null ? `${overall.pct.toFixed(1)}%` : '—'}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`font-bold text-sm ${gradeColor(overall.letter)}`}>{overall.letter}</span>
                                                </td>
                                                {/* Per-row confirmation actions / pills — one for midterm,
                                                    one for final. Each shows: a "—" when there's no entered
                                                    grade yet, a coloured Confirmed pill once published, or a
                                                    one-click "Confirm" button while pending. */}
                                                <td className="p-3 text-center">
                                                    {(() => {
                                                        const ConfirmPill: React.FC<{
                                                            label: string;
                                                            kind: 'midterm' | 'final';
                                                            value: number | null | undefined;
                                                            meta: ConfirmationMeta | null;
                                                            isDraft: boolean;
                                                        }> = ({ label, kind, value, meta, isDraft }) => {
                                                            // Owner directive: allow confirming an empty grade too — the
                                                            // backend synthesises a fallback F entry when there's nothing
                                                            // to score. Useful when a student no-showed or was withdrawn.
                                                            // Empty + already-confirmed → show the confirmed pill.
                                                            // Empty + not confirmed → show a slate "Confirm empty" button
                                                            // visually distinguished from the amber "Confirm" so the prof
                                                            // knows they're committing a null/F.
                                                            if (value == null && meta?.confirmedById && !isDraft) {
                                                                const who = meta.confirmedBy
                                                                    ? `${meta.confirmedBy.firstName} ${meta.confirmedBy.lastName}`
                                                                    : 'staff';
                                                                return (
                                                                    <span
                                                                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 whitespace-nowrap"
                                                                        title={`${label} locked as empty by ${who}`}
                                                                    >
                                                                        <i className="ph-bold ph-check-circle"></i> {label}
                                                                    </span>
                                                                );
                                                            }
                                                            if (value == null) {
                                                                const busy = confirmingStudentId === `${kind}:${r.id}`;
                                                                return (
                                                                    <button
                                                                        onClick={() => {
                                                                            if (!window.confirm(`Confirm ${label.toLowerCase()} as empty for this student? This locks the row (final will become F).`)) return;
                                                                            confirmStudentGrade(r.id, kind);
                                                                        }}
                                                                        disabled={!!confirmingStudentId}
                                                                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-500/15 border border-slate-500/30 text-slate-300 hover:bg-slate-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                                                                        title={`Confirm empty ${label.toLowerCase()} (locks row, final becomes F)`}
                                                                    >
                                                                        <i className={`ph-bold ${busy ? 'ph-spinner animate-spin' : 'ph-lock-open'}`}></i>
                                                                        {busy ? '…' : `${label}: lock`}
                                                                    </button>
                                                                );
                                                            }
                                                            // Owner directive (2026-05-19): even if a meta says "confirmed",
                                                            // a fresh draft means the prof has typed a new score that
                                                            // hasn't been republished — surface the Confirm button so they
                                                            // can update.
                                                            if (meta?.confirmedById && !isDraft) {
                                                                const who = meta.confirmedBy
                                                                    ? `${meta.confirmedBy.firstName} ${meta.confirmedBy.lastName}`
                                                                    : 'staff';
                                                                const when = meta.confirmedAt
                                                                    ? new Date(meta.confirmedAt).toLocaleDateString()
                                                                    : '';
                                                                return (
                                                                    <span
                                                                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 whitespace-nowrap"
                                                                        title={`${label} confirmed by ${who}${when ? ` on ${when}` : ''}`}
                                                                    >
                                                                        <i className="ph-bold ph-check-circle"></i> {label}
                                                                    </span>
                                                                );
                                                            }
                                                            const busy = confirmingStudentId === `${kind}:${r.id}`;
                                                            const titleHint = isDraft
                                                                ? `Unsaved draft — click to publish ${label.toLowerCase()} (${value})`
                                                                : kind === 'final'
                                                                    ? t('professor.gbConfirmFinalTooltip')
                                                                    : t('professor.gbConfirmMidTooltip');
                                                            return (
                                                                <button
                                                                    onClick={() => confirmStudentGrade(r.id, kind)}
                                                                    disabled={!!confirmingStudentId}
                                                                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                                                                    title={titleHint}
                                                                >
                                                                    <i className={`ph-bold ${busy ? 'ph-spinner animate-spin' : 'ph-clock'}`}></i>
                                                                    {busy ? '…' : t('professor.gbConfirmButton', { label })}
                                                                </button>
                                                            );
                                                        };
                                                        const midEffective = getEffectiveMidFinal(r.id, 'midterm', r.scores?.['midterm'] ?? null);
                                                        const finalEffective = getEffectiveMidFinal(r.id, 'final', r.scores?.['final'] ?? null);
                                                        const midDraft = hasDraft(r.id, 'midterm') && midEffective !== (r.scores?.['midterm'] ?? null);
                                                        const finalDraft = hasDraft(r.id, 'final') && finalEffective !== (r.scores?.['final'] ?? null);
                                                        return (
                                                            // Owner directive (2026-05-17): mid + final pills on ONE line, not two.
                                                            // Also includes a per-row Release button at the end so the prof
                                                            // can lock the final + drop the registration + push the course
                                                            // to the historical transcript in one click.
                                                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                                                <ConfirmPill
                                                                    label={t('professor.gbConfirmLabelMid')}
                                                                    kind="midterm"
                                                                    value={midEffective}
                                                                    meta={r.midtermConfirmation}
                                                                    isDraft={midDraft}
                                                                />
                                                                <ConfirmPill
                                                                    label={t('professor.gbConfirmLabelFinal')}
                                                                    kind="final"
                                                                    value={finalEffective}
                                                                    meta={r.finalConfirmation}
                                                                    isDraft={finalDraft}
                                                                />
                                                                {(() => {
                                                                    const busy = releasingStudentId === r.id;
                                                                    const studentName = `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || r.email || 'student';
                                                                    return (
                                                                        <button
                                                                            onClick={() => releaseStudent(r.id, studentName)}
                                                                            disabled={!!releasingStudentId}
                                                                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-50 transition-colors whitespace-nowrap"
                                                                            title="Release student — lock final, push to historical transcript, drop registration"
                                                                        >
                                                                            <i className={`ph-bold ${busy ? 'ph-spinner animate-spin' : 'ph-sign-out'}`}></i>
                                                                            {busy ? '…' : 'Release'}
                                                                        </button>
                                                                    );
                                                                })()}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </AnimateOnView>
        </div>
    );
};

export default ProfGradeBook;
