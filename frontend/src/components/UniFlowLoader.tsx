/* ════════════════════════════════════════════════════════════════════
 * UniFlowLoader
 * --------------------------------------------------------------------
 * Scan-bar loader with a falling graduation cap and a worm progress
 * indicator. Ported from the standalone HTML loader designed in Claude
 * Design. Drop-in replacement for the old PageLoader — same prop shape
 * (`inline`, `message`), so all existing call-sites work unchanged.
 *
 *   <AnimatePresence>
 *     {loading && <UniFlowLoader message="Starting UniFlow" />}
 *   </AnimatePresence>
 *
 * Light / dark mode is read from AppContext (the same toggle as the
 * rest of the app); each mode flips the `--uf-bg` / `--uf-fg` CSS
 * custom properties on the stage.
 * ════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import './UniFlowLoader.css';

interface UniFlowLoaderProps {
  /** Renders inline (block) instead of fixed full-screen overlay. */
  inline?: boolean;
  /** Status text rendered under the worm — ALL CAPS, letterspaced. */
  message?: string;
}

const UniFlowLoader: React.FC<UniFlowLoaderProps> = ({ inline = false, message }) => {
  const { isDarkMode } = useAppContext();

  const wordRef    = useRef<HTMLSpanElement>(null);
  const scanBarRef = useRef<HTMLDivElement>(null);
  const scanBlurRef = useRef<HTMLDivElement>(null);
  const gradCapRef  = useRef<SVGSVGElement>(null);

  /* ── one continuous 4-second cycle, driven by requestAnimationFrame ── */
  useEffect(() => {
    const SCAN_CYCLE_MS = 4000;
    const SCAN_LEFT_MIN = -36;
    const CAP_LEFT      = -28;
    const CAP_WIDTH     = 90;

    let scanRightMax = 80;
    let wordWidthMax = 60;

    const measureScanRange = () => {
      const wordEl = wordRef.current;
      if (!wordEl) return;
      const rect = wordEl.getBoundingClientRect();
      wordWidthMax = Math.max(60, Math.round(rect.width));
      scanRightMax = wordWidthMax + 8;
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // 4 passes per cycle: left→right→left→right→left
    const scanXAt = (cycleFrac: number): number => {
      const quarter = (cycleFrac * 4) % 4;
      const phase = quarter % 1;
      return Math.floor(quarter) % 2 === 0
        ? lerp(SCAN_LEFT_MIN, scanRightMax, phase)
        : lerp(scanRightMax, SCAN_LEFT_MIN, phase);
    };

    // Word clip-path tracks the bar — wipe-from-left, wipe-from-right,
    // then settle. Reproduces the Uiverse "cut" keyframes.
    const wordClipAt = (cycleFrac: number, barX: number): string => {
      if (cycleFrac < 0.25) {
        const pct = Math.max(0, Math.min(1, barX / wordWidthMax)) * 100;
        return `inset(0 0 0 ${pct.toFixed(2)}%)`;
      }
      if (cycleFrac < 0.5) {
        const t = (cycleFrac - 0.25) * 4;
        const left  = (1 - t) * 100;
        const right = t * 100;
        return `inset(0 ${right.toFixed(2)}% 0 ${left.toFixed(2)}%)`;
      }
      if (cycleFrac < 0.75) {
        const t = (cycleFrac - 0.5) * 4;
        const right = (1 - t) * 100;
        return `inset(0 ${right.toFixed(2)}% 0 0)`;
      }
      return 'inset(0 0 0 0)';
    };

    // Spring keyframes for the cap-drop — mirrors the framer-motion
    // spring of the original loader. Three eased segments.
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    type Key = { t: number; v: number };
    const multiKey = (t: number, keys: Key[]): number => {
      if (t <= keys[0].t) return keys[0].v;
      if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
      for (let i = 1; i < keys.length; i++) {
        if (t <= keys[i].t) {
          const a = keys[i - 1];
          const b = keys[i];
          const k = (t - a.t) / (b.t - a.t);
          return a.v + (b.v - a.v) * easeInOut(k);
        }
      }
      return keys[keys.length - 1].v;
    };

    const capFallY:     Key[] = [{ t: 0, v: -80 }, { t: 0.6, v: 8 },   { t: 0.78, v: -3 },    { t: 1, v: 0 }];
    const capFallRot:   Key[] = [{ t: 0, v: -15 }, { t: 0.6, v: 2 },   { t: 0.78, v: -1 },    { t: 1, v: 0 }];
    const capFallScale: Key[] = [{ t: 0, v: 1.2 }, { t: 0.6, v: 0.99 },{ t: 0.78, v: 1.005 }, { t: 1, v: 1 }];

    const capStateAt = (cycleFrac: number, barX: number) => {
      // 0.00-0.25: erase phase. Opacity tracks the scan bar's pixel
      // position through the cap area — keeps cap perfectly in sync with
      // the bar. clip-path is NOT animated (clip-path on SVG is CPU-bound
      // and was the source of the stutter).
      if (cycleFrac < 0.25) {
        const fadeStart = CAP_LEFT;             // bar reaches cap's left edge
        const fadeEnd   = CAP_LEFT + CAP_WIDTH; // bar reaches cap's right edge
        const fade = Math.max(0, Math.min(1, (barX - fadeStart) / (fadeEnd - fadeStart)));
        const opacity = 1 - fade;
        return {
          transform: 'translateY(0px) rotate(-15deg) scale(1) translateZ(0)',
          opacity: opacity.toFixed(3),
        };
      }
      // 0.25-0.45: cap parked above the frame, invisible
      if (cycleFrac < 0.45) {
        return {
          transform: 'translateY(-80px) rotate(-15deg) scale(1.2) translateZ(0)',
          opacity: '0',
        };
      }
      // 0.45-0.65: spring drop with overshoot + settle
      if (cycleFrac < 0.65) {
        const t = (cycleFrac - 0.45) / 0.2;
        const y = multiKey(t, capFallY);
        const rot = multiKey(t, capFallRot);
        const scale = multiKey(t, capFallScale);
        const opacity = Math.min(1, t * 8);
        return {
          transform: `translateY(${y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)}) translateZ(0)`,
          opacity: opacity.toFixed(3),
        };
      }
      // 0.65-0.75: rotate back to home tilt
      if (cycleFrac < 0.75) {
        const t = (cycleFrac - 0.65) / 0.1;
        const rot = -15 * (1 - Math.pow(1 - t, 2));
        return {
          transform: `translateY(0px) rotate(${rot.toFixed(2)}deg) scale(1) translateZ(0)`,
          opacity: '1',
        };
      }
      // 0.75-1.00: rest at home tilt
      return {
        transform: 'translateY(0px) rotate(-15deg) scale(1) translateZ(0)',
        opacity: '1',
      };
    };

    const startedAt = performance.now();
    let rafId = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const cycleFrac = (elapsed % SCAN_CYCLE_MS) / SCAN_CYCLE_MS;
      const barX = scanXAt(cycleFrac);

      if (scanBarRef.current)  scanBarRef.current.style.transform  = `translateX(${barX}px)`;
      if (scanBlurRef.current) scanBlurRef.current.style.transform = `translateX(${barX}px)`;
      if (wordRef.current)     wordRef.current.style.clipPath = wordClipAt(cycleFrac, barX);

      const cap = capStateAt(cycleFrac, barX);
      if (gradCapRef.current) {
        gradCapRef.current.style.transform = cap.transform;
        gradCapRef.current.style.opacity = cap.opacity;
      }

      rafId = requestAnimationFrame(tick);
    };

    measureScanRange();
    window.addEventListener('resize', measureScanRange);
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measureScanRange);
    };
  }, []);

  const stageClass = [
    'uf-loader-stage',
    isDarkMode ? '' : 'uf-light',
    inline
      ? 'relative w-full py-32 flex items-center justify-center'
      : 'fixed inset-0 z-[9999] flex items-center justify-center',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div
      className={stageClass}
      initial={{ opacity: 1 }}
      exit={{
        opacity: 0,
        filter: 'blur(8px)',
        transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
      }}
    >
      {/* Solid background only (var(--uf-bg) on .uf-loader-stage). The Aurora /
         LightModeBackground layer was removed: it (a) made this loader render
         the live WebGL Aurora behind it — inconsistent with the solid HTML boot
         splash — and (b) caused the transition jank. A solid overlay matches
         the boot splash and stays smooth. */}
      <div className="uf-loader-block">
        <div className="uf-loader">
          {/* graduation cap — falls in on each cycle */}
          <svg
            ref={gradCapRef}
            className="uf-grad-cap"
            viewBox="0 0 150 120"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="uf-cap-board" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#7B5AFF" />
                <stop offset="50%"  stopColor="#6A3FF4" />
                <stop offset="100%" stopColor="#5A2AD4" />
              </linearGradient>
              <linearGradient id="uf-cap-base" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#5A2AD4" />
                <stop offset="100%" stopColor="#3D1F8C" />
              </linearGradient>
              <radialGradient id="uf-tassel-bead" cx="35%" cy="30%" r="65%">
                <stop offset="0%"   stopColor="#B095FF" />
                <stop offset="55%"  stopColor="#6A3FF4" />
                <stop offset="100%" stopColor="#5A2AD4" />
              </radialGradient>
            </defs>
            <path d="M 38 56 L 112 56 L 102 76 L 48 76 Z" fill="url(#uf-cap-base)" />
            <ellipse cx="75" cy="56" rx="42" ry="3" fill="#3D1F8C" opacity="0.7" />
            <path d="M 18 48 L 132 48 L 142 60 L 8 60 Z" fill="url(#uf-cap-board)" />
            <path d="M 24 50 L 126 50 L 130 55 L 20 55 Z" fill="rgba(255,255,255,0.18)" />
            <path d="M 8 60 L 142 60 L 138 64 L 12 64 Z" fill="#5A2AD4" opacity="0.85" />
            <circle cx="75" cy="52" r="3" fill="#3D1F8C" />
            <circle cx="74" cy="51" r="1" fill="#B095FF" opacity="0.7" />
            <g style={{ transformOrigin: '75px 52px', transformBox: 'view-box' as React.CSSProperties['transformBox'] }}>
              {/* tassel string + tuft — classed so light mode can flip them
                 to dark (white-on-white is invisible). */}
              <path className="uf-tassel-string" d="M 75 52 Q 105 50 128 56 L 128 86" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <path className="uf-tassel-tuft" d="M 124 84 L 122 96 L 124 98 L 126 98 L 128 96 L 130 96 L 132 98 L 134 96 L 132 84 Z" opacity="0.95" />
              <line x1="124" y1="86" x2="123" y2="95" stroke="rgba(0,0,0,0.12)" strokeWidth="0.5" />
              <line x1="128" y1="86" x2="128" y2="96" stroke="rgba(0,0,0,0.12)" strokeWidth="0.5" />
              <line x1="132" y1="86" x2="133" y2="95" stroke="rgba(0,0,0,0.12)" strokeWidth="0.5" />
              <circle cx="128" cy="100" r="4" fill="url(#uf-tassel-bead)" />
              <circle cx="126.5" cy="98.5" r="1.2" fill="rgba(255,255,255,0.7)" />
            </g>
          </svg>

          {/* scan bars (wide blur glow + sharp purple line) */}
          <div ref={scanBlurRef} className="uf-scan-bar-blur" />
          <div ref={scanBarRef}  className="uf-scan-bar" />

          {/* wordmark — clip-path is driven by JS to track the scan bar.
              All spans on one line so HTML whitespace doesn't add an
              extra inline space between segments. */}
          <span ref={wordRef} className="uf-word"><span className="uf-purple">Uni</span><span className="uf-fg">Flow</span><span className="uf-purple uf-dot">.</span></span>
        </div>

        {/* worm progress (CSS-only) */}
        <div className="uf-progress">
          <svg
            className="uf-pl"
            viewBox="0 0 128 128"
            width="128"
            height="128"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="uf-worm-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"   stopColor="#7B5AFF" />
                <stop offset="50%"  stopColor="#6A3FF4" />
                <stop offset="100%" stopColor="#5A2AD4" />
              </linearGradient>
            </defs>
            <circle
              className="uf-pl__ring"
              cx="64" cy="64" r="56"
              fill="none"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              className="uf-pl__worm"
              d="M92,15.492S78.194,4.967,66.743,16.887c-17.231,17.938-28.26,96.974-28.26,96.974L119.85,59.892l-99-31.588,57.528,89.832L97.8,19.349,13.636,88.51l89.012,16.015S81.908,38.332,66.1,22.337C50.114,6.156,36,15.492,36,15.492a56,56,0,1,0,56,0Z"
              fill="none"
              stroke="url(#uf-worm-grad)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="44 1111"
              strokeDashoffset="10"
            />
          </svg>
        </div>

        {message && <div className="uf-message">{message}</div>}
      </div>
    </motion.div>
  );
};

export default UniFlowLoader;
