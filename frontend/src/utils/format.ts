/**
 * Currency formatting — reads the institution-wide currency code from
 * /api/public-settings (defaults to "EGP") and exposes a formatter that every
 * monetary display in the app uses. Cached at the module level so multiple
 * mounts share one fetch; replace via `setCurrency(code)` if the admin
 * changes it in Settings → General without a hard reload.
 */

import { useEffect, useState } from 'react';
import { API_URLS } from '@shared/config';
import { isPreviewSession } from './previewSession';

let currencyCode = 'EGP';
let inflight: Promise<string> | null = null;
const subscribers = new Set<(c: string) => void>();

async function loadCurrency(): Promise<string> {
  // Preview (mock-role) sessions never call the backend — keep the default code.
  if (isPreviewSession()) return currencyCode;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${API_URLS.userProfile()}/api/public-settings`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.currency === 'string' && data.currency.length >= 3) {
          currencyCode = data.currency.toUpperCase();
        }
      }
    } catch {
      // Network failure — keep the default.
    } finally {
      inflight = null;
    }
    subscribers.forEach((cb) => cb(currencyCode));
    return currencyCode;
  })();
  return inflight;
}

/** Override the cached code (admin Settings save fires this). */
export function setCurrency(code: string): void {
  currencyCode = (code || 'EGP').toUpperCase();
  subscribers.forEach((cb) => cb(currencyCode));
}

/** Sync getter — returns the cached value (defaults to "EGP" before load). */
export function getCurrency(): string {
  return currencyCode;
}

/**
 * Format a numeric value as money. Pads to a minimum of 2 fractional digits
 * unless the value is a round integer (no fractional part), in which case it
 * stays integer for cleaner display on stat cards. Pass `{ fractional: true }`
 * to force two decimals always.
 */
export function formatMoney(
  value: number | string | null | undefined,
  options: { code?: string; fractional?: boolean } = {}
): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n)) return `${options.code ?? currencyCode} 0`;
  const showFraction = options.fractional || Math.round(n) !== n;
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: showFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${options.code ?? currencyCode} ${formatted}`;
}

/**
 * React hook — re-renders consumers when the cached currency changes (e.g.
 * after an admin save). Triggers the initial fetch on first mount.
 */
export function useCurrency(): string {
  const [c, setC] = useState(currencyCode);

  useEffect(() => {
    let mounted = true;
    loadCurrency().then((next) => {
      if (mounted) setC(next);
    });
    const cb = (next: string) => {
      if (mounted) setC(next);
    };
    subscribers.add(cb);
    return () => {
      mounted = false;
      subscribers.delete(cb);
    };
  }, []);

  return c;
}
