/**
 * MergedTabs — Plan 6 Phase 2.1 / 3 / 4 / 5 / 7 helper.
 *
 * Several Academic Settings pages have been consolidated under a single
 * sidebar entry with tab switching INSIDE the page. This helper:
 *
 *   • Renders the tab pill bar (matches the design-system glass pill
 *     pattern used in admin Settings → Roles & Permissions).
 *   • Reads/writes the active tab id from `?tab=<id>` so a refresh or
 *     a deep link keeps the user on the same panel.
 *   • Renders the body of the active tab.
 *
 * The wrapper pages keep every existing standalone page intact — they
 * just import each old page's default export and render it inside the
 * matching tab. Nothing is deleted; only the navigation chrome merges.
 */

import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export interface MergedTab {
  /** URL-safe slug. Appears in the `?tab=<id>` query string. */
  id: string;
  /** Visible label on the pill button. */
  label: string;
  /** Optional Phosphor icon shown left of the label. */
  icon?: string;
  /** Tab body — usually the default export of one of the legacy pages. */
  render: () => React.ReactNode;
}

interface Props {
  /** Top-level title shown above the tab bar. */
  title: string;
  /** One-line subheading; renders in the muted text style. */
  subtitle?: string;
  /** Optional Phosphor icon for the page header. */
  icon?: string;
  /** Tab definitions in display order. The first id is the default. */
  tabs: MergedTab[];
}

const MergedTabs: React.FC<Props> = ({ title, subtitle, icon, tabs }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Read active tab from ?tab= query — falls back to the first tab.
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('tab');
  const valid = tabs.some((t) => t.id === requestedId);
  const activeId = valid && requestedId ? requestedId : tabs[0]?.id;

  // Keep the URL in sync if the tab param is missing or invalid — that
  // way refreshing always lands on a known tab without a flash.
  useEffect(() => {
    if (!tabs.length) return;
    if (requestedId === activeId) return;
    const next = new URLSearchParams(location.search);
    next.set('tab', activeId);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const setActive = (id: string) => {
    const next = new URLSearchParams(location.search);
    next.set('tab', id);
    navigate({ pathname: location.pathname, search: `?${next.toString()}` });
  };

  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <div className="space-y-5">
      {/* Page header — sidebar gives the category, this gives the page. */}
      <div className="flex items-start gap-3">
        {icon && (
          <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 flex items-center justify-center flex-shrink-0">
            <i className={`ph-bold ${icon} text-[#6A3FF4] text-xl`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-black dark:text-white">{title}</h1>
          {subtitle && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Tab pill bar — same glass-morphism pattern as Settings → Roles. */}
      <div className="flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 w-full overflow-x-auto shadow-lg scrollbar-hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`text-sm font-bold py-2 px-4 rounded-md transition-colors whitespace-nowrap flex items-center gap-2 flex-shrink-0 ${
              t.id === activeId
                ? 'bg-[#6A3FF4] text-white shadow-sm'
                : 'text-black/70 dark:text-gray-300 hover:text-black dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/5'
            }`}
          >
            {t.icon && <i className={`ph-bold ${t.icon}`} />}
            {t.label}
          </button>
        ))}
      </div>

      {/* Active tab body. */}
      <div>{active?.render()}</div>
    </div>
  );
};

export default MergedTabs;
