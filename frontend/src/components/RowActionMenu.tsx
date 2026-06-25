/**
 * RowActionMenu — a 3-dots row-action dropdown that renders via a portal.
 *
 * Why a portal: table rows live inside cards with `overflow-hidden` and
 * `overflow-x-auto` wrappers. An absolutely-positioned dropdown gets clipped
 * by those ancestors — on the last row it's cut off and needs extra scrolling
 * to reach. Rendering the menu to `document.body` with `position: fixed`
 * escapes every overflow ancestor, and we flip the menu upward when there
 * isn't room below the trigger.
 *
 * Closes on outside click, scroll (capture), resize, and Escape.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RowAction {
  label: string;
  /** Phosphor icon class, e.g. 'ph-bold ph-pencil-simple'. */
  icon?: string;
  /** Tailwind text-color class for the icon. Defaults to brand purple (or red for danger). */
  iconColor?: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

interface RowActionMenuProps {
  items: RowAction[];
  ariaLabel?: string;
}

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 42;

export const RowActionMenu: React.FC<RowActionMenuProps> = ({ items, ariaLabel = 'Row actions' }) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean }>({
    top: 0,
    left: 0,
    openUp: false,
  });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visibleItems = items.filter((i) => !i.hidden);

  const reposition = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const estHeight = visibleItems.length * ITEM_HEIGHT + 8;
    const spaceBelow = window.innerHeight - r.bottom;
    // Flip up only if there isn't room below AND there is room above.
    const openUp = spaceBelow < estHeight + 12 && r.top > estHeight + 12;
    // Right-align the menu to the trigger, clamped to the viewport.
    const left = Math.min(
      Math.max(8, r.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    const top = openUp ? r.top - 6 : r.bottom + 6;
    setCoords({ top, left, openUp });
  };

  useLayoutEffect(() => {
    if (open) reposition();
    // visibleItems length feeds the height estimate; reposition reads refs live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture scroll so scrolling ANY ancestor closes the menu (its fixed
    // position would otherwise detach from the moving trigger).
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-gray-500 hover:text-[#6A3FF4] dark:hover:text-white p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      >
        <i className="ph-bold ph-dots-three-vertical text-lg"></i>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords.openUp ? undefined : coords.top,
              bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              width: MENU_WIDTH,
            }}
            className="z-[500] py-1 rounded-xl bg-white dark:bg-[#1a1a2e] border border-black/10 dark:border-white/10 shadow-2xl ring-1 ring-black/5 dark:ring-white/5 overflow-hidden"
          >
            {visibleItems.map((item, i) => (
              <button
                key={i}
                role="menuitem"
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                  item.danger
                    ? 'text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 hover:text-black dark:hover:text-white'
                }`}
              >
                {item.icon && (
                  <i
                    className={`${item.icon} ${
                      item.iconColor || (item.danger ? 'text-red-500' : 'text-[#7B5AFF]')
                    }`}
                  ></i>
                )}
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

export default RowActionMenu;
