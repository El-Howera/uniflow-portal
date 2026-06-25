/**
 * WebSocket Service for UniFlow
 * Provides real-time chat and notification functionality.
 *
 * URL resolution defers to getSocketEndpoint() in shared/config.ts so the
 * socket goes through the same single-origin reverse proxy as everything
 * else (path prefix `/websocket/socket.io/` or `/notification/socket.io/`
 * behind nginx in production, direct port `:4001` / `:4009` in dev).
 *
 * The bespoke `http://${hostname}:4001` builders that used to live here
 * triggered mixed-content blocks on Fly (https page + ws://...:4001) and
 * straight-up failures everywhere else single-origin mode is in effect.
 */

import { io, Socket } from 'socket.io-client';
import { getSocketEndpoint, PORTS } from '@shared/config';

// Singleton socket instance
let socket: Socket | null = null;

// Types
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface PollOption {
  id: string;
  text: string;
}

export interface PollAttachmentPayload {
  question: string;
  options: PollOption[];
  multipleChoice: boolean;
}

export interface FileAttachment {
  id: string;
  name: string;
  type: string; // 'image' | 'document' | 'video' | 'audio' | 'poll' | 'other'
  mimeType: string;
  size: number;
  url: string; // base64 data URL or uploaded URL — empty string for polls
  thumbnail?: string; // for images/videos
  // Poll-only fields. Tally + the caller's vote come from a separate
  // /api/chat/messages/:id/poll fetch (live updates via chat:pollVoted).
  poll?: PollAttachmentPayload;
}

export interface MentionPayload {
  userIds: string[];
  hasAll: boolean;
}

export interface ChatMessage {
  id: string;
  odID: string;
  senderName: string;
  senderAvatar?: string;
  message: string;
  timestamp: string;
  type: 'user' | 'system';
  status?: MessageStatus;
  attachment?: FileAttachment;
  mentions?: MentionPayload;
}

export interface UserData {
  odID: string;
  name: string;
  email: string;
  role: string;
}

export interface Notification {
  id: string;
  type: 'announcement' | 'message' | 'critical' | 'info';
  title: string;
  content: string;
  timestamp: string;
  isRead: boolean;
}

// Helper to read the current auth token at connect/reconnect time. Using a
// function (not a captured value) means a token rotation via /api/auth/refresh
// is picked up on the next reconnect without us having to tear the socket
// down manually.
const readAuthToken = (): string => {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('authToken') || '';
};

// Initialize socket connection
export const initSocket = (): Socket => {
  if (!socket) {
    const { url, path } = getSocketEndpoint(PORTS.WEBSOCKET);
    socket = io(url, {
      ...(path ? { path } : {}),
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // The websocket server (port 4001) authenticates every connection with
      // a JWT in `socket.handshake.auth.token`. Without this, the socket is
      // immediately rejected with "Authentication required".
      auth: (cb) => cb({ token: readAuthToken() }),
    });

    socket.on('connect', () => { /* connected */ });

    socket.on('disconnect', () => { /* disconnected */ });

    socket.on('connect_error', (error) => {
      // Auth failures usually mean the token is missing or expired — flag it
      // distinctly so the user can spot it in the console quickly.
      if (
        error.message === 'Authentication required' ||
        error.message === 'Invalid token'
      ) {
        console.warn(
          '🔌 WebSocket auth failed — log out and back in to refresh the JWT, ' +
            'or check that localStorage.authToken is set.'
        );
      } else {
        console.warn('🔌 WebSocket connection error:', error.message);
      }
    });
  }
  return socket;
};

// Get socket instance
export const getSocket = (): Socket | null => socket;

// Check if socket is connected
export const isSocketConnected = (): boolean => {
  return socket?.connected ?? false;
};

// Disconnect socket
export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

// ============ NOTIFICATION-SERVER SOCKET (port 4009) ============
//
// The notification server runs its OWN Socket.io instance on a separate port
// (4009). The websocket server above (4001) handles chat & presence — the
// notification fan-out (`new_notification` events from POST broadcasts and
// /send) is emitted by the 4009 server and never reaches the 4001 socket.
//
// To actually deliver real-time push to the browser, we open a second
// connection here, dedicated to notification events. Same JWT-auth contract
// as the chat socket.

let notificationSocket: Socket | null = null;

