import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AnimateOnView } from "../../components/AnimateOnView";
import { GlassDropdown } from "../../components/GlassDropdown";
import {
  getMaterialIcon,
  fetchStudentLiveSessions,
  LiveSessionItem,
} from "../../utils/courseContentService";
import { API_URLS } from '@shared/config';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

interface Material {
    id: string;
    title: string;
    type: string;
    category: string;
    fileSize: string;
    uploadedAt: string;
    url: string;
}

interface Assignment {
    id: string;
    title: string;
    description: string;
    dueDate: string;
    // Backend Assignment uses `maxScore` + an optional `score` injected when
    // the user has a submission. The older `points`/`grade` names were mock-only.
    maxScore: number;
    status: string;
    score?: number | null;
    submissionId?: string | null;
    // Spec files attached at create time — students click to download the
    // PDF/instructions before submitting their own work.
    attachments?: string[];
}

const MaterialItem: React.FC<{ material: Material }> = ({ material }) => {
    const { icon, color, bg } = getMaterialIcon(material.type as any);
    const downloadUrl = `${API_URLS.courseContent()}${material.url}`;

    return (
        <a href={downloadUrl} target="_blank" rel="noreferrer" className="block">
            <div className="bg-white/10 dark:bg-black/20 p-4 rounded-xl border border-white/10 flex items-center hover:border-[#6A3FF4]/50 transition-all group">
                <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center mr-4`}><i className={`ph-fill ${icon} text-2xl ${color}`}></i></div>
                <div className="flex-grow min-w-0">
                    <p className="font-bold text-black dark:text-white text-sm truncate">{material.title}</p>
                    <p className="text-[10px] text-gray-500 mt-1 uppercase">{material.type} • {material.fileSize}</p>
                </div>
                <i className="ph-bold ph-download-simple text-xl text-gray-400 group-hover:text-[#6A3FF4]"></i>
            </div>
        </a>
    );
};

// Category metadata for the type filter + section headings. Order here is
// the on-page rendering order when "All" is selected.
const CATEGORY_KEYS = [
    'lectures', 'finalProject', 'assignments', 'labs',
    'readings', 'references', 'assessments', 'other',
] as const;

const CATEGORY_META: Record<string, { icon: string; color: string }> = {
    lectures:      { icon: 'ph-video-camera',   color: 'text-[#6A3FF4]' },
    finalProject:  { icon: 'ph-trophy',         color: 'text-amber-500' },
    assignments:   { icon: 'ph-clipboard-text', color: 'text-emerald-500' },
    labs:          { icon: 'ph-flask',          color: 'text-cyan-500' },
    readings:      { icon: 'ph-book-open',      color: 'text-pink-500' },
    references:    { icon: 'ph-book-bookmark',  color: 'text-blue-500' },
    assessments:   { icon: 'ph-exam',           color: 'text-red-500' },
    other:         { icon: 'ph-folder',         color: 'text-gray-400' },
};

const ContentTab: React.FC<{
    materials: Record<string, Material[]>;
    recordings: LiveSessionItem[];
    typeFilter: string;
    setTypeFilter: (v: string) => void;
    courseCode: string;
    navigate: (path: string) => void;
    t: (k: string) => string;
}> = ({ materials, recordings, typeFilter, setTypeFilter, courseCode, navigate, t }) => {
    // Friendly label for each category — falls back to the storage key.
    const labelFor = (key: string): string => {
        switch (key) {
            case 'lectures':     return t('viewCourseContentPage.lectureHeading') || 'Lectures';
            case 'finalProject': return t('viewCourseContentPage.finalProjectHeading') || 'Final Project';
            case 'assignments':  return 'Assignments';
            case 'labs':         return 'Labs';
            case 'readings':     return 'Readings';
            case 'references':   return 'References';
            case 'assessments':  return 'Assessments';
            case 'other':        return 'Other';
            case 'recordings':   return 'Recorded Lectures';
            default:             return key;
        }
    };

    const dropdownOptions = useMemo(() => {
        const opts = [
            { value: '__all__', label: 'All categories', icon: 'ph-stack' },
            ...CATEGORY_KEYS
                .filter((key) => (materials[key]?.length ?? 0) > 0)
                .map((key) => ({
                    value: key,
                    label: labelFor(key),
                    icon: CATEGORY_META[key]?.icon || 'ph-folder',
                })),
        ];
        // Append recordings as a virtual category iff this course has any.
        if (recordings.length > 0) {
            opts.push({ value: 'recordings', label: labelFor('recordings'), icon: 'ph-monitor-play' });
        }
        return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [materials, recordings]);

    // Scroll/redirect when picking a category from the dropdown.
    const onPickCategory = (value: string) => {
        setTypeFilter(value);
        // Defer scroll to next paint so the chosen section is already rendered.
        if (value !== '__all__') {
            setTimeout(() => {
                const el = document.getElementById(`category-${value}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 0);
        }
    };

    const visibleKeys = typeFilter === '__all__'
        ? CATEGORY_KEYS.filter((k) => (materials[k]?.length ?? 0) > 0)
        : CATEGORY_KEYS.includes(typeFilter as any)
            ? [typeFilter as typeof CATEGORY_KEYS[number]]
            : [];

    const showRecordings = (typeFilter === '__all__' || typeFilter === 'recordings') && recordings.length > 0;
    const nothingToShow = visibleKeys.length === 0 && !showRecordings;

    return (
        <motion.div key="content" className="space-y-6">
            {/* Type filter dropdown */}
            {dropdownOptions.length > 1 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label className="text-sm font-medium text-gray-400 sm:whitespace-nowrap">
                        Show:
                    </label>
                    <div className="min-w-[220px]">
                        <GlassDropdown
                            value={typeFilter}
                            onChange={onPickCategory}
                            options={dropdownOptions}
                            direction="auto"
                            className="w-full"
                        />
                    </div>
                </div>
            )}

            {/* All categories (including the synthetic Recordings one) flow
                left-to-right as responsive columns instead of stacking. Each
                column is min 280px wide; as more categories appear, the grid
                wraps to additional rows. Materials WITHIN a category stack
                vertically inside their column. */}
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
                {showRecordings && (
                    <section id="category-recordings" className="space-y-4 scroll-mt-24">
                        <h3 className="text-black dark:text-white font-bold flex items-center gap-2 mb-4">
                            <i className="ph-fill ph-monitor-play text-red-500"></i>
                            {labelFor('recordings')}
                            <span className="text-xs text-gray-500 font-normal">({recordings.length})</span>
                        </h3>
                        <div className="space-y-3">
                            {recordings.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => navigate(`/student/online-lectures?courseCode=${encodeURIComponent(courseCode)}&sessionId=${encodeURIComponent(s.id)}`)}
                                    className="w-full bg-white/10 dark:bg-black/20 p-4 rounded-xl border border-white/10 hover:border-[#6A3FF4]/50 transition-all group text-left flex items-center gap-3"
                                >
                                    <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                        <i className="ph-fill ph-play-circle text-2xl text-red-500"></i>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <p className="font-bold text-black dark:text-white text-sm truncate">{s.title}</p>
                                        <p className="text-[10px] text-gray-500 mt-1 uppercase">
                                            {s.scheduledFor ? new Date(s.scheduledFor).toLocaleDateString() : 'Replay'}
                                            {s.hostName ? ` • ${s.hostName}` : ''}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {visibleKeys.map((key) => (
                    <section key={key} id={`category-${key}`} className="space-y-4 scroll-mt-24">
                        <h3 className="text-black dark:text-white font-bold flex items-center gap-2 mb-4">
                            <i className={`ph-fill ${CATEGORY_META[key]?.icon || 'ph-folder'} ${CATEGORY_META[key]?.color || 'text-gray-400'}`}></i>
                            {labelFor(key)}
                            <span className="text-xs text-gray-500 font-normal">({materials[key]?.length || 0})</span>
                        </h3>
                        <div className="space-y-3">
                            {(materials[key] || []).map((m) => <MaterialItem key={m.id} material={m} />)}
                        </div>
                    </section>
                ))}
            </div>

            {nothingToShow && (
                <p className="text-gray-500 text-sm text-center py-12">
                    {t('viewCourseContentPage.noLectureMaterials') || 'No materials yet.'}
                </p>
            )}
        </motion.div>
    );
};

