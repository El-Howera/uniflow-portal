/**
 * GradePoliciesPage — Plan 6 extension.
 *
 * Both tabs govern HOW grades are recorded / re-taken:
 *
 *   • Incomplete Grade Policy   (was /admin/academic/incomplete-policy)
 *   • Repetition Policy         (was /admin/academic/repetition-policy)
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import IncompletePolicy from './IncompletePolicy';
import RepetitionPolicy from './RepetitionPolicy';
import { useT } from '../../../i18n';

const GradePoliciesPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.gradePoliciesTitle')}
    subtitle={t('admin.gradePoliciesSubtitle')}
    icon="ph-list-bullets"
    tabs={[
      {
        id: 'incomplete',
        label: 'Incomplete Grades',
        icon: 'ph-hourglass-medium',
        render: () => <IncompletePolicy />,
      },
      {
        id: 'repetition',
        label: 'Course Repetition',
        icon: 'ph-arrows-counter-clockwise',
        render: () => <RepetitionPolicy />,
      },
    ]}
  />
  );
};

export default GradePoliciesPage;
