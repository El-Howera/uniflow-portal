/**
 * Capacitor native shell helpers — call once at app boot.
 *
 * Wires the small native niceties that make a Capacitor build feel like
 * an actual app instead of a browser tab:
 *
 *   - StatusBar: brand-tinted status bar (matches Aurora header).
 *   - SplashScreen: hide the system splash after our React tree mounts.
 *   - App back button: Android's hardware/gesture back navigates within
 *     the SPA via window.history.back() instead of killing the app.
 *
 * Each is wrapped in try/catch so a missing plugin (or running in the
 * browser) silently no-ops.
 */

import { Capacitor } from '@capacitor/core';

let _initialised = false;

export async function bootstrapCapacitorShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (_initialised) return;
  _initialised = true;

  // ---- Status bar ----
  // Edge-to-edge mode — WebView draws under both system bars so the
  // Aurora background bleeds to the screen edges. The native theme
  // (android/app/src/main/res/values/styles.xml) sets the navigation
  // bar transparent + drawsSystemBarBackgrounds; the StatusBar plugin
  // call below handles the status bar. `style: Dark` here means dark
  // CONTENT, i.e. light/white icons (clock, signal) — readable on the
  // purple Aurora.
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    // Transparent so nothing of the bar's own surface is visible — only
    // the system icons drawn on top of our WebView.
    await StatusBar.setBackgroundColor({ color: '#00000000' });
  } catch (err) {
    console.warn('[capacitor-shell] StatusBar setup failed:', err);
  }

  // ---- Splash screen ----
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Auto-hide is on (configured in capacitor.config.ts) but call explicitly
    // for snappier transitions on slow Android devices.
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch (err) {
    console.warn('[capacitor-shell] SplashScreen.hide failed:', err);
  }

  // ---- Android back button ----
  // The default Android behaviour is to kill the activity on back press,
  // which feels broken in an SPA. Route it through the browser history
  // so back navigates within the app instead.
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else {
        // At the root — exit the app on a second tap (Android convention).
        // Calling App.exitApp() directly would surprise the user; for now
        // just no-op and let the OS handle it on the second press if
        // they keep pressing.
        App.exitApp().catch(() => {});
      }
    });
  } catch (err) {
    console.warn('[capacitor-shell] App.backButton wiring failed:', err);
  }
}
