/**
 * AcademicStandingPage — Plan 6 extension.
 *
 * Both tabs deal with the student's STANDING relative to the program:
 *
 *   • Honors Policy        (was /admin/academic/honors-policy)
 *   • Suspension / Cancellation Policy (was /admin/academic/suspension-policy)
 *
 * Honors is the upside (dean's list eligibility), Suspension is the
 * downside (probation / cancellation caps). Together they bound the
 * standing classification axis.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import HonorsPolicy from './HonorsPolicy';
import SuspensionPolicy from './SuspensionPolicy';
import ProbationPolicy from './ProbationPolicy';
import { useT } from '../../../i18n';

const AcademicStandingPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.academicStandingTitle')}
    subtitle={t('admin.academicStandingSubtitle')}
    icon="ph-medal"
    tabs={[
      {
        id: 'probation',
        label: 'Probation & Dismissal',
        icon: 'ph-warning',
        render: () => <ProbationPolicy />,
      },
      {
        id: 'honors',
        label: 'Honors',
        icon: 'ph-medal',
        render: () => <HonorsPolicy />,
      },
      {
        id: 'suspension',
        label: 'Suspension & Cancellation',
        icon: 'ph-pause-circle',
        render: () => <SuspensionPolicy />,
      },
    ]}
  />
  );
};

export default AcademicStandingPage;
