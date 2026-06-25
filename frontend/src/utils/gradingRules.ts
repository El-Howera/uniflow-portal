/**
 * Grading rules client — fetches the institution's grading config from
 * /api/grading-rules (public endpoint) and exposes a small set of helpers.
 *
 * The hook caches across components: the first useGradingRules() call kicks
 * off the fetch, every subsequent caller reads from the same module-level
 * cache. Callers that render before the fetch resolves get DEFAULT_RULES so
 * GPA math never fails on an undefined map.
 */

import { useEffect, useState } from 'react';
import { API_URLS } from '@shared/config';
import { isPreviewSession } from './previewSession';

export interface GradingScaleEntry {
  letter: string;
  minPercent: number;
  qualityPoints: number;
  /** Administrative code (W, FW, MW, I, IP, S, U, AU). When true, this row
   *  is exempt from the percentage→letter mapping and from the
   *  strictly-decreasing minPercent rule. */
  nonScoring?: boolean;
  /** Optional human-readable description shown in the admin scale editor. */
  label?: string;
}

export interface AcademicStanding {
  probationGpaBelow: number;
  dismissalGpaBelow: number;
  honorsGpaAbove: number;
  highHonorsGpaAbove: number;
  // Plan 4 Phase 5 — Article 19 / 22 extensions. Optional so older clients
  // PATCHing the legacy 4 fields still parse cleanly.
  firstYearWarningGpa?: number;
  dismissalConsecutiveSemesters?: number;
  dismissalNonConsecutiveSemesters?: number;
  probationMaxCredits?: number;
}

export interface CreditLimits {
  min: number;
  max: number;
  /** @deprecated — moved to graduationPolicy.minTotalCredits (Plan 4 Phase 1). */
  graduationTotal?: number;
}

export interface GradingRules {
  scale: GradingScaleEntry[];
  academicStanding: AcademicStanding;
  credits: CreditLimits;
}

// Mirrors backend DEFAULT_RULES exactly so server + client agree before any
// fetch resolves. If the institution overrides the rules, the fetch swaps
// these for the live values.
export const DEFAULT_RULES: GradingRules = Object.freeze({
  scale: [
    { letter: 'A',  minPercent: 90, qualityPoints: 4.000 },
    { letter: 'A-', minPercent: 85, qualityPoints: 3.666 },
    { letter: 'B+', minPercent: 80, qualityPoints: 3.333 },
    { letter: 'B',  minPercent: 75, qualityPoints: 3.000 },
    { letter: 'B-', minPercent: 70, qualityPoints: 2.666 },
    { letter: 'C+', minPercent: 65, qualityPoints: 2.333 },
    { letter: 'C',  minPercent: 60, qualityPoints: 2.000 },
    { letter: 'C-', minPercent: 55, qualityPoints: 1.666 },
    { letter: 'D+', minPercent: 52, qualityPoints: 1.333 },
    { letter: 'D',  minPercent: 50, qualityPoints: 1.000 },
    { letter: 'F',  minPercent: 0,  qualityPoints: 0.000 },
    // Non-scoring administrative codes
    { letter: 'W',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal' },
    { letter: 'FW', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal — Forced' },
    { letter: 'MW', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Withdrawal — Military' },
    { letter: 'I',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Incomplete' },
    { letter: 'IP', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'In Progress' },
    { letter: 'S',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Satisfactory' },
    { letter: 'U',  minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Unsatisfactory' },
    { letter: 'AU', minPercent: 0, qualityPoints: 0, nonScoring: true, label: 'Audit' },
  ],
  academicStanding: {
    // Plan 4 Phase 5 — extended with FCDS Article 19 / 22 knobs.
    firstYearWarningGpa: 1.666,
    dismissalConsecutiveSemesters: 3,
    dismissalNonConsecutiveSemesters: 4,
    probationMaxCredits: 12,
    probationGpaBelow: 2.0,
    dismissalGpaBelow: 1.5,
    honorsGpaAbove: 3.5,
    highHonorsGpaAbove: 3.85,
  },
  // Plan 4 Phase 1 — corrected to FCDS Article 8 (140 cr); see
  // backend/lib/grading-rules.js for the matching backend default.
  credits: { min: 12, max: 21, graduationTotal: 140 },
}) as GradingRules;

// ── Module-level cache so multiple consumers share one fetch ────────────────

let cached: GradingRules | null = null;
let inflight: Promise<GradingRules> | null = null;
const subscribers = new Set<(r: GradingRules) => void>();

async function fetchRules(): Promise<GradingRules> {
  // Preview (mock-role) sessions never call the backend — use FCDS defaults.
  if (isPreviewSession()) {
    cached = DEFAULT_RULES;
    return DEFAULT_RULES;
  }
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${API_URLS.userProfile()}/api/grading-rules`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rules = (data?.rules ?? DEFAULT_RULES) as GradingRules;
      cached = rules;
      subscribers.forEach((cb) => cb(rules));
      return rules;
    } catch {
      cached = DEFAULT_RULES;
      subscribers.forEach((cb) => cb(DEFAULT_RULES));
      return DEFAULT_RULES;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Force re-fetch — call after admin Save Rules so consumers see the change. */
export function invalidateGradingRules(): Promise<GradingRules> {
  cached = null;
  return fetchRules();
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGradingRules(): GradingRules {
  const [rules, setRules] = useState<GradingRules>(cached ?? DEFAULT_RULES);

  useEffect(() => {
    let mounted = true;

    if (!cached) {
      fetchRules().then((r) => {
        if (mounted) setRules(r);
      });
    }

    const cb = (r: GradingRules) => {
      if (mounted) setRules(r);
    };
    subscribers.add(cb);
    return () => {
      mounted = false;
      subscribers.delete(cb);
    };
  }, []);

  return rules;
}

// ── Pure helpers (no React) — same semantics as backend grading-rules.js ────

export function letterToPoints(letter: string, rules: GradingRules = DEFAULT_RULES): number {
  const row = rules.scale.find((r) => r.letter === letter);
  return row ? row.qualityPoints : 0;
}

export function percentToLetter(percent: number, rules: GradingRules = DEFAULT_RULES): string {
  // Non-scoring rows (W, FW, I, AU, …) are administrative codes that don't
  // belong to the percentage curve; skip them when resolving a percentage.
  const scoring = rules.scale.filter((r) => !r.nonScoring);
  const sorted = [...scoring].sort((a, b) => b.minPercent - a.minPercent);
  for (const row of sorted) {
    if (percent >= row.minPercent) return row.letter;
  }
  return sorted[sorted.length - 1]?.letter ?? 'F';
}

export type StandingBand = 'high_honors' | 'honors' | 'good' | 'probation' | 'dismissal';

export function classifyStanding(gpa: number, rules: GradingRules = DEFAULT_RULES): StandingBand {
  const t = rules.academicStanding;
  if (gpa >= t.highHonorsGpaAbove) return 'high_honors';
  if (gpa >= t.honorsGpaAbove) return 'honors';
  if (gpa < t.dismissalGpaBelow) return 'dismissal';
  if (gpa < t.probationGpaBelow) return 'probation';
  return 'good';
}
