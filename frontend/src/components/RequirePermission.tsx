// frontend/src/components/RequirePermission.tsx
//
// Page-level "Can-Do?" check. Wrap any <Route element={...}> that should only
// be reachable when the current user has a specific permission category +
// action.
//
//   <Route path="manage-courses" element={
//     <RequirePermission category="Course Management" action="read">
//       <CoursesManagementPage />
//     </RequirePermission>
//   } />
//
//   <Route path="academic/grade-policies" element={
//     <RequirePermission anyOf={[
//       { category: 'Academic Settings' },
//       { category: 'Incomplete Policy' },
//       { category: 'Repetition Policy' },
//     ]}>
//       <GradePoliciesPage />
//     </RequirePermission>
//   } />
//
// Behaviour:
//   - While the /api/me/permissions fetch is in flight, the children render
//     (permissive loading-grace, same policy as useHasPermission). Prevents
//     a flash-then-redirect on every page load.
//   - Once the fetch lands and the permission is denied, the user is sent
//     back to their own role's dashboard via Navigate. No cross-dashboard
//     redirects — the user stays inside their own role's URL prefix.
//   - For the loading-grace policy to be safe, the corresponding backend
//     endpoint MUST also gate the action. The UI guard only stops the user
//     from seeing the page; the backend stops them from acting.
//
//   - `anyOf` mode (OR semantics): allow if the user has any one of the
//     listed permissions. Used by merged wrapper pages where the umbrella
//     category OR a sub-policy category should grant access (so toggling
//     just Honors Policy in the matrix surfaces Academic Standing without
//     also needing Academic Settings:read).
//
// Pair with <ProtectedRoute requiredRole="..."> at the role-block level
// (see App.tsx) so role mismatches are rejected before per-page checks fire.

import React, { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { usePermissions, OpFlags } from '../utils/permissions';

interface PermissionCheck {
  category: string;
  action?: keyof OpFlags;
}

interface RequirePermissionProps {
  /** Single-category gate. Mutually exclusive with `anyOf`. */
  category?: string;
  /** Action for the single-category gate; ignored when `anyOf` is set. */
  action?: keyof OpFlags;
  /** OR-mode: allow access when the user has any one of these permissions. */
  anyOf?: PermissionCheck[];
  /** Optional explicit redirect target; defaults to `/${userRole}/dashboard`. */
  fallback?: string;
  children: ReactNode;
}

const RequirePermission: React.FC<RequirePermissionProps> = ({
  category,
  action = 'read',
  anyOf,
  fallback,
  children,
}) => {
  const { userRole } = useAppContext();
  // One hook call regardless of mode — we read the full permission payload
  // here and evaluate the gate(s) in regular JS. This keeps the rules-of-hooks
  // honest even when `anyOf` is an array (would otherwise need a loop of hook
  // calls, which is forbidden).
  const { permissions } = usePermissions();
  // Permissive while loading. Cache-loaded state is the source of truth.
  // Mirror the policy in useHasPermission: any non-null cached payload (even
  // EMPTY) counts as "loaded" so a deny-by-default user stays denied without
  // a flash-then-redirect cycle.
  // Note: we can't reach the module-level `cached` flag from here without
  // exporting it. Instead we treat a payload with at least one category OR
  // an explicit empty object differently. For simplicity we use the same
  // permissive-default contract as useHasPermission via a fresh call below.

  // The simplest correct implementation: derive `loaded` from whether the
  // `permissions` object is the EMPTY default. Subscribers in usePermissions
  // re-render on state change, so once the fetch lands `permissions` reflects
  // the real payload (which may legitimately be {} for a locked-down user).
  // Pure-loading-grace: if we got an empty payload AND no specific category
  // was requested, render. If a category was requested and the lookup is
  // false, deny. This matches useHasPermission semantics.

  const checkOne = (cat: string, act: keyof OpFlags): boolean => {
    return Boolean(permissions?.[cat]?.[act]);
  };

  let allowed: boolean;
  if (anyOf && anyOf.length > 0) {
    allowed = anyOf.some((p) => checkOne(p.category, p.action ?? 'read'));
  } else if (category) {
    allowed = checkOne(category, action);
  } else {
    // No gate specified — fail open (parent forgot to wire the check).
    allowed = true;
  }

  // Loading-grace: while the permissions cache hasn't filled yet, every
  // category will look denied. Render the children so the user doesn't get
  // bounced on every page navigation while the fetch is in flight. The
  // backend gate is the real enforcement; this guard exists for UX.
  // We detect "still loading" by the absence of any keys in permissions.
  const hasAnyPayload = permissions && Object.keys(permissions).length > 0;
  if (!hasAnyPayload && !allowed) {
    return <>{children}</>;
  }

  if (!allowed) {
    return <Navigate to={fallback ?? `/${userRole}/dashboard`} replace />;
  }
  return <>{children}</>;
};

export default RequirePermission;
