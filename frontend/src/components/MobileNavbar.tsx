// src/components/MobileNavbar.tsx
//
// Plan 9 mobile pass — floating rounded bottom bar with a sliding bubble
// that follows the active tab. Replaces the flat 5-tab strip from Plan 8
// Phase 5.
//
// Design:
//   - Floats above the safe-area inset (env(safe-area-inset-bottom)).
//     `bottom-2 safe-bottom` gives the bar a real gap from the home indicator.
//   - Pill shape (rounded-full) with glass blur + soft shadow.
//   - Active tab is highlighted by an absolutely-positioned bubble that
//     animates between positions via Framer Motion `layoutId` — same trick
//     the LiveKit toolbar uses to slide its active highlight.
//   - Active icon stays purple text; inactive icons are dim gray.
//   - Per-role tab map (default 5 tabs each).
//   - Labels are still rendered (so users always know what each tab does),
//     but they're tiny (text-[10px]) and the bubble underline highlights
//     just the icon — keeps the bar compact on narrow screens.
//   - Hidden on routes that opt out via routeMeta (chatroom, live session).

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import { useNotifications } from '../context/NotificationContext';
import { useTr } from '../i18n';
import { resolveRouteFlags } from '../data/routeMeta';

interface Tab {
    label: string;
    icon: string;
    path: string;
    /** Badge key — read from a small per-role badge map below. Optional. */
    badge?: 'chat' | 'notif';
}

// Per-role tab set. Each role gets the 5 most-trafficked surfaces.
function tabsForRole(role: string): Tab[] {
    switch (role) {
        case 'professor':
            return [
                { label: 'Home', icon: 'ph-house', path: '/professor/dashboard' },
                { label: 'Courses', icon: 'ph-book-bookmark', path: '/professor/course-overview' },
                { label: 'Grading', icon: 'ph-clipboard-text', path: '/professor/grading' },
                { label: 'Chat', icon: 'ph-chat-circle-dots', path: '/professor/chatroom', badge: 'chat' },
                { label: 'Alerts', icon: 'ph-bell', path: '/professor/notifications', badge: 'notif' },
            ];
        case 'ta':
            return [
                { label: 'Home', icon: 'ph-house', path: '/ta/dashboard' },
                { label: 'Courses', icon: 'ph-book-bookmark', path: '/ta/courses' },
                { label: 'Grading', icon: 'ph-checks', path: '/ta/gradebook' },
                { label: 'Chat', icon: 'ph-chat-circle-dots', path: '/ta/chatroom', badge: 'chat' },
                { label: 'Alerts', icon: 'ph-bell', path: '/ta/notifications', badge: 'notif' },
            ];
        case 'sa':
            return [
                { label: 'Home', icon: 'ph-house', path: '/sa/dashboard' },
                { label: 'Students', icon: 'ph-users', path: '/sa/student-profiles' },
                { label: 'Cases', icon: 'ph-briefcase', path: '/sa/requests' },
                { label: 'Notices', icon: 'ph-megaphone', path: '/sa/announcements' },
                { label: 'Alerts', icon: 'ph-bell', path: '/sa/notifications', badge: 'notif' },
            ];
        case 'admin':
            return [
                { label: 'Home', icon: 'ph-house', path: '/admin/dashboard' },
                { label: 'Users', icon: 'ph-users-three', path: '/admin/user-management' },
                { label: 'Courses', icon: 'ph-book-bookmark', path: '/admin/manage-courses' },
                { label: 'Audit', icon: 'ph-file-magnifying-glass', path: '/admin/audit-logs' },
                { label: 'Alerts', icon: 'ph-bell', path: '/admin/notifications', badge: 'notif' },
            ];
        case 'financial':
            return [
                { label: 'Home', icon: 'ph-house', path: '/financial/dashboard' },
                { label: 'Revenue', icon: 'ph-chart-line', path: '/financial/revenue-overview' },
                { label: 'Fees', icon: 'ph-credit-card', path: '/financial/fee-management' },
                { label: 'Aid', icon: 'ph-hand-coins', path: '/financial/financial-aid' },
                { label: 'Alerts', icon: 'ph-bell', path: '/financial/notifications', badge: 'notif' },
            ];
        case 'it':
            return [
                { label: 'Home', icon: 'ph-house', path: '/it/dashboard' },
                { label: 'Health', icon: 'ph-thermometer', path: '/it/system-health' },
                { label: 'Audit', icon: 'ph-file-magnifying-glass', path: '/it/audit-logs' },
                { label: 'Locks', icon: 'ph-lock', path: '/it/signin-locks' },
                { label: 'Alerts', icon: 'ph-bell', path: '/it/notifications', badge: 'notif' },
            ];
        case 'student':
        default:
            return [
                { label: 'Home', icon: 'ph-house', path: '/student/dashboard' },
                { label: 'Courses', icon: 'ph-book-bookmark', path: '/student/courses' },
                { label: 'Schedule', icon: 'ph-calendar-blank', path: '/student/timetable' },
                { label: 'Chat', icon: 'ph-chat-circle-dots', path: '/student/chatroom', badge: 'chat' },
                { label: 'Alerts', icon: 'ph-bell', path: '/student/notifications', badge: 'notif' },
            ];
    }
}

