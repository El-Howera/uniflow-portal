// Shared type definitions

export type PageNotifType = 'critical' | 'announcement' | 'message' | 'info' | 'chat' | 'system';
export type PageNotifTimeGroup = 'Today' | 'Yesterday' | 'Older';

export interface PageNotification {
  id: number | string;
  type: PageNotifType;
  title: string;
  content: string;
  extraDetails?: string;
  timestamp: string;
  // Raw createdAt (ISO) preserved alongside the human-formatted `timestamp`
  // so the page can sort newest-first reliably across the live + DB merge.
  // Optional because legacy/in-memory items may not carry it.
  rawTimestamp?: string;
  isUnread: boolean;
  timeGroup: PageNotifTimeGroup;
  // When type === 'announcement', these point at the originating Announcement
  // row so the UI can wire a clickable link into the feed.
  referenceId?: string | null;
  referenceType?: string | null;
  // Hydrated sender info — set on rows fanned out from a real user
  // (announcement, broadcast, send). Used by the inbox to render the
  // sender's profile picture next to the row. Null/undefined for
  // system-generated notifications.
  senderId?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
  senderAvatar?: string | null;
}

export interface DynamicCategoryItem {
    label: string;
    icon: string;
    path?: string;
    /**
     * Optional RBAC gate. When the user is on a role surface that enforces
     * permissions (currently admin), the nav item is hidden if the user
     * doesn't hold this permission. Other surfaces ignore the field.
     */
    requires?: { category: string; action?: 'read' | 'write' | 'delete' };
}

export interface DynamicCategory {
    title: string;
    icon: string;
    items: DynamicCategoryItem[];
    defaultOpen: boolean;
}