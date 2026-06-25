// src/pages/admin/Analytics.tsx
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { ParticleCard } from '../../components/MagicBento';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface AnalyticsData {
    gpaRanges: { range: string; count: number; percent: number }[];
    avgGpa: string;
    avgAttendance: number;
    atRiskCount: number;
    totalStudents: number;
    totalEnrolled: number;
    departmentEnrollment: { dept: string; students: number; percent: number }[];
}

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. Realistic FCDS-scale analytics.
const MOCK_ANALYTICS: AnalyticsData = {
    gpaRanges: [
        { range: '3.5–4.0', count: 312, percent: 26 },
        { range: '3.0–3.5', count: 408, percent: 34 },
        { range: '2.5–3.0', count: 264, percent: 22 },
        { range: '2.0–2.5', count: 156, percent: 13 },
        { range: '< 2.0',  count: 60,  percent: 5 },
    ],
    avgGpa: '3.12',
    avgAttendance: 87,
    atRiskCount: 60,
    totalStudents: 1200,
    totalEnrolled: 1142,
    departmentEnrollment: [
        { dept: 'Computer Science', students: 384, percent: 32 },
        { dept: 'Data Science', students: 288, percent: 24 },
        { dept: 'Information Systems', students: 216, percent: 18 },
        { dept: 'Cybersecurity', students: 144, percent: 12 },
        { dept: 'Software Engineering', students: 108, percent: 9 },
        { dept: 'Artificial Intelligence', students: 60, percent: 5 },
    ],
};

const deptColors = ['from-[#7B5AFF] to-[#5A2AD4]', 'from-blue-500 to-cyan-500', 'from-green-500 to-emerald-500', 'from-yellow-500 to-orange-500', 'from-pink-500 to-rose-500', 'from-teal-500 to-cyan-400'];

