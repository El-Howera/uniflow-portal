import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { useNotifications } from '../../context/NotificationContext';
import { PageNotification, PageNotifType, PageNotifTimeGroup } from '../../types';
import { AnimateOnView } from '../../components/AnimateOnView';
import { renderMarkdown } from '../../components/MarkdownToolbar';
import { API_URLS } from '@shared/config';
import { firebase } from '../../utils/firebase';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

// Base filter set shown to every role. The "System" chip is appended for
// admins only — it surfaces audit-event notifications (Phase 3).
const baseNotifFilters = ['All', 'Unread', 'Announcements', 'Messages'];

// Shape returned by /api/notifications/:userId. Optional everywhere so the
// loose backend response (which may omit fields for older rows) parses
// without per-field guards at the call sites.
interface ApiNotification {
  id: string | number;
  title?: string;
  content?: string;
  message?: string;
  type?: string;
  createdAt?: string;
  timestamp?: string;
  isRead?: boolean;
  courseCode?: string;
  referenceId?: string | null;
  referenceType?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  sender?: string | null;
  senderRole?: string | null;
  senderAvatar?: string | null;
}

type NotifStyle = { bg: string; color: string; border: string; icon: string };

const getNotifStyles = (type: PageNotifType | string) => {
  const styles: Record<string, NotifStyle> = {
    critical: {
      bg: 'bg-red-500/10',
      color: 'text-red-500 dark:text-red-400',
      border: 'border-red-500/20',
      icon: 'ph-warning'
    },
    announcement: {
      bg: 'bg-orange-500/10',
      color: 'text-orange-500 dark:text-orange-400',
      border: 'border-orange-500/20',
      icon: 'ph-megaphone'
    },
    message: {
      bg: 'bg-[#6A3FF4]/10',
      color: 'text-[#6A3FF4]',
      border: 'border-[#6A3FF4]/20',
      icon: 'ph-envelope'
    },
    chat: {
      bg: 'bg-[#6A3FF4]/10',
      color: 'text-[#6A3FF4]',
      border: 'border-[#6A3FF4]/20',
      icon: 'ph-chat-circle'
    },
    info: {
      bg: 'bg-blue-500/10',
      color: 'text-blue-500 dark:text-blue-400',
      border: 'border-blue-500/20',
      icon: 'ph-info'
    },
    // Audit-driven notifications fanned out from sensitive admin actions.
    // Distinct color so the admin can scan the inbox at a glance.
    system: {
      bg: 'bg-yellow-500/10',
      color: 'text-yellow-500 dark:text-yellow-400',
      border: 'border-yellow-500/20',
      icon: 'ph-shield-warning'
    }
  };
  return styles[type] || styles.info;
};

// Helper to get time group from timestamp
const getTimeGroup = (timestamp: string): PageNotifTimeGroup => {
  const now = new Date();
  const notifDate = new Date(timestamp);
  const diffMs = now.getTime() - notifDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 24) return 'Today';
  if (diffDays < 2) return 'Yesterday';
  return 'Older';
};

// Avatar slot for inbox rows. Mirrors the toast logic — render the sender's
// profile picture first, fall back to initials in a brand-tinted circle, then
// finally to the type icon for system / auto-generated notifications.
const STAFF_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  professor: { label: 'Prof', bg: 'bg-[#6A3FF4]', text: 'text-white' },
  ta: { label: 'TA', bg: 'bg-blue-500', text: 'text-white' },
  admin: { label: 'Admin', bg: 'bg-red-500', text: 'text-white' },
  sa: { label: 'SA', bg: 'bg-emerald-500', text: 'text-white' },
};

