/**
 * ElectronTitleBar — custom frameless title bar for the desktop build.
 *
 * Mounted by App.tsx → Root when isElectronApp() returns true. The Electron
 * main process has `frame: false` so the native Windows chrome (the strip
 * with File / Edit / View + the minimize / maximize / close buttons) is
 * gone — this component paints replacements that match the UniFlow brand.
 *
 * Layout (32px tall, fixed to top):
 *   ┌───────────────────────────────────────────────── – □ × ┐
 *   │ ☘ UniFlow      [draggable region]                       │
 *   └─────────────────────────────────────────────────────────┘
 *     │           │                                  │
 *     brand mark  draggable (-webkit-app-region:drag) controls (no-drag)
 *
 * Discord-style: ultra-thin, no menu, branded logo + draggable middle,
 * stripe-tinted control buttons that turn red on close hover.
 *
 * No-op on web. Returns null when not running inside Electron so the
 * web bundle pays zero runtime cost (still ships in the chunk; tree-
 * shaking can't remove a component that's conditionally rendered).
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isElectronApp } from '@shared/config';
import { useAppContext } from '../context/AppContext';
import { useBrand } from '../context/BrandContext';
import { Logo } from './Logo';

interface UniflowBridge {
  uniflow?: {
    window?: {
      minimize: () => void;
      maximizeToggle: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizeChanged: (handler: (isMax: boolean) => void) => () => void;
      // Native webContents navigation. When the desktop app loads a live
      // URL (across-origin navigation inside the same BrowserWindow),
      // window.history alone misses the transitions; these IPC calls
      // drive the underlying webContents history.
      goBack?: () => void;
      goForward?: () => void;
      canGo?: () => Promise<{ back: boolean; forward: boolean }>;
      onCanGoChanged?: (
        handler: (state: { back: boolean; forward: boolean }) => void,
      ) => () => void;
    };
  };
}

const bridge = (): UniflowBridge['uniflow'] => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as UniflowBridge;
  return w.uniflow;
};

// CSS class shortcuts. -webkit-app-region is the Chromium-specific property
// that makes a region draggable (think "click + drag the title bar to move
// the window") OR explicitly non-draggable. Buttons MUST be no-drag or
// they swallow clicks.
const dragRegion: React.CSSProperties = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDragRegion: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

// Discord-style square nav glyph (back / forward arrow). Hovering tints the
// background AND text with the live brand primary so the chrome stays in
// sync with whatever the admin saved on the Brand tab.
const NavGlyphButton: React.FC<{
  ariaLabel: string;
  enabled: boolean;
  onClick: () => void;
  brandColor: string;
  /** SVG path for the chevron — pre-shaped so back/forward share the layout. */
  path: string;
}> = ({ ariaLabel, enabled, onClick, brandColor, path }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      disabled={!enabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // Theme-aware base color (dark glyph on the light bar, light glyph on the
      // dark bar); brand color only on hover. Inline color is left undefined
      // when not hovering so the className colors win.
      className="w-8 h-7 my-auto rounded flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-default text-black/60 dark:text-white/70"
      style={{
        color: enabled && hover ? brandColor : undefined,
        // Hover background uses brand color at 18% opacity. Falls through to
        // transparent when disabled (hover never fires due to pointer-events
        // — but disabled:opacity-40 already grays the glyph).
        backgroundColor: enabled && hover ? `${brandColor}2E` : 'transparent',
      }}
    >
      <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
};

const ElectronTitleBar: React.FC = () => {
  const navigate = useNavigate();
  const { userRole, isAuthenticated } = useAppContext();
  const { brandPrimary } = useBrand();
  const [isMax, setIsMax] = useState(false);
  // Discord-style back / forward state. The browser's History API doesn't
  // expose `canGoBack` / `canGoForward` directly, so we track navigation
  // count + listen to popstate to estimate enabled-state. Falls back to
  // always-enabled if the count drifts — pressing the disabled button is
  // a harmless no-op anyway.
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const win = bridge()?.window;
    if (!win) return;
    // Initial state — IPC handle/invoke is async.
    win.isMaximized().then(setIsMax).catch(() => undefined);
    // Subscribe to main-process maximize-state changes.
    return win.onMaximizeChanged(setIsMax);
  }, []);

  // Track navigation state. Two sources, in order of preference:
  //   1. Native webContents history via the Electron bridge — accurate
  //      across origin changes (e.g. a packaged app loading the live
  //      uni-flow.tech site).
  //   2. window.history.length — approximate; used as a fallback when
  //      the bridge isn't present (dev mode, web build).
  useEffect(() => {
    const win = bridge()?.window;

    if (win?.canGo && win.onCanGoChanged) {
      // Native path — seed initial state, subscribe to main-process updates.
      win.canGo()
        .then((s) => { setCanGoBack(s.back); setCanGoForward(s.forward); })
        .catch(() => undefined);
      return win.onCanGoChanged((s) => {
        setCanGoBack(s.back);
        setCanGoForward(s.forward);
      });
    }

    // Fallback — window.history length as a floor. forward is unknown
    // until the user goes back at least once.
    const update = () => {
      setCanGoBack(window.history.length > 1);
      setCanGoForward(false);
    };
    update();
    const onPop = () => update();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (!isElectronApp()) return null;

  const win = bridge()?.window;
  if (!win) return null;

  // Prefer the native bridge when present so cross-origin transitions
  // (live URL ↔ login redirect, etc.) are tracked. Fall back to the
  // window.history API for the web build.
  const goBack = () => {
    if (win.goBack) { win.goBack(); return; }
    setCanGoForward(true);
    window.history.back();
  };
  const goForward = () => {
    if (win.goForward) { win.goForward(); return; }
    window.history.forward();
  };
  const goDashboard = () => {
    if (!isAuthenticated) return;
    navigate(`/${userRole || 'student'}/dashboard`);
  };

  // Window-control button: shared chrome for minimize / maximize / restore.
  // Lifted out of the JSX so all three controls stay visually synchronised
  // and the JSX stays scannable. Close gets its own variant below because
  // its hover state is red instead of brand-purple.
  const ControlBtn: React.FC<{
    ariaLabel: string;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ ariaLabel, onClick, children }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      className="w-11 h-full flex items-center justify-center text-black/60 dark:text-white/65 hover:text-black dark:hover:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] active:bg-black/[0.1] dark:active:bg-white/[0.12] transition-colors duration-100"
    >
      {children}
    </button>
  );

  return (
    <div
      // Fixed top strip. z-[400] beats every other floating layer
      // (toasts z-200, modals z-100..150, mobile nav z-50). SOLID
      // background (no transparency) so the Aurora canvas behind it
      // doesn't bleed through — Discord pattern: the title bar owns
      // its 32px and the app UI starts cleanly below. Paired light /
      // dark colors match the canvas-bg in each theme.
      //
      // Layout (owner directive 2026-06-09):
      //   [nav-far-left]   [drag region]   [wordmark, ABS centered]   [drag region]   [window-controls-right]
      // The wordmark is absolutely positioned so it sits at the geometric
      // center of the bar regardless of the nav / controls widths.
      // Theme-aware: the bar matches the app canvas (--canvas-bg) — near-black
      // in dark mode, light in light mode — so toggling theme reskins it too.
      // The window-control glyphs use text-white/* classes which the global
      // light-mode remap turns into dark canvas-text, giving correct
      // dark-on-light contrast in light mode and white-on-dark in dark mode.
      className="uniflow-titlebar fixed top-0 left-0 right-0 h-8 z-[400] flex items-center select-none border-b border-black/10 dark:border-white/10"
      style={{ ...dragRegion, backgroundColor: 'var(--canvas-bg)' }}
    >
      {/* LEFT — Discord-style back / forward buttons sit flush against the
          window edge. Hover tints use the live brand-primary so the chrome
          reflects admin Brand tab edits. */}
      <div className="flex items-stretch h-full gap-0.5 pl-1 pr-1" style={noDragRegion}>
        <NavGlyphButton
          ariaLabel="Go back"
          enabled={canGoBack}
          onClick={goBack}
          brandColor={brandPrimary}
          path="M6 2L1.5 6L6 10"
        />
        <NavGlyphButton
          ariaLabel="Go forward"
          enabled={canGoForward}
          onClick={goForward}
          brandColor={brandPrimary}
          path="M2 2L6.5 6L2 10"
        />
      </div>

      {/* MIDDLE — draggable spacer flexes to fill the gap between the nav
          buttons and the absolutely-centered wordmark. */}
      <div className="flex-1 h-full" />

      {/* CENTER — wordmark anchored at the bar's true center. Absolute so
          the symmetric drag regions on either side can flex without
          shifting it off-center. translate-x/y centres on both axes. The
          button itself is no-drag so the click lands. pointer-events-none
          on the wrapper makes only the button capture clicks; the rest of
          the row stays draggable through the wrapper. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
      >
        <div style={noDragRegion} className="pointer-events-auto">
          <button
            type="button"
            onClick={goDashboard}
            disabled={!isAuthenticated}
            aria-label="Go to dashboard"
            title={isAuthenticated ? 'Go to dashboard' : undefined}
            className="flex items-center gap-2 h-7 px-2.5 rounded hover:bg-white/10 active:bg-white/15 disabled:opacity-60 disabled:hover:bg-transparent disabled:cursor-default transition-colors text-[12px] font-bold tracking-wide leading-none"
          >
            <Logo />
          </button>
        </div>
      </div>

      {/* MIDDLE-RIGHT — second draggable spacer mirroring the left one so
          the wordmark stays truly centred regardless of nav/controls widths. */}
      <div className="flex-1 h-full" />

      {/* RIGHT — window controls. Custom-painted minimize / maximize / close.
          Close is the only one with the red hover state (Windows / Discord
          convention; signals destructive intent). */}
      <div className="flex items-stretch h-full" style={noDragRegion}>
        <ControlBtn ariaLabel="Minimize" onClick={() => win.minimize()}>
          {/* Minimize glyph — single horizontal line at vertical center. */}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line
              x1="2" y1="6" x2="10" y2="6"
              stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"
            />
          </svg>
        </ControlBtn>

        <ControlBtn
          ariaLabel={isMax ? 'Restore' : 'Maximize'}
          onClick={() => win.maximizeToggle()}
        >
          {isMax ? (
            // Restore — two slightly offset rounded squares to suggest
            // "windowed" state. The back square sits behind, painted
            // first; the front square overlays with a flat fill that
            // matches the bar background so the overlap reads clearly.
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="3.25" y="1.5" width="7.25" height="7.25" rx="1"
                stroke="currentColor" strokeWidth="1.15" fill="none"
              />
              <rect
                x="1.5" y="3.25" width="7.25" height="7.25" rx="1"
                stroke="currentColor" strokeWidth="1.15" fill="var(--canvas-bg)"
              />
            </svg>
          ) : (
            // Maximize — single rounded square outline.
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect
                x="1.5" y="1.5" width="9" height="9" rx="1"
                stroke="currentColor" strokeWidth="1.15" fill="none"
              />
            </svg>
          )}
        </ControlBtn>

        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={() => win.close()}
          className="w-11 h-full flex items-center justify-center text-black/60 dark:text-white/65 hover:text-white hover:bg-[#e81123] active:bg-[#c50f1f] transition-colors duration-100"
        >
          {/* Close glyph — X drawn with two rounded diagonal strokes,
              matching the line-weight + rounding of the other controls. */}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <line
              x1="2" y1="2" x2="10" y2="10"
              stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"
            />
            <line
              x1="10" y1="2" x2="2" y2="10"
              stroke="currentColor" strokeWidth="1.15" strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ElectronTitleBar;