const Analytics: React.FC = () => {
    const t = useT();
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Preview: load static analytics, no backend.
        setData(MOCK_ANALYTICS);
        setIsLoading(false);
    }, []);

    const maxPercent = data ? Math.max(...data.gpaRanges.map(r => r.percent), 1) : 1;

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('admin.analyticsTitle')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.analyticsLongSubtitle')}</p>
            </AnimateOnView>

            {/* Quick stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                    { label: t('admin.analyticsStatAvgGpa'), value: isLoading ? '—' : data?.avgGpa ?? '—', delta: '', icon: 'ph-chart-bar', color: 'bg-[#6A3FF4]/20', iconColor: 'text-[#6A3FF4]', deltaColor: 'text-green-500' },
                    { label: t('admin.analyticsStatAvgAttendance'), value: isLoading ? '—' : `${data?.avgAttendance ?? 0}%`, delta: '', icon: 'ph-check-circle', color: 'bg-[#6A3FF4]/20', iconColor: 'text-[#6A3FF4]', deltaColor: 'text-yellow-500' },
                    { label: t('admin.analyticsStatAtRisk'), value: isLoading ? '—' : String(data?.atRiskCount ?? 0), delta: t('admin.analyticsAtRiskDelta'), icon: 'ph-warning', color: 'bg-red-500/20', iconColor: 'text-red-500', deltaColor: 'text-gray-500 dark:text-gray-400' },
                    { label: t('admin.analyticsStatTotalEnrolled'), value: isLoading ? '—' : String(data?.totalEnrolled ?? 0), delta: t('admin.analyticsOfStudents', { n: data?.totalStudents ?? 0 }), icon: 'ph-users', color: 'bg-[#6A3FF4]/20', iconColor: 'text-[#6A3FF4]', deltaColor: 'text-green-500' },
                ].map((stat, i) => (
                    <AnimateOnView key={stat.label} delay={i * 0.05} enabled={false}>
                        <ParticleCard className={`${glassCardStyle} p-5 flex flex-col justify-between h-full`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-10 h-10 rounded-xl ${stat.color} flex items-center justify-center`}>
                                    <i className={`ph-fill ${stat.icon} text-xl ${stat.iconColor}`}></i>
                                </div>
                                <span className="text-black dark:text-gray-300 font-bold text-xs uppercase tracking-wider">{stat.label}</span>
                            </div>
                            <p className="text-black dark:text-white text-xl sm:text-3xl font-bold mt-1">{stat.value}</p>
                            <span className={`${stat.deltaColor} text-xs font-medium`}>{stat.delta}</span>
                        </ParticleCard>
                    </AnimateOnView>
                ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* GPA Distribution */}
                <AnimateOnView delay={0.1} enabled={false}>
                    <div className={`${glassCardStyle} p-6 h-full`}>
                        <h2 className="text-black dark:text-white text-lg font-bold mb-2 flex items-center">
                            <i className="ph-bold ph-chart-bar mr-2 text-[#6A3FF4]"></i> {t('admin.analyticsGpaDistribution')}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">{t('admin.analyticsGpaDistSubtitle')}</p>
                        {isLoading ? (
                            <div className="text-center py-8"><i className="ph-duotone ph-spinner animate-spin text-3xl text-[#6A3FF4]"></i></div>
                        ) : (
                            <div className="space-y-4">
                                {(data?.gpaRanges ?? []).map((g, i) => (
                                    <div key={g.range} className="flex items-center gap-4">
                                        <span className="text-gray-500 dark:text-gray-400 text-sm w-20 text-right font-mono">{g.range}</span>
                                        <div className="flex-1 h-6 rounded-lg bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 overflow-hidden">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${maxPercent > 0 ? (g.percent / maxPercent) * 100 : 0}%` }}
                                                transition={{ duration: 0.8, delay: i * 0.08 }}
                                                className="h-full rounded-lg bg-gradient-to-r from-[#5A2AD4] to-[#7B5AFF] flex items-center justify-end pr-2"
                                            >
                                                {g.count > 0 && <span className="text-xs text-white font-bold">{g.count}</span>}
                                            </motion.div>
                                        </div>
                                        <span className="text-gray-500 dark:text-gray-400 text-xs w-8">{g.percent}%</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="mt-4 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span>{t('admin.analyticsTotalStudents', { n: data?.totalStudents ?? 0 })}</span>
                            <span>{t('admin.analyticsAverageGpa', { value: data?.avgGpa ?? '—' })}</span>
                        </div>
                    </div>
                </AnimateOnView>

                {/* Dropout Risk */}
                <AnimateOnView delay={0.15} enabled={false}>
                    <ParticleCard className={`${glassCardStyle} p-6 h-full`} enableTilt={false} enableMagnetism={false} clickEffect particleCount={10} glowColor="132, 0, 255">
                        <h2 className="text-black dark:text-white text-lg font-bold mb-2 flex items-center">
                            <i className="ph-bold ph-shield-warning mr-2 text-[#6A3FF4]"></i> {t('admin.analyticsDropoutRisk')}
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">{t('admin.analyticsDropoutSubtitle')}</p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            {[
                                { level: t('admin.analyticsHighRisk'), count: data?.atRiskCount ?? 0, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: 'ph-warning-octagon' },
                                { level: t('admin.analyticsTotalStudentsTile'), count: data?.totalStudents ?? 0, color: 'text-[#6A3FF4]', bg: 'bg-[#6A3FF4]/10', border: 'border-[#6A3FF4]/20', icon: 'ph-users' },
                                { level: t('admin.analyticsAvgAttendanceTile'), count: `${data?.avgAttendance ?? 0}%`, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20', icon: 'ph-check-circle' },
                                { level: t('admin.analyticsEnrolledCourses'), count: data?.totalEnrolled ?? 0, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: 'ph-book' },
                            ].map(r => (
                                <div key={r.level} className={`${r.bg} border ${r.border} rounded-xl p-4 text-center`}>
                                    <i className={`ph-fill ${r.icon} ${r.color} text-2xl mb-2 block`}></i>
                                    <span className={`text-2xl font-bold ${r.color} block`}>{isLoading ? '—' : r.count}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">{r.level}</span>
                                </div>
                            ))}
                        </div>
                    </ParticleCard>
                </AnimateOnView>
            </div>

            {/* Enrollment Statistics */}
            <AnimateOnView delay={0.2} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <h2 className="text-black dark:text-white text-lg font-bold mb-2 flex items-center">
                        <i className="ph-bold ph-users mr-2 text-[#6A3FF4]"></i> {t('admin.analyticsEnrollByDept')}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">{t('admin.analyticsEnrollSubtitle')}</p>
                    {isLoading ? (
                        <div className="text-center py-8"><i className="ph-duotone ph-spinner animate-spin text-3xl text-[#6A3FF4]"></i></div>
                    ) : (
                        <div className="space-y-3">
                            {(data?.departmentEnrollment ?? []).map((d, i) => (
                                <div key={d.dept} className="flex items-center gap-4">
                                    <span className="text-sm text-gray-500 dark:text-gray-400 w-44 truncate">{d.dept}</span>
                                    <div className="flex-1 h-4 rounded-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 overflow-hidden">
                                        <motion.div initial={{ width: 0 }} animate={{ width: `${d.percent}%` }} transition={{ duration: 0.8, delay: i * 0.08 }}
                                            className={`h-full rounded-full bg-gradient-to-r ${deptColors[i % deptColors.length]}`}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 w-24 justify-end">
                                        <span className="text-sm text-black dark:text-white font-medium">{d.students}</span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">({d.percent}%)</span>
                                    </div>
                                </div>
                            ))}
                            {(!data?.departmentEnrollment?.length) && <p className="text-gray-500 text-center py-4">{t('admin.analyticsNoEnrollment')}</p>}
                        </div>
                    )}
                </div>
            </AnimateOnView>
        </div>
    );
};

export default Analytics;
