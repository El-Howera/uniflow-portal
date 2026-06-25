/**
 * GlassDateTimePicker
 *
 * Glass-morphism date+time picker matching the visual language of
 * GlassDropdown / the rest of the design system. Built around the native
 * date and time controls (we don't ship a custom calendar grid), but
 * wrapped in a glass popover so the trigger and surrounding controls
 * blend with every other admin/staff form on the project.
 *
 * Why this exists: the bare `<input type="datetime-local">` looks
 * out-of-place on a glass page — its rendered chrome is browser-default
 * white-on-system, and the design-system rule explicitly bans native
 * <select> for the same reason. This component is the date/time analog.
 *
 * Value contract: ISO-style local date+time string `YYYY-MM-DDTHH:MM`,
 * exactly what `<input type="datetime-local">` produces / consumes. So
 * you can drop this in wherever you previously used that input and it
 * just works.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  /** ISO-local string `YYYY-MM-DDTHH:MM` (or empty when unset). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Open direction. 'auto' flips above when there isn't space below. */
  direction?: 'auto' | 'up' | 'down';
  /** Lower-bound for selectable date+time (YYYY-MM-DDTHH:MM, local). */
  min?: string;
}

const splitValue = (v: string): { date: string; time: string } => {
  if (!v) return { date: '', time: '' };
  const [d, t] = v.split('T');
  return { date: d ?? '', time: (t ?? '').slice(0, 5) };
};

const join = (date: string, time: string): string => {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
};

/**
 * Format the picker's `YYYY-MM-DDTHH:MM` value for display, parsing the
 * components ourselves so the result is the same on every runtime.
 * Some browsers / Node builds disagree on whether a no-tz literal is
 * local or UTC; using the numeric Date constructor pins the meaning to
 * "local wall-clock time" deterministically, matching what the user typed.
 */
const formatDisplay = (v: string): string => {
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  let d: Date;
  if (m) {
    const [, y, mo, dd, h, mi, s] = m;
    d = new Date(
      Number(y),
      Number(mo) - 1,
      Number(dd),
      Number(h),
      Number(mi),
      s ? Number(s) : 0,
      0,
    );
  } else {
    d = new Date(v);
  }
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Pads a number to a 2-digit string. Used to format the local time as the
 * `YYYY-MM-DDTHH:MM` contract this picker speaks.
 */
const pad2 = (n: number): string => n.toString().padStart(2, '0');

const localNowString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const GlassDateTimePicker: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'Pick a date & time',
  className = '',
  direction = 'auto',
  min,
}) => {
  const { date, time } = splitValue(value);
  const [isOpen, setIsOpen] = useState(false);
  // Position computed from the trigger's getBoundingClientRect on every
  // open. Rendered via portal so the popover escapes ancestor stacking
  // contexts (backdrop-blur'd cards, animated motion divs) that were
  // previously eating it.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const recomputePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPOVER_HEIGHT = 320;
    const POPOVER_MIN_WIDTH = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp =
      direction === 'up' ||
      (direction === 'auto' && spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow);
    const top = flipUp ? rect.top - POPOVER_HEIGHT - 8 : rect.bottom + 8;
    const width = Math.max(rect.width, POPOVER_MIN_WIDTH);
    // Keep the popover inside the viewport horizontally.
    const maxLeft = window.innerWidth - width - 8;
    const left = Math.min(Math.max(rect.left, 8), Math.max(8, maxLeft));
    setPos({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    recomputePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Reposition on scroll / resize so the popover follows the trigger.
  useEffect(() => {
    if (!isOpen) return;
    const onWindowChange = () => recomputePosition();
    window.addEventListener('scroll', onWindowChange, true);
    window.addEventListener('resize', onWindowChange);
    return () => {
      window.removeEventListener('scroll', onWindowChange, true);
      window.removeEventListener('resize', onWindowChange);
    };
    // recomputePosition is defined in component body and reads refs;
    // it's safe to omit since the listeners always read the latest closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Close on outside click. Listen on mousedown so a click that lands on
  // the trigger toggles cleanly (mousedown fires before the click handler
  // on the trigger button).
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (popoverRef.current?.contains(tgt)) return;
      if (triggerRef.current?.contains(tgt)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const triggerStyle = `w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/50 rounded-xl px-3 py-2 text-sm text-left text-black dark:text-white transition-colors focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl flex items-center justify-between gap-2`;
  const inputStyle = `w-full bg-white/10 dark:bg-black/30 border border-white/20 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] transition-colors [color-scheme:dark]`;

  // Quick-pick presets — common offsets the staff would otherwise tap
  // through manually. Stops the picker from being a date-then-time grind.
  const quickPresets: { label: string; offsetMin: number }[] = [
    { label: 'In 15m', offsetMin: 15 },
    { label: 'In 1h', offsetMin: 60 },
    { label: 'Tomorrow 9am', offsetMin: -1 }, // sentinel — handled below
  ];

  const applyPreset = (offsetMin: number) => {
    const d = new Date();
    if (offsetMin === -1) {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
    } else {
      d.setMinutes(d.getMinutes() + offsetMin, 0, 0);
    }
    onChange(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  };

  // Min boundary — defaults to "now" so the staff can't accidentally
  // schedule a quiz in the past. Caller can override via the `min` prop.
  const effectiveMin = min ?? localNowString();
  const inputDateMin = effectiveMin.split('T')[0];

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={triggerStyle}
      >
        <span className="flex items-center gap-2 min-w-0">
          <i className="ph-bold ph-calendar-blank text-[#6A3FF4] flex-shrink-0"></i>
          <span className={value ? '' : 'text-gray-500 dark:text-gray-400'}>
            {value ? formatDisplay(value) : placeholder}
          </span>
        </span>
        <i
          className={`ph-bold ph-caret-down text-gray-500 transition-transform duration-150 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        ></i>
      </button>

      {isOpen && pos && createPortal(
        <AnimatePresence>
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: pos.width,
              zIndex: 9999,
            }}
            className="bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/40 backdrop-blur-2xl p-4 space-y-3"
          >
            <div className="flex flex-wrap gap-1.5">
              {quickPresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.offsetMin)}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#6A3FF4]/10 hover:bg-[#6A3FF4]/20 text-[#6A3FF4] border border-[#6A3FF4]/20 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  min={inputDateMin}
                  onChange={(e) => onChange(join(e.target.value, time))}
                  className={inputStyle}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                  Time
                </label>
                <input
                  type="time"
                  value={time || '00:00'}
                  onChange={(e) => onChange(join(date, e.target.value))}
                  className={inputStyle}
                />
              </div>
            </div>

            {value && (
              <div className="text-[11px] text-gray-500 dark:text-gray-400 bg-white/5 dark:bg-black/20 border border-white/10 rounded-lg px-2.5 py-1.5">
                <i className="ph-bold ph-info text-[#6A3FF4] mr-1"></i>
                Will save as <span className="font-mono text-black dark:text-white">{formatDisplay(value)}</span>
                {' '}({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </div>
            )}

            <div className="flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className="text-[11px] font-bold text-gray-500 hover:text-red-400 transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[11px] font-bold bg-[#6A3FF4] text-white px-4 py-1.5 rounded-lg hover:bg-[#5A32D4] transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default GlassDateTimePicker;
