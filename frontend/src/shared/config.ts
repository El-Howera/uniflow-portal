/**
 * Shared configuration for web and mobile platforms.
 *
 * Web (browser dev) — talks to each backend service on its own port
 * (`http://localhost:4002`, `:4003`, …). Same behavior the project has had
 * since day one; no migration needed.
 *
 * Capacitor (Android / iOS) — talks to a SINGLE origin via a reverse proxy
 * (Caddy on :8080 locally, fronted by a cloudflared tunnel for off-LAN access).
 * The proxy fans out to the 10 services via path prefixes. This avoids the
 * 10-tunnels-per-service problem and matches how a real production deploy is
 * shaped.
 *
 * Env vars consumed (frontend-only — REACT_APP_ prefix is required by CRA):
 *   REACT_APP_MOBILE_API_BASE   Single-origin base URL for Capacitor builds.
 *                               Example: https://abc-123.trycloudflare.com
 *   REACT_APP_API_URL           (Legacy) Per-port web override.
 *
 * Path prefixes must match docker/caddy/Caddyfile. Backend routes underneath
 * each prefix stay unchanged because Caddy strips the prefix on forward.
 */

import { Capacitor } from '@capacitor/core';

const PRODUCTION_URL = 'https://api.uniflow.example.com';

// IMPORTANT: don't use `typeof process !== 'undefined'` to gate process.env
// access — CRA's webpack DefinePlugin replaces literal `process.env.X`
// references at build time but does NOT create a `process` global in the
// browser bundle, so `typeof process` is `'undefined'` at runtime and the
// AND short-circuits to false. That made every dockerStack / API base
// resolution silently fall through to the legacy `http://hostname:port`
// scheme, producing mixed-content errors against HTTPS deploys.
// Same applies for `process.env?.X` optional chaining — webpack only
// inlines the literal pattern `process.env.X`.
const isDev =
    process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

/**
 * Path prefix for each backend service, keyed by port. Must match Caddyfile.
 */
const SERVICE_PATH: Record<number, string> = {
    4001: '/websocket',
    4002: '/registration',
    4003: '/attendance',
    4004: '/payments',
    4005: '/content',
    4006: '/affairs',
    4007: '/profile',
    4008: '/chatbot',
    4009: '/notification',
    4010: '/chat',
};

/**
 * Returns true when the app is running inside the Capacitor native shell
 * (Android or iOS). Safe to call before Capacitor is fully bootstrapped —
 * isNativePlatform() reads a synchronous flag set at preload time.
 */
export const isNativeApp = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/**
 * Plan 22 Phase 5 — Electron desktop detection.
 *
 * The preload bridge exposes `window.uniflow.isElectron === true`. We
 * also check the userAgent as a belt-and-suspenders fallback so a
 * misconfigured preload doesn't silently demote the app to "web" mode.
 */
export const isElectronApp = (): boolean => {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { uniflow?: { isElectron?: boolean } };
    if (w.uniflow?.isElectron) return true;
    return (
        typeof navigator !== 'undefined' &&
        typeof navigator.userAgent === 'string' &&
        navigator.userAgent.toLowerCase().includes('electron')
    );
};

/**
 * Returns the base URL for a given backend service port.
 *
 * Resolution order:
 *   1. Capacitor native + REACT_APP_MOBILE_API_BASE set → tunnel base + prefix.
 *   2. Capacitor native + no env var → loopback fallback (works in emulator
 *      only — physical devices need the env var set at build time).
 *   3. Web build with REACT_APP_DOCKER_STACK=1 → same-origin + path prefix.
 *      (Plan 15 — production docker-compose stack uses a single nginx
 *      reverse proxy fronting all 10 services via the same /registration,
 *      /chatbot, /chat etc. path prefixes the Caddy mobile proxy uses.)
 *   4. Web + REACT_APP_API_URL set → that host + port (legacy override).
 *   5. Web (default) → http://<current-hostname>:<port>.
 */
