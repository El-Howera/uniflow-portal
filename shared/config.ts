/**
 * Shared configuration for web and mobile platforms.
 * Provides platform-aware API base URL resolution.
 */

// Set this to your machine's local IP for mobile development.
// Find it with: ipconfig (Windows) or ifconfig (Mac/Linux).
const DEV_MACHINE_IP = '192.168.1.100';

// Production server URL (update when deploying).
const PRODUCTION_URL = 'https://api.uniflow.example.com';

const isDev =
    typeof process !== 'undefined' &&
    (process.env?.NODE_ENV === 'development' || !process.env?.NODE_ENV);

/**
 * Get the base URL for a given API server port.
 * Works on both web (uses window.location) and mobile (uses configured IP).
 */
export const getApiBaseUrl = (port: number): string => {
    // Allow an explicit override via env var (host without port).
    const envUrl =
        typeof process !== 'undefined' && process.env?.REACT_APP_API_URL;
    if (envUrl) return `${envUrl}:${port}`;

    // Web: use current hostname.
    if (typeof window !== 'undefined' && window.location?.hostname) {
        return `http://${window.location.hostname}:${port}`;
    }

    // Mobile: configured LAN IP in dev, production URL otherwise.
    if (isDev) return `http://${DEV_MACHINE_IP}:${port}`;
    return `${PRODUCTION_URL}:${port}`;
};

/**
 * Server port constants — matching the Express servers under backend/servers/.
 */
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

/**
 * Pre-built URLs for convenience.
 */
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
