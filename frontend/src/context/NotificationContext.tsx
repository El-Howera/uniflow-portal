/**
 * Real-time Notification Context
 * Provides live notifications via WebSocket across the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  initSocket,
  isSocketConnected,
  getAllNotifications,
  markNotificationRead,
  initNotificationSocket,
  disconnectNotificationSocket,
} from '../utils/websocketService';
import { firebase } from '../utils/firebase';
import { webpush } from '../utils/webpush';
import { nativePush } from '../utils/capacitor-push';
import { Capacitor } from '@capacitor/core';
import { isPreviewSession } from '../utils/previewSession';

export interface LiveNotification {
  id: string;
  type: 'announcement' | 'message' | 'critical' | 'info' | 'chat' | 'system';
  title: string;
  content: string;
  timestamp: string;
  isRead: boolean;
  link?: string;
  sender?: string;
  courseCode?: string;
  // Sender hydration — set by the notification server when fanning out a
  // broadcast or send. The toast/list use these to show the sender's
  // profile picture; falls back to a type-based icon when null.
  senderId?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
  senderAvatar?: string | null;
  // Set by sensitive AuditLog events (Phase 3). The frontend treats any
  // notification with referenceType === 'AuditLog' as a System event.
  referenceType?: string | null;
  referenceId?: string | null;
}

interface NotificationContextType {
  notifications: LiveNotification[];
  unreadCount: number;
  isConnected: boolean;
  addNotification: (notification: Omit<LiveNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAllNotifications: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Get current user from localStorage
const getCurrentUser = () => {
  const email = localStorage.getItem('currentUserEmail') || 'guest@university.edu';
  const userId = localStorage.getItem('userId') || 'guest';
  const role = localStorage.getItem('currentUserRole') || 'student';
  const userName = localStorage.getItem('userName') || 'Guest User';

  return {
    odID: userId,
    name: userName,
    email: email,
    role: role
  };
};

// Notification sound using Audio element with a base64 encoded MP3
// This is a short "ding" notification sound
const NOTIFICATION_SOUND_BASE64 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNfBbHAAAAAAD/+9DEAAAIAANIAAAAEgwAaQAAAATHBwfB8HygIAgCAIfiD/BD/BD+XB8uCAIAgD4f/l3/y4f/+XAgGP/BA/l3//5cEAQBA//y7///5c/lwfLg+D5///+f5cEDn/D/4f/8uD4Pg+D4Pg+AQBAEAQP/Lg+f8uD5dBAMf/+D7///8vB8HwfD4Pg+D4fggCAYKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+xDE9gPAAADSAAAAAAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

// Audio element for notification sound
let notificationAudio: HTMLAudioElement | null = null;

// Throttle: rapid-fire chat messages shouldn't ring 5× in 2 seconds.
// Same throttle applies to general notifications too — if 3 broadcasts
// land in the same tick (rare but possible), they collapse to one ring.
let lastSoundAt = 0;
const SOUND_MIN_GAP_MS = 600;

// OS / system notifications should fire ONLY when the app is NOT in the
// foreground. When the app is open and focused (any page), the in-app toast +
// notification bell already inform the user — a system notification on top is
// redundant. So a system notification is emitted only when the tab is hidden
// OR the window isn't focused (another app/window on top). When the app is
// fully CLOSED these in-page handlers never run; FCM's service worker handles
// background delivery instead. In-app toasts/bell/sound are unaffected by this.
const shouldEmitSystemNotification = (): boolean => {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'hidden' || !document.hasFocus();
};

const playNotificationSound = () => {
  const now = Date.now();
  if (now - lastSoundAt < SOUND_MIN_GAP_MS) return;
  lastSoundAt = now;
  try {
    // Create audio element if it doesn't exist
    if (!notificationAudio) {
      notificationAudio = new Audio(NOTIFICATION_SOUND_BASE64);
      notificationAudio.volume = 0.5;
    }

    // Reset and play
    notificationAudio.currentTime = 0;
    const playPromise = notificationAudio.play();

    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Fallback: Try Web Audio API if Audio element fails
        playWebAudioSound();
      });
    }
  } catch (e) {
    console.warn('Could not play notification sound:', e);
    playWebAudioSound();
  }
};

/**
 * Public re-export so chatrooms can ring on incoming messages. Same chime
 * as broadcast notifications (intentional — the user already approved
 * this sound for the project; they only complained about it ringing
 * twice). The throttle above guarantees rapid bursts collapse.
 */
