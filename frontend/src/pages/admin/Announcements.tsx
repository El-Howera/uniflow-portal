// src/pages/admin/Announcements.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls. The admin
// dashboards (TA / SA / Admin / Financial / IT) run on static mock data
// in this build; load/delete are local-only state mutations.
import React, { useState } from 'react';
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

// ── Static mock data — realistic, fully populated recent announcements ──
const MOCK_ANNOUNCEMENTS: Ann[] = [
  {
    id: 'ann-1',
    title: 'Spring 2026 Final Exam Schedule Published',
    content:
      'The final examination timetable for the Spring 2026 semester is now available on the student portal. Please review your exam dates and report any conflicts to the Examinations Office before May 10.',
    publishedAt: '2026-04-28T09:15:00.000Z',
    status: 'Published',
    urgency: 'critical',
    category: 'examinations',
    targetRoles: ['student'],
  },
  {
    id: 'ann-2',
    title: 'مواعيد التسجيل لفصل الخريف 2026',
    content:
      'يبدأ التسجيل المبكر لمقررات فصل الخريف 2026 يوم الأحد الموافق 4 مايو. يُرجى مراجعة المرشد الأكاديمي قبل اختيار المقررات.',
    publishedAt: '2026-04-27T11:00:00.000Z',
    status: 'Published',
    urgency: 'important',
    category: 'registration',
    targetLevels: [2, 3],
  },
  {
    id: 'ann-3',
    title: 'Library Extended Hours During Exam Period',
    content:
      'The Central Library will remain open 24/7 from May 5 to May 25 to support students during the examination period. Quiet study zones are available on floors 3 and 4.',
    publishedAt: '2026-04-25T14:30:00.000Z',
    status: 'Published',
    urgency: 'normal',
    category: 'campus_life',
    targetRoles: ['student', 'professor', 'ta'],
  },
  {
    id: 'ann-4',
    title: 'Faculty Council Meeting — May 6',
    content:
      'All teaching staff are invited to the monthly Faculty Council meeting on Tuesday, May 6 at 1:00 PM in Hall A-204. Agenda includes curriculum review and the new attendance policy.',
    publishedAt: '2026-04-24T08:00:00.000Z',
    status: 'Published',
    urgency: 'important',
    category: 'staff',
    targetRoles: ['professor', 'ta'],
  },
  {
    id: 'ann-5',
    title: 'Tuition Payment Deadline Reminder',
    content:
      'A friendly reminder that the second installment of tuition fees is due by April 30. Students with outstanding balances after this date may be temporarily blocked from registration.',
    publishedAt: '2026-04-22T10:45:00.000Z',
    status: 'Published',
    urgency: 'critical',
    category: 'finance',
    targetUserIds: ['stu-1182', 'stu-1190', 'stu-1204'],
  },
  {
    id: 'ann-6',
    title: 'Career Fair 2026 — Register Now',
    content:
      'The annual Career Fair will be held on May 12 in the main auditorium. Over 40 companies will be present. Bring printed copies of your CV and dress professionally.',
    publishedAt: '2026-04-20T13:20:00.000Z',
    status: 'Published',
    urgency: 'normal',
    category: 'events',
    targetLevels: [3, 4],
  },
];

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

// Plan 5 — `allowedRecipientModes` lets non-admin roles (granted
// `Announcements: write` via per-user override) reuse this same composer
// page from their own /<role>/announcements/manage route while being
// restricted to specific-students / specific-levels (no all-users blast).
// Admins use the full picker by default.
type RecipientMode = 'all-students' | 'specific-levels' | 'specific-users' | 'all-users';
interface AnnouncementsPageProps {
  allowedRecipientModes?: RecipientMode[];
}

const AnnouncementsPage: React.FC<AnnouncementsPageProps> = ({ allowedRecipientModes }) => {
  const t = useT();
  const [announcements, setAnnouncements] = useState<Ann[]>(MOCK_ANNOUNCEMENTS);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const canDelete = useHasPermission('Announcements', 'delete');

  // Local-only delete — drop the row from the visible list. No backend.
  const handleDelete = (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  // Local-only publish callback — prepend a mock row so the new
  // announcement appears instantly in the recent list.
  const handlePublished = () => {
    setAnnouncements((prev) => [
      {
        id: `ann-${Date.now()}`,
        title: 'New Announcement',
        content: 'Your announcement has been published to the selected recipients.',
        publishedAt: new Date().toISOString(),
        status: 'Published',
        urgency: 'normal',
        category: 'general',
        targetRoles: ['student'],
      },
      ...prev,
    ]);
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

  // Build a short subtitle showing how the announcement is targeted, so the
  // admin can verify their targeting choices in the recent list.
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
          {t('admin.announcementsTitle')}
        </h1>
        <p className="text-black dark:text-gray-300 text-sm">
          Compose and manage announcements and scheduled notifications.
        </p>
      </AnimateOnView>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compose */}
        <div className="lg:col-span-2">
          <AnimateOnView enabled={false} delay={0.1}>
            <AnnouncementComposer onPublished={handlePublished} allowedRecipientModes={allowedRecipientModes} />
          </AnimateOnView>
        </div>

        {/* Recent list */}
        <div>
          <AnimateOnView enabled={false} delay={0.15}>
            <div className={`${glassCardStyle} p-6`}>
              <h2 className="text-black dark:text-white text-lg font-bold mb-3 flex items-center">
                <i className="ph-bold ph-newspaper mr-2 text-[#6A3FF4]"></i> {t('admin.recentAnnouncements')}
              </h2>

              {/* Urgency filter chips */}
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
                            title={t('admin.annDeleteAnnouncement')}
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
                    {urgencyFilter === 'all' ? 'No announcements yet.' : `No ${urgencyFilter} announcements.`}
                  </p>
                )}
              </div>
            </div>
          </AnimateOnView>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementsPage;
