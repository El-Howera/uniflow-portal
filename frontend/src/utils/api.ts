export function authHeaders(): HeadersInit {
  const token = localStorage.getItem('authToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function unwrap<T>(envelope: unknown, key: string, fallback: T): T {
  if (Array.isArray(envelope)) return envelope as unknown as T;
  if (envelope && typeof envelope === 'object' && key in (envelope as object)) {
    const val = (envelope as Record<string, unknown>)[key];
    if (Array.isArray(val)) return val as unknown as T;
  }
  return fallback;
}

let _refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh calls — only one in-flight at a time
  if (_refreshing) return _refreshing;

  _refreshing = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      // Import here to avoid circular deps — shared/config is pure TS constants
      const { API_URLS } = await import('@shared/config');
      const res = await fetch(`${API_URLS.userProfile()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // Surface the "you were kicked because someone else signed in"
        // case so the caller can show a friendlier overlay instead of a
        // generic "session expired" message. The backend tags revoked
        // tokens with error='session_revoked' + reason='signed_in_elsewhere'.
        try {
          const body = await res.clone().json();
          if (body?.error === 'session_revoked') {
            sessionStorage.setItem('uniflow:logout-reason', 'signed_in_elsewhere');
          }
        } catch { /* body wasn't JSON */ }
        return false;
      }
      const data = await res.json();
      if (!data.token) return false;
      localStorage.setItem('authToken', data.token);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await _refreshing;
  } finally {
    _refreshing = null;
  }
}

function clearAuthAndRedirect(): void {
  // Read the logout reason BEFORE we wipe storage so the message survives
  // the post-redirect mount of /login. sessionStorage so it doesn't bleed
  // across tabs / browser restarts.
  const reason = sessionStorage.getItem('uniflow:logout-reason');
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUserRole');
  localStorage.removeItem('currentUserId');
  localStorage.removeItem('currentUserEmail');
  // Show the SessionEndedOverlay (mounted at App root) instead of a
  // browser alert. The overlay owns the redirect — it wipes auth and
  // navigates when the user clicks "Sign in again" — so we don't
  // redirect here, just dispatch and let the overlay take over. For
  // any reason we don't have a tailored overlay message for (generic
  // expiry without a known reason code), we still redirect immediately
  // so the user isn't stuck looking at a stale dashboard.
  if (reason) {
    window.dispatchEvent(new CustomEvent('uniflow:session-ended', { detail: { reason } }));
    window.dispatchEvent(new CustomEvent('uniflow:auth-expired', { detail: { reason } }));
    return;
  }
  // Dispatch a custom event so AppContext can react (set isAuthenticated=false)
  window.dispatchEvent(new CustomEvent('uniflow:auth-expired', { detail: { reason } }));
  window.location.href = '/login';
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const buildHeaders = () => {
    const headers = new Headers({
      ...(init.headers as Record<string, string> || {}),
      ...(authHeaders() as Record<string, string>),
    });
    if (init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  };

  // First attempt
  let response = await fetch(url, { ...init, credentials: 'include', headers: buildHeaders() });

  // 401 = no token / expired token (TokenExpiredError)
  // 403 with "Token expired" body = legacy servers that haven't been updated yet
  const needsRefresh = response.status === 401 || await (async () => {
    if (response.status !== 403) return false;
    try {
      const clone = response.clone();
      const body = await clone.json() as { error?: string };
      return body?.error === 'Token expired';
    } catch { return false; }
  })();

  if (!needsRefresh) return response;

  // Token expired — try to refresh
  const refreshed = await tryRefresh();
  if (!refreshed) {
    clearAuthAndRedirect();
    return response; // caller receives original response; redirect happens async
  }

  // Retry with new token
  response = await fetch(url, { ...init, credentials: 'include', headers: buildHeaders() });

  if (response.status === 401) {
    // Refresh token itself is invalid/expired — force logout
    clearAuthAndRedirect();
  }

  return response;
}

/**
 * Authenticated PDF / file open. Plain `<a href>` links can't carry the
 * `Authorization: Bearer` header so protected endpoints reject them with 401.
 * This fetches via `apiFetch` (which handles silent-refresh), turns the body
 * into a blob, and opens it in a new tab. Falls back to a programmatic
 * download click when popups are blocked.
 *
 * Returns true on success, false if the request errored — caller can show a
 * toast / alert in that case.
 */
export async function openAuthedFile(
  url: string,
  filename = 'download.pdf',
): Promise<boolean> {
  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(`Could not open file (HTTP ${res.status}): ${body?.error ?? ''}`);
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const popup = window.open(objectUrl, '_blank');
    if (!popup) {
      // Popup blocked — fall back to a programmatic download click.
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    // Revoke after a delay so the popup has time to render the PDF first.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Network error');
    return false;
  }
}
