// src/context/BrandContext.tsx
//
// Plan 8 Phase 1 + theme-aware extension — admin-tunable wordmark + a
// 3-color brand palette PER MODE (light + dark). Reads
// /api/public-settings/brand on mount, injects the values as CSS custom
// properties on <html>, and exposes the resolved values (for the current
// dark/light mode) plus the full split (for the admin Brand-tab editor).
//
// CSS strategy: the injected <style> writes TWO copies of every override
// rule — one scoped under `html:not(.dark)` (light mode) and one under
// `html.dark`. Tailwind's existing `dark:` variant ensures the right one
// applies based on the html.dark class, so no JS re-render is needed when
// the user toggles light/dark — the CSS swaps automatically.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppContext } from './AppContext';

export interface LogoSegment {
  text: string;
  color: string; // hex
}

export interface BrandTheme {
  brandPrimary: string;
  brandSecondary: string;
  brandAccent: string;
  /** Page background color for this theme. Drives `--canvas-bg` so the
   *  body background swaps live the moment the admin saves a new value. */
  canvasBg: string;
  /**
   * Atmosphere colors layered behind the canvas — the purples on the dark
   * Aurora and the pink / cyan / lavender blobs on the light page.
   *
   * - Dark theme: consumed as Aurora WebGL color stops. Usually 3 entries
   *   (start, middle, end) but the consumer pads / trims as needed.
   * - Light theme: consumed by `<LightModeBackground />` as the 4 radial-
   *   gradient blob colors (top-left, top-right, bottom-left, bottom-right).
   */
  backgroundColors: string[];
  logoSegments: LogoSegment[] | null;
}

export interface BrandConfig {
  productName: string;
  light: BrandTheme;
  dark: BrandTheme;
}

export const DEFAULT_LIGHT: BrandTheme = {
  brandPrimary: '#6A3FF4',
  brandSecondary: '#A855F7',
  brandAccent: '#5A2AD4',
  // Matches the pre-existing light `--canvas-bg` in index.css.
  canvasBg: '#FFFFFF',
  // Defaults mirror the original hardcoded blob colors in
  // `LightModeBackground.tsx` (lavender, pink, sky-blue, light purple).
  backgroundColors: ['#A78BFA', '#F472B6', '#7DD3FC', '#C4B5FD'],
  logoSegments: null,
};

export const DEFAULT_DARK: BrandTheme = {
  brandPrimary: '#6A3FF4',
  brandSecondary: '#A855F7',
  brandAccent: '#7B5AFF',
  // Matches the pre-existing dark `--canvas-bg` in index.css.
  canvasBg: '#0D0D0D',
  // Defaults mirror the original hardcoded Aurora `colorStops` in `App.tsx`.
  backgroundColors: ['#5A2AD4', '#7B5AFF', '#5A2AD4'],
  logoSegments: null,
};

export const DEFAULT_BRAND: BrandConfig = {
  productName: 'UniFlow',
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
};

interface BrandContextValue {
  /** App name, shared across themes. */
  productName: string;
  /** Full per-theme config (admin Brand-tab editor uses this). */
  light: BrandTheme;
  dark: BrandTheme;
  /** Resolved values for the currently-active theme. The wordmark + every
   *  consumer that just wants "today's primary color" reads these. */
  brandPrimary: string;
  brandSecondary: string;
  brandAccent: string;
  logoSegments: LogoSegment[] | null;
  /** Force a re-fetch from the backend. */
  refresh: () => Promise<void>;
  /** Optimistic local update — useful for the admin Brand tab preview. */
  setLocal: (patch: Partial<BrandConfig>) => void;
}

const BrandContext = createContext<BrandContextValue>({
  productName: DEFAULT_BRAND.productName,
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
  brandPrimary: DEFAULT_DARK.brandPrimary,
  brandSecondary: DEFAULT_DARK.brandSecondary,
  brandAccent: DEFAULT_DARK.brandAccent,
  logoSegments: DEFAULT_DARK.logoSegments,
  refresh: async () => {},
  setLocal: () => {},
});

