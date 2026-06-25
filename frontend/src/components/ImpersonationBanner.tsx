// Plan 5 Phase 6 — sticky red banner shown at the top of every page when
// the admin is in a view-as session. Reads impersonation state from
// AppContext (decoded from the JWT). "Exit" calls AppContext.exitImpersonation
// which restores the pre-impersonation token + hard-redirects to the admin
// home so route guards don't bounce us through a half-loaded student page.

import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';

const formatRemaining = (ms: number): string => {
    if (ms <= 0) return 'expired';
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const ImpersonationBanner: React.FC = () => {
    const { impersonation, exitImpersonation } = useAppContext();
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!impersonation?.expiresAt) return;
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, [impersonation?.expiresAt]);

    if (!impersonation) return null;

    const remaining = impersonation.expiresAt ? impersonation.expiresAt - now : null;

    return (
        <div
            role="alert"
            // top-0 + z-[100] on purpose: in the Electron build, index.css's
            // `html.is-electron .fixed.top-0.z-\[100\]` rule offsets this exactly
            // one title-bar height (32px) down so it sits flush beneath the bar.
            // (Using top-8 here instead would get caught by the sidebar's
            // `.fixed.top-8` rule and pushed an extra 16px → a visible gap.)
            // On web/PWA there's no is-electron class, so it stays flush at top.
            className="fixed top-0 inset-x-0 z-[100] bg-red-600/95 backdrop-blur border-b border-red-400 text-white shadow-lg"
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-sm">
                <i className="ph-bold ph-eye text-base flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <span className="font-semibold">View-as session</span>
                    <span className="opacity-90"> — you are viewing as </span>
                    <span className="font-medium">{impersonation.targetEmail || impersonation.targetUserId}</span>
                    <span className="opacity-90"> ({impersonation.targetRole}). Writes are blocked.</span>
                </div>
                {remaining !== null && (
                    <span className="hidden sm:inline-block text-xs font-mono bg-white/15 px-2 py-0.5 rounded">
                        {remaining > 0 ? formatRemaining(remaining) + ' left' : 'expired'}
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => { void exitImpersonation(); }}
                    className="bg-white text-red-700 hover:bg-red-50 transition-colors px-3 py-1 rounded-md font-semibold text-xs shadow-sm flex items-center gap-1.5 flex-shrink-0"
                >
                    <i className="ph-bold ph-sign-out" /> Exit
                </button>
            </div>
        </div>
    );
};

export default ImpersonationBanner;
