import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface ComplaintComplainant {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
}

interface Complaint {
    id: string;
    subject: string;
    description: string;
    severity: string;
    status: string;
    createdAt: string;
    complainant: ComplaintComplainant;
    resolutionNotes?: string;
}

const statusColor: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
    in_progress: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
    completed: 'bg-green-500/20 text-green-500 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-500 border-red-500/30',
};

const severityColor: Record<string, string> = {
    high: 'text-red-500',
    medium: 'text-amber-500',
    low: 'text-green-500',
    critical: 'text-red-600',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_COMPLAINTS: Complaint[] = [
    {
        id: 'CMP-1187', subject: 'Grade appeal for CS301 midterm', description: 'I believe my midterm was graded incorrectly. Question 4 was marked wrong but my solution matches the rubric.',
        severity: 'high', status: 'in_progress', createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
        complainant: { id: 'stu-002', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.edu' },
    },
    {
        id: 'CMP-1185', subject: 'Lab 3 air conditioning broken', description: 'The AC in Lab 3 has been broken for over a week, making it very uncomfortable during afternoon sessions.',
        severity: 'medium', status: 'completed', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        complainant: { id: 'stu-004', firstName: 'Salma', lastName: 'Mahmoud', email: 'salma.mahmoud@uniflow.edu' },
        resolutionNotes: 'Facilities replaced the AC unit. Confirmed working.',
    },
    {
        id: 'CMP-1182', subject: 'Unfair attendance marking', description: 'I was marked absent for a session I attended. The QR scan failed but I was physically present.',
        severity: 'low', status: 'pending', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        complainant: { id: 'stu-007', firstName: 'Karim', lastName: 'Fouad', email: 'karim.fouad@uniflow.edu' },
    },
    {
        id: 'CMP-1179', subject: 'Harassment report', description: 'Reporting inappropriate behavior from a classmate during group work. Requesting confidential handling.',
        severity: 'critical', status: 'pending', createdAt: new Date(Date.now() - 8 * 3600000).toISOString(),
        complainant: { id: 'stu-001', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.edu' },
    },
];

const SAComplaints: React.FC = () => {
    const t = useT();
    const [complaints, setComplaints] = useState<Complaint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setComplaints(MOCK_COMPLAINTS);
        setIsLoading(false);
    }, []);

    const handleStatusUpdate = async (id: string, newStatus: string) => {
        // MVP build: flip the row's status locally; no backend.
        const notes = resolutionNotes[id] ?? '';
        setComplaints((prev) => prev.map((c) =>
            c.id === id
                ? { ...c, status: newStatus, resolutionNotes: notes || c.resolutionNotes }
                : c));
    };

    const filtered = complaints.filter(c => {
        const studentName = `${c.complainant?.firstName ?? ''} ${c.complainant?.lastName ?? ''}`;
        const matchStatus = filterStatus === 'all' || c.status === filterStatus;
        const matchSearch = (c.subject ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                            studentName.toLowerCase().includes(searchTerm.toLowerCase());
        return matchStatus && matchSearch;
    });

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.complaintsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.complaintsPageSubtitle')}</p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    {/* Status filter pill bar — 5 chips overflow narrow
                        mobile cards. `overflow-x-auto` + `scrollbar-hidden`
                        lets the bar pan horizontally without a visible
                        scrollbar; `flex-shrink-0` + `whitespace-nowrap` on
                        each chip keeps the labels readable instead of
                        squishing. `max-w-full` clamps the container so it
                        scrolls inside the card width. */}
                    <div className="flex gap-2 bg-white/10 dark:bg-black/20 p-1 rounded-xl border border-white/20 overflow-x-auto scrollbar-hidden max-w-full">
                        {(['all', 'pending', 'in_progress', 'completed', 'rejected'] as const).map(s => {
                            const labelMap: Record<string, string> = {
                                all: t('sa.filterAll'),
                                pending: t('sa.filterPending'),
                                in_progress: t('sa.filterInProgress'),
                                completed: t('sa.filterCompleted'),
                                rejected: t('sa.filterRejected'),
                            };
                            return (
                                <button
                                    key={s}
                                    onClick={() => setFilterStatus(s)}
                                    className={`flex-shrink-0 px-4 py-1.5 rounded-lg text-xs font-bold capitalize whitespace-nowrap transition-all ${
                                        filterStatus === s ? 'bg-[#6A3FF4] text-white shadow-lg' : 'text-gray-500 hover:bg-white/5'
                                    }`}
                                >
                                    {labelMap[s]}
                                </button>
                            );
                        })}
                    </div>
                    <div className="relative w-full sm:w-64">
                        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"></i>
                        <input
                            type="text"
                            placeholder={t('sa.searchComplaintsPlaceholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                        />
                    </div>
                </div>
            </AnimateOnView>

            <div className="grid grid-cols-1 gap-4">
                {isLoading ? (
                    [1, 2, 3].map(i => <div key={i} className="h-32 w-full bg-white/5 animate-pulse rounded-2xl"></div>)
                ) : filtered.map((c, i) => {
                    const studentName = `${c.complainant?.firstName ?? ''} ${c.complainant?.lastName ?? ''}`.trim() || t('sa.unknownStudentLbl');
                    const studentEmail = c.complainant?.email ?? '';
                    return (
                        <motion.div
                            key={c.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className={`${glassCardStyle} p-6 hover:border-[#6A3FF4]/30 transition-all`}
                        >
                            <div className="flex flex-col md:flex-row justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor[c.status] ?? statusColor.pending}`}>
                                            {c.status.toUpperCase()}
                                        </span>
                                        <span className={`text-[10px] font-bold flex items-center gap-1 ${severityColor[c.severity?.toLowerCase()] ?? 'text-gray-400'}`}>
                                            <i className="ph-fill ph-warning-circle"></i> {t('sa.severitySuffix', { sev: (c.severity ?? 'N/A').toUpperCase() })}
                                        </span>
                                        <span className="text-[10px] text-gray-500 font-mono">{new Date(c.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <h3 className="text-black dark:text-white font-bold text-lg mb-1">{c.subject}</h3>
                                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">{c.description}</p>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-[#6A3FF4]/20 flex items-center justify-center text-[10px] font-bold text-[#6A3FF4]">
                                            {studentName.charAt(0)}
                                        </div>
                                        <span className="text-xs text-black dark:text-gray-300 font-medium">{studentName}</span>
                                        <span className="text-[10px] text-gray-500">({studentEmail})</span>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 min-w-[140px]">
                                    {(c.status === 'pending' || c.status === 'in_progress') && (
                                        <textarea
                                            placeholder={t('sa.resolutionNotesPlaceholder')}
                                            value={resolutionNotes[c.id] ?? ''}
                                            onChange={e => setResolutionNotes(prev => ({ ...prev, [c.id]: e.target.value }))}
                                            rows={2}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-black dark:text-white resize-none focus:outline-none focus:border-[#6A3FF4]"
                                        />
                                    )}
                                    {c.status === 'pending' && (
                                        <button
                                            onClick={() => handleStatusUpdate(c.id, 'in_progress')}
                                            className="px-4 py-2 rounded-xl bg-[#6A3FF4] text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
                                        >
                                            {t('sa.startProcessingBtn')}
                                        </button>
                                    )}
                                    {c.status === 'in_progress' && (
                                        <button
                                            onClick={() => handleStatusUpdate(c.id, 'completed')}
                                            className="px-4 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-green-500/20"
                                        >
                                            {t('sa.markResolvedBtn')}
                                        </button>
                                    )}
                                    {(c.status === 'pending' || c.status === 'in_progress') && (
                                        <button
                                            onClick={() => handleStatusUpdate(c.id, 'rejected')}
                                            className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-500 text-xs font-bold hover:bg-red-500/30 transition-all"
                                        >
                                            {t('sa.rejectBtn')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    );
                })}

                {!isLoading && filtered.length === 0 && (
                    <div className="text-center py-20">
                        <i className="ph-duotone ph-magnifying-glass text-5xl text-gray-400 mb-3 block"></i>
                        <p className="text-gray-500">{t('sa.noComplaintsMatchFilters')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SAComplaints;