/** Sanitise a partial theme block — fills missing fields from defaults. */
// Conservative hex validator — accepts #RGB / #RGBA / #RRGGBB / #RRGGBBAA.
function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(v.trim());
}

function fillTheme(raw: Partial<BrandTheme> | undefined, defaults: BrandTheme): BrandTheme {
  const rawColors = Array.isArray(raw?.backgroundColors) ? raw!.backgroundColors : null;
  // Keep one slot per default — drop malformed entries, pad missing ones
  // with the defaults so the theme always carries the expected count.
  const backgroundColors = rawColors
    ? defaults.backgroundColors.map((d, i) => (isHex(rawColors[i]) ? rawColors[i].trim() : d))
    : [...defaults.backgroundColors];
  return {
    brandPrimary: raw?.brandPrimary || defaults.brandPrimary,
    brandSecondary: raw?.brandSecondary || defaults.brandSecondary,
    brandAccent: raw?.brandAccent || defaults.brandAccent,
    canvasBg: raw?.canvasBg || defaults.canvasBg,
    backgroundColors,
    logoSegments: raw?.logoSegments ?? defaults.logoSegments,
  };
}

/** Detect a legacy flat shape and migrate to the nested one. */
function normaliseBrand(raw: unknown): BrandConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const productName = typeof r.productName === 'string' && (r.productName as string).trim().length > 0
    ? (r.productName as string).trim()
    : DEFAULT_BRAND.productName;
  // Legacy flat: top-level brandPrimary, no `light`/`dark` keys.
  const isLegacyFlat = (
    typeof r.brandPrimary === 'string' || typeof r.brandSecondary === 'string' ||
    typeof r.brandAccent === 'string' || Array.isArray(r.logoSegments)
  ) && !r.light && !r.dark;
  if (isLegacyFlat) {
    const block = fillTheme(r as Partial<BrandTheme>, DEFAULT_DARK);
    return { productName, light: { ...block }, dark: { ...block } };
  }
  return {
    productName,
    light: fillTheme(r.light as Partial<BrandTheme> | undefined, DEFAULT_LIGHT),
    dark: fillTheme(r.dark as Partial<BrandTheme> | undefined, DEFAULT_DARK),
  };
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrandConfig>(DEFAULT_BRAND);
  // Read isDarkMode from AppContext — AppProvider must wrap BrandProvider.
  const { isDarkMode } = useAppContext();

  const active = isDarkMode ? state.dark : state.light;

  // Theming engine backend was removed in this build — branding is fully
  // client-side. `refresh` hydrates from the locally-cached brand (written by
  // the boot splash script / persisted below) instead of calling any backend;
  // when nothing is cached, the default UniFlow brand remains.
  const refresh = useCallback(async () => {
    try {
      const raw = localStorage.getItem('uniflowBrand');
      if (raw) setState(normaliseBrand(JSON.parse(raw)));
    } catch {
      /* defaults remain */
    }
  }, []);

  // Initial hydrate — fires once at app boot.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Inject ACTIVE theme as CSS custom properties on every state/mode
  // change. `var(--brand-primary)` etc. references in tailwind.config.js
  // pick up the live value. `--canvas-bg` drives `body { background }`
  // in index.css so the page background swaps live.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-primary', active.brandPrimary);
    root.style.setProperty('--brand-secondary', active.brandSecondary);
    root.style.setProperty('--brand-accent', active.brandAccent);
    root.style.setProperty('--canvas-bg', active.canvasBg);
  }, [active.brandPrimary, active.brandSecondary, active.brandAccent, active.canvasBg]);

  // Persist the full brand config to localStorage so the boot loader (in
  // index.html, runs before React mounts) can read it synchronously and
  // skin the splash with the saved branding. Without this, every cold
  // start flashes the default UniFlow purple wordmark even if the admin
  // has saved a custom brand. The boot script reads `uniflowBrand` next
  // to `darkMode`. Failures (private browsing, quota) are swallowed
  // since the splash falls back to defaults gracefully.
  useEffect(() => {
    try {
      localStorage.setItem('uniflowBrand', JSON.stringify(state));
    } catch {
      /* ignore — splash will show defaults */
    }
  }, [state]);

  // Theme-aware runtime CSS override.
  // Tailwind's arbitrary-value classes (`bg-[#6A3FF4]` / `text-[#7B5AFF]` etc.)
  // compile to LITERAL hex in the build-time CSS, so updating the CSS var
  // alone doesn't reach them. We inject a single <style> element with TWO
  // copies of every override rule — one scoped under `html:not(.dark)`
  // (light) and one under `html.dark` (dark) — so swapping the theme via
  // AppContext.toggleDarkMode triggers a clean CSS swap to the right
  // palette without re-rendering React.
  useEffect(() => {
    const STYLE_ID = 'uniflow-brand-overrides';
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    const opacityTiers = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70];
    // Build all rules for ONE theme block. `scope` prefixes every selector
    // (e.g. `html.dark` or `html:not(.dark)`) so the two themes don't
    // collide. Same hex shapes mapped, plus the opacity tiers.
    const buildBlock = (scope: string, t: BrandTheme) => {
      const p = t.brandPrimary;
      const s = t.brandSecondary;
      const a = t.brandAccent;
      const opacityRules = opacityTiers
        .map((n) => {
          const pct = `${n}%`;
          const mk = (cls: string, prop: string, color: string) =>
            `${scope} .${cls}\\/${n} { ${prop}: color-mix(in srgb, ${color} ${pct}, transparent) !important; }`;
          return [
            mk('bg-\\[\\#6A3FF4\\]',     'background-color', p),
            mk('text-\\[\\#6A3FF4\\]',   'color',            p),
            mk('border-\\[\\#6A3FF4\\]', 'border-color',     p),
            mk('bg-\\[\\#7B5AFF\\]',     'background-color', a),
            mk('text-\\[\\#7B5AFF\\]',   'color',            a),
            mk('border-\\[\\#7B5AFF\\]', 'border-color',     a),
            mk('bg-\\[\\#A855F7\\]',     'background-color', s),
            mk('text-\\[\\#A855F7\\]',   'color',            s),
            mk('border-\\[\\#A855F7\\]', 'border-color',     s),
            mk('bg-\\[\\#5A2AD4\\]',     'background-color', `color-mix(in srgb, ${p} 88%, black)`),
            mk('bg-\\[\\#5A32D4\\]',     'background-color', `color-mix(in srgb, ${p} 88%, black)`),
          ].join('\n');
        })
        .join('\n');
      return `
        ${scope} .bg-\\[\\#6A3FF4\\]              { background-color: ${p} !important; }
        ${scope} .hover\\:bg-\\[\\#6A3FF4\\]:hover{ background-color: ${p} !important; }
        ${scope} .text-\\[\\#6A3FF4\\]            { color: ${p} !important; }
        ${scope} .hover\\:text-\\[\\#6A3FF4\\]:hover { color: ${p} !important; }
        ${scope} .border-\\[\\#6A3FF4\\]          { border-color: ${p} !important; }
        ${scope} .hover\\:border-\\[\\#6A3FF4\\]:hover { border-color: ${p} !important; }
        ${scope} .ring-\\[\\#6A3FF4\\]            { --tw-ring-color: ${p} !important; }
        ${scope} .focus\\:ring-\\[\\#6A3FF4\\]:focus { --tw-ring-color: ${p} !important; }
        ${scope} .from-\\[\\#6A3FF4\\]            { --tw-gradient-from: ${p} var(--tw-gradient-from-position) !important; }
        ${scope} .to-\\[\\#6A3FF4\\]              { --tw-gradient-to: ${p} var(--tw-gradient-to-position) !important; }
        ${scope} .via-\\[\\#6A3FF4\\]             { --tw-gradient-via: ${p} var(--tw-gradient-via-position) !important; --tw-gradient-stops: var(--tw-gradient-from), ${p} var(--tw-gradient-via-position), var(--tw-gradient-to) !important; }
        ${scope} .accent-\\[\\#6A3FF4\\]          { accent-color: ${p} !important; }
        ${scope} .fill-\\[\\#6A3FF4\\]            { fill: ${p} !important; }
        ${scope} .stroke-\\[\\#6A3FF4\\]          { stroke: ${p} !important; }

        ${scope} .bg-\\[\\#7B5AFF\\]              { background-color: ${a} !important; }
        ${scope} .hover\\:bg-\\[\\#7B5AFF\\]:hover{ background-color: ${a} !important; }
        ${scope} .text-\\[\\#7B5AFF\\]            { color: ${a} !important; }
        ${scope} .hover\\:text-\\[\\#7B5AFF\\]:hover { color: ${a} !important; }
        ${scope} .border-\\[\\#7B5AFF\\]          { border-color: ${a} !important; }
        ${scope} .from-\\[\\#7B5AFF\\]            { --tw-gradient-from: ${a} var(--tw-gradient-from-position) !important; }
        ${scope} .to-\\[\\#7B5AFF\\]              { --tw-gradient-to: ${a} var(--tw-gradient-to-position) !important; }

        ${scope} .bg-\\[\\#A855F7\\]              { background-color: ${s} !important; }
        ${scope} .text-\\[\\#A855F7\\]            { color: ${s} !important; }
        ${scope} .border-\\[\\#A855F7\\]          { border-color: ${s} !important; }
        ${scope} .from-\\[\\#A855F7\\]            { --tw-gradient-from: ${s} var(--tw-gradient-from-position) !important; }
        ${scope} .to-\\[\\#A855F7\\]              { --tw-gradient-to: ${s} var(--tw-gradient-to-position) !important; }

        ${scope} .bg-\\[\\#5A2AD4\\],
        ${scope} .bg-\\[\\#5A32D4\\]              { background-color: color-mix(in srgb, ${p} 88%, black) !important; }
        ${scope} .hover\\:bg-\\[\\#5A2AD4\\]:hover,
        ${scope} .hover\\:bg-\\[\\#5A32D4\\]:hover { background-color: color-mix(in srgb, ${p} 88%, black) !important; }
        ${scope} .to-\\[\\#5A2AD4\\],
        ${scope} .to-\\[\\#5A32D4\\]              { --tw-gradient-to: color-mix(in srgb, ${p} 88%, black) var(--tw-gradient-to-position) !important; }
        ${scope} .from-\\[\\#5A2AD4\\],
        ${scope} .from-\\[\\#5A32D4\\]            { --tw-gradient-from: color-mix(in srgb, ${p} 88%, black) var(--tw-gradient-from-position) !important; }

        ${opacityRules}
      `;
    };
    el.textContent = [
      '/* Plan 8 Phase 1 — theme-aware brand color overrides. Generated by',
      '   BrandContext. Targets every Tailwind arbitrary-value class that',
      '   references the four canonical brand hexes; `html.dark` selectors',
      '   apply the dark palette and `html:not(.dark)` the light palette.',
      '   Saving a new palette in admin Settings - Brand re-skins the entire',
      '   app instantly with no rebuild. */',
      buildBlock('html:not(.dark)', state.light),
      buildBlock('html.dark', state.dark),
    ].join('\n');
  }, [state.light, state.dark]);

  const setLocal = useCallback((patch: Partial<BrandConfig>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<BrandContextValue>(
    () => ({
      productName: state.productName,
      light: state.light,
      dark: state.dark,
      brandPrimary: active.brandPrimary,
      brandSecondary: active.brandSecondary,
      brandAccent: active.brandAccent,
      logoSegments: active.logoSegments,
      refresh,
      setLocal,
    }),
    [state, active, refresh, setLocal]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}