const ViewCourseContent: React.FC = () => {
    const { courseCode } = useParams<{ courseCode: string }>();
    const navigate = useNavigate();
    const t = useT();
    const [course, setCourse] = useState<any>(null);
    // Hold every material category the backend returns so the type filter
    // can scroll/redirect to any of them (lectures, readings, assignments,
    // finalProject, labs, references, assessments, other).
    const [materials, setMaterials] = useState<Record<string, Material[]>>({
        lectures: [], readings: [], assignments: [], finalProject: [],
        labs: [], references: [], assessments: [], other: [],
    });
    // Per-course recordings — past LiveSession rows for THIS course only.
    const [recordings, setRecordings] = useState<LiveSessionItem[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'content' | 'assignments'>('content');
    // Type filter — '__all__' shows every category in order; otherwise just
    // the chosen one. The dropdown also acts as a redirect / scroll target.
    const [typeFilter, setTypeFilter] = useState<string>('__all__');

    useEffect(() => {
        const loadData = async () => {
            if (!courseCode) return;
            setIsLoading(true);
            try {
                const token = localStorage.getItem('authToken');
                const [courseRes, matRes, assignRes] = await Promise.all([
                    fetch(`${API_URLS.courseContent()}/api/courses/${courseCode}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    fetch(`${API_URLS.courseContent()}/api/courses/${courseCode}/materials`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }),
                    fetch(`${API_URLS.courseContent()}/api/courses/${courseCode}/assignments?userId=current`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    })
                ]);

                if (courseRes.ok) setCourse(await courseRes.json());
                if (matRes.ok) {
                    const matData = await matRes.json();
                    setMaterials({
                        lectures: matData.lectures || [],
                        readings: matData.readings || [],
                        assignments: matData.assignments || [],
                        finalProject: matData.finalProject || [],
                        labs: matData.labs || [],
                        references: matData.references || [],
                        assessments: matData.assessments || [],
                        other: matData.other || [],
                    });
                }
                if (assignRes.ok) setAssignments(await assignRes.json());

                // Per-course recordings — fetch the student's live sessions
                // (upcoming + past) and keep only the past ones with a
                // recording URL whose courseCode matches this page.
                try {
                    const userId = localStorage.getItem('currentUserId')
                        || localStorage.getItem('currentUserEmail')
                        || '';
                    if (userId) {
                        const { past } = await fetchStudentLiveSessions(userId);
                        const upper = courseCode.toUpperCase();
                        setRecordings(
                            (past || []).filter(
                                (s) =>
                                    !!s.recordingUrl
                                    && (s.courseCode || '').toUpperCase() === upper
                            )
                        );
                    }
                } catch { /* recordings are optional — silent fail */ }
            } catch (e) {
                console.error(e);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [courseCode]);

    if (isLoading) return <div className="p-20 text-center animate-pulse">{t('viewCourseContentPage.loading')}</div>;
    if (!course) return <div className="p-20 text-center">{t('viewCourseContentPage.courseNotFound')}</div>;

    return (
        <div className="pb-16 space-y-6">
            <AnimateOnView>
                <div className={`${glassCardStyle} p-8`}>
                    <div className="flex items-center gap-3 mb-4">
                        <span className="bg-[#6A3FF4]/10 text-[#6A3FF4] px-3 py-1 rounded-lg font-bold text-xs">{course.code}</span>
                        <h2 className="text-3xl font-bold text-white">{course.title}</h2>
                    </div>
                    <p className="text-gray-400 max-w-3xl">{course.description}</p>
                </div>
            </AnimateOnView>

            <div className="flex gap-2 p-1 bg-white/5 w-fit rounded-xl border border-white/10">
                {(['content', 'assignments'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-6 py-2 rounded-lg text-sm font-bold capitalize transition-all ${activeTab === tab ? 'bg-[#6A3FF4] text-white shadow-lg' : 'text-gray-500'}`}
                    >
                        {tab === 'content' ? t('viewCourseContentPage.tabContent') : t('viewCourseContentPage.tabAssignments')}
                    </button>
                ))}
            </div>

            <AnimatePresence mode="wait">
                {activeTab === 'content' ? (
                    <ContentTab
                        materials={materials}
                        recordings={recordings}
                        typeFilter={typeFilter}
                        setTypeFilter={setTypeFilter}
                        courseCode={courseCode || ''}
                        navigate={navigate}
                        t={t}
                    />
                ) : (
                    <motion.div key="assignments" className="space-y-4">
                        {assignments.map(a => (
                            <div key={a.id} className={`${glassCardStyle} p-6 space-y-3`}>
                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                                    <div className="min-w-0">
                                        <h4 className="text-white font-bold">{a.title}</h4>
                                        <p className="text-gray-500 text-xs">{t('viewCourseContentPage.dueLabel')} {new Date(a.dueDate).toLocaleDateString()}</p>
                                    </div>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                                            a.status === 'graded' ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                                        }`}>
                                            {a.status === 'graded' ? t('viewCourseContentPage.statusGraded') : t('viewCourseContentPage.statusPending')}
                                        </span>
                                        {a.score != null && <span className="text-black dark:text-white font-bold">{a.score}/{a.maxScore}</span>}
                                        <button onClick={() => navigate('/student/assignments')} className="p-2 rounded-lg bg-white/5 text-[#6A3FF4] hover:bg-[#6A3FF4] hover:text-white transition-all"><i className="ph-bold ph-arrow-right"></i></button>
                                    </div>
                                </div>
                                {a.attachments && a.attachments.length > 0 && (
                                    <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                                        {a.attachments.map((url, idx) => {
                                            const fileName = url.split('/').pop() || `attachment-${idx + 1}`;
                                            const isPdf = fileName.toLowerCase().endsWith('.pdf');
                                            return (
                                                <a
                                                    key={url}
                                                    href={`${API_URLS.courseContent()}${url}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 text-black dark:text-white hover:border-[#6A3FF4]/60 hover:bg-[#6A3FF4]/10 transition-colors"
                                                >
                                                    <i className={`ph-fill ${isPdf ? 'ph-file-pdf text-red-500' : 'ph-file text-[#6A3FF4]'}`}></i>
                                                    <span className="truncate max-w-[14rem]">{fileName}</span>
                                                    <i className="ph-bold ph-download-simple text-[10px]"></i>
                                                </a>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ViewCourseContent;
