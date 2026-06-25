import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface RosterRow {
    userId: string;
    name: string;
    email: string;
    major: string | null;
    level: number | null;
    gpa: number | null;
    currentGrade: string | null;
    qualityPoints: number | null;
    semester: { id: string; name: string } | null;
}

interface CourseRosterData {
    course: { id: string; code: string; title: string; credits: number };
    roster: RosterRow[];
}

// Preview mock — one realistic roster reused for any course code the page loads.
// The course meta is synthesised from the route param so the header reads right.
const MOCK_SEMESTER = { id: 'sem-spring-2026', name: 'Spring 2026' };

const MOCK_ROSTER: RosterRow[] = [
    { userId: 'u-omar', name: 'Omar Khaled', email: 'omar.khaled@fcds.edu', major: 'Computer Science', level: 2, gpa: 3.42, currentGrade: 'B', qualityPoints: 3.0, semester: MOCK_SEMESTER },
    { userId: 'u-sara', name: 'Sara Mahmoud', email: 'sara.mahmoud@fcds.edu', major: 'Computer Science', level: 2, gpa: 3.88, currentGrade: 'A', qualityPoints: 4.0, semester: MOCK_SEMESTER },
    { userId: 'u-youssef', name: 'Youssef Tarek', email: 'youssef.tarek@fcds.edu', major: 'Data Science', level: 3, gpa: 2.97, currentGrade: 'B-', qualityPoints: 2.667, semester: MOCK_SEMESTER },
    { userId: 'u-nour', name: 'Nour Hassan', email: 'nour.hassan@fcds.edu', major: 'Computer Science', level: 1, gpa: 3.15, currentGrade: null, qualityPoints: null, semester: MOCK_SEMESTER },
    { userId: 'u-laila', name: 'Laila Ibrahim', email: 'laila.ibrahim@fcds.edu', major: 'Mathematics', level: 2, gpa: 3.60, currentGrade: 'A-', qualityPoints: 3.667, semester: MOCK_SEMESTER },
    { userId: 'u-karim', name: 'Karim Adel', email: 'karim.adel@fcds.edu', major: 'Cybersecurity', level: 3, gpa: 2.45, currentGrade: 'C+', qualityPoints: 2.333, semester: MOCK_SEMESTER },
    { userId: 'u-mariam', name: 'Mariam Saeed', email: 'mariam.saeed@fcds.edu', major: 'Data Science', level: 2, gpa: 3.71, currentGrade: 'B+', qualityPoints: 3.333, semester: MOCK_SEMESTER },
    { userId: 'u-ali', name: 'Ali Mostafa', email: 'ali.mostafa@fcds.edu', major: 'Computer Science', level: 1, gpa: 1.92, currentGrade: 'D', qualityPoints: 1.0, semester: MOCK_SEMESTER },
];

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

const GradeOverrideCoursePage: React.FC = () => {
    const t = useT();
    const { courseCode } = useParams<{ courseCode: string }>();
    const navigate = useNavigate();
    const [data, setData] = useState<CourseRosterData | null>(null);
    const [loading, setLoading] = useState(true);
    const [err] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (!courseCode) return;
        // Preview mode — synthesise the roster from static mock data.
        const code = courseCode.toUpperCase();
        const meta = MOCK_COURSE_META[code] ?? { title: 'Course', credits: 3 };
        setData({
            course: { id: `c-${code}`, code, title: meta.title, credits: meta.credits },
            roster: MOCK_ROSTER,
        });
        setLoading(false);
    }, [courseCode]);

    const visible = useMemo(() => {
        if (!data) return [];
        const q = search.trim().toLowerCase();
        return data.roster.filter((r) =>
            q === '' ||
            r.name.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            (r.major ?? '').toLowerCase().includes(q),
        );
    }, [data, search]);

    if (loading) return <div className={`${glassCardStyle} p-12 text-center text-gray-500 animate-pulse`}>{t('admin.goLoadingRoster')}</div>;
    if (err)     return <div className={`${glassCardStyle} p-8 text-center text-red-400`}>{err}</div>;
    if (!data)   return null;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div>
                    <button
                        onClick={() => navigate('/admin/grade-override')}
                        className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                    >
                        <i className="ph-bold ph-arrow-left" /> {t('admin.goCoursesBack')}
                    </button>
                    <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">
                        {data.course.code} <span className="text-gray-500 text-base font-normal">— {data.course.title}</span>
                    </h1>
                    <p className="text-gray-500 text-sm">
                        {data.roster.length === 1
                            ? t('admin.goRosterStudentSingularEnrolled', { n: data.roster.length, credits: data.course.credits })
                            : t('admin.goRosterStudentsEnrolled', { n: data.roster.length, credits: data.course.credits })}
                    </p>
                </div>
            </AnimateOnView>

            {/* Filter */}
            <div className={`${glassCardStyle} p-4`}>
                <div className="relative">
                    <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('admin.goSearchRoster')}
                        className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                    />
                </div>
            </div>

            {/* Roster */}
            <div className={`${glassCardStyle} p-6`}>
                <h3 className="text-lg font-bold text-black dark:text-white mb-4">{t('admin.goRoster')}</h3>
                {visible.length === 0 ? (
                    <p className="text-gray-500 text-sm py-8 text-center">{t('admin.goNoStudentsFilter')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColStudent')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColMajor')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColLevel')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColCumulativeGpa')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColCurrentGrade')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColSemester')}</th>
                                    <th className="text-right py-2 font-bold">{t('admin.goColActions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {visible.map((r, i) => (
                                    <motion.tr
                                        key={r.userId}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: Math.min(i * 0.02, 0.15) }}
                                        className="hover:bg-white/5 transition-colors cursor-pointer"
                                        onClick={() =>
                                            navigate(`/admin/grade-override/${encodeURIComponent(data.course.code)}/${r.userId}`)
                                        }
                                    >
                                        <td className="py-2 pr-4">
                                            <div className="text-black dark:text-white font-medium">{r.name}</div>
                                            <div className="text-gray-500 text-xs">{r.email}</div>
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400">{r.major ?? '—'}</td>
                                        <td className="py-2 pr-4 text-gray-400">{r.level ?? '—'}</td>
                                        <td className="py-2 pr-4 text-gray-400">{r.gpa != null ? r.gpa.toFixed(2) : '—'}</td>
                                        <td className="py-2 pr-4">
                                            {r.currentGrade ? (
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${GRADE_PILL[r.currentGrade] ?? 'bg-white/5 text-gray-400'}`}>
                                                    {r.currentGrade}
                                                </span>
                                            ) : (
                                                <span className="text-gray-500 text-xs italic">{t('admin.goNoGradeYet')}</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400 text-xs whitespace-nowrap">{r.semester?.name ?? '—'}</td>
                                        <td className="py-2 text-right">
                                            <span className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold">
                                                {t('admin.goOverrideAction')}
                                            </span>
                                        </td>
                                    </motion.tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GradeOverrideCoursePage;
