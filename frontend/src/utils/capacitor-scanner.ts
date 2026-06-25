/**
 * Capacitor native QR / barcode scanner.
 *
 * Uses @capacitor-mlkit/barcode-scanning which wraps Google ML Kit (Android)
 * and Apple Vision Framework (iOS). Both deliver much faster, more accurate
 * scanning than the jsQR+canvas loop used in the browser fallback.
 *
 * The plugin opens a FULLSCREEN native scanner UI (the page goes transparent
 * behind it). On detect, the scanner returns the raw text and we re-show
 * the page. No video element or canvas ref handling needed on our side.
 *
 * Permissions:
 *   - Android: CAMERA in AndroidManifest.xml (added in Phase E).
 *   - iOS: NSCameraUsageDescription in Info.plist (added in Phase J).
 * The plugin handles the runtime permission prompt itself.
 *
 * The plugin also requires the Google Play Services ML Kit module on Android;
 * the first scan on a device may briefly download the model (~2MB). On iOS,
 * Apple Vision Framework is built into the OS — no download.
 */

import { Capacitor } from '@capacitor/core';

export interface NativeScanResult {
  /** Decoded text from the QR / barcode payload. */
  text: string;
  /** Format string: 'QR_CODE', 'CODE_128', 'DATA_MATRIX', etc. */
  format: string;
}

/**
 * Returns true iff the native scanner is available on this device.
 *
 * Three gates:
 *   1. We're inside Capacitor (not the browser).
 *   2. The plugin can be loaded (lazy import — small bundle savings on web).
 *   3. The platform supports ML Kit barcode scanning (Android needs Play
 *      Services; iOS always supports it).
 */
export async function isNativeScannerAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
    const { supported } = await BarcodeScanner.isSupported();
    return Boolean(supported);
  } catch {
    return false;
  }
}

/**
 * Open the native scanner and return the first QR code detected.
 *
 * Throws if:
 *   - The user denies the camera permission.
 *   - The user dismisses the scanner without scanning anything.
 *   - The plugin throws (e.g. ML Kit module install failed).
 *
 * Caller is responsible for catching and surfacing a friendly message —
 * we don't toast from here because the calling component already owns
 * the error surface.
 */
export async function scanQrNative(): Promise<NativeScanResult> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native scanner unavailable — not running in Capacitor.');
  }

  const { BarcodeScanner, BarcodeFormat } = await import(
    '@capacitor-mlkit/barcode-scanning'
  );

  // Ensure ML Kit module is installed on Android. On iOS this is a no-op.
  try {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule();
    }
  } catch {
    // Not on Android — Vision Framework is built into iOS.
  }

  // Request runtime permission. The plugin shows the system dialog.
  const perm = await BarcodeScanner.requestPermissions();
  if (perm.camera !== 'granted' && perm.camera !== 'limited') {
    throw new Error('Camera permission denied.');
  }

  // scan() blocks until the user scans something or cancels.
  const { barcodes } = await BarcodeScanner.scan({
    formats: [BarcodeFormat.QrCode],
  });

  if (!barcodes || barcodes.length === 0) {
    throw new Error('Scan cancelled.');
  }

  const first = barcodes[0];
  return {
    text: first.rawValue ?? first.displayValue ?? '',
    format: String(first.format),
  };
}

export const nativeScanner = {
  isAvailable: isNativeScannerAvailable,
  scan: scanQrNative,
};
