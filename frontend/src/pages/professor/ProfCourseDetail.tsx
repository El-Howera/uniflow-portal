import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { API_URLS } from '@shared/config';
import { AnimateOnView } from '../../components/AnimateOnView';
import { AssignmentEditModal, EditableAssignment } from '../../components/AssignmentEditModal';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

type ActiveTab = 'overview' | 'materials' | 'assignments' | 'grading';

interface CourseInfo {
    code: string;
    name: string;
    instructor: string;
    enrolled: number;
    description?: string;
    attendanceRate?: number;
    avgGrade?: number;
    passRate?: number;
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
    // URLs to the spec files attached when the assignment was created
    // (e.g. the PDF the staff dropped in the Materials uploader). Stored
    // on Assignment.attachments[] server-side.
    attachments?: string[];
    maxScore?: number;
    // Per-assignment penalty knobs. Surfaced here so the edit modal can
    // round-trip them without a re-fetch.
    latePenalty?: number;
    missingAfterHours?: number;
}

interface StudentGrade {
    id: string;
    name: string;
    studentId: string;
    grades?: { score: number; max: number; weight?: number }[];
}

const getLetterGrade = (pct: number): { grade: string; color: string } => {
    if (pct >= 90) return { grade: 'A', color: 'text-green-500' };
    if (pct >= 80) return { grade: 'B', color: 'text-blue-500' };
    if (pct >= 70) return { grade: 'C', color: 'text-amber-500' };
    if (pct >= 60) return { grade: 'D', color: 'text-orange-500' };
    return { grade: 'F', color: 'text-red-500' };
};

const getFileIcon = (type?: string): string => {
    switch (type) {
        case 'pdf': return 'ph-file-pdf text-red-500';
        case 'doc': return 'ph-file-doc text-blue-500';
        case 'zip': return 'ph-file-zip text-yellow-500';
        case 'ppt': return 'ph-file-ppt text-orange-500';
        default: return 'ph-file text-gray-500';
    }
};

