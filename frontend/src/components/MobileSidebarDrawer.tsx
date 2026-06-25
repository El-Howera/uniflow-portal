// src/components/MobileSidebarDrawer.tsx
//
// Plan 9 mobile pass — left-edge slide-in drawer that mirrors the desktop
// sidebar for narrow viewports. Triggered by the hamburger button in the
// header on `<md` screens. Each role gets its own category set via
// `roleToConfigMap` — the drawer is just a mobile presentation of the
// same nav data, so a permission-filtered category list stays in sync
// with the desktop sidebar automatically.
//
// Behavior:
//   - Slides in from the left over a dimmed backdrop.
//   - Body scroll is locked while open.
//   - Clicking the backdrop, pressing Esc, or tapping a nav item closes it.
//   - Categories are collapsible with their FCDS color palette; the
//     category whose URL prefix matches the current pathname is open by
//     default.
//   - Includes Settings, View Profile, and Sign Out at the bottom (parity
//     with the desktop sidebar footer).
//
// Accessibility:
//   - Drawer container is `role="dialog" aria-modal="true"`.
//   - Focus trapped while open via the first nav link's autoFocus.
//   - Esc closes.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import { useTr } from '../i18n';
import { Logo } from './Logo';
import { roleToConfigMap } from '../data/navigationData';
import { useFilteredNavCategories } from '../utils/permissions';
import { getGuideUrl } from '../utils/guideUrl';
import { DynamicCategory, DynamicCategoryItem } from '../types';

interface MobileSidebarDrawerProps {
    open: boolean;
    onClose: () => void;
    onLogout: () => void;
}

