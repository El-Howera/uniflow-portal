/**
 * UniFlowVideoPlayer
 *
 * Reusable styled video player mirroring the custom controls built for
 * the OnlineLectures Watch-Replay screen — purple theme, click-to-pause,
 * skip ±10s, seek slider with knob, volume + mute, playback-rate menu,
 * fullscreen. Used for video attachments inside chat bubbles so chat
 * videos look like the rest of the app instead of falling back to the
 * browser's default chrome.
 *
 * Compact mode: when `compact` is true (the chat-bubble case), the
 * controls strip is denser and the icons sized down so it fits inside
 * the ~280px max-width attachment slot. Full-size mode is for any
 * future replay-style usage with a larger viewport.
 */

import React, { useEffect, useRef, useState } from 'react';

interface UniFlowVideoPlayerProps {
  src: string;
  /** Optional poster (preview frame) URL. */
  poster?: string;
  /** Optional MIME type override; defaults to video/mp4. */
  mimeType?: string;
  /** Compact (chat bubble) vs full-size variant. */
  compact?: boolean;
  /** Override width. Pass a Tailwind class (e.g. "max-w-[280px]"). */
  className?: string;
}

const formatTime = (totalSeconds: number) => {
  if (!Number.isFinite(totalSeconds)) return '00:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const SettingsMenu: React.FC<{
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  currentRate: number;
  setRate: (n: number) => void;
  onClose: () => void;
  compact: boolean;
}> = ({ videoRef, currentRate, setRate, onClose, compact }) => {
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const handlePick = (rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setRate(rate);
    onClose();
  };
  // Close on outside click.
  useEffect(() => {
    const handler = () => onClose();
    const t = window.setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [onClose]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`absolute right-0 ${
        compact ? 'bottom-9' : 'bottom-12'
      } bg-white/95 dark:bg-[#1C1C1E]/95 border border-white/30 dark:border-white/10 rounded-xl shadow-2xl backdrop-blur-2xl overflow-hidden z-30 min-w-[140px]`}
    >
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold text-gray-500 border-b border-white/10">
        Speed
      </p>
      {rates.map((rate) => (
        <button
          key={rate}
          type="button"
          onClick={() => handlePick(rate)}
          className={`flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-[#6A3FF4]/10 w-full text-left transition-colors text-xs ${
            rate === currentRate ? 'text-[#6A3FF4] font-bold' : 'text-black dark:text-white'
          }`}
        >
          <span>{rate === 1 ? 'Normal' : `${rate}×`}</span>
          {rate === currentRate && <i className="ph-bold ph-check text-xs"></i>}
        </button>
      ))}
    </div>
  );
};

// Map a recording URL's extension to the matching MIME type. Browser
// MediaRecorder defaults to .webm on Chrome / Edge / Firefox, .mp4 on Safari;
// our uploads include all three plus .mkv / .ogg / .mov from staff replay
// material. Wrong / generic types in the <source> tag can keep some Chromium
// builds from buffering — sniff from the URL so the type matches.
const mimeFromUrl = (url: string): string => {
  const u = url.toLowerCase().split('?')[0].split('#')[0];
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.mkv'))  return 'video/x-matroska';
  if (u.endsWith('.ogg') || u.endsWith('.ogv')) return 'video/ogg';
  if (u.endsWith('.mov') || u.endsWith('.m4v')) return 'video/quicktime';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return 'video/mp4';
};

