// Plan 5 Phase 6 — shared impersonation entry-point.
//
// Both UserEditPage ("View as user" button on the detail card) and
// UserManagement (3-dot row menu) call this. The flow is:
//
//   1. POST /api/admin/sessions/impersonate with { targetUserId }
//   2. Stash the admin's current auth identity to preImpersonation* keys
//      so AppContext.exitImpersonation can restore them later
//   3. Swap localStorage with the new view-as token + target identity
//   4. Dispatch `uniflow:auth-token-swapped` so AppContext re-decodes
//   5. Hard-navigate to the target's role home page

import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const ROLE_HOME: Record<string, string> = {
    student:   '/student/dashboard',
    professor: '/professor/dashboard',
    ta:        '/ta/dashboard',
    sa:        '/sa/dashboard',
    admin:     '/admin/dashboard',
    financial: '/admin/dashboard',
    it:        '/admin/dashboard',
};

export interface ImpersonateTarget {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
}

export interface ImpersonateResult {
    ok: boolean;
    error?: string;
    target?: ImpersonateTarget;
}

export async function startImpersonation(targetUserId: string, opts?: { reason?: string }): Promise<ImpersonateResult> {
    try {
        const res = await apiFetch(`${API_URLS.userProfile()}/api/admin/sessions/impersonate`, {
            method: 'POST',
            body: JSON.stringify({ targetUserId, reason: opts?.reason }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            return { ok: false, error: json?.error || `HTTP ${res.status}` };
        }
        const token: string | undefined = json.token;
        const target = json.target as ImpersonateTarget | undefined;
        if (!token || !target) {
            return { ok: false, error: 'Malformed impersonation response' };
        }

        // Stash admin auth identity.
        const cur = {
            token: localStorage.getItem('authToken') ?? '',
            role: localStorage.getItem('currentUserRole') ?? '',
            userId: localStorage.getItem('currentUserId') ?? '',
            email: localStorage.getItem('currentUserEmail') ?? '',
            firstName: localStorage.getItem('currentUserFirstName') ?? '',
            lastName: localStorage.getItem('currentUserLastName') ?? '',
        };
        localStorage.setItem('preImpersonationToken', cur.token);
        localStorage.setItem('preImpersonationRole', cur.role);
        localStorage.setItem('preImpersonationUserId', cur.userId);
        localStorage.setItem('preImpersonationEmail', cur.email);
        localStorage.setItem('preImpersonationFirstName', cur.firstName);
        localStorage.setItem('preImpersonationLastName', cur.lastName);

        // Swap in the view-as token + target identity.
        localStorage.setItem('authToken', token);
        localStorage.setItem('currentUserRole', target.role);
        localStorage.setItem('currentUserId', target.id);
        localStorage.setItem('currentUserEmail', target.email);
        localStorage.setItem('currentUserFirstName', target.firstName);
        localStorage.setItem('currentUserLastName', target.lastName);
        window.dispatchEvent(new CustomEvent('uniflow:auth-token-swapped'));

        // Hard-navigate so route guards don't bounce us through a half-loaded page.
        window.location.assign(ROLE_HOME[target.role] ?? '/');
        return { ok: true, target };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
    }
}
