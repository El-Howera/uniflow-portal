// frontend/src/config/institutionConfig.ts
//
// Plan 6 Phase 1 — institution-wide brand + regulatory framework labels.
// Surfaced via GET /api/public-settings/institution. The helpers in this file
// let any page render "Article N" / "FCDS" prefixes conditionally (hidden by
// default) and gives a single place to flip institution names when deploying
// the portal to a different school.
//
// Why this exists:
//   The owner wants "FCDS" / "FCDS Article 13b — …" prefixes hidden by default
//   in user-visible help text. Backend defaults and developer comments stay as
//   they are; only the displayed strings consult this config.

import { useEffect, useState } from 'react';
import { API_URLS } from '@shared/config';

export interface InstitutionConfig {
  /** Long-form institution name; e.g. "FCDS, Alexandria University" or "AlexUni School of CS". */
  institutionName: string;
  /** Short product name surfaced in dashboards / page headers; e.g. "UniFlow". */
  productName: string;
  /** When true, "Article N" / "FCDS Article N" prefixes appear in help text. Default: false. */
  articleRefsVisible: boolean;
  /** Label rendered before the article number when articleRefsVisible is true. */
  regulatoryFramework: string;
  /** When true, reset buttons render "Reset to FCDS defaults"; otherwise "Reset to defaults". */
  brandedResetLabels: boolean;
}

export const DEFAULT_INSTITUTION: InstitutionConfig = {
  institutionName: 'UniFlow',
  productName: 'UniFlow',
  articleRefsVisible: false,
  regulatoryFramework: '',
  brandedResetLabels: false,
};

let _cache: { config: InstitutionConfig; expiresAt: number } | null = null;
const subscribers: Array<(c: InstitutionConfig) => void> = [];

export async function fetchInstitutionConfig(force = false): Promise<InstitutionConfig> {
  if (!force && _cache && _cache.expiresAt > Date.now()) return _cache.config;
  try {
    const res = await fetch(`${API_URLS.userProfile()}/api/public-settings/institution`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error('institution config fetch failed');
    const data = await res.json();
    const conf: InstitutionConfig = { ...DEFAULT_INSTITUTION, ...(data?.institution || {}) };
    _cache = { config: conf, expiresAt: Date.now() + 5 * 60 * 1000 };
    subscribers.forEach((cb) => cb(conf));
    return conf;
  } catch {
    return DEFAULT_INSTITUTION;
  }
}

/** Invalidate the cache (call after PATCH so every consumer re-fetches). */
export function invalidateInstitutionConfig(): void {
  _cache = null;
}

export function useInstitutionConfig(): InstitutionConfig {
  const [conf, setConf] = useState<InstitutionConfig>(_cache?.config || DEFAULT_INSTITUTION);
  useEffect(() => {
    let mounted = true;
    fetchInstitutionConfig().then((c) => {
      if (mounted) setConf(c);
    });
    const cb = (c: InstitutionConfig) => {
      if (mounted) setConf(c);
    };
    subscribers.push(cb);
    return () => {
      mounted = false;
      const idx = subscribers.indexOf(cb);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  }, []);
  return conf;
}

/**
 * Format a help-text string that may optionally include an "Article N" prefix.
 * When articleRefsVisible is false, returns the body unchanged.
 *
 *   articleHint(conf, 13, 'students who missed registration can still enroll, …')
 *     → conf.articleRefsVisible = false → 'students who missed registration …'
 *     → conf.articleRefsVisible = true  → 'FCDS Article 13 — students who missed registration …'
 */
export function articleHint(
  conf: InstitutionConfig,
  articleNum: string | number,
  body: string,
): string {
  if (!conf.articleRefsVisible) return body;
  return `${conf.regulatoryFramework} Article ${articleNum} — ${body}`;
}

/** Reset button label — branded or neutral. */
export function resetLabel(conf: InstitutionConfig): string {
  return conf.brandedResetLabels ? `Reset to ${conf.regulatoryFramework} defaults` : 'Reset to defaults';
}

/** Admin Dashboard heading — uses productName when configured, otherwise neutral. */
export function adminDashboardHeading(conf: InstitutionConfig): string {
  return conf.productName ? `${conf.productName} Admin Dashboard` : 'Admin Dashboard';
}
