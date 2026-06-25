// GlassCheckbox — a styled checkbox that matches UniFlow's glass-morphism
// design language. Replaces the native <input type="checkbox"> wherever a
// list / form needs a toggleable selection (multi-selects, include flags,
// permission matrices). Same controlled-component contract as a checkbox
// input: `{checked, onChange}`.
//
// Implemented as a real <button role="checkbox"> for accessibility — screen
// readers announce the state, keyboard Space/Enter activates it. The native
// input is not used so we get full control over the visual.
//
// Plan 5 — tri-state variant:
//   pass `tristate` to render an indeterminate ("inherit") state alongside
//   true / false. The state is represented as `boolean | null` via
//   `triValue` / `onTriChange`. Click cycles inherit → grant → deny → inherit.

import React from 'react';

export interface GlassCheckboxProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    size?: 'sm' | 'md';
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
}

export const GlassCheckbox: React.FC<GlassCheckboxProps> = ({
    checked,
    onChange,
    size = 'md',
    disabled = false,
    className = '',
    ariaLabel,
}) => {
    const dim = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    const iconSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            // stopPropagation so wrapping <div onClick> rows can also bind
            // a toggle handler (clicking the box itself doesn't double-fire
            // the row's handler).
            onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onChange(!checked);
            }}
            className={`${dim} rounded-md border-2 transition-all duration-150 flex items-center justify-center flex-shrink-0 ${
                checked
                    ? 'bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] border-[#7B5AFF] shadow-md shadow-[#6A3FF4]/40'
                    : 'bg-white/5 dark:bg-black/20 border-white/20 dark:border-white/15 hover:border-[#6A3FF4]/60 hover:bg-white/10 dark:hover:bg-black/30'
            } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
        >
            {checked && <i className={`ph-bold ph-check text-white ${iconSize}`} />}
        </button>
    );
};

// ── Tri-state variant ──────────────────────────────────────────────────────
// Used by the per-user permission override matrix. Three states:
//   null  → inherit from role (dashed border, no fill, ph-minus icon)
//   true  → grant (purple fill, ph-check)
//   false → deny (red border + tint, ph-x)
//
// Click cycles: inherit → grant → deny → inherit. The cycle order matches
// the intuition that a brand-new override starts as "I want to grant this"
// and a second click flips it to deny.
export type TriValue = boolean | null;

export interface TriStateCheckboxProps {
    value: TriValue;
    onChange: (next: TriValue) => void;
    size?: 'sm' | 'md';
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
}

export const TriStateCheckbox: React.FC<TriStateCheckboxProps> = ({
    value,
    onChange,
    size = 'md',
    disabled = false,
    className = '',
    ariaLabel,
}) => {
    const dim = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    const iconSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

    const cycle = (cur: TriValue): TriValue => {
        if (cur === null) return true;
        if (cur === true) return false;
        return null;
    };

    let stateClass = '';
    let icon: React.ReactNode = null;
    if (value === true) {
        stateClass = 'bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] border-[#7B5AFF] shadow-md shadow-[#6A3FF4]/40';
        icon = <i className={`ph-bold ph-check text-white ${iconSize}`} />;
    } else if (value === false) {
        stateClass = 'bg-red-500/15 border-red-500/60 hover:bg-red-500/25';
        icon = <i className={`ph-bold ph-x text-red-300 ${iconSize}`} />;
    } else {
        // inherit — dashed border, no fill, neutral dash icon
        stateClass = 'bg-white/5 dark:bg-black/20 border-dashed border-white/30 dark:border-white/20 hover:border-[#6A3FF4]/60';
        icon = <i className={`ph-bold ph-minus text-gray-400 ${iconSize}`} />;
    }

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={value === true ? 'true' : value === false ? 'false' : 'mixed'}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onChange(cycle(value));
            }}
            className={`${dim} rounded-md border-2 transition-all duration-150 flex items-center justify-center flex-shrink-0 ${stateClass} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
        >
            {icon}
        </button>
    );
};

export default GlassCheckbox;
