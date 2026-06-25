// frontend/src/pages/admin/AccessControlPage.tsx
//
// Top-level admin page for managing per-user permission overrides. Thin
// wrapper around PermissionOverridesPanel so the admin can search for any
// user (any role) and grant/deny categories without having to navigate
// through Settings → Roles & Permissions → Overrides.
//
// Route: /admin/access-control (registered in App.tsx).
// Sidebar entry: navigationData.ts → adminCategories → System & Audit.
//
// Gating: the route is wrapped in <RequirePermission category="Per-User
// Permissions" action="write"> in App.tsx — same gate the sidebar entry
// uses so the two are consistent. An admin who has Per-User Permissions
// write granted in the matrix sees both the sidebar entry AND can open
// the page; revoking it hides both.

import { FC } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import PermissionOverridesPanel from './PermissionOverridesPanel';
import { useT } from '../../i18n';

const AccessControlPage: FC = () => {
  const t = useT();
  return (
    <div className="pb-16 space-y-6 px-2 sm:px-0">
      <AnimateOnView enabled={false}>
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white flex items-center gap-3">
            <i className="ph-bold ph-shield-check text-[#6A3FF4]"></i>
            {t('admin.accessControlPageTitle')}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 max-w-3xl">
            {t('admin.accessControlPageSubtitle')}
          </p>
        </div>
      </AnimateOnView>

      <PermissionOverridesPanel hideHeader />
    </div>
  );
};

export default AccessControlPage;
