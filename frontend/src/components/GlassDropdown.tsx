import React, { useState, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DropdownOption {
    value: string;
    label: string;
    icon?: string;
}

interface GlassDropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: DropdownOption[];
    className?: string;          // Additional classes for the button container
    dropdownClassName?: string;  // Additional classes for the dropdown list
    icon?: string;               // Icon for the trigger button itself if needed
    /**
     * Open direction. 'auto' (default) measures the trigger's viewport position
     * on each open and flips upward if there isn't enough space below — so
     * pickers near the bottom of the page don't get clipped or push the page.
     * Pass 'up' / 'down' to force.
     */
    direction?: 'auto' | 'up' | 'down';
    maxHeightPx?: number;        // List max height (default 240)
    /**
     * Compact mode — removes the default `min-w-[180px]` on the trigger
     * button and `min-w-[200px]` on the dropdown menu. Use when the
     * dropdown shows short values (single digit / letter) and the parent
     * is sizing it narrower via the className prop (e.g. `w-16`).
     * Without this, the trigger ignores any width < 180px from className
     * because of the hardcoded min-w.
     */
    compact?: boolean;
}

export const GlassDropdown: React.FC<GlassDropdownProps> = ({
    value,
    onChange,
    options,
    className = "",
    dropdownClassName = "",
    direction = 'auto',
    maxHeightPx = 240,
    compact = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [openUp, setOpenUp] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);

    // On open (or window resize while open), measure space below the trigger.
    // If less than maxHeightPx fits below, flip the menu upward. 'up'/'down'
    // force the choice without measuring.
    useLayoutEffect(() => {
        if (!isOpen) return;
        if (direction === 'up') { setOpenUp(true); return; }
        if (direction === 'down') { setOpenUp(false); return; }

        const decide = () => {
            const el = triggerRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            // Need maxHeight + a little gap. If neither side has room, prefer
            // the larger gap.
            if (spaceBelow >= maxHeightPx + 16) setOpenUp(false);
            else if (spaceAbove >= maxHeightPx + 16) setOpenUp(true);
            else setOpenUp(spaceAbove > spaceBelow);
        };
        decide();
        window.addEventListener('resize', decide);
        return () => window.removeEventListener('resize', decide);
    }, [isOpen, direction, maxHeightPx]);

    // Find selected option, or default to first one if not found.
    const selectedOption = options.find(opt => opt.value === value) || options[0] || { label: 'Select', value: '', icon: 'ph-list' };

    return (
        <div className={`relative ${className}`}>
            {/* Trigger Button */}
            <button
                ref={triggerRef}
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between w-full ${compact ? '' : 'min-w-[180px]'} bg-white/30 dark:bg-black/20 backdrop-blur-lg text-black dark:text-white border border-white/20 dark:border-white/10 rounded-xl py-2.5 px-4 shadow-lg cursor-pointer hover:bg-white/40 dark:hover:bg-black/30 transition-colors`}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    {selectedOption.icon && (
                        <i className={`ph-bold ${selectedOption.icon} text-[#6A3FF4]`}></i>
                    )}
                    <span className="font-medium truncate">{selectedOption.label}</span>
                </div>
                <i className={`ph-bold ph-caret-down text-gray-500 dark:text-gray-400 transition-transform flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`}></i>
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop to close dropdown - fixed screen overlay */}
                        <div
                            className="fixed inset-0 z-40"
                            onClick={() => setIsOpen(false)}
                        />

                        {/* Dropdown Options — placement flips based on direction */}
                        <motion.div
                            initial={{ opacity: 0, y: openUp ? 10 : -10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: openUp ? 10 : -10, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            style={{ maxHeight: `${maxHeightPx}px` }}
                            className={`absolute ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'} left-0 w-full ${compact ? '' : 'min-w-[200px]'} z-50 bg-white/70 dark:bg-black/70 backdrop-blur-xl border border-white/30 dark:border-white/10 rounded-xl shadow-2xl overflow-y-auto ${dropdownClassName}`}
                        >
                            {options.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors text-sm
                    ${value === option.value
                                            ? 'bg-[#6A3FF4]/20 text-[#6A3FF4]'
                                            : 'text-black dark:text-white hover:bg-[#6A3FF4]/10 hover:text-[#6A3FF4]'
                                        }`}
                                >
                                    {option.icon && <i className={`ph-bold ${option.icon} text-lg`}></i>}
                                    <span className="font-medium">{option.label}</span>
                                    {value === option.value && (
                                        <i className="ph-bold ph-check ml-auto text-[#6A3FF4]"></i>
                                    )}
                                </button>
                            ))}
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
