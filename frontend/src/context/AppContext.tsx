import { createContext, useContext, useState, ReactNode, useMemo, useEffect, useCallback } from 'react';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { isPreviewSession } from '../utils/previewSession';

export type UserRole = 'student' | 'admin' | 'ta' | 'professor' | 'sa' | 'financial' | 'it';
export type Language = 'en' | 'ar';

// Plan 5 Phase 6 — view-as session metadata. When the admin clicks
// "View as user" on UserEditPage, we swap in a short-lived JWT carrying
// mode='view-as' + impersonatorId. The frontend reads these claims to
// render the ImpersonationBanner at the top of every page and to disable
// write affordances (the backend hard-rejects writes regardless).
export interface ImpersonationContext {
    impersonatorId: string;
    impersonatorEmail?: string;
    targetUserId: string;
    targetEmail?: string;
    targetRole: UserRole;
    expiresAt?: number; // ms since epoch
}

export interface AppContextType {
    activeNavItem: string;
    setActiveNavItem: (item: string) => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    isAuthenticated: boolean;
    setIsAuthenticated: (isAuth: boolean) => void;
    userRole: UserRole;
    setUserRole: (role: UserRole) => void;
    isDarkMode: boolean;
    toggleDarkMode: () => void;
    language: Language;
    setLanguage: (lang: Language) => void;
    // Plan 8 Phase 2 — decorative animations toggle. When false, the
    // <html> root gets a `no-anim` class that kills keyframe + transition
    // durations app-wide. Essential animations (toasts, modals, loaders,
    // click feedback) opt-out via the `.anim-essential` class.
    //
    // - `animationsEnabled` is the EFFECTIVE state (user pref AND-ed with the
    //   inverse of OS prefers-reduced-motion). Use this in app code that wants
    //   to know "should I animate right now?".
    // - `animationsPreference` is the RAW user choice — what the Settings
    //   toggle should reflect + flip, regardless of OS override.
    // - `prefersReducedMotion` reports the OS-level setting so the UI can
    //   show a hint when it's overriding the user pref.
    animationsEnabled: boolean;
    animationsPreference: boolean;
    prefersReducedMotion: boolean;
    setAnimationsEnabled: (v: boolean) => void;
    refreshUser: () => void;
    impersonation: ImpersonationContext | null;
    exitImpersonation: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppContext = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
};

// Tab-close signout marker key. Stored in sessionStorage so it survives
// reloads but is wiped when the tab/window is closed. If we boot the app
// and find an authToken in localStorage but no marker in sessionStorage,
// we know the previous tab closed and force a re-login.
const SESSION_MARKER_KEY = 'uniflow:session-active';

// Idle signout — log the user out after this many ms of zero activity.
// Pointer / keyboard / scroll resets the counter. 1 hour matches the
// owner's directive to "preserve memory from people who are idling".
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

// Keys we wipe on logout / tab-close detection.
const AUTH_LOCALSTORAGE_KEYS = [
    'currentUserRole',
    'currentUserEmail',
    'currentUserId',
    'currentUserOdId',
    'currentUserFirstName',
    'currentUserLastName',
    'currentUserPicture',
    'authToken',
    'refreshToken',
    'previewSession',
];

function wipeAuthStorage(): void {
    for (const key of AUTH_LOCALSTORAGE_KEYS) localStorage.removeItem(key);
    sessionStorage.removeItem(SESSION_MARKER_KEY);
}

// Returns the role to boot with, OR null when the previous tab closed and we
// need to force a fresh login. Side-effect: wipes localStorage on detection.
function bootAuthCheck(): UserRole | null {
    const role = localStorage.getItem('currentUserRole') as UserRole | null;
    if (!role) return null;
    const marker = sessionStorage.getItem(SESSION_MARKER_KEY);
    if (!marker) {
        // Tab was closed since the credentials were written. Wipe everything
        // so the user lands on /login.
        wipeAuthStorage();
        return null;
    }
    return role;
}

