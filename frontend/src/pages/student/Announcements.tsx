import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion } from 'framer-motion';
import { fetchAnnouncements, Announcement } from '../../utils/studentAffairsService';
import { API_URLS } from '@shared/config';
import { useNotifications } from '../../context/NotificationContext';
import { renderMarkdown } from '../../components/MarkdownToolbar';
import { useT } from '../../i18n';
// Note: Announcements page is read-only for ALL roles (student/prof/ta/sa/admin).
// The composer lives on the dedicated Manage Announcements page mounted at
// `<role>/announcements/manage`, gated by the `Announcements: write` permission.

// Banner images uploaded via the SA/admin compose flow are saved on the
// persistent volume and served by nginx at the root level (path: `/uploads/announcements/<file>`).
// Resolve to a fully-qualified URL using the root origin, not the service API.
const resolveImageUrl = (raw?: string | null): string | undefined => {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  // `/uploads/*` paths are served:
  //  - DEV: by the affairs server's express.static (origin: localhost:4006)
  //  - Fly: by nginx directly via `alias /app/uploads/` (origin: uniflow.fly.dev)
  //  - Electron / Capacitor: by Fly nginx via REACT_APP_DESKTOP_API_BASE / etc.
  // In every case we want the API base's scheme://host:port WITHOUT the
  // service path-prefix (Fly's nginx routes `/uploads/` directly, not via
  // `/affairs/uploads/`). `new URL(...).origin` extracts exactly that.
  // Critical for Electron — window.location.origin is `file://` there.
  const base = API_URLS.studentAffairs();
  if (raw.startsWith('/uploads/')) {
    try {
      const baseOrigin = new URL(base).origin;
      return `${baseOrigin}${raw}`;
    } catch {
      // Fallback — should never hit (API base is always a valid URL).
      return `${base}${raw}`;
    }
  }
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
};

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

interface AnnouncementItem {
  id: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  imageAlt?: string;
  content: string;
  fullContent?: string;
  date: string;
  author?: string;
  readTime?: string;
  tag: {
    text: string;
    colorClass: string;
  };
}

