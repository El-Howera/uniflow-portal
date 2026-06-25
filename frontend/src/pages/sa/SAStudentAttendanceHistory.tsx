import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface AttendanceRecord {
    id: string;
    courseCode: string;
    courseName: string;
    date: string;
    status: 'present' | 'late' | 'absent' | 'excused';
    sessionId?: string;
    markedAt: string;
    verificationMethod?: string;
    bssidVerified?: boolean;
}

interface CourseSummary {
    courseCode: string;
    courseName: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    total: number;
    attendanceRate: number;
}

interface Stats {
    total: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    attendanceRate: number;
}

interface ProfileBasic {
    firstName: string;
    lastName: string;
    email: string;
}

const STATUS_STYLES: Record<string, string> = {
    present: 'bg-green-500/10 text-green-500',
    late: 'bg-amber-500/10 text-amber-500',
    absent: 'bg-red-500/10 text-red-500',
    excused: 'bg-blue-500/10 text-blue-500',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_PROFILE: ProfileBasic = {
    firstName: 'Mariam',
    lastName: 'El-Sayed',
    email: 'mariam.elsayed@uniflow.edu',
};

const MOCK_STATS: Stats = {
    total: 48,
    present: 38,
    late: 5,
    absent: 3,
    excused: 2,
    attendanceRate: 79,
};

const MOCK_SUMMARY: CourseSummary[] = [
    { courseCode: 'CS301', courseName: 'Algorithms & Data Structures', present: 14, late: 1, absent: 1, excused: 0, total: 16, attendanceRate: 88 },
    { courseCode: 'MA205', courseName: 'Linear Algebra', present: 12, late: 2, absent: 1, excused: 1, total: 16, attendanceRate: 75 },
    { courseCode: 'CS340', courseName: 'Database Systems', present: 12, late: 2, absent: 1, excused: 1, total: 16, attendanceRate: 75 },
];

const buildMockRecords = (): AttendanceRecord[] => {
    const courses = [
        { code: 'CS301', name: 'Algorithms & Data Structures' },
        { code: 'MA205', name: 'Linear Algebra' },
        { code: 'CS340', name: 'Database Systems' },
    ];
    const statuses: AttendanceRecord['status'][] = ['present', 'present', 'present', 'late', 'present', 'absent', 'present', 'excused'];
    const records: AttendanceRecord[] = [];
    let idx = 0;
    for (let week = 0; week < 8; week++) {
        for (const c of courses) {
            const status = statuses[(idx + week) % statuses.length];
            const date = new Date(2026, 1, 1 + week * 7 + courses.indexOf(c));
            records.push({
                id: `att-${idx}`,
                courseCode: c.code,
                courseName: c.name,
                date: date.toISOString(),
                status,
                sessionId: `sess-${idx}`,
                markedAt: new Date(date.getTime() + 30 * 60000).toISOString(),
                verificationMethod: status === 'excused' ? 'Manual (excuse)' : 'QR + WiFi',
                bssidVerified: status !== 'excused',
            });
            idx++;
        }
    }
    return records;
};

const MOCK_RECORDS: AttendanceRecord[] = buildMockRecords();

const SAStudentAttendanceHistory: React.FC = () => {
    const t = useT();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [profile, setProfile] = useState<ProfileBasic | null>(null);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [summary, setSummary] = useState<CourseSummary[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'late' | 'absent' | 'excused'>('all');
    const [courseFilter, setCourseFilter] = useState<string>('all');

    const load = useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        // MVP build: populate from static mock data, no backend.
        setProfile(MOCK_PROFILE);
        setRecords(MOCK_RECORDS);
        setStats(MOCK_STATS);
        setSummary(MOCK_SUMMARY);
        setIsLoading(false);
    }, [id]);

    useEffect(() => { load(); }, [load]);

    const courseOptions = useMemo(() => {
        const codes = Array.from(new Set(records.map(r => r.courseCode).filter(Boolean)));
        return [
            { value: 'all', label: t('sa.allCoursesOpt') },
            ...codes.map(code => ({ value: code, label: code }))
        ];
    }, [records, t]);

    const filtered = useMemo(() => {
        return records.filter(r => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (courseFilter !== 'all' && r.courseCode !== courseFilter) return false;
            return true;
        });
    }, [records, statusFilter, courseFilter]);

    if (isLoading) {
        return (
            <div className="space-y-6 pb-16 px-2 sm:px-0">
                <div className="h-10 w-48 bg-white/5 animate-pulse rounded-xl"></div>
                <div className="h-32 w-full bg-white/5 animate-pulse rounded-2xl"></div>
                <div className="h-96 w-full bg-white/5 animate-pulse rounded-2xl"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors text-sm font-semibold mb-2">
                    <i className="ph-bold ph-arrow-left"></i> {t('sa.backToProfile')}
                </button>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold">{t('sa.attendanceHistoryTitle')}</h2>
                {profile && (
                    <p className="text-gray-500 text-sm mt-1">
                        {profile.firstName} {profile.lastName} · {profile.email}
                    </p>
                )}
            </AnimateOnView>

            {error && (
                <AnimateOnView enabled={false}>
                    <div className={`${glassCardStyle} px-4 py-3 border-red-500/30`}>
                        <p className="text-red-400 text-sm font-semibold flex items-center gap-2">
                            <i className="ph-bold ph-warning-circle"></i> {error}
                        </p>
                    </div>
                </AnimateOnView>
            )}

            {/* Overall Stats */}
            {stats && (
                <AnimateOnView delay={0.05} enabled={false}>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        <StatCard label={t('sa.statRate')} value={`${stats.attendanceRate}%`} color="text-[#6A3FF4]" icon="ph-chart-bar" />
                        <StatCard label={t('sa.statPresent')} value={stats.present} color="text-green-500" icon="ph-check-circle" />
                        <StatCard label={t('sa.statLate')} value={stats.late} color="text-amber-500" icon="ph-clock" />
                        <StatCard label={t('sa.statAbsent')} value={stats.absent} color="text-red-500" icon="ph-x-circle" />
                        <StatCard label={t('sa.statExcused')} value={stats.excused} color="text-blue-500" icon="ph-shield-check" />
                    </div>
                </AnimateOnView>
            )}

            {/* By-course summary */}
            {summary.length > 0 && (
                <AnimateOnView delay={0.1} enabled={false}>
                    <div className={`${glassCardStyle} p-6 space-y-4`}>
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-books text-[#6A3FF4]"></i> {t('sa.byCourseTitle')}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {summary.map(c => (
                                <div key={c.courseCode} className="p-4 bg-white/5 rounded-xl border border-white/10">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-mono font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md">
                                            {c.courseCode}
                                        </span>
                                        <span className={`text-sm font-bold ${c.attendanceRate >= 75 ? 'text-green-500' : c.attendanceRate >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                                            {c.attendanceRate}%
                                        </span>
                                    </div>
                                    <p className="text-black dark:text-white text-xs font-medium line-clamp-1">{c.courseName || '—'}</p>
                                    <div className="flex gap-2 text-[10px] mt-2 text-gray-400">
                                        <span><span className="text-green-500 font-semibold">{c.present}</span> P</span>
                                        <span><span className="text-amber-500 font-semibold">{c.late}</span> L</span>
                                        <span><span className="text-red-500 font-semibold">{c.absent}</span> A</span>
                                        <span><span className="text-blue-500 font-semibold">{c.excused}</span> E</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </AnimateOnView>
            )}

            {/* Filters + Records table */}
            <AnimateOnView delay={0.15} enabled={false}>
                <div className={`${glassCardStyle} p-6 space-y-4`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-list text-[#6A3FF4]"></i> {t('sa.recordsTitle')}
                            <span className="text-xs font-normal text-gray-500">{t('sa.recordsCounter', { shown: filtered.length, total: records.length })}</span>
                        </h3>
                        <div className="flex gap-3 flex-wrap">
                            <div className="min-w-[160px]">
                                <GlassDropdown
                                    value={statusFilter}
                                    onChange={(v) => setStatusFilter(v as typeof statusFilter)}
                                    options={[
                                        { value: 'all', label: t('sa.allStatusesOpt') },
                                        { value: 'present', label: t('sa.presentOpt') },
                                        { value: 'late', label: t('sa.lateOpt') },
                                        { value: 'absent', label: t('sa.absentOpt') },
                                        { value: 'excused', label: t('sa.excusedOpt') },
                                    ]}
                                    direction="auto"
                                />
                            </div>
                            <div className="min-w-[160px]">
                                <GlassDropdown
                                    value={courseFilter}
                                    onChange={setCourseFilter}
                                    options={courseOptions}
                                    direction="auto"
                                />
                            </div>
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <p className="text-sm text-gray-500 italic py-10 text-center">
                            {records.length === 0 ? t('sa.noRecordsOnFile') : t('sa.noRecordsMatchFilters')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-gray-500 dark:text-gray-400 text-[11px] uppercase tracking-wider">
                                        <th className="text-left pb-3 font-semibold">{t('sa.dateColAtt')}</th>
                                        <th className="text-left pb-3 font-semibold">{t('sa.courseColAtt')}</th>
                                        <th className="text-left pb-3 font-semibold">{t('sa.statusColAtt')}</th>
                                        <th className="text-left pb-3 font-semibold hidden md:table-cell">{t('sa.verificationColAtt')}</th>
                                        <th className="text-left pb-3 font-semibold hidden md:table-cell">{t('sa.markedAtColAtt')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((r, i) => (
                                        <motion.tr
                                            key={r.id}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: Math.min(i * 0.02, 0.4) }}
                                            className="border-t border-white/10 dark:border-white/5 hover:bg-white/5 transition-colors"
                                        >
                                            <td className="py-3 text-gray-400 text-xs">{new Date(r.date).toLocaleDateString()}</td>
                                            <td className="py-3">
                                                <span className="text-[11px] font-mono font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md mr-2">
                                                    {r.courseCode || '—'}
                                                </span>
                                                <span className="text-black dark:text-white text-xs">{r.courseName || ''}</span>
                                            </td>
                                            <td className="py-3">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${STATUS_STYLES[r.status] || 'bg-gray-500/10 text-gray-400'}`}>
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="py-3 text-gray-500 text-xs hidden md:table-cell">
                                                {r.verificationMethod || '—'}
                                                {r.bssidVerified && (
                                                    <span className="ml-1 text-green-500" title={t('sa.verifiedViaBssidTitle')}>
                                                        <i className="ph-bold ph-shield-check"></i>
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-3 text-gray-500 text-xs hidden md:table-cell">{new Date(r.markedAt).toLocaleString()}</td>
                                        </motion.tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </AnimateOnView>
        </div>
    );
};

const StatCard: React.FC<{ label: string; value: string | number; color: string; icon: string }> = ({ label, value, color, icon }) => (
    <div className={`${glassCardStyle} p-4 flex flex-col items-center text-center`}>
        <i className={`ph-fill ${icon} text-2xl ${color} mb-1`}></i>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
);

export default SAStudentAttendanceHistory;
