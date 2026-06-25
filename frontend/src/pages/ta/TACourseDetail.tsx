import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { AssignmentEditModal, EditableAssignment } from '../../components/AssignmentEditModal';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

type ActiveTab = 'overview' | 'materials' | 'assignments';

interface CourseInfo {
    code: string;
    name: string;
    instructor: string;
    enrolled: number;
    description?: string;
}

interface Material {
    id: string;
    title: string;
    fileName?: string;
    fileType?: string;
    uploadedAt?: string;
    createdAt?: string;
}

interface Assignment {
    id: string;
    title: string;
    dueDate?: string;
    submissionCount?: number;
    // URLs to the spec files attached at create time (e.g. the staff PDF
    // dropped through the Materials uploader).
    attachments?: string[];
    maxScore?: number;
    // Per-assignment penalty knobs — round-tripped through the edit modal.
    latePenalty?: number;
    missingAfterHours?: number;
}

// --- Static preview data, keyed by course code ---
const MOCK_COURSES: Record<string, CourseInfo> = {
    CS201: { code: 'CS201', name: 'Data Structures', instructor: 'Dr. Karim Mansour', enrolled: 48, description: 'Arrays, linked lists, trees, graphs, hashing, and complexity analysis. Hands-on labs reinforce each topic with practical implementations.' },
    MA205: { code: 'MA205', name: 'Linear Algebra', instructor: 'Dr. Hala Sabry', enrolled: 56, description: 'Vector spaces, matrices, determinants, eigenvalues, and linear transformations with applications in data science.' },
    CS101: { code: 'CS101', name: 'Intro to Programming', instructor: 'Dr. Ahmed Zaki', enrolled: 38, description: 'Foundations of programming using Python: variables, control flow, functions, and basic data structures.' },
};

const MOCK_MATERIALS: Record<string, Material[]> = {
    CS201: [
        { id: 'm1', title: 'Lecture 1 — Arrays & Complexity', fileName: 'cs201-lec01.pdf', fileType: 'pdf', uploadedAt: '2026-02-10' },
        { id: 'm2', title: 'Lab 3 Starter Code', fileName: 'cs201-lab03-starter.zip', fileType: 'zip', uploadedAt: '2026-02-24' },
        { id: 'm3', title: 'Trees & Graphs Slides', fileName: 'cs201-trees.ppt', fileType: 'ppt', uploadedAt: '2026-03-05' },
    ],
    MA205: [
        { id: 'm4', title: 'Eigenvalues Notes', fileName: 'ma205-eigen.pdf', fileType: 'pdf', uploadedAt: '2026-02-18' },
        { id: 'm5', title: 'Problem Set 2', fileName: 'ma205-ps2.doc', fileType: 'doc', uploadedAt: '2026-03-01' },
    ],
    CS101: [
        { id: 'm6', title: 'Python Basics', fileName: 'cs101-python.pdf', fileType: 'pdf', uploadedAt: '2026-02-12' },
    ],
};

const MOCK_ASSIGNMENTS: Record<string, Assignment[]> = {
    CS201: [
        { id: 'a1', title: 'Assignment 3 — Binary Search Trees', dueDate: '2026-04-12', submissionCount: 42, attachments: ['CS201-A3-spec.pdf'], maxScore: 100, latePenalty: -2, missingAfterHours: 24 },
        { id: 'a2', title: 'Lab 5 — Graph Traversal', dueDate: '2026-04-20', submissionCount: 31, maxScore: 50, latePenalty: -1, missingAfterHours: 12 },
    ],
    MA205: [
        { id: 'a3', title: 'Problem Set 2 — Eigenvectors', dueDate: '2026-04-15', submissionCount: 50, maxScore: 100, latePenalty: -2, missingAfterHours: 24 },
    ],
    CS101: [
        { id: 'a4', title: 'Assignment 1 — Control Flow', dueDate: '2026-04-10', submissionCount: 35, attachments: ['CS101-A1-spec.pdf'], maxScore: 100, latePenalty: -2, missingAfterHours: 24 },
    ],
};