export const AppProvider = ({ children }: { children: ReactNode }) => {
    // CRITICAL: bootAuthCheck() has a side effect (wipes localStorage when
    // it detects a closed-tab signature). It MUST run exactly once per
    // AppProvider mount. Calling it in the component body would re-run on
    // every render — including the post-login re-render where
    // localStorage IS populated but the sessionStorage marker effect
    // hasn't fired yet — which would wipe the just-written auth keys.
    // Wrapping in a useState initializer guarantees one-time execution.
    const [bootedRole] = useState<UserRole | null>(() => bootAuthCheck());
    const [userRole, setUserRole] = useState<UserRole>(bootedRole || 'student');
    const [isAuthenticated, setIsAuthenticated] = useState(!!bootedRole);

    const [activeNavItem, setActiveNavItem] = useState('Dashboard');
    const [searchTerm, setSearchTerm] = useState('');
    
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const savedMode = localStorage.getItem('darkMode');
        if (savedMode !== null) {
            return JSON.parse(savedMode);
        }
        // Default to dark mode if no preference is saved
        return true;
    });

    useEffect(() => {
        localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [isDarkMode]);

    const toggleDarkMode = () => {
        setIsDarkMode((prevMode: boolean) => !prevMode);
    };

    // ── Animations toggle (Plan 8 Phase 2) ──────────────────────────────────
    // Starts ON. Respects OS-level prefers-reduced-motion: even when the
    // user setting is true, the OS setting forces decorative animations off.
    // Persisted to localStorage so the choice survives reload; the user
    // Settings page also PATCHes UserSettings.animationsEnabled on change
    // so the choice follows the user across devices.
    const [animationsEnabledState, setAnimationsEnabledState] = useState<boolean>(() => {
        const stored = localStorage.getItem('animationsEnabled');
        if (stored === null) return true;
        return stored === 'true';
    });

    // OS-level reduce-motion is held in state + subscribed via matchMedia so
    // a user flipping the OS toggle while the app is open causes a re-render.
    // Checked client-side only — falls back to `false` during SSR-ish render
    // when `window.matchMedia` isn't available.
    const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
        // Safari < 14 only supports the deprecated `addListener` API.
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else mq.addListener(handler);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', handler);
            else mq.removeListener(handler);
        };
    }, []);
    const animationsEnabled = animationsEnabledState && !prefersReducedMotion;

    useEffect(() => {
        localStorage.setItem('animationsEnabled', String(animationsEnabledState));
        if (animationsEnabled) {
            document.documentElement.classList.remove('no-anim');
        } else {
            document.documentElement.classList.add('no-anim');
        }
    }, [animationsEnabled, animationsEnabledState]);

    const setAnimationsEnabled = useCallback((v: boolean) => {
        setAnimationsEnabledState(v);
        // Best-effort cross-device sync via UserSettings. Silent on failure —
        // the local choice still wins on this device.
        const userId = localStorage.getItem('currentUserId');
        if (userId && !isPreviewSession()) {
            fetch(`${API_URLS.userProfile()}/api/settings/${userId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ animationsEnabled: v }),
            }).catch(() => {});
        }
    }, []);

    // ── Language (i18n) ──────────────────────────────────────────────────────
    // Stored in localStorage so it survives reloads. Setting `ar` flips
    // <html dir="rtl"> + adds a `lang-ar` class for any RTL-specific Tailwind
    // overrides. The actual translations live in `src/i18n/translations.ts`
    // and are looked up via the `useT()` hook from `src/i18n`.
    const [language, setLanguageState] = useState<Language>(() => {
        const stored = localStorage.getItem('uniflowLang');
        return stored === 'ar' ? 'ar' : 'en';
    });

    useEffect(() => {
        localStorage.setItem('uniflowLang', language);
        const html = document.documentElement;
        html.lang = language;
        html.dir = language === 'ar' ? 'rtl' : 'ltr';
        if (language === 'ar') {
            html.classList.add('lang-ar');
            html.classList.remove('lang-en');
        } else {
            html.classList.add('lang-en');
            html.classList.remove('lang-ar');
        }
    }, [language]);

    const setLanguage = useCallback((lang: Language) => {
        setLanguageState(lang);
    }, []);

    const handleLogout = useCallback(() => {
        // Fire-and-forget backend logout — revokes the refresh token. We
        // don't await this; the local wipe + redirect happens immediately.
        const token = localStorage.getItem('authToken');
        if (token && !isPreviewSession()) {
            fetch(`${API_URLS.userProfile()}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => { /* ignore */ });
        }
        setIsAuthenticated(false);
        setUserRole('student');
        wipeAuthStorage();
    }, []);

    // ── Tab-close signout marker ────────────────────────────────────────────
    // Whenever the user is authenticated, stamp the session marker. On
    // logout, clear it. The boot check at the top of AppProvider treats
    // "authToken present + marker missing" as evidence the previous tab
    // closed and forces a re-login.
    //
    // Also dispatches `uniflow:auth-changed` so other contexts that depend on
    // login state (e.g. NotificationContext's socket initialiser) can
    // re-evaluate WITHOUT a full page reload after the user signs in.
    useEffect(() => {
        if (isAuthenticated) {
            sessionStorage.setItem(SESSION_MARKER_KEY, '1');
        } else {
            sessionStorage.removeItem(SESSION_MARKER_KEY);
        }
        try {
            window.dispatchEvent(
                new CustomEvent('uniflow:auth-changed', {
                    detail: { isAuthenticated },
                }),
            );
        } catch { /* CustomEvent unavailable on ancient browsers */ }
    }, [isAuthenticated]);

    // ── Cross-tab session detection ──────────────────────────────────────────
    // Multiple tabs of the same browser share localStorage. If tab B signs in
    // as a different user, tab A would silently keep showing the old role's
    // dashboard with the new user's name (because Header reads name from
    // localStorage but route gates use the React state). On any cross-tab
    // currentUserId / authToken change we (a) flash a one-time alert so the
    // user understands what happened, then (b) hard reload the tab so React
    // state realigns with the new identity. The marker only fires when the
    // value actually changed — same-user re-login in the same tab is a no-op.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onStorage = (e: StorageEvent) => {
            if (!e.key || (e.key !== 'currentUserId' && e.key !== 'authToken')) return;
            if (e.oldValue === e.newValue) return;
            // Don't fire on logout (newValue null) — the logout listener
            // already redirects to /login.
            if (!e.newValue) return;
            try {
                window.alert(
                    'A different account just signed in on another tab in this browser.\n\n' +
                    'For security, this tab will reload to switch to the new session.',
                );
            } catch { /* alert blocked — fall through to reload anyway */ }
            window.location.reload();
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    // ── Idle-timeout signout ────────────────────────────────────────────────
    // 1 hour of zero pointer / keyboard / scroll activity → automatic logout.
    // Owner directive: "preserve memory from people who are idling". Only
    // runs while authenticated to avoid wasting cycles on /login.
    useEffect(() => {
        if (!isAuthenticated) return;

        let lastActivity = Date.now();
        const bumpActivity = () => { lastActivity = Date.now(); };

        const events: (keyof WindowEventMap)[] = [
            'mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown',
        ];
        events.forEach((ev) => window.addEventListener(ev, bumpActivity, { passive: true }));

        const interval = setInterval(() => {
            if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
                handleLogout();
                // Hard navigate so all in-flight component state is dropped.
                window.location.assign('/login');
            }
        }, 60_000); // check once per minute — generous; the redirect happens within ≤60s of the deadline

        return () => {
            events.forEach((ev) => window.removeEventListener(ev, bumpActivity));
            clearInterval(interval);
        };
    }, [isAuthenticated, handleLogout]);

    const handleSetAuthenticated = useCallback((isAuth: boolean) => {
        if (!isAuth) {
            handleLogout();
        } else {
            setIsAuthenticated(true);
        }
    }, [handleLogout]);

    const refreshUser = useCallback(() => {
        const role = localStorage.getItem('currentUserRole') as UserRole | null;
        setIsAuthenticated(!!role);
        if (role) setUserRole(role);
    }, []);

    // ── Plan 5 Phase 6 — Impersonation detection ───────────────────────────
    // Decodes the current authToken once on mount + whenever the token
    // changes (storage event). If the JWT carries mode='view-as', we expose
    // an ImpersonationContext so the banner can render and so other code
    // can detect the read-only state.
    const [impersonation, setImpersonation] = useState<ImpersonationContext | null>(null);

    const decodeImpersonation = useCallback(() => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            setImpersonation(null);
            return;
        }
        try {
            // Standard JWT payload decode (not validation — the backend is the
            // source of truth; this is only for UI hints).
            const parts = token.split('.');
            if (parts.length !== 3) return setImpersonation(null);
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (payload?.mode === 'view-as' && payload.impersonatorId) {
                setImpersonation({
                    impersonatorId: payload.impersonatorId,
                    impersonatorEmail: payload.impersonatorEmail,
                    targetUserId: payload.userId,
                    targetEmail: payload.email,
                    targetRole: (payload.role as UserRole) || 'student',
                    expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : undefined,
                });
            } else {
                setImpersonation(null);
            }
        } catch {
            setImpersonation(null);
        }
    }, []);

    useEffect(() => {
        decodeImpersonation();
        // Re-decode on cross-tab storage changes so swapping the token in
        // another tab updates the banner here too.
        const onStorage = (ev: StorageEvent) => {
            if (ev.key === 'authToken') decodeImpersonation();
        };
        window.addEventListener('storage', onStorage);
        // Local event fired right after a manual swap (same tab).
        window.addEventListener('uniflow:auth-token-swapped', decodeImpersonation as EventListener);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('uniflow:auth-token-swapped', decodeImpersonation as EventListener);
        };
    }, [decodeImpersonation]);

    const exitImpersonation = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        // Fire-and-forget the audit-log endpoint; we don't gate on success.
        if (token) {
            fetch(`${API_URLS.userProfile()}/api/admin/sessions/impersonate/exit`, {
                method: 'POST',
                credentials: 'include',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
        }
        // Restore the admin's pre-impersonation auth state.
        const prevToken = localStorage.getItem('preImpersonationToken');
        const prevRole = localStorage.getItem('preImpersonationRole') as UserRole | null;
        const prevUserId = localStorage.getItem('preImpersonationUserId');
        const prevEmail = localStorage.getItem('preImpersonationEmail');
        const prevFirstName = localStorage.getItem('preImpersonationFirstName');
        const prevLastName = localStorage.getItem('preImpersonationLastName');
        if (prevToken) localStorage.setItem('authToken', prevToken);
        if (prevRole) localStorage.setItem('currentUserRole', prevRole);
        if (prevUserId) localStorage.setItem('currentUserId', prevUserId);
        if (prevEmail) localStorage.setItem('currentUserEmail', prevEmail);
        if (prevFirstName) localStorage.setItem('currentUserFirstName', prevFirstName);
        if (prevLastName) localStorage.setItem('currentUserLastName', prevLastName);
        localStorage.removeItem('preImpersonationToken');
        localStorage.removeItem('preImpersonationRole');
        localStorage.removeItem('preImpersonationUserId');
        localStorage.removeItem('preImpersonationEmail');
        localStorage.removeItem('preImpersonationFirstName');
        localStorage.removeItem('preImpersonationLastName');
        setImpersonation(null);
        if (prevRole) setUserRole(prevRole);
        window.dispatchEvent(new CustomEvent('uniflow:auth-token-swapped'));
        // Hard-redirect to the admin home so the route guards don't bounce
        // us back into a half-loaded student page.
        window.location.assign('/');
    }, []);

    // Presence heartbeat — keeps the admin's "online users" count accurate.
    // Hits user-profile :4007 /api/auth/verify every 60s while authenticated;
    // the backend records a last-seen timestamp per userId. Closing the tab
    // stops the heartbeat → user falls out of the online window (~2 min).
    useEffect(() => {
        // Preview (mock-role) sessions never authenticate — skip the presence
        // heartbeat so they make zero backend calls.
        if (!isAuthenticated || isPreviewSession()) return;

        const beat = () => {
            fetch(`${API_URLS.userProfile()}/api/auth/verify`, {
                credentials: 'include',
                headers: authHeaders(),
            }).catch(() => { /* silent — auth interceptor handles 401s */ });
        };

        beat(); // fire immediately on mount / auth change
        const interval = setInterval(beat, 60_000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    const value = useMemo(() => ({
        activeNavItem,
        setActiveNavItem,
        searchTerm,
        setSearchTerm,
        isAuthenticated,
        setIsAuthenticated: handleSetAuthenticated,
        userRole,
        setUserRole,
        isDarkMode,
        toggleDarkMode,
        language,
        setLanguage,
        animationsEnabled,
        animationsPreference: animationsEnabledState,
        prefersReducedMotion,
        setAnimationsEnabled,
        refreshUser,
        impersonation,
        exitImpersonation,
    }), [activeNavItem, searchTerm, isAuthenticated, handleSetAuthenticated, userRole, isDarkMode, language, setLanguage, animationsEnabled, animationsEnabledState, prefersReducedMotion, setAnimationsEnabled, refreshUser, impersonation, exitImpersonation]);
    
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