export const getApiBaseUrl = (port: number): string => {
    // Plan 22 Phase 5 — Electron desktop. Talks to the deployed backend
    // over HTTPS via a single-origin reverse proxy, mirroring the
    // Capacitor + docker-stack scheme so the same backend route layout
    // serves browser / mobile / desktop without per-shell endpoints.
    //
    // Build-time env: REACT_APP_DESKTOP_API_BASE (e.g. https://app.uniflow.app).
    // Dev: omit the env var and the renderer falls through to the legacy
    // per-port path so `npm run desktop:dev` reaches localhost backends.
    if (isElectronApp()) {
        const desktopBase = process.env.REACT_APP_DESKTOP_API_BASE;
        if (desktopBase) {
            const prefix = SERVICE_PATH[port];
            if (prefix) return `${String(desktopBase).replace(/\/$/, '')}${prefix}`;
            return `${String(desktopBase).replace(/\/$/, '')}:${port}`;
        }
        // Dev: same as web — talk to localhost per port. The dev frontend
        // is served by CRA on :3000 in this mode; backend ports unchanged.
    }

    // Capacitor native — single-origin via proxy.
    if (isNativeApp()) {
        const prefix = SERVICE_PATH[port];
        if (!prefix) {
            // Unknown port — fall back to direct loopback. Should not happen
            // in practice; every entry in PORTS has a path prefix above.
            return `http://10.0.2.2:${port}`;
        }
        const base = process.env.REACT_APP_MOBILE_API_BASE || '';
        if (base) return `${base.replace(/\/$/, '')}${prefix}`;
        // Emulator fallback — 10.0.2.2 reaches the host loopback on Android emulator.
        // For physical devices, REACT_APP_MOBILE_API_BASE MUST be set.
        return `http://10.0.2.2:8080${prefix}`;
    }

    // Plan 15 — docker-compose stack (single nginx in front of every service,
    // path-prefix routing identical to the Caddy mobile proxy). The frontend
    // nginx is on the same origin as the API; the outer reverse-proxy nginx
    // strips the prefix when forwarding upstream.
    const dockerStack = process.env.REACT_APP_DOCKER_STACK;
    if (dockerStack) {
        const prefix = SERVICE_PATH[port];
        if (prefix && typeof window !== 'undefined' && window.location?.origin) {
            return `${window.location.origin}${prefix}`;
        }
    }

    // Web (browser) — keep the per-port shape.
    const envUrl = process.env.REACT_APP_API_URL;
    if (envUrl) return `${envUrl}:${port}`;

    if (typeof window !== 'undefined' && window.location?.hostname) {
        return `http://${window.location.hostname}:${port}`;
    }

    if (isDev) return `http://localhost:${port}`;
    return `${PRODUCTION_URL}:${port}`;
};

export const PORTS = {
    WEBSOCKET: 4001,
    REGISTRATION: 4002,
    ATTENDANCE: 4003,
    PAYMENTS: 4004,
    COURSE_CONTENT: 4005,
    STUDENT_AFFAIRS: 4006,
    USER_PROFILE: 4007,
    CHATBOT: 4008,
    NOTIFICATION: 4009,
    CHAT: 4010,
} as const;

export const API_URLS = {
    websocket: () => getApiBaseUrl(PORTS.WEBSOCKET),
    registration: () => getApiBaseUrl(PORTS.REGISTRATION),
    attendance: () => getApiBaseUrl(PORTS.ATTENDANCE),
    payments: () => getApiBaseUrl(PORTS.PAYMENTS),
    courseContent: () => getApiBaseUrl(PORTS.COURSE_CONTENT),
    studentAffairs: () => getApiBaseUrl(PORTS.STUDENT_AFFAIRS),
    userProfile: () => getApiBaseUrl(PORTS.USER_PROFILE),
    chatbot: () => getApiBaseUrl(PORTS.CHATBOT),
    notification: () => getApiBaseUrl(PORTS.NOTIFICATION),
    chat: () => getApiBaseUrl(PORTS.CHAT),
} as const;

/**
 * Returns the URL + path arguments for `io()` against the given backend port.
 *
 * Background — Socket.io connections cannot just reuse the HTTP base URL when
 * it carries a path prefix (single-origin reverse-proxy mode). The first
 * argument to `io('https://host/chat')` is parsed as `host + namespace=/chat`,
 * NOT `host + base-path=/chat`. Our servers all use the default namespace,
 * so passing a prefixed URL silently lands on the wrong namespace and the
 * connection hangs.
 *
 * The correct shape for proxied deployments is:
 *   io('https://host', { path: '/chat/socket.io/' })
 *
 * For direct-port dev:
 *   io('http://localhost:4010')  // default path /socket.io/
 *
 * This helper picks the right shape regardless of mode. Use everywhere
 * socket.io is initialised so single-origin mode works correctly.
 *
 * Example:
 *   const { url, path } = getSocketEndpoint(PORTS.CHAT);
 *   const s = io(url, { path, transports: ['websocket', 'polling'], auth });
 */
export const getSocketEndpoint = (port: number): { url: string; path?: string } => {
    const base = getApiBaseUrl(port);
    try {
        const u = new URL(base);
        const trimmed = (u.pathname || '').replace(/\/$/, '');
        // Any non-empty path means the base is proxied behind a prefix —
        // socket.io needs the prefix moved into its `path` option.
        if (trimmed && trimmed !== '/') {
            return { url: u.origin, path: `${trimmed}/socket.io/` };
        }
        return { url: base };
    } catch {
        // base wasn't a valid URL (shouldn't happen — kept for safety).
        return { url: base };
    }
};
