/**
 * Firebase Cloud Messaging — client wrapper.
 *
 * Init policy: lazy + tolerant. If any of the required env vars
 * (REACT_APP_FIREBASE_API_KEY, REACT_APP_FIREBASE_PROJECT_ID,
 *  REACT_APP_FIREBASE_MESSAGING_SENDER_ID, REACT_APP_FIREBASE_APP_ID,
 *  REACT_APP_FIREBASE_VAPID_KEY) is missing, every call here is a no-op so
 * the app keeps running without push notifications.
 *
 * After the user grants notification permission we obtain an FCM device
 * token and POST it to the backend at `/api/users/me/fcm-token`.
 *
 * The full Firebase setup steps are documented in `docs/firebase-setup.md`.
 */

import { API_URLS } from '@shared/config';
import { authHeaders } from './api';

// Cached so we don't re-initialise on every call.
let _initialised = false;
let _messaging: import('firebase/messaging').Messaging | null = null;
let _initFailed = false;

const FIREBASE_CONFIG = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};
const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY;

function isConfigured(): boolean {
  return !!(
    FIREBASE_CONFIG.apiKey &&
    FIREBASE_CONFIG.projectId &&
    FIREBASE_CONFIG.messagingSenderId &&
    FIREBASE_CONFIG.appId &&
    VAPID_KEY
  );
}

async function initIfPossible(): Promise<import('firebase/messaging').Messaging | null> {
  if (_initialised) return _messaging;
  if (_initFailed) return null;
  _initialised = true;

  if (!isConfigured()) {
    console.warn(
      '[firebase] Push disabled — missing one or more REACT_APP_FIREBASE_* env ' +
        'vars in frontend/.env. Restart the CRA dev server after editing .env.'
    );
    return null;
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('[firebase] Push disabled — browser does not support service workers.');
    _initFailed = true;
    return null;
  }

  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getMessaging, isSupported } = await import('firebase/messaging');

    const supported = await isSupported().catch(() => false);
    if (!supported) {
      console.warn('[firebase] Push disabled — `isSupported()` returned false for this browser.');
      _initFailed = true;
      return null;
    }

    const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
    _messaging = getMessaging(app);
    console.info(`[firebase] SDK initialised (project=${FIREBASE_CONFIG.projectId})`);
    return _messaging;
  } catch (err) {
    console.warn('[firebase] init failed — push notifications disabled:', err);
    _initFailed = true;
    return null;
  }
}

/**
 * Request browser notification permission and obtain an FCM device token.
 * Returns null when:
 *   - Firebase env vars aren't configured
 *   - the browser doesn't support FCM
 *   - the user denied permission
 *   - getToken throws (typically: missing service worker)
 *
 * Logs every branch so the developer console makes the failure mode obvious
 * (the silent path was the actual reason no token was ever saved).
 */
export async function ensureFcmToken(): Promise<string | null> {
  const messaging = await initIfPossible();
  if (!messaging) return null;

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    console.warn('[firebase] requestPermission threw:', err);
    return null;
  }
  if (permission !== 'granted') {
    console.warn(
      `[firebase] Notification permission is "${permission}". Open browser site ` +
        'settings → Notifications → Allow to enable push.'
    );
    return null;
  }
  console.info('[firebase] Notification permission granted — fetching device token…');

  try {
    const { getToken } = await import('firebase/messaging');
    const swReg = await navigator.serviceWorker
      .register('/firebase-messaging-sw.js')
      .catch((err) => {
        console.warn('[firebase] Service worker registration failed:', err);
        return null;
      });
    if (!swReg) {
      console.warn(
        '[firebase] /firebase-messaging-sw.js could not be registered. Confirm the file ' +
          'is reachable at that path and that FIREBASE_CONFIG inside it is filled in.'
      );
    }
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg ?? undefined,
    });
    if (!token) {
      console.warn('[firebase] getToken returned null — no token issued by FCM.');
      return null;
    }
    console.info(`[firebase] device token obtained (length=${token.length})`);
    return token;
  } catch (err) {
    console.warn('[firebase] getToken failed:', err);
    return null;
  }
}

/**
 * Subscribe a callback to foreground push messages. The browser only fires
 * these while the tab is open; background pushes are handled by the service
 * worker. Returns a teardown function (or no-op when FCM isn't available).
 */
export async function onForegroundPush(
  cb: (payload: import('firebase/messaging').MessagePayload) => void
): Promise<() => void> {
  const messaging = await initIfPossible();
  if (!messaging) return () => {};
  try {
    const { onMessage } = await import('firebase/messaging');
    return onMessage(messaging, cb);
  } catch (err) {
    console.warn('[firebase] onMessage subscription failed:', err);
    return () => {};
  }
}

/**
 * Register the device's FCM token with the backend so server-side fan-out
 * can target it. Returns true only when the token was both obtained AND
 * accepted by the user-profile server.
 */
export async function registerFcmTokenWithBackend(): Promise<boolean> {
  const token = await ensureFcmToken();
  if (!token) return false;
  try {
    const res = await fetch(`${API_URLS.userProfile()}/api/users/me/fcm-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      console.info('[firebase] device token registered with backend ✓');
      return true;
    }
    const body = await res.text().catch(() => '');
    console.warn(
      `[firebase] backend rejected the device token (${res.status}): ${body.slice(0, 200)}`
    );
    return false;
  } catch (err) {
    console.warn('[firebase] failed to register token with backend:', err);
    return false;
  }
}

/**
 * Clear the device's FCM token from the backend (e.g. on logout).
 * Best-effort — failures are swallowed.
 */
export async function clearFcmTokenWithBackend(): Promise<void> {
  try {
    await fetch(`${API_URLS.userProfile()}/api/users/me/fcm-token`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders() as Record<string, string>,
    });
  } catch {
    /* swallow — clearing is best-effort */
  }
}

export const firebase = {
  isConfigured,
  ensureFcmToken,
  onForegroundPush,
  registerFcmTokenWithBackend,
  clearFcmTokenWithBackend,
};
