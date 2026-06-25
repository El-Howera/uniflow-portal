/**
 * Permission client — fetches the current user's effective permissions from
 * /api/me/permissions and exposes a `useHasPermission(category, action)` hook
 * for UI gating.
 *
 * Cached at the module level so multiple consumers share one fetch. After the
 * admin saves a new permission matrix in Settings, call `invalidatePermissions()`
 * to force a re-fetch (consumers re-render with the new rules).
 */

import { useEffect, useState } from 'react';
import { API_URLS } from '@shared/config';
import { authHeaders } from './api';
import { isPreviewSession } from './previewSession';
import type { DynamicCategory, DynamicCategoryItem } from '../types';

export interface OpFlags {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export type PermissionMap = Record<string, OpFlags>;

interface PermissionsPayload {
  permissions: PermissionMap;
  roles: { id: string; name: string; isSystem: boolean }[];
}

const EMPTY: PermissionsPayload = { permissions: {}, roles: [] };

let cached: PermissionsPayload | null = null;
let inflight: Promise<PermissionsPayload> | null = null;
const subscribers = new Set<(p: PermissionsPayload) => void>();

async function fetchPermissions(): Promise<PermissionsPayload> {
  // Preview (mock-role) sessions never call the backend. The lookup hooks below
  // short-circuit to "allow" for preview sessions, so the cached payload here can
  // stay empty — we only need to avoid the network call.
  if (isPreviewSession()) {
    cached = EMPTY;
    return cached;
  }
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(`${API_URLS.userProfile()}/api/me/permissions`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PermissionsPayload;
      cached = {
        permissions: data?.permissions ?? {},
        roles: data?.roles ?? [],
      };
      subscribers.forEach((cb) => cb(cached!));
      return cached;
    } catch {
      cached = EMPTY;
      subscribers.forEach((cb) => cb(EMPTY));
      return EMPTY;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Force a re-fetch — call after a permission save so live consumers update. */
export function invalidatePermissions(): Promise<PermissionsPayload> {
  cached = null;
  return fetchPermissions();
}

export function clearPermissionsCache(): void {
  cached = null;
}

/**
 * Subscribe to the current user's permissions. Returns the full payload
 * (permissions + roles array) so consumers can also do role-name checks
 * if they need to.
 */
export function usePermissions(): PermissionsPayload {
  const [p, setP] = useState<PermissionsPayload>(cached ?? EMPTY);

  useEffect(() => {
    let mounted = true;
    if (!cached) {
      fetchPermissions().then((r) => {
        if (mounted) setP(r);
      });
    } else {
      setP(cached);
    }
    const cb = (next: PermissionsPayload) => {
      if (mounted) setP(next);
    };
    subscribers.add(cb);
    return () => {
      mounted = false;
      subscribers.delete(cb);
    };
  }, []);

  return p;
}

/**
 * Boolean: does the current user have <action> on <category>?
 *
 * Returns `true` while the initial fetch is pending so first-paint doesn't
 * blink everything off — the gate flips to its real value after the response
 * lands. Pass `defaultDuringLoad: false` to invert that behavior if a strict
 * deny-by-default is preferred.
 */
export function useHasPermission(
  category: string,
  action: keyof OpFlags = 'read',
  defaultDuringLoad = true
): boolean {
  const { permissions } = usePermissions();
  // Preview sessions are mock-only: grant every capability so the dashboards
  // render in full without a permission fetch. Checked AFTER the hook call so
  // hook order stays constant across renders (rules-of-hooks).
  if (isPreviewSession()) return true;
  // Empty cached object = the fetch hasn't filled yet (or returned empty).
  // Be permissive while loading so widgets don't flash off-then-on.
  const loaded = cached !== null;
  if (!loaded) return defaultDuringLoad;
  // Straight lookup. No wildcard fallback — admin's role.permissions JSON
  // grants every category explicitly via seed-roles.js, so the matrix
  // toggles and per-user overrides actually take effect. A grant or deny
  // here is the final answer.
  return Boolean(permissions?.[category]?.[action]);
}

/**
 * Hook that filters a sidebar category list, hiding items whose `requires`
 * gate the user doesn't satisfy. Categories that end up empty are dropped
 * entirely. Items without a `requires` field are always kept.
 *
 * Used in App.tsx to gate every role's sidebar against the live permission
 * matrix (Settings → Roles & Permissions + per-user overrides). Toggling a
 * category off in the matrix → matching nav items disappear within the
 * next render cycle.
 *
 * Plan 5 — accepts an optional `extraEntries` list of cross-role nav items
 * the user has been granted via per-user overrides (e.g. a student who's
 * been granted Sign-In Locks read sees the entry alongside their student
 * sidebar). These are appended in a single "Granted Access" category at
 * the bottom so the source role isn't conflated with the user's primary nav.
 */
export function useFilteredNavCategories(
  categories: DynamicCategory[],
  extraEntries?: DynamicCategoryItem[]
): DynamicCategory[] {
  const { permissions } = usePermissions();
  // Preview sessions: show the role's full native sidebar, unfiltered (mock mode).
  if (isPreviewSession()) return categories;
  const loaded = cached !== null;

  // Same loading-grace policy as useHasPermission — show everything until
  // the first fetch completes, then apply the real filter.
  if (!loaded) {
    return extraEntries && extraEntries.length > 0
      ? [...categories, { title: 'Granted Access', icon: 'ph-key', items: extraEntries, defaultOpen: false }]
      : categories;
  }

  const allow = (item: DynamicCategoryItem): boolean => {
    if (!item.requires) return true;
    const action = item.requires.action ?? 'read';
    // Straight lookup. No `*` wildcard. The role's permissions JSON (and
    // any per-user overrides on top) is the only source of truth — toggling
    // a category off in Settings → Roles & Permissions or revoking it via
    // an override removes the matching nav item on the next fetch.
    return Boolean(permissions?.[item.requires.category]?.[action]);
  };

  const filtered = categories
    .map((cat) => ({ ...cat, items: cat.items.filter(allow) }))
    .filter((cat) => cat.items.length > 0);

  if (!extraEntries || extraEntries.length === 0) return filtered;

  // De-dupe extras against the primary nav by ANY of:
  //   1. exact path
  //   2. permission category (cross-role entries with the same `requires` cat)
  //   3. label (the user already has e.g. an "Announcements" entry in their
  //      role's nav — even if it lacks a `requires` annotation — so don't
  //      surface another "Announcements" entry that would dump them into
  //      another role's layout)
  // Items without a path can't be deduped against; skip them entirely.
  const primaryPaths = new Set<string>();
  const primaryCategories = new Set<string>();
  const primaryLabels = new Set<string>();
  for (const cat of filtered) {
    for (const it of cat.items) {
      if (it.path) primaryPaths.add(it.path);
      if (it.requires?.category) primaryCategories.add(it.requires.category);
      if (it.label) primaryLabels.add(it.label.trim().toLowerCase());
    }
  }
  const uniqueExtras = extraEntries.filter((it) => {
    if (!it.path || !allow(it)) return false;
    if (primaryPaths.has(it.path)) return false;
    if (it.requires?.category && primaryCategories.has(it.requires.category)) return false;
    if (it.label && primaryLabels.has(it.label.trim().toLowerCase())) return false;
    return true;
  });

  return uniqueExtras.length > 0
    ? [...filtered, { title: 'Granted Access', icon: 'ph-key', items: uniqueExtras, defaultOpen: false }]
    : filtered;
}

/**
 * Plan 5 — collect every nav entry across every role config the user has
 * the underlying permission for, regardless of their primary role. Used to
 * surface cross-role entries (e.g. an admin page) on a non-admin sidebar
 * when an admin grants the per-user override.
 *
 * Returns a flat list of items deduped by path. Items without a `requires`
 * annotation are skipped — only permission-gated entries are eligible for
 * cross-role surfacing.
 */
export function useCrossRoleGrants(
  primaryRole: string,
  allRoleConfigs: Record<string, { categories: DynamicCategory[] }>
): DynamicCategoryItem[] {
  const { permissions } = usePermissions();
  if (isPreviewSession()) return [];
  const loaded = cached !== null;
  if (!loaded) return [];

  const seenPaths = new Set<string>();
  const out: DynamicCategoryItem[] = [];

  for (const [roleName, cfg] of Object.entries(allRoleConfigs)) {
    if (roleName === primaryRole) continue; // skip user's own role
    for (const cat of cfg.categories) {
      for (const item of cat.items) {
        if (!item.requires || !item.path) continue;
        if (seenPaths.has(item.path)) continue;
        const action = item.requires.action ?? 'read';
        const granted = Boolean(permissions?.[item.requires.category]?.[action]);
        if (granted) {
          seenPaths.add(item.path);
          out.push(item);
        }
      }
    }
  }
  return out;
}
