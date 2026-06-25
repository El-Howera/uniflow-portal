/**
 * Firebase Cloud Messaging service worker.
 *
 * Lives at /firebase-messaging-sw.js so the browser can register it directly
 * (FCM SDK insists on this path). Receives background pushes when the tab is
 * closed or backgrounded and surfaces them as native notifications.
 *
 * IMPORTANT: this file is shipped to the client AS-IS — CRA does not template
 * env vars into public/, so we hardcode the public Firebase config below.
 * These values are not secret (the API key is a public identifier; security
 * is enforced by Firebase rules + your service-account JSON staying server-side).
 *
 * After running `firebase init` locally:
 *   1. Open Firebase Console → Project Settings → General → Your apps → Web app
 *   2. Copy the firebaseConfig object
 *   3. Paste those values into the FIREBASE_CONFIG below
 *   4. Replace the messagingSenderId placeholder with your real sender ID
 *
 * Until those values are real, importScripts will fail and the service worker
 * will stay dormant — no harm done; the rest of the app keeps working.
 */

importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

// Public web-app config from Firebase Console. Mirrored from the
// REACT_APP_FIREBASE_* env vars because CRA does not template values into
// public/. Update both files in lockstep when rotating the project.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBk35wFNzfxU-wZT5Y11BLf3xzzI75BRvc',
  authDomain: 'uniflow-project-65286.firebaseapp.com',
  projectId: 'uniflow-project-65286',
  storageBucket: 'uniflow-project-65286.firebasestorage.app',
  messagingSenderId: '282182974965',
  appId: '1:282182974965:web:27085dde66e61c081574bc',
};

try {
  // eslint-disable-next-line no-undef
  firebase.initializeApp(FIREBASE_CONFIG);
  // eslint-disable-next-line no-undef
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'UniFlow';
    const body = (payload.notification && payload.notification.body) || '';
    // Defence-in-depth: if a UniFlow window is focused, the in-app toast/bell
    // already informs the user — don't stack an OS notification on top. FCM
    // normally routes foreground messages to the page (not here), but some
    // payload shapes still reach the SW, so we guard explicitly.
    return self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        if (clients.some((c) => c.focused)) return undefined;
        return self.registration.showNotification(title, {
          body,
          icon: '/logo192.png',
          badge: '/logo192.png',
          data: payload.data || {},
        });
      });
  });
} catch (err) {
  // Runs when FIREBASE_CONFIG still contains REPLACE_ME placeholders or the
  // CDN is unreachable. Don't crash the worker — just stay dormant.
  // eslint-disable-next-line no-console
  console.warn('[firebase-messaging-sw] init skipped:', err && err.message);
}

// Click → focus an existing UniFlow tab if any, otherwise open the URL from
// the data payload (or the root).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return null;
    })
  );
});