const NotifAvatar: React.FC<{
  notification: PageNotification;
  style: NotifStyle;
}> = ({ notification, style }) => {
  const [imgFailed, setImgFailed] = useState(false);
  const senderName = notification.senderName || null;
  const role = notification.senderRole || null;
  const badge = role ? STAFF_BADGE[role] : null;
  const hasAvatar = Boolean(notification.senderAvatar) && !imgFailed;
  const initials = senderName
    ? senderName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : null;

  const avatarRing = `ring-2 ${
    style?.color?.replace('text-', 'ring-')?.replace('dark:text-', '').replace(/\/\d+/, '') ||
    'ring-[#6A3FF4]'
  }/40`;

  if (hasAvatar) {
    return (
      <div className="relative w-12 h-12 flex-shrink-0">
        <img
          src={notification.senderAvatar as string}
          alt={senderName || 'Sender'}
          onError={() => setImgFailed(true)}
          className={`w-12 h-12 rounded-full object-cover ${avatarRing}`}
        />
        {badge && (
          <span
            className={`absolute -bottom-1 -right-1 ${badge.bg} ${badge.text} text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white dark:border-[#1a1a1a] leading-none`}
          >
            {badge.label}
          </span>
        )}
      </div>
    );
  }

  if (initials) {
    return (
      <div className="relative w-12 h-12 flex-shrink-0">
        <div
          className={`w-12 h-12 rounded-full bg-gradient-to-br from-[#6A3FF4] to-[#9D7BFF] text-white font-bold text-base flex items-center justify-center ${avatarRing}`}
        >
          {initials}
        </div>
        {badge && (
          <span
            className={`absolute -bottom-1 -right-1 ${badge.bg} ${badge.text} text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white dark:border-[#1a1a1a] leading-none`}
          >
            {badge.label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center border ${style.bg} ${style.color} ${style.border}`}
    >
      <i className={`ph-fill ${style.icon} text-xl`}></i>
    </div>
  );
};

// Helper to format timestamp for display
const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/**
 * Header control for push-permission recovery.
 *
 * Auto-flow: NotificationContext fires `Notification.requestPermission()` on
 * mount whenever state is 'default', so the user gets the browser prompt
 * automatically the first time they land on any page after login. They don't
 * need to click anything to enable push.
 *
 * This pill therefore only surfaces on 'denied' — the one state where the
 * browser refuses to re-prompt and the user has to flip the setting manually
 * in site-settings. Granted and default states render nothing (the dashboard
 * stays uncluttered for the 99% case where push just works).
 */
const PushPermissionPill: React.FC = () => {
    const t = useT();
    const initialPerm: NotificationPermission | 'unsupported' =
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    const [showHelp, setShowHelp] = useState(false);

    if (initialPerm !== 'denied' || !firebase.isConfigured()) {
        return null;
    }

    const helpHref = window.location.origin;

    return (
        <div className="flex flex-col items-end gap-2">
            <button
                onClick={() => setShowHelp((s) => !s)}
                title={t('notifications.pushBlockedTooltip')}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
                <i className="ph-bold ph-prohibit"></i>
                {t('notifications.pushBlockedTitle')}
            </button>
            {showHelp && (
                <div className="bg-red-500/5 border border-red-500/30 text-red-700 dark:text-red-300 rounded-xl p-4 text-xs max-w-md space-y-2">
                    <p className="font-bold flex items-center gap-1">
                        <i className="ph-bold ph-warning"></i>
                        {t('notifications.permBlockedFor', { host: helpHref })}
                    </p>
                    <p className="text-gray-700 dark:text-gray-300">
                        {t('notifications.permIntro')}
                    </p>
                    <ol className="list-decimal list-inside space-y-1 pl-1 text-gray-700 dark:text-gray-300">
                        <li>
                            {t('notifications.permStep1Prefix')} <span className="font-semibold">{t('notifications.permStep1Bold')}</span>{' '}
                            {t('notifications.permStep1Suffix')}
                        </li>
                        <li>
                            {t('notifications.permStep2Prefix')} <span className="font-semibold">{t('notifications.permStep2Bold1')}</span>{' '}
                            {t('notifications.permStep2Mid1')}{' '}
                            <span className="font-semibold">{t('notifications.permStep2Bold2')}</span> {t('notifications.permStep2Suffix')}
                        </li>
                        <li>
                            {t('notifications.permStep3Prefix')} <span className="font-semibold">{t('notifications.permStep3Bold')}</span> {t('notifications.permStep3Mid')} <span className="font-mono">Block</span> {t('notifications.permStep3To')}{' '}
                            <span className="font-mono">Allow</span> {t('notifications.permStep3Or')}{' '}
                            <span className="font-mono">Ask</span>{t('notifications.permStep3End')}
                        </li>
                        <li>{t('notifications.permStep4')}</li>
                    </ol>
                    <p className="text-[10px] text-gray-500 pt-1 border-t border-red-500/20">
                        {t('notifications.permShortcutPrefix')}{' '}
                        <code className="bg-black/10 dark:bg-white/10 px-1 rounded">
                            chrome://settings/content/notifications
                        </code>{' '}
                        {t('notifications.permShortcutSuffix')}
                    </p>
                </div>
            )}
        </div>
    );
};

const Notifications: React.FC = () => {
    const navigate = useNavigate();
    const { searchTerm, userRole } = useAppContext();
    // Admin gets an extra "System" chip for audit-event notifications.
    const notifFilters = useMemo(
        () => userRole === 'admin' ? [...baseNotifFilters, 'System'] : baseNotifFilters,
        [userRole],
    );
    const {
      notifications: liveNotifications,
      markAsRead,
      clearNotification,
      markAllAsRead,
      clearAllNotifications,
    } = useNotifications();
    const t = useT();
    const [activeFilter, setActiveFilter] = useState('All');
    const [expandedId, setExpandedId] = useState<string | number | null>(null);
    const [exitingIds, setExitingIds] = useState<(string | number)[]>([]);
    const [dbNotifications, setDbNotifications] = useState<PageNotification[]>([]);

    /**
     * Resolve a notification to a target route. Announcement-type
     * notifications jump to the public feed (with optional ?id=<id> so
     * the page can auto-open that announcement). Routes are role-scoped
     * so an admin clicking an announcement notification stays inside
     * /admin/* rather than landing in the student layout. Other types
     * stay on the notifications page (no navigation needed).
     */
    const roleSlug = (userRole && ['student','professor','ta','sa','admin'].includes(userRole))
        ? userRole
        : 'student';
    const linkFor = (n: PageNotification): string | null => {
        if (n.type === 'announcement' || n.referenceType === 'Announcement') {
            const base = `/${roleSlug}/announcements`;
            return n.referenceId
                ? `${base}?id=${encodeURIComponent(n.referenceId)}`
                : base;
        }
        if (n.referenceType === 'AttendanceExcuse') {
            // SA + admin → review queue; everyone else lands on their
            // attendance page where their own excuse history lives.
            return (roleSlug === 'sa' || roleSlug === 'admin')
                ? '/sa/attendance-excuses'
                : `/${roleSlug}/attendance`;
        }
        return null;
    };

    const handleOpen = (n: PageNotification) => {
        const route = linkFor(n);
        if (!route) return;
        // Mark read before navigating so the badge clears in the same tick.
        if (typeof n.id === 'string') {
            markAsRead(n.id);
            const token = localStorage.getItem('authToken');
            fetch(`${API_URLS.notification()}/api/notifications/${n.id}/read`, {
                method: 'PATCH',
                credentials: 'include',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            }).catch(() => {});
        }
        navigate(route);
    };

    // Fetch persisted notifications from DB on mount
    useEffect(() => {
      const userId = localStorage.getItem('currentUserId') || localStorage.getItem('currentUserEmail');
      const token = localStorage.getItem('authToken');
      if (!userId) return;
      fetch(`${API_URLS.notification()}/api/notifications/${encodeURIComponent(userId)}?limit=100`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
        .then(r => r.ok ? r.json() : [])
        .then((data: ApiNotification[]) => {
          const converted: PageNotification[] = data.map(n => {
            const senderLabel = n.senderName || n.sender || null;
            const isoTs = n.createdAt || n.timestamp || new Date().toISOString();
            return {
              id: n.id,
              title: n.title || '',
              content: n.content || n.message || '',
              type: (n.type === 'chat' ? 'message' : n.type) as PageNotifType,
              timestamp: formatTimestamp(isoTs),
              // Preserve the raw ISO so the merge sort below can order
              // strictly newest-first regardless of insertion sequence.
              rawTimestamp: isoTs,
              timeGroup: getTimeGroup(isoTs),
              isUnread: !n.isRead,
              extraDetails: senderLabel
                ? `From: ${senderLabel}${n.courseCode ? ` in ${n.courseCode}` : ''}`
                : undefined,
              referenceId: n.referenceId ?? null,
              referenceType: n.referenceType ?? null,
              senderId: n.senderId ?? null,
              senderName: senderLabel,
              senderRole: n.senderRole ?? null,
              senderAvatar: n.senderAvatar ?? null,
            };
          });
          setDbNotifications(converted);
        })
        .catch(() => setDbNotifications([]));
    }, []);

    // Merge live WS notifications with persisted DB notifications (no mock data).
    // referenceType is preserved end-to-end so System events (Phase 3 audit
    // fan-out) are recognized whether they arrive via socket or DB.
    const allNotifications = useMemo(() => {
      const convertedLive: PageNotification[] = (liveNotifications as ApiNotification[]).map((n) => {
        const senderLabel = n.senderName || n.sender || null;
        const isoTs = n.timestamp || new Date().toISOString();
        return {
          id: n.id,
          title: n.title || '',
          content: n.content || '',
          type: (n.type === 'chat' ? 'message' : n.type) as PageNotifType,
          timestamp: formatTimestamp(isoTs),
          rawTimestamp: isoTs,
          timeGroup: getTimeGroup(isoTs),
          isUnread: !n.isRead,
          extraDetails: senderLabel
            ? `From: ${senderLabel}${n.courseCode ? ` in ${n.courseCode}` : ''}`
            : undefined,
          referenceId: n.referenceId ?? null,
          referenceType: n.referenceType ?? null,
          senderId: n.senderId ?? null,
          senderName: senderLabel,
          senderRole: n.senderRole ?? null,
          senderAvatar: n.senderAvatar ?? null,
        };
      });

      // Live WS notifications + DB persisted, deduped by id, then sorted
      // newest-first using rawTimestamp so the Today group always shows
      // first regardless of how the live and DB lists arrived.
      const liveIds = new Set(convertedLive.map(n => n.id));
      const uniqueDb = dbNotifications.filter(n => !liveIds.has(n.id));
      const merged = [...convertedLive, ...uniqueDb];
      return merged.sort((a, b) => {
        const at = a.rawTimestamp ? new Date(a.rawTimestamp).getTime() : 0;
        const bt = b.rawTimestamp ? new Date(b.rawTimestamp).getTime() : 0;
        return bt - at;
      });
    }, [liveNotifications, dbNotifications]);

    const [notifications, setNotifications] = useState<PageNotification[]>(allNotifications);

    useEffect(() => {
      setNotifications(allNotifications);
    }, [allNotifications]);

    const handleDismiss = (id: string | number, e: React.MouseEvent) => {
        e.stopPropagation();
        setExitingIds((prev) => [...prev, id]);
        setTimeout(() => {
            // Live (in-memory) drop:
            if (typeof id === 'string') {
              clearNotification(id);
            }
            // Persistent dismiss — DELETE the row so a reload doesn't bring
            // it back. dbNotifications also drops it locally so the merge
            // doesn't resurrect it on the same page mount.
            if (typeof id === 'string') {
              const token = localStorage.getItem('authToken');
              fetch(`${API_URLS.notification()}/api/notifications/${id}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              }).catch(() => {});
            }
            setDbNotifications((prev) => prev.filter((n) => String(n.id) !== String(id)));
            setNotifications((prev) => prev.filter((n) => n.id !== id));
            setExitingIds((prev) => prev.filter((eid) => eid !== id));
        }, 500);
    };

    // Mark every visible notification as read — both the in-memory live ones
    // and the persisted DB rows. The two PATCHes are fire-and-forget so we
    // don't block the optimistic UI update.
    const [confirmingClear, setConfirmingClear] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);

    const handleMarkAllRead = useCallback(() => {
      markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isUnread: false })));
      setDbNotifications((prev) => prev.map((n) => ({ ...n, isUnread: false })));
      const userId = localStorage.getItem('currentUserId');
      const token = localStorage.getItem('authToken');
      if (!userId) return;
      fetch(`${API_URLS.notification()}/api/notifications/${encodeURIComponent(userId)}/read-all`, {
        method: 'PATCH',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
    }, [markAllAsRead]);

    // Clear All — wipe every notification both client-side and from the
    // server. Two-step confirm (button → "Are you sure?") to guard against
    // accidental clicks; the destructive bulk DELETE is irreversible.
    const handleClearAll = useCallback(async () => {
      if (bulkBusy) return;
      setBulkBusy(true);
      // Slide-out animation for every visible row before we drop them.
      setExitingIds(notifications.map((n) => n.id));
      try {
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URLS.notification()}/api/notifications/me/all`, {
          method: 'DELETE',
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }).catch(() => {});
      } finally {
        // Drop after the slide-out animation has had a beat to play.
        setTimeout(() => {
          clearAllNotifications();
          setDbNotifications([]);
          setNotifications([]);
          setExitingIds([]);
          setConfirmingClear(false);
          setBulkBusy(false);
        }, 350);
      }
    }, [notifications, clearAllNotifications, bulkBusy]);

    const handleViewDetails = (id: string | number) => {
        setExpandedId(expandedId === id ? null : id);
        if (typeof id === 'string') {
          markAsRead(id);
          const token = localStorage.getItem('authToken');
          fetch(`${API_URLS.notification()}/api/notifications/${id}/read`, {
            method: 'PATCH',
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }).catch(() => {});
        }
        setNotifications((prevNotifications) =>
            prevNotifications.map((n) =>
                n.id === id ? { ...n, isUnread: false } : n
            )
        );
    };

    const globalFiltered = notifications.filter(n => 
        n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        n.content.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // System notifications are tagged as referenceType === 'AuditLog' (always)
    // and may have type === 'system' (when the Prisma client is current) OR
    // type === 'critical' (legacy fallback before prisma generate caught up).
    // Treat both as System and exclude them from Messages so they don't double-count.
    const isSystemNotif = (n: PageNotification) =>
        n.referenceType === 'AuditLog' || (n.type as string) === 'system';

    const filtered = globalFiltered.filter(n => {
        if (activeFilter === 'All') return true;
        if (activeFilter === 'Unread') return n.isUnread;
        if (activeFilter === 'Announcements') return n.type === 'announcement';
        if (activeFilter === 'Messages')
            return !isSystemNotif(n) &&
                (n.type === 'message' || n.type === 'critical' || (n.type as string) === 'chat');
        if (activeFilter === 'System') return isSystemNotif(n);
        return false;
    });

    const grouped = filtered.reduce((acc, notification) => {
        const group = notification.timeGroup;
        if (!acc[group]) acc[group] = [];
        acc[group].push(notification);
        return acc;
    }, {} as Record<PageNotifTimeGroup, PageNotification[]>);

    return (
        // Animations disabled on this page (`enabled={false}`) so the
        // entrance translateY doesn't make content look "way down" while the
        // motion settles. Header and filter rows render at their true y from
        // the first paint.
        <div className="pb-16 space-y-4 overflow-hidden">
            <AnimateOnView enabled={false}>
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div>
                        <h2 className="text-black dark:text-white text-2xl sm:text-3xl font-bold mb-1">{t('notifications.title')}</h2>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">{t('notifications.subtitle')}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Bulk Mark all read — only enabled when at least one
                            row is unread, otherwise it's a no-op. */}
                        <button
                            onClick={handleMarkAllRead}
                            disabled={notifications.every((n) => !n.isUnread)}
                            title={t('notifications.markAllRead')}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border bg-white/30 dark:bg-black/20 border-white/20 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-[#6A3FF4]/10 hover:border-[#6A3FF4]/40 hover:text-[#6A3FF4] dark:hover:text-[#bda8ff] disabled:opacity-40 disabled:cursor-not-allowed transition-colors backdrop-filter backdrop-blur-xl"
                        >
                            <i className="ph-bold ph-check-square-offset"></i>
                            Mark all read
                        </button>

                        {/* Clear all — two-step confirm to prevent accidental
                            destructive clicks. The second click fires the bulk
                            DELETE; ESC / clicking elsewhere doesn't cancel,
                            but the button reverts to default after the
                            request settles. */}
                        {!confirmingClear ? (
                            <button
                                onClick={() => setConfirmingClear(true)}
                                disabled={notifications.length === 0 || bulkBusy}
                                title={t('notifications.clearAllTooltip')}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border bg-white/30 dark:bg-black/20 border-white/20 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors backdrop-filter backdrop-blur-xl"
                            >
                                <i className="ph-bold ph-trash"></i>
                                Clear all
                            </button>
                        ) : (
                            <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl border bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 text-xs font-bold backdrop-filter backdrop-blur-xl">
                                <i className="ph-bold ph-warning"></i>
                                Clear {notifications.length}?
                                <button
                                    onClick={handleClearAll}
                                    disabled={bulkBusy}
                                    className="px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                                >
                                    {bulkBusy ? 'Clearing…' : 'Yes'}
                                </button>
                                <button
                                    onClick={() => setConfirmingClear(false)}
                                    disabled={bulkBusy}
                                    className="px-2 py-1 rounded-lg bg-white/40 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-white/60 dark:hover:bg-white/20 transition-colors"
                                >
                                    {t('common.cancel')}
                                </button>
                            </div>
                        )}

                        <PushPermissionPill />
                    </div>
                </div>
            </AnimateOnView>

            <AnimateOnView enabled={false}>
                {/* Filter chips — wrapped in an overflow-x-auto container so
                    they scroll horizontally on narrow screens instead of
                    breaking the page width. */}
                <div className="flex items-center gap-2 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1.5 rounded-xl w-full sm:w-fit max-w-full overflow-x-auto border border-white/20 dark:border-white/10 shadow-lg scrollbar-hidden">
                    {notifFilters.map(filter => {
                        const labels: Record<string, string> = {
                            All: t('notifications.all'),
                            Unread: t('notifications.unread'),
                            Announcements: t('notifications.announcements'),
                            Messages: t('notifications.messages'),
                            System: 'System',
                        };
                        return (
                            <button
                                key={filter}
                                onClick={() => setActiveFilter(filter)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                                    activeFilter === filter
                                        ? 'bg-[#6A3FF4] text-white shadow-lg shadow-purple-500/20'
                                        : 'text-gray-700 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/10'
                                }`}
                            >
                                {labels[filter] ?? filter}
                            </button>
                        );
                    })}
                </div>
            </AnimateOnView>

            <div className="space-y-5">
                {Object.entries(grouped).map(([group, notifs]) => (
                    <AnimateOnView key={group} enabled={false}>
                        <section>
                            <h3 className="text-xs font-bold text-gray-600 dark:text-gray-500 uppercase tracking-wider mb-2 ml-2">
                                {group === 'Today' ? t('notifications.today')
                                    : group === 'Yesterday' ? t('notifications.yesterday')
                                    : group === 'Older' ? t('notifications.older')
                                    : group}
                            </h3>
                            <div className="flex flex-col gap-3">
                                {notifs.map(notification => {
                                    // System notifications get the yellow shield style regardless of
                                    // type — matches `isSystemNotif` above (Phase 3 fallback path).
                                    const styleType = notification.referenceType === 'AuditLog'
                                        ? 'system'
                                        : notification.type;
                                    const style = getNotifStyles(styleType);
                                    const isExiting = exitingIds.includes(notification.id);
                                    const isExpanded = expandedId === notification.id;
                                    const target = linkFor(notification);
                                    const isClickable = target !== null;

                                    return (
                                        <div
                                            key={notification.id}
                                            onClick={isClickable ? () => handleOpen(notification) : undefined}
                                            className={`
                                                relative overflow-hidden transition-all duration-500 ease-in-out
                                                ${isExiting ? 'translate-x-[120%] opacity-0 max-h-0 mb-0 py-0 border-0' : 'translate-x-0 opacity-100 max-h-[600px]'}
                                                ${glassCardStyle} group
                                                ${notification.isUnread ? 'bg-white/50 dark:bg-[#1a1a1a]' : 'bg-white/30 dark:bg-[#1a1a1a]/60'}
                                                ${isExiting ? '' : 'p-4 sm:p-6'}
                                                ${isClickable ? 'cursor-pointer hover:border-[#6A3FF4]/40' : ''}
                                            `}
                                        >
                                            <div className="flex gap-3 sm:gap-5">
                                                <NotifAvatar notification={notification} style={style} />


                                                <div className="flex-grow min-w-0">
                                                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-2 gap-1 md:gap-2">
                                                        <h4 className={`text-base sm:text-lg font-bold break-words ${notification.isUnread ? 'text-black dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                                                            {notification.title}
                                                        </h4>
                                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-500 flex items-center gap-1">
                                                            <i className="ph-bold ph-clock"></i> {notification.timestamp}
                                                        </span>
                                                    </div>

                                                    {/* Body and extra metadata are hidden by default — the
                                                        card shows the title only, like a real notification.
                                                        Both reveal under "View Details" in a glass-morphic
                                                        sub-card with proper metadata strip + markdown body. */}
                                                    {isExpanded && (notification.content || notification.extraDetails || notification.senderName || (notification as PageNotification & { courseCode?: string }).courseCode) && (
                                                        <div className="mb-4 mt-3 animate-in fade-in slide-in-from-top-2 duration-300 max-w-3xl">
                                                            <div className="relative overflow-hidden rounded-2xl bg-white/40 dark:bg-white/[0.04] backdrop-blur-2xl backdrop-saturate-150 border border-white/40 dark:border-white/10 ring-1 ring-inset ring-white/30 dark:ring-white/5 shadow-lg shadow-black/5 dark:shadow-black/20">
                                                                {/* Purple accent stripe left edge */}
                                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#7B5AFF] to-[#5A2AD4]" />
                                                                <div className="p-4 pl-5 sm:p-5 sm:pl-6 space-y-3">
                                                                    {/* Metadata strip — sender + course + type chips */}
                                                                    {(notification.senderName || notification.senderRole || (notification as PageNotification & { courseCode?: string }).courseCode || notification.referenceType) && (
                                                                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                                                            {notification.senderName && (
                                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#6A3FF4]/15 text-[#6A3FF4] dark:text-[#9d83ff] font-bold border border-[#6A3FF4]/25">
                                                                                    <i className="ph-bold ph-user-circle text-sm" />
                                                                                    {notification.senderName}
                                                                                    {notification.senderRole && (
                                                                                        <span className="text-[10px] opacity-80 capitalize">· {notification.senderRole}</span>
                                                                                    )}
                                                                                </span>
                                                                            )}
                                                                            {(notification as PageNotification & { courseCode?: string }).courseCode && (
                                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 dark:bg-white/5 text-gray-700 dark:text-gray-300 font-semibold border border-white/40 dark:border-white/10">
                                                                                    <i className="ph-bold ph-graduation-cap text-sm" />
                                                                                    {(notification as PageNotification & { courseCode?: string }).courseCode}
                                                                                </span>
                                                                            )}
                                                                            {notification.referenceType && notification.referenceType !== 'AuditLog' && (
                                                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 dark:bg-white/5 text-gray-600 dark:text-gray-400 font-semibold border border-white/40 dark:border-white/10 capitalize">
                                                                                    {notification.referenceType.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    {/* Body — rendered with Markdown so bullets/bold/links
                                                                        from announcement composers come through properly. */}
                                                                    {notification.content && (
                                                                        <div className="text-gray-700 dark:text-gray-200 text-sm leading-relaxed">
                                                                            {renderMarkdown(notification.content)}
                                                                        </div>
                                                                    )}
                                                                    {/* Extra metadata strip — "From: X in CSXY" lines from
                                                                        the live notification context. */}
                                                                    {notification.extraDetails && (
                                                                        <div className="pt-3 mt-3 border-t border-white/30 dark:border-white/10 text-xs text-gray-500 dark:text-gray-400 flex items-start gap-2">
                                                                            <i className="ph-bold ph-info text-[#6A3FF4] mt-0.5" />
                                                                            <span className="flex-1">{notification.extraDetails}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div className="flex gap-3">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDismiss(notification.id, e);
                                                            }}
                                                            className="text-xs font-semibold text-black dark:text-white bg-white/50 dark:bg-[#2d2d2d] hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400 hover:border-red-500/30 px-4 py-2 rounded-lg transition-colors border border-gray-300/50 dark:border-[#363636]"
                                                        >
                                                            {t('common.close')}
                                                        </button>

                                                        {isClickable ? (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleOpen(notification);
                                                                }}
                                                                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors border bg-[#6A3FF4] text-white border-[#6A3FF4] hover:opacity-90 flex items-center gap-1.5"
                                                            >
                                                                <i className="ph-bold ph-arrow-square-out"></i>
                                                                {t('notifications.openAnnouncement')}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleViewDetails(notification.id);
                                                                }}
                                                                disabled={!notification.content && !notification.extraDetails}
                                                                className={`text-xs font-semibold px-4 py-2 rounded-lg transition-colors border disabled:opacity-50 disabled:cursor-not-allowed
                                                                    ${isExpanded
                                                                        ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                                                                        : 'text-[#6A3FF4] bg-[#6A3FF4]/10 hover:bg-[#6A3FF4]/20 border-[#6A3FF4]/20'
                                                                    }`}
                                                            >
                                                                {isExpanded ? t('notifications.hideDetails') : t('notifications.viewDetails')}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    </AnimateOnView>
                ))}
            </div>
            {filtered.length === 0 && (
                <div className="text-center py-20 text-gray-500">
                    {searchTerm ? t('notifications.noResults') : t('notifications.noNotifications')}
                </div>
            )}
        </div>
    );
};

export default Notifications;
