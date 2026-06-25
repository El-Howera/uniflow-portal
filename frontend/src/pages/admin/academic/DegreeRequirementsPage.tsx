/**
 * DegreeRequirementsPage — Plan 6 Phase 4 merger.
 *
 * All four tabs gate a student's progression toward the degree:
 *
 *   • Level Thresholds   (was /admin/academic/level-progression)
 *   • Attendance         (was /admin/academic/levels-attendance)
 *   • Graduation         (was /admin/academic/graduation-policy)
 *   • Credit Limits      (was /admin/academic/credit-limits)
 *
 * Tab order follows the student journey: passing levels → meeting the
 * attendance floor → graduating → per-semester credit caps.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import LevelProgression from './LevelProgression';
import LevelsAndAttendance from './LevelsAndAttendance';
import GraduationPolicy from './GraduationPolicy';
import CreditLimitPolicy from './CreditLimitPolicy';
import { useT } from '../../../i18n';

const DegreeRequirementsPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.degreeRequirementsTitle')}
    subtitle={t('admin.degreeRequirementsSubtitle')}
    icon="ph-graduation-cap"
    tabs={[
      {
        id: 'levels',
        label: 'Level Thresholds',
        icon: 'ph-stairs',
        render: () => <LevelProgression />,
      },
      {
        id: 'attendance',
        label: 'Attendance',
        icon: 'ph-chart-bar-horizontal',
        render: () => <LevelsAndAttendance />,
      },
      {
        id: 'graduation',
        label: 'Graduation',
        icon: 'ph-trophy',
        render: () => <GraduationPolicy />,
      },
      {
        id: 'credits',
        label: 'Credit Limits',
        icon: 'ph-coin',
        render: () => <CreditLimitPolicy />,
      },
    ]}
  />
  );
};

export default DegreeRequirementsPage;
