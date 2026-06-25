// src/components/Logo.tsx
//
// Plan 8 Phase 1 — branded wordmark. Reads productName + optional
// per-character segment coloring from BrandContext. Used everywhere the
// "UniFlow" text appears (sidebar, auth card, loader, PDF header).
//
// Three rendering modes:
//   1. logoSegments configured  → render each segment with its own color
//   2. No segments              → split at the midpoint; first half in
//                                  brand-primary, second half in the
//                                  current-color (so dark/light-mode
//                                  parent text color takes over)
//   3. Single short word        → render entirely in brand-primary
//
// `className` is forwarded to the outer <span> so callers can size /
// font-style the wordmark inline.

import React from 'react';
import { useBrand } from '../context/BrandContext';

interface LogoProps {
  /** Tailwind / inline classes for the outer span (font size, weight, tracking). */
  className?: string;
  /** Override the productName from BrandContext — useful for the admin
   *  Brand tab's live preview before the user clicks Save. */
  overrideName?: string;
  /** Same shape as BrandContext.logoSegments — overrides the live value
   *  for previewing draft segment coloring. */
  overrideSegments?: { text: string; color: string }[] | null;
  /** Override the primary color used by the default half-split render. */
  overridePrimary?: string;
  /** Override the accent color used when secondaryUsesAccent is set. */
  overrideAccent?: string;
  /** Treat the second half as "secondary" instead of inheriting current
   *  text color. Used when the wordmark sits on a dark or graphic surface. */
  secondaryUsesAccent?: boolean;
}

export const Logo: React.FC<LogoProps> = ({
  className = '',
  overrideName,
  overrideSegments,
  overridePrimary,
  overrideAccent,
  secondaryUsesAccent = false,
}) => {
  const { productName, brandPrimary: ctxPrimary, brandAccent: ctxAccent, logoSegments } = useBrand();
  const name = overrideName ?? productName ?? 'UniFlow';
  const segments = overrideSegments !== undefined ? overrideSegments : logoSegments;
  // Draft colors win over context — lets the admin Brand tab preview
  // reflect unsaved color edits before Save is clicked.
  const brandPrimary = overridePrimary ?? ctxPrimary;
  const brandAccent = overrideAccent ?? ctxAccent;

  // Custom segments take precedence — every segment renders with its
  // configured color, in order.
  if (segments && segments.length > 0) {
    // Validate the concatenated segment text actually equals the name so
    // the admin sees what they configured. If lengths drift (e.g. the name
    // was edited after segments were saved), fall back to the default split.
    const concatenated = segments.map((s) => s.text).join('');
    if (concatenated === name) {
      return (
        // `dir="ltr"` keeps the wordmark in left-to-right order even when
        // a parent has `dir="rtl"` (Arabic). Without this, the final
        // period in "UniFlow." flips to the front and becomes ".UniFlow".
        <span className={className} dir="ltr">
          {segments.map((seg, i) => (
            <span key={i} style={{ color: seg.color }}>
              {seg.text}
            </span>
          ))}
        </span>
      );
    }
  }

  // Default: half-and-half split. For very short names (≤3 chars) render
  // the whole thing in brand-primary so we don't end up with "U" + "ni".
  if (name.length <= 3) {
    return (
      <span className={className} dir="ltr">
        <span style={{ color: brandPrimary }}>{name}</span>
      </span>
    );
  }

  const splitAt = Math.ceil(name.length / 2);
  const head = name.slice(0, splitAt);
  const tail = name.slice(splitAt);

  return (
    <span className={className} dir="ltr">
      <span style={{ color: brandPrimary }}>{head}</span>
      <span style={secondaryUsesAccent ? { color: brandAccent } : undefined}>
        {tail}
      </span>
    </span>
  );
};

export default Logo;
