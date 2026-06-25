/**
 * StudentMobilityPage — Plan 6 extension.
 *
 * Both tabs concern how students move between programs or with academic
 * support:
 *
 *   • Mobility / Exchange Policy  (was /admin/academic/mobility-policy)
 *   • Advisor Policy              (was /admin/academic/advisor-policy)
 *
 * Mobility limits external credits; advisor policy gates registration on
 * advisor approval. Both shape the student's path through the program.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import MobilityPolicy from './MobilityPolicy';
import AdvisorPolicy from './AdvisorPolicy';
import { useT } from '../../../i18n';

const StudentMobilityPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.studentMobilityTitle')}
    subtitle={t('admin.studentMobilitySubtitle')}
    icon="ph-airplane-tilt"
    tabs={[
      {
        id: 'mobility',
        label: 'Mobility & Exchange',
        icon: 'ph-globe-hemisphere-east',
        render: () => <MobilityPolicy />,
      },
      {
        id: 'advisor',
        label: 'Advisor Approval',
        icon: 'ph-user-focus',
        render: () => <AdvisorPolicy />,
      },
    ]}
  />
  );
};

export default StudentMobilityPage;
