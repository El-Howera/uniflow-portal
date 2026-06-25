/**
 * SessionEndedOverlay
 * ----------------------------------------------------------------------------
 * Replaces the `window.alert()` we used to pop when a session was kicked
 * (instant cross-browser disconnect or 15-min refresh fallback). Shown as
 * a glass-morphic centered card behind a semi-transparent black backdrop
 * so it matches the rest of the app instead of looking like a native OS
 * dialog.
 *
 * Triggered globally by dispatching `window.dispatchEvent(new
 * CustomEvent('uniflow:session-ended', { detail: { reason } }))`. Both
 * the silent-refresh path in api.ts and the socket session:revoked path
 * in NotificationContext use this single trigger.
 *
 * Behaviour:
 *   - The component listens for the event, captures the reason string,
 *     and stays mounted (no auto-dismiss) until the user clicks the
 *     primary button. That deliberately blocks any background activity
 *     so the user sees the explanation before being redirected.
 *   - The button wipes auth (mirrors clearAuthAndRedirect in api.ts) and
 *     hard-navigates to /login. The hard navigation drops the entire
 *     React tree, which is what we want after a kick — no half-state.
 *   - Escape key does the same thing as the button so keyboard users
 *     aren't stuck in a modal they can't escape.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SessionEndedDetail {
    reason?: string;
}

const TITLE_BY_REASON: Record<string, string> = {
    signed_in_elsewhere: 'Signed in elsewhere',
};

const MESSAGE_BY_REASON: Record<string, string> = {
    signed_in_elsewhere:
        'Your session ended because the same account signed in on another browser or device. If this wasn’t you, change your password right after signing in again.',
};

const DEFAULT_TITLE = 'Session ended';
const DEFAULT_MESSAGE = 'Your session ended. Please sign in again to continue.';

function clearAuthAndGo(): void {
    try {
        localStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('currentUserRole');
        localStorage.removeItem('currentUserId');
        localStorage.removeItem('currentUserEmail');
    } catch { /* ignore */ }
    // Hard navigate so every component unmounts and we don't briefly flash
    // half-stale React state before /login renders.
    window.location.href = '/login';
}

const SessionEndedOverlay: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [reason, setReason] = useState<string | null>(null);

    useEffect(() => {
        const handler = (ev: Event) => {
            const detail = (ev as CustomEvent<SessionEndedDetail>).detail;
            setReason(detail?.reason ?? null);
            setVisible(true);
        };
        window.addEventListener('uniflow:session-ended', handler as EventListener);
        return () => window.removeEventListener('uniflow:session-ended', handler as EventListener);
    }, []);

    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                clearAuthAndGo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [visible]);

    const title = (reason && TITLE_BY_REASON[reason]) || DEFAULT_TITLE;
    const message = (reason && MESSAGE_BY_REASON[reason]) || DEFAULT_MESSAGE;

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm anim-essential"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="session-ended-title"
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        className="relative w-full max-w-md rounded-2xl bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 shadow-2xl shadow-black/40 ring-1 ring-inset ring-white/30 dark:ring-white/5 backdrop-blur-2xl backdrop-saturate-150 overflow-hidden"
                    >
                        {/* Top accent stripe — same gradient as our buttons */}
                        <div className="h-1.5 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4]" />

                        <div className="p-6 sm:p-7 flex flex-col items-center text-center gap-4">
                            {/* Icon */}
                            <div className="w-14 h-14 rounded-2xl bg-[#6A3FF4]/15 dark:bg-[#6A3FF4]/20 flex items-center justify-center">
                                <i className="ph-bold ph-shield-warning text-3xl text-[#6A3FF4]"></i>
                            </div>

                            <div>
                                <h2
                                    id="session-ended-title"
                                    className="text-black dark:text-white text-xl font-bold mb-1.5"
                                >
                                    {title}
                                </h2>
                                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                                    {message}
                                </p>
                            </div>

                            <button
                                type="button"
                                autoFocus
                                onClick={clearAuthAndGo}
                                className="w-full mt-2 py-3 px-5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-95 transition-opacity shadow-lg shadow-purple-500/30 flex items-center justify-center gap-2"
                            >
                                <i className="ph-bold ph-sign-in"></i>
                                Sign in again
                            </button>

                            <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                Press Esc or Enter
                            </p>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SessionEndedOverlay;