export const playChatMessageSound = playNotificationSound;

// Exposed for senders that want auditory confirmation when their broadcast
// publishes (e.g. AnnouncementComposer). Distinct, shorter chime so the
// sender's "I sent it" cue doesn't sound identical to an incoming one.
export const playSendSuccessSound = () => {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    // Rising third — "ping!" feel for a successful send.
    o.type = 'sine';
    o.frequency.setValueAtTime(660, ctx.currentTime);
    o.frequency.setValueAtTime(990, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.25);
  } catch {
    // No audio = no problem; this is a nice-to-have cue.
  }
};

// Fallback Web Audio API sound
const playWebAudioSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Resume context if suspended (due to autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    // Create oscillator for a pleasant chime
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Two-tone notification chime
    oscillator.frequency.setValueAtTime(830, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1100, audioContext.currentTime + 0.15);

    oscillator.type = 'sine';

    // Volume envelope
    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.warn('Web Audio API also failed:', e);
  }
};

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const currentUser = getCurrentUser();

  // Calculate unread count
  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Add a new notification locally
  const addNotification = useCallback((notification: Omit<LiveNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNotif: LiveNotification = {
      ...notification,
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);

    // System notification only when the app is backgrounded/unfocused — when
    // it's in the foreground the in-app toast + bell are enough.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && shouldEmitSystemNotification()) {
      try {
        new Notification(notification.title, {
          body: notification.content,
          icon: '/logo192.png'
        });
      } catch (e) {
        console.warn('Browser notifications not supported:', e);
      }
    }
  }, []);

  // Mark notification as read
  const markAsRead = useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, isRead: true } : n)
    );
    markNotificationRead(currentUser.odID, id);
  }, [currentUser.odID]);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  }, []);

  // Clear a notification
  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Clear all notifications
  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // Enable audio on first user interaction (browser autoplay policy workaround)
  useEffect(() => {
    const enableAudio = () => {
      // Pre-load and enable audio
      if (!notificationAudio) {
        notificationAudio = new Audio(NOTIFICATION_SOUND_BASE64);
        notificationAudio.volume = 0.5;
      }
      // Try to play silently to unlock audio
      notificationAudio.volume = 0;
      notificationAudio.play().then(() => {
        notificationAudio!.pause();
        notificationAudio!.currentTime = 0;
        notificationAudio!.volume = 0.5;
      }).catch(() => {});

      // Remove listeners after first interaction
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
    };

    document.addEventListener('click', enableAudio);
    document.addEventListener('keydown', enableAudio);

    return () => {
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
    };
  }, []);

  // Firebase Cloud Messaging — request permission, register device token with
  // the backend, and subscribe to foreground push messages so they show up as
  // in-app notifications even without going through Socket.io.
  //
  // No-ops gracefully when Firebase env vars aren't set (see utils/firebase.ts).
  // Runs once per mount; the `Notification.permission` gate prevents spamming
  // the user with the permission prompt across navigations.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Preview (mock-role) sessions make zero backend calls — no push registration.
    if (isPreviewSession()) return;
    const userId = localStorage.getItem('currentUserId');
    if (!userId) return;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      // Native Capacitor path — uses @capacitor/push-notifications (FCM on
      // Android, APNs on iOS) which speaks to the system notification stack
      // directly. Web FCM SDK is irrelevant inside the native shell.
      if (Capacitor.isNativePlatform()) {
        await nativePush.register();
        return;
      }
      // Web path — only attempt registration if the user hasn't actively
      // denied permission.
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return;

      // Channel selection (mutually exclusive per device, so no duplicate
      // pushes): FCM where supported, standard Web Push (VAPID) where not.
      //   - FCM covers Chrome/Edge/Firefox/Android-PWA.
      //   - FCM's isSupported() is FALSE on iOS Safari, so an installed iOS PWA
      //     (16.4+) falls through to Web Push — the only channel iOS supports.
      // Mount-time call is SILENT (requestPermission:false): it refreshes an
      // existing grant but never prompts. First-grant prompting happens from a
      // user gesture (Settings toggle / push pill → enablePushFromGesture()).
      const fcmOk = firebase.isConfigured()
        ? await firebase.registerFcmTokenWithBackend()
        : false;

      if (!fcmOk && webpush.isWebPushSupported()) {
        await webpush.subscribeWebPush({ requestPermission: false });
      }

      if (fcmOk) {
        // FCM foreground pushes are deliberately a no-op for in-app state. When
        // the tab is open the notification socket (port 4009) has already
        // delivered the same row with its DB id; addNotification here would
        // generate a duplicate with a synthetic local_* id. FCM's role is
        // background delivery only — the service worker handles that.
        unsubscribe = await firebase.onForegroundPush(() => {});
      }
    })().catch((err) => console.warn('[notifications] push init failed:', err));

    return () => {
      if (unsubscribe) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize WebSocket connection and listeners
  useEffect(() => {
    // Preview (mock-role) sessions never open a socket.
    if (isPreviewSession()) return;
    const socket = initSocket();
    let isInitialized = false;

    // Get muted chats from localStorage
    const getMutedChats = (): string[] => {
      try {
        const stored = localStorage.getItem('mutedChats');
        if (!stored) return [];
        const mutedIds = JSON.parse(stored) as number[];
        // Convert IDs to course codes
        const idToCode: Record<number, string> = {
          1011: 'CS101-Lecture',
          1012: 'CS101-Lab',
          2051: 'MA205-Lecture',
          4011: 'BI101-Lecture',
        };
        return mutedIds.map(id => idToCode[id]).filter(Boolean);
      } catch {
        return [];
      }
    };

    // Check if already connected
    if (isSocketConnected()) {
      setIsConnected(true);
      // Join as user to receive notifications with muted chats
      socket.emit('user:join', { ...currentUser, mutedChats: getMutedChats() });
      // Only request notifications on first connect
      if (!isInitialized) {
        getAllNotifications(currentUser.odID);
        isInitialized = true;
      }
    }

    const handleConnect = () => {
      setIsConnected(true);
      // Join as user to receive notifications with muted chats
      socket.emit('user:join', { ...currentUser, mutedChats: getMutedChats() });
      // Only request notifications on first connect
      if (!isInitialized) {
        getAllNotifications(currentUser.odID);
        isInitialized = true;
      }
    };

    const handleDisconnect = () => {
      setIsConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Helper to check if a course code is muted
    const isChatMuted = (courseCode: string): boolean => {
      try {
        const stored = localStorage.getItem('mutedChats');
        if (!stored) return false;
        const mutedIds = JSON.parse(stored) as number[];

        // Course codes are stored as "CS101-Lecture" format
        // The chat IDs mapping
        const courseMapping: Record<string, number> = {
          'CS101-Lecture': 1011,
          'CS101-Lab': 1012,
          'MA205-Lecture': 2051,
          'BI101-Lecture': 4011,
        };

        const chatId = courseMapping[courseCode];
        const isMuted = chatId ? mutedIds.includes(chatId) : false;
        return isMuted;
      } catch (e) {
        console.error('Error checking mute status:', e);
        return false;
      }
    };

    // Listen for new notifications
    const handleNewNotification = (notification: LiveNotification) => {
      // Self-sent guard — server-side broadcast filters senderId from
      // recipients, but legacy /api/notifications/send paths or future
      // bugs could still echo back. Drop silently before any side effect.
      const myId = localStorage.getItem('currentUserId');
      if (myId && notification.senderId && notification.senderId === myId) {
        return;
      }

      // Check if this chat is muted - if so, completely ignore the notification
      if (notification.type === 'chat' && notification.courseCode) {
        if (isChatMuted(notification.courseCode)) {
          return; // Exit early - no sound, no toast, no storage
        }
      }

      const liveNotif: LiveNotification = {
        id: notification.id,
        type: notification.type as LiveNotification['type'],
        title: notification.title,
        content: notification.content,
        timestamp: notification.timestamp,
        isRead: notification.isRead,
        sender: notification.sender,
        courseCode: notification.courseCode,
        senderId: notification.senderId ?? null,
        senderName: notification.senderName ?? null,
        senderRole: notification.senderRole ?? null,
        senderAvatar: notification.senderAvatar ?? null,
      };

      // Check if notification already exists to prevent duplicates
      setNotifications(prev => {
        if (prev.some(n => n.id === liveNotif.id)) {
          return prev;
        }
        return [liveNotif, ...prev];
      });

      // Sound + browser notification are owned by the dedicated notification
      // socket (port 4009) handler below. The chat socket (4001) used to
      // also receive `notification:new` for legacy reasons; firing both
      // here too caused every notification to ring AND toast TWICE. The
      // state dedupe above keeps the in-app toast count correct, but only
      // the 4009 path is allowed to play sound + show the OS notification.
    };

    // Listen for notification list (history) - merge with existing, don't replace
    const handleNotificationList = (notifList: LiveNotification[]) => {
      const mapped: LiveNotification[] = notifList.map(n => ({
        id: n.id,
        type: n.type as LiveNotification['type'],
        title: n.title,
        content: n.content,
        timestamp: n.timestamp,
        isRead: n.isRead,
        sender: n.sender,
        courseCode: n.courseCode
      }));

      setNotifications(prev => {
        // Merge: add server notifications that don't exist locally
        const existingIds = new Set(prev.map(n => n.id));
        const newFromServer = mapped.filter(n => !existingIds.has(n.id));
        return [...prev, ...newFromServer];
      });
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:list', handleNotificationList);

    // Request browser notification permission (only if Notification API exists)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {
        console.warn('Browser notifications permission request failed');
      });
    }

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:list', handleNotificationList);
    };
    // Intentionally only on mount — the socket lifecycle should not restart
    // every time the currentUser identity object changes. The handlers read
    // currentUser via closure of the initial mount value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notification-server socket (port 4009) — separate from the chat socket
  // because the notification fan-out (`new_notification`) is emitted by a
  // different process. Without this connection, broadcasts only persist to
  // Postgres and the user has to refresh to see new rows.
  //
  // The previous version had `[]` deps and ran ONCE on mount. If the user
  // wasn't logged in yet (NotificationProvider sits above AuthPage in the
  // provider tree), currentUserId was null and the effect exited early
  // without registering a listener for when login finally happens. After
  // login, the socket was never opened → emitted=0 forever, no live
  // announcement/attendance push. Fixed by retrying on `uniflow:auth-changed`
  // (fired from AppContext on login) and on the cross-tab `storage` event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Preview (mock-role) sessions never open the notification socket.
    if (isPreviewSession()) return;

    let ns: ReturnType<typeof initNotificationSocket> | null = null;
    let listenersAttached = false;

    const handleNewNotif = (n: LiveNotification & { sender?: string; courseCode?: string }) => {
      // Self-sent guard — same rationale as the chat-socket path above.
      const myId = localStorage.getItem('currentUserId');
      if (myId && n.senderId && n.senderId === myId) {
        return;
      }

      const live: LiveNotification = {
        id: n.id,
        type: (n.type as LiveNotification['type']) || 'info',
        title: n.title,
        content: n.content,
        timestamp: n.timestamp || new Date().toISOString(),
        isRead: n.isRead ?? false,
        sender: n.sender,
        courseCode: n.courseCode,
        senderId: n.senderId ?? null,
        senderName: n.senderName ?? null,
        senderRole: n.senderRole ?? null,
        senderAvatar: n.senderAvatar ?? null,
        referenceType: n.referenceType ?? null,
        referenceId: n.referenceId ?? null,
      };
      setNotifications((prev) => {
        if (prev.some((p) => p.id === live.id)) return prev;
        return [live, ...prev];
      });
      // Sound + browser notification re-use the chat-socket path's helpers.
      playNotificationSound();
      // System notification only when the app isn't in the foreground.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && shouldEmitSystemNotification()) {
        try {
          new Notification(live.title, {
            body: live.content,
            icon: live.senderAvatar || '/logo192.png',
          });
        } catch { /* ignore */ }
      }
      // Live-update bridge — when a notification carries a referenceType the
      // student's own pages care about, dispatch a window event so the open
      // page can reload without a refresh. Currently used by the My Requests
      // / Complaints panel on StudentAffairs to refresh its In Progress
      // counter the moment SA flips a status.
      if (live.referenceType === 'SupportRequest' || live.referenceType === 'Complaint') {
        try {
          window.dispatchEvent(
            new CustomEvent('uniflow:sa-item-updated', {
              detail: {
                referenceType: live.referenceType,
                referenceId: live.referenceId,
              },
            }),
          );
        } catch { /* ignore */ }
      }
    };

    // Server-pushed session revocation handler. Fires when the same account
    // signs in on a different browser — the new login's auth.routes.js
    // calls notification/kick-stale, which emits this event to every
    // older socket for the same user. We dispatch a window event picked
    // up by SessionEndedOverlay (mounted at App root). The overlay owns
    // wiping auth and redirecting when the user clicks "Sign in again"
    // — no immediate window.location.href here.
    const handleSessionRevoked = () => {
      try {
        sessionStorage.setItem('uniflow:logout-reason', 'signed_in_elsewhere');
      } catch { /* ignore */ }
      window.dispatchEvent(
        new CustomEvent('uniflow:session-ended', { detail: { reason: 'signed_in_elsewhere' } }),
      );
    };

    const tryInit = () => {
      const userId = localStorage.getItem('currentUserId');
      if (!userId || listenersAttached) return;
      ns = initNotificationSocket();
      ns.on('new_notification', handleNewNotif);
      ns.on('session:revoked', handleSessionRevoked);
      listenersAttached = true;
    };

    // Try once on mount (covers the "already logged in" case).
    tryInit();

    // Retry whenever auth state changes — AppContext dispatches this on
    // successful login. Also listen to cross-tab `storage` event so when a
    // login happens in tab A, tab B's notification socket also opens once
    // localStorage carries the new userId.
    const onAuthChanged = () => tryInit();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'currentUserId' || e.key === 'authToken') tryInit();
    };
    window.addEventListener('uniflow:auth-changed', onAuthChanged);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('uniflow:auth-changed', onAuthChanged);
      window.removeEventListener('storage', onStorage);
      if (ns) {
        ns.off('new_notification', handleNewNotif);
        ns.off('session:revoked', handleSessionRevoked);
      }
      // Don't disconnect the socket on unmount — the context lives for the
      // entire app session, and tearing the socket down would kill push for
      // every other consumer of NotificationContext.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user logs out, drop the notification-server socket so the next
  // login picks up a fresh JWT instead of replaying the stale one.
  useEffect(() => {
    const onAuthExpired = () => disconnectNotificationSocket();
    window.addEventListener('uniflow:auth-expired', onAuthExpired);
    return () => window.removeEventListener('uniflow:auth-expired', onAuthExpired);
  }, []);

  /**
   * Global chat socket — opens ONE connection to chat-server (port 4010)
   * and auto-joins every section room the user belongs to (server handles
   * the join in its connection handler). On `chat:newMessage`:
   *
   *   1. Skip messages the user sent themselves (no self-ring).
   *   2. Skip if the user is currently on a chatroom URL (the chatroom
   *      page already shows the bubble live; sound there would be noise).
   *   3. Skip if this group is muted in the cached groups list (mute is
   *      stored per-member in Firestore via PATCH .../mute and surfaced
   *      on GET /api/chat/groups/me).
   *   4. Otherwise: ring the chime + push a synthetic LiveNotification
   *      with the group name as title + sender + message preview, so
   *      the dashboard's Recent Activity card lights up.
   *
   * Mute state refreshes when the user toggles it via ChatGroupInfoPanel
   * (that path dispatches a `uniflow:chat-mute-changed` window event).
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Preview (mock-role) sessions never open the global chat socket.
    if (isPreviewSession()) return;

    let socket: import('socket.io-client').Socket | null = null;
    let initStarted = false; // guard against double-init when both listeners fire
    // Map<sectionId, { name, courseCode, muted }> — refreshed on mount and
    // whenever the user toggles a mute. Empty until first fetch resolves.
    let groupsMeta = new Map<string, { name: string; courseCode: string | null; muted: boolean }>();

    const refreshGroupsMeta = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { API_URLS } = require('@shared/config');
        const token = localStorage.getItem('authToken');
        if (!token) return;
        const res = await fetch(`${API_URLS.chat()}/api/chat/groups/me`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        groupsMeta = new Map(
          (Array.isArray(data) ? data : []).map((g: { sectionId: string; name: string; courseCode: string | null; muted: boolean }) => [
            g.sectionId,
            { name: g.name, courseCode: g.courseCode, muted: !!g.muted },
          ])
        );
      } catch {
        /* groupsMeta stays empty; fallback path still rings the sound */
      }
    };

    // Define the handler before async init so the listener registration is
    // a single synchronous block — no race window where messages arrive
    // before we're listening.
    const handleNewMessage = (payload: {
      sectionId: string;
      message: {
        userId: string;
        senderName: string;
        senderAvatar?: string | null;
        senderRole?: string | null;
        message: string;
        attachment?: { type?: string; name?: string } | null;
        system?: boolean;
        id: string;
        createdAt: number | string;
        mentions?: { userIds?: string[]; hasAll?: boolean };
      };
    }) => {
      const { sectionId, message } = payload || {};
      if (!sectionId || !message) return;

      // Diagnostic — visible in browser console so the user can verify the
      // global socket is actually receiving messages. If this never logs
      // for the professor, the chat-server's auto-join didn't include
      // their section (check the chat-server logs for the join count).
      // eslint-disable-next-line no-console
      console.debug('[chat-global] message received', {
        sectionId,
        from: message.senderName,
        userId: message.userId,
      });

      // 1) Skip self-sends — the user heard themselves typing; no chime.
      const myUserId = localStorage.getItem('currentUserId') || '';
      if (message.userId === myUserId) return;

      // 1b) Admins are members of every staff chat group so a global
      // notification on every chat message buries them in alerts about
      // staff conversations they aren't actively involved in. Per owner
      // directive (2026-05-17): chatroom traffic does NOT generate
      // notifications for admins — they can still see the live thread in
      // any chatroom page they open. Other roles keep the normal behaviour.
      const myRole = (localStorage.getItem('currentUserRole') || '').toLowerCase();
      if (myRole === 'admin') return;

      // 2) System announcements come through `chat:newMessage` too. They
      //    already trigger a notification via the announcement composer
      //    flow, so skip here to avoid a double ping.
      if (message.system) return;

      // 3) Skip when the user is actively on a chatroom URL — they're
      //    reading the thread; an extra ring is noise. The chatroom UI
      //    surfaces the new bubble itself.
      const path = window.location.pathname || '';
      if (path.includes('/chatroom')) return;

      // 4) Mute filter — keyed by sectionId via the cached map.
      const meta = groupsMeta.get(sectionId);
      if (meta?.muted) return;

      // Build a synthetic Notification for the dashboard. No DB row —
      // chat messages are a high-volume firehose, persisting them as
      // Notification rows would explode the table.
      const senderName = message.senderName || 'New message';
      const groupName = meta?.name || meta?.courseCode || 'Chat';
      const preview = message.attachment?.type === 'poll'
        ? '📊 New poll'
        : message.attachment?.type === 'image'
        ? '📷 Photo'
        : message.attachment?.type === 'video'
        ? '🎥 Video'
        : message.attachment?.type === 'audio'
        ? '🎤 Voice note'
        : message.attachment?.type === 'document'
        ? `📎 ${message.attachment.name || 'Document'}`
        : (message.message || '').slice(0, 140);

      // Mention-awareness — when this message tags the current user
      // (either by userId or by the @all sentinel), upgrade the toast
      // copy so the user sees they were singled out. The chime is the
      // same chime; the visual prominence comes from the title prefix
      // and the `type: 'critical'` styling on the dashboard card.
      const mentionedDirectly = !!message.mentions?.userIds?.includes(myUserId);
      const mentionedByAll = !!message.mentions?.hasAll;
      const mentioned = mentionedDirectly || mentionedByAll;

      const live: LiveNotification = {
        id: `chat-${message.id}`,
        type: mentioned ? 'critical' : 'chat',
        title: mentioned
          ? `@you in ${groupName}`
          : groupName,
        content: mentioned
          ? `${senderName} mentioned you: ${preview}`
          : `${senderName}: ${preview}`,
        timestamp:
          typeof message.createdAt === 'number'
            ? new Date(message.createdAt).toISOString()
            : message.createdAt || new Date().toISOString(),
        isRead: false,
        sender: senderName,
        courseCode: meta?.courseCode ?? undefined,
        senderId: message.userId,
        senderName,
        senderRole: message.senderRole ?? null,
        senderAvatar: message.senderAvatar ?? null,
      };
      setNotifications((prev) => {
        if (prev.some((p) => p.id === live.id)) return prev;
        return [live, ...prev];
      });

      // Ring the chat chime — same throttle as broadcast notifications.
      playNotificationSound();

      // System notification only when the app isn't in the foreground (the
      // in-app toast/bell already covers the focused case).
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && shouldEmitSystemNotification()) {
        try {
          new Notification(live.title, {
            body: live.content,
            icon: live.senderAvatar || '/logo192.png',
          });
        } catch { /* ignore */ }
      }
    };

    const onMuteChanged = () => { refreshGroupsMeta(); };
    window.addEventListener('uniflow:chat-mute-changed', onMuteChanged);

    // Connect chat socket via socket.io-client. URL + path go through
    // getSocketEndpoint so single-origin reverse-proxy mode lands on the
    // correct prefix (`/chat/socket.io/`) instead of the default which
    // hits the wrong nginx location.
    const tryInit = async () => {
      const uid = localStorage.getItem('currentUserId');
      const tok = localStorage.getItem('authToken');
      if (!uid || !tok) return;
      if (initStarted) return;
      initStarted = true;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { io } = require('socket.io-client');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getSocketEndpoint, PORTS } = require('@shared/config');
        const { url, path } = getSocketEndpoint(PORTS.CHAT);
        const s = io(url, {
          ...(path ? { path } : {}),
          auth: { token: tok },
          transports: ['websocket', 'polling'],
        });
        socket = s;
        s.on('chat:newMessage', handleNewMessage);
        await refreshGroupsMeta();
      } catch (err) {
        initStarted = false; // allow another attempt after a transient failure
        console.warn('[chat-global] socket init failed:', err);
      }
    };

    // Try once on mount (covers the "already signed in" case — page refresh).
    tryInit();

    // Retry on login. AppContext dispatches `uniflow:auth-changed` after a
    // successful sign-in (both password path and Continue-as path). The
    // notification-server socket above uses the same hook; this one was
    // missing it, which is why brand-new sign-ins received no chat toasts
    // until the page was refreshed.
    const onAuthChanged = () => tryInit();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'currentUserId' || e.key === 'authToken') tryInit();
    };
    window.addEventListener('uniflow:auth-changed', onAuthChanged);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('uniflow:chat-mute-changed', onMuteChanged);
      window.removeEventListener('uniflow:auth-changed', onAuthChanged);
      window.removeEventListener('storage', onStorage);
      socket?.off('chat:newMessage', handleNewMessage);
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isConnected,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAllNotifications
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export default NotificationContext;

