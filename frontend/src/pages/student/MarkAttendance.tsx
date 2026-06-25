/**
 * Student MarkAttendance.
 *
 * Three entry paths into a successful "I'm here":
 *
 *   1. Deep-link auto-mark — the QR encodes a URL to this page with
 *      `?session=…&token=…` query params. Scanning with the phone's
 *      NATIVE camera opens the link, this page reads the params on
 *      mount, and POSTs /api/attendance/mark with no extra UI gesture.
 *      (The auto-mark only fires when the user is logged in; the
 *      ProtectedRoute redirects unauth'd visits to /login first.)
 *
 *   2. In-app camera — a glass modal opens an explicit "Open Camera"
 *      button (user gesture is required by iOS Safari before getUserMedia
 *      will work) and uses `jsqr` to decode QR frames. This is the
 *      cross-browser path — `BarcodeDetector` doesn't exist on iOS.
 *
 *   3. Paste fallback — the modal also has a paste-token field so a
 *      student can copy the JWT (or the URL) when the camera is denied
 *      or the QR won't read.
 *
 * Backed by:
 *   - GET  /api/attendance/live-sessions
 *   - POST /api/attendance/mark   { sessionId, qrToken }
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion, AnimatePresence } from 'framer-motion';
import jsQR from 'jsqr';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';
import { nativeScanner } from '../../utils/capacitor-scanner';
import { getOrCreateDeviceId } from '../../utils/userProfileService';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface LiveSession {
  sessionId: string;
  courseCode: string;
  courseTitle: string;
  instructorName: string | null;
  startedAt: string;
  expiresAt: string | null;
  room: string | null;
}

const startedAgo = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} hr ${min % 60} min ago`;
};

// QR may carry one of three things — we accept all of them so any
// scanner path (in-app camera, native camera deep-link, paste) ends up
// at the same JWT we POST to /api/attendance/mark.
const extractToken = (raw: string): string => {
  const t = raw.trim();
  // 1. Full URL with ?token=… query param.
  try {
    const u = new URL(t);
    const tok = u.searchParams.get('token');
    if (tok) return tok;
  } catch {
    /* not a URL — fall through */
  }
  // 2. JSON envelope { qrData: '<jwt>' } that some legacy paths emit.
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object' && typeof parsed.qrData === 'string') {
      return parsed.qrData;
    }
  } catch {
    /* not JSON — fall through */
  }
  // 3. Raw JWT.
  return t;
};

// Same parser, but for the sessionId (only used when we receive a URL).
const extractSessionId = (raw: string, fallback: string): string => {
  try {
    const u = new URL(raw.trim());
    return u.searchParams.get('session') || fallback;
  } catch {
    return fallback;
  }
};

interface ScanModalProps {
  session: LiveSession;
  onClose: () => void;
  onMarked: () => void;
}

