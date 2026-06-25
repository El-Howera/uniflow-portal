/**
 * RecentActivityCard — shared between the Professor and TA dashboards.
 *
 * Backed entirely by real submission events (no mock fallback). Each row is
 * clickable and routes to the role-scoped grading page, with the courseCode
 * passed as a query param so the grading page can preselect the course.
 *
 * If an item arrives without an `icon` (older payloads, future event types),
 * the icon slot falls back to a small filled dot — never an empty box.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ParticleCard } from './MagicBento';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

export interface ActivityItem {
  id: number | string;
  icon?: string | null;
  text: string;
  time: string;
  type: string;
  /** Optional course code so the click target can deep-link the grading page. */
  courseCode?: string | null;
}

interface Props {
  items: ActivityItem[];
  isLoading: boolean;
  /** Drives all role-scoped routes (`/professor/...` vs `/ta/...`). */
  roleSlug: 'professor' | 'ta';
}

const getActivityColor = (type: string) => {
  switch (type) {
    case 'submission':
      return 'bg-orange-500/20 text-orange-500';
    case 'message':
      return 'bg-[#6A3FF4]/20 text-[#6A3FF4]';
    case 'attendance':
      return 'bg-green-500/20 text-green-500';
    case 'quiz':
      return 'bg-blue-500/20 text-blue-500';
    case 'enrollment':
      return 'bg-cyan-500/20 text-cyan-500';
    case 'session':
      return 'bg-pink-500/20 text-pink-500';
    default:
      return 'bg-gray-500/20 text-gray-500';
  }
};

// Pick the best route for an activity row. Submission/grade events drop
// the user on the role's grading page (preselecting the course when we
// have one); everything else lands on the inbox.
const routeFor = (item: ActivityItem, roleSlug: 'professor' | 'ta'): string => {
  if (item.type === 'submission' || item.type === 'attendance') {
    const base = `/${roleSlug}/grading`;
    return item.courseCode
      ? `${base}?course=${encodeURIComponent(item.courseCode)}`
      : base;
  }
  if (item.type === 'session') return `/${roleSlug}/live-sessions`;
  if (item.type === 'message') return `/${roleSlug}/notifications`;
  return `/${roleSlug}/notifications`;
};

const RecentActivityCard: React.FC<Props> = ({ items, isLoading, roleSlug }) => {
  const navigate = useNavigate();

  return (
    <ParticleCard
      className={`${glassCardStyle} p-6 h-full flex flex-col`}
      enableTilt={false}
      enableMagnetism={false}
      clickEffect
      particleCount={10}
      glowColor="132, 0, 255"
    >
      <h3 className="text-black dark:text-white text-lg font-bold mb-4 flex items-center">
        <i className="ph-bold ph-clock-counter-clockwise mr-2 text-[#6A3FF4]"></i>
        Recent Activity
      </h3>

      <div className="space-y-3 flex-1">
        {isLoading ? (
          [1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-16 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"
            ></div>
          ))
        ) : items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 italic py-6">
            <i className="ph-bold ph-tray text-3xl mb-2"></i>
            No activity yet.
          </div>
        ) : (
          items.map((item) => {
            const colorClass = getActivityColor(item.type);
            const target = routeFor(item, roleSlug);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(target)}
                className="w-full text-left flex items-start gap-3 p-3 bg-white/5 dark:bg-black/10 rounded-xl border border-white/10 dark:border-white/5 hover:border-[#6A3FF4]/40 hover:bg-white/10 dark:hover:bg-black/20 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]/40"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}
                >
                  {item.icon ? (
                    <i className={`ph-fill ${item.icon} text-lg`}></i>
                  ) : (
                    // Fallback dot for events that arrive without an icon
                    // — keeps the slot non-empty.
                    <i className="ph-fill ph-circle text-[8px]"></i>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-black dark:text-white text-sm font-medium line-clamp-1">
                    {item.text}
                  </p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 flex items-center gap-1.5">
                    <span>{item.time}</span>
                    {item.courseCode && (
                      <span className="text-[#7B5AFF] font-semibold">
                        · {item.courseCode}
                      </span>
                    )}
                  </p>
                </div>
                <i className="ph-bold ph-arrow-right text-gray-400 text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity"></i>
              </button>
            );
          })
        )}
      </div>

      <button
        onClick={() => navigate(`/${roleSlug}/notifications`)}
        className="mt-4 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-90 text-white font-bold py-2.5 rounded-xl transition-opacity shadow-lg shadow-purple-500/20 text-xs"
      >
        View All Activity
      </button>
    </ParticleCard>
  );
};

export default RecentActivityCard;
