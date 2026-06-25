/* eslint-disable no-restricted-globals */
/**
 * UniFlow Web Push service worker (standard W3C Web Push / VAPID).
 *
 * Handles BACKGROUND pushes for installed PWAs — most importantly iOS 16.4+,
 * where FCM's web SDK is unsupported. Registered by frontend/src/utils/webpush.ts
 * at `/push-sw.js`. Independent of `/firebase-messaging-sw.js` (FCM).
 *
 * Push payload shape (sent by backend/lib/webpush.js):
 *   { title, body, data: { type, notificationId, referenceType?, referenceId?, url? } }
 */

self.addEventListener('install', () => {
  // Start handling pushes as soon as this SW installs (don't wait for reload).
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'UniFlow', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    (async () => {
      const title = payload.title || 'UniFlow';
      const data = payload.data || {};
      const tag = data.notificationId || `uniflow-${Date.now()}`;

      // Is the app open AND on-screen? Then the in-app socket notification
      // already shows the toast — we don't want a duplicate OS banner.
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const appInForeground = wins.some(
        (c) => c.visibilityState === 'visible' || c.focused,
      );

      // iOS PWA (16.4+) REQUIRES showNotification on every push — skipping it
      // makes WebKit show its own generic banner and can revoke the push
      // subscription after a few silent pushes. So when the app is in the
      // foreground we satisfy that requirement with a silent notification and
      // immediately close it: the banner never lingers, leaving only the
      // in-app toast. When backgrounded, we show the real banner.
      await self.registration.showNotification(title, {
        body: payload.body || '',
        icon: '/logo192.png',
        tag,
        renotify: false,
        silent: appInForeground, // no sound/vibration when foreground
        data,
      });

      if (appInForeground) {
        const open = await self.registration.getNotifications({ tag });
        open.forEach((n) => n.close());
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Reuse an already-open app window when there is one.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          // Let the running app route in-context (it knows the user's role).
          client.postMessage({ type: 'uniflow:notification-click', data });
          if (targetUrl && targetUrl !== '/' && 'navigate' in client) {
            try {
              await client.navigate(targetUrl);
            } catch (e) {
              /* cross-origin or not allowed — postMessage above already fired */
            }
          }
          return;
        }
      }

      // No window open → launch the app.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
