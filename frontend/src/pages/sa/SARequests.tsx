import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface Request {
    id: string;
    studentName: string;
    studentEmail: string;
    type: string;
    typeName: string;
    subject: string;
    message: string;
    description?: string;
    status: 'pending' | 'processing' | 'resolved' | 'rejected';
    statusRaw?: 'pending' | 'in_progress' | 'completed' | 'rejected';
    priority: 'high' | 'medium' | 'low';
    createdAt: string;
    assignedTo: string;
    notes?: string;
    resolution?: string;
    estimatedDays?: number;
    attachments?: string[];
    processedBy?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        processedAt?: string;
    } | null;
}

const statusColor: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30',
    processing: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
    resolved: 'bg-green-500/20 text-green-500 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-500 border-red-500/30',
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_REQUESTS: Request[] = [
    {
        id: 'REQ-2041', studentName: 'Mariam El-Sayed', studentEmail: 'mariam.elsayed@uniflow.edu',
        type: 'transcript', typeName: 'Transcript Request', subject: 'Official transcript for internship',
        message: 'I need an official transcript to submit with my summer internship application at Vodafone Egypt.',
        description: 'I need an official transcript to submit with my summer internship application at Vodafone Egypt. The deadline is in two weeks.',
        status: 'pending', priority: 'high', createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        assignedTo: 'Registrar', estimatedDays: 3, processedBy: null,
    },
    {
        id: 'REQ-2039', studentName: 'Youssef Ibrahim', studentEmail: 'youssef.ibrahim@uniflow.edu',
        type: 'enrollment', typeName: 'Enrollment Verification', subject: 'Enrollment letter for visa',
        message: 'Requesting an enrollment verification letter for my student visa renewal.',
        description: 'Requesting an enrollment verification letter for my student visa renewal at the embassy.',
        status: 'processing', priority: 'medium', createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        assignedTo: 'Student Affairs', estimatedDays: 2,
        processedBy: { id: 'sa-1', firstName: 'Laila', lastName: 'Mansour', email: 'laila.mansour@uniflow.edu', processedAt: new Date(Date.now() - 6 * 3600000).toISOString() },
    },
    {
        id: 'REQ-2035', studentName: 'Ahmed Tarek', studentEmail: 'ahmed.tarek@uniflow.edu',
        type: 'withdrawal', typeName: 'Course Withdrawal', subject: 'Withdraw from CS340',
        message: 'I would like to withdraw from Database Systems this semester due to workload.',
        description: 'I would like to withdraw from Database Systems (CS340) this semester due to heavy workload across my other courses.',
        status: 'resolved', priority: 'medium', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        assignedTo: 'Registrar', estimatedDays: 1, resolution: 'Withdrawal processed. Course removed from current schedule.',
        processedBy: { id: 'sa-1', firstName: 'Laila', lastName: 'Mansour', email: 'laila.mansour@uniflow.edu', processedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    },
    {
        id: 'REQ-2030', studentName: 'Habiba Gamal', studentEmail: 'habiba.gamal@uniflow.edu',
        type: 'document', typeName: 'Document Request', subject: 'Grade report copy',
        message: 'Please provide a stamped copy of my latest grade report.',
        description: 'Please provide a stamped, official copy of my latest grade report for scholarship purposes.',
        status: 'pending', priority: 'low', createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
        assignedTo: 'Registrar', estimatedDays: 5, processedBy: null,
    },
];

const SARequests: React.FC = () => {
    const t = useT();
    const [requests, setRequests] = useState<Request[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [actionMsg, setActionMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setRequests(MOCK_REQUESTS);
        setIsLoading(false);
    }, []);

    const handleStatusUpdate = async (id: string, newStatus: string) => {
        setPendingId(id);
        setActionMsg(null);
        // MVP build: flip the row's status locally; no backend.
        const processedBy = {
            id: 'sa-1', firstName: 'Laila', lastName: 'Mansour',
            email: 'laila.mansour@uniflow.edu', processedAt: new Date().toISOString(),
        };
        setRequests((prev) => prev.map((r) =>
            r.id === id
                ? { ...r, status: newStatus as Request['status'], processedBy }
                : r));
        const labels: Record<string, string> = {
            processing: t('sa.markedAsProcessing'),
            resolved: t('sa.requestResolved'),
            rejected: t('sa.requestRejectedLbl'),
        };
        setActionMsg({ kind: 'success', text: labels[newStatus] || t('sa.updatedLbl') });
        setPendingId(null);
        setTimeout(() => setActionMsg(null), 3000);
    };

    const filtered = requests.filter(r => {
        const matchStatus = filterStatus === 'all' || r.status === filterStatus;
        const matchSearch = r.subject.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          r.typeName?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchStatus && matchSearch;
    });

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.requestsTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.requestsPageSubtitle')}</p>
            </AnimateOnView>

            {actionMsg && (
                <AnimateOnView enabled={false}>
                    <div
                        className={`${glassCardStyle} px-4 py-3 flex items-center justify-between gap-3 ${
                            actionMsg.kind === 'success' ? 'border-green-500/30' : 'border-red-500/30'
                        }`}
                    >
                        <div className={`flex items-center gap-2 text-sm font-semibold ${actionMsg.kind === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                            <i className={`ph-bold ${actionMsg.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}`}></i>
                            {actionMsg.text}
                        </div>
                        <button onClick={() => setActionMsg(null)} className="text-gray-500 hover:text-white text-xs">
                            <i className="ph-bold ph-x"></i>
                        </button>
                    </div>
                </AnimateOnView>
            )}

            <AnimateOnView delay={0.1} enabled={false}>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex gap-2 bg-white/10 dark:bg-black/20 p-1 rounded-xl border border-white/20">
                        {(['all', 'pending', 'processing', 'resolved'] as const).map(s => {
                            const labelMap: Record<string, string> = {
                                all: t('sa.filterAll'),
                                pending: t('sa.filterPending'),
                                processing: t('sa.filterProcessing'),
                                resolved: t('sa.filterResolved'),
                            };
                            return (
                                <button
                                    key={s}
                                    onClick={() => setFilterStatus(s)}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
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
                            placeholder={t('sa.searchRequestsPlaceholder')}
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
                ) : filtered.map((r, i) => (
                    <motion.div
                        key={r.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className={`${glassCardStyle} p-6 hover:border-[#6A3FF4]/30 transition-all`}
                    >
                        <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md bg-[#6A3FF4]/10 text-[#6A3FF4] border border-[#6A3FF4]/20`}>
                                        {r.typeName?.toUpperCase() || r.type.toUpperCase()}
                                    </span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColor[r.status]}`}>
                                        {r.status.toUpperCase()}
                                    </span>
                                    <span className="text-[10px] text-gray-500 font-mono">{new Date(r.createdAt).toLocaleDateString()}</span>
                                </div>
                                <h3 className="text-black dark:text-white font-bold text-lg mb-1">{r.subject}</h3>
                                <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">{r.message}</p>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-500">
                                            {r.studentName.charAt(0)}
                                        </div>
                                        <span className="text-xs text-black dark:text-gray-300 font-medium">{r.studentName}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                        <i className="ph ph-building"></i>
                                        <span>{t('sa.deptLbl', { name: r.assignedTo })}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-row md:flex-col gap-2 justify-end">
                                {r.status === 'pending' && (
                                    <button
                                        onClick={() => handleStatusUpdate(r.id, 'processing')}
                                        disabled={pendingId === r.id}
                                        className="px-4 py-2 rounded-xl bg-[#6A3FF4] text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50"
                                    >
                                        {pendingId === r.id ? '…' : t('sa.markProcessingBtn')}
                                    </button>
                                )}
                                {r.status === 'processing' && (
                                    <button
                                        onClick={() => handleStatusUpdate(r.id, 'resolved')}
                                        disabled={pendingId === r.id}
                                        className="px-4 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-green-500/20 disabled:opacity-50"
                                    >
                                        {pendingId === r.id ? '…' : t('sa.completeRequestBtn')}
                                    </button>
                                )}
                                {(r.status === 'pending' || r.status === 'processing') && (
                                    <button
                                        onClick={() => handleStatusUpdate(r.id, 'rejected')}
                                        disabled={pendingId === r.id}
                                        className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-500 text-xs font-bold hover:bg-red-500/30 transition-all disabled:opacity-50"
                                    >
                                        {t('sa.rejectBtn')}
                                    </button>
                                )}
                                <button
                                    onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                                    className="px-4 py-2 rounded-xl bg-white/10 dark:bg-black/20 border border-white/20 text-black dark:text-white text-xs font-bold hover:bg-white/20 transition-all flex items-center justify-center gap-1"
                                >
                                    {expandedId === r.id ? t('sa.hideDetailsBtn') : t('sa.viewDetailsBtn')}
                                    <i className={`ph-bold ph-caret-down transition-transform ${expandedId === r.id ? 'rotate-180' : ''}`}></i>
                                </button>
                            </div>
                        </div>

                        {/* Processor banner — visible whenever an SA has taken the
                            row, including after it transitions to resolved/rejected
                            so SA + admin can see who handled it. */}
                        {r.processedBy && (
                            <div className="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20 flex items-center gap-3 flex-wrap">
                                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-500 flex-shrink-0">
                                    {r.processedBy.firstName?.charAt(0) || '?'}
                                </div>
                                <div className="text-sm text-blue-600 dark:text-blue-300 min-w-0">
                                    <p className="font-semibold">
                                        {r.status === 'processing'
                                            ? t('sa.beingProcessedBy', { first: r.processedBy.firstName, last: r.processedBy.lastName })
                                            : t('sa.lastTouchedBy', { first: r.processedBy.firstName, last: r.processedBy.lastName })}
                                    </p>
                                    <p className="text-xs text-blue-500 truncate">
                                        {r.processedBy.email}
                                        {r.processedBy.processedAt && ` · ${new Date(r.processedBy.processedAt).toLocaleString()}`}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Inline expand panel — full message + metadata. */}
                        {expandedId === r.id && (
                            <div className="mt-4 pt-4 border-t border-white/10 space-y-2 text-sm">
                                <div>
                                    <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">{t('sa.fullMessageLbl')}</p>
                                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{r.description || r.message}</p>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.studentEmailLbl')}</p>
                                        <p className="text-black dark:text-gray-300 truncate">{r.studentEmail}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.priorityLbl')}</p>
                                        <p className="text-black dark:text-gray-300 capitalize">{r.priority}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.estimatedLbl')}</p>
                                        <p className="text-black dark:text-gray-300">{r.estimatedDays ? t('sa.daysCount', { n: r.estimatedDays }) : '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.submittedLbl')}</p>
                                        <p className="text-black dark:text-gray-300">{new Date(r.createdAt).toLocaleString()}</p>
                                    </div>
                                </div>
                                {r.notes && (
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.routingLbl')}</p>
                                        <p className="text-gray-700 dark:text-gray-300">{r.notes}</p>
                                    </div>
                                )}
                                {r.resolution && (
                                    <div>
                                        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-500">{t('sa.resolutionLbl')}</p>
                                        <p className="text-green-500">{r.resolution}</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                ))}

                {!isLoading && filtered.length === 0 && (
                    <div className="text-center py-20">
                        <i className="ph-duotone ph-file-text text-5xl text-gray-400 mb-3 block"></i>
                        <p className="text-gray-500">{t('sa.noRequestsMatchFilters')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SARequests;
