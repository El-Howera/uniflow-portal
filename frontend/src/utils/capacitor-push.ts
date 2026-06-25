/**
 * Capacitor native push notifications.
 *
 * Browser path uses the firebase/messaging SDK (utils/firebase.ts). The
 * native shell on Android / iOS uses @capacitor/push-notifications instead,
 * which talks to FCM on Android and APNs on iOS via the native side.
 *
 * Either path produces a device token which we POST to the same backend
 * endpoint — `POST /api/users/me/fcm-token` — so the server-side fan-out
 * (backend/lib/firebase.js) doesn't care which client sent it.
 *
 * Required setup for native push to actually deliver messages:
 *   Android:
 *     - Drop `google-services.json` from Firebase Console at
 *       `android/app/google-services.json` (gitignored — never commit).
 *     - The Firebase project SHA-1 fingerprint must include the debug
 *       and release keystore fingerprints (Run > Settings in Android Studio).
 *   iOS:
 *     - Apple Developer account + APNs certificate or APNs Auth Key.
 *     - Add the certificate / key to your Firebase project's iOS app.
 *     - Push Notifications capability + Background Modes (Remote notifications)
 *       toggled in Xcode signing & capabilities.
 *
 * Without those, this file still loads safely — the plugin call returns a
 * non-granted permission and we no-op.
 */

import { Capacitor } from '@capacitor/core';
import { API_URLS } from '@shared/config';
import { authHeaders } from './api';

let _registered = false;

/**
 * Register the device with the native push provider (FCM on Android, APNs on
 * iOS). Idempotent — running twice is a no-op. Returns true only when the
 * full chain succeeded (permission granted, token received, backend accepted).
 *
 * Logs every failure branch loudly so the developer console makes the issue
 * obvious during dev.
 */
export async function registerNativePush(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (_registered) return true;

  // Hard gate — without Firebase configuration the native plugin's
  // FirebaseMessaging.getInstance() call throws a NullPointerException
  // on Android, and the exception leaks out of the Capacitor bridge as
  // a native crash. We detect "Firebase configured" via the same env
  // var the web FCM path uses; once the dev drops google-services.json
  // into android/app/ AND sets REACT_APP_FIREBASE_PROJECT_ID, push
  // registration unlocks. Until then, no permission prompt, no crash.
  const firebaseProjectId =
    typeof process !== 'undefined' && process.env?.REACT_APP_FIREBASE_PROJECT_ID;
  if (!firebaseProjectId) {
    console.info(
      '[push] Skipped — REACT_APP_FIREBASE_PROJECT_ID not set. To enable native ' +
        'push: (1) create a Firebase project, (2) drop google-services.json into ' +
        'android/app/, (3) set REACT_APP_FIREBASE_PROJECT_ID in frontend/.env.local, ' +
        '(4) rebuild. See docs/capacitor.md for the full runbook.',
    );
    return false;
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // 1. Request permission. iOS shows the system prompt; Android 13+ also prompts.
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') {
      console.warn(`[push] native permission denied (${permission.receive})`);
      return false;
    }

    // 2. Register listeners BEFORE register() — the registration event fires
    // synchronously on Android once the FCM token is available.
    return await new Promise<boolean>((resolve) => {
      let resolved = false;
      const finish = (ok: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(ok);
        }
      };

      PushNotifications.addListener('registration', async (token) => {
        console.info(`[push] native device token received (length=${token.value?.length})`);
        const synced = await syncTokenWithBackend(token.value);
        if (synced) _registered = true;
        finish(synced);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.warn('[push] native registration error:', err);
        finish(false);
      });

      PushNotifications.addListener('pushNotificationReceived', (notif) => {
        // Foreground push — surface as in-app toast via the existing
        // NotificationContext, mirroring the firebase.onForegroundPush path.
        console.info('[push] foreground notification:', notif.title);
        window.dispatchEvent(
          new CustomEvent('uniflow:native-push', {
            detail: {
              title: notif.title,
              body: notif.body,
              data: notif.data,
            },
          })
        );
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        // User tapped the notification (background → foreground). Honor a
        // `targetRoute` field if the backend included one in `data`.
        const route = action?.notification?.data?.targetRoute;
        if (typeof route === 'string' && route.startsWith('/')) {
          window.location.hash = `#${route}`;
        }
      });

      PushNotifications.register().catch((err) => {
        console.warn('[push] PushNotifications.register() threw:', err);
        finish(false);
      });

      // Hard timeout — if the registration event never fires we shouldn't
      // hang forever.
      setTimeout(() => finish(false), 15_000);
    });
  } catch (err) {
    console.warn('[push] native push registration failed:', err);
    return false;
  }
}

/**
 * Best-effort token revocation on logout. Clears the listeners we added in
 * registerNativePush so the next user's listeners don't double-fire.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  _registered = false;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.removeAllListeners();
  } catch {
    /* swallow */
  }
  // Clear from backend too — same endpoint as web.
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

async function syncTokenWithBackend(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${API_URLS.userProfile()}/api/users/me/fcm-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ token, platform: Capacitor.getPlatform() }),
    });
    if (res.ok) return true;
    const body = await res.text().catch(() => '');
    console.warn(`[push] backend rejected native token (${res.status}): ${body.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.warn('[push] failed to sync native token with backend:', err);
    return false;
  }
}

export const nativePush = {
  register: registerNativePush,
  unregister: unregisterNativePush,
};