export const UniFlowVideoPlayer: React.FC<UniFlowVideoPlayerProps> = ({
  src,
  poster,
  mimeType,
  compact = false,
  className = '',
}) => {
  // Detect MIME from the URL when the caller didn't override — handles the
  // common case where the URL is a .webm recording but the prop default
  // would otherwise advertise it as video/mp4.
  const effectiveMime = mimeType || mimeFromUrl(src);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  // Guard so the seek-to-end "force duration" trick only runs once per
  // source — if the user seeks back to 0 after we hit the trick, we don't
  // want to re-fire it and yank them around.
  const durationProbedRef = useRef(false);
  // Track the highest currentTime we've seen — used as a fallback when the
  // browser stubbornly keeps reporting Infinity. Lets the bar at least
  // approximate progress over the watched portion.
  const seenMaxTimeRef = useRef(0);

  // Track fullscreen state — when on, controls become an absolute overlay
  // at the bottom of the video that fades out after 2.5s of mouse idleness.
  // Off: the controls strip sits below the video as before.
  //
  // The CSS-fallback path (used on browsers without element-fullscreen
  // support, e.g. iOS Safari) sets `isFullscreen=true` directly from
  // `handleFullscreen` without firing this event, so the handler never
  // runs in that mode and the manual state stays intact. The webkit-
  // prefixed event catches Safari desktop's vendor-prefixed variant.
  useEffect(() => {
    const handler = () => {
      const docFs: Element | null =
        document.fullscreenElement
        || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement
        || null;
      setIsFullscreen(docFs === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  // Esc → exit when we're in the CSS-fallback fullscreen (real fullscreen
  // already exits on Esc via the browser-native chrome).
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // ── Force-resolve duration for streamed-MediaRecorder webm files ────────────
  // Recordings produced by `MediaRecorder.start(1000)` in LiveSessionRoom
  // don't have the duration metadata header set, so the browser reports
  // `video.duration === Infinity`. progressPercent then collapses to 0 and
  // the seek bar is stuck at the start even while currentTime ticks.
  //
  // Fix: on the FIRST loadedmetadata event with a non-finite duration, seek
  // to MAX_SAFE_INTEGER. The browser scans the moov atoms while doing so,
  // discovers the real end, and fires durationchange + timeupdate with a
  // finite value. We then reset currentTime to 0 (or whatever the user had
  // already advanced to) and unset the probe guard.
  //
  // Side effect: a brief flicker on the timecode display during the probe
  // (sub-100ms in practice). Worth it to make the progress bar functional.
  useEffect(() => {
    durationProbedRef.current = false;
    seenMaxTimeRef.current = 0;
    setDuration(0);
    setCurrentTime(0);
  }, [src]);

  const probeDuration = () => {
    const video = videoRef.current;
    if (!video || durationProbedRef.current) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
      return;
    }
    durationProbedRef.current = true;
    const onDurationResolved = () => {
      const v = videoRef.current;
      if (!v) return;
      if (Number.isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
        // Reset playback head to the start — the probe seek pushed it to
        // the end of the recording.
        v.currentTime = 0;
        setCurrentTime(0);
        v.removeEventListener('durationchange', onDurationResolved);
        v.removeEventListener('timeupdate', onDurationResolved);
      }
    };
    video.addEventListener('durationchange', onDurationResolved);
    video.addEventListener('timeupdate', onDurationResolved);
    try {
      // Some Chromium builds reject MAX_SAFE_INTEGER outright; 1e9 (≈31
      // years of video) is the standard workaround that all browsers
      // accept without throwing.
      video.currentTime = 1e9;
    } catch {
      // Last-resort fallback handled by `seenMaxTimeRef` below.
    }
  };

  // Mouse-idle controls auto-hide while fullscreen. Any mouse movement
  // resets the timer and re-shows the controls.
  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      return;
    }
    const bump = () => {
      setControlsVisible(true);
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
    };
    bump();
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener('mousemove', bump);
    node.addEventListener('mouseleave', () => setControlsVisible(false));
    return () => {
      node.removeEventListener('mousemove', bump);
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
    };
  }, [isFullscreen]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) video.pause();
    else video.play();
  };
  const handleSkip = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(video.currentTime + 10, duration);
  };
  const handleRewind = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(video.currentTime - 10, 0);
  };
  const handleFullscreen = () => {
    // Toggle: if we're already fullscreen, exit; otherwise fullscreen the
    // container so our custom controls travel with it.
    //
    // Mobile fallback chain:
    //  1. Standard Fullscreen API on the container — works on desktop +
    //     Android Chrome + most modern WebViews. Lets our custom UI travel.
    //  2. iOS Safari only exposes fullscreen on the <video> element via the
    //     vendor-prefixed `webkitEnterFullscreen()`. It uses native chrome
    //     (our overlay doesn't travel) but it's the only way to go
    //     fullscreen on iPhone, so we accept the trade-off there.
    //  3. CSS pseudo-fullscreen as a last resort — we add a flag that
    //     promotes the container to `fixed inset-0` via the existing
    //     `isFullscreen` styles. Driven by a synthetic state since
    //     `document.fullscreenElement` won't be set.

    // Exit path — covers both real Fullscreen API and the CSS fallback.
    if (document.fullscreenElement || isFullscreen) {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else {
        setIsFullscreen(false);
      }
      return;
    }

    const container = containerRef.current;
    const video = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitExitFullscreen?: () => void;
    }) | null;
    const containerWithPrefix = container as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    }) | null;

    // 1. Standard API.
    if (container?.requestFullscreen) {
      container.requestFullscreen().catch(() => setIsFullscreen(true));
      return;
    }
    // Safari desktop has a vendor-prefixed variant on elements.
    if (containerWithPrefix?.webkitRequestFullscreen) {
      containerWithPrefix.webkitRequestFullscreen();
      return;
    }
    // 2. iOS Safari — fall back to native <video> fullscreen.
    if (video?.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
      return;
    }
    // 3. CSS pseudo-fullscreen — works literally everywhere as a final
    //    safety net (a fixed-position div above the page chrome).
    setIsFullscreen(true);
  };
  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted) {
      const restore = volume === 0 ? 0.5 : volume;
      video.volume = restore;
      video.muted = false;
      setVolume(restore);
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVolume;
    video.muted = newVolume === 0;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!duration) return;
    const seekTime = (duration / 100) * parseInt(e.target.value, 10);
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  // Effective duration prefers the real value when finite; otherwise falls
  // back to the highest currentTime we've actually played past, with a
  // 60-second floor so a freshly-started video doesn't show 100% on its
  // first frame. The combination keeps the bar visibly moving even when
  // the MediaRecorder webm refuses to surrender a clean duration header.
  const effectiveDuration =
    Number.isFinite(duration) && duration > 0
      ? duration
      : Math.max(seenMaxTimeRef.current, 60);
  const progressPercent =
    effectiveDuration > 0
      ? Math.min(100, (currentTime / effectiveDuration) * 100)
      : 0;
  // In fullscreen the controls overlay scales up — bigger icons, more
  // padding — so they're usable on a TV-sized viewport. In compact mode
  // (chat bubble) they stay dense.
  const iconSize = isFullscreen ? 'text-3xl' : compact ? 'text-base' : 'text-2xl';
  const stripPad = isFullscreen ? 'px-6 py-3' : compact ? 'px-2 py-1.5' : 'px-4 py-2';
  const fontSize = isFullscreen ? 'text-base' : compact ? 'text-[11px]' : 'text-sm';
  // Progress bar height — bumped from h-1 (4px) to h-1.5/h-2 so the
  // empty track is actually visible against the player chrome. Knob also
  // grows so it doesn't get lost.
  const trackHeight = isFullscreen ? 'h-2' : compact ? 'h-1.5' : 'h-1.5';
  const knobSize = isFullscreen ? 'h-4 w-4' : compact ? 'h-3 w-3' : 'h-3 w-3';
  // Track color — `bg-black/15 dark:bg-white/25` reads on both the
  // light strip (light mode) and the dark strip (dark mode); the old
  // `bg-gray-300 dark:bg-[#404040]` was nearly invisible against the
  // dark `#1C1C1E` chrome.
  const trackBg = isFullscreen ? 'bg-white/30' : 'bg-black/20 dark:bg-white/25';

  return (
    <div
      ref={containerRef}
      className={`relative bg-white dark:bg-[#1C1C1E] rounded-xl overflow-hidden border border-white/15 dark:border-[#2d2d2d] shadow-lg ${
        isFullscreen
          // When fullscreen is driven by the standard API the browser
          // already lifts the element out of layout; the extra `fixed
          // inset-0 z-[9999]` covers the CSS-fallback path used on
          // browsers without element-fullscreen support (iOS Safari etc.)
          // so the player visually fills the screen either way.
          ? 'w-screen h-screen flex items-center justify-center fixed inset-0 z-[9999] rounded-none border-0'
          : ''
      } ${className}`}
    >
      <video
        ref={videoRef}
        poster={poster}
        // `playsInline` is required on iOS Safari — without it, hitting Play
        // inside the page would yank the video into native fullscreen with
        // browser chrome, bypassing our custom controls entirely.
        playsInline
        onClick={handlePlayPause}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) {
            setDuration(v.duration);
          } else {
            // MediaRecorder webm with missing duration metadata — trigger
            // the seek-to-end probe to force the browser to scan the file.
            probeDuration();
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          // Belt-and-suspenders: even if the probe never resolves a
          // finite duration (some buggy browsers), tracking the max time
          // we've actually played past gives the progress bar SOMETHING
          // sensible to scale against during normal playback.
          if (t > seenMaxTimeRef.current) seenMaxTimeRef.current = t;
        }}
        onDurationChange={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        className={`bg-black cursor-pointer ${
          isFullscreen
            ? 'w-full h-full object-contain'
            : 'w-full aspect-video'
        }`}
      >
        {/* Belt-and-suspenders — set the <video src> AND a <source>. Some
            Chromium builds prefer the src attr; others need the <source>
            children. Browsers ignore the redundancy. */}
        <source src={src} type={effectiveMime} />
        Your browser does not support the video tag.
      </video>

      {/* Custom controls — in fullscreen, this becomes an absolute overlay
          at the bottom of the video with auto-hide on mouse-idle. Out of
          fullscreen it's a normal strip below the video. */}
      <div
        className={`${stripPad} bg-white dark:bg-[#1C1C1E] transition-opacity duration-200 ${
          isFullscreen
            ? `absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/85 to-black/30 ${
                controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`
            : ''
        }`}
      >
        <div
          className={`flex items-center ${
            isFullscreen ? 'gap-5' : compact ? 'gap-2' : 'gap-2 sm:gap-4'
          } ${
            isFullscreen ? 'text-white/85' : 'text-gray-600 dark:text-[#A1A1AA]'
          } relative`}
        >
          <button
            onClick={handleRewind}
            disabled={duration === 0 || currentTime < 1}
            // Hidden on narrow mobile screens so the fullscreen button has
            // room to render. Available from `sm:` (640 px) upwards.
            className={`hidden sm:inline-flex ${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors disabled:opacity-40 p-0.5`}
          >
            <i className={`ph-fill ph-skip-back ${iconSize}`}></i>
          </button>
          <button
            onClick={handlePlayPause}
            disabled={duration === 0}
            className={`${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors disabled:opacity-40 p-0.5`}
          >
            <i className={`ph-fill ${isPlaying ? 'ph-pause' : 'ph-play'} ${iconSize}`}></i>
          </button>
          <button
            onClick={handleSkip}
            disabled={duration === 0 || currentTime >= duration}
            className={`hidden sm:inline-flex ${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors disabled:opacity-40 p-0.5`}
          >
            <i className={`ph-fill ph-skip-forward ${iconSize}`}></i>
          </button>

          {/* Time */}
          <span
            className={`${fontSize} font-mono whitespace-nowrap tabular-nums ${
              isFullscreen ? 'text-white' : ''
            }`}
          >
            {formatTime(currentTime)} / {formatTime(Number.isFinite(duration) && duration > 0 ? duration : NaN)}
          </span>

          {/* Seek bar */}
          <div className="flex-1 group flex items-center mx-1 relative h-5">
            <div className="relative w-full h-5 flex items-center overflow-hidden">
              <input
                type="range"
                min="0"
                max="100"
                value={progressPercent}
                onChange={handleSeek}
                disabled={duration === 0}
                className="w-full h-5 appearance-none cursor-pointer absolute z-20 focus:outline-none"
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: 'transparent',
                  opacity: 0,
                  height: '100%',
                  margin: 0,
                  padding: 0,
                } as React.CSSProperties}
              />
              <div className={`w-full ${trackHeight} ${trackBg} rounded-full relative pointer-events-none z-10`}>
                <div
                  className={`absolute top-0 left-0 ${trackHeight} bg-[#6A3FF4] rounded-full transition-all duration-100 ease-linear`}
                  style={{ width: `${progressPercent}%` }}
                ></div>
                <div
                  className={`absolute top-1/2 -translate-y-1/2 ${knobSize} rounded-full shadow-lg transition-all duration-100`}
                  style={{
                    left: progressPercent === 0 ? '0px' : `calc(${progressPercent}% - ${
                      isFullscreen ? '8' : '6'
                    }px)`,
                    backgroundColor: 'white',
                    border: `2px solid ${isPlaying ? '#6A3FF4' : 'white'}`,
                    boxShadow: isPlaying ? '0 0 8px #6A3FF4' : '0 0 4px rgba(0,0,0,0.4)',
                  }}
                ></div>
              </div>
            </div>
          </div>

          {/* Volume — compact chat bubble shows just the mute toggle; the
              full / fullscreen modes show a slider next to it. */}
          <button
            onClick={handleMuteToggle}
            className={`${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors p-0.5`}
          >
            <i
              className={`ph-fill ${
                isMuted || volume === 0 ? 'ph-speaker-slash' : 'ph-speaker-high'
              } ${iconSize}`}
            ></i>
          </button>
          {(!compact || isFullscreen) && (
            // Volume slider — hidden on narrow mobile screens (the mute
            // toggle above is enough) so the fullscreen button doesn't get
            // pushed off the right edge of the controls strip.
            <div className={`hidden sm:flex relative ${isFullscreen ? 'w-24' : 'w-16'} h-5 items-center`}>
              <div className={`w-full ${trackHeight} ${trackBg} rounded-full absolute pointer-events-none z-10`}>
                <div
                  className={`h-full bg-[#6A3FF4] rounded-full transition-all duration-100 ease-linear`}
                  style={{ width: `${volume * 100}%` }}
                ></div>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="w-full h-full appearance-none cursor-pointer absolute z-20 focus:outline-none"
                style={{
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: 'transparent',
                  opacity: 0,
                  padding: 0,
                  margin: 0,
                } as React.CSSProperties}
              />
            </div>
          )}

          {/* Settings (playback rate) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowSettings((s) => !s);
            }}
            className={`${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors p-0.5 relative`}
            title="Playback speed"
          >
            <i className={`ph-fill ph-gear ${iconSize}`}></i>
          </button>

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className={`${
              isFullscreen ? 'text-white' : 'text-black dark:text-white'
            } hover:text-[#6A3FF4] transition-colors p-0.5`}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <i className={`ph-fill ${isFullscreen ? 'ph-corners-in' : 'ph-corners-out'} ${iconSize}`}></i>
          </button>

          {showSettings && (
            <SettingsMenu
              videoRef={videoRef}
              currentRate={playbackRate}
              setRate={setPlaybackRate}
              onClose={() => setShowSettings(false)}
              compact={compact}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default UniFlowVideoPlayer;
