// src/data/routeMeta.ts
//
// Plan 8 Phase 4/5 — per-route flags consumed by App.tsx's layout shell.
// Currently controls:
//   - `hideSearchBar`   — true on pages with no content list (chat, settings,
//                          chatbot) so the global search input doesn't
//                          appear in the header.
//   - `hideMobileNav`   — true on the chatroom (the bottom nav stacks awkwardly
//                          on top of the chat input).
//
// Pattern: each entry's key is matched as a prefix against the current
// pathname. `/student/chatroom/CS101` matches `/student/chatroom`. The
// most specific (longest) matching prefix wins, so a more granular flag
// for a sub-route can override a parent.

export interface RouteFlags {
  hideSearchBar?: boolean;
  hideMobileNav?: boolean;
}

// Note: each pattern is a PREFIX, matched against location.pathname.
//
// Plan 9 follow-up — the search bar is now rendered on dashboards AND
// chatrooms (per owner request: "no more search bar on all dashboard main
// pages and chatrooms"). The previous `hideSearchBar` flags on those
// surfaces have been removed so the global header input is always present
// across the role's main work surfaces. Search consumption is per-page
// (`AppContext.searchTerm`); pages with nothing to filter just ignore it.
//
// `hideMobileNav` on chatrooms + live-session rooms is preserved because
// the floating bottom bar would visually stack on top of the chat input /
// in-room controls.
const ROUTE_META: Array<{ pattern: string; flags: RouteFlags }> = [
  // Chatbot — full-bleed conversational surface, no list to search.
  { pattern: '/student/faq-chatbot', flags: { hideSearchBar: true } },

  // Chatrooms — bottom nav still hidden (would cover the chat input on
  // mobile); search bar is now allowed (filters group list / messages).
  { pattern: '/student/chatroom',   flags: { hideMobileNav: true } },
  { pattern: '/professor/chatroom', flags: { hideMobileNav: true } },
  { pattern: '/ta/chatroom',        flags: { hideMobileNav: true } },
  { pattern: '/admin/chatroom',     flags: { hideMobileNav: true } },

  // Live session room — its own header + control bar inside the room.
  // Bar AND search both hidden (no surface to search inside the call).
  { pattern: '/student/live-session',   flags: { hideSearchBar: true, hideMobileNav: true } },
  { pattern: '/professor/live-session', flags: { hideSearchBar: true, hideMobileNav: true } },
  { pattern: '/ta/live-session',        flags: { hideSearchBar: true, hideMobileNav: true } },

  // Settings / profile — form-driven editors, no list to filter.
  { pattern: '/student/settings',   flags: { hideSearchBar: true } },
  { pattern: '/professor/settings', flags: { hideSearchBar: true } },
  { pattern: '/ta/settings',        flags: { hideSearchBar: true } },
  { pattern: '/sa/settings',        flags: { hideSearchBar: true } },
  { pattern: '/admin/settings',     flags: { hideSearchBar: true } },
  { pattern: '/financial/settings', flags: { hideSearchBar: true } },
  { pattern: '/it/settings',        flags: { hideSearchBar: true } },

  { pattern: '/student/view-profile',   flags: { hideSearchBar: true } },
  { pattern: '/professor/view-profile', flags: { hideSearchBar: true } },
  { pattern: '/ta/view-profile',        flags: { hideSearchBar: true } },
  { pattern: '/sa/view-profile',        flags: { hideSearchBar: true } },
  { pattern: '/admin/view-profile',     flags: { hideSearchBar: true } },
  { pattern: '/financial/view-profile', flags: { hideSearchBar: true } },
  { pattern: '/it/view-profile',        flags: { hideSearchBar: true } },

  // Dashboards: search bar visible by default now (no entry needed).
];

/** Resolves the flags for a given pathname. Longest-matching prefix wins. */
export function resolveRouteFlags(pathname: string): RouteFlags {
  let best: { pattern: string; flags: RouteFlags } | null = null;
  for (const entry of ROUTE_META) {
    if (pathname.startsWith(entry.pattern)) {
      if (!best || entry.pattern.length > best.pattern.length) {
        best = entry;
      }
    }
  }
  return best?.flags ?? {};
}
