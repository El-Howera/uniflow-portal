import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface OverrideRow {
    id: string;
    oldGrade: string | null;
    newGrade: string;
    reason: string;
    component: string | null;
    createdAt: string;
    course: { code: string; title: string } | null;
    student: { id: string; name: string; email: string } | null;
    overriddenBy: string | null;
}

// Preview mock — recent grade-override audit log.
const MOCK_OVERRIDES: OverrideRow[] = [
    {
        id: 'ov-1', oldGrade: 'C+', newGrade: 'B', reason: 'Re-mark after grading appeal — midterm question 4 re-evaluated.',
        component: null, createdAt: '2026-05-18T10:24:00.000Z',
        course: { code: 'CS101', title: 'Introduction to Computer Science' },
        student: { id: 'u-omar', name: 'Omar Khaled', email: 'omar.khaled@fcds.edu' },
        overriddenBy: 'Admin (Mohamed Howera)',
    },
    {
        id: 'ov-2', oldGrade: 'F', newGrade: 'D', reason: 'Late submission accepted with documented medical excuse.',
        component: 'Final', createdAt: '2026-05-16T14:05:00.000Z',
        course: { code: 'MA205', title: 'Linear Algebra' },
        student: { id: 'u-sara', name: 'Sara Mahmoud', email: 'sara.mahmoud@fcds.edu' },
        overriddenBy: 'Admin (Mohamed Howera)',
    },
    {
        id: 'ov-3', oldGrade: 'B-', newGrade: 'B+', reason: 'Clerical error in score entry corrected.',
        component: 'Assignment 3', createdAt: '2026-05-12T09:40:00.000Z',
        course: { code: 'DS340', title: 'Machine Learning' },
        student: { id: 'u-youssef', name: 'Youssef Tarek', email: 'youssef.tarek@fcds.edu' },
        overriddenBy: 'Admin (Mohamed Howera)',
    },
    {
        id: 'ov-4', oldGrade: null, newGrade: 'A-', reason: 'Incomplete resolved after make-up exam.',
        component: null, createdAt: '2026-04-29T11:15:00.000Z',
        course: { code: 'CS201', title: 'Data Structures & Algorithms' },
        student: { id: 'u-nour', name: 'Nour Hassan', email: 'nour.hassan@fcds.edu' },
        overriddenBy: 'Admin (Mohamed Howera)',
    },
];

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

const GradeOverrideHistoryPage: React.FC = () => {
    const t = useT();
    const navigate = useNavigate();
    const [rows, setRows] = useState<OverrideRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [course, setCourse] = useState('all');

    useEffect(() => {
        // Preview mode — static audit log, no backend.
        setRows(MOCK_OVERRIDES);
        setLoading(false);
    }, []);

    const courseCodes = useMemo(() => {
        const set = new Set<string>();
        rows.forEach((r) => r.course?.code && set.add(r.course.code));
        return ['all', ...Array.from(set).sort()];
    }, [rows]);

    const visible = useMemo(() => {
        return rows.filter((r) => {
            const q = search.trim().toLowerCase();
            const matchesSearch =
                q === '' ||
                (r.student?.name ?? '').toLowerCase().includes(q) ||
                (r.student?.email ?? '').toLowerCase().includes(q) ||
                (r.course?.code ?? '').toLowerCase().includes(q) ||
                (r.reason ?? '').toLowerCase().includes(q);
            const matchesCourse = course === 'all' || r.course?.code === course;
            return matchesSearch && matchesCourse;
        });
    }, [rows, search, course]);

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <button
                            onClick={() => navigate('/admin/grade-override')}
                            className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] text-sm mb-2 transition-colors"
                        >
                            <i className="ph-bold ph-arrow-left" /> {t('admin.gradeOverrideTitle')}
                        </button>
                        <h1 className="text-2xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.overrideHistory')}</h1>
                        <p className="text-gray-500 text-sm">
                            {rows.length === 1
                                ? t('admin.goHistoryRowCount', { n: rows.length })
                                : t('admin.goHistoryRowsCount', { n: rows.length })}
                        </p>
                    </div>
                </div>
            </AnimateOnView>

            <div className={`${glassCardStyle} p-4 flex flex-col sm:flex-row gap-3`}>
                <div className="relative flex-1">
                    <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('admin.goHistorySearch')}
                        className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
                    />
                </div>
                <div className="min-w-[180px]">
                    <GlassDropdown
                        value={course}
                        onChange={setCourse}
                        options={courseCodes.map((c) => ({ value: c, label: c === 'all' ? t('admin.goAllCourses') : c }))}
                        direction="auto"
                        className="w-full"
                    />
                </div>
            </div>

            <div className={`${glassCardStyle} p-6`}>
                {loading ? (
                    <div className="animate-pulse h-24 bg-white/5 rounded-xl" />
                ) : visible.length === 0 ? (
                    <p className="text-gray-500 text-sm py-8 text-center">{t('admin.goNoOverridesMatch')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColWhen')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColStudent')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColCourse')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColComponent')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColOldNew')}</th>
                                    <th className="text-left py-2 pr-4 font-bold">{t('admin.goColReason')}</th>
                                    <th className="text-left py-2 font-bold">{t('admin.goColBy')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {visible.map((r, i) => (
                                    <motion.tr
                                        key={r.id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: Math.min(i * 0.02, 0.15) }}
                                        className="hover:bg-white/5 transition-colors"
                                    >
                                        <td className="py-2 pr-4 text-gray-400 whitespace-nowrap text-xs">
                                            {new Date(r.createdAt).toLocaleDateString()}
                                            <div className="text-[10px] text-gray-500">{new Date(r.createdAt).toLocaleTimeString()}</div>
                                        </td>
                                        <td className="py-2 pr-4">
                                            {r.student ? (
                                                <button
                                                    onClick={() => r.course && navigate(`/admin/grade-override/${encodeURIComponent(r.course.code)}/${r.student!.id}`)}
                                                    className="text-left hover:text-[#7B5AFF] transition-colors"
                                                >
                                                    <div className="text-black dark:text-white font-medium">{r.student.name}</div>
                                                    <div className="text-gray-500 text-xs">{r.student.email}</div>
                                                </button>
                                            ) : <span className="text-gray-500 italic">{t('admin.goRowDeleted')}</span>}
                                        </td>
                                        <td className="py-2 pr-4">
                                            {r.course ? (
                                                <button
                                                    onClick={() => navigate(`/admin/grade-override/${encodeURIComponent(r.course!.code)}`)}
                                                    className="text-[#7B5AFF] hover:text-[#6A3FF4] font-bold"
                                                >
                                                    {r.course.code}
                                                </button>
                                            ) : '—'}
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400 text-xs">{r.component ?? t('admin.goFinalLabel')}</td>
                                        <td className="py-2 pr-4">
                                            <span className="text-gray-500 mr-1">{r.oldGrade ?? '—'}</span>
                                            <span className="text-gray-500 mx-1">→</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${GRADE_PILL[r.newGrade] ?? 'bg-white/5 text-gray-400'}`}>
                                                {r.newGrade}
                                            </span>
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400 max-w-[400px] truncate" title={r.reason}>{r.reason}</td>
                                        <td className="py-2 text-gray-400 text-xs">{r.overriddenBy ?? '—'}</td>
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

export default GradeOverrideHistoryPage;
