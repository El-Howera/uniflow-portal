/**
 * LightModeBackground
 * ------------------------------------------------------------------
 * Soft animated gradient-blob background for light mode.
 *
 * The Aurora component (WebGL) uses additive blending + intensity-multiplied
 * color stops which, on a white canvas, produce a muddy gray-purple cast no
 * matter how pale the stops are. Aurora is great in dark mode (where the
 * darkening helps it read as plasma glow against black); for light mode it
 * doesn't work.
 *
 * Instead, this component renders four large soft-edged radial gradients
 * positioned at the corners and animated with slow drift. The 4 blob colors
 * come from `BrandContext.light.backgroundColors` so the admin Brand tab
 * can re-skin the atmosphere live without touching this file.
 */
import React from 'react';
import { useBrand } from '../context/BrandContext';

// Convert a #RGB / #RRGGBB hex to an `rgba(r, g, b, a)` string. We keep the
// original per-blob alpha so admins changing only the color don't lose the
// pre-tuned opacity blend that makes the page read as glass.
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LightModeBackground: React.FC = () => {
  const brand = useBrand();
  // Pad with the defaults if the admin saved fewer than 4 entries — every
  // blob always has a color to render.
  const fallback = ['#A78BFA', '#F472B6', '#7DD3FC', '#C4B5FD'];
  const [c1, c2, c3, c4] = [0, 1, 2, 3].map(
    (i) => brand.light.backgroundColors[i] ?? fallback[i]
  );

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
      {/* Base white canvas — actual color is driven by `--canvas-bg` on
         body via BrandContext; this layer just lets the body color through. */}
      <div className="absolute inset-0" />

      {/* Four large soft blobs — heavily-blurred radial gradients positioned
         at viewport corners. Each carries its original tuned alpha so the
         visual weight stays consistent when colors change. */}
      <div
        className="absolute -top-32 -left-32 w-[60vw] h-[60vw] rounded-full opacity-70 animate-blob-drift-1"
        style={{
          background: `radial-gradient(circle, ${hexToRgba(c1, 0.55)} 0%, ${hexToRgba(c1, 0)} 60%)`,
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute -top-24 -right-32 w-[55vw] h-[55vw] rounded-full opacity-60 animate-blob-drift-2"
        style={{
          background: `radial-gradient(circle, ${hexToRgba(c2, 0.40)} 0%, ${hexToRgba(c2, 0)} 60%)`,
          filter: 'blur(50px)',
        }}
      />
      <div
        className="absolute -bottom-40 -left-20 w-[65vw] h-[65vw] rounded-full opacity-65 animate-blob-drift-3"
        style={{
          background: `radial-gradient(circle, ${hexToRgba(c3, 0.45)} 0%, ${hexToRgba(c3, 0)} 60%)`,
          filter: 'blur(45px)',
        }}
      />
      <div
        className="absolute -bottom-32 -right-32 w-[60vw] h-[60vw] rounded-full opacity-70 animate-blob-drift-4"
        style={{
          background: `radial-gradient(circle, ${hexToRgba(c4, 0.50)} 0%, ${hexToRgba(c4, 0)} 60%)`,
          filter: 'blur(40px)',
        }}
      />

      {/* Center wash — uses the first blob color at very low alpha so the
         middle of the screen doesn't go flat-white when a card sits over it. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 40%, ${hexToRgba(c1, 0.06)} 0%, transparent 60%)`,
        }}
      />
    </div>
  );
};

export default LightModeBackground;
