/**
 * Standard W3C Web Push (VAPID) client — the iOS-PWA-capable push path.
 *
 * FCM's web SDK returns isSupported()===false on iOS Safari, so an installed
 * iOS PWA (iOS 16.4+) can only receive background push via the standard Web
 * Push API. This util registers /push-sw.js, subscribes via PushManager, and
 * saves the subscription to the backend (POST /api/users/me/push-subscription).
 * It also works on Chrome/Edge/Firefox, but NotificationContext only falls back
 * to it when FCM is unavailable, so the two channels never double-register on
 * the same device.
 *
 * Public VAPID key is fetched at runtime from the backend (no rebuild needed
 * when the key is configured). Everything is best-effort: any failure leaves
 * the app working with in-page Socket.io notifications.
 */

import { API_URLS } from '@shared/config';
import { authHeaders } from './api';

const SW_PATH = '/push-sw.js';
let cachedKey: string | null | undefined; // undefined = not yet fetched

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iOS only delivers Web Push to an INSTALLED (home-screen) PWA, not a Safari tab. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const displayStandalone =
    !!window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayStandalone || iosStandalone;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function getVapidPublicKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey ?? null;
  try {
    const res = await fetch(`${API_URLS.userProfile()}/api/push/vapid-public-key`, {
      credentials: 'include',
    });
    const data = (await res.json().catch(() => ({}))) as { publicKey?: string | null };
    cachedKey = data?.publicKey || null;
  } catch {
    cachedKey = null;
  }
  return cachedKey ?? null;
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch(`${API_URLS.userProfile()}/api/users/me/push-subscription`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[webpush] failed to save subscription:', err);
    return false;
  }
}

/**
 * Subscribe this browser to Web Push and register it with the backend.
 *
 * @param opts.requestPermission  When true (called from a user gesture, e.g. a
 *   "Enable notifications" tap), prompts for permission — iOS REQUIRES a gesture
 *   for the prompt. When false (silent mount-time call), only proceeds if
 *   permission was ALREADY granted, refreshing the stored subscription.
 * @returns true only when a subscription was created AND accepted by the backend.
 */
export async function subscribeWebPush(
  opts: { requestPermission?: boolean } = {},
): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  let permission = Notification.permission;
  if (permission === 'denied') return false;
  if (permission !== 'granted') {
    if (!opts.requestPermission) return false; // silent path never prompts
    try {
      permission = await Notification.requestPermission();
    } catch {
      return false;
    }
    if (permission !== 'granted') return false;
  }

  const key = await getVapidPublicKey();
  if (!key) {
    console.warn('[webpush] no VAPID public key from backend — set VAPID_PUBLIC_KEY in .env.');
    return false;
  }

  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(SW_PATH);
  } catch (err) {
    console.warn('[webpush] service worker registration failed:', err);
    return false;
  }
  await navigator.serviceWorker.ready.catch(() => undefined);

  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
    }
    const ok = await postSubscription(sub);
    if (ok) console.info('[webpush] subscription registered with backend ✓');
    return ok;
  } catch (err) {
    console.warn('[webpush] subscribe failed:', err);
    return false;
  }
}

/** Remove the subscription (logout). Best-effort — failures are swallowed. */
export async function unsubscribeWebPush(): Promise<void> {
  try {
    if (!isWebPushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub?.endpoint;
    if (sub) await sub.unsubscribe().catch(() => undefined);
    await fetch(`${API_URLS.userProfile()}/api/users/me/push-subscription`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

export const webpush = {
  isWebPushSupported,
  isStandalonePwa,
  subscribeWebPush,
  unsubscribeWebPush,
};
