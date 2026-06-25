import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

interface NameChangeUser {
    firstName: string;
    lastName: string;
    email: string;
}

interface NameChangeRequest {
    id: string;
    userId: string;
    currentFirstName: string;
    currentLastName: string;
    requestedFirstName: string;
    requestedLastName: string;
    reviewNote?: string;
    createdAt: string;
    user: NameChangeUser;
}

interface ToastState {
    message: string;
    type: 'success' | 'error';
}

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_NAME_CHANGES: NameChangeRequest[] = [
    {
        id: 'nc-1', userId: 'stu-004',
        currentFirstName: 'Salma', currentLastName: 'Mahmoud',
        requestedFirstName: 'Salma', requestedLastName: 'Mahmoud-Ali',
        createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        user: { firstName: 'Salma', lastName: 'Mahmoud', email: 'salma.mahmoud@uniflow.edu' },
    },
    {
        id: 'nc-2', userId: 'stu-002',
        currentFirstName: 'Omar', currentLastName: 'Hassan',
        requestedFirstName: 'Omar', requestedLastName: 'Hassan El-Din',
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        user: { firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.edu' },
    },
    {
        id: 'nc-3', userId: 'stu-008',
        currentFirstName: 'Habiba', currentLastName: 'Gamal',
        requestedFirstName: 'Habiba', requestedLastName: 'Gamal Soliman',
        createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
        user: { firstName: 'Habiba', lastName: 'Gamal', email: 'habiba.gamal@uniflow.edu' },
    },
];

const SANameChangeRequests: React.FC = () => {
    const t = useT();
    const [requests, setRequests] = useState<NameChangeRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
    const [showRejectInput, setShowRejectInput] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<ToastState | null>(null);

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    };

    useEffect(() => {
        // MVP build: populate from static mock data, no backend.
        setRequests(MOCK_NAME_CHANGES);
        setIsLoading(false);
    }, []);

    const handleApprove = async (id: string) => {
        setActionInProgress(id);
        // MVP build: optimistic local removal; no backend.
        setRequests(prev => prev.filter(r => r.id !== id));
        showToast(t('sa.nameChangeApprovedSuccess'), 'success');
        setActionInProgress(null);
    };

    const handleReject = async (id: string) => {
        setActionInProgress(id);
        // MVP build: optimistic local removal; no backend.
        setRequests(prev => prev.filter(r => r.id !== id));
        showToast(t('sa.nameChangeRejected'), 'success');
        setActionInProgress(null);
        setShowRejectInput(prev => ({ ...prev, [id]: false }));
    };

    const toggleRejectInput = (id: string) => {
        setShowRejectInput(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        key="toast"
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl font-bold text-sm shadow-lg ${
                            toast.type === 'success'
                                ? 'bg-green-500 text-white'
                                : 'bg-red-500 text-white'
                        }`}
                    >
                        <i className={`ph-bold ${toast.type === 'success' ? 'ph-check-circle' : 'ph-x-circle'} mr-2`}></i>
                        {toast.message}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('sa.nameChangesTitle')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">{t('sa.nameChangesPageSubtitle')}</p>
            </AnimateOnView>

            {isLoading ? (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-28 w-full bg-white/5 animate-pulse rounded-2xl"></div>
                    ))}
                </div>
            ) : requests.length === 0 ? (
                <AnimateOnView delay={0.1} enabled={false}>
                    <div className={`${glassCardStyle} p-16 text-center`}>
                        <i className="ph-duotone ph-user-check text-5xl text-gray-400 mb-4 block"></i>
                        <p className="text-gray-500 font-semibold">{t('sa.noNameChanges')}</p>
                        <p className="text-gray-600 text-sm mt-1">{t('sa.noPendingNameChangesAll')}</p>
                    </div>
                </AnimateOnView>
            ) : (
                <div className="space-y-4">
                    {requests.map((req, i) => {
                        const studentName = `${req.user?.firstName ?? req.currentFirstName} ${req.user?.lastName ?? req.currentLastName}`.trim();
                        const studentEmail = req.user?.email ?? '';
                        const isBusy = actionInProgress === req.id;
                        return (
                            <motion.div
                                key={req.id}
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ delay: i * 0.05 }}
                                layout
                                className={`${glassCardStyle} p-6 hover:border-[#6A3FF4]/30 transition-all`}
                            >
                                <div className="flex flex-col md:flex-row justify-between gap-4">
                                    <div className="flex-1">
                                        {/* Student identity */}
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-9 h-9 rounded-full bg-[#6A3FF4]/20 flex items-center justify-center text-sm font-bold text-[#6A3FF4]">
                                                {studentName.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="text-black dark:text-white font-bold text-sm">{studentName}</p>
                                                <p className="text-gray-500 text-[10px] font-mono">{studentEmail}</p>
                                            </div>
                                            <span className="ml-auto text-[10px] text-gray-500 font-mono">
                                                {new Date(req.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>

                                        {/* Name change arrow */}
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <div className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
                                                <p className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">{t('sa.currentNameLbl')}</p>
                                                <p className="text-black dark:text-white font-semibold text-sm">
                                                    {req.currentFirstName} {req.currentLastName}
                                                </p>
                                            </div>
                                            <i className="ph-bold ph-arrow-right text-[#6A3FF4] text-lg flex-shrink-0"></i>
                                            <div className="px-3 py-1.5 bg-[#6A3FF4]/10 border border-[#6A3FF4]/20 rounded-lg">
                                                <p className="text-[10px] text-[#6A3FF4] uppercase font-bold mb-0.5">{t('sa.requestedNameLbl')}</p>
                                                <p className="text-black dark:text-white font-semibold text-sm">
                                                    {req.requestedFirstName} {req.requestedLastName}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Reject reason input */}
                                        <AnimatePresence>
                                            {showRejectInput[req.id] && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="mt-3"
                                                >
                                                    <input
                                                        type="text"
                                                        placeholder={t('sa.rejectReasonPlaceholderShort')}
                                                        value={rejectReasons[req.id] ?? ''}
                                                        onChange={e => setRejectReasons(prev => ({ ...prev, [req.id]: e.target.value }))}
                                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-red-500/50 placeholder:text-gray-500"
                                                    />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex flex-row md:flex-col gap-2 justify-end items-end md:items-stretch min-w-[120px]">
                                        <button
                                            onClick={() => handleApprove(req.id)}
                                            disabled={isBusy}
                                            className="px-4 py-2 rounded-xl bg-green-500 text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                        >
                                            {isBusy ? <i className="ph-bold ph-spinner-gap animate-spin"></i> : <i className="ph-bold ph-check"></i>}
                                            {t('sa.approveBtn')}
                                        </button>
                                        {!showRejectInput[req.id] ? (
                                            <button
                                                onClick={() => toggleRejectInput(req.id)}
                                                disabled={isBusy}
                                                className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-500 text-xs font-bold hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {t('sa.rejectBtn')}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleReject(req.id)}
                                                disabled={isBusy}
                                                className="px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                            >
                                                {isBusy ? <i className="ph-bold ph-spinner-gap animate-spin"></i> : <i className="ph-bold ph-x"></i>}
                                                {t('sa.confirmRejectBtn')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SANameChangeRequests;
