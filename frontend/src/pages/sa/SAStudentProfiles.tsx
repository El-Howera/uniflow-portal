import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface Student {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    createdAt: string;
    academicProfile?: {
        major: string;
        gpa: number;
        level: string;
        totalCredits: number;
    };
}

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_STUDENTS: Student[] = [
    { id: 'stu-001', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.edu', role: 'student', createdAt: '2024-09-01', academicProfile: { major: 'Computer Science', gpa: 3.72, level: 'Level 3', totalCredits: 84 } },
    { id: 'stu-002', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.edu', role: 'student', createdAt: '2023-09-01', academicProfile: { major: 'Data Science', gpa: 3.41, level: 'Level 4', totalCredits: 112 } },
    { id: 'stu-003', firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.edu', role: 'student', createdAt: '2025-02-01', academicProfile: { major: 'Cybersecurity', gpa: 2.98, level: 'Level 2', totalCredits: 52 } },
    { id: 'stu-004', firstName: 'Salma', lastName: 'Mahmoud', email: 'salma.mahmoud@uniflow.edu', role: 'student', createdAt: '2024-09-01', academicProfile: { major: 'Artificial Intelligence', gpa: 3.88, level: 'Level 3', totalCredits: 78 } },
    { id: 'stu-005', firstName: 'Ahmed', lastName: 'Tarek', email: 'ahmed.tarek@uniflow.edu', role: 'student', createdAt: '2022-09-01', academicProfile: { major: 'Computer Science', gpa: 3.15, level: 'Level 4', totalCredits: 128 } },
    { id: 'stu-006', firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.edu', role: 'student', createdAt: '2025-02-01', academicProfile: { major: 'Data Science', gpa: 3.55, level: 'Level 1', totalCredits: 24 } },
    { id: 'stu-007', firstName: 'Karim', lastName: 'Fouad', email: 'karim.fouad@uniflow.edu', role: 'student', createdAt: '2023-09-01', academicProfile: { major: 'Software Engineering', gpa: 2.71, level: 'Level 3', totalCredits: 90 } },
    { id: 'stu-008', firstName: 'Habiba', lastName: 'Gamal', email: 'habiba.gamal@uniflow.edu', role: 'student', createdAt: '2024-09-01', academicProfile: { major: 'Artificial Intelligence', gpa: 3.93, level: 'Level 2', totalCredits: 60 } },
];

const SAStudentProfiles: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [students, setStudents] = useState<Student[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Student | null>(null);
    const [deleteError, setDeleteError] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        // MVP build: filter the static mock list locally by search term.
        setIsLoading(true);
        const delayDebounce = setTimeout(() => {
            const term = searchTerm.trim().toLowerCase();
            const filtered = term
                ? MOCK_STUDENTS.filter(s =>
                    `${s.firstName} ${s.lastName}`.toLowerCase().includes(term) ||
                    s.email.toLowerCase().includes(term) ||
                    s.id.toLowerCase().includes(term))
                : MOCK_STUDENTS;
            setStudents(filtered);
            setIsLoading(false);
        }, 200);
        return () => clearTimeout(delayDebounce);
    }, [searchTerm]);

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setIsDeleting(true);
        setDeleteError('');
        // MVP build: optimistic local removal only.
        setStudents(prev => prev.filter(s => s.id !== confirmDelete.id));
        if (selectedStudent?.id === confirmDelete.id) setSelectedStudent(null);
        setConfirmDelete(null);
        setIsDeleting(false);
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-3xl font-bold mb-1">{t('sa.studentProfilesTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.studentProfilesSubtitle2')}</p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                <div className="relative max-w-md">
                    <i className="ph-bold ph-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input
                        type="text"
                        placeholder={t('sa.searchByIdNameEmail')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/10 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-[#6A3FF4] shadow-lg"
                    />
                </div>
            </AnimateOnView>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* List */}
                <div className="lg:col-span-1 space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {isLoading ? (
                        [1, 2, 3, 4].map(i => <div key={i} className="h-20 w-full bg-white/5 animate-pulse rounded-2xl"></div>)
                    ) : fetchError ? (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-semibold">
                            <i className="ph-bold ph-warning-circle mr-2"></i>{fetchError}
                        </div>
                    ) : students.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">
                            {searchTerm ? t('sa.noStudentsMatchSearch') : t('sa.noStudentsFound')}
                        </p>
                    ) : students.map((s) => (
                        <motion.button
                            key={s.id}
                            onClick={() => setSelectedStudent(s)}
                            className={`w-full text-left p-4 rounded-2xl border transition-all ${
                                selectedStudent?.id === s.id ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 shadow-lg shadow-purple-500/10' : 'bg-white/5 border-white/10 hover:bg-white/10'
                            }`}
                        >
                            <p className="text-white font-bold text-sm">{s.firstName} {s.lastName}</p>
                            <p className="text-gray-500 text-[10px] font-mono mt-0.5">{s.email}</p>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[9px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md uppercase">
                                    {s.academicProfile?.major || t('sa.generalMajor')}
                                </span>
                                <span className="text-[9px] text-gray-400 font-bold">{s.academicProfile?.level || 'N/A'}</span>
                            </div>
                        </motion.button>
                    ))}
                </div>

                {/* Details */}
                <div className="lg:col-span-2">
                    <AnimatePresence mode="wait">
                        {selectedStudent ? (
                            <motion.div
                                key={selectedStudent.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className={`${glassCardStyle} p-8 h-full`}
                            >
                                <div className="flex justify-between items-start mb-8">
                                    <div className="flex items-center gap-5">
                                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-purple-500/20">
                                            {selectedStudent.firstName.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="text-2xl font-bold text-white">{selectedStudent.firstName} {selectedStudent.lastName}</h3>
                                            <p className="text-gray-500">{selectedStudent.email}</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => navigate(`/sa/students/${selectedStudent.id}`)}
                                            className="px-3 py-1.5 rounded-lg bg-[#6A3FF4]/20 text-[#6A3FF4] text-xs font-bold hover:bg-[#6A3FF4]/30 transition-colors flex items-center gap-1"
                                        >
                                            <i className="ph-bold ph-arrow-square-out"></i> {t('sa.viewProfile')}
                                        </button>
                                        <button
                                            onClick={() => navigate(`/sa/students/${selectedStudent.id}`)}
                                            title={t('sa.editStudentDetailsTitle')}
                                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] transition-colors"
                                        >
                                            <i className="ph-bold ph-pencil"></i>
                                        </button>
                                        <button
                                            onClick={() => { setConfirmDelete(selectedStudent); setDeleteError(''); }}
                                            title={t('sa.deleteStudentTitle')}
                                            className="p-2 rounded-lg bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-500 transition-colors"
                                        >
                                            <i className="ph-bold ph-trash"></i>
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-5 bg-white/5 rounded-2xl border border-white/10">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">{t('sa.academicStandingLbl')}</p>
                                        <p className="text-white font-bold text-lg">{selectedStudent.academicProfile?.level || t('sa.noDataLbl')}</p>
                                        <div className="mt-4 flex items-baseline gap-2">
                                            <span className="text-3xl font-bold text-[#6A3FF4]">{selectedStudent.academicProfile?.gpa || '0.00'}</span>
                                            <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">{t('sa.gpaCapsLbl')}</span>
                                        </div>
                                    </div>
                                    <div className="p-5 bg-white/5 rounded-2xl border border-white/10">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">{t('sa.programDetailsLbl')}</p>
                                        <p className="text-white font-bold text-lg">{selectedStudent.academicProfile?.major || t('sa.undeclaredLbl')}</p>
                                        <div className="mt-4 flex items-baseline gap-2">
                                            <span className="text-3xl font-bold text-blue-500">{selectedStudent.academicProfile?.totalCredits || '0'}</span>
                                            <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">{t('sa.creditsEarnedLbl')}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 space-y-4">
                                    <button
                                        onClick={() => navigate(`/sa/students/${selectedStudent.id}#transcript`)}
                                        className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                                    >
                                        <i className="ph-bold ph-file-pdf"></i> {t('sa.generateAcademicTranscript')}
                                    </button>
                                    <button
                                        onClick={() => navigate(`/sa/students/${selectedStudent.id}/attendance`)}
                                        className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                                    >
                                        <i className="ph-bold ph-calendar"></i> {t('sa.viewDetailedAttendanceHistoryBtn')}
                                    </button>
                                </div>
                            </motion.div>
                        ) : (
                            <div className={`${glassCardStyle} p-20 text-center text-gray-500 flex flex-col items-center justify-center h-full`}>
                                <i className="ph-bold ph-student text-5xl mb-4 opacity-20"></i>
                                <p>{t('sa.selectStudentHint')}</p>
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
                {confirmDelete && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                        onClick={() => !isDeleting && setConfirmDelete(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className={`${glassCardStyle} max-w-md w-full p-6 space-y-4`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center">
                                <i className="ph-fill ph-warning text-2xl text-red-500"></i>
                            </div>
                            <h3 className="text-white text-lg font-bold">{t('sa.deleteStudentAccountQ')}</h3>
                            <p className="text-gray-400 text-sm">
                                {t('sa.deleteStudentBodyA')} <span className="text-white font-semibold">{confirmDelete.firstName} {confirmDelete.lastName}</span>{t('sa.deleteStudentBodyB')}
                            </p>
                            {deleteError && (
                                <p className="text-red-400 text-xs font-semibold flex items-center gap-1">
                                    <i className="ph-bold ph-warning-circle"></i> {deleteError}
                                </p>
                            )}
                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => setConfirmDelete(null)}
                                    disabled={isDeleting}
                                    className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-semibold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    {t('sa.cancelBtn')}
                                </button>
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isDeleting ? (
                                        <><i className="ph-bold ph-spinner-gap animate-spin"></i> {t('sa.deletingDots')}</>
                                    ) : (
                                        <>{t('sa.yesDelete')}</>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SAStudentProfiles;