export const initNotificationSocket = (): Socket => {
  if (!notificationSocket) {
    // REACT_APP_NOTIFICATION_WS_URL is a build-time escape hatch — when set,
    // wins over the central resolver. Useful for pointing a mobile build at
    // a specific tunnel without affecting other services.
    const override = process.env.REACT_APP_NOTIFICATION_WS_URL;
    const endpoint = override
      ? { url: override, path: undefined as string | undefined }
      : getSocketEndpoint(PORTS.NOTIFICATION);
    notificationSocket = io(endpoint.url, {
      ...(endpoint.path ? { path: endpoint.path } : {}),
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: (cb) => cb({ token: readAuthToken() }),
    });

    notificationSocket.on('connect_error', (error) => {
      if (
        error.message === 'Authentication required' ||
        error.message === 'Invalid token'
      ) {
        console.warn(
          '🔔 Notification socket auth failed — re-login to refresh JWT.'
        );
      } else {
        console.warn('🔔 Notification socket connection error:', error.message);
      }
    });
  }
  return notificationSocket;
};

export const disconnectNotificationSocket = (): void => {
  if (notificationSocket) {
    notificationSocket.disconnect();
    notificationSocket = null;
  }
};

// ============ USER FUNCTIONS ============

export const joinAsUser = (userData: UserData): void => {
  const sock = initSocket();
  sock.emit('user:join', userData);
};

// ============ CHAT FUNCTIONS ============

// Optional `sectionId` overload — when provided, the room key on the
// websocket server becomes `section:<id>` instead of the legacy course
// code. Two sections of the same course no longer share a room.
export const joinChatRoom = (courseCode: string, userName: string, sectionId?: string): void => {
  const sock = initSocket();
  sock.emit('chat:join', { courseCode, sectionId, userName });
};

export const leaveChatRoom = (courseCode: string, userName: string, sectionId?: string): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('chat:leave', { courseCode, sectionId, userName });
  }
};

export const sendChatMessage = (
  courseCode: string,
  odID: string,
  senderName: string,
  message: string,
  senderAvatar?: string,
  attachment?: FileAttachment,
  sectionId?: string,
): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('chat:message', {
      courseCode,
      sectionId,
      odID,
      senderName,
      message,
      senderAvatar,
      attachment,
    });
  }
};

export const sendTypingIndicator = (
  courseCode: string,
  userName: string,
  isTyping: boolean
): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('chat:typing', { courseCode, userName, isTyping });
  }
};

// Mark messages as read
export const markMessagesAsRead = (courseCode: string, odID: string, messageIds: string[]): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('chat:markRead', { courseCode, odID, messageIds });
  }
};

// Chat event listeners
export const onChatHistory = (callback: (data: { courseCode: string; messages: ChatMessage[] }) => void): void => {
  const sock = initSocket();
  sock.on('chat:history', callback);
};

export const onNewMessage = (callback: (data: { courseCode: string; message: ChatMessage }) => void): void => {
  const sock = initSocket();
  sock.on('chat:newMessage', callback);
};

export const onMessageStatus = (callback: (data: { courseCode: string; messageId: string; status: MessageStatus }) => void): void => {
  const sock = initSocket();
  sock.on('chat:messageStatus', callback);
};

export const onMessagesRead = (callback: (data: { courseCode: string; messageIds: string[]; readBy: string }) => void): void => {
  const sock = initSocket();
  sock.on('chat:messagesRead', callback);
};

export const onUserTyping = (callback: (data: { courseCode: string; userName: string; isTyping: boolean }) => void): void => {
  const sock = initSocket();
  sock.on('chat:userTyping', callback);
};

export const onUserJoined = (callback: (data: { userName: string; courseCode: string; timestamp: string }) => void): void => {
  const sock = initSocket();
  sock.on('chat:userJoined', callback);
};

export const onUserLeft = (callback: (data: { userName: string; courseCode: string; timestamp: string }) => void): void => {
  const sock = initSocket();
  sock.on('chat:userLeft', callback);
};

// ============ NOTIFICATION FUNCTIONS ============

export const sendNotification = (targetUserId: string, notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('notification:send', { targetUserId, notification });
  }
};

export const broadcastNotification = (
  notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>,
  targetRole?: string
): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('notification:broadcast', { notification, targetRole });
  }
};

export const markNotificationRead = (odID: string, notificationId: string): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('notification:markRead', { odID, notificationId });
  }
};

export const getAllNotifications = (odID: string): void => {
  const sock = getSocket();
  if (sock) {
    sock.emit('notification:getAll', { odID });
  }
};

// Notification event listeners
export const onNewNotification = (callback: (notification: Notification) => void): void => {
  const sock = initSocket();
  sock.on('notification:new', callback);
};

export const onNotificationList = (callback: (notifications: Notification[]) => void): void => {
  const sock = initSocket();
  sock.on('notification:list', callback);
};

// Online users
export const onOnlineUsersUpdate = (callback: (data: { count: number }) => void): void => {
  const sock = initSocket();
  sock.on('users:online', callback);
};

// Remove listeners
export const removeAllListeners = (): void => {
  const sock = getSocket();
  if (sock) {
    sock.removeAllListeners();
  }
};

export const removeListener = (event: string): void => {
  const sock = getSocket();
  if (sock) {
    sock.off(event);
  }
};