const ScanModal: React.FC<ScanModalProps> = ({ session, onClose, onMarked }) => {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const submittedRef = useRef(false); // guard against double-mark

  const [pasteValue, setPasteValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Tracks which side of a phone is currently active so the Flip
  // button can toggle. Starts at 'environment' (back) which is the
  // sensible default for QR scanning across a room.
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  // Discovered video input devices on this browser. Phones typically have
  // 2 (front + back), laptops 1 (built-in webcam), some desktops have
  // multiple. Browsers refuse to populate the `label` field until the
  // user has granted camera permission at least once — so the list
  // before-permission shows generic names; after-permission shows real ones.
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setCameraOn(false);
  }, []);

  const submit = useCallback(
    async (qrToken: string, sessionIdOverride?: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`${API_URLS.attendance()}/api/attendance/mark`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(authHeaders() as Record<string, string>) },
          body: JSON.stringify({
            sessionId: sessionIdOverride || session.sessionId,
            qrToken,
            // Bound-device id (Attendance Doc §3.5.3). Enforced server-side only
            // when DEVICE_BINDING_ENFORCED=true; harmless to always send.
            deviceId: getOrCreateDeviceId(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          submittedRef.current = false; // allow retry
          const reason = (data as { reason?: string }).reason;
          if (reason === 'no_registered_device') {
            setError('Register your device in your profile before marking attendance.');
          } else if (reason === 'device_release_cooldown') {
            setError('Your device release is in cooldown — your instructor will record attendance manually until it clears.');
          } else if (reason === 'device_mismatch') {
            setError('This is not your registered device. Attendance can only be marked from your bound device.');
          } else {
            setError((data as { error?: string }).error || `Mark failed (HTTP ${res.status})`);
          }
          return;
        }
        // Haptic feedback on successful mark — only fires on native shells
        // and silently no-ops on web.
        Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
        stopCamera();
        onMarked();
      } catch (e) {
        submittedRef.current = false;
        setError(e instanceof Error ? e.message : 'Network error');
      } finally {
        setSubmitting(false);
      }
    },
    [session.sessionId, onMarked, stopCamera],
  );

  // Native scanner path — opens the platform ML Kit / Vision Framework
  // scanner full-screen. Only available inside the Capacitor shell.
  // Web users continue to use the in-modal jsQR pipeline below.
  const [nativeScanAvailable, setNativeScanAvailable] = useState(false);
  useEffect(() => {
    nativeScanner.isAvailable().then(setNativeScanAvailable).catch(() => {});
  }, []);

  const handleNativeScan = useCallback(async () => {
    setCameraError(null);
    setError(null);
    try {
      const { text } = await nativeScanner.scan();
      const tok = extractToken(text);
      const sid = extractSessionId(text, session.sessionId);
      await submit(tok, sid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Native scan failed.';
      // 'Scan cancelled' is benign; surface the rest.
      if (!/cancelled/i.test(msg)) setCameraError(msg);
    }
  }, [submit, session.sessionId]);

  // Refresh the list of available video inputs. Browsers only fill in
  // the `label` field once camera permission has been granted at least
  // once — that's why we re-enumerate immediately after a successful
  // getUserMedia call (the labels go from "" → "Back camera" etc.).
  const refreshCameras = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      const videos = all.filter((d) => d.kind === 'videoinput');
      setCameras(videos);
      // Default-pick: prefer a back-facing camera if the labels say so
      // (works after permission granted), otherwise just pick the first.
      setSelectedCameraId((current) => {
        if (current && videos.some((v) => v.deviceId === current)) return current;
        const back = videos.find((v) => /back|rear|environment/i.test(v.label));
        return back?.deviceId || videos[0]?.deviceId || '';
      });
    } catch {
      // enumerateDevices can fail in private/old browsers — fall back
      // to letting getUserMedia pick a default with `facingMode`.
    }
  }, []);

  // Discover cameras as soon as the modal mounts (pre-permission, so
  // names are generic — that's fine, the UX still shows count + lets
  // the user pick "front/back" once permission is granted). Also
  // listen for `devicechange` so plugging in a webcam mid-modal
  // refreshes the dropdown without requiring a re-open.
  useEffect(() => {
    refreshCameras();
    if (typeof navigator === 'undefined') return;
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => refreshCameras();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshCameras]);

  // Open the camera. Triggered by an EXPLICIT button click — required by
  // iOS Safari (camera APIs need a user-gesture). We then poll frames
  // through jsQR (works on every modern browser, no BarcodeDetector
  // dependency).
  const openCamera = useCallback(async (
    arg?: string | { facing: 'environment' | 'user' },
  ) => {
    setCameraError(null);
    setError(null);

    // Defensive feature check — `navigator.mediaDevices` is `undefined`
    // on:
    //   - iOS Safari served over plain HTTP (the user's LAN dev case)
    //   - very old browsers
    //   - some embedded webviews that strip the API
    // We surface a clear, actionable message instead of crashing with
    // `undefined is not an object`. The paste-fallback below is still
    // a viable path for the student.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const isHttp =
        typeof window !== 'undefined' &&
        window.location?.protocol === 'http:' &&
        !['localhost', '127.0.0.1'].includes(window.location.hostname);
      setCameraError(
        isHttp
          ? "Your phone's browser blocks the camera on plain HTTP. Either open the site over HTTPS, or paste the QR token below."
          : "This browser doesn't expose camera access. Paste the QR token below to mark instead.",
      );
      setCameraOn(false);
      return;
    }

    // Stop any prior stream — needed when the user is SWITCHING cameras
    // mid-scan (back ↔ front). Without this both streams stay open and
    // mobile browsers refuse to start a second one.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      // Three-tier video constraint:
      //   1. Explicit deviceId (most precise — used by the dropdown).
      //   2. Explicit facingMode override (used by the Flip button).
      //   3. The current `facing` state (default 'environment' = back).
      let video: MediaTrackConstraints;
      if (typeof arg === 'string') {
        video = { deviceId: { exact: arg } };
      } else if (arg && 'facing' in arg) {
        video = { facingMode: { ideal: arg.facing } };
        setFacing(arg.facing);
      } else if (selectedCameraId) {
        video = { deviceId: { exact: selectedCameraId } };
      } else {
        video = { facingMode: { ideal: facing } };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Required attributes for inline play on iOS Safari.
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play().catch(() => {});
      }
      setScanning(true);
      // Re-enumerate now that permission has been granted — labels
      // populate on this second pass so the dropdown actually shows
      // "Back camera" / "FaceTime HD" instead of just "Camera 1".
      refreshCameras();
      // Sync the selection to whatever device the stream actually used
      // (handy when getUserMedia ignored our facingMode hint and
      // picked a different camera). Also remember which side of the
      // phone is currently active so the Flip button toggles correctly.
      const trackSettings = stream.getVideoTracks()[0]?.getSettings?.();
      if (trackSettings?.deviceId) setSelectedCameraId(trackSettings.deviceId);
      if (trackSettings?.facingMode === 'environment' || trackSettings?.facingMode === 'user') {
        setFacing(trackSettings.facingMode);
      }

      const tick = () => {
        if (!videoRef.current || !canvasRef.current || submittedRef.current) {
          if (!submittedRef.current) rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const v = videoRef.current;
        if (v.readyState !== v.HAVE_ENOUGH_DATA) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          const tok = extractToken(code.data);
          const sid = extractSessionId(code.data, session.sessionId);
          submit(tok, sid);
          return; // submit's onMarked stops the loop via stopCamera
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const msg =
        e instanceof Error
          ? /Permission|NotAllowed/i.test(e.message)
            ? 'Camera permission denied. Allow it from your browser settings, or paste the token below.'
            : e.message
          : 'Could not open camera.';
      setCameraError(msg);
      setCameraOn(false);
    }
  }, [submit, session.sessionId, selectedCameraId, facing, refreshCameras]);

  // Stop the camera on unmount — the stream tracks otherwise stay open.
  useEffect(() => stopCamera, [stopCamera]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        className={`relative w-full max-w-md ${glassCardStyle} p-5 space-y-4`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
              <i className="ph-bold ph-qr-code text-[#6A3FF4]"></i>
              {t('markAttendancePage.scanAndVerify') || 'Scan QR'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {session.courseCode} · {session.courseTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-red-500/15 hover:text-red-500 text-gray-400 border border-white/10 hover:border-red-500/30 transition-colors flex items-center justify-center"
          >
            <i className="ph-bold ph-x text-xs"></i>
          </button>
        </div>

        {/* Native scanner CTA — only renders inside the Capacitor shell on
            devices where ML Kit (Android) / Vision (iOS) reports support.
            We surface it as the PRIMARY action because the native scanner
            is meaningfully faster + more accurate than the jsQR pipeline,
            and the system camera UI is what users expect on a phone.
            The web pipeline below still works as a fallback. */}
        {Capacitor.isNativePlatform() && nativeScanAvailable && (
          <button
            type="button"
            onClick={handleNativeScan}
            disabled={submitting}
            className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <i className="ph-bold ph-qr-code"></i>
            {submitting ? 'Marking…' : 'Scan with Camera'}
          </button>
        )}

        {/* Camera surface — the video element stays mounted so re-opening
            doesn't tear down the canvas; it's just a black box until the
            user clicks Open Camera. */}
        <div className="relative rounded-xl overflow-hidden bg-black/40 border border-white/10 aspect-square">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${cameraOn ? 'opacity-100' : 'opacity-0'}`}
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {!cameraOn && !cameraError && (() => {
            // Pre-flight check — if the browser can't reach the camera
            // API at all (HTTP iOS / very old browser), tell the
            // student up-front instead of letting them tap the button
            // and hit the same wall. Detected here too because
            // openCamera's setCameraError can't run before the click.
            const cameraAvailable =
              typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
            const isInsecureHttp =
              typeof window !== 'undefined' &&
              window.location?.protocol === 'http:' &&
              !['localhost', '127.0.0.1'].includes(window.location.hostname);

            return (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <i className="ph-bold ph-camera text-4xl text-[#6A3FF4]"></i>
                <p className="text-sm text-gray-300">
                  {cameraAvailable
                    ? 'Tap the button to open your camera and scan the QR your instructor is showing.'
                    : isInsecureHttp
                    ? "Your phone's browser blocks the camera on plain HTTP. Either open this site over HTTPS, or use the paste-token field below."
                    : "This browser doesn't expose camera access. Use the paste-token field below to mark."}
                </p>
                <button
                  type="button"
                  onClick={() => openCamera()}
                  disabled={!cameraAvailable}
                  className="mt-1 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <i className="ph-bold ph-camera"></i>
                  Open Camera
                </button>
              </div>
            );
          })()}

          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-xs text-red-400 bg-black/60 gap-3">
              <p>
                <i className="ph-bold ph-warning mr-1"></i>
                {cameraError}
              </p>
              <button
                type="button"
                onClick={() => openCamera()}
                className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white text-xs font-bold hover:bg-white/20 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {cameraOn && (
            <>
              {/* Reticle so it feels like a real scanner. */}
              <div className="absolute inset-6 border-2 border-[#6A3FF4]/60 rounded-2xl pointer-events-none"></div>
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {/* Flip-camera shortcut — fast toggle between front +
                    back for phones. The dropdown below is still
                    available for finer-grained pick on multi-cam
                    devices. We always render the flip button when
                    the camera is on (even on single-cam devices) —
                    the worst case is a no-op restart of the same
                    cam, no UX regression. */}
                <button
                  type="button"
                  onClick={() => openCamera({ facing: facing === 'environment' ? 'user' : 'environment' })}
                  className="px-3 py-1 rounded-lg bg-black/50 border border-white/20 text-white text-[10px] font-bold hover:bg-black/70 transition-colors flex items-center gap-1"
                  aria-label={t('markAttendancePage.flipCamera')}
                  title={facing === 'environment' ? 'Switch to front camera' : 'Switch to back camera'}
                >
                  <i className="ph-bold ph-arrows-clockwise"></i>
                  {facing === 'environment' ? 'Front' : 'Back'}
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-3 py-1 rounded-lg bg-black/50 border border-white/20 text-white text-[10px] font-bold hover:bg-black/70 transition-colors flex items-center gap-1"
                >
                  <i className="ph-bold ph-stop"></i> Stop
                </button>
              </div>
              {scanning && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 border border-white/20 text-white text-[10px] font-bold flex items-center gap-1">
                  <i className="ph-bold ph-spinner animate-spin"></i>
                  Scanning…
                </div>
              )}
            </>
          )}
        </div>

        {/* Camera picker — only meaningful when the device has more
            than one video input (phones with front+back, multi-cam
            laptops). Hidden on single-camera devices to keep the
            modal tight. Pre-permission the labels are blank so we
            fall back to a "Camera N" name; once getUserMedia has run
            once the real labels populate. */}
        {cameras.length > 1 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              {cameraOn ? 'Switch camera' : 'Camera'}
            </label>
            <GlassDropdown
              value={selectedCameraId}
              onChange={(v) => {
                setSelectedCameraId(v);
                // If the camera is already on, restart the stream
                // immediately on the new device. Otherwise just
                // remember the choice for the next Open Camera click.
                if (cameraOn) openCamera(v);
              }}
              options={cameras.map((c, i) => {
                // Pick a friendly label. Phones return "back camera /
                // facing back" and we shorten; desktops return brand
                // names; pre-permission they're empty.
                const raw = c.label || `Camera ${i + 1}`;
                const label = /back|rear|environment/i.test(raw)
                  ? `📷 Back · ${raw.replace(/\(.*?\)/, '').trim() || 'Rear camera'}`
                  : /front|user|face/i.test(raw)
                  ? `🤳 Front · ${raw.replace(/\(.*?\)/, '').trim() || 'Front camera'}`
                  : raw;
                return {
                  value: c.deviceId,
                  label,
                  icon: 'ph-camera',
                };
              })}
              direction="up"
              className="w-full"
            />
          </div>
        )}

        {/* Paste fallback — always available for browsers/cameras that
            choke. Accepts the raw JWT, the URL form, or the JSON envelope
            and the helper extracts the right thing. */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
            Or paste the QR (token or URL)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder="Paste the JWT or full QR URL…"
              className="flex-1 bg-white/5 dark:bg-black/20 border border-white/10 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] transition-colors"
            />
            <button
              type="button"
              disabled={!pasteValue || submitting}
              onClick={() =>
                submit(extractToken(pasteValue), extractSessionId(pasteValue, session.sessionId))
              }
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-1"
            >
              <i className="ph-bold ph-check"></i>
              {submitting ? '…' : 'Mark'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs px-3 py-2 flex items-center gap-2">
            <i className="ph-bold ph-warning-circle"></i>
            {error}
          </div>
        )}
      </motion.div>
    </div>
  );
};

const MarkAttendance: React.FC = () => {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [live, setLive] = useState<LiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<LiveSession | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Status of the auto-mark attempt (when the URL carries ?session=…&token=…).
  const [autoMark, setAutoMark] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [autoMarkMsg, setAutoMarkMsg] = useState<string>('');
  const autoTriedRef = useRef(false);

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`${API_URLS.attendance()}/api/attendance/live-sessions`, {
        credentials: 'include',
        headers: authHeaders() as Record<string, string>,
      });
      if (!res.ok) {
        setError(`Could not load live sessions (HTTP ${res.status})`);
        return;
      }
      setLive(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchLive().finally(() => setIsLoading(false));
    const t = setInterval(fetchLive, 5000);
    return () => clearInterval(t);
  }, [fetchLive]);

  // Deep-link auto-mark — the QR's URL embeds the JWT + sessionId; if
  // we land on this page with those params, fire the mark immediately
  // and clean the URL so a refresh doesn't re-fire.
  useEffect(() => {
    if (autoTriedRef.current) return;
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const sessionId = params.get('session');
    if (!token || !sessionId) return;
    autoTriedRef.current = true;
    setAutoMark('pending');
    setAutoMarkMsg('Marking attendance from QR link…');
    (async () => {
      try {
        const res = await fetch(`${API_URLS.attendance()}/api/attendance/mark`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(authHeaders() as Record<string, string>) },
          body: JSON.stringify({ sessionId, qrToken: token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAutoMark('error');
          setAutoMarkMsg(
            (data as { error?: string }).error || `Could not mark from this link (HTTP ${res.status}).`,
          );
          return;
        }
        setAutoMark('done');
        setAutoMarkMsg('Attendance marked from QR link.');
        fetchLive();
      } catch (e) {
        setAutoMark('error');
        setAutoMarkMsg(e instanceof Error ? e.message : 'Network error');
      } finally {
        // Strip the params either way so a refresh / share-back doesn't
        // re-attempt with a stale token.
        navigate(location.pathname, { replace: true });
      }
    })();
  }, [location.pathname, location.search, fetchLive, navigate]);

  const handleMarked = () => {
    const code = scanning?.courseCode ?? '';
    setScanning(null);
    setSuccess(t('markAttendancePage.markedSuccess', { course: code }) || `Attendance marked for ${code}.`);
    setTimeout(() => setSuccess(null), 4000);
    fetchLive();
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView>
        <h2 className="text-black dark:text-white text-3xl font-bold mb-1">
          {t('markAttendancePage.title')}
        </h2>
        <p className="text-black dark:text-gray-300 text-sm">
          {t('markAttendancePage.subtitle')}
        </p>
      </AnimateOnView>

      {autoMark === 'pending' && (
        <div className="bg-blue-500/10 border border-blue-500/30 text-blue-500 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-spinner animate-spin"></i>
          {autoMarkMsg}
        </div>
      )}
      {autoMark === 'done' && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i>
          {autoMarkMsg}
        </div>
      )}
      {autoMark === 'error' && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-warning-circle"></i>
          {autoMarkMsg}
        </div>
      )}

      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i>
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
          <i className="ph-bold ph-warning-circle"></i>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {isLoading ? (
          [1, 2].map((i) => (
            <div key={i} className="h-48 w-full bg-white/5 animate-pulse rounded-2xl"></div>
          ))
        ) : live.length === 0 ? (
          <div className={`${glassCardStyle} col-span-full p-20 text-center text-gray-500`}>
            <i className="ph-bold ph-calendar-blank text-5xl mb-4 opacity-20"></i>
            <p>{t('markAttendancePage.noActiveClasses')}</p>
            <p className="text-xs mt-2 text-gray-600">
              You&apos;ll see a card here the moment your instructor opens an attendance session.
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {live.map((s) => (
              <motion.div
                key={s.sessionId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                whileHover={{ scale: 1.01 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className={`${glassCardStyle} p-6 border-l-4 border-l-[#6A3FF4]`}
              >
                <div className="flex justify-between items-start mb-4 gap-3">
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold text-black dark:text-white truncate">
                      {s.courseTitle}
                    </h3>
                    <p className="text-[#6A3FF4] font-bold text-xs uppercase tracking-wider">
                      {s.courseCode}
                    </p>
                  </div>
                  <span className="bg-green-500/15 text-green-500 border border-green-500/30 px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    {t('onlineLecturesPage.live')}
                  </span>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500 dark:text-gray-400 mb-5">
                  <p className="flex items-center gap-2">
                    <i className="ph-bold ph-clock text-[#6A3FF4]"></i>
                    Started {startedAgo(s.startedAt)}
                  </p>
                  {s.instructorName && (
                    <p className="flex items-center gap-2">
                      <i className="ph-bold ph-chalkboard-teacher text-[#6A3FF4]"></i>
                      {s.instructorName}
                    </p>
                  )}
                  {s.room && (
                    <p className="flex items-center gap-2">
                      <i className="ph-bold ph-map-pin text-[#6A3FF4]"></i>
                      {s.room}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setScanning(s)}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity flex items-center justify-center gap-3"
                >
                  <i className="ph-bold ph-qr-code"></i>
                  {t('markAttendancePage.scanAndVerify') || 'Scan QR & Mark Present'}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {scanning && (
        <ScanModal
          session={scanning}
          onClose={() => setScanning(null)}
          onMarked={handleMarked}
        />
      )}
    </div>
  );
};

export default MarkAttendance;
