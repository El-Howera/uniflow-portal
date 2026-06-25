// src/pages/sa/SAAnnouncements.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion } from 'framer-motion';
import AnnouncementComposer from '../../components/AnnouncementComposer';
import { useHasPermission } from '../../utils/permissions';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

type UrgencyLevel = 'normal' | 'important' | 'critical';
type UrgencyFilter = 'all' | 'normal' | 'important' | 'critical';

type Ann = {
  id: string;
  title: string;
  content?: string;
  publishedAt?: string;
  createdAt?: string;
  status?: string;
  priority?: string;
  urgency?: string;
  imageUrl?: string | null;
  category?: string;
  targetUserIds?: string[];
  targetLevels?: number[];
  targetRoles?: string[];
};

function getUrgencyFromAnn(item: Ann): UrgencyLevel {
  if (item.urgency === 'critical' || item.priority === 'urgent') return 'critical';
  if (item.urgency === 'important' || item.priority === 'high') return 'important';
  return 'normal';
}

const urgencyBadge: Record<UrgencyLevel, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  important: { label: 'Important', className: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  normal: { label: 'Normal', className: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_ANNOUNCEMENTS: Ann[] = [
  { id: 'ann-1', title: 'Spring 2026 registration now open', content: 'Course registration for the Spring 2026 semester is open until February 1. Register through your dashboard.', publishedAt: new Date(Date.now() - 1 * 86400000).toISOString(), status: 'published', urgency: 'important', category: 'registration', targetRoles: ['student'] },
  { id: 'ann-2', title: 'Midterm exam schedule released', content: 'The midterm examination timetable is now available. Check your timetable for room assignments.', publishedAt: new Date(Date.now() - 3 * 86400000).toISOString(), status: 'published', urgency: 'normal', category: 'academic', targetLevels: [2, 3, 4] },
  { id: 'ann-3', title: 'Campus closure — public holiday', content: 'The campus will be closed on Thursday for the national holiday. All classes are suspended.', publishedAt: new Date(Date.now() - 5 * 86400000).toISOString(), status: 'published', urgency: 'critical', category: 'general', targetRoles: ['student', 'professor', 'ta'] },
  { id: 'ann-4', title: 'Library extended hours during finals', content: 'The library will remain open until midnight during the final exam period.', publishedAt: new Date(Date.now() - 8 * 86400000).toISOString(), status: 'published', urgency: 'normal', category: 'general', targetUserIds: ['stu-001', 'stu-002', 'stu-003'] },
  { id: 'ann-5', title: 'Tuition payment deadline reminder', content: 'Spring 2026 tuition is due February 1. Late payments incur a penalty fee.', publishedAt: new Date(Date.now() - 10 * 86400000).toISOString(), status: 'published', urgency: 'important', category: 'financial', targetRoles: ['student'] },
];

const SAAnnouncements: React.FC = () => {
  const t = useT();
  const [announcements, setAnnouncements] = useState<Ann[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const canDelete = useHasPermission('Announcements', 'delete');

  const load = useCallback(async () => {
    // MVP build: populate from static mock data, no backend.
    setIsLoading(true);
    setAnnouncements(MOCK_ANNOUNCEMENTS);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: string) => {
    // MVP build: optimistic local removal; no backend.
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  const filteredAnnouncements = announcements.filter((item) =>
    urgencyFilter === 'all' ? true : getUrgencyFromAnn(item) === urgencyFilter
  );

  const formatDate = (item: Ann) => {
    const raw = item.publishedAt || item.createdAt;
    if (!raw) return '';
    try {
      return new Date(raw).toLocaleDateString();
    } catch {
      return raw;
    }
  };

  const audienceLabel = (a: Ann): string => {
    if (a.targetUserIds && a.targetUserIds.length > 0) {
      return `${a.targetUserIds.length} student${a.targetUserIds.length === 1 ? '' : 's'}`;
    }
    if (a.targetLevels && a.targetLevels.length > 0) {
      return `Levels ${a.targetLevels.join(', ')}`;
    }
    if (a.targetRoles && a.targetRoles.length > 0) {
      return a.targetRoles.length === 1 ? `${a.targetRoles[0]}s` : `${a.targetRoles.length} roles`;
    }
    return 'All';
  };

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <AnimateOnView enabled={false}>
        <h1 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">
          {t('sa.announcementsTitle')}
        </h1>
        <p className="text-black dark:text-gray-300 text-sm">
          {t('sa.announcementsSubtitle')}
        </p>
      </AnimateOnView>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose — shared composer keeps admin + SA in lockstep. */}
        <div className="lg:col-span-2">
          <AnimateOnView enabled={false} delay={0.1}>
            <AnnouncementComposer onPublished={load} />
          </AnimateOnView>
        </div>

        {/* Recent list */}
        <div>
          <AnimateOnView enabled={false} delay={0.15}>
            <div className={`${glassCardStyle} p-6`}>
              <h2 className="text-black dark:text-white text-lg font-bold mb-3 flex items-center">
                <i className="ph-bold ph-newspaper mr-2 text-[#6A3FF4]"></i> {t('sa.recentAnnouncements')}
              </h2>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {(['all', 'normal', 'important', 'critical'] as UrgencyFilter[]).map((f) => {
                  const active = urgencyFilter === f;
                  const colorMap: Record<UrgencyFilter, string> = {
                    all: active ? 'bg-[#6A3FF4] text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10',
                    normal: active ? 'bg-gray-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10',
                    important: active
                      ? 'bg-orange-500 text-white'
                      : 'bg-white/5 text-orange-400 hover:bg-orange-500/10',
                    critical: active ? 'bg-red-500 text-white' : 'bg-white/5 text-red-400 hover:bg-red-500/10',
                  };
                  return (
                    <button
                      key={f}
                      onClick={() => setUrgencyFilter(f)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold capitalize transition-colors ${colorMap[f]}`}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>

              {isLoading ? (
                <div className="text-center py-6">
                  <i className="ph-duotone ph-spinner animate-spin text-2xl text-[#6A3FF4]"></i>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredAnnouncements.slice(0, 20).map((item, i) => {
                    const level = getUrgencyFromAnn(item);
                    const badge = urgencyBadge[level];
                    const preview = item.content
                      ? item.content.substring(0, 60) + (item.content.length > 60 ? '…' : '')
                      : '';
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/30 transition-all group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-black dark:text-white text-sm font-medium leading-snug flex-1 min-w-0">
                            {item.title}
                          </p>
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
                              title={t('sa.deleteAnnouncement')}
                            >
                              <i className="ph-bold ph-trash text-sm"></i>
                            </button>
                          )}
                        </div>
                        {item.imageUrl && (
                          <img
                            src={item.imageUrl}
                            alt=""
                            loading="lazy"
                            className="w-full h-24 object-cover rounded-lg mt-2"
                          />
                        )}
                        {preview && <p className="text-gray-500 text-xs mt-1 leading-relaxed">{preview}</p>}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {item.category && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-[#6A3FF4]/10 text-[#6A3FF4] dark:text-[#bda8ff] border-[#6A3FF4]/20 capitalize">
                              {item.category.replace('_', ' ')}
                            </span>
                          )}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
                            {badge.label}
                          </span>
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-white/5 text-gray-500 border-white/10">
                            <i className="ph-bold ph-users mr-1"></i>
                            {audienceLabel(item)}
                          </span>
                          <span className="text-gray-600 text-xs ml-auto">{formatDate(item)}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                  {filteredAnnouncements.length === 0 && (
                    <p className="text-gray-500 text-sm text-center py-4">
                      {urgencyFilter === 'all' ? t('sa.noAnnouncementsYet') : t('sa.noUrgencyAnnouncements', { urgency: urgencyFilter })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </AnimateOnView>
        </div>
      </div>
    </div>
  );
};

export default SAAnnouncements;
