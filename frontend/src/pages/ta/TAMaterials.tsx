import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { GlassDateTimePicker } from '../../components/GlassDateTimePicker';

import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface MaterialFile {
    id: string;
    name: string;
    size: string;
    date: string;
    type: string;
}

interface Module {
    id: string;
    title: string;
    files: MaterialFile[];
    isOpen: boolean;
}

interface CourseRow {
    code: string;
    name?: string;
    title?: string;
}

interface EnrolledStudent {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

// --- Static preview data ---
const MOCK_COURSES: CourseRow[] = [
    { code: 'CS201', name: 'Data Structures', title: 'Data Structures' },
    { code: 'MA205', name: 'Linear Algebra', title: 'Linear Algebra' },
    { code: 'CS101', name: 'Intro to Programming', title: 'Intro to Programming' },
];

const MOCK_MODULES: Record<string, Module[]> = {
    CS201: [
        {
            id: 'module-0', title: 'Lectures', isOpen: true, files: [
                { id: 'f1', name: 'cs201-lec01-arrays.pdf', size: '2.4 MB', date: '2/10/2026', type: 'pdf' },
                { id: 'f2', name: 'cs201-lec02-linked-lists.pdf', size: '3.1 MB', date: '2/17/2026', type: 'pdf' },
            ],
        },
        {
            id: 'module-1', title: 'Labs', isOpen: false, files: [
                { id: 'f3', name: 'cs201-lab03-starter.zip', size: '512 KB', date: '2/24/2026', type: 'zip' },
            ],
        },
        {
            id: 'module-2', title: 'Assignments', isOpen: false, files: [
                { id: 'f4', name: 'CS201-A3-spec.pdf', size: '480 KB', date: '4/1/2026', type: 'pdf' },
            ],
        },
    ],
    MA205: [
        {
            id: 'module-0', title: 'Lectures', isOpen: true, files: [
                { id: 'f5', name: 'ma205-eigenvalues.pdf', size: '1.8 MB', date: '2/18/2026', type: 'pdf' },
            ],
        },
        {
            id: 'module-1', title: 'References', isOpen: false, files: [
                { id: 'f6', name: 'ma205-problem-set-2.doc', size: '220 KB', date: '3/1/2026', type: 'doc' },
            ],
        },
    ],
    CS101: [
        {
            id: 'module-0', title: 'Lectures', isOpen: true, files: [
                { id: 'f7', name: 'cs101-python-basics.pdf', size: '1.2 MB', date: '2/12/2026', type: 'pdf' },
                { id: 'f8', name: 'cs101-control-flow.ppt', size: '4.5 MB', date: '2/19/2026', type: 'ppt' },
            ],
        },
    ],
};

const MOCK_ENROLLED: Record<string, EnrolledStudent[]> = {
    CS201: [
        { id: 'st1', firstName: 'Omar', lastName: 'Farouk', email: 'omar.farouk@uniflow.edu' },
        { id: 'st3', firstName: 'Yara', lastName: 'Mahmoud', email: 'yara.mahmoud@uniflow.edu' },
        { id: 'st6', firstName: 'Hana', lastName: 'Said', email: 'hana.said@uniflow.edu' },
    ],
    MA205: [
        { id: 'st2', firstName: 'Nour', lastName: 'El-Din', email: 'nour.eldin@uniflow.edu' },
        { id: 'st7', firstName: 'Kareem', lastName: 'Adel', email: 'kareem.adel@uniflow.edu' },
    ],
    CS101: [
        { id: 'st4', firstName: 'Ziad', lastName: 'Tarek', email: 'ziad.tarek@uniflow.edu' },
        { id: 'st5', firstName: 'Salma', lastName: 'Adel', email: 'salma.adel@uniflow.edu' },
    ],
};

const getFileIcon = (type: string) => {
    switch (type) {
        case 'pdf': return 'ph-file-pdf text-red-500';
        case 'doc': return 'ph-file-doc text-blue-500';
        case 'zip': return 'ph-file-zip text-yellow-500';
        case 'ppt': return 'ph-file-ppt text-orange-500';
        case 'xls': return 'ph-file-xls text-green-500';
        default: return 'ph-file text-gray-500';
    }
};

const TAMaterials: React.FC = () => {
    const t = useT();
    const [courses, setCourses] = useState<CourseRow[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<string>('');
    const [modules, setModules] = useState<Module[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    // Assignment-specific fields — only collected when category is Assignments.
    const [assignmentTitle, setAssignmentTitle] = useState('');
    const [assignmentDueDate, setAssignmentDueDate] = useState('');
    const [assignmentMaxScore, setAssignmentMaxScore] = useState('100');
    // Per-assignment grace + penalty knobs — same wiring as ProfMaterials.
    const [assignmentGraceHours, setAssignmentGraceHours] = useState('0');
    const [assignmentLatePenalty, setAssignmentLatePenalty] = useState('-2');
    // Audience targeting (specific-students picker) — see ProfMaterials.
    const [assignmentAudienceMode, setAssignmentAudienceMode] = useState<'all' | 'specific'>('all');
    const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudent[]>([]);
    const [audienceSearch, setAudienceSearch] = useState('');
    const [selectedAudienceIds, setSelectedAudienceIds] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 'Final Project' is a dedicated category — appears as its own
    // section on the student page; can ALSO be posted as an assignment
    // row if the staff picks the Final Project category alongside the
    // assignment-mode fields.
    const categories = ['Lectures', 'Assignments', 'Final Project', 'Labs', 'References', 'Assessments'];
    // Final Project also routes through the assignment-mode path so it
    // gets the due-date / max-score / penalty fields and shows up as
    // an Assignment row that students can submit against.
    const isAssignmentMode =
        selectedCategory === 'Assignments' || selectedCategory === 'Final Project';
    const isFinalProjectMode = selectedCategory === 'Final Project';

    // MVP build — populate TA courses from static mock data on mount.
    useEffect(() => {
        setIsLoading(true);
        setCourses(MOCK_COURSES);
        if (MOCK_COURSES.length > 0) {
            setSelectedCourse(MOCK_COURSES[0].code);
        }
        setIsLoading(false);
    }, []);

    // MVP build — load materials for the selected course from mock data.
    useEffect(() => {
        if (!selectedCourse) return;
        setIsLoading(true);
        setModules(MOCK_MODULES[selectedCourse] ?? []);
        setIsLoading(false);
    }, [selectedCourse]);

    const toggleModule = (id: string) => {
        setModules(prev => prev.map(m => m.id === id ? { ...m, isOpen: !m.isOpen } : m));
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        setUploadedFiles(prev => [...prev, ...files]);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
        }
    };

    const resetForm = () => {
        setUploadedFiles([]);
        setSelectedCategory('');
        setAssignmentTitle('');
        setAssignmentDueDate('');
        setAssignmentMaxScore('100');
        setAssignmentGraceHours('0');
        setAssignmentLatePenalty('-2');
        setAssignmentAudienceMode('all');
        setSelectedAudienceIds(new Set());
        setAudienceSearch('');
    };

    // MVP build — load enrolled students for the active course from mock data.
    useEffect(() => {
        if (assignmentAudienceMode !== 'specific' || !selectedCourse) return;
        setEnrolledStudents(MOCK_ENROLLED[selectedCourse] ?? []);
        setSelectedAudienceIds(new Set());
    }, [assignmentAudienceMode, selectedCourse]);

    const handleClear = () => {
        resetForm();
        setFeedback(null);
    };

    const handleUpload = () => {
        setFeedback(null);

        if (!selectedCourse || !selectedCategory) {
            setFeedback({ kind: 'error', text: t('ta.pickCourseAndCategoryFirst') });
            return;
        }
        if (uploadedFiles.length === 0) {
            setFeedback({ kind: 'error', text: t('ta.dropOrPickAtLeastOne') });
            return;
        }

        // Assignment branch — local-only: append the dropped files into the
        // matching module so the preview reflects the new upload.
        if (isAssignmentMode) {
            if (!assignmentTitle.trim() || !assignmentDueDate) {
                setFeedback({ kind: 'error', text: t('ta.assignmentNeedsTitleAndDate') });
                return;
            }
            const targetTitle = isFinalProjectMode ? 'Final Project' : 'Assignments';
            const newFiles: MaterialFile[] = uploadedFiles.map((file, i) => ({
                id: `local-${Date.now()}-${i}`,
                name: file.name,
                size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
                date: new Date().toLocaleDateString(),
                type: (file.name.split('.').pop() || 'pdf').toLowerCase(),
            }));
            setModules((prev) => {
                const existing = prev.find((m) => m.title === targetTitle);
                if (existing) {
                    return prev.map((m) =>
                        m.title === targetTitle ? { ...m, files: [...m.files, ...newFiles] } : m
                    );
                }
                return [...prev, { id: `module-${prev.length}`, title: targetTitle, files: newFiles, isOpen: true }];
            });
            resetForm();
            setFeedback({ kind: 'success', text: t('ta.assignmentPostedOk') });
            return;
        }

        // Default: regular CourseMaterial upload (multi-file) — local-only.
        const newFiles: MaterialFile[] = uploadedFiles.map((file, i) => ({
            id: `local-${Date.now()}-${i}`,
            name: file.name,
            size: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
            date: new Date().toLocaleDateString(),
            type: (file.name.split('.').pop() || 'pdf').toLowerCase(),
        }));
        const count = uploadedFiles.length;
        const category = selectedCategory;
        setModules((prev) => {
            const existing = prev.find((m) => m.title === category);
            if (existing) {
                return prev.map((m) =>
                    m.title === category ? { ...m, files: [...m.files, ...newFiles] } : m
                );
            }
            return [...prev, { id: `module-${prev.length}`, title: category, files: newFiles, isOpen: true }];
        });
        resetForm();
        setFeedback({
            kind: 'success',
            text: t('ta.uploadedFilesOk', { n: count, category }),
        });
    };

    const handleDeleteFile = (moduleId: string, fileId: string) => {
        // MVP build — local-only delete.
        setModules(prev => prev.map(m =>
            m.id === moduleId ? { ...m, files: m.files.filter(f => f.id !== fileId) } : m
        ));
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.materialsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('ta.materialsSubtitle')}</p>
            </AnimateOnView>

            {/* Course Selector — GlassDropdown matches the rest of the
                project (no native `<select>` per design-system rule). */}
            <AnimateOnView delay={0.05} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <label className="text-sm font-medium text-black dark:text-gray-300 block mb-2">{t('staff.selectCourse')}</label>
                    {isLoading || courses.length === 0 ? (
                        <div className="h-11 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>
                    ) : (
                        <GlassDropdown
                            value={selectedCourse}
                            onChange={setSelectedCourse}
                            options={courses.map((c) => ({
                                value: c.code,
                                label: `${c.code} — ${c.title || c.name || c.code}`,
                                icon: 'ph-book-open',
                            }))}
                            direction="auto"
                            className="w-full"
                        />
                    )}
                </div>
            </AnimateOnView>

            {/* Upload Area */}
            <AnimateOnView delay={0.1}>
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4">{t('ta.newMaterialUploadLabel')}</h3>

                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={() => setDragOver(false)}
                        className={`border-2 border-dashed rounded-2xl p-10 transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${dragOver
                            ? 'border-[#6A3FF4] bg-[#6A3FF4]/10'
                            : 'border-white/20 dark:border-white/10 hover:border-[#6A3FF4]/40 bg-white/5 dark:bg-black/10'
                            }`}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
                        <i className={`ph-bold ph-cloud-arrow-up text-4xl ${dragOver ? 'text-[#6A3FF4]' : 'text-gray-400'}`}></i>
                        <p className="text-gray-500 dark:text-gray-400 text-sm">{t('ta.dragDropHere')}</p>
                        <button className="px-4 py-2 bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl text-sm font-semibold text-black dark:text-white hover:bg-[#6A3FF4]/10 transition-colors">
                            {t('ta.browseFilesLabel')}
                        </button>
                    </div>

                    {uploadedFiles.length > 0 && (
                        <div className="mt-4 space-y-2">
                            {uploadedFiles.map((file, i) => (
                                <div key={i} className="flex items-center justify-between bg-white/5 dark:bg-black/10 rounded-xl px-4 py-2 border border-white/10 dark:border-white/5">
                                    <div className="flex items-center gap-2">
                                        <i className="ph-fill ph-file text-[#6A3FF4]"></i>
                                        <span className="text-sm text-black dark:text-white">{file.name}</span>
                                        <span className="text-[10px] text-gray-500">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                                    </div>
                                    <button onClick={() => setUploadedFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-500 transition-colors">
                                        <i className="ph-bold ph-x"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-4">
                        <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('ta.typeLabel')}</label>
                        <GlassDropdown
                            value={selectedCategory}
                            onChange={setSelectedCategory}
                            options={[
                                { value: '', label: t('ta.materialsSelectCategory') },
                                ...categories.map((c) => ({
                                    value: c,
                                    label: c === 'Lectures' ? t('ta.materialsCategoryLecturesLabel')
                                         : c === 'Assignments' ? t('ta.materialsCategoryAssignmentsLabel')
                                         : c === 'Final Project' ? t('ta.materialsCategoryFinalProjectLabel')
                                         : c === 'Labs' ? t('ta.materialsCategoryLabsLabel')
                                         : c === 'References' ? t('ta.materialsCategoryReferencesLabel')
                                         : t('ta.materialsCategoryAssessmentsLabel'),
                                    icon:
                                        c === 'Assignments'
                                            ? 'ph-clipboard-text'
                                            : c === 'Final Project'
                                            ? 'ph-trophy'
                                            : c === 'Lectures'
                                            ? 'ph-presentation'
                                            : c === 'Labs'
                                            ? 'ph-flask'
                                            : c === 'References'
                                            ? 'ph-book-bookmark'
                                            : 'ph-exam',
                                })),
                            ]}
                            direction="up"
                            className="w-full"
                        />
                    </div>

                    {/* Assignment-mode extras — only when the category is
                        Assignments. Posting fills these into a real
                        Assignment row, with the dropped file(s) stored as
                        attachments. Students see the assignment + the
                        attached spec/PDF in their Assignments tab. */}
                    {isAssignmentMode && (
                        <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mt-4 grid grid-cols-1 md:grid-cols-6 gap-3 p-4 bg-[#6A3FF4]/5 border border-[#6A3FF4]/20 rounded-xl"
                        >
                            <div className="md:col-span-6">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('ta.assignmentTitleLabel')}
                                </label>
                                <input
                                    type="text"
                                    value={assignmentTitle}
                                    onChange={(e) => setAssignmentTitle(e.target.value)}
                                    placeholder={t('ta.assignmentTitlePlaceholder')}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors placeholder:text-gray-500"
                                />
                            </div>
                            <div className="md:col-span-4">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('ta.dueDateTimeLabel')}
                                </label>
                                <GlassDateTimePicker
                                    value={assignmentDueDate}
                                    onChange={setAssignmentDueDate}
                                    placeholder={t('ta.pickDateTime')}
                                    direction="auto"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('ta.maxScoreFieldLabel')}
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={assignmentMaxScore}
                                    onChange={(e) => setAssignmentMaxScore(e.target.value)}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors"
                                />
                            </div>
                            <div className="md:col-span-3">
                                <label
                                    className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"
                                    title={t('professor.missingAfterTooltip')}
                                >
                                    {t('ta.missingAfterLabel')}
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    max="168"
                                    step="1"
                                    value={assignmentGraceHours}
                                    onChange={(e) => setAssignmentGraceHours(e.target.value)}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors"
                                />
                            </div>
                            <div className="md:col-span-3">
                                <label
                                    className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"
                                    title={t('professor.missingPenaltyTooltip')}
                                >
                                    {t('ta.missingPenaltyFieldLabel')}
                                </label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={assignmentLatePenalty}
                                    onChange={(e) => setAssignmentLatePenalty(e.target.value)}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors"
                                />
                            </div>
                            <p className="md:col-span-6 text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                <i className="ph-bold ph-info"></i>
                                {t('ta.materialsHostingHint')}
                            </p>

                            {/* Audience picker — whole class or specific subset. */}
                            <div className="md:col-span-6 pt-2 border-t border-white/10 dark:border-white/5">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('ta.audienceLabel')}
                                </label>
                                <div className="flex gap-2 mb-2">
                                    <button
                                        type="button"
                                        onClick={() => setAssignmentAudienceMode('all')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            assignmentAudienceMode === 'all'
                                                ? 'bg-[#6A3FF4] text-white'
                                                : 'bg-white/5 hover:bg-[#6A3FF4]/20 text-gray-400'
                                        }`}
                                    >
                                        <i className="ph-bold ph-users mr-1"></i> {t('ta.wholeClassBtn')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setAssignmentAudienceMode('specific')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            assignmentAudienceMode === 'specific'
                                                ? 'bg-[#6A3FF4] text-white'
                                                : 'bg-white/5 hover:bg-[#6A3FF4]/20 text-gray-400'
                                        }`}
                                    >
                                        <i className="ph-bold ph-user-focus mr-1"></i> {t('ta.specificStudentsBtn')}
                                    </button>
                                </div>

                                {assignmentAudienceMode === 'specific' && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={audienceSearch}
                                            onChange={e => setAudienceSearch(e.target.value)}
                                            placeholder={t('ta.searchByNameOrEmailPh')}
                                            className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60"
                                        />
                                        <div className="max-h-56 overflow-y-auto border border-white/10 rounded-xl">
                                            {enrolledStudents.length === 0 && (
                                                <div className="p-3 text-center text-[11px] text-gray-500">
                                                    {t('ta.noEnrolledStudents')}
                                                </div>
                                            )}
                                            {enrolledStudents
                                                .filter(s => {
                                                    const q = audienceSearch.toLowerCase().trim();
                                                    if (!q) return true;
                                                    return `${s.firstName} ${s.lastName} ${s.email}`.toLowerCase().includes(q);
                                                })
                                                .map(s => {
                                                    const checked = selectedAudienceIds.has(s.id);
                                                    const toggle = () => {
                                                        setSelectedAudienceIds(prev => {
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
                                                                <p className="text-xs font-semibold text-black dark:text-white truncate">
                                                                    {s.firstName} {s.lastName}
                                                                </p>
                                                                <p className="text-[10px] text-gray-500 truncate">{s.email}</p>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                        <p className="text-[10px] text-gray-500">
                                            {t('ta.nStudentsSelected', { count: selectedAudienceIds.size })}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {feedback && (
                        <div
                            className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2 ${
                                feedback.kind === 'success'
                                    ? 'bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400'
                                    : 'bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400'
                            }`}
                        >
                            <i
                                className={`ph-bold ${
                                    feedback.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'
                                }`}
                            ></i>
                            {feedback.text}
                        </div>
                    )}

                    <div className="flex gap-3 justify-end mt-4">
                        <button onClick={handleClear} className="px-5 py-2.5 rounded-xl border border-white/20 dark:border-white/10 text-black dark:text-white font-semibold text-sm hover:bg-white/10 transition-colors">{t('ta.clearBtnShort')}</button>
                        <button onClick={handleUpload} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center gap-2">
                            <i className={`ph-bold ${isAssignmentMode ? 'ph-clipboard-text' : 'ph-upload'}`}></i>
                            {isAssignmentMode ? t('ta.postAssignmentBtn') : t('ta.uploadFilesBtnLabel')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Existing Materials */}
            <AnimateOnView delay={0.2}>
                <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('ta.existingMaterialsHeading')}</h3>
                <div className="space-y-3">
                    {modules.map(module => (
                        <div key={module.id} className={`${glassCardStyle} overflow-hidden`}>
                            <button
                                onClick={() => toggleModule(module.id)}
                                className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/5 transition-colors"
                            >
                                <h4 className="text-black dark:text-white font-semibold text-sm">{module.title}</h4>
                                <i className={`ph-bold ph-caret-down text-gray-400 transition-transform duration-300 ${module.isOpen ? 'rotate-180' : ''}`}></i>
                            </button>
                            <AnimatePresence>
                                {module.isOpen && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.3 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-6 pb-4 space-y-2">
                                            {module.files.length > 0 ? module.files.map(file => (
                                                <div key={file.id} className="flex items-center justify-between bg-white/5 dark:bg-black/10 rounded-xl px-4 py-3 border border-white/10 dark:border-white/5 group hover:border-[#6A3FF4]/30 transition-all">
                                                    <div className="flex items-center gap-3">
                                                        <i className={`ph-fill ${getFileIcon(file.type)} text-xl`}></i>
                                                        <div>
                                                            <p className="text-black dark:text-white text-sm font-medium">{file.name}</p>
                                                            <p className="text-gray-500 text-[10px]">{file.size} • {file.date}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 text-xs">
                                                        <button className="text-gray-400 hover:text-[#6A3FF4] transition-colors font-semibold">{t('ta.editFileBtn')}</button>
                                                        <button onClick={() => handleDeleteFile(module.id, file.id)} className="text-gray-400 hover:text-red-500 transition-colors font-semibold">{t('ta.deleteFileBtn')}</button>
                                                        <button className="text-gray-400 hover:text-[#6A3FF4] transition-colors font-semibold">{t('ta.moveFileBtn')}</button>
                                                    </div>
                                                </div>
                                            )) : (
                                                <p className="text-gray-500 text-sm text-center py-4">{t('ta.noMaterialsInModule')}</p>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>
            </AnimateOnView>
        </div>
    );
};

export default TAMaterials;

