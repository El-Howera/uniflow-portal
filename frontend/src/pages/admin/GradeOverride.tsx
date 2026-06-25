import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface CourseRow {
    id: string;
    code: string;
    title: string;
    credits: number;
    department: string | null;
    studentCount: number;
}

// Preview mock — realistic FCDS course catalog with per-course rosters.
const MOCK_COURSES: CourseRow[] = [
    { id: 'c-cs101', code: 'CS101', title: 'Introduction to Computer Science', credits: 3, department: 'Computer Science', studentCount: 42 },
    { id: 'c-cs102', code: 'CS102', title: 'Programming Fundamentals', credits: 4, department: 'Computer Science', studentCount: 38 },
    { id: 'c-cs201', code: 'CS201', title: 'Data Structures & Algorithms', credits: 4, department: 'Computer Science', studentCount: 31 },
    { id: 'c-cs305', code: 'CS305', title: 'Database Systems', credits: 3, department: 'Computer Science', studentCount: 27 },
    { id: 'c-ds210', code: 'DS210', title: 'Statistical Foundations of Data Science', credits: 3, department: 'Data Science', studentCount: 24 },
    { id: 'c-ds340', code: 'DS340', title: 'Machine Learning', credits: 4, department: 'Data Science', studentCount: 19 },
    { id: 'c-ma205', code: 'MA205', title: 'Linear Algebra', credits: 3, department: 'Mathematics', studentCount: 45 },
    { id: 'c-ma110', code: 'MA110', title: 'Calculus I', credits: 4, department: 'Mathematics', studentCount: 52 },
    { id: 'c-cy301', code: 'CY301', title: 'Network Security', credits: 3, department: 'Cybersecurity', studentCount: 16 },
];

const GradeOverridePage: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [courses, setCourses] = useState<CourseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [department, setDepartment] = useState('all');

    useEffect(() => {
        // Preview mode — load static catalog, no backend.
        setCourses(MOCK_COURSES);
        setLoading(false);
    }, []);

    const departments = useMemo(() => {
        const set = new Set<string>();
        courses.forEach((c) => c.department && set.add(c.department));
        return ['all', ...Array.from(set).sort()];
    }, [courses]);

    const visible = useMemo(() => {
        return courses.filter((c) => {
            const q = search.trim().toLowerCase();
            const matchesSearch =
                q === '' ||
                c.code.toLowerCase().includes(q) ||
                c.title.toLowerCase().includes(q) ||
                (c.department ?? '').toLowerCase().includes(q);
            const matchesDept = department === 'all' || c.department === department;
            return matchesSearch && matchesDept;
        });
    }, [courses, search, department]);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.gradeOverrideTitle')}</h1>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {t('admin.goPageHint')}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/admin/grade-overrides/history')}
                        className="px-4 py-2 rounded-xl bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white text-sm font-bold hover:bg-white/10 transition-colors"
                    >
                        {t('admin.goViewHistoryBtn')}
                    </button>
                </div>
            </AnimateOnView>

            {/* Filters */}
            <div className={`${glassCardStyle} p-4 flex flex-col sm:flex-row gap-3`}>
                <div className="relative flex-1">
                    <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('admin.goSearchCourse')}
                        className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                    />
                </div>
                <div className="min-w-[180px]">
                    <GlassDropdown
                        value={department}
                        onChange={setDepartment}
                        options={departments.map((d) => ({
                            value: d,
                            label: d === 'all' ? t('admin.goAllDepartments') : d,
                        }))}
                        direction="auto"
                        className="w-full"
                    />
                </div>
            </div>

            {/* Course grid */}
            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className={`${glassCardStyle} p-6 animate-pulse h-32`} />
                    ))}
                </div>
            ) : visible.length === 0 ? (
                <div className={`${glassCardStyle} p-12 text-center`}>
                    <i className="ph-fill ph-book text-4xl text-gray-400 mb-3 block" />
                    <p className="text-black dark:text-white font-bold mb-1">{t('admin.goNoCoursesMatch')}</p>
                    <p className="text-gray-500 text-sm">{t('admin.goNoCoursesHint')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visible.map((c, i) => (
                        <motion.div
                            key={c.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i * 0.03, 0.2) }}
                        >
                            <ParticleCard
                                className={`${glassCardStyle} p-5 cursor-pointer h-full flex flex-col justify-between hover:border-[#6A3FF4]/40 transition-colors`}
                                glowColor="106, 63, 244"
                                enableTilt={false}
                                enableMagnetism={false}
                                clickEffect
                                particleCount={8}
                            >
                                <button
                                    onClick={() => navigate(`/admin/grade-override/${encodeURIComponent(c.code)}`)}
                                    className="text-left w-full"
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/20 flex items-center justify-center">
                                            <i className="ph-fill ph-pencil-simple-line text-xl text-[#7B5AFF]" />
                                        </div>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-white/5 text-gray-400">
                                            {t('admin.goCreditsShort', { n: c.credits })}
                                        </span>
                                    </div>
                                    <h3 className="text-black dark:text-white font-bold text-base mb-1">{c.code}</h3>
                                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-3 line-clamp-2">{c.title}</p>
                                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/10">
                                        <span className="text-gray-500 text-xs">{c.department ?? '—'}</span>
                                        <span className="text-[#7B5AFF] text-xs font-bold flex items-center gap-1">
                                            {c.studentCount === 1
                                                ? t('admin.goStudentSingular', { n: c.studentCount })
                                                : t('admin.goStudentsCount', { n: c.studentCount })} <i className="ph-bold ph-arrow-right" />
                                        </span>
                                    </div>
                                </button>
                            </ParticleCard>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default GradeOverridePage;
