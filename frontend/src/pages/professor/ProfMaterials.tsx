import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassDateTimePicker } from '../../components/GlassDateTimePicker';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { API_URLS } from '@shared/config';
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

// Shape returned by /api/courses/:code/materials. Fields are loose because
// older rows may use the legacy snake-case names — both spellings handled
// at the consumer.
interface MaterialApiRow {
    id: string;
    title?: string;
    fileName?: string;
    fileSize?: string;
    size?: string;
    fileType?: string;
    type?: string;
    category?: string;
    uploadedAt?: string;
    createdAt?: string;
}

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

const ProfMaterials: React.FC = () => {
    const t = useT();
    const [courses, setCourses] = useState<{ code: string; title?: string; name?: string }[]>([]);
    const [selectedCourse, setSelectedCourse] = useState<string>('');
    const [modules, setModules] = useState<Module[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    // Assignment-specific fields — only collected when category is Assignments.
    // Wiring here keeps the upload flow single-form: pick "Assignments",
    // fill in title/due date/max score, drop the PDF, hit Upload.
    const [assignmentTitle, setAssignmentTitle] = useState('');
    const [assignmentDueDate, setAssignmentDueDate] = useState('');
    const [assignmentMaxScore, setAssignmentMaxScore] = useState('100');
    // Per-assignment grace + penalty knobs the prof can tune. Defaults
    // mirror the schema (0 hr grace, -2 penalty). Stored as strings while
    // editing so the controlled input doesn't fight the user's typing.
    const [assignmentGraceHours, setAssignmentGraceHours] = useState('0');
    const [assignmentLatePenalty, setAssignmentLatePenalty] = useState('-2');
    // Audience targeting for the assignment / final-project create form.
    // 'all' = whole class (default); 'specific' = subset picker.
    const [assignmentAudienceMode, setAssignmentAudienceMode] = useState<'all' | 'specific'>('all');
    const [enrolledStudents, setEnrolledStudents] = useState<{ id: string; firstName: string; lastName: string; email: string }[]>([]);
    const [audienceSearch, setAudienceSearch] = useState('');
    const [selectedAudienceIds, setSelectedAudienceIds] = useState<Set<string>>(new Set());
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 'Final Project' is its own category — separate from generic
    // Assignments because students see it as a dedicated section in
    // their course content view, AND the staff can also list it
    // under the Assignments tab if they post it as an assignment row.
    const categories = ['Lectures', 'Assignments', 'Final Project', 'Labs', 'References', 'Assessments'];
    // Final Project ALSO routes through the assignment creation path so
    // it can carry due-date / max-score / penalty fields. The resulting
    // Assignment row's title is what appears in the Assignments tab; the
    // file is filed under category='Final Project' on the materials side.
    const isAssignmentMode =
        selectedCategory === 'Assignments' || selectedCategory === 'Final Project';
    const isFinalProjectMode = selectedCategory === 'Final Project';

    useEffect(() => {
        const fetchCourses = async () => {
            try {
                setIsLoading(true);
                const email = localStorage.getItem('currentUserEmail') || '';
                const token = localStorage.getItem('authToken');
                const response = await fetch(`${API_URLS.courseContent()}/api/professor/courses-detailed/${email}`, {
                    credentials: 'include',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    setCourses([]);
                    setIsLoading(false);
                    return;
                }

                const data = await response.json();
                setCourses(data);
                if (data.length > 0) setSelectedCourse(data[0].code);
                setIsLoading(false);
            } catch {
                setCourses([]);
                setIsLoading(false);
            }
        };

        fetchCourses();
    }, []);

    useEffect(() => {
        const fetchMaterials = async () => {
            if (!selectedCourse) return;

            try {
                setIsLoading(true);
                const token = localStorage.getItem('authToken');
                const response = await fetch(`${API_URLS.courseContent()}/api/courses/${selectedCourse}/materials`, {
                    credentials: 'include',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    setModules([]);
                    setIsLoading(false);
                    return;
                }

                const data = await response.json();
                const moduleMap: Record<string, MaterialFile[]> = {};

                ((data.materials || []) as MaterialApiRow[]).forEach((material) => {
                    const category = material.category || 'General';
                    if (!moduleMap[category]) moduleMap[category] = [];
                    moduleMap[category].push({
                        id: material.id,
                        name: material.fileName || material.title || '',
                        size: material.fileSize || '—',
                        date: new Date(material.uploadedAt || material.createdAt || Date.now()).toLocaleDateString(),
                        type: material.fileType || 'pdf'
                    });
                });

                const newModules: Module[] = Object.entries(moduleMap).map(([category, files], idx) => ({
                    id: `module-${idx}`,
                    title: category,
                    files,
                    isOpen: idx === 0
                }));

                setModules(newModules);
                setIsLoading(false);
            } catch {
                setModules([]);
                setIsLoading(false);
            }
        };

        fetchMaterials();
    }, [selectedCourse]);

    const toggleModule = (id: string) => {
        setModules(prev => prev.map(m => m.id === id ? { ...m, isOpen: !m.isOpen } : m));
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        setUploadedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) setUploadedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
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

    // Lazy-load enrolled students whenever the staff flips to specific-mode
    // for the currently selected course. Cheap roster fetch (id+name+email).
    useEffect(() => {
        if (assignmentAudienceMode !== 'specific' || !selectedCourse) return;
        const token = localStorage.getItem('authToken');
        fetch(`${API_URLS.courseContent()}/api/courses/${selectedCourse}/enrolled-students`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => (r.ok ? r.json() : []))
            .then(rows => {
                setEnrolledStudents(Array.isArray(rows) ? rows : []);
                setSelectedAudienceIds(new Set());
            })
            .catch(() => setEnrolledStudents([]));
    }, [assignmentAudienceMode, selectedCourse]);

    const handleClear = () => {
        resetForm();
        setFeedback(null);
    };

    const refreshMaterials = async () => {
        const token = localStorage.getItem('authToken');
        const refreshRes = await fetch(`${API_URLS.courseContent()}/api/courses/${selectedCourse}/materials`, {
            credentials: 'include',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!refreshRes.ok) return;
        const data = await refreshRes.json();
        const moduleMap: Record<string, MaterialFile[]> = {};
        ((data.materials || []) as MaterialApiRow[]).forEach((material) => {
            const category = material.category || 'General';
            if (!moduleMap[category]) moduleMap[category] = [];
            moduleMap[category].push({
                id: material.id,
                name: material.fileName || material.title || '',
                size: material.fileSize || material.size || '—',
                date: new Date(material.uploadedAt || material.createdAt || Date.now()).toLocaleDateString(),
                type: material.fileType || material.type || 'pdf'
            });
        });
        setModules(Object.entries(moduleMap).map(([cat, files], idx) => ({
            id: `module-${idx}`, title: cat, files, isOpen: idx === 0
        })));
    };

    const handleUpload = async () => {
        setFeedback(null);

        // Common precondition.
        if (!selectedCourse || !selectedCategory) {
            setFeedback({ kind: 'error', text: t('professor.pmPickCourseAndCategory') });
            return;
        }
        if (uploadedFiles.length === 0) {
            setFeedback({ kind: 'error', text: t('professor.pmPickAtLeastOne') });
            return;
        }

        const token = localStorage.getItem('authToken');

        try {
            // Assignment branch: create an Assignment row + attach the PDF
            // (or any uploaded file) so it shows up in the Assignments tab
            // for both staff and students.
            if (isAssignmentMode) {
                if (!assignmentTitle.trim() || !assignmentDueDate) {
                    setFeedback({ kind: 'error', text: t('professor.pmAssignmentRequired') });
                    return;
                }
                const formData = new FormData();
                uploadedFiles.forEach(file => formData.append('files', file));
                // Final Project mode: prefix the title so it surfaces clearly
                // in the student Assignments tab as "Final Project — <title>"
                // (skipped if the staff already typed that prefix).
                const rawTitle = assignmentTitle.trim();
                const finalTitle = isFinalProjectMode && !/^final project/i.test(rawTitle)
                    ? `Final Project — ${rawTitle}`
                    : rawTitle;
                formData.append('title', finalTitle);
                formData.append('dueDate', assignmentDueDate);
                formData.append('maxScore', assignmentMaxScore || '100');
                // Per-assignment grace + penalty. Backend clamps grace to
                // 0..168 hours and accepts any numeric latePenalty (negative
                // = deduction, 0 = disabled).
                formData.append('missingAfterHours', assignmentGraceHours || '0');
                formData.append('latePenalty', assignmentLatePenalty || '-2');
                formData.append('materialCategory', isFinalProjectMode ? 'final-project' : 'assignments');
                // Audience targeting: empty array = whole class (server
                // treats absence as default). When the staff picks specific
                // students we send the user-id list as JSON for unambiguous
                // multipart parsing.
                if (assignmentAudienceMode === 'specific' && selectedAudienceIds.size > 0) {
                    formData.append('audienceUserIds', JSON.stringify(Array.from(selectedAudienceIds)));
                }

                const res = await fetch(`${API_URLS.courseContent()}/api/courses/${selectedCourse}/assignments`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    setFeedback({
                        kind: 'error',
                        text: (body as { error?: string }).error || t('professor.pmCouldNotCreateAssignment'),
                    });
                    return;
                }
                await refreshMaterials();
                resetForm();
                setFeedback({
                    kind: 'success',
                    text: t('professor.pmAssignmentPosted'),
                });
                return;
            }

            // Default branch: upload as one or more CourseMaterial rows.
            const formData = new FormData();
            uploadedFiles.forEach(file => formData.append('files', file));
            formData.append('category', selectedCategory);

            const res = await fetch(`${API_URLS.courseContent()}/api/courses/${selectedCourse}/materials/upload`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setFeedback({
                    kind: 'error',
                    text: (body as { error?: string }).error || t('professor.pmUploadFailed'),
                });
                return;
            }
            await refreshMaterials();
            resetForm();
            setFeedback({
                kind: 'success',
                text: t('professor.pmUploadedNFiles', { n: uploadedFiles.length, suffix: uploadedFiles.length === 1 ? '' : 's', category: selectedCategory }),
            });
        } catch (e) {
            setFeedback({
                kind: 'error',
                text: e instanceof Error ? e.message : t('professor.pmNetworkErrUpload'),
            });
        }
    };

    const handleDeleteFile = async (moduleId: string, fileId: string) => {
        try {
            const token = localStorage.getItem('authToken');
            const response = await fetch(`${API_URLS.courseContent()}/api/materials/${fileId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.ok) {
                setModules(prev => prev.map(m =>
                    m.id === moduleId ? { ...m, files: m.files.filter(f => f.id !== fileId) } : m
                ));
            }
        } catch { /* ignore */ }
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('professor.materialsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('professor.materialsSubtitle')}</p>
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
            <AnimateOnView delay={0.1} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <h3 className="text-black dark:text-white text-lg font-bold mb-4">{t('professor.newMaterialUpload')}</h3>

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
                        <p className="text-gray-500 dark:text-gray-400 text-sm">{t('professor.dragAndDropHere')}</p>
                        <button type="button" className="px-4 py-2 bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl text-sm font-semibold text-black dark:text-white hover:bg-[#6A3FF4]/10 transition-colors">
                            {t('professor.pmBrowseFiles')}
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
                                    <button type="button" onClick={() => setUploadedFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-500 transition-colors">
                                        <i className="ph-bold ph-x"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-4">
                        <label className="text-sm font-medium text-black dark:text-gray-300 block mb-1">{t('staff.type')}</label>
                        <GlassDropdown
                            value={selectedCategory}
                            onChange={setSelectedCategory}
                            options={[
                                { value: '', label: t('professor.pmSelectCategory') },
                                ...categories.map((c) => ({
                                    value: c,
                                    label: c === 'Final Project' ? t('professor.pmCatFinalProject') : c,
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
                                    {t('professor.pmAssignmentTitle')}
                                </label>
                                <input
                                    type="text"
                                    value={assignmentTitle}
                                    onChange={(e) => setAssignmentTitle(e.target.value)}
                                    placeholder={t('professor.pmAssignmentTitlePh')}
                                    className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors placeholder:text-gray-500"
                                />
                            </div>
                            <div className="md:col-span-4">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('professor.pmDueDateTime')}
                                </label>
                                <GlassDateTimePicker
                                    value={assignmentDueDate}
                                    onChange={setAssignmentDueDate}
                                    placeholder={t('professor.pmDueDatePicker')}
                                    direction="auto"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('professor.pmMaxScore')}
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
                            {/* Grace + penalty row — both customisable per assignment.
                                Grace controls when the student card flips to
                                "Missing"; penalty is the score delta the missing
                                badge displays (and that the prof can wire into
                                grading). 0 grace + −2 penalty matches the project
                                defaults. */}
                            <div className="md:col-span-3">
                                <label
                                    className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"
                                    title={t('professor.pmMissingAfterTooltip')}
                                >
                                    {t('professor.pmMissingAfter')}
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
                                    title={t('professor.pmMissingPenaltyTooltip')}
                                >
                                    {t('professor.pmMissingPenalty')}
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
                                {t('professor.pmAssignmentHint')}
                            </p>

                            {/* Audience picker — whole class by default, or
                                target a specific subset of enrolled students. */}
                            <div className="md:col-span-6 pt-2 border-t border-white/10 dark:border-white/5">
                                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t('professor.pmAudience')}
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
                                        <i className="ph-bold ph-users mr-1"></i> {t('professor.pmWholeClass')}
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
                                        <i className="ph-bold ph-user-focus mr-1"></i> {t('professor.pmSpecificStudents')}
                                    </button>
                                </div>

                                {assignmentAudienceMode === 'specific' && (
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={audienceSearch}
                                            onChange={e => setAudienceSearch(e.target.value)}
                                            placeholder={t('professor.pmSearchByNameEmail')}
                                            className="w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60"
                                        />
                                        <div className="max-h-56 overflow-y-auto border border-white/10 rounded-xl">
                                            {enrolledStudents.length === 0 && (
                                                <div className="p-3 text-center text-[11px] text-gray-500">
                                                    {t('professor.pmNoEnrolledForCourse')}
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
                                                    return (
                                                        <div
                                                            key={s.id}
                                                            onClick={() => {
                                                                setSelectedAudienceIds(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(s.id)) next.delete(s.id);
                                                                    else next.add(s.id);
                                                                    return next;
                                                                });
                                                            }}
                                                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                                                                checked ? 'bg-[#6A3FF4]/15' : 'hover:bg-white/5'
                                                            }`}
                                                        >
                                                            <GlassCheckbox
                                                                checked={checked}
                                                                onChange={() => {
                                                                    setSelectedAudienceIds(prev => {
                                                                        const next = new Set(prev);
                                                                        if (next.has(s.id)) next.delete(s.id);
                                                                        else next.add(s.id);
                                                                        return next;
                                                                    });
                                                                }}
                                                                size="sm"
                                                            />
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
                                            {t('professor.pmStudentsSelected', { n: selectedAudienceIds.size, suffix: selectedAudienceIds.size === 1 ? '' : 's' })}
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
                        <button type="button" onClick={handleClear} className="px-5 py-2.5 rounded-xl border border-white/20 dark:border-white/10 text-black dark:text-white font-semibold text-sm hover:bg-white/10 transition-colors">{t('professor.pmClearBtn')}</button>
                        <button type="button" onClick={handleUpload} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-semibold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center gap-2">
                            <i className={`ph-bold ${isAssignmentMode ? 'ph-clipboard-text' : 'ph-upload'}`}></i>
                            {isAssignmentMode ? t('professor.pmPostAssignment') : t('professor.pmUploadFiles')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Existing Materials */}
            <AnimateOnView delay={0.2} enabled={false}>
                <h3 className="text-black dark:text-white text-xl font-bold mb-4">{t('professor.existingMaterials')}</h3>
                <div className="space-y-3">
                    {modules.map(module => (
                        <div key={module.id} className={`${glassCardStyle} overflow-hidden`}>
                            <button
                                type="button"
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
                                                        <button type="button" className="text-gray-400 hover:text-[#6A3FF4] transition-colors font-semibold">{t('staff.edit')}</button>
                                                        <button type="button" onClick={() => handleDeleteFile(module.id, file.id)} className="text-gray-400 hover:text-red-500 transition-colors font-semibold">{t('staff.delete')}</button>
                                                        <button type="button" className="text-gray-400 hover:text-[#6A3FF4] transition-colors font-semibold">{t('professor.pmMoveBtn')}</button>
                                                    </div>
                                                </div>
                                            )) : (
                                                <p className="text-gray-500 text-sm text-center py-4">{t('professor.pmNoMaterialsModule')}</p>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                    {modules.length === 0 && !isLoading && (
                        <div className={`${glassCardStyle} p-10 text-center`}>
                            <i className="ph-bold ph-folder-open text-4xl text-gray-400 mb-3 block"></i>
                            <p className="text-gray-500">{t('professor.pmNoMaterialsYet')}</p>
                        </div>
                    )}
                </div>
            </AnimateOnView>
        </div>
    );
};

export default ProfMaterials;
