/**
 * CourseSettingsPage — Plan 6 Phase 3 merger (extended).
 *
 * Course-level system settings under one sidebar entry:
 *
 *   • Code Pattern & Defaults    (was /admin/academic/course-configurations)
 *   • Grading Scale              (was /admin/academic/grading-rules)
 *   • Credit Hour Definition     (was /admin/academic/credit-hour-definition)
 *
 * All three describe how the system interprets/validates a course
 * record, so they belong in one place.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import CourseConfigurations from './CourseConfigurations';
import GradingRules from './GradingRules';
import CreditHourDefinition from './CreditHourDefinition';
import { useT } from '../../../i18n';

const CourseSettingsPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.courseSettingsTitle')}
    subtitle={t('admin.courseSettingsSubtitle')}
    icon="ph-gear-six"
    tabs={[
      {
        id: 'config',
        label: 'Code Pattern',
        icon: 'ph-sliders-horizontal',
        render: () => <CourseConfigurations />,
      },
      {
        id: 'grading',
        label: 'Grading Scale',
        icon: 'ph-list-numbers',
        render: () => <GradingRules />,
      },
      {
        id: 'credit-hours',
        label: 'Credit Hours',
        icon: 'ph-clock-counter-clockwise',
        render: () => <CreditHourDefinition />,
      },
    ]}
  />
  );
};

export default CourseSettingsPage;