const ProfCourseDetail: React.FC = () => {
    const t = useT();
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();

    const [course, setCourse] = useState<CourseInfo | null>(null);
    const [materials, setMaterials] = useState<Material[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [students, setStudents] = useState<StudentGrade[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isStudentsLoading, setIsStudentsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
    // Inline edit + delete state for the assignments list. Edit opens the
    // shared AssignmentEditModal; delete uses a two-step confirm pill so
    // a stray click can't nuke a row without explicit "Yes".
    const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
    const [assignmentError, setAssignmentError] = useState<string | null>(null);

    const token = localStorage.getItem('authToken');
    const email = localStorage.getItem('currentUserEmail') || '';
    const authHeader = { Authorization: `Bearer ${token}` };

    useEffect(() => {
        if (!code) return;

        const fetchAll = async () => {
            setIsLoading(true);
            try {
                const [coursesRes, materialsRes, assignmentsRes] = await Promise.all([
                    fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, {
                        credentials: 'include',
                        headers: authHeader,
                    }),
                    fetch(`${API_URLS.courseContent()}/api/courses/${code}/materials`, {
                        credentials: 'include',
                        headers: authHeader,
                    }),
                    fetch(`${API_URLS.courseContent()}/api/courses/${code}/assignments`, {
                        credentials: 'include',
                        headers: authHeader,
                    }),
                ]);

                if (coursesRes.ok) {
                    const data: CourseInfo[] = await coursesRes.json();
                    const found = Array.isArray(data) ? data.find(c => c.code === code) : null;
                    if (found) setCourse(found);
                }

                if (materialsRes.ok) {
                    const data = await materialsRes.json();
                    setMaterials(Array.isArray(data) ? data : (data.materials || []));
                }

                if (assignmentsRes.ok) {
                    const data = await assignmentsRes.json();
                    setAssignments(Array.isArray(data) ? data : (data.assignments || []));
                }
            } catch { /* ignore */ } finally {
                setIsLoading(false);
            }
        };

        fetchAll();
        // authHeader and email are derived from localStorage and stable for the page lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code]);

    useEffect(() => {
        if (activeTab !== 'grading' || !code) return;
        const fetchStudents = async () => {
            setIsStudentsLoading(true);
            try {
                const res = await fetch(`${API_URLS.courseContent()}/api/professor/course-students/${code}`, {
                    credentials: 'include',
                    headers: authHeader,
                });
                if (res.ok) {
                    const data = await res.json();
                    setStudents(Array.isArray(data) ? data : []);
                }
            } catch { /* ignore */ } finally {
                setIsStudentsLoading(false);
            }
        };
        fetchStudents();
        // authHeader is derived from localStorage and stable for the page lifetime.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, code]);

    // DELETE flow — fires once the user confirms via the inline pill.
    const handleDeleteAssignment = async (id: string) => {
        if (!code) return;
        setBusyDeleteId(id);
        setAssignmentError(null);
        try {
            const res = await fetch(
                `${API_URLS.courseContent()}/api/courses/${encodeURIComponent(code)}/assignments/${encodeURIComponent(id)}`,
                {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: authHeaders() as Record<string, string>,
                },
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setAssignmentError((body as { error?: string }).error || t('professor.failedWithStatus', { code: res.status }));
                return;
            }
            // Drop the row locally so the list updates instantly.
            setAssignments((prev) => prev.filter((a) => a.id !== id));
            setConfirmDeleteId(null);
        } catch (e) {
            setAssignmentError(e instanceof Error ? e.message : t('professor.networkErr'));
        } finally {
            setBusyDeleteId(null);
        }
    };

    // Apply the modal's saved row back into the list — keeps the parent
    // consistent without re-fetching the whole assignment endpoint.
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

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/professor/course-overview')}
                        className="w-9 h-9 rounded-xl bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center hover:bg-[#6A3FF4]/20 transition-colors"
                        aria-label={t('professor.backToCourses')}
                    >
                        <i className="ph-bold ph-arrow-left text-black dark:text-white"></i>
                    </button>
                    <div>
                        <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-0.5">
                            {isLoading ? t('professor.loadingShort') : (course?.name || code)}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">
                            {isLoading ? '' : `${t('professor.courseLabel')}: ${code}`}
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
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div>
                                <h3 className="text-black dark:text-white font-bold text-lg">{course.name}</h3>
                                <p className="text-[#6A3FF4] text-sm font-bold uppercase tracking-wider mt-0.5">{course.code}</p>
                                <div className="flex flex-wrap gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
                                    <span className="flex items-center gap-1.5">
                                        <i className="ph-fill ph-users text-[#6A3FF4]"></i>
                                        {course.enrolled} {t('professor.enrolledSuffix')}
                                    </span>
                                    {course.attendanceRate !== undefined && (
                                        <span className="flex items-center gap-1.5">
                                            <i className="ph-fill ph-check-circle text-green-500"></i>
                                            {course.attendanceRate}% {t('professor.attendanceSuffix')}
                                        </span>
                                    )}
                                    {course.avgGrade !== undefined && (
                                        <span className="flex items-center gap-1.5">
                                            <i className="ph-fill ph-chart-bar text-[#6A3FF4]"></i>
                                            {course.avgGrade}% {t('professor.avgGradeSuffix')}
                                        </span>
                                    )}
                                    {course.passRate !== undefined && (
                                        <span className="flex items-center gap-1.5">
                                            <i className="ph-fill ph-graduation-cap text-blue-500"></i>
                                            {course.passRate}% {t('professor.passRateSuffix')}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-3 py-1.5 rounded-full self-start">
                                {t('professor.professorBadge')}
                            </span>
                        </div>
                    ) : (
                        <p className="text-gray-500 dark:text-gray-400">{t('professor.courseNotFound')}</p>
                    )}
                </div>
            </AnimateOnView>

            {/* Tabs */}
            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex gap-2 flex-wrap">
                    {tabButton('overview', t('professor.tabOverview'))}
                    {tabButton('materials', t('professor.tabMaterials'), materials.length)}
                    {tabButton('assignments', t('professor.tabAssignments'), assignments.length)}
                    {tabButton('grading', t('professor.tabGrading'))}
                </div>
            </AnimateOnView>

            {/* Tab content */}
            <AnimateOnView delay={0.15} enabled={false}>
                {activeTab === 'overview' && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {[
                                { label: t('professor.enrolledStudents'), value: course?.enrolled ?? 0, icon: 'ph-users', color: 'bg-[#6A3FF4]/20 text-[#6A3FF4]' },
                                { label: t('professor.materialsCount'), value: materials.length, icon: 'ph-folder-open', color: 'bg-blue-500/20 text-blue-500' },
                                { label: t('professor.assignmentsCount'), value: assignments.length, icon: 'ph-clipboard-text', color: 'bg-orange-500/20 text-orange-500' },
                                { label: t('professor.passRateLabel'), value: `${course?.passRate ?? 0}%`, icon: 'ph-graduation-cap', color: 'bg-green-500/20 text-green-500' },
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
                                <h4 className="text-black dark:text-white font-bold mb-2">{t('professor.descriptionLabel')}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{course.description}</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'materials' && (
                    <div className={`${glassCardStyle} p-6`}>
                        <h4 className="text-black dark:text-white font-bold mb-4">{t('professor.courseMaterialsLabel')}</h4>
                        {isLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => <div key={i} className="h-14 w-full bg-white/10 animate-pulse rounded-xl"></div>)}
                            </div>
                        ) : materials.length === 0 ? (
                            <div className="text-center py-12">
                                <i className="ph-bold ph-folder-open text-4xl text-gray-400 mb-3 block"></i>
                                <p className="text-gray-500 dark:text-gray-400">{t('professor.noMaterialsUploaded')}</p>
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
                        <h4 className="text-black dark:text-white font-bold mb-4">{t('professor.tabAssignments')}</h4>
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
                                <p className="text-gray-500 dark:text-gray-400">{t('professor.noAssignmentsHere')}</p>
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
                                                        {t('professor.dueLabel')} {new Date(asgn.dueDate).toLocaleDateString()}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {asgn.submissionCount !== undefined && (
                                                    <span className="text-xs font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 px-2.5 py-1 rounded-full">
                                                        {t('professor.submissionsCountLabel', { n: asgn.submissionCount })}
                                                    </span>
                                                )}
                                                {/* Edit + delete — hover on the row reveals the actions.
                                                    Delete is a two-step pill: first click sets the
                                                    confirm flag, second commits. Cancel pill resets. */}
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingAssignment(asgn)}
                                                    title={t('professor.editAssignmentTitle')}
                                                    aria-label={`${t('professor.editFormShort')} ${asgn.title}`}
                                                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-[#6A3FF4]/15 hover:text-[#6A3FF4] text-gray-400 border border-white/10 hover:border-[#6A3FF4]/40 transition-colors flex items-center justify-center"
                                                >
                                                    <i className="ph-bold ph-pencil-simple text-sm"></i>
                                                </button>
                                                {confirmDeleteId === asgn.id ? (
                                                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-500">
                                                        <span>{t('professor.deletePromptShort')}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteAssignment(asgn.id)}
                                                            disabled={busyDeleteId === asgn.id}
                                                            className="px-2 py-0.5 rounded-md bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                                        >
                                                            {busyDeleteId === asgn.id ? '…' : t('professor.yesBtn')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmDeleteId(null)}
                                                            disabled={busyDeleteId === asgn.id}
                                                            className="px-2 py-0.5 rounded-md bg-white/40 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/20 transition-colors"
                                                        >
                                                            {t('professor.noBtn')}
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setConfirmDeleteId(asgn.id)}
                                                        title={t('professor.deleteAssignmentTitle')}
                                                        aria-label={`${t('professor.deleteBtn')} ${asgn.title}`}
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
                                                        <a
                                                            key={url}
                                                            href={`${API_URLS.courseContent()}${url}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 text-black dark:text-white hover:border-[#6A3FF4]/60 hover:bg-[#6A3FF4]/10 transition-colors"
                                                        >
                                                            <i className={`ph-fill ${isPdf ? 'ph-file-pdf text-red-500' : 'ph-file text-[#6A3FF4]'}`}></i>
                                                            <span className="truncate max-w-[16rem]">{fileName}</span>
                                                            <i className="ph-bold ph-download-simple text-[10px]"></i>
                                                        </a>
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

                {activeTab === 'grading' && (
                    <div className={`${glassCardStyle} p-6`}>
                        <h4 className="text-black dark:text-white font-bold mb-4 flex items-center gap-2">
                            <i className="ph-bold ph-student text-[#6A3FF4]"></i>
                            {t('professor.studentGrades')}
                        </h4>
                        {isStudentsLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map(i => <div key={i} className="h-14 w-full bg-white/10 animate-pulse rounded-xl"></div>)}
                            </div>
                        ) : students.length === 0 ? (
                            <div className="text-center py-12">
                                <i className="ph-bold ph-users text-4xl text-gray-400 mb-3 block"></i>
                                <p className="text-gray-500 dark:text-gray-400">{t('professor.noStudentGradeData')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {students.map(student => {
                                    const gradedItems = (student.grades || []).filter(g => g.score > 0);
                                    const avg = gradedItems.length > 0
                                        ? Math.round(gradedItems.reduce((s, g) => s + (g.score / g.max) * (g.weight || 1), 0) / gradedItems.length)
                                        : 0;
                                    const letter = getLetterGrade(avg);
                                    return (
                                        <div key={student.id} className="flex items-center justify-between p-4 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all">
                                            <div>
                                                <p className="text-black dark:text-white text-sm font-medium">{student.name}</p>
                                                <p className="text-gray-500 text-xs mt-0.5">{student.studentId}</p>
                                            </div>
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <span className="text-xs text-gray-500">{avg}%</span>
                                                <span className={`text-xl font-bold ${letter.color}`}>{letter.grade}</span>
                                            </div>
                                        </div>
                                    );
                                })}
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

export default ProfCourseDetail;
