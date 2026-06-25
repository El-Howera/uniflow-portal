/**
 * Preview-session mode.
 *
 * This build ships with a fully functional backend for ONLY the student and
 * professor roles. The other five role dashboards (TA, Student Affairs, Admin,
 * Financial, IT) are pure front-end mockups — they render from static data and
 * never talk to a backend (there is none for them in this build).
 *
 * A "preview session" is a client-only session created when someone picks one of
 * those five roles on the sign-in screen. It writes the same localStorage keys
 * a real login would (so the app shell, sidebar, and Header all behave), but:
 *   - it sets `previewSession=true`
 *   - it does NOT mint an authToken / refreshToken
 *
 * Every shared context + the permission client check `isPreviewSession()` and
 * short-circuit their network effects so a preview session makes ZERO requests.
 * The student/professor flows (real login → real authToken, previewSession unset)
 * are completely unaffected.
 */

export const PREVIEW_ROLES = ['ta', 'sa', 'admin', 'financial', 'it'] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

interface PreviewProfile {
  firstName: string;
  lastName: string;
  email: string;
  odId: string;
}

const PREVIEW_PROFILES: Record<PreviewRole, PreviewProfile> = {
  ta: { firstName: 'Layla', lastName: 'Hassan', email: 'ta@preview.uniflow', odId: 'PREVIEW-TA' },
  sa: { firstName: 'Omar', lastName: 'Farouk', email: 'sa@preview.uniflow', odId: 'PREVIEW-SA' },
  admin: { firstName: 'Mona', lastName: 'Adel', email: 'admin@preview.uniflow', odId: 'PREVIEW-ADMIN' },
  financial: { firstName: 'Karim', lastName: 'Saleh', email: 'financial@preview.uniflow', odId: 'PREVIEW-FIN' },
  it: { firstName: 'Nour', lastName: 'Ibrahim', email: 'it@preview.uniflow', odId: 'PREVIEW-IT' },
};

export const PREVIEW_ROLE_LABELS: Record<PreviewRole, string> = {
  ta: 'Teaching Assistant',
  sa: 'Student Affairs',
  admin: 'Administrator',
  financial: 'Financial',
  it: 'IT',
};

export const PREVIEW_ROLE_ICONS: Record<PreviewRole, string> = {
  ta: 'ph-chalkboard-teacher',
  sa: 'ph-users-three',
  admin: 'ph-shield-star',
  financial: 'ph-currency-circle-dollar',
  it: 'ph-wrench',
};

/** True when the current session is a client-only preview session (one of the 5 mock roles). */
export function isPreviewSession(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('previewSession') === 'true';
  } catch {
    return false;
  }
}

/** True when `role` is one of the five mock (no-backend) roles. */
export function isPreviewRole(role: string | null | undefined): role is PreviewRole {
  return !!role && (PREVIEW_ROLES as readonly string[]).includes(role);
}

/**
 * Establish a client-only preview session for one of the five mock roles. Mirrors
 * the localStorage keys a real login writes (minus the tokens) so the app shell,
 * route guards, and Header render correctly. Caller then runs the normal
 * `onLogin(role)` transition.
 */
export function startPreviewSession(role: PreviewRole): void {
  const p = PREVIEW_PROFILES[role];
  try {
    localStorage.setItem('previewSession', 'true');
    localStorage.setItem('currentUserRole', role);
    localStorage.setItem('currentUserId', `preview-${role}`);
    localStorage.setItem('currentUserOdId', p.odId);
    localStorage.setItem('currentUserEmail', p.email);
    localStorage.setItem('currentUserFirstName', p.firstName);
    localStorage.setItem('currentUserLastName', p.lastName);
    localStorage.setItem('currentUserPicture', '');
    // No tokens — a preview session never authenticates.
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    // Mark the tab session active so AppContext.bootAuthCheck keeps the preview
    // session alive across a reload instead of bouncing to /login.
    sessionStorage.setItem('uniflow:session-active', '1');
  } catch {
    /* storage blocked — preview can't run, but nothing to recover */
  }
}
