/**
 * Toast Notification Component
 *
 * Renders live notification bursts in the top-right of every authenticated
 * page. Visual design priorities:
 *   - Sender's profile picture when a real human sent the notification
 *     (announcement, message, broadcast). Falls back to a type-based icon
 *     for system events with no sender.
 *   - Subtle role badge under the avatar so the recipient sees at a glance
 *     "this came from a Professor / TA / Admin / SA".
 *   - Strong glass-morphism + accent stripe per type so type recognition is
 *     instant at a glance.
 *   - Smooth slide+spring entrance, progress-bar countdown, click-to-route.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNotifications, LiveNotification } from '../context/NotificationContext';
import { useAppContext } from '../context/AppContext';
import { isElectronApp } from '@shared/config';

interface ToastProps {
  notification: LiveNotification;
  onClose: () => void;
  onClick: () => void;
}

// Visual treatment per notification type. Stripe/icon/iconBg are the three
// recognizable signals; tweak here, not at the call sites.
type ToastVisual = {
  icon: string;
  iconBg: string;
  iconColor: string;
  stripe: string; // gradient classes for the left accent stripe
  ringColor: string; // used on the avatar ring when sender exists
};

const VISUALS: Record<string, ToastVisual> = {
  critical: {
    icon: 'ph-warning-circle',
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-500 dark:text-red-400',
    stripe: 'from-red-500 to-rose-500',
    ringColor: 'ring-red-500/40',
  },
  announcement: {
    icon: 'ph-megaphone',
    iconBg: 'bg-orange-500/15',
    iconColor: 'text-orange-500 dark:text-orange-400',
    stripe: 'from-orange-500 to-amber-500',
    ringColor: 'ring-orange-500/40',
  },
  chat: {
    icon: 'ph-chat-circle-dots',
    iconBg: 'bg-[#6A3FF4]/15',
    iconColor: 'text-[#6A3FF4]',
    stripe: 'from-[#6A3FF4] to-[#9D7BFF]',
    ringColor: 'ring-[#6A3FF4]/40',
  },
  message: {
    icon: 'ph-envelope',
    iconBg: 'bg-[#6A3FF4]/15',
    iconColor: 'text-[#6A3FF4]',
    stripe: 'from-[#6A3FF4] to-[#9D7BFF]',
    ringColor: 'ring-[#6A3FF4]/40',
  },
  system: {
    icon: 'ph-shield-warning',
    iconBg: 'bg-yellow-500/15',
    iconColor: 'text-yellow-500 dark:text-yellow-400',
    stripe: 'from-yellow-500 to-amber-500',
    ringColor: 'ring-yellow-500/40',
  },
  info: {
    icon: 'ph-bell-ringing',
    iconBg: 'bg-blue-500/15',
    iconColor: 'text-blue-500 dark:text-blue-400',
    stripe: 'from-blue-500 to-cyan-500',
    ringColor: 'ring-blue-500/40',
  },
};

const getVisual = (n: LiveNotification): ToastVisual => {
  // Audit-driven notifications always render as system, regardless of stored type.
  if (n.referenceType === 'AuditLog') return VISUALS.system;
  return VISUALS[n.type] || VISUALS.info;
};

// Small role pill (Prof / TA / Admin / SA) shown under the sender avatar.
// Returns null for plain students or when the role isn't a staff role —
// students don't need a badge for "another student".
const STAFF_ROLE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  professor: { label: 'Prof', bg: 'bg-[#6A3FF4]', text: 'text-white' },
  ta: { label: 'TA', bg: 'bg-blue-500', text: 'text-white' },
  admin: { label: 'Admin', bg: 'bg-red-500', text: 'text-white' },
  sa: { label: 'SA', bg: 'bg-emerald-500', text: 'text-white' },
};

const RoleBadge: React.FC<{ role?: string | null }> = ({ role }) => {
  if (!role) return null;
  const cfg = STAFF_ROLE_LABELS[role];
  if (!cfg) return null;
  return (
    <span
      className={`absolute -bottom-1 -right-1 ${cfg.bg} ${cfg.text} text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white dark:border-[#1a1a1a] shadow-md leading-none`}
    >
      {cfg.label}
    </span>
  );
};

// Sender display name fallback: the hydrated `senderName` first, then the
// legacy `sender` string field for older payloads. Returns null for
// system/auto-generated notifications so the UI knows to show the type icon.
const resolveSenderLabel = (n: LiveNotification): string | null => {
  if (n.senderName && n.senderName.trim()) return n.senderName.trim();
  if (n.sender && n.sender.trim()) return n.sender.trim();
  return null;
};

// Avatar — either the sender's profile picture or a colored type-icon when
// no sender exists (e.g. system audit events, generic info reminders).
const ToastAvatar: React.FC<{ notification: LiveNotification; visual: ToastVisual }> = ({
  notification,
  visual,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const senderName = resolveSenderLabel(notification);
  const hasAvatar = Boolean(notification.senderAvatar) && !imgFailed;

  // Initials fallback when sender is known but no profile picture is set.
  const initials = senderName
    ? senderName
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : null;

  if (hasAvatar) {
    return (
      <div className="relative flex-shrink-0">
        <img
          src={notification.senderAvatar as string}
          alt={senderName || 'Sender'}
          onError={() => setImgFailed(true)}
          className={`w-12 h-12 rounded-full object-cover ring-2 ${visual.ringColor} ring-offset-2 ring-offset-white/0 dark:ring-offset-[#1a1a1a]/0`}
        />
        <RoleBadge role={notification.senderRole} />
      </div>
    );
  }

  // Sender known but no picture — show initials in a brand-tinted circle.
  if (initials) {
    return (
      <div className="relative flex-shrink-0">
        <div
          className={`w-12 h-12 rounded-full bg-gradient-to-br ${visual.stripe} text-white font-bold text-base flex items-center justify-center shadow-md ring-2 ${visual.ringColor} ring-offset-2 ring-offset-white/0 dark:ring-offset-[#1a1a1a]/0`}
        >
          {initials}
        </div>
        <RoleBadge role={notification.senderRole} />
      </div>
    );
  }

  // Pure system / auto event — type icon takes the avatar slot.
  return (
    <div
      className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${visual.iconBg} ${visual.iconColor} shadow-inner`}
    >
      <i className={`${visual.icon} text-2xl`} />
    </div>
  );
};

const Toast: React.FC<ToastProps> = ({ notification, onClose, onClick }) => {
  const visual = getVisual(notification);
  const senderLabel = resolveSenderLabel(notification);

  // Auto-close after 5 seconds.
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const handleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    onClick();
    onClose();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.92, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      onClick={handleClick}
      // Swipe-to-dismiss: drag the toast to the right; releasing past the
      // threshold (or with a fast flick) dismisses it. Snaps back otherwise.
      // A real drag suppresses the tap, so click-to-route still works.
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.04, right: 0.9 }}
      dragSnapToOrigin
      onDragEnd={(_e, info) => {
        if (info.offset.x > 90 || info.velocity.x > 500) onClose();
      }}
      // Full-width minus side margins on phones; capped at 22rem from sm up.
      className="relative w-[calc(100vw-1.5rem)] sm:w-[22rem] cursor-pointer group touch-pan-y"
    >
      {/* Outer glass card. Proper glass-morphism: low background opacity
          (40%) + strong backdrop blur + saturate so the toast reads as
          frosted glass on any background, plus a subtle inner highlight
          and outer drop shadow for depth. */}
      <div className="relative overflow-hidden rounded-2xl bg-white/40 dark:bg-white/[0.06] border border-white/50 dark:border-white/15 shadow-2xl shadow-black/20 dark:shadow-black/50 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/30 dark:ring-white/5">
        {/* Left accent stripe — the strongest type signal at a glance. */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${visual.stripe}`} />

        <div className="p-4 pl-5">
          <div className="flex items-start gap-3">
            <ToastAvatar notification={notification} visual={visual} />

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-black dark:text-white font-semibold text-sm leading-snug line-clamp-2 pr-2 flex-1">
                  {notification.title}
                </h4>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  aria-label="Dismiss"
                  className="flex-shrink-0 w-6 h-6 rounded-full bg-white/10 dark:bg-white/5 hover:bg-red-500/15 hover:text-red-500 dark:hover:text-red-400 text-gray-500 dark:text-gray-400 border border-white/20 dark:border-white/10 hover:border-red-500/30 transition-colors flex items-center justify-center"
                >
                  <i className="ph-bold ph-x text-[10px]" />
                </button>
              </div>

              {notification.content && (
                <p className="text-gray-600 dark:text-gray-400 text-xs mt-1 line-clamp-2 leading-relaxed">
                  {notification.content}
                </p>
              )}

              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                  {senderLabel ? (
                    <span className={`font-semibold truncate ${visual.iconColor}`}>
                      {senderLabel}
                    </span>
                  ) : (
                    <span className={`flex items-center gap-1 font-semibold ${visual.iconColor}`}>
                      <i className={`${visual.icon} text-sm`} />
                      <span className="capitalize">
                        {notification.referenceType === 'AuditLog'
                          ? 'System'
                          : notification.type}
                      </span>
                    </span>
                  )}
                  {notification.courseCode && (
                    <span className="text-gray-400 dark:text-gray-500 truncate">
                      · {notification.courseCode}
                    </span>
                  )}
                </div>

                {(notification.type === 'chat' ||
                  notification.type === 'announcement') && (
                  <span className="text-gray-400 dark:text-gray-500 text-[10px] flex items-center gap-1 flex-shrink-0">
                    Open <i className="ph-bold ph-arrow-right text-[10px]" />
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Progress bar countdown — same gradient as the type stripe. */}
        <motion.div
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: 5, ease: 'linear' }}
          className={`h-[3px] bg-gradient-to-r ${visual.stripe}`}
        />
      </div>
    </motion.div>
  );
};

const ToastContainer: React.FC = () => {
  const navigate = useNavigate();
  const { notifications, markAsRead } = useNotifications();
  const { userRole } = useAppContext();
  const roleSlug = ['student', 'professor', 'ta', 'sa', 'admin'].includes(userRole)
    ? userRole
    : 'student';
  const [visibleToasts, setVisibleToasts] = useState<LiveNotification[]>([]);
  const [shownIds, setShownIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const newNotifs = notifications.filter((n) => !shownIds.has(n.id) && !n.isRead);

    if (newNotifs.length > 0) {
      // Cap at 3 simultaneous toasts to avoid stacking when a burst fires.
      const toShow = newNotifs.slice(0, 3);
      setVisibleToasts((prev) => [...toShow, ...prev].slice(0, 3));

      setShownIds((prev) => {
        const newSet = new Set(prev);
        toShow.forEach((n) => newSet.add(n.id));
        return newSet;
      });
    }
  }, [notifications, shownIds]);

  const removeToast = (id: string) => {
    setVisibleToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleToastClick = (notification: LiveNotification) => {
    markAsRead(notification.id);

    if (notification.type === 'chat' && notification.courseCode) {
      const courseCode = notification.courseCode.split('-')[0];
      navigate(`/${roleSlug}/chatroom/${courseCode}`);
    } else if (notification.type === 'announcement') {
      navigate(`/${roleSlug}/announcements`);
    } else if (notification.referenceType === 'AttendanceExcuse') {
      // SA + admin land in the review queue; everyone else (incl. the
      // student receiving the approve/reject result) goes to their
      // attendance page where their excuse history lives.
      if (roleSlug === 'sa' || roleSlug === 'admin') {
        navigate('/sa/attendance-excuses');
      } else {
        navigate(`/${roleSlug}/attendance`);
      }
    } else {
      navigate(`/${roleSlug}/notifications`);
    }
  };

  // Top offset has two special cases:
  //   - Electron: the frameless title bar (z-[400], solid #0a0710) spans the
  //     top 32px; top-4 (16px) would render the toast BENEATH it. Push below
  //     the title-bar zone (top-12 = 48px).
  //   - Web / iOS PWA: on notched devices (iPhone 14 Pro Dynamic Island) a
  //     plain top-4 lands the toast UNDER the notch/status bar where it can't
  //     be seen or tapped. Add env(safe-area-inset-top) so it clears the notch.
  const topOffsetClass = isElectronApp()
    ? 'top-12'
    : 'top-[calc(0.5rem+env(safe-area-inset-top,0px))]';
  return (
    <div className={`fixed ${topOffsetClass} right-[calc(0.5rem+env(safe-area-inset-right,0px))] z-[200] flex flex-col gap-3`}>
      <AnimatePresence>
        {visibleToasts.map((toast) => (
          <Toast
            key={toast.id}
            notification={toast}
            onClose={() => removeToast(toast.id)}
            onClick={() => handleToastClick(toast)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