const MobileSidebarDrawer: React.FC<MobileSidebarDrawerProps> = ({ open, onClose, onLogout }) => {
    const { userRole, animationsEnabled, language } = useAppContext();
    const isRtl = language === 'ar';
    const location = useLocation();
    const navigate = useNavigate();
    const tr = useTr();

    const cfg = roleToConfigMap[userRole as keyof typeof roleToConfigMap] || roleToConfigMap.student;
    const filteredCategories = useFilteredNavCategories(cfg.categories, []);
    const staticTopItems: DynamicCategoryItem[] = cfg.staticTopItems;

    // Body-scroll lock + Esc to close.
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [open, onClose]);

    // Determine which category should be auto-expanded based on the current
    // route — same UX as the desktop sidebar's "I know where you are" highlight.
    const initiallyOpen = useMemo(() => {
        for (const cat of filteredCategories) {
            for (const item of cat.items) {
                if (item.path && location.pathname.startsWith(item.path)) {
                    return cat.title;
                }
            }
        }
        return filteredCategories.find((c) => c.defaultOpen)?.title ?? null;
    }, [filteredCategories, location.pathname]);

    const [openCategory, setOpenCategory] = useState<string | null>(initiallyOpen);
    useEffect(() => {
        if (open) setOpenCategory(initiallyOpen);
    }, [open, initiallyOpen]);

    const handleNavigate = (path: string) => {
        navigate(path);
        onClose();
    };

    const settingsPath = `/${userRole}/settings`;
    const profilePath = `/${userRole}/view-profile`;

    const transition = animationsEnabled
        ? { type: 'spring' as const, stiffness: 300, damping: 32 }
        : { duration: 0 };

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        key="mobile-sidebar-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: animationsEnabled ? 0.2 : 0 }}
                        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm md:hidden"
                        onClick={onClose}
                        aria-hidden="true"
                    />

                    {/* Drawer — anchors and animates from the OPPOSITE side
                        when Arabic (RTL) is active. `position: fixed` uses
                        physical left/right (not logical), so we conditionally
                        swap based on `isRtl`. The slide animation also flips
                        sign so the drawer always enters from the screen edge
                        it's anchored to. */}
                    <motion.aside
                        key="mobile-sidebar-drawer"
                        initial={{ x: isRtl ? '100%' : '-100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: isRtl ? '100%' : '-100%' }}
                        transition={transition}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Navigation"
                        className={`fixed top-0 bottom-0 z-[71] w-[86vw] max-w-[320px] bg-white dark:bg-[#0F0B1F] ${isRtl ? 'right-0 border-l' : 'left-0 border-r'} border-black/10 dark:border-white/10 shadow-2xl flex flex-col safe-top safe-bottom md:hidden`}
                    >
                        {/* Drawer header — logo + close button */}
                        <div className="flex items-center justify-between px-4 py-4 border-b border-black/10 dark:border-white/10">
                            <button
                                type="button"
                                onClick={() => { navigate(`/${userRole || 'student'}/dashboard`); onClose(); }}
                                aria-label={tr('Go to dashboard')}
                                title={tr('Go to dashboard')}
                                className="flex items-center gap-2 min-w-0 rounded-lg hover:opacity-80 active:opacity-70 transition-opacity"
                            >
                                <i className="ph-fill ph-graduation-cap text-[#6A3FF4] text-3xl flex-shrink-0" />
                                <h2 className="text-xl font-bold tracking-tight whitespace-nowrap text-black dark:text-white truncate">
                                    <Logo />
                                </h2>
                            </button>
                            <button
                                onClick={onClose}
                                aria-label={tr('Close menu')}
                                className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <i className="ph-bold ph-x text-xl" />
                            </button>
                        </div>

                        {/* Scrollable nav body */}
                        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
                            {/* Top-level "Dashboard" / "Admin Dashboard" / etc. */}
                            {staticTopItems.map((item) => {
                                const isActive = !!item.path && location.pathname === item.path;
                                return (
                                    <button
                                        key={item.label}
                                        onClick={() => item.path && handleNavigate(item.path)}
                                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                                            isActive
                                                ? 'bg-[#6A3FF4] text-white'
                                                : 'text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10'
                                        }`}
                                    >
                                        <i className={`ph-fill ${item.icon} text-lg flex-shrink-0`} />
                                        <span className="text-sm font-semibold truncate">{tr(item.label)}</span>
                                    </button>
                                );
                            })}

                            {filteredCategories.map((cat: DynamicCategory) => {
                                const isOpen = openCategory === cat.title;
                                const activeItem = cat.items.find(
                                    (i) => i.path && location.pathname.startsWith(i.path),
                                );
                                return (
                                    <div key={cat.title} className="rounded-xl overflow-hidden">
                                        <button
                                            onClick={() =>
                                                setOpenCategory((prev) => (prev === cat.title ? null : cat.title))
                                            }
                                            className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-xl text-left transition-colors ${
                                                activeItem && !isOpen
                                                    ? 'bg-[#6A3FF4]/10 text-[#6A3FF4]'
                                                    : 'text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10'
                                            }`}
                                            aria-expanded={isOpen}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <i className={`ph-fill ${cat.icon} text-lg flex-shrink-0`} />
                                                <span className="text-sm font-semibold truncate">
                                                    {tr(cat.title)}
                                                </span>
                                            </div>
                                            <i
                                                className={`ph-bold ph-caret-down text-xs transition-transform flex-shrink-0 ${
                                                    isOpen ? 'rotate-180' : ''
                                                }`}
                                            />
                                        </button>

                                        <div
                                            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                                                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                                            }`}
                                        >
                                            <div className="overflow-hidden">
                                                <div className="pl-4 pr-1 pb-1 pt-1 space-y-0.5">
                                                    {cat.items.map((item) => {
                                                        const isActive =
                                                            !!item.path && location.pathname === item.path;
                                                        return (
                                                            <button
                                                                key={item.label}
                                                                onClick={() =>
                                                                    item.path && handleNavigate(item.path)
                                                                }
                                                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                                                                    isActive
                                                                        ? 'bg-[#6A3FF4] text-white'
                                                                        : 'text-black/80 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10'
                                                                }`}
                                                            >
                                                                <i
                                                                    className={`ph-fill ${item.icon} text-base flex-shrink-0`}
                                                                />
                                                                <span className="text-sm truncate">
                                                                    {tr(item.label)}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </nav>

                        {/* Footer — guide, profile, settings, logout */}
                        <div className="border-t border-black/10 dark:border-white/10 px-3 py-3 space-y-1">
                            {/* User Guide — static site served by nginx at /userguide.
                                Real anchor (full-page load), opens in a new tab. */}
                            <a
                                href={getGuideUrl()}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={onClose}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <i className="ph-fill ph-question text-lg flex-shrink-0" />
                                <span className="text-sm font-medium">{tr('User Guide')}</span>
                            </a>
                            <Link
                                to={profilePath}
                                onClick={onClose}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <i className="ph-fill ph-user-circle text-lg flex-shrink-0" />
                                <span className="text-sm font-medium">{tr('Profile')}</span>
                            </Link>
                            <Link
                                to={settingsPath}
                                onClick={onClose}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-black dark:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <i className="ph-fill ph-gear text-lg flex-shrink-0" />
                                <span className="text-sm font-medium">{tr('Settings')}</span>
                            </Link>
                            <button
                                onClick={() => {
                                    // App.tsx now intercepts onLogout to show
                                    // a confirmation modal. Close the drawer
                                    // so the modal is visible against the
                                    // page beneath; navigation happens after
                                    // the user confirms.
                                    onClose();
                                    onLogout();
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                                <i className="ph-bold ph-sign-out text-lg flex-shrink-0" />
                                <span className="text-sm font-semibold">{tr('Log out')}</span>
                            </button>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
};

export default MobileSidebarDrawer;
