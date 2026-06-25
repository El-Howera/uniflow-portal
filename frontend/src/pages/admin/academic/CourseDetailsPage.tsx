/**
 * CourseDetailsPage — Plan 6 Phase 5 merger.
 *
 * Per-course editing tabs:
 *
 *   • Course Rules    (was /admin/academic/course-rules)
 *   • Prerequisites   (was /admin/academic/prerequisites)
 *
 * Both pages share the same two-pane shape (course picker on the left,
 * editor on the right). Putting them in one wrapper means the prof
 * doesn't have to pick the course twice; instead they switch tabs while
 * the picker state is preserved per-tab.
 */

import React from 'react';
import MergedTabs from './_MergedTabs';
import CourseRules from './CourseRules';
import Prerequisites from './Prerequisites';
import { useT } from '../../../i18n';

const CourseDetailsPage: React.FC = () => {
  const t = useT();
  return (
  <MergedTabs
    title={t('admin.courseDetailsTitle')}
    subtitle={t('admin.courseDetailsSubtitle')}
    icon="ph-list-checks"
    tabs={[
      {
        id: 'rules',
        label: 'Course Rules',
        icon: 'ph-shield-check',
        render: () => <CourseRules />,
      },
      {
        id: 'prereqs',
        label: 'Prerequisites',
        icon: 'ph-tree-structure',
        render: () => <Prerequisites />,
      },
    ]}
  />
  );
};

export default CourseDetailsPage;