const MobileNavbar: React.FC = () => {
    const { userRole, animationsEnabled } = useAppContext();
    const { unreadCount } = useNotifications();
    const location = useLocation();
    const navigate = useNavigate();
    const tr = useTr();

    const { hideMobileNav } = resolveRouteFlags(location.pathname);
    if (hideMobileNav) return null;

    const tabs = tabsForRole(userRole);
    const badgeForKey = (key?: 'chat' | 'notif'): number => {
        if (!key) return 0;
        return unreadCount;
    };

    // Find which tab matches the current path (most specific prefix wins).
    let activeIdx = -1;
    let activeLen = -1;
    tabs.forEach((tab, idx) => {
        if (location.pathname.startsWith(tab.path) && tab.path.length > activeLen) {
            activeIdx = idx;
            activeLen = tab.path.length;
        }
    });

    return (
        // Outer wrapper — handles the safe-area inset; the inner pill sits
        // above the bottom edge with a small visual gap.
        // `uniflow-mobile-nav` class is the CSS hook focused-mode pages
        // (e.g. quiz taking view) use to hide the bar without coordinating
        // React state — they toggle `html.uniflow-no-mobile-nav` and the
        // matching rule in `index.css` flips display:none.
        // Bottom positioning — `safe-bottom` adds env(safe-area-inset-bottom)
        // so the bar floats above the iOS home indicator (≈34 px on iPhone
        // 14 Pro). Inner `pb-1` (4 px) provides a small visual breathing
        // gap so the bar isn't sitting right on the safe-area boundary.
        // Total clearance from the physical screen bottom: ~38 px.
        // `touch-none` (touch-action: none) on the outer wrapper stops any
        // touch-drag on the bubble bar from initiating a document-level
        // scroll on iOS WebView. Combined with html/body { overflow: hidden }
        // it guarantees the only scroll surface is <main>.
        <div className="uniflow-mobile-nav fixed inset-x-0 bottom-0 z-50 pointer-events-none safe-bottom safe-left safe-right touch-none">
            <div className="px-4 pb-1 flex justify-center pointer-events-none">
                <nav
                    aria-label="Primary"
                    className="pointer-events-auto relative w-full max-w-md bg-white/85 dark:bg-black/70 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-full shadow-[0_10px_30px_rgba(106,63,244,0.25)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
                >
                    <ul className="relative flex items-stretch justify-around px-1 py-1.5">
                        {tabs.map((tab, idx) => {
                            const isActive = idx === activeIdx;
                            const badge = badgeForKey(tab.badge);

                            return (
                                <li key={tab.label} className="relative flex-1 flex justify-center">
                                    <button
                                        onClick={() => navigate(tab.path)}
                                        aria-label={tr(tab.label)}
                                        aria-current={isActive ? 'page' : undefined}
                                        className="relative w-full h-12 flex flex-col items-center justify-center rounded-full transition-colors duration-200 select-none active:scale-95"
                                    >
                                        {/* The animated bubble — a single element that slides
                                            between tabs via Framer Motion layoutId. The bubble
                                            sits BEHIND the icon so the icon stays crisp.
                                            Skip the layout animation entirely when reduce-motion
                                            is on (we still render it for active state, but it
                                            transitions instantly). */}
                                        {isActive && (
                                            <motion.span
                                                layoutId="uniflow-mobile-tab-bubble"
                                                className="absolute inset-0 -z-10 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] shadow-[0_8px_18px_rgba(106,63,244,0.45)]"
                                                transition={
                                                    animationsEnabled
                                                        ? { type: 'spring', stiffness: 380, damping: 30 }
                                                        : { duration: 0 }
                                                }
                                            />
                                        )}

                                        <span className="relative">
                                            <i
                                                className={`ph-fill ${tab.icon} text-[20px] transition-transform duration-200 ${
                                                    isActive
                                                        ? 'text-white scale-110'
                                                        : 'text-gray-500 dark:text-gray-400'
                                                }`}
                                            />
                                            {badge > 0 && (
                                                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold px-1 ring-2 ring-white/85 dark:ring-black/70">
                                                    {badge > 9 ? '9+' : badge}
                                                </span>
                                            )}
                                        </span>

                                        <span
                                            className={`text-[10px] font-semibold mt-0.5 leading-tight transition-colors ${
                                                isActive ? 'text-white' : 'text-gray-500 dark:text-gray-400'
                                            }`}
                                        >
                                            {tr(tab.label)}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </div>
        </div>
    );
};

export default MobileNavbar;
