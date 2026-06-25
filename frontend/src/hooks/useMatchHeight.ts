import { useEffect, useRef, useState } from 'react';

/**
 * Observes the height of a referenced element and returns it in pixels.
 * Useful when a sibling card needs to dynamically match this element's height
 * (e.g. capping a scrollable list to the height of an adjacent card).
 *
 * Usage:
 *   const [sourceRef, height] = useMatchHeight();
 *   ...
 *   <div ref={sourceRef}><CourseSummaryCard /></div>
 *   <AttendanceHistoryTable matchHeight={height} />
 */
export function useMatchHeight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setHeight(Math.round(entry.contentRect.height));
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  return [ref, height] as const;
}