// Map backend category to tag display
const categoryToTag = (category: string): { text: string; colorClass: string } => {
  switch (category) {
    case 'events': return { text: 'Events', colorClass: 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30' };
    case 'academic': return { text: 'Academic', colorClass: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30' };
    case 'financial': return { text: 'Financial', colorClass: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30' };
    case 'health': return { text: 'Health', colorClass: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30' };
    default: return { text: 'General', colorClass: 'bg-gray-500/20 text-gray-600 dark:text-gray-400 border-gray-500/30' };
  }
};

// Convert backend Announcement to page AnnouncementItem
const mapToItem = (a: Announcement): AnnouncementItem => ({
  id: a.id,
  title: a.title,
  subtitle: a.subtitle,
  imageUrl: a.imageUrl,
  imageAlt: a.title,
  content: a.content,
  fullContent: a.fullContent,
  date: new Date(a.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  author: a.author,
  readTime: a.readTime,
  tag: categoryToTag(a.category),
});


// Announcement Card Component (List View)
const AnnouncementCard: React.FC<{
  announcement: AnnouncementItem;
  onReadMore: (announcement: AnnouncementItem) => void;
}> = ({ announcement, onReadMore }) => {
  const t = useT();
  return (
    <div className={`${glassCardStyle} p-4 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6`}>
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-black dark:text-white mb-2 break-words">{announcement.title}</h2>
        <p className="text-gray-600 dark:text-gray-400 text-sm">{announcement.subtitle}</p>
      </div>

      {announcement.imageUrl && (
        <img
          src={resolveImageUrl(announcement.imageUrl)}
          loading="lazy"
          alt={announcement.imageAlt}
          className="w-full h-44 sm:h-56 md:h-64 rounded-xl object-cover border border-gray-300/50 dark:border-[#363636]"
        />
      )}
      
      <div className="relative text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed">
        {renderMarkdown(announcement.content)}
      </div>
      
      <div className="border-t border-gray-300/50 dark:border-[#363636] pt-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 text-sm">
            <i className="ph-bold ph-calendar-blank"></i>
            <span>{announcement.date}</span>
          </div>
          {announcement.readTime && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 text-sm">
              <i className="ph-bold ph-clock"></i>
              <span>{announcement.readTime}</span>
            </div>
          )}
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${announcement.tag.colorClass}`}>
            {announcement.tag.text}
          </span>
        </div>
        
        <button 
          onClick={() => onReadMore(announcement)}
          className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors border
            text-black dark:text-white bg-white/50 dark:bg-[#0d0d0d] hover:bg-gray-300/50 dark:hover:bg-[#2d2d2d] border-gray-300/50 dark:border-[#363636]"
        >
          <span>{t('announcementsPage.readMore')}</span>
          <i className="ph-bold ph-arrow-right"></i>
        </button>
      </div>
    </div>
  );
};

// Blog View Component (Full Article)
const AnnouncementBlogView: React.FC<{
  announcement: AnnouncementItem;
  onBack: () => void;
}> = ({ announcement, onBack }) => {
  const t = useT();
  // Brief check-mark feedback on the "Copy link" button so the host knows
  // the clipboard write actually happened.
  const [linkCopied, setLinkCopied] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="pb-16 space-y-6"
    >
      {/* Back Button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-[#6A3FF4] dark:hover:text-[#6A3FF4] transition-colors group"
      >
        <i className="ph-bold ph-arrow-left text-xl group-hover:-translate-x-1 transition-transform"></i>
        <span className="font-medium">{t('common.back')}</span>
      </button>

      {/* Article Header */}
      <div className={`${glassCardStyle} p-4 sm:p-6 md:p-8`}>
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${announcement.tag.colorClass}`}>
            {announcement.tag.text}
          </span>
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 text-sm">
            <i className="ph-bold ph-calendar-blank"></i>
            <span>{announcement.date}</span>
          </div>
          {announcement.readTime && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-500 text-sm">
              <i className="ph-bold ph-clock"></i>
              <span>{announcement.readTime}</span>
            </div>
          )}
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-black dark:text-white mb-4 break-words">
          {announcement.title}
        </h1>

        <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 mb-6">
          {announcement.subtitle}
        </p>

        {announcement.author && (
          <div className="flex items-center gap-3 pt-4 border-t border-gray-300/50 dark:border-[#363636]">
            <div className="w-10 h-10 rounded-full bg-[#6A3FF4]/20 flex items-center justify-center">
              <i className="ph-bold ph-user text-[#6A3FF4]"></i>
            </div>
            <div>
              <p className="font-medium text-black dark:text-white text-sm">{announcement.author}</p>
              <p className="text-gray-500 text-xs">Published on {announcement.date}</p>
            </div>
          </div>
        )}
      </div>

      {/* Featured Image */}
      {announcement.imageUrl && (
        <img
          src={resolveImageUrl(announcement.imageUrl)}
          loading="lazy"
          alt={announcement.imageAlt}
          className="w-full h-56 sm:h-80 md:h-96 rounded-2xl object-cover border border-white/20 dark:border-white/10 shadow-lg"
        />
      )}

      {/* Article Content
          IMPORTANT: no `prose` / `prose-lg` class. Tailwind Typography
          re-applies list-disc + padding + margin to every <ul>/<li>
          inside its scope which fights with my custom bullet renderer
          (purple Phosphor dot, list-none, flex layout). Drop prose and
          let renderMarkdown's inline classes own the styling. */}
      <div className={`${glassCardStyle} p-4 sm:p-6 md:p-8`}>
        <article className="max-w-none text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed">
          {renderMarkdown(announcement.fullContent || announcement.content)}
        </article>
      </div>

      {/* Share & Actions — both buttons were previously decorative (no
          onClick). Wired now: Link copies a deep-link to the announcement,
          Envelope opens a pre-filled mailto with title + content. Tiny
          inline feedback (the link button briefly flips to a check) so
          the host knows the copy went through. */}
      <div className={`${glassCardStyle} p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-center gap-4`}>
        <div className="flex items-center gap-3">
          <span className="text-gray-600 dark:text-gray-400 text-sm">{t('announcementsPage.posted')}:</span>
          <button
            type="button"
            onClick={async () => {
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('announcement', String(announcement.id));
                await navigator.clipboard.writeText(url.toString());
                setLinkCopied(true);
                window.setTimeout(() => setLinkCopied(false), 1800);
              } catch {
                // Older browsers / file:// protocol — fall back to a prompt.
                const url = new URL(window.location.href);
                url.searchParams.set('announcement', String(announcement.id));
                window.prompt(t('announcementsPage.copyLinkPrompt') || 'Copy link', url.toString());
              }
            }}
            title={t('announcementsPage.copyLink') || 'Copy link'}
            aria-label={t('announcementsPage.copyLink') || 'Copy link'}
            className="w-9 h-9 rounded-full bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
          >
            <i className={`ph-bold ${linkCopied ? 'ph-check text-emerald-500' : 'ph-link'} text-sm`}></i>
          </button>
          <button
            type="button"
            onClick={() => {
              const subject = encodeURIComponent(announcement.title || 'Announcement');
              const url = new URL(window.location.href);
              url.searchParams.set('announcement', String(announcement.id));
              const body = encodeURIComponent(
                `${announcement.content || ''}\n\n— ${url.toString()}`,
              );
              window.location.href = `mailto:?subject=${subject}&body=${body}`;
            }}
            title={t('announcementsPage.shareEmail') || 'Share via email'}
            aria-label={t('announcementsPage.shareEmail') || 'Share via email'}
            className="w-9 h-9 rounded-full bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] flex items-center justify-center hover:bg-[#6A3FF4] hover:text-white hover:border-[#6A3FF4] transition-all"
          >
            <i className="ph-bold ph-envelope text-sm"></i>
          </button>
        </div>

        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors
            bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white hover:opacity-90"
        >
          <i className="ph-bold ph-arrow-left"></i>
          <span>{t('common.back')}</span>
        </button>
      </div>
    </motion.div>
  );
};

const Announcements: React.FC = () => {
  const { searchTerm } = useAppContext();
  const { notifications } = useNotifications();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<AnnouncementItem | null>(null);
  const [announcementsData, setAnnouncementsData] = useState<AnnouncementItem[]>([]);

  // Refetch the announcement list. Memoised so the auto-refresh hooks below
  // can share the same function without re-binding every render.
  const load = useCallback(async () => {
    try {
      const data = await fetchAnnouncements({ limit: 20 });
      if (data.announcements) {
        setAnnouncementsData(data.announcements.map(mapToItem));
      }
    } catch {
      setAnnouncementsData([]);
    }
  }, []);

  // Initial load on mount.
  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh policy:
  //   1. Refetch when the tab regains focus (covers users coming back from
  //      another tab or window).
  //   2. Poll every 30 seconds while the tab is visible — cheap enough at
  //      this cadence and removes the "I have to refresh" feeling.
  //   3. Refetch immediately whenever a new announcement-type notification
  //      arrives over Socket.io (NotificationContext) — that's the real-time
  //      trigger when SA/admin publishes while the student is on the page.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [load]);

  // Socket.io fan-out fires `new_notification` events; when any of them is
  // an announcement-type, refetch the list so the new card appears without
  // a manual refresh.
  useEffect(() => {
    const latest = notifications[0];
    if (!latest) return;
    if (latest.type === 'announcement') {
      load();
    }
  }, [notifications, load]);

  // Deep-link support: when the user clicks "Open Announcement" on a
  // notification, we navigate here with `?id=<announcementId>`. After the
  // list has loaded, find that row and open it in the blog view.
  useEffect(() => {
    const wantedId = searchParams.get('id');
    if (!wantedId || announcementsData.length === 0) return;
    const target = announcementsData.find((a) => a.id === wantedId);
    if (target) {
      setSelectedAnnouncement(target);
      // Strip the query param so a back-button → forward dance doesn't
      // re-open it after the user closes the blog view.
      const next = new URLSearchParams(searchParams);
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, announcementsData, setSearchParams]);

  const filteredAnnouncements = announcementsData.filter(ann =>
    ann.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ann.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ann.subtitle.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // If an announcement is selected, show the blog view
  if (selectedAnnouncement) {
    return (
      <AnnouncementBlogView
        announcement={selectedAnnouncement}
        onBack={() => setSelectedAnnouncement(null)}
      />
    );
  }

  return (
    <div className="pb-16 space-y-8">
      <AnimateOnView>
        <div className="flex justify-between items-end">
          <div>
            <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('announcementsPage.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t('announcementsPage.subtitle')}</p>
          </div>
        </div>
      </AnimateOnView>

      {/* Full width announcements */}
      <div className="flex flex-col gap-8">
        {filteredAnnouncements.map((ann, index) => (
          <AnimateOnView key={ann.id} delay={index * 0.1}>
            <AnnouncementCard
              announcement={ann}
              onReadMore={setSelectedAnnouncement}
            />
          </AnimateOnView>
        ))}
        {filteredAnnouncements.length === 0 && searchTerm && (
          <div className="text-center py-20 text-gray-500">
            <i className="ph-bold ph-megaphone-simple text-5xl mb-4 block opacity-50"></i>
            <p className="font-medium">{t('announcementsPage.noResults')}</p>
            <p className="text-sm mt-2">{t('coursesPage.tryDifferent')}</p>
          </div>
        )}
        {filteredAnnouncements.length === 0 && !searchTerm && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">{t('announcementsPage.noAnnouncements')}</p>
        )}
      </div>
    </div>
  );
};

export default Announcements;
