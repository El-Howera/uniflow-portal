// Plan 7 follow-up — In-app live session room (LiveKit edition).
//
// Replaces the Jitsi iframe with @livekit/components-react. Every control
// is a native React hook call — no iframe, no postMessage, no foreign chrome
// bleeding through. The UniFlow toolbar + side panels are the only UI.
//
// Features:
//   - Mic / camera / screen share / chat / raise hand (data channel) / leave
//   - Device picker (mic / cam / speaker) — actually works because we call
//     `localParticipant.setMicrophoneEnabled`/`setCameraEnabled` with deviceId
//   - Whiteboard tab using Excalidraw with built-in real-time collaboration
//   - Host overrides (mute everyone, remove participant, end-for-all)
//   - Browser screen recording with auto-upload on Leave / End / tab close
//   - Fullscreen toggle, glass-morphism UniFlow theming throughout
//
// LiveKit backend can be:
//   - LiveKit Cloud (sign up at https://livekit.io, free 10,000 min/month)
//   - Self-hosted via `docker compose -f docker/livekit/docker-compose.yml up`
// Either way, set LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET in .env.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LiveKitRoom as _LiveKitRoom,
  RoomAudioRenderer as _RoomAudioRenderer,
  GridLayout as _GridLayout,
  ParticipantTile as _ParticipantTile,
  useTracks,
  useMaybeTrackRefContext,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useChat,
  useDataChannel,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, RoomEvent, DisconnectReason } from 'livekit-client';
import type { LocalParticipant, RemoteParticipant } from 'livekit-client';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { GlassDropdown } from '../components/GlassDropdown';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useT } from '../i18n';

// React 18 component definitions return ReactNode; TS 4.9 (CRA) expects
// JSX.Element. Cast the imports to FC so JSX usage compiles. Behaviour
// unchanged at runtime — pure typing workaround.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LiveKitRoom: React.FC<any> = _LiveKitRoom as unknown as React.FC<any>;
const RoomAudioRenderer: React.FC = _RoomAudioRenderer as unknown as React.FC;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridLayout: React.FC<any> = _GridLayout as unknown as React.FC<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ParticipantTile: React.FC<any> = _ParticipantTile as unknown as React.FC<any>;

const glassCardStyle =
  'bg-white/10 dark:bg-black/40 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface SessionDetail {
  id: string;
  title: string;
  courseCode?: string | null;
  courseTitle?: string | null;
  hostName?: string;
  hostId?: string;
  startedAt?: string | null;
  status?: string;
  recordingUrl?: string | null;
}

interface TokenPayload {
  token: string;
  url: string;
  room: string;
  isHost: boolean;
  identity: string;
  displayName: string;
}

function formatElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ─── Outer page: fetches token + mounts <LiveKitRoom> ────────────────────────
const LiveSessionRoom: React.FC = () => {
  const t = useT();
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [tokenInfo, setTokenInfo] = useState<TokenPayload | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const token = localStorage.getItem('authToken');
    // Fetch session detail (best-effort) + LiveKit token (required).
    fetch(`${API_URLS.courseContent()}/api/sessions/by-id/${sessionId}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SessionDetail | null) => { if (data) setSession(data); })
      .catch(() => { /* tolerated */ });

    fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}/livekit-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(text || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: TokenPayload) => setTokenInfo(data))
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not get LiveKit token'));
  }, [sessionId]);

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center px-6 bg-[#0a0710]">
        <div className={`${glassCardStyle} p-8 max-w-md text-center space-y-3`}>
          <i className="ph-fill ph-warning-circle text-5xl text-red-400" />
          <h2 className="text-xl font-bold text-white">{t('liveRoom.failedToJoin')}</h2>
          <p className="text-sm text-gray-400 break-words">{loadError}</p>
          <p className="text-xs text-gray-500 mt-2">
            If this is the first time, set LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET in <code>.env</code> and restart <code>npm run content-server</code>. See <code>docker/livekit/README.md</code> for self-hosting.
          </p>
          <button onClick={() => navigate(-1)} className="mt-3 px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold">
            {t('admin.backBtn')}
          </button>
        </div>
      </div>
    );
  }

  if (!tokenInfo) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0710]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full border-2 border-[#7B5AFF] border-t-transparent animate-spin" />
          <p className="text-gray-400 text-sm">{t('liveRoom.connecting')}</p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={tokenInfo.token}
      serverUrl={tokenInfo.url}
      connect={true}
      audio={true}
      video={true}
      onDisconnected={(reason?: DisconnectReason) => {
        // Disconnects with reason DUPLICATE_IDENTITY mean another tab kicked
        // this one. We still want to navigate back so the user can rejoin.
        if (reason !== undefined) {
          console.warn('[LiveSessionRoom] disconnected', reason);
        }
        navigate(-1);
      }}
      data-lk-theme="default"
      className="h-screen"
    >
      <RoomContent sessionId={sessionId!} session={session} tokenInfo={tokenInfo} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
};

// ─── Inside-<LiveKitRoom> shell: hooks have access to room context here ──────
interface RoomContentProps {
  sessionId: string;
  session: SessionDetail | null;
  tokenInfo: TokenPayload;
}

type SidePanel = 'none' | 'participants' | 'settings' | 'whiteboard' | 'chat';

const RoomContent: React.FC<RoomContentProps> = ({ sessionId, session, tokenInfo }) => {
  const t = useT();
  const navigate = useNavigate();
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();

  // Lift the chat hook to the room scope. `useChat` runs `setupChat` which
  // registers the text-stream + legacy-data handlers on the room. If we only
  // called it inside `ChatPanel` (which mounts on demand) a participant who
  // hasn't opened their chat panel yet would silently drop every incoming
  // chat packet — the prof would type, send successfully, and the student
  // would see nothing because their room never subscribed. Calling it here
  // means the room subscribes the moment anyone joins, and the panel just
  // reads from the maintained history when opened.
  const chat = useChat();
  // Unread badge — increments every time a new message arrives while the
  // chat panel is closed; resets to 0 the moment the panel opens.
  const [unreadChat, setUnreadChat] = useState(0);
  const lastSeenChatCount = useRef(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<SidePanel>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const flashFeedback = useCallback((kind: 'success' | 'error' | 'info', text: string) => {
    setFeedback({ kind, text });
    window.setTimeout(() => setFeedback(null), 3500);
  }, []);

  // Track unread chat. When chat panel is open, lastSeenChatCount tracks the
  // full history; when it's closed, the delta becomes the unread badge.
  useEffect(() => {
    const count = chat.chatMessages.length;
    if (panel === 'chat') {
      lastSeenChatCount.current = count;
      if (unreadChat !== 0) setUnreadChat(0);
    } else if (count > lastSeenChatCount.current) {
      setUnreadChat(count - lastSeenChatCount.current);
    }
  }, [chat.chatMessages.length, panel, unreadChat]);

  // Track participant audio/video state directly from LiveKit. No iframe
  // postMessage layer, so these reflect truth.
  const micEnabled = localParticipant?.isMicrophoneEnabled ?? false;
  const camEnabled = localParticipant?.isCameraEnabled ?? false;
  const screenEnabled = localParticipant?.isScreenShareEnabled ?? false;
  const isHost = tokenInfo.isHost;

  // Hand-raise via data channel.
  //
  // Wire shape (single 'uniflow' channel):
  //   { kind: 'hand',       up: bool, name?: string }   // someone raised/lowered own hand
  //   { kind: 'lower-hand', target: identity }          // host asks a participant to lower
  //   { kind: 'mute-request' }                          // host asks everyone to mute
  //
  // `raisedHands` maps participantIdentity → name. Updated on every incoming
  // 'hand' event; cleared on participant disconnect. Host sees the list in
  // the People panel and can click to lower (sends a 'lower-hand' targeted
  // at that identity).
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Record<string, string>>({});

  // sendData is the writer; the inbound handler is registered separately so
  // we can access room context + flashFeedback + state setters.
  const { send: sendData } = useDataChannel('uniflow');

  // Helper used by the panel: lower a specific participant's hand (host only).
  const lowerHand = useCallback((identity: string) => {
    try {
      sendData(new TextEncoder().encode(JSON.stringify({ kind: 'lower-hand', target: identity })), { reliable: true });
    } catch { /* ignore */ }
    setRaisedHands((prev) => {
      const { [identity]: _omit, ...rest } = prev;
      return rest;
    });
  }, [sendData]);

  // Hosts never see the Raise Hand button — they're the ones being raised
  // hands AT. For students/non-hosts, toggling the local state + broadcasting
  // is enough; remote participants update raisedHands via the data handler.
  const toggleHand = useCallback(() => {
    if (isHost) return; // belt-and-suspenders; UI also hides for hosts
    const next = !handRaised;
    setHandRaised(next);
    try {
      sendData(new TextEncoder().encode(JSON.stringify({
        kind: 'hand',
        up: next,
        name: localParticipant?.name || localParticipant?.identity,
      })), { reliable: true });
    } catch { /* ignore */ }
  }, [handRaised, sendData, isHost, localParticipant?.name, localParticipant?.identity]);

  // Inbound 'hand' + 'lower-hand' events.
  useEffect(() => {
    const handler = (payload: Uint8Array, participant?: RemoteParticipant | LocalParticipant) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as {
          kind?: string;
          up?: boolean;
          name?: string;
          target?: string;
        };
        if (data.kind === 'hand' && participant) {
          const id = participant.identity;
          const displayName = data.name || participant.name || id;
          setRaisedHands((prev) => {
            const next = { ...prev };
            if (data.up) next[id] = displayName;
            else delete next[id];
            return next;
          });
          if (isHost && data.up) {
            flashFeedback('info', `${displayName} raised their hand.`);
          }
        }
        if (data.kind === 'lower-hand' && data.target === localParticipant?.identity) {
          // Host asked us to lower; clear local raise state.
          setHandRaised(false);
          flashFeedback('info', 'Host lowered your hand.');
        }
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, isHost, localParticipant?.identity, flashFeedback]);

  // Clear raised-hand state when a participant disconnects.
  useEffect(() => {
    const drop = (p: RemoteParticipant) => {
      setRaisedHands((prev) => {
        if (!(p.identity in prev)) return prev;
        const { [p.identity]: _omit, ...rest } = prev;
        return rest;
      });
    };
    room.on(RoomEvent.ParticipantDisconnected, drop);
    return () => { room.off(RoomEvent.ParticipantDisconnected, drop); };
  }, [room]);

  // Local elapsed clock (from session.startedAt if known, else from join).
  const [elapsedSec, setElapsedSec] = useState(0);
  const joinTimeRef = useRef<number>(Date.now());
  useEffect(() => {
    const startMs = session?.startedAt ? new Date(session.startedAt).getTime() : joinTimeRef.current;
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [session?.startedAt]);

  // Fullscreen sync.
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (rootRef.current) await rootRef.current.requestFullscreen();
    } catch { /* user-gesture issue */ }
  }, []);

  // ── Track refs for the grid ────────────────────────────────────────────────
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  // ── Pinned-tile state for click-to-focus ────────────────────────────────────
  // When a tile is clicked, we promote it to a large central view and demote
  // the rest to a horizontal strip below. Click the same tile again (or the
  // X badge) to unpin. Identity key is `${participant.identity}:${source}`
  // because a participant can publish multiple tracks (camera + screen).
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  // Strip auto-collapses when the user pins a share-screen so the screen
  // can fill the focus pane (the strip ate ~32 % of vertical space which
  // chopped off the lower half of a typical 16:9 share). Users can show
  // the strip again with the toggle arrow at the bottom edge.
  const [stripHidden, setStripHidden] = useState(false);
  const keyOf = (tr: ReturnType<typeof useTracks>[number]) =>
    `${tr.participant.identity}:${tr.source}`;
  const pinnedTrack = pinnedKey ? tracks.find((t) => keyOf(t) === pinnedKey) ?? null : null;
  const pinnedIsScreenShare = pinnedTrack?.source === Track.Source.ScreenShare;
  const otherTracks = pinnedTrack ? tracks.filter((t) => keyOf(t) !== pinnedKey) : [];
  // If the pinned participant leaves / unpublishes, drop the pin so the
  // grid takes over instead of showing a black box.
  useEffect(() => {
    if (pinnedKey && !pinnedTrack) setPinnedKey(null);
  }, [pinnedKey, pinnedTrack]);
  // Auto-hide the strip when a new pin lands on a share-screen. Pinning a
  // camera leaves the strip visible (cameras are usually narrower than
  // share screens, so the strip doesn't waste as much real estate).
  useEffect(() => {
    if (pinnedTrack && pinnedTrack.source === Track.Source.ScreenShare) {
      setStripHidden(true);
    } else {
      setStripHidden(false);
    }
  }, [pinnedTrack]);
  const togglePin = useCallback((k: string) => {
    setPinnedKey((prev) => (prev === k ? null : k));
  }, []);

  // ── Auto-hide controls while pinned ─────────────────────────────────────────
  // When a tile is pinned the focus pane wants every pixel; the control bar
  // covers the bottom 64–80 px of the share. Auto-hide it after a short idle
  // and reveal again on any mouse-move / touch / key press anywhere in the
  // room. The brand bar at the top stays visible so the user always sees the
  // elapsed timer + Host badge.
  const [controlsHidden, setControlsHidden] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsHidden(true), 2500);
  }, []);
  const revealControls = useCallback(() => {
    setControlsHidden(false);
    if (pinnedTrack) scheduleHide();
  }, [pinnedTrack, scheduleHide]);
  // Start the hide timer when a pin lands; clear and re-show when unpinned.
  useEffect(() => {
    if (!pinnedTrack) {
      setControlsHidden(false);
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      return;
    }
    scheduleHide();
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [pinnedTrack, scheduleHide]);
  // Reveal on any pointer/key activity inside the room.
  useEffect(() => {
    if (!pinnedTrack) return;
    const node = rootRef.current;
    if (!node) return;
    const handler = () => revealControls();
    node.addEventListener('mousemove', handler);
    node.addEventListener('touchstart', handler, { passive: true });
    node.addEventListener('pointerdown', handler);
    node.addEventListener('keydown', handler);
    return () => {
      node.removeEventListener('mousemove', handler);
      node.removeEventListener('touchstart', handler);
      node.removeEventListener('pointerdown', handler);
      node.removeEventListener('keydown', handler);
    };
  }, [pinnedTrack, revealControls]);

  // ── Control handlers (all native LiveKit hooks — work reliably) ────────────
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    await localParticipant.setMicrophoneEnabled(!micEnabled);
  }, [localParticipant, micEnabled]);

  const toggleCam = useCallback(async () => {
    if (!localParticipant) return;
    await localParticipant.setCameraEnabled(!camEnabled);
  }, [localParticipant, camEnabled]);

  // Track whether the host wants app/system audio included in the
  // share/record. Default ON because that's the common intent (Discord,
  // YouTube, etc.). Drives the audio toggle in the picker AND the
  // `audio: 'loopback'` flag sent to Electron's setDisplayMediaRequestHandler.
  const [includeShareAudio, setIncludeShareAudio] = useState(true);

  // Electron detection — must be defined before any callback that reads
  // it (startScreenShareFromPicker, the picker JSX) so TS can resolve the
  // declaration order. Defined as a useMemo for stability across re-
  // renders.
  const isElectron = useMemo(() => {
    const w = window as unknown as { uniflow?: { isElectron?: boolean; desktopCapture?: unknown } };
    return !!(w.uniflow?.isElectron && w.uniflow?.desktopCapture);
  }, []);

  // Stop-share is direct (no picker); only the "start" path needs the modal.
  const toggleScreen = useCallback(async () => {
    if (!localParticipant) return;
    if (screenEnabled) {
      try { await localParticipant.setScreenShareEnabled(false); }
      catch (err) { flashFeedback('error', err instanceof Error ? err.message : 'Could not stop screen share.'); }
      return;
    }
    // Starting share — go through the picker so the host gets the same UX
    // as the recording flow (and Electron's source list arrives via IPC).
    setPickerMode('share');
  }, [localParticipant, screenEnabled, flashFeedback]);

  // Picker-driven share start. Path differs by environment:
  //   - Electron: preselect the chosen source via IPC, then call LiveKit's
  //     setScreenShareEnabled — which calls getDisplayMedia under the hood
  //     and triggers our main-process setDisplayMediaRequestHandler.
  //   - Web: hint the displaySurface and rely on the browser picker; user
  //     still has to tick "Share tab/system audio" in the prompt.
  const startScreenShareFromPicker = useCallback(async (
    shareKind: 'screen' | 'window' | 'tab',
    electronSourceId?: string,
  ) => {
    if (!localParticipant) return;
    try {
      if (isElectron && electronSourceId) {
        const w = window as unknown as { uniflow?: { desktopCapture?: { preselect: (id: string, includeAudio?: boolean) => Promise<void> } } };
        await w.uniflow?.desktopCapture?.preselect(electronSourceId, includeShareAudio);
      }
      // Why we bypass LiveKit's setScreenShareEnabled wrapper here:
      // LiveKit's ScreenShareCaptureOptions type doesn't include the
      // `displaySurface` constraint, so passing it via that path is
      // silently dropped and the browser opens with its default tab.
      // Calling getDisplayMedia directly lets the hint actually reach
      // Chromium so the picker pops up pre-selected on Window / Monitor
      // / Browser tab — same UX as Discord. We then publish the
      // resulting tracks via LiveKit's publishTrack so the room sees
      // them as standard ScreenShare publications.
      const displaySurface =
        shareKind === 'screen' ? 'monitor'
        : shareKind === 'window' ? 'window'
        : 'browser';
      // Same gotcha as the recording path: pass `audio: true` (boolean),
      // NOT a constraints object. Constraints suppress the "Share tab/
      // system audio" checkbox in some Chromium builds, so the share
      // comes back video-only and the host has no way to opt in.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: ({ displaySurface } as unknown) as MediaTrackConstraints,
        audio: includeShareAudio,
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (!videoTrack) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('No video track in share stream.');
      }

      // Publish the video as a screen-share source so LiveKit + remote
      // clients render it through the standard screen-share tile path.
      await localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
      });
      // And the system/tab audio as a screen-share-audio source so
      // remote participants HEAR it. Without this second publish, the
      // audio track would never reach the room even if captured.
      if (audioTrack && includeShareAudio) {
        await localParticipant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
        });
      }
      // When the host clicks Chrome's "Stop sharing" pill, the video
      // track 'ended' event fires — we unpublish both tracks so the
      // share-screen button flips back automatically.
      videoTrack.addEventListener('ended', async () => {
        try { await localParticipant.unpublishTrack(videoTrack); } catch { /* ignore */ }
        if (audioTrack) {
          try { await localParticipant.unpublishTrack(audioTrack); } catch { /* ignore */ }
        }
      });

      // Post-share status — confirm to the host what's actually in the
      // share. On web, audio depends on whether they ticked the browser
      // checkbox; surface that fact instead of leaving them to guess.
      if (includeShareAudio && !audioTrack) {
        flashFeedback(
          'info',
          'Sharing video only — no app audio. Re-share with "Share tab/system audio" ticked in the browser prompt to include it.',
        );
      } else if (audioTrack) {
        flashFeedback('success', 'Sharing screen with app audio.');
      } else {
        flashFeedback('success', 'Sharing screen.');
      }
    } catch (err) {
      // User clicked Cancel on the share prompt — non-error; swallow.
      const msg = err instanceof Error ? err.message : 'Could not start screen share.';
      if (!/NotAllowedError|cancelled|permission/i.test(msg)) {
        flashFeedback('error', msg);
      }
    }
  }, [localParticipant, isElectron, includeShareAudio, flashFeedback]);

  // ── Host overrides — mute all / remove participant / end-for-all ──────────
  //
  // Mute-all UX: once clicked, the button stays in an active "Muted" state
  // until ANY remote participant unmutes themselves, at which point it
  // reverts to clickable. We can't truly server-enforce mute without
  // calling LiveKit's RoomService.mutePublishedTrack admin API (a backend
  // follow-up). For now the data-channel request is honoured by clients.
  const [mutedAll, setMutedAll] = useState(false);
  const muteEveryone = useCallback(async () => {
    if (!isHost || mutedAll) return;
    try {
      sendData(new TextEncoder().encode(JSON.stringify({ kind: 'mute-request' })), { reliable: true });
    } catch { /* ignore */ }
    setMutedAll(true);
    const targets = Math.max(0, participants.length - 1);
    flashFeedback('success', `Muted ${targets} participant${targets === 1 ? '' : 's'}. The button reverts when anyone unmutes.`);
  }, [isHost, mutedAll, participants.length, sendData, flashFeedback]);

  // Watch remote mic state. If anyone is currently unmuted while `mutedAll`
  // is active, flip the button back to clickable. LiveKit's
  // `useParticipants` returns objects whose `isMicrophoneEnabled` updates
  // automatically as track publications change — so this hook re-runs
  // whenever any remote mic state flips.
  useEffect(() => {
    if (!mutedAll) return;
    const anyRemoteUnmuted = participants.some(
      (p) => !p.isLocal && p.isMicrophoneEnabled,
    );
    if (anyRemoteUnmuted) {
      setMutedAll(false);
    }
  }, [mutedAll, participants]);

  // Auto-mute self when a host-issued mute-request arrives.
  useEffect(() => {
    const handler = (payload: Uint8Array, participant?: RemoteParticipant | LocalParticipant) => {
      if (!participant || !localParticipant || participant === localParticipant) return;
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string };
        if (data.kind === 'mute-request' && micEnabled) {
          localParticipant.setMicrophoneEnabled(false);
          flashFeedback('info', 'Host muted everyone. Click the mic to unmute.');
        }
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, localParticipant, micEnabled, flashFeedback]);

  const removeParticipant = useCallback(async (identity: string) => {
    if (!isHost) return;
    // Best-effort via data channel "please leave" signal. True server-side
    // kick uses LiveKit's RoomService.removeParticipant from a backend
    // endpoint; can be added when needed.
    try {
      sendData(new TextEncoder().encode(JSON.stringify({ kind: 'kick', target: identity })), { reliable: true });
      flashFeedback('info', `Removal request sent.`);
    } catch { /* ignore */ }
  }, [isHost, sendData, flashFeedback]);

  // Listen for being-kicked.
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string; target?: string };
        if (data.kind === 'kick' && data.target === localParticipant?.identity) {
          flashFeedback('error', 'You were removed from the session by the host.');
          window.setTimeout(() => navigate(-1), 1200);
        }
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, localParticipant?.identity, navigate, flashFeedback]);

  // ── Recording (browser MediaRecorder — platform-agnostic) ──────────────────
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingUploadedRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  // Discord-style picker — shared by Record + Share-screen flows. In
  // Electron it shows a thumbnail grid of actual desktop sources (driven
  // by IPC). In the browser it shows 3 placeholder cards because the
  // browser security model forbids enumerating windows from web code.
  // Mode drives what the picker DOES on selection: record-and-mix audio,
  // or hand off to LiveKit's screen-share publisher.
  const [pickerMode, setPickerMode] = useState<null | 'record' | 'share'>(null);
  // Real desktop sources for the Electron path. Empty array on web.
  const [desktopSources, setDesktopSources] = useState<{
    id: string;
    name: string;
    kind: 'screen' | 'window';
    thumbnail: string;
    appIcon: string | null;
  }[]>([]);
  // Pending selection inside the picker — drives the select+confirm UX.
  // Clicking a source / card highlights it; the host clicks the primary
  // CTA at the bottom to actually start the share or recording. Lets the
  // host change their mind without committing to a permission prompt.
  const [pendingSelection, setPendingSelection] = useState<null | {
    kind: 'screen' | 'window' | 'tab';
    electronSourceId?: string;
    name?: string;
  }>(null);
  // Reset the pending selection every time the picker opens/closes so a
  // stale highlight from a previous session doesn't persist.
  useEffect(() => {
    if (pickerMode === null) setPendingSelection(null);
  }, [pickerMode]);
  // Fetch the real source list every time the picker opens in Electron.
  // Thumbnails are point-in-time — refresh on open so the user sees the
  // latest preview rather than what was there last time they recorded.
  useEffect(() => {
    if (!pickerMode || !isElectron) return;
    const w = window as unknown as {
      uniflow?: {
        desktopCapture?: {
          getSources: () => Promise<{
            id: string;
            name: string;
            kind: 'screen' | 'window';
            thumbnail: string;
            appIcon: string | null;
          }[]>;
        };
      };
    };
    w.uniflow?.desktopCapture?.getSources()
      .then(setDesktopSources)
      .catch(() => setDesktopSources([]));
  }, [pickerMode, isElectron]);
  // Web Audio mixing infra — used by startRecording to combine every
  // participant's microphone (local + remote) plus any optional tab/system
  // audio from getDisplayMedia into a single audio track on the recording
  // stream. Without this the recording is silent on any browser/OS combo
  // where the user doesn't opt-in to share system audio (most of them).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  // Map keyed by the MediaStreamTrack.id so we can clean up exactly the
  // source node for a track when the participant unpublishes / leaves.
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  // Bag of room-event handlers we registered while recording — kept here
  // so cleanup can detach the same function references.
  const audioRoomHandlersRef = useRef<{
    onSubscribed?: (...args: unknown[]) => void;
    onUnsubscribed?: (...args: unknown[]) => void;
    onPublished?: (...args: unknown[]) => void;
    onUnpublished?: (...args: unknown[]) => void;
  }>({});

  const uploadRecording = useCallback(async () => {
    if (recordingUploadedRef.current) return;
    const chunks = recordingChunksRef.current;
    const recorder = recorderRef.current;
    if (!recorder) {
      flashFeedback('error', 'No recorder is active.');
      return;
    }
    if (chunks.length === 0) {
      flashFeedback('error', 'Recording captured no data. Try recording for at least 2 seconds.');
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
    if (blob.size === 0) {
      flashFeedback('error', 'Recording is 0 bytes.');
      return;
    }
    recordingUploadedRef.current = true;
    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    flashFeedback('info', `Uploading ${sizeMb} MB recording… do not close this tab.`);
    const ext = (recorder.mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
    const fd = new FormData();
    fd.append('recording', blob, `session-${sessionId}.${ext}`);
    try {
      const token = localStorage.getItem('authToken');
      const r = await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}/recording-upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!r.ok) {
        recordingUploadedRef.current = false;
        const text = await r.text().catch(() => '');
        flashFeedback('error', `Upload failed: HTTP ${r.status}. ${text.slice(0, 140)}`);
        return;
      }
      flashFeedback('success', `Recording uploaded (${sizeMb} MB). Students can now watch replay.`);
    } catch (err) {
      recordingUploadedRef.current = false;
      flashFeedback('error', `Upload network error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }, [sessionId, flashFeedback]);

  // Add a MediaStreamTrack (audio kind, from a LiveKit publication or from
  // getDisplayMedia) into the Web Audio mix. Idempotent — calling twice for
  // the same track is safe.
  const addAudioTrackToMix = useCallback((mediaStreamTrack: MediaStreamTrack) => {
    const ctx = audioCtxRef.current;
    const dest = audioDestRef.current;
    if (!ctx || !dest) return;
    if (mediaStreamTrack.kind !== 'audio') return;
    if (audioSourcesRef.current.has(mediaStreamTrack.id)) return;
    try {
      // Wrap the track in its own MediaStream so createMediaStreamSource
      // sees a stable source. Different LiveKit versions surface the
      // underlying track on slightly different paths; one MediaStream per
      // track is the path that's portable across them all.
      const ms = new MediaStream([mediaStreamTrack]);
      const src = ctx.createMediaStreamSource(ms);
      src.connect(dest);
      audioSourcesRef.current.set(mediaStreamTrack.id, src);
    } catch {
      // Some browsers refuse to add a muted/zero-channel track. Skipping
      // it is fine — the rest of the mix still works.
    }
  }, []);

  const removeAudioTrackFromMix = useCallback((mediaStreamTrack: MediaStreamTrack) => {
    const src = audioSourcesRef.current.get(mediaStreamTrack.id);
    if (!src) return;
    try { src.disconnect(); } catch { /* ignore */ }
    audioSourcesRef.current.delete(mediaStreamTrack.id);
  }, []);

  // Track the kind of share the host picked in the pre-recording modal so
  // we can pass the matching displaySurface hint to the browser picker.
  type ShareKind = 'screen' | 'window' | 'tab';

  const startRecording = useCallback(async (shareKind: ShareKind = 'screen') => {
    if (recorderRef.current) {
      flashFeedback('info', 'Recording is already running.');
      return;
    }
    try {
      const navAny = navigator as unknown as { mediaDevices?: { getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> } };
      if (!navAny.mediaDevices?.getDisplayMedia) {
        flashFeedback('error', 'Your browser does not support screen recording.');
        return;
      }
      // Screen capture for video + (best-effort) tab/system audio. The
      // explicit audio constraints below trade some quality preprocessing
      // off in favour of preserving the original waveform — important
      // when the host is sharing a YouTube video, Discord call audio, or
      // any other application whose audio they want students to hear.
      //
      // The `displaySurface` hint tells the browser picker which tab to
      // open on by default — 'monitor' for entire screen (best for
      // capturing system audio + apps like Discord), 'window' for a
      // single application window, 'browser' for a tab. The user can
      // still pick anything else; the hint just sets the default tab.
      //
      // Audio capture status is enforced by the browser security model:
      // the user must explicitly tick "Share tab audio" / "Share system
      // audio" in the share prompt. The PreRecordingModal (rendered
      // above the Record button) walks them through this before they
      // ever see the prompt, and we re-check the audio status after the
      // share completes so a missed checkbox surfaces immediately.
      // CRITICAL: audio MUST be the boolean `true`, NOT a constraints
      // object. Some Chromium builds suppress the "Share tab audio" /
      // "Share system audio" checkbox in the OS picker when the caller
      // passes advanced audio constraints — the host then has no way
      // to opt in to audio capture and the share comes back video-only.
      // `audio: true` consistently surfaces the checkbox across all
      // current Chrome / Edge versions.
      const screenStream = await navAny.mediaDevices.getDisplayMedia({
        video: ({
          displaySurface: shareKind === 'screen' ? 'monitor' : shareKind === 'window' ? 'window' : 'browser',
        } as unknown) as MediaTrackConstraints | boolean,
        audio: includeShareAudio,
      });

      // ── Build the Web Audio mix of every active mic in the room ────────────
      // Cross-browser AudioContext: Safari still ships only the prefixed name.
      const Ctx: typeof AudioContext =
        window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        || AudioContext;
      const audioCtx = new Ctx();
      // Some browsers create an AudioContext in 'suspended' state when there
      // hasn't been a recent user gesture; resume() inside the click handler
      // chain guarantees the mix produces sound. No-op when already running.
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch { /* ignore */ }
      }
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      audioDestRef.current = dest;

      // 1. Local participant mic — the host's own voice. Pull from the
      //    LiveKit publication when present; fall back to a fresh
      //    getUserMedia call when the host isn't currently publishing
      //    (e.g. they joined muted and never unmuted before recording).
      const localMicPub = Array.from(localParticipant?.audioTrackPublications?.values?.() || [])
        .find((p) => p.source === Track.Source.Microphone);
      const localMicTrack = localMicPub?.track?.mediaStreamTrack;
      if (localMicTrack) {
        addAudioTrackToMix(localMicTrack);
      } else {
        try {
          const userMic = await navigator.mediaDevices.getUserMedia({ audio: true });
          // Keep a reference on the screenStream so cleanup stops it too.
          userMic.getAudioTracks().forEach((t) => {
            addAudioTrackToMix(t);
            screenStream.addTrack(t);
          });
        } catch {
          // Mic denied — recording still proceeds with just remote audio
          // (if any) and any opt-in tab audio.
        }
      }

      // 2. Every currently-subscribed remote participant's mic.
      participants.forEach((p) => {
        if (p.isLocal) return;
        // Type-cast through unknown — LiveKit's audioTrackPublications is a
        // Map keyed on track sid, but the value type narrows differently for
        // local vs remote participants and TS can't bridge the union here.
        const pubsIter = p.audioTrackPublications?.values?.() as unknown as Iterable<{ track?: { mediaStreamTrack?: MediaStreamTrack } }> | undefined;
        if (!pubsIter) return;
        for (const pub of pubsIter) {
          const t = pub?.track?.mediaStreamTrack;
          if (t) addAudioTrackToMix(t);
        }
      });

      // 3. Tab / system / app audio the host opted into via the share prompt.
      //    Same createMediaStreamSource path the mic uses — it's the most
      //    reliable across current Chrome/Edge versions. The earlier
      //    HTMLAudioElement bridge was based on a Chromium bug that
      //    hasn't applied for several years and was costing us silent
      //    captures.
      const shareAudioTracks = screenStream.getAudioTracks();
      shareAudioTracks.forEach((track) => addAudioTrackToMix(track));
      // Resume once more AFTER all sources are connected — some browsers
      // suspend the context during the modal interaction and the only
      // way to wake it up reliably is to call resume() with the sources
      // already wired. No-op when already running.
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch { /* ignore */ }
      }
      // Surface immediately when no audio reached us so the host can
      // stop, re-share with the audio checkbox ticked, and try again.
      // Most common cause by far: the host clicked Share without ticking
      // "Share tab audio" / "Share system audio" in Chrome's picker.
      if (includeShareAudio && shareAudioTracks.length === 0) {
        flashFeedback(
          'error',
          'No application audio captured — re-share with "Share tab audio" / "Share system audio" TICKED in Chrome\'s next prompt.',
        );
      }

      // 4. Subscribe to room events so participants who publish a mic AFTER
      //    recording starts (e.g. someone unmuting late) are added live.
      const onTrackSubscribed = (track: { kind?: string; mediaStreamTrack?: MediaStreamTrack }) => {
        if (track?.kind === 'audio' && track.mediaStreamTrack) {
          addAudioTrackToMix(track.mediaStreamTrack);
        }
      };
      const onTrackUnsubscribed = (track: { kind?: string; mediaStreamTrack?: MediaStreamTrack }) => {
        if (track?.kind === 'audio' && track.mediaStreamTrack) {
          removeAudioTrackFromMix(track.mediaStreamTrack);
        }
      };
      const onLocalTrackPublished = (pub: { track?: { mediaStreamTrack?: MediaStreamTrack; kind?: string } }) => {
        const t = pub?.track?.mediaStreamTrack;
        if (pub?.track?.kind === 'audio' && t) addAudioTrackToMix(t);
      };
      const onLocalTrackUnpublished = (pub: { track?: { mediaStreamTrack?: MediaStreamTrack; kind?: string } }) => {
        const t = pub?.track?.mediaStreamTrack;
        if (pub?.track?.kind === 'audio' && t) removeAudioTrackFromMix(t);
      };
      // Cast through unknown — LiveKit's event-payload types vary across
      // SDK versions; we only need the duck-typed `{kind, mediaStreamTrack}`
      // shape which has been stable for years.
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed as unknown as (...a: unknown[]) => void);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed as unknown as (...a: unknown[]) => void);
      room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished as unknown as (...a: unknown[]) => void);
      room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished as unknown as (...a: unknown[]) => void);
      audioRoomHandlersRef.current = {
        onSubscribed: onTrackSubscribed as unknown as (...a: unknown[]) => void,
        onUnsubscribed: onTrackUnsubscribed as unknown as (...a: unknown[]) => void,
        onPublished: onLocalTrackPublished as unknown as (...a: unknown[]) => void,
        onUnpublished: onLocalTrackUnpublished as unknown as (...a: unknown[]) => void,
      };

      // ── Compose the final recorder input stream ────────────────────────────
      // Screen video + mixed audio. We deliberately drop the raw audio
      // tracks from screenStream because they're already routed through the
      // mix; including them twice would double-record any opt-in tab audio.
      const recordStream = new MediaStream();
      screenStream.getVideoTracks().forEach((t) => recordStream.addTrack(t));
      dest.stream.getAudioTracks().forEach((t) => recordStream.addTrack(t));

      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
        .find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        // Stop EVERY track from EVERY upstream stream — screen tracks live
        // on `screenStream`, mixed audio on `dest.stream`, plus the fallback
        // getUserMedia tracks we merged into screenStream above.
        screenStream.getTracks().forEach((t) => t.stop());
        dest.stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      // recordingStreamRef points at the original screen stream so the
      // existing "share track ended" listener still fires when the user
      // clicks the browser's "Stop sharing" pill.
      recordingStreamRef.current = screenStream;
      recordingUploadedRef.current = false;
      setIsRecording(true);
      flashFeedback('success', 'Recording started. It will auto-upload when you leave.');
      screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (recorder.state !== 'inactive') recorder.stop();
        setIsRecording(false);
      });
    } catch {
      flashFeedback('error', 'Recording cancelled or not permitted.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashFeedback, room, participants, localParticipant, addAudioTrackToMix, removeAudioTrackFromMix]);

  // Tear down everything we wired up in startRecording: room event
  // listeners, audio source nodes, AudioContext. Idempotent — safe to call
  // from stopRecording AND from beforeunload AND from component unmount.
  const teardownAudioMix = useCallback(() => {
    const handlers = audioRoomHandlersRef.current;
    if (handlers.onSubscribed) {
      try { room.off(RoomEvent.TrackSubscribed, handlers.onSubscribed); } catch { /* ignore */ }
    }
    if (handlers.onUnsubscribed) {
      try { room.off(RoomEvent.TrackUnsubscribed, handlers.onUnsubscribed); } catch { /* ignore */ }
    }
    if (handlers.onPublished) {
      try { room.off(RoomEvent.LocalTrackPublished, handlers.onPublished); } catch { /* ignore */ }
    }
    if (handlers.onUnpublished) {
      try { room.off(RoomEvent.LocalTrackUnpublished, handlers.onUnpublished); } catch { /* ignore */ }
    }
    audioRoomHandlersRef.current = {};
    audioSourcesRef.current.forEach((src) => {
      try { src.disconnect(); } catch { /* ignore */ }
    });
    audioSourcesRef.current.clear();
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* ignore */ }
    }
    audioCtxRef.current = null;
    audioDestRef.current = null;
  }, [room]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    setIsRecording(false);
    await uploadRecording();
    recorderRef.current = null;
    recordingStreamRef.current = null;
    recordingChunksRef.current = [];
    teardownAudioMix();
  }, [uploadRecording, teardownAudioMix]);

  // beforeunload + unmount cleanup.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (recorderRef.current && !recordingUploadedRef.current) {
        e.preventDefault();
        e.returnValue = 'Recording is still uploading.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (recorderRef.current && !recordingUploadedRef.current) {
        uploadRecording();
      }
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      // Tear down the audio mix infrastructure too — without this, the
      // AudioContext keeps the page's audio device handle locked even after
      // the user leaves the room.
      teardownAudioMix();
    };
  }, [uploadRecording, teardownAudioMix]);

  // ── Leave / end ────────────────────────────────────────────────────────────
  const hangup = useCallback(async () => {
    if (recorderRef.current && !recordingUploadedRef.current) {
      if (recorderRef.current.state !== 'inactive') {
        try {
          await new Promise<void>((resolve) => {
            recorderRef.current!.addEventListener('stop', () => resolve(), { once: true });
            recorderRef.current!.stop();
          });
        } catch { /* ignore */ }
      }
      await uploadRecording();
    }
    try { await room.disconnect(); } catch { /* ignore */ }
    navigate(-1);
  }, [room, navigate, uploadRecording]);

  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const endForEveryone = useCallback(async () => {
    setConfirmingEnd(false);
    if (recorderRef.current && !recordingUploadedRef.current) {
      if (recorderRef.current.state !== 'inactive') {
        try {
          await new Promise<void>((resolve) => {
            recorderRef.current!.addEventListener('stop', () => resolve(), { once: true });
            recorderRef.current!.stop();
          });
        } catch { /* ignore */ }
      }
      await uploadRecording();
    }
    try {
      const token = localStorage.getItem('authToken');
      await fetch(`${API_URLS.courseContent()}/api/sessions/${sessionId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { ...authHeaders(), 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'ended' }),
      });
    } catch { /* ignore */ }
    // Tell others to disconnect via data channel.
    try {
      sendData(new TextEncoder().encode(JSON.stringify({ kind: 'end-all' })), { reliable: true });
    } catch { /* ignore */ }
    await room.disconnect();
    navigate(-1);
  }, [sessionId, room, navigate, uploadRecording, sendData]);

  // Non-hosts honor end-all.
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as { kind?: string };
        if (data.kind === 'end-all') {
          flashFeedback('info', 'Host ended the session for everyone.');
          window.setTimeout(() => { room.disconnect(); navigate(-1); }, 1200);
        }
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, navigate, flashFeedback]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const sessionStartLabel = session?.startedAt
    ? new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div ref={rootRef} className="fixed inset-0 z-40 flex flex-col bg-gradient-to-br from-[#0a0710] via-[#0d0d18] to-[#0a0710]">
      {/* Top brand bar */}
      <div className={`${glassCardStyle} mx-3 mt-3 px-4 sm:px-5 py-3 flex items-center justify-between rounded-2xl`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center shadow-lg shadow-[#6A3FF4]/30">
            <i className="ph-fill ph-broadcast text-white text-lg animate-pulse" />
          </div>
          <div className="min-w-0">
            <h1 className="text-white font-bold text-sm sm:text-base truncate">
              {session?.title || 'Live session'}
              {(session?.courseTitle || session?.courseCode) && (
                <span className="ml-2 text-xs text-[#7B5AFF]">
                  {session?.courseTitle || session?.courseCode}
                </span>
              )}
            </h1>
            <p className="text-[10px] text-gray-400 font-mono tabular-nums flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              live · {formatElapsed(elapsedSec)} elapsed
              {sessionStartLabel && <span className="text-gray-500">· started {sessionStartLabel}</span>}
              {isRecording && (
                <span className="ml-2 text-[10px] font-bold text-red-400 flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  REC
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400 hidden sm:inline">{participants.length} in room</span>
          {isHost && (
            <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-[#6A3FF4]/20 text-[#7B5AFF] border border-[#6A3FF4]/40">
              Host
            </span>
          )}
        </div>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`mx-3 mt-2 px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 border ${
            feedback.kind === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : feedback.kind === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
          }`}
        >
          <i className={`ph-bold ${feedback.kind === 'success' ? 'ph-check-circle' : feedback.kind === 'error' ? 'ph-warning-circle' : 'ph-info'}`} />
          {feedback.text}
        </div>
      )}

      {/* Main: video grid + side panel */}
      <div className="flex-1 flex gap-3 mx-3 my-3 min-h-0">
        <div className="flex-1 rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black relative">
          {panel === 'whiteboard' ? (
            <WhiteboardPane />
          ) : pinnedTrack ? (
            // Focus layout: one big tile + horizontal strip of the rest.
            // — Clicking the big tile (or the × badge) unpins.
            // — Clicking a strip tile pins THAT one instead.
            // — `uniflow-pin-contain` is applied to BOTH camera + share pins
            //   so the whole frame fits centered with letterboxing instead
            //   of zoom-cropped to half. LiveKit's <ParticipantTile> defaults
            //   to object-fit: cover, which on a portrait-orientation focus
            //   pane crops a 16:9 camera or share down to about half. Owner
            //   directive (2026-05-17): pin should fit the whole screen.
            //   For SCREEN SHARES the strip auto-hides too (was eating ~32%
            //   of vertical space); a toggle arrow at the bottom edge
            //   re-shows it when needed.
            <div className="absolute inset-0 flex flex-col">
              <div
                onClick={() => togglePin(keyOf(pinnedTrack))}
                className="flex-1 min-h-0 relative cursor-zoom-out group uniflow-pin-contain bg-black"
                title="Click to unpin"
              >
                <ParticipantTile trackRef={pinnedTrack} />
                <span className="absolute top-2 left-2 z-10 flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full bg-[#6A3FF4] text-white shadow-lg pointer-events-none">
                  <i className="ph-fill ph-push-pin" />
                  Pinned{pinnedIsScreenShare ? ' · Screen' : ''}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setPinnedKey(null); }}
                  aria-label="Unpin"
                  className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/70 text-white opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <i className="ph-bold ph-x" />
                </button>
              </div>
              {otherTracks.length > 0 && !stripHidden && (
                <div className="flex-shrink-0 h-24 sm:h-28 md:h-32 flex gap-2 overflow-x-auto overflow-y-hidden p-2 bg-black/70 backdrop-blur-md scrollbar-hidden">
                  {otherTracks.map((tr) => {
                    const k = keyOf(tr);
                    return (
                      <button
                        key={k}
                        onClick={(e) => { e.stopPropagation(); togglePin(k); }}
                        className="relative h-full aspect-video flex-shrink-0 rounded-lg overflow-hidden border border-white/10 hover:border-[#6A3FF4]/60 transition-colors cursor-pointer"
                        title={`Pin ${tr.participant.identity}`}
                      >
                        <ParticipantTile trackRef={tr} />
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Strip toggle arrow. Centered at the bottom edge, slides up
                  above the strip when the strip is shown. Hidden entirely
                  when there's nobody else in the room — no point in a
                  toggle for a strip with 0 tiles. */}
              {otherTracks.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setStripHidden((v) => !v); }}
                  aria-label={stripHidden ? t('admin.showParticipants') : t('admin.hideParticipants')}
                  title={stripHidden ? `Show ${otherTracks.length} other participant${otherTracks.length === 1 ? '' : 's'}` : 'Hide participants strip'}
                  className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center justify-center w-10 h-7 rounded-t-lg bg-black/80 hover:bg-[#6A3FF4]/80 text-white shadow-lg transition-all ${
                    stripHidden ? 'bottom-0' : 'bottom-24 sm:bottom-28 md:bottom-32'
                  }`}
                >
                  <i className={`ph-bold ${stripHidden ? 'ph-caret-up' : 'ph-caret-down'} text-sm`} />
                </button>
              )}
            </div>
          ) : (
            // Grid mode (default). Wrapping each tile in a click-to-pin
            // overlay button — `pointer-events-none` on the LiveKit tile
            // itself plus a transparent button on top means clicks bubble
            // to our handler without interfering with LiveKit's controls.
            <div className="absolute inset-0">
              <GridLayout tracks={tracks} style={{ height: '100%' }}>
                <PinnableTile onPin={togglePin} keyOf={keyOf} />
              </GridLayout>
            </div>
          )}
        </div>

        {/* Side panel */}
        {panel !== 'none' && panel !== 'whiteboard' && (
          <div className={`${glassCardStyle} w-96 overflow-y-auto p-4 hidden md:block`}>
            {panel === 'participants' && (
              <ParticipantsPanel
                onClose={() => setPanel('none')}
                isHost={isHost}
                localIdentity={localParticipant?.identity}
                onKick={removeParticipant}
                raisedHands={raisedHands}
                onLowerHand={lowerHand}
              />
            )}
            {panel === 'settings' && (
              <SettingsPanel onClose={() => setPanel('none')} />
            )}
            {panel === 'chat' && (
              <ChatPanel
                onClose={() => setPanel('none')}
                chatMessages={chat.chatMessages}
                send={chat.send}
                isSending={chat.isSending}
              />
            )}
          </div>
        )}
      </div>

      {/* Control bar — fades out after 2.5s of idle while a tile is pinned,
          fades back in on any mouse/touch/key. When pinned, switches to an
          absolute overlay at the bottom so the video pane can grow into the
          freed space (otherwise opacity-only hides the bar but its ~80px
          flex-flow slot stays empty above). Owner directive (2026-05-17). */}
      <div
        className={`${glassCardStyle} px-3 sm:px-4 py-3 rounded-2xl transition-all duration-300 ${
          pinnedTrack
            ? 'absolute left-3 right-3 bottom-3 z-30'
            : 'mx-3 mb-3'
        } ${
          controlsHidden ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
          <ToolButton label={micEnabled ? t('admin.muteBtn') : t('admin.unmuteBtn')} icon={micEnabled ? 'ph-microphone' : 'ph-microphone-slash'} onClick={toggleMic} tone={micEnabled ? 'neutral' : 'danger'} />
          <ToolButton label={camEnabled ? t('admin.stopVideo') : t('admin.startVideo')} icon={camEnabled ? 'ph-video-camera' : 'ph-video-camera-slash'} onClick={toggleCam} tone={camEnabled ? 'neutral' : 'danger'} />
          <ToolButton label={screenEnabled ? t('admin.stopShare') : t('admin.share')} icon="ph-monitor" onClick={toggleScreen} tone={screenEnabled ? 'accent' : 'neutral'} />
          {/* Hosts don't raise hands — they receive raised-hand signals from
              students and lower them via the People panel. Hide the button. */}
          {!isHost && (
            <ToolButton label={handRaised ? t('admin.lower') : t('admin.raise')} icon="ph-hand-waving" onClick={toggleHand} tone={handRaised ? 'accent' : 'neutral'} />
          )}
          <ToolButton label={t('liveRoom.chat')} icon="ph-chat-circle-dots" onClick={() => setPanel((p) => (p === 'chat' ? 'none' : 'chat'))} tone={panel === 'chat' ? 'accent' : 'neutral'} badge={unreadChat} />
          <ToolButton label={t('liveRoom.participants')} icon="ph-users" onClick={() => setPanel((p) => (p === 'participants' ? 'none' : 'participants'))} tone={panel === 'participants' ? 'accent' : 'neutral'} />
          <ToolButton label={t('liveRoom.whiteboard')} icon="ph-pencil-line" onClick={() => setPanel((p) => (p === 'whiteboard' ? 'none' : 'whiteboard'))} tone={panel === 'whiteboard' ? 'accent' : 'neutral'} />
          <ToolButton label={t('liveRoom.devicesSettings')} icon="ph-gear" onClick={() => setPanel((p) => (p === 'settings' ? 'none' : 'settings'))} tone={panel === 'settings' ? 'accent' : 'neutral'} />
          <ToolButton label={isFullscreen ? t('admin.exit') : t('admin.full')} icon={isFullscreen ? 'ph-arrows-in' : 'ph-arrows-out'} onClick={toggleFullscreen} tone="neutral" />

          {isHost && <div className="h-9 w-px bg-white/10 mx-1" />}

          {isHost && (
            <>
              {!isRecording ? (
                <ToolButton label={t('liveRoom.record')} icon="ph-record" onClick={() => setPickerMode('record')} tone="warning" />
              ) : (
                <ToolButton label={t('liveRoom.stopRecording')} icon="ph-stop" onClick={stopRecording} tone="danger" />
              )}
              <ToolButton
                label={mutedAll ? t('liveRoom.allMuted') : t('liveRoom.muteAll')}
                icon={mutedAll ? 'ph-check-circle' : 'ph-speaker-slash'}
                onClick={muteEveryone}
                tone={mutedAll ? 'accent' : 'warning'}
                disabled={mutedAll}
              />
              <ToolButton label={t('liveRoom.endForEveryone')} icon="ph-stop-circle" onClick={() => setConfirmingEnd(true)} tone="danger" />
            </>
          )}

          <button
            onClick={hangup}
            className="ml-1 sm:ml-2 px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-red-600 hover:opacity-90 text-white text-sm font-bold flex items-center gap-2 transition-opacity shadow-lg shadow-red-500/20"
          >
            <i className="ph-fill ph-phone-x" />
            <span className="hidden sm:inline">{t('liveRoom.leaveRoom')}</span>
          </button>
        </div>
      </div>

      {/* End-for-all confirm */}
      {confirmingEnd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={() => setConfirmingEnd(false)}>
          <div className={`${glassCardStyle} max-w-md w-full p-6 space-y-3`} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold flex items-center gap-2">
              <i className="ph-fill ph-warning-circle text-red-400" /> {t('liveRoom.confirmEnd')}
            </h3>
            <p className="text-sm text-gray-400">
              {t('admin.confirmEndForAll')}
              {isRecording && ' Your recording will stop and upload automatically.'}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmingEnd(false)} className="px-4 py-2 rounded-xl text-sm font-bold bg-white/10 text-white hover:bg-white/15">{t('admin.cancelBtn')}</button>
              <button onClick={endForEveryone} className="px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-red-500 to-red-600 text-white hover:opacity-90">{t('liveRoom.endForEveryone')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Discord-style screen-share / record picker. Drives BOTH the record
          and share-screen flows via the `pickerMode` state. In Electron the
          modal shows a real thumbnail grid of OS sources (driven via IPC ->
          desktopCapturer); in a browser it falls back to 3 placeholder
          cards because browser security forbids enumerating windows from
          web code. Same Discord-derived UX, environment-appropriate
          backing data. */}
      {pickerMode !== null && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm anim-essential"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-picker-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPickerMode(null);
              const w = window as unknown as { uniflow?: { desktopCapture?: { cancelPreselect: () => Promise<void> } } };
              w.uniflow?.desktopCapture?.cancelPreselect?.().catch(() => { /* ignore */ });
            }
          }}
        >
          <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 shadow-2xl shadow-black/40 ring-1 ring-inset ring-white/30 dark:ring-white/5 backdrop-blur-2xl overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] flex-shrink-0" />
            <div className="p-6 sm:p-7 overflow-y-auto">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 id="record-picker-title" className="text-black dark:text-white text-xl font-bold flex items-center gap-2">
                    {pickerMode === 'record' ? (
                      <><i className="ph-fill ph-record-fill text-red-500" /> Start recording</>
                    ) : (
                      <><i className="ph-fill ph-monitor text-[#6A3FF4]" /> Share your screen</>
                    )}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {isElectron
                      ? 'Pick a screen or window to share.'
                      : 'Pick what to capture. Your browser will confirm in the next prompt.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickerMode(null);
                    const w = window as unknown as { uniflow?: { desktopCapture?: { cancelPreselect: () => Promise<void> } } };
                    w.uniflow?.desktopCapture?.cancelPreselect?.().catch(() => { /* ignore */ });
                  }}
                  className="text-gray-500 hover:text-black dark:hover:text-white p-1"
                  aria-label="Close"
                >
                  <i className="ph-bold ph-x text-lg" />
                </button>
              </div>

              {/* Audio toggle — Discord-style "Share audio" switch. In
                  Electron this drives whether main passes `audio:'loopback'`
                  to the setDisplayMediaRequestHandler callback (so the
                  picker fully controls audio without any second prompt).
                  In the browser this drives the `audio` constraint passed
                  to getDisplayMedia; the user still has to tick the
                  browser's own share-audio checkbox for it to take effect.*/}
              <button
                type="button"
                onClick={() => setIncludeShareAudio((v) => !v)}
                className={`w-full mt-4 mb-5 rounded-xl px-4 py-3 flex items-center gap-3 text-left transition-colors border ${
                  includeShareAudio
                    ? 'bg-[#6A3FF4]/10 border-[#6A3FF4]/40 hover:bg-[#6A3FF4]/15'
                    : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10'
                }`}
                aria-pressed={includeShareAudio}
              >
                <i className={`ph-fill ${includeShareAudio ? 'ph-speaker-high text-[#6A3FF4]' : 'ph-speaker-slash text-gray-500'} text-xl flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-black dark:text-white flex items-center gap-2">
                    Also share application audio
                    {includeShareAudio && (
                      <span className="text-[10px] uppercase font-bold tracking-wide text-[#6A3FF4] bg-[#6A3FF4]/15 px-1.5 py-0.5 rounded">On</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {isElectron
                      ? `Anything playing through your speakers (Discord, browser, music) ${pickerMode === 'record' ? 'will be in the recording' : 'will reach participants'} alongside your mic.`
                      : `On your next browser prompt, tick "Share tab audio" / "Share system audio" so app sound is ${pickerMode === 'record' ? 'recorded' : 'shared'} too.`}
                  </div>
                </div>
                {/* Pill toggle */}
                <span
                  className={`relative w-10 h-6 rounded-full flex-shrink-0 transition-colors ${
                    includeShareAudio ? 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4]' : 'bg-gray-300 dark:bg-white/15'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      includeShareAudio ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              {/* Electron path — real source thumbnails. Browser path — 3
                  placeholder cards (we can't enumerate windows).
                  Click highlights; the bottom CTA confirms. */}
              {isElectron ? (
                desktopSources.length === 0 ? (
                  <div className="text-center text-sm text-gray-500 dark:text-gray-400 py-12">
                    <i className="ph-bold ph-spinner-gap text-2xl animate-spin block mx-auto mb-3 text-[#6A3FF4]" />
                    Loading available screens & windows…
                  </div>
                ) : (
                  <>
                    {(['screen', 'window'] as const).map((kind) => {
                      const items = desktopSources.filter((s) => s.kind === kind);
                      if (items.length === 0) return null;
                      return (
                        <div key={kind} className="mb-5 last:mb-0">
                          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                            <i className={`ph-fill ${kind === 'screen' ? 'ph-monitor' : 'ph-app-window'}`} />
                            {kind === 'screen' ? 'Entire screens' : 'Application windows'}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                            {items.map((s) => {
                              const selected = pendingSelection?.electronSourceId === s.id;
                              return (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => setPendingSelection({ kind, electronSourceId: s.id, name: s.name })}
                                  className={`group text-left rounded-xl overflow-hidden border transition-all ${
                                    selected
                                      ? 'bg-[#6A3FF4]/20 border-[#6A3FF4] ring-2 ring-[#6A3FF4]/40 shadow-lg shadow-[#6A3FF4]/20'
                                      : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:bg-[#6A3FF4]/10 hover:border-[#6A3FF4]/60'
                                  }`}
                                  title={s.name}
                                  aria-pressed={selected}
                                >
                                  <div className="aspect-video w-full bg-black flex items-center justify-center overflow-hidden relative">
                                    {s.thumbnail ? (
                                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                                      <img src={s.thumbnail} alt={`Preview of ${s.name}`} className="w-full h-full object-contain" />
                                    ) : (
                                      <i className="ph-fill ph-monitor text-3xl text-white/30" />
                                    )}
                                    {selected && (
                                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-[#6A3FF4] flex items-center justify-center shadow-lg">
                                        <i className="ph-bold ph-check text-white text-sm" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="px-3 py-2 flex items-center gap-2">
                                    {s.appIcon && (
                                      // eslint-disable-next-line jsx-a11y/img-redundant-alt
                                      <img src={s.appIcon} alt="" className="w-4 h-4 flex-shrink-0" />
                                    )}
                                    <span className={`text-xs font-medium truncate ${selected ? 'text-[#6A3FF4] dark:text-[#A78BFF]' : 'text-black dark:text-white'}`}>{s.name}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { kind: 'screen', label: 'Entire screen', icon: 'ph-monitor', desc: 'Best for capturing apps like Discord with system audio.' },
                    { kind: 'window', label: 'App window', icon: 'ph-app-window', desc: 'Share a single application window.' },
                    { kind: 'tab', label: 'Browser tab', icon: 'ph-browser', desc: 'Cleanest tab-audio capture — works reliably across all OSes.' },
                  ] as const).map((opt) => {
                    const selected = pendingSelection?.kind === opt.kind && !pendingSelection?.electronSourceId;
                    return (
                      <button
                        key={opt.kind}
                        type="button"
                        onClick={() => setPendingSelection({ kind: opt.kind, name: opt.label })}
                        className={`group relative text-left rounded-xl border p-4 transition-all ${
                          selected
                            ? 'bg-[#6A3FF4]/15 border-[#6A3FF4] ring-2 ring-[#6A3FF4]/40 shadow-lg shadow-[#6A3FF4]/20'
                            : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:bg-[#6A3FF4]/10 dark:hover:bg-[#6A3FF4]/15 hover:border-[#6A3FF4]/60'
                        }`}
                        aria-pressed={selected}
                      >
                        {selected && (
                          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#6A3FF4] flex items-center justify-center shadow">
                            <i className="ph-bold ph-check text-white text-xs" />
                          </div>
                        )}
                        <div className="w-12 h-12 rounded-xl bg-[#6A3FF4]/15 flex items-center justify-center mb-3">
                          <i className={`ph-fill ${opt.icon} text-2xl text-[#6A3FF4]`} />
                        </div>
                        <div className={`font-semibold text-sm ${selected ? 'text-[#6A3FF4] dark:text-[#A78BFF]' : 'text-black dark:text-white'}`}>{opt.label}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Selected-source summary + confirm CTA. Confirm is disabled
                  until the host picks something — prevents accidental
                  taps that fire an empty share. */}
              <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-black/10 dark:border-white/10">
                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {pendingSelection ? (
                    <>
                      <span className="text-gray-500">Selected:</span>{' '}
                      <span className="font-semibold text-black dark:text-white">
                        {pendingSelection.name || (
                          pendingSelection.kind === 'screen' ? 'Entire screen'
                          : pendingSelection.kind === 'window' ? 'App window'
                          : 'Browser tab'
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="italic">Pick a source above to continue.</span>
                  )}
                </div>
                <div className="flex gap-2 sm:flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPickerMode(null);
                      const w = window as unknown as { uniflow?: { desktopCapture?: { cancelPreselect: () => Promise<void> } } };
                      w.uniflow?.desktopCapture?.cancelPreselect?.().catch(() => { /* ignore */ });
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-black dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!pendingSelection}
                    onClick={() => {
                      if (!pendingSelection) return;
                      const sel = pendingSelection;
                      const mode = pickerMode;
                      setPickerMode(null);
                      setPendingSelection(null);
                      if (mode === 'record') {
                        if (sel.electronSourceId) {
                          const w = window as unknown as { uniflow?: { desktopCapture?: { preselect: (id: string, includeAudio?: boolean) => Promise<void> } } };
                          w.uniflow?.desktopCapture?.preselect(sel.electronSourceId, includeShareAudio)
                            .then(() => startRecording(sel.kind))
                            .catch(() => startRecording(sel.kind));
                        } else {
                          startRecording(sel.kind);
                        }
                      } else {
                        startScreenShareFromPicker(sel.kind, sel.electronSourceId);
                      }
                    }}
                    className={`px-5 py-2 rounded-xl text-sm font-bold text-white transition-all shadow-lg ${
                      pendingSelection
                        ? (pickerMode === 'record'
                          ? 'bg-gradient-to-r from-red-500 to-red-600 hover:opacity-95 shadow-red-500/30'
                          : 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-95 shadow-[#6A3FF4]/30')
                        : 'bg-gray-300 dark:bg-white/10 text-gray-500 cursor-not-allowed shadow-none'
                    }`}
                  >
                    {pickerMode === 'record' ? (
                      <><i className="ph-fill ph-record-fill mr-1.5" /> Start recording</>
                    ) : (
                      <><i className="ph-fill ph-broadcast mr-1.5" /> Share screen</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Participants panel ──────────────────────────────────────────────────────
const ParticipantsPanel: React.FC<{
  onClose: () => void;
  isHost: boolean;
  localIdentity?: string;
  onKick: (identity: string) => void;
  raisedHands: Record<string, string>;
  onLowerHand: (identity: string) => void;
}> = ({ onClose, isHost, localIdentity, onKick, raisedHands, onLowerHand }) => {
  const participants = useParticipants();
  // Sort so raised-hand participants float to the top of the list, making
  // them easy for the host to address. Within each group, host first, then
  // alphabetical by display name.
  const sorted = [...participants].sort((a, b) => {
    const aHand = a.identity in raisedHands ? 1 : 0;
    const bHand = b.identity in raisedHands ? 1 : 0;
    if (aHand !== bHand) return bHand - aHand;
    return (a.name || a.identity).localeCompare(b.name || b.identity);
  });
  const raisedCount = Object.keys(raisedHands).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white text-sm font-bold flex items-center gap-2">
          <i className="ph-fill ph-users text-[#7B5AFF]" /> Participants ({participants.length})
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <i className="ph-bold ph-x" />
        </button>
      </div>
      {raisedCount > 0 && (
        <div className="px-2 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] flex items-center gap-1.5">
          <i className="ph-fill ph-hand-waving text-amber-300" />
          {raisedCount} hand{raisedCount === 1 ? '' : 's'} raised
        </div>
      )}
      {sorted.map((p) => {
        const handUp = p.identity in raisedHands;
        return (
          <div
            key={p.identity}
            className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-lg ${handUp ? 'bg-amber-500/10 border border-amber-500/30' : 'hover:bg-white/5'}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                {(p.name || p.identity).charAt(0).toUpperCase()}
              </span>
              <span className="text-white truncate">{p.name || p.identity}</span>
              {p.isLocal && <span className="text-[8px] text-gray-500">(you)</span>}
              {handUp && (
                <i className="ph-fill ph-hand-waving text-amber-300 text-base animate-pulse" title="Hand raised" />
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Host can lower a raised hand directly from the participant row. */}
              {isHost && handUp && (
                <button
                  onClick={() => onLowerHand(p.identity)}
                  className="text-[10px] text-amber-300 hover:text-amber-200 px-2 py-1 rounded hover:bg-amber-500/10"
                  title="Lower this participant's hand"
                >
                  <i className="ph-bold ph-hand-palm" /> Lower
                </button>
              )}
              {isHost && !p.isLocal && p.identity !== localIdentity && (
                <button
                  onClick={() => onKick(p.identity)}
                  className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10"
                  title="Remove participant"
                >
                  <i className="ph-bold ph-user-minus" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Settings panel: real device picker (LiveKit native) ─────────────────────
const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  // `switchActiveDevice` lives on Room, not LocalParticipant. Going via Room
  // also updates the published track + persists the choice for reconnects.
  const room = useRoomContext();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [spks, setSpks] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>(() => localStorage.getItem('uniflow.device.mic') || '');
  const [selectedCam, setSelectedCam] = useState<string>(() => localStorage.getItem('uniflow.device.cam') || '');
  const [selectedSpk, setSelectedSpk] = useState<string>(() => localStorage.getItem('uniflow.device.spk') || '');

  const refresh = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMics(list.filter((d) => d.kind === 'audioinput'));
      setCams(list.filter((d) => d.kind === 'videoinput'));
      setSpks(list.filter((d) => d.kind === 'audiooutput'));
    } catch { /* permission denied */ }
  }, []);
  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  const onMicChange = useCallback(async (id: string) => {
    setSelectedMic(id);
    localStorage.setItem('uniflow.device.mic', id);
    try { await room.switchActiveDevice('audioinput', id); } catch { /* ignore */ }
  }, [room]);
  const onCamChange = useCallback(async (id: string) => {
    setSelectedCam(id);
    localStorage.setItem('uniflow.device.cam', id);
    try { await room.switchActiveDevice('videoinput', id); } catch { /* ignore */ }
  }, [room]);
  const onSpkChange = useCallback(async (id: string) => {
    setSelectedSpk(id);
    localStorage.setItem('uniflow.device.spk', id);
    try { await room.switchActiveDevice('audiooutput', id); } catch { /* ignore */ }
  }, [room]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white text-sm font-bold flex items-center gap-2">
          <i className="ph-fill ph-gear text-[#7B5AFF]" /> Settings
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="ph-bold ph-x" /></button>
      </div>
      <DevicePicker label="Microphone" value={selectedMic} options={mics} onChange={onMicChange} iconKind="audio" />
      <DevicePicker label="Camera" value={selectedCam} options={cams} onChange={onCamChange} iconKind="video" />
      <DevicePicker label="Speaker" value={selectedSpk} options={spks} onChange={onSpkChange} iconKind="speaker" />
      {spks.length === 0 && (
        <p className="text-[10px] text-gray-500 italic">
          Your browser doesn&apos;t expose speaker selection. Use OS-level audio settings.
        </p>
      )}
    </div>
  );
};

const DevicePicker: React.FC<{
  label: string;
  value: string;
  options: MediaDeviceInfo[];
  onChange: (id: string) => void;
  iconKind: 'audio' | 'video' | 'speaker';
}> = ({ label, value, options, onChange, iconKind }) => {
  const icon = iconKind === 'audio' ? 'ph-microphone' : iconKind === 'video' ? 'ph-video-camera' : 'ph-speaker-high';
  return (
    <div>
      <label className="block text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1.5">{label}</label>
      <GlassDropdown
        value={value || (options[0]?.deviceId ?? '')}
        onChange={onChange}
        direction="down"
        className="w-full"
        options={options.map((d) => ({
          value: d.deviceId,
          label: d.label || `${label} ${d.deviceId.slice(0, 6)}`,
          icon,
        }))}
      />
    </div>
  );
};

// ─── Chat panel (LiveKit data channel) ───────────────────────────────────────
// Chat history + send fn are lifted to RoomContent (so chat handlers are
// registered on the room the moment any participant joins, not only when
// someone opens the chat panel). The panel receives the live values via
// props and renders them.
type ChatPanelProps = {
  onClose: () => void;
  chatMessages: ReturnType<typeof useChat>['chatMessages'];
  send: ReturnType<typeof useChat>['send'];
  isSending: boolean;
};
const ChatPanel: React.FC<ChatPanelProps> = ({ onClose, chatMessages, send: sendChat, isSending }) => {
  const [draft, setDraft] = useState('');
  const onSend = useCallback(async () => {
    if (!draft.trim()) return;
    try { await sendChat(draft); setDraft(''); } catch { /* ignore */ }
  }, [draft, sendChat]);

  // Auto-scroll to the latest message on every new arrival.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages.length]);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-white text-sm font-bold flex items-center gap-2">
          <i className="ph-fill ph-chat-circle-dots text-[#7B5AFF]" /> Chat
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="ph-bold ph-x" /></button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pr-1 mb-2">
        {chatMessages.length === 0 && <p className="text-xs text-gray-500 italic">No messages yet.</p>}
        {chatMessages.map((m, i) => (
          <div key={i} className="text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-[#7B5AFF] font-bold">{m.from?.name || m.from?.identity || 'unknown'}</span>
              <span className="text-gray-500 text-[10px]">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p className="text-white whitespace-pre-wrap break-words">{m.message}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-auto">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder="Type a message…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4]"
        />
        <button
          onClick={onSend}
          disabled={!draft.trim() || isSending}
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-xs font-bold disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
};

// ─── Whiteboard (Excalidraw) — fills the main pane when active ──────────────
const WhiteboardPane: React.FC = () => {
  // Excalidraw provides built-in collaboration but it routes through its
  // public server. For UniFlow we use it in local-only mode for now; every
  // host sees their own canvas. A future iteration can wire socket.io to
  // sync canvas state across participants.
  //
  // Mobile fix: Excalidraw uses `getBoundingClientRect()` on mount to size
  // its canvas. When the parent was `absolute inset-0` inside a flex shell,
  // mobile WebKit sometimes measured the parent at zero height before the
  // flex pass settled, leaving a 0×N canvas. Switching to an explicit
  // `w-full h-full` block guarantees the parent has dimensions before
  // Excalidraw measures. `dockedSidebarBreakpoint: 0` keeps the right-side
  // toolbar from auto-collapsing into a hamburger on mobile widths and
  // landing partially off-screen.
  const initialData = useMemo(() => ({
    elements: [],
    appState: {
      viewBackgroundColor: '#0d0d18',
      theme: 'dark' as const,
    },
  }), []);
  return (
    <div className="w-full h-full bg-[#0d0d18]" style={{ position: 'absolute', inset: 0 }}>
      <Excalidraw
        initialData={initialData}
        theme="dark"
        UIOptions={{ dockedSidebarBreakpoint: 0 }}
      />
    </div>
  );
};

// ─── PinnableTile ────────────────────────────────────────────────────────────
// Wraps `<ParticipantTile />` and adds an invisible click-overlay that
// forwards a per-tile click to the parent's pin handler. Uses LiveKit's
// `useMaybeTrackRefContext()` to discover which track this tile is rendering
// inside the GridLayout's per-tile context, so we don't need to thread
// per-tile track refs through props manually.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PinnableTile: React.FC<{
  onPin: (k: string) => void;
  // Caller passes its `keyOf` helper. Typed as `any` because the LiveKit
  // TrackReferenceOrPlaceholder union is complex and the helper only
  // touches `.participant.identity` + `.source` — the typing constraint
  // here would force every caller to import the SDK type, which trades
  // safety for noise. Runtime structure is checked elsewhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyOf: (tr: any) => string;
}> = ({ onPin, keyOf }) => {
  const trackRef = useMaybeTrackRefContext();
  if (!trackRef) return <ParticipantTile />;
  const k = keyOf(trackRef);
  return (
    <div className="relative w-full h-full group">
      <ParticipantTile />
      {/* Click overlay — z-10 sits above the tile, transparent so the
          tile's UI stays visible, `pointer-events-auto` catches the tap. */}
      <button
        onClick={() => onPin(k)}
        aria-label="Pin participant"
        className="absolute inset-0 z-10 bg-transparent cursor-zoom-in"
      />
      {/* Pin hint chip, top-right, fades in on hover. Tap-friendly on mobile
          because the parent button covers the whole tile. */}
      <span className="absolute top-2 right-2 z-20 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <i className="ph-bold ph-push-pin" />
        Pin
      </span>
    </div>
  );
};

// ─── ToolButton (UniFlow style) ──────────────────────────────────────────────
const ToolButton: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  tone: 'neutral' | 'accent' | 'warning' | 'danger';
  disabled?: boolean;
  badge?: number;
}> = ({ label, icon, onClick, tone, disabled, badge }) => {
  const toneCls = {
    neutral: 'bg-white/10 hover:bg-white/20 text-white border-white/15',
    accent: 'bg-gradient-to-r from-[#7B5AFF]/40 to-[#5A2AD4]/40 hover:from-[#7B5AFF]/60 hover:to-[#5A2AD4]/60 text-white border-[#6A3FF4]/50 shadow-md shadow-[#6A3FF4]/20',
    warning: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-500/40',
    danger: 'bg-red-500/20 hover:bg-red-500/30 text-red-200 border-red-500/40',
  }[tone];
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`relative px-3 sm:px-3.5 py-2.5 rounded-xl border flex items-center gap-1.5 transition-all ${disabled ? 'cursor-default opacity-90' : 'hover:-translate-y-0.5'} ${toneCls}`}
    >
      <i className={`ph-fill ${icon} text-base sm:text-lg`} />
      <span className="hidden md:inline text-xs font-bold">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md shadow-red-500/40">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
};

export default LiveSessionRoom;
