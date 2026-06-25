/**
 * CalendarPage — Plan 6 Phase 2.1 merger.
 *
 * Consolidates two existing top-level Academic Settings pages into one
 * page with tabs:
 *
 *   • Semester Durations (was /admin/academic/semester-calendar)
 *   • Holidays & Academic Year (was /admin/academic/calendar)
 *
 * Each tab body is the legacy page's default export rendered in-place
 * — no logic changes. Old routes redirect here so saved bookmarks
 * keep working.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import SemesterCalendar from './SemesterCalendar';
import AcademicCalendar from './AcademicCalendar';
import { useT } from '../../../i18n';

const CalendarPage: React.FC = () => {
  const t = useT();
  return (
    <MergedTabs
      title={t('admin.calendarPageTitle')}
      subtitle={t('admin.calendarPageSubtitle')}
      icon="ph-calendar"
      tabs={[
        {
          id: 'semester',
          label: 'Semester Durations',
          icon: 'ph-calendar-check',
          render: () => <SemesterCalendar />,
        },
        {
          id: 'holidays',
          label: 'Holidays & Year',
          icon: 'ph-calendar-blank',
          render: () => <AcademicCalendar />,
        },
      ]}
    />
  );
};

export default CalendarPage;
