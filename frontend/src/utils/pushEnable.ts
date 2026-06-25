/**
 * Unified push enable/disable — picks the right channel per device.
 *
 *   enablePushFromGesture()  Call from a USER GESTURE (a toggle/button tap).
 *                            Tries FCM first (Chrome/Edge/Firefox/Android);
 *                            falls back to standard Web Push (VAPID) which is
 *                            the only channel an installed iOS PWA supports.
 *                            iOS requires the permission prompt to originate
 *                            from a gesture — hence the explicit gesture call.
 *
 *   disablePush()            Clears BOTH channels (logout). Best-effort.
 */

import { firebase } from './firebase';
import { webpush } from './webpush';

export async function enablePushFromGesture(): Promise<boolean> {
  // FCM's registerFcmTokenWithBackend() runs requestPermission() internally and
  // returns false on iOS Safari (isSupported()===false) WITHOUT prompting.
  const fcmOk = firebase.isConfigured()
    ? await firebase.registerFcmTokenWithBackend()
    : false;
  if (fcmOk) return true;

  // Standard Web Push fallback — prompts from this same gesture.
  if (webpush.isWebPushSupported()) {
    return webpush.subscribeWebPush({ requestPermission: true });
  }
  return false;
}

export async function disablePush(): Promise<void> {
  await Promise.all([
    firebase.clearFcmTokenWithBackend().catch(() => undefined),
    webpush.unsubscribeWebPush().catch(() => undefined),
  ]);
}
