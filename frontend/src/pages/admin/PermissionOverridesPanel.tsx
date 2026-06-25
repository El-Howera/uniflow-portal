// frontend/src/pages/admin/PermissionOverridesPanel.tsx
//
// Plan 5 Phase 3 — Per-User Permission Overrides
//
// Lets an admin search for any user and edit per-category permission overrides
// using a tri-state matrix:
//   • inherit (null) — fall back to role baseline
//   • grant (true)   — force-grant regardless of role
//   • deny (false)   — force-deny regardless of role
//
// Wired to:
//   GET    /api/admin/users?search=<q>            user search
//   GET    /api/admin/users/:id/permissions       baseline + overrides + effective
//   POST   /api/admin/users/:id/permissions/override
//   DELETE /api/admin/users/:id/permissions/override/:category
//
// Lives under the "Per-User Overrides" sub-tab in admin Settings →
// Roles & Permissions.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TriStateCheckbox, TriValue } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface UserHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

// ─── Preview mock data ─────────────────────────────────────────────────────────
// Static user directory for the search card + per-role permission baselines.

const MOCK_USERS: UserHit[] = [
  { id: 'u-omar', firstName: 'Omar', lastName: 'Khaled', email: 'omar.khaled@fcds.edu', role: 'student' },
  { id: 'u-sara', firstName: 'Sara', lastName: 'Mahmoud', email: 'sara.mahmoud@fcds.edu', role: 'student' },
  { id: 'u-prof-fares', firstName: 'Fares', lastName: 'Howera', email: 'fares.howera@fcds.edu', role: 'professor' },
  { id: 'u-ta-mona', firstName: 'Mona', lastName: 'Salah', email: 'mona.salah@fcds.edu', role: 'ta' },
  { id: 'u-sa-hana', firstName: 'Hana', lastName: 'Adel', email: 'hana.adel@fcds.edu', role: 'sa' },
  { id: 'u-fin-mariam', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test', role: 'financial' },
  { id: 'u-it-omar', firstName: 'Omar', lastName: 'Hassan', email: 'it@uniflow.test', role: 'it' },
];

const bucket = (read: boolean, write: boolean, del: boolean): PermBucket => ({ read, write, delete: del });

// Per-role baseline permission matrices. Mirrors the role-permissions matrix
// in docs/role-permissions.md closely enough for a preview.
const ROLE_BASELINES: Record<string, Record<string, PermBucket>> = {
  student: {
    'Course Catalog': bucket(true, false, false),
    'Registration': bucket(true, true, false),
    'Materials': bucket(true, false, false),
    'Grades': bucket(true, false, false),
    'Attendance': bucket(true, false, false),
    'Payments': bucket(true, true, false),
    'Complaints': bucket(true, true, false),
    'Announcements': bucket(true, false, false),
  },
  professor: {
    'Materials': bucket(true, true, false),
    'Grading': bucket(true, true, false),
    'Attendance': bucket(true, true, false),
    'Advisees': bucket(true, false, false),
    'Announcements': bucket(true, false, false),
  },
  ta: {
    'Materials': bucket(true, true, false),
    'Grading': bucket(true, true, false),
    'Attendance': bucket(true, true, false),
    'Announcements': bucket(true, false, false),
  },
  sa: {
    'Student Management': bucket(true, true, false),
    'Financial Management': bucket(true, false, false),
    'Complaints': bucket(true, true, false),
    'Enrollment Workflows': bucket(true, true, false),
    'Attendance': bucket(true, true, false),
    'Reports': bucket(true, false, false),
    'Announcements': bucket(true, true, false),
  },
  financial: {
    'Financial Management': bucket(true, true, true),
    'Payroll': bucket(true, true, false),
    'Financial Aid': bucket(true, true, false),
    'Staff Chat': bucket(true, true, false),
    'Announcements': bucket(true, false, false),
  },
  it: {
    'Audit Logs': bucket(true, false, false),
    'Analytics Dashboard': bucket(true, false, false),
    'Sign-In Locks': bucket(true, true, false),
    'Staff Chat': bucket(true, true, false),
    'Announcements': bucket(true, false, false),
  },
  admin: {
    'User Permissions': bucket(true, true, true),
    'Course Management': bucket(true, true, true),
    'Student Management': bucket(true, true, true),
    'Faculty Management': bucket(true, true, true),
    'Financial Management': bucket(true, true, true),
    'Grading': bucket(true, true, true),
    'Audit Logs': bucket(true, false, false),
    'System Settings': bucket(true, true, false),
    'Announcements': bucket(true, true, true),
  },
};

// Per-user override store. Keyed by userId; lives only in memory for the preview.
// Pre-seed one example so the matrix shows a live override out of the box.
const MOCK_OVERRIDES: Record<string, Record<string, OverrideBucket>> = {
  'u-ta-mona': {
    Announcements: { canRead: true, canWrite: true, canDelete: null },
  },
};

function buildPermissionsResponse(user: UserHit): PermissionsResponse {
  const rolePermissions: Record<string, PermBucket> = {
    ...(ROLE_BASELINES[user.role] ?? {}),
  };
  const overrides: Record<string, OverrideBucket> = {
    ...(MOCK_OVERRIDES[user.id] ?? {}),
  };
  // Effective = role baseline merged with overrides (grant/deny win).
  const categories = new Set<string>([
    ...Object.keys(rolePermissions),
    ...Object.keys(overrides),
  ]);
  const effective: Record<string, PermBucket> = {};
  categories.forEach((cat) => {
    const base = rolePermissions[cat] ?? bucket(false, false, false);
    const ov = overrides[cat];
    effective[cat] = {
      read: ov?.canRead != null ? ov.canRead : base.read,
      write: ov?.canWrite != null ? ov.canWrite : base.write,
      delete: ov?.canDelete != null ? ov.canDelete : base.delete,
    };
  });
  return { user, rolePermissions, overrides, effective };
}

interface PermBucket {
  read: boolean;
  write: boolean;
  delete: boolean;
}

interface OverrideBucket {
  canRead: TriValue;
  canWrite: TriValue;
  canDelete: TriValue;
}

interface PermissionsResponse {
  user: UserHit;
  rolePermissions: Record<string, PermBucket>;
  overrides: Record<string, OverrideBucket>;
  effective: Record<string, PermBucket>;
}

type Action = 'canRead' | 'canWrite' | 'canDelete';

// Why does the user have a given grant? Computed per (category, op) so the
// Source column can explain whether the grant comes from the role default or
// from an explicit per-user override.
type GrantSource = 'override' | 'role' | 'none';

function resolveSource(
  effectiveOn: boolean | undefined,
  _roleOn: boolean | undefined,
  overrideVal: TriValue | undefined,
): GrantSource {
  // Explicit override beats everything (even when its value is `false` — a deny
  // is itself a kind of "override is the reason").
  if (overrideVal === true || overrideVal === false) return 'override';
  if (!effectiveOn) return 'none';
  return 'role';
}

const SOURCE_STYLE: Record<GrantSource, { cls: string }> = {
  override:  { cls: 'text-[#7B5AFF] bg-[#6A3FF4]/15 border-[#6A3FF4]/30' },
  role:      { cls: 'text-blue-300 bg-blue-500/15 border-blue-500/30' },
  none:      { cls: 'text-gray-500 bg-white/5 border-white/10' },
};

const SourcePill: FC<{ op: 'R' | 'W' | 'D'; source: GrantSource }> = ({ op, source }) => {
  const t = useT();
  const s = SOURCE_STYLE[source];
  const labelKey = source === 'override' ? 'admin.permsSourceOverride'
    : source === 'role' ? 'admin.permsSourceRole'
    : 'admin.permsSourceNone';
  const titleKey = source === 'override' ? 'admin.permsSourceTitleOverride'
    : source === 'role' ? 'admin.permsSourceTitleRole'
    : 'admin.permsSourceTitleNone';
  return (
    <span
      title={t('admin.permsSourceOpHint', { op, title: t(titleKey) })}
      className={`inline-flex items-center gap-1 text-[9px] uppercase tracking-wide font-bold border rounded px-1.5 py-0.5 ${s.cls}`}
    >
      <span className="opacity-70">{op}</span>
      {t(labelKey)}
    </span>
  );
};

// ─── User Search Card ──────────────────────────────────────────────────────

const UserSearch: FC<{
  selectedId: string | null;
  onSelect: (u: UserHit) => void;
}> = ({ selectedId, onSelect }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 300ms debounce — preview mode filters the static directory locally.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    const tm = setTimeout(() => {
      const q = trimmed.toLowerCase();
      const hits = MOCK_USERS.filter(
        (u) =>
          `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q),
      );
      setResults(hits);
      setError(null);
      setLoading(false);
    }, 300);
    return () => clearTimeout(tm);
  }, [query]);

  return (
    <div className={`${glassCardStyle} p-5`}>
      <h2 className="text-base font-bold text-black dark:text-white mb-1">{t('admin.permsFindUser')}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('admin.permsFindUserHint')}
      </p>

      <div className="relative mb-3">
        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.permsSearchPh')}
          className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          {error}
        </div>
      )}

      {loading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
          <i className="ph-bold ph-circle-notch animate-spin mr-2"></i>
          {t('admin.permsSearching')}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && !error && (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">{t('admin.permsNoUserMatches')}</div>
      )}

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 dark:border-white/5 divide-y divide-white/5">
          {results.map((u) => {
            const isSelected = u.id === selectedId;
            return (
              <button
                key={u.id}
                onClick={() => onSelect(u)}
                className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-[#6A3FF4]/15'
                    : 'hover:bg-white/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-black dark:text-white truncate">
                    {u.firstName} {u.lastName}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{u.email}</div>
                </div>
                <span className="text-[10px] uppercase tracking-wide font-bold text-[#7B5AFF] bg-[#6A3FF4]/15 border border-[#6A3FF4]/30 rounded px-2 py-0.5 flex-shrink-0">
                  {u.role}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Override Matrix ───────────────────────────────────────────────────────

const RoleBaselineChip: FC<{ bucket: PermBucket | undefined }> = ({ bucket }) => {
  if (!bucket || (!bucket.read && !bucket.write && !bucket.delete)) {
    return <span className="text-[11px] text-gray-500 dark:text-gray-500">—</span>;
  }
  const parts: string[] = [];
  if (bucket.read) parts.push('R');
  if (bucket.write) parts.push('W');
  if (bucket.delete) parts.push('D');
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold text-[#7B5AFF] bg-[#6A3FF4]/15 border border-[#6A3FF4]/30 rounded px-2 py-0.5">
      <i className="ph-bold ph-check text-[9px]" />
      {parts.join('')}
    </span>
  );
};

const OverrideMatrix: FC<{
  data: PermissionsResponse;
  onRefresh: () => Promise<void>;
}> = ({ data, onRefresh }) => {
  const t = useT();
  // Pending state per (category|action) so we can disable that single cell
  // while a POST is in flight.
  const [pending, setPending] = useState<Set<string>>(new Set());
  // Optimistic override values keyed by category. Falls back to data.overrides.
  const [localOverrides, setLocalOverrides] = useState<Record<string, OverrideBucket>>(data.overrides);
  const [rowError, setRowError] = useState<{ category: string; message: string } | null>(null);

  // Reset local state when the underlying data refreshes (e.g. user switch).
  useEffect(() => {
    setLocalOverrides(data.overrides);
    setRowError(null);
  }, [data]);

  // Union of all categories the user could possibly see: role baseline + any
  // override that's already been set (even if the role grants nothing).
  const categories = useMemo(() => {
    const set = new Set<string>();
    Object.keys(data.rolePermissions || {}).forEach((k) => set.add(k));
    Object.keys(data.overrides || {}).forEach((k) => set.add(k));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const markPending = useCallback((key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const applyChange = useCallback(
    async (category: string, action: Action, next: TriValue) => {
      const key = `${category}|${action}`;
      const prevOverride = localOverrides[category] ?? {
        canRead: null,
        canWrite: null,
        canDelete: null,
      };
      const nextOverride: OverrideBucket = { ...prevOverride, [action]: next };

      // Preview mode — flip the override in local state + the in-memory store.
      // No network. Persist so a refresh keeps the change for this session.
      setLocalOverrides((cur) => ({ ...cur, [category]: nextOverride }));
      markPending(key, true);
      setRowError(null);
      MOCK_OVERRIDES[data.user.id] = {
        ...(MOCK_OVERRIDES[data.user.id] ?? {}),
        [category]: nextOverride,
      };
      // Recompute the effective view from the refreshed override store.
      await onRefresh();
      markPending(key, false);
    },
    [data.user.id, localOverrides, markPending, onRefresh],
  );

  return (
    <div className={`${glassCardStyle} p-5`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-bold text-black dark:text-white">
            {data.user.firstName} {data.user.lastName}
          </h2>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {data.user.email} ·{' '}
            <span className="text-[10px] uppercase tracking-wide font-bold text-[#7B5AFF] bg-[#6A3FF4]/15 border border-[#6A3FF4]/30 rounded px-2 py-0.5 ml-1">
              {data.user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Help banner */}
      <div className="rounded-xl border border-white/10 dark:border-white/5 bg-white/5 dark:bg-black/10 p-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
        <div className="flex items-start gap-2">
          <i className="ph-bold ph-info text-blue-400 mt-0.5" />
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-md border-2 border-dashed border-white/30 dark:border-white/20 bg-white/5 dark:bg-black/20 mr-1.5 align-middle">
                  <i className="ph-bold ph-minus text-gray-400 text-[9px]" />
                </span>
                <strong className="text-black dark:text-white">{t('admin.permsHelpInherit')}</strong>{t('admin.permsHelpInheritDesc')}
              </span>
              <span>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-md border-2 bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] border-[#7B5AFF] mr-1.5 align-middle">
                  <i className="ph-bold ph-check text-white text-[9px]" />
                </span>
                <strong className="text-black dark:text-white">{t('admin.permsHelpGrant')}</strong>{t('admin.permsHelpGrantDesc')}
              </span>
              <span>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-md border-2 border-red-500/60 bg-red-500/15 mr-1.5 align-middle">
                  <i className="ph-bold ph-x text-red-300 text-[9px]" />
                </span>
                <strong className="text-black dark:text-white">{t('admin.permsHelpDeny')}</strong>{t('admin.permsHelpDenyDesc')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {rowError && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          <strong>{rowError.category}:</strong> {rowError.message}
        </div>
      )}

      {/* Matrix */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th className="text-left font-bold pb-2 pr-3">{t('admin.permsColCategory')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColRole')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColRead')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColWrite')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColDelete')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColEffective')}</th>
              <th className="text-center font-bold pb-2 px-2">{t('admin.permsColSource')}</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-xs text-gray-500 dark:text-gray-400 py-6">
                  {t('admin.permsNoCategories')}
                </td>
              </tr>
            )}
            {categories.map((category) => {
              const role = data.rolePermissions?.[category];
              const override =
                localOverrides[category] ?? { canRead: null, canWrite: null, canDelete: null };
              const effective = data.effective?.[category];
              const isPending = (action: Action) => pending.has(`${category}|${action}`);
              const readSource = resolveSource(effective?.read, role?.read, override.canRead);
              const writeSource = resolveSource(effective?.write, role?.write, override.canWrite);
              const deleteSource = resolveSource(effective?.delete, role?.delete, override.canDelete);
              return (
                <tr
                  key={category}
                  className="border-t border-white/5 dark:border-white/5 hover:bg-white/5 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-2.5 pr-3 text-sm text-black dark:text-white align-middle">
                    {category}
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <RoleBaselineChip bucket={role} />
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <div className="flex justify-center">
                      <TriStateCheckbox
                        value={override.canRead}
                        onChange={(next) => applyChange(category, 'canRead', next)}
                        size="sm"
                        disabled={isPending('canRead')}
                        ariaLabel={t('admin.permsOverrideOpRead', { category })}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <div className="flex justify-center">
                      <TriStateCheckbox
                        value={override.canWrite}
                        onChange={(next) => applyChange(category, 'canWrite', next)}
                        size="sm"
                        disabled={isPending('canWrite')}
                        ariaLabel={t('admin.permsOverrideOpWrite', { category })}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <div className="flex justify-center">
                      <TriStateCheckbox
                        value={override.canDelete}
                        onChange={(next) => applyChange(category, 'canDelete', next)}
                        size="sm"
                        disabled={isPending('canDelete')}
                        ariaLabel={t('admin.permsOverrideOpDelete', { category })}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <RoleBaselineChip bucket={effective} />
                  </td>
                  <td className="py-2.5 px-2 text-center align-middle">
                    <div className="inline-flex flex-wrap items-center justify-center gap-1">
                      <SourcePill op="R" source={readSource} />
                      <SourcePill op="W" source={writeSource} />
                      <SourcePill op="D" source={deleteSource} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── Top-level Panel ───────────────────────────────────────────────────────

/**
 * Props:
 *   - forcedUserId — when set, hide the search card + page header and auto-load
 *     that user's permissions on mount. Used by UserEditPage and any
 *     deep-link-style embedding. Default: standalone full-page with search.
 *   - hideHeader   — drop the page-level title/intro (useful when embedded
 *     inside another card that already has its own heading).
 */
interface PermissionOverridesPanelProps {
  forcedUserId?: string;
  hideHeader?: boolean;
}

const PermissionOverridesPanel: FC<PermissionOverridesPanelProps> = ({
  forcedUserId,
  hideHeader,
}) => {
  const t = useT();
  const [selectedUser, setSelectedUser] = useState<UserHit | null>(null);
  const [data, setData] = useState<PermissionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks the user id we're loading data for, so a fast user-switch doesn't
  // race the in-flight fetch.
  const loadIdRef = useRef<string | null>(null);

  const loadFor = useCallback(async (userId: string) => {
    loadIdRef.current = userId;
    setLoading(true);
    setError(null);
    // Preview mode — resolve the user from the static directory and synthesise
    // the permissions payload locally. No network.
    const hit = MOCK_USERS.find((u) => u.id === userId);
    if (!hit) {
      setError(t('admin.permsLoadFailed', { status: 404 }));
      setData(null);
      setLoading(false);
      return;
    }
    const json = buildPermissionsResponse(hit);
    setData(json);
    setSelectedUser(json.user);
    setLoading(false);
  }, [t]);

  const handleSelect = useCallback(
    (u: UserHit) => {
      setSelectedUser(u);
      loadFor(u.id);
    },
    [loadFor],
  );

  const handleRefresh = useCallback(async () => {
    const id = forcedUserId ?? selectedUser?.id;
    if (id) await loadFor(id);
  }, [forcedUserId, selectedUser, loadFor]);

  // Auto-load when embedded with a forced user id. Re-runs if the id changes
  // (e.g. admin navigates from one user edit page to another without unmount).
  useEffect(() => {
    if (forcedUserId) {
      loadFor(forcedUserId);
    }
    // intentional: re-fire whenever the embedded id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedUserId]);

  const showHeader = !hideHeader && !forcedUserId;
  const showSearch = !forcedUserId;
  const activeUser = selectedUser;

  return (
    <div className="space-y-6">
      {showHeader && (
        <div className="mb-2">
          <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.permsOverridePanelTitle')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {t('admin.permsOverrideSubtitle')}
          </p>
        </div>
      )}

      {showSearch && (
        <UserSearch selectedId={activeUser?.id ?? null} onSelect={handleSelect} />
      )}

      {(forcedUserId || activeUser) && loading && (
        <div className={`${glassCardStyle} p-5 text-sm text-gray-500 dark:text-gray-400`}>
          <i className="ph-bold ph-circle-notch animate-spin mr-2"></i>
          {activeUser
            ? t('admin.permsLoadingFor', { name: `${activeUser.firstName} ${activeUser.lastName}` })
            : t('admin.permsLoadingNoUser')}
        </div>
      )}

      {(forcedUserId || activeUser) && !loading && error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>
          {error}
        </div>
      )}

      {(forcedUserId || activeUser) && !loading && !error && data && (
        <OverrideMatrix data={data} onRefresh={handleRefresh} />
      )}

      {!forcedUserId && !activeUser && (
        <div className={`${glassCardStyle} p-8 text-center text-sm text-gray-500 dark:text-gray-400`}>
          <i className="ph-bold ph-user-gear text-3xl text-[#6A3FF4]/60 mb-2 block" />
          {t('admin.permsEmptyPickHint')}
        </div>
      )}
    </div>
  );
};

export default PermissionOverridesPanel;