const TACourseDetail: React.FC = () => {
    const t = useT();
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();

    const [course, setCourse] = useState<CourseInfo | null>(null);
    const [materials, setMaterials] = useState<Material[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
    // Inline edit + delete — same pattern as ProfCourseDetail. The TA can
    // edit/delete because the backend gates on prof + ta + admin.
    const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
    const [assignmentError, setAssignmentError] = useState<string | null>(null);

    const handleDeleteAssignment = (id: string) => {
        // MVP build — local-only delete.
        setBusyDeleteId(id);
        setAssignmentError(null);
        setAssignments((prev) => prev.filter((a) => a.id !== id));
        setConfirmDeleteId(null);
        setBusyDeleteId(null);
    };

    const handleAssignmentSaved = (updated: EditableAssignment) => {
        setAssignments((prev) =>
            prev.map((a) =>
                a.id === updated.id
                    ? {
                          ...a,
                          title: updated.title,
                          dueDate: typeof updated.dueDate === 'string' ? updated.dueDate : a.dueDate,
                          maxScore: updated.maxScore ?? a.maxScore,
                          latePenalty: updated.latePenalty ?? a.latePenalty,
                          missingAfterHours: updated.missingAfterHours ?? a.missingAfterHours,
                      }
                    : a,
            ),
        );
    };

    useEffect(() => {
        if (!code) return;
        // MVP build — populate from static mock data, no backend calls.
        setIsLoading(true);
        const upper = code.toUpperCase();
        setCourse(MOCK_COURSES[upper] ?? { code, name: code, instructor: 'Dr. Karim Mansour', enrolled: 40, description: 'Course details for the MVP build.' });
        setMaterials(MOCK_MATERIALS[upper] ?? []);
        setAssignments(MOCK_ASSIGNMENTS[upper] ?? []);
        setIsLoading(false);
    }, [code]);

    const tabButton = (tab: ActiveTab, label: string, count?: number) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                activeTab === tab
                    ? 'bg-[#6A3FF4] text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-white/10'
            }`}
        >
            {label}{count !== undefined ? ` (${count})` : ''}
        </button>
    );

    const getFileIcon = (type?: string) => {
        switch (type) {
            case 'pdf': return 'ph-file-pdf text-red-500';
            case 'doc': return 'ph-file-doc text-blue-500';
            case 'zip': return 'ph-file-zip text-yellow-500';
            case 'ppt': return 'ph-file-ppt text-orange-500';
            default: return 'ph-file text-gray-500';
        }
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/ta/courses')}
                        aria-label={t('ta.backToCoursesShort')}
                        className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4]/20 transition-colors"
                    >
                        <i className="ph-bold ph-arrow-left text-black dark:text-white"></i>
                    </button>
                    <div>
                        <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-0.5">
                            {isLoading ? t('ta.courseDetailLoading') : (course?.name || code)}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                            {isLoading ? '' : `${t('ta.coursePrefix')} ${code}`}
                        </p>
                    </div>
                </div>
            </AnimateOnView>

            {/* Course header card */}
            <AnimateOnView delay={0.05} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    {isLoading ? (
                        <div className="space-y-3">
                            <div className="h-6 w-48 bg-white/10 animate-pulse rounded-lg"></div>
                            <div className="h-4 w-32 bg-white/10 animate-pulse rounded-lg"></div>
                        </div>
                    ) : course ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h3 className="text-black dark:text-white font-bold text-lg">{course.name}</h3>
                                <p className="text-[#6A3FF4] text-sm font-bold uppercase tracking-wider mt-0.5">{course.code}</p>
                                <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
                                    <span className="flex items-center gap-1.5">
                                        <i className="ph-fill ph-chalkboard-teacher text-[#6A3FF4]"></i>
                                        {course.instructor || t('ta.naLabel')}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <i className="ph-fill ph-users text-[#6A3FF4]"></i>
                                        {course.enrolled} {t('ta.enrolledShortSuffix')}
                                    </span>
                                </div>
                            </div>
                            <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-3 py-1.5 rounded-full self-start sm:self-auto">
                                {t('ta.teachingAssistantBadgeLabel')}
                            </span>
                        </div>
                    ) : (
                        <p className="text-gray-500 dark:text-gray-400">{t('ta.courseNotFound')}</p>
                    )}
                </div>
            </AnimateOnView>

            {/* Tabs */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex gap-2 flex-wrap">
                    {tabButton('overview', t('ta.tabOverview'))}
                    {tabButton('materials', t('ta.tabMaterials'), materials.length)}
                    {tabButton('assignments', t('ta.tabAssignments'), assignments.length)}
                </div>
            </AnimateOnView>

            {/* Tab content */}
            <AnimateOnView delay={0.15} enabled={false}>
                {activeTab === 'overview' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[
                                { label: t('ta.enrolledStudentsLabel'), value: course?.enrolled ?? 0, icon: 'ph-users', color: 'bg-[#6A3FF4]/20 text-[#6A3FF4]' },
                                { label: t('ta.materialsStatLabel'), value: materials.length, icon: 'ph-folder-open', color: 'bg-blue-500/20 text-blue-500' },
                                { label: t('ta.tabAssignments'), value: assignments.length, icon: 'ph-clipboard-text', color: 'bg-orange-500/20 text-orange-500' },
                            ].map((stat, i) => (
                                <div key={i} className={`${glassCardStyle} p-5 flex items-center gap-4`}>
                                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${stat.color}`}>
                                        <i className={`ph-fill ${stat.icon} text-xl`}></i>
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold text-black dark:text-white">{isLoading ? '—' : stat.value}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {course?.description && (
                            <div className={`${glassCardStyle} p-6`}>
                                <h4 className="text-black dark:text-white font-bold mb-2">{t('ta.descriptionHeading')}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{course.description}</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'materials' && (
                    <div className={`${glassCardStyle} p-6`}>
                        <h4 className="text-black dark:text-white font-bold mb-4">{t('ta.courseMaterialsHeadingTab')}</h4>
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => <div key={i} className="h-14 w-full bg-white/10 animate-pulse rounded-xl"></div>)}
                            </div>
                        ) : materials.length === 0 ? (
                            <div className="text-center py-12">
                                <i className="ph-bold ph-folder-open text-4xl text-gray-400 mb-3 block"></i>
                                <p className="text-gray-500 dark:text-gray-400">{t('ta.noMaterialsYet')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {materials.map(mat => (
                                    <div key={mat.id} className="flex items-center gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all">
                                        <i className={`ph-fill ${getFileIcon(mat.fileType)} text-xl flex-shrink-0`}></i>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-black dark:text-white text-sm font-medium truncate">{mat.fileName || mat.title}</p>
                                            <p className="text-gray-500 text-xs mt-0.5">
                                                {new Date(mat.uploadedAt || mat.createdAt || '').toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'assignments' && (
                    <div className={`${glassCardStyle} p-6`}>
                        <h4 className="text-black dark:text-white font-bold mb-4">{t('ta.assignmentsHeadingTab')}</h4>
                        {assignmentError && (
                            <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-center gap-2">
                                <i className="ph-bold ph-warning-circle"></i>
                                {assignmentError}
                            </div>
                        )}
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => <div key={i} className="h-16 w-full bg-white/10 animate-pulse rounded-xl"></div>)}
                            </div>
                        ) : assignments.length === 0 ? (
                            <div className="text-center py-12">
                                <i className="ph-bold ph-clipboard-text text-4xl text-gray-400 mb-3 block"></i>
                                <p className="text-gray-500 dark:text-gray-400">{t('ta.noAssignmentsForCourse')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {assignments.map(asgn => (
                                    <div key={asgn.id} className="p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-black dark:text-white text-sm font-medium">{asgn.title}</p>
                                                {asgn.dueDate && (
                                                    <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1">
                                                        <i className="ph-bold ph-clock text-[#6A3FF4]"></i>
                                                        {t('ta.dueShortLabel')} {new Date(asgn.dueDate).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {asgn.submissionCount !== undefined && (
                                                    <span className="text-xs font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-2.5 py-1 rounded-full">
                                                        {t('ta.submissionsCountLabel', { count: asgn.submissionCount })}
                                                    </span>
                                                )}
                                                {/* Edit + delete — same affordances as the prof side. */}
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingAssignment(asgn)}
                                                    title={t('ta.editAssignmentTooltip')}
                                                    aria-label={t('ta.editAriaLabel', { title: asgn.title })}
                                                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-[#6A3FF4]/15 hover:text-[#6A3FF4] text-gray-400 border border-white/10 hover:border-[#6A3FF4]/40 transition-colors flex items-center justify-center"
                                                >
                                                    <i className="ph-bold ph-pencil-simple text-sm"></i>
                                                </button>
                                                {confirmDeleteId === asgn.id ? (
                                                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-500">
                                                        <span>{t('ta.deleteShortLabel')}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteAssignment(asgn.id)}
                                                            disabled={busyDeleteId === asgn.id}
                                                            className="px-2 py-0.5 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                                        >
                                                            {busyDeleteId === asgn.id ? '…' : t('ta.yesBtn')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteId(null)}
                                                            disabled={busyDeleteId === asgn.id}
                                                            className="px-2 py-0.5 rounded-md bg-white/40 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/20 transition-colors"
                                                        >
                                                            {t('ta.noBtn')}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDeleteId(asgn.id)}
                                                        title={t('ta.deleteAssignmentTooltip')}
                                                        aria-label={t('ta.deleteAriaLabel', { title: asgn.title })}
                                                        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/15 hover:text-red-500 text-gray-400 border border-white/10 hover:border-red-500/30 transition-colors flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash text-sm"></i>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {asgn.attachments && asgn.attachments.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {asgn.attachments.map((url, idx) => {
                                                    const fileName = url.split('/').pop() || `attachment-${idx + 1}`;
                                                    const isPdf = fileName.toLowerCase().endsWith('.pdf');
                                                    return (
                                                        <span
                                                            key={url}
                                                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 text-black dark:text-white hover:border-[#6A3FF4]/60 hover:bg-[#6A3FF4]/10 transition-colors cursor-pointer"
                                                        >
                                                            <i className={`ph-fill ${isPdf ? 'ph-file-pdf text-red-500' : 'ph-file text-[#6A3FF4]'}`}></i>
                                                            <span className="truncate max-w-[16rem]">{fileName}</span>
                                                            <i className="ph-bold ph-download-simple text-[10px]"></i>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </AnimateOnView>

            {editingAssignment && code && (
                <AssignmentEditModal
                    courseCode={code}
                    assignment={{
                        id: editingAssignment.id,
                        title: editingAssignment.title,
                        dueDate: editingAssignment.dueDate ?? null,
                        maxScore: editingAssignment.maxScore ?? null,
                        latePenalty: editingAssignment.latePenalty ?? null,
                        missingAfterHours: editingAssignment.missingAfterHours ?? null,
                    }}
                    onClose={() => setEditingAssignment(null)}
                    onSaved={handleAssignmentSaved}
                />
            )}
        </div>
    );
};

export default TACourseDetail;
