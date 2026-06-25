// src/data/navigationData.ts
import { DynamicCategory, DynamicCategoryItem } from '../types';

/* ---------------- STUDENT ----------------
 * Every tab carries a `requires` so toggling the matching category in
 * Roles & Permissions immediately hides the tab. Untagged entries are
 * intentionally permission-free (Dashboard — every role needs their own;
 * FAQ ChatBot — universal across all roles per design).
 *
 * Category mapping:
 *   Courses / Timetable             → Course Catalog:read
 *   Registrations                   → Registration:read
 *   Assignments / Quizzes / Forms /
 *     Online Lectures               → Materials:read
 *   Attendance                      → Attendance:read (surface extended)
 *   GPA Calculator                  → Grades:read
 *   Payments / Financial Aid        → Payments:read
 *   Student Affairs                 → Complaints:read (surface extended)
 *   Announcements                   → Announcements:read
 *   Manage Announcements            → Announcements:write
 */
export const studentCategories: DynamicCategory[] = [
  {
    title: "Academic",
    icon: "ph-book-open",
    items: [
      { label: 'Dashboard', icon: 'ph-squares-four', path: '/student/dashboard' },
      { label: 'Courses', icon: 'ph-book', path: '/student/courses', requires: { category: 'Course Catalog', action: 'read' } },
      { label: 'Timetable', icon: 'ph-calendar', path: '/student/timetable', requires: { category: 'Course Catalog', action: 'read' } },
      { label: 'Assignments', icon: 'ph-clipboard', path: '/student/assignments', requires: { category: 'Materials', action: 'read' } },
      { label: 'Quizzes', icon: 'ph-exam', path: '/student/quizzes', requires: { category: 'Materials', action: 'read' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/student/forms', requires: { category: 'Materials', action: 'read' } },
      { label: 'Online Lectures', icon: 'ph-video', path: '/student/online-lectures', requires: { category: 'Materials', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: "Assessment",
    icon: "ph-chart-bar",
    items: [
      { label: 'Attendance', icon: 'ph-check-circle', path: '/student/attendance', requires: { category: 'Attendance', action: 'read' } },
      { label: 'GPA Calculator', icon: 'ph-chart-bar', path: '/student/gpa-calculator', requires: { category: 'Grades', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    title: "Administrative",
    icon: "ph-briefcase",
    items: [
      { label: 'Payments', icon: 'ph-credit-card', path: '/student/payments', requires: { category: 'Payments', action: 'read' } },
      { label: 'Registrations', icon: 'ph-user-plus', path: '/student/registrations', requires: { category: 'Registration', action: 'read' } },
      { label: 'Student Affairs', icon: 'ph-users', path: '/student/student-affairs', requires: { category: 'Complaints', action: 'read' } },
      // Plan 7 Phase 6 — financial aid application + history. Gated on
      // Payments:read since it's a payment-related self-service surface
      // (avoids extending Financial Aid surface, which is admin-side queue).
      { label: 'Financial Aid', icon: 'ph-hand-coins', path: '/student/financial-aid', requires: { category: 'Payments', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    title: "Communication",
    icon: "ph-chat-dots",
    items: [
      { label: 'Announcements', icon: 'ph-megaphone', path: '/student/announcements', requires: { category: 'Announcements', action: 'read' } },
      // Level-leader composer — appears only for students whose admin has granted
      // `Announcements: write` via per-user override. The composer is restricted
      // server-side to `specific-students` and `specific-levels` recipient modes
      // (no all-students / all-users broadcast). One canonical entry; the
      // separate Plan 7 Phase 5 "Announce to peers" entry has been consolidated
      // into this route to avoid duplication.
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/student/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
      { label: 'FAQ ChatBot', icon: 'ph-robot', path: '/student/faq-chatbot' },
    ],
    defaultOpen: false,
  },
];
export const studentStaticTopItems: DynamicCategoryItem[] = [];

/* ---------------- ADMIN ----------------
 * Each item carries a `requires` permission so toggling a category in
 * Settings → Roles & Permissions immediately hides matching items from the
 * sidebar. The mapping mirrors the permission catalog in
 * frontend/src/pages/admin/Settings.tsx (PERMISSION_CATEGORY_CATALOG).
 */
export const adminCategories: DynamicCategory[] = [
  {
    title: 'Academics',
    icon: 'ph-book-open',
    items: [
      { label: 'Manage Courses', icon: 'ph-book', path: '/admin/manage-courses', requires: { category: 'Course Management', action: 'read' } },
      { label: 'User Management', icon: 'ph-users-three', path: '/admin/user-management', requires: { category: 'Faculty Management', action: 'read' } },
      { label: 'Pending Activations', icon: 'ph-user-plus', path: '/admin/pending-activations', requires: { category: 'Faculty Management', action: 'write' } },
      { label: 'Grade Override', icon: 'ph-pencil-simple-line', path: '/admin/grade-override', requires: { category: 'Grading', action: 'read' } },
      { label: 'Override History', icon: 'ph-clock-counter-clockwise', path: '/admin/grade-overrides/history', requires: { category: 'Grading', action: 'read' } },
      // Backend `/api/academic/transcript/:userId` already gates on admin /
      // admin / sa / self scope, so the sidebar entry doesn't need a
      // separate permission category.
      { label: 'Transcripts', icon: 'ph-graduation-cap', path: '/admin/transcripts' },
      { label: 'Registration Control', icon: 'ph-sliders-horizontal', path: '/admin/registration-control', requires: { category: 'Course Management', action: 'write' } },
      { label: 'Halls', icon: 'ph-door-open', path: '/admin/halls', requires: { category: 'Course Management', action: 'write' } },
      { label: 'Timetable', icon: 'ph-calendar', path: '/admin/timetable', requires: { category: 'Course Management', action: 'read' } },
      { label: 'Timetable Wizard', icon: 'ph-magic-wand', path: '/admin/timetable/wizard', requires: { category: 'Course Management', action: 'write' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/admin/forms' },
    ],
    defaultOpen: true,
  },
  {
    // Lifted out of Settings → Academic tab. The pages under here used to be
    // cards inside that tab; now each one is a top-level route under
    // /admin/academic/*.
    title: 'Academic Settings',
    icon: 'ph-graduation-cap',
    // Plan 6 mergers: 19 standalone pages → 10 sidebar entries. Each merged
    // entry uses a tabbed wrapper page that renders the legacy pages inside —
    // no functionality lost, just less navigation overhead. Old paths
    // continue to work via redirects in App.tsx.
    items: [
      // Plan 6 Phase 2.1 — SemesterCalendar + AcademicCalendar
      { label: 'Calendar', icon: 'ph-calendar', path: '/admin/academic/calendar', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 Phase 3 (extended) — Course Configurations + Grading Rules + Credit Hour Definition
      { label: 'Course Settings', icon: 'ph-gear-six', path: '/admin/academic/course-settings', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 Phase 5 — Course Rules + Prerequisites (per-course details)
      { label: 'Course Details', icon: 'ph-list-checks', path: '/admin/academic/course-details', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 Phase 4 — Level Progression + Levels & Attendance + Graduation Policy + Credit Limit Policy
      { label: 'Degree Requirements', icon: 'ph-graduation-cap', path: '/admin/academic/degree-requirements', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 extension — Incomplete Policy + Repetition Policy. Gated on
      // the umbrella `Academic Settings:read` so toggling that one matrix
      // category cleanly hides/shows every academic settings entry. The
      // granular categories (Incomplete Policy, Repetition Policy) still
      // exist in the matrix for backend-scope delegation.
      { label: 'Grade Policies', icon: 'ph-list-bullets', path: '/admin/academic/grade-policies', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 extension — Honors Policy + Suspension Policy
      { label: 'Academic Standing', icon: 'ph-medal', path: '/admin/academic/academic-standing', requires: { category: 'Academic Settings', action: 'read' } },
      // Plan 6 extension — Mobility Policy + Advisor Policy
      { label: 'Student Mobility', icon: 'ph-airplane-tilt', path: '/admin/academic/student-mobility', requires: { category: 'Academic Settings', action: 'read' } },
      // Registration Windows nav entry retired — the same policy editor
      // is embedded directly inside the Registration Control page
      // (/admin/registration-control), so a separate sidebar entry was
      // a duplicate.
      // Standalone — auto-scheduler grid (working days, slot duration).
      { label: 'Schedule Policy', icon: 'ph-clock-counter-clockwise', path: '/admin/academic/schedule-policy', requires: { category: 'Academic Settings', action: 'read' } },
      // Standalone — entity CRUD with its own delete-with-confirmation modal.
      { label: 'Departments', icon: 'ph-buildings', path: '/admin/academic/departments', requires: { category: 'Academic Settings', action: 'read' } },
      // Granular policy entries (Graduation / Semester / Credit Hour /
      // Registration Windows / Incomplete / Repetition / Honors / Mobility /
      // Advisor) intentionally OMITTED — each one lives as a sub-tab inside
      // one of the wrapper entries above (Calendar, Course Settings,
      // Degree Requirements, Grade Policies, Academic Standing, Student
      // Mobility). The matrix still exposes those categories independently
      // for fine-grained backend scope, but the sidebar uses the umbrella
      // entries to stay scannable.
    ],
    defaultOpen: false,
  },
  {
    // Admin Financials trimmed — Revenue Overview, Payroll, and the rest of
    // the analytical financial surfaces now live under the `financial` role
    // dashboard (/financial/*). Fee Management + Financial Aid remain on
    // admin because they're admin-level configuration / approval queues
    // that the SA team also needs day-to-day.
    title: 'Financials',
    icon: 'ph-currency-circle-dollar',
    items: [
      { label: 'Fee Management', icon: 'ph-credit-card', path: '/admin/fee-management', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Issued Invoices', icon: 'ph-receipt', path: '/admin/issued-invoices', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Service Requests', icon: 'ph-tray', path: '/admin/service-requests', requires: { category: 'Financial Management', action: 'write' } },
      // Plan 7 Phase 6 — financial aid queue + detail.
      { label: 'Financial Aid', icon: 'ph-hand-coins', path: '/admin/financial-aid', requires: { category: 'Financial Management', action: 'read' } },
    ],
    defaultOpen: false,
  },
  // Analytics was the sole entry of its own category — folded into
  // System & Audit so the admin sidebar isn't padded out by a one-item
  // group. The page itself is unchanged at /admin/analytics.
  {
    title: 'Communications',
    icon: 'ph-megaphone-simple',
    items: [
      { label: 'Announcements', icon: 'ph-megaphone', path: '/admin/announcements', requires: { category: 'Announcements', action: 'read' } },
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/admin/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
      // Plan 5 Phase 5 — 6 admin-only staff Firestore chat groups.
      { label: 'Staff Chat', icon: 'ph-chats-teardrop', path: '/admin/chatroom', requires: { category: 'Staff Chat', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    // Plan 4 Phase 7 — mobility / exchange queues. External Credits review +
    // Auditor enrollment review live as their own category since each is its
    // own admin workflow (cap-aware approve, separate audit trail).
    title: 'Mobility & Auditors',
    icon: 'ph-airplane-tilt',
    items: [
      { label: 'External Credits', icon: 'ph-arrow-square-in', path: '/admin/external-credits', requires: { category: 'External Credits', action: 'read' } },
      { label: 'Auditors', icon: 'ph-eye', path: '/admin/auditors', requires: { category: 'Auditors', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    // SA-side queues the admin oversees. Each entry points at /admin/* and
    // renders the existing SA component (verified path-agnostic). Without
    // these entries, the corresponding matrix categories (Complaints, Name
    // Change Requests, Enrollment Workflows) appeared in Roles & Permissions
    // but toggling them had no visible effect — the admin had no sidebar
    // entry to hide/show.
    title: 'Student Support',
    icon: 'ph-handshake',
    items: [
      { label: 'Complaints',           icon: 'ph-chat-circle-text', path: '/admin/complaints',           requires: { category: 'Complaints', action: 'read' } },
      { label: 'Name Change Requests', icon: 'ph-pencil-line',      path: '/admin/name-change-requests', requires: { category: 'Name Change Requests', action: 'read' } },
      { label: 'Enrollment Workflows', icon: 'ph-arrows-merge',     path: '/admin/enrollment-workflows', requires: { category: 'Enrollment Workflows', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    title: 'System & Audit',
    icon: 'ph-database',
    items: [
      // Folded in from the retired "Analytics & Reports" single-item
      // category — admin-level data inspection sits naturally here.
      { label: 'Analytics', icon: 'ph-chart-pie-slice', path: '/admin/analytics', requires: { category: 'Analytics Dashboard', action: 'read' } },
      { label: 'System Health', icon: 'ph-thermometer', path: '/admin/system-health', requires: { category: 'Audit Logs', action: 'read' } },
      { label: 'Audit Logs', icon: 'ph-file-magnifying-glass', path: '/admin/audit-logs', requires: { category: 'Audit Logs', action: 'read' } },
      // Plan 5 Phase 4 — IT-scope sign-in lock management. Hidden until the
      // admin's role has the Sign-In Locks permission category granted.
      { label: 'Sign-In Locks', icon: 'ph-lock', path: '/admin/signin-locks', requires: { category: 'Sign-In Locks', action: 'read' } },
      // Top-level Access Control — per-user permission overrides for any user.
      // Gated on Per-User Permissions:write (matches the route guard in
      // App.tsx so the sidebar entry never appears without the page also
      // being reachable).
      { label: 'Access Control', icon: 'ph-shield-check', path: '/admin/access-control', requires: { category: 'Per-User Permissions', action: 'write' } },
      // Consolidated student dossier — admin search + per-student summary
      // (academic standing + warnings + attendance + financials + cases).
      { label: 'Student Reports', icon: 'ph-file-text', path: '/admin/reports', requires: { category: 'Reports', action: 'read' } },
    ],
    defaultOpen: false,
  },
];

// ** DO NOT add Settings here — the Sidebar already renders Settings dynamically at the bottom per userRole **
export const adminStaticTopItems: DynamicCategoryItem[] = [
  { label: 'Admin Dashboard', icon: 'ph-squares-four', path: '/admin/dashboard' }
];

/* ---------------- TA ----------------
 * Staff-surface categories: Grading, Attendance, Materials, Announcements,
 * Advisees (professor-only by usage but TA can carry the read).
 *
 *   My Courses                    → Materials:read
 *   Grade Submissions / Quiz Mgmt → Grading:read / Grading:write
 *   Attendance                    → Attendance:read
 *   Materials / Forms / Live Sess → Materials:read
 *   Course Chatroom               → Materials:read (chat lives per-section)
 *   Announcements                 → Announcements:read
 *   Manage Announcements          → Announcements:write
 */
export const taCategories: DynamicCategory[] = [
  {
    title: 'Teaching & Grading',
    icon: 'ph-chalkboard-teacher',
    items: [
      { label: 'My Courses', icon: 'ph-books', path: '/ta/courses', requires: { category: 'Materials', action: 'read' } },
      { label: 'Grade Submissions', icon: 'ph-checks', path: '/ta/gradebook', requires: { category: 'Grading', action: 'read' } },
      { label: 'Quiz Management', icon: 'ph-exam', path: '/ta/quiz-management', requires: { category: 'Grading', action: 'write' } },
      { label: 'Attendance', icon: 'ph-qr-code', path: '/ta/attendance', requires: { category: 'Attendance', action: 'read' } },
      { label: 'Materials', icon: 'ph-upload', path: '/ta/materials', requires: { category: 'Materials', action: 'write' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/ta/forms', requires: { category: 'Materials', action: 'read' } },
      { label: 'Live Sessions', icon: 'ph-video-camera', path: '/ta/schedule', requires: { category: 'Materials', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: 'Communication',
    icon: 'ph-chat-dots',
    items: [
      { label: 'Course Chatroom', icon: 'ph-chat-teardrop-dots', path: '/ta/chatroom', requires: { category: 'Materials', action: 'read' } },
      { label: 'Announcements', icon: 'ph-megaphone', path: '/ta/announcements', requires: { category: 'Announcements', action: 'read' } },
      // Plan 5 — appears only when admin grants `Announcements: write`.
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/ta/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
    ],
    defaultOpen: false,
  },
];
export const taStaticTopItems: DynamicCategoryItem[] = [
  { label: 'TA Dashboard', icon: 'ph-squares-four', path: '/ta/dashboard' }
];

/* ---------------- PROFESSOR ----------------
 * Same staff-surface mapping as TA, plus Advisees (Plan 4 Phase 8).
 *
 *   Course Overview / Live Sessions / Chatroom → Materials:read
 *   Attendance                                  → Attendance:read
 *   Grading / Grade Book                        → Grading:read
 *   Quiz Management                             → Grading:write
 *   Materials                                   → Materials:write
 *   Forms                                       → Materials:read
 *   My Advisees                                 → Advisees:read
 *   Announcements                               → Announcements:read
 *   Manage Announcements                        → Announcements:write
 */
export const professorCategories: DynamicCategory[] = [
  {
    title: 'Teaching',
    icon: 'ph-graduation-cap',
    items: [
      { label: 'Course Overview', icon: 'ph-book-open', path: '/professor/course-overview', requires: { category: 'Materials', action: 'read' } },
      // Plan 4 Phase 8 — Article 12 advisor queue.
      { label: 'My Advisees', icon: 'ph-user-focus', path: '/professor/advisees', requires: { category: 'Advisees', action: 'read' } },
      { label: 'Attendance', icon: 'ph-qr-code', path: '/professor/attendance', requires: { category: 'Attendance', action: 'read' } },
      { label: 'Grading', icon: 'ph-clipboard-text', path: '/professor/grading', requires: { category: 'Grading', action: 'read' } },
      { label: 'Grade Book', icon: 'ph-table', path: '/professor/gradebook', requires: { category: 'Grading', action: 'read' } },
      { label: 'Materials', icon: 'ph-upload', path: '/professor/materials', requires: { category: 'Materials', action: 'write' } },
      { label: 'Quiz Management', icon: 'ph-exam', path: '/professor/quiz-management', requires: { category: 'Grading', action: 'write' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/professor/forms', requires: { category: 'Materials', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: 'Communication',
    icon: 'ph-chat-dots',
    items: [
      { label: 'Live Sessions', icon: 'ph-video-camera', path: '/professor/live-sessions', requires: { category: 'Materials', action: 'read' } },
      { label: 'Chatroom', icon: 'ph-chat-circle-dots', path: '/professor/chatroom', requires: { category: 'Materials', action: 'read' } },
      { label: 'Announcements', icon: 'ph-megaphone', path: '/professor/announcements', requires: { category: 'Announcements', action: 'read' } },
      // Plan 5 — appears only when admin grants `Announcements: write`.
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/professor/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
    ],
    defaultOpen: false,
  },
];
export const professorStaticTopItems: DynamicCategoryItem[] = [
  { label: 'Professor Dashboard', icon: 'ph-squares-four', path: '/professor/dashboard' }
];

/* ---------------- SA ----------------
 *   Student Profiles / Enrollment & Courses / Forms → Student Management:read
 *   Payment Management                              → Financial Management:read
 *   Fee Management                                  → Financial Management:write
 *   Financial Aid                                   → Financial Aid:read
 *   Complaints Center / Requests Center             → Complaints:read
 *   Attendance Excuses                              → Attendance:read
 *   Categories Management                           → Complaints:write
 *   Enrollment Workflows                            → Enrollment Workflows:read
 *   Announcements                                   → Announcements:read
 *   Manage Announcements                            → Announcements:write
 */
export const saCategories: DynamicCategory[] = [
  {
    title: 'Student Management',
    icon: 'ph-users',
    items: [
      { label: 'Student Profiles', icon: 'ph-user-circle', path: '/sa/student-profiles', requires: { category: 'Student Management', action: 'read' } },
      { label: 'Enrollment & Courses', icon: 'ph-books', path: '/sa/enrollment', requires: { category: 'Student Management', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    // SA finance surface — payment monitoring + the same Fee Management and
    // Financial Aid pages the admin uses. SA staff handle day-to-day fee
    // adjustments and aid request triage for walk-in students.
    title: 'Finance',
    icon: 'ph-currency-circle-dollar',
    items: [
      { label: 'Payment Management', icon: 'ph-credit-card', path: '/sa/payments', requires: { category: 'Financial Management', action: 'read' } },
      { label: 'Fee Management', icon: 'ph-credit-card', path: '/sa/fee-management', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Issued Invoices', icon: 'ph-receipt', path: '/sa/issued-invoices', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Service Requests', icon: 'ph-tray', path: '/sa/service-requests', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Financial Aid', icon: 'ph-hand-coins', path: '/sa/financial-aid', requires: { category: 'Financial Aid', action: 'read' } },
    ],
    defaultOpen: false,
  },
  {
    title: 'Cases & Support',
    icon: 'ph-briefcase',
    items: [
      { label: 'Complaints Center', icon: 'ph-warning-circle', path: '/sa/complaints', requires: { category: 'Complaints', action: 'read' } },
      { label: 'Requests Center', icon: 'ph-file-text', path: '/sa/requests', requires: { category: 'Complaints', action: 'read' } },
      // Absence excuses + appeals review queue. Notification on excuse-submit
      // points here via the SA notification deep-link.
      { label: 'Attendance Excuses', icon: 'ph-clipboard-text', path: '/sa/attendance-excuses', requires: { category: 'Attendance', action: 'read' } },
      // Plan 4 Phase 6 — enrollment workflow review queue.
      { label: 'Enrollment Workflows', icon: 'ph-pause-circle', path: '/sa/enrollment-workflows', requires: { category: 'Enrollment Workflows', action: 'read' } },
      // Manages the request-type + complaint-category pickers used by the
      // student form and the SA / admin queue filters.
      { label: 'Categories Management', icon: 'ph-tag', path: '/sa/categories', requires: { category: 'Complaints', action: 'write' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/sa/forms', requires: { category: 'Student Management', action: 'read' } },
      // Consolidated student dossier — same page admin uses, scoped to /sa/*
      // drill-downs so SA stays inside their own dashboard.
      { label: 'Student Reports', icon: 'ph-file-text', path: '/sa/reports', requires: { category: 'Reports', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: 'Communication',
    icon: 'ph-chat-dots',
    items: [
      // Read-only feed — same component the student dashboard uses.
      { label: 'Announcements', icon: 'ph-megaphone', path: '/sa/announcements', requires: { category: 'Announcements', action: 'read' } },
      // Compose / publish / delete (sa + admin).
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/sa/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
    ],
    defaultOpen: false,
  },
];
export const saStaticTopItems: DynamicCategoryItem[] = [
  { label: 'SA Dashboard', icon: 'ph-squares-four', path: '/sa/dashboard' }
];

/* ---------------- FINANCIAL (sub-role) ----------------
 * Read-only financial operations surface. The pages themselves are the
 * same components used under /admin/* — they're just aliased here so the
 * sidebar lives within the role's URL prefix.
 *
 *   Revenue Overview / Transactions → Financial Management:read
 *   Fee Management                  → Financial Management:write
 *   Payroll                         → Payroll:read
 *   Financial Aid                   → Financial Aid:read
 *   Announcements                   → Announcements:read
 *   Manage Announcements            → Announcements:write
 *   Staff Chat                      → Staff Chat:read
 *   Forms                           → Financial Management:read
 */
export const financialCategories: DynamicCategory[] = [
  {
    title: 'Revenue',
    icon: 'ph-currency-circle-dollar',
    items: [
      { label: 'Revenue Overview', icon: 'ph-chart-line', path: '/financial/revenue-overview', requires: { category: 'Financial Management', action: 'read' } },
      { label: 'Transactions', icon: 'ph-list-magnifying-glass', path: '/financial/transactions', requires: { category: 'Financial Management', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: 'Operations',
    icon: 'ph-receipt',
    items: [
      { label: 'Fee Management', icon: 'ph-credit-card', path: '/financial/fee-management', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Issued Invoices', icon: 'ph-receipt', path: '/financial/issued-invoices', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Service Requests', icon: 'ph-tray', path: '/financial/service-requests', requires: { category: 'Financial Management', action: 'write' } },
      { label: 'Payroll', icon: 'ph-receipt', path: '/financial/payroll', requires: { category: 'Payroll', action: 'read' } },
      { label: 'Financial Aid', icon: 'ph-hand-coins', path: '/financial/financial-aid', requires: { category: 'Financial Aid', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    // Staff chat + read-only announcements feed + forms — mirrors admin's
    // Communication category. Posting an announcement is gated server-side
    // by `requireScope('financial', 'sa', 'admin')` — financial CAN compose
    // when they have the Announcements:write override granted; otherwise
    // the manage page silently falls back to view-only.
    title: 'Communication',
    icon: 'ph-chat-dots',
    items: [
      { label: 'Announcements', icon: 'ph-megaphone', path: '/financial/announcements', requires: { category: 'Announcements', action: 'read' } },
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/financial/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
      { label: 'Staff Chat', icon: 'ph-chats-teardrop', path: '/financial/chatroom', requires: { category: 'Staff Chat', action: 'read' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/financial/forms', requires: { category: 'Financial Management', action: 'read' } },
    ],
    defaultOpen: false,
  },
];
export const financialStaticTopItems: DynamicCategoryItem[] = [
  { label: 'Financial Dashboard', icon: 'ph-squares-four', path: '/financial/dashboard' }
];

/* ---------------- IT (sub-role) ----------------
 * Read-only platform observability for the IT sub-role. Pages aliased
 * from /admin/* so the existing implementations (System Health, Audit
 * Logs, Analytics, Sign-In Locks) are reused without duplication.
 *
 *   System Health        → Audit Logs:read
 *   Analytics            → Analytics Dashboard:read
 *   Audit Logs           → Audit Logs:read
 *   Sign-In Locks        → Sign-In Locks:read
 *   Announcements        → Announcements:read
 *   Manage Announcements → Announcements:write
 *   Staff Chat           → Staff Chat:read
 *   Forms                → Audit Logs:read
 */
export const itCategories: DynamicCategory[] = [
  {
    title: 'Platform Health',
    icon: 'ph-pulse',
    items: [
      { label: 'System Health', icon: 'ph-thermometer', path: '/it/system-health', requires: { category: 'Audit Logs', action: 'read' } },
      { label: 'Analytics', icon: 'ph-chart-pie-slice', path: '/it/analytics', requires: { category: 'Analytics Dashboard', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    title: 'Security & Audit',
    icon: 'ph-shield-check',
    items: [
      { label: 'Audit Logs', icon: 'ph-file-magnifying-glass', path: '/it/audit-logs', requires: { category: 'Audit Logs', action: 'read' } },
      { label: 'Sign-In Locks', icon: 'ph-lock', path: '/it/signin-locks', requires: { category: 'Sign-In Locks', action: 'read' } },
    ],
    defaultOpen: true,
  },
  {
    // Mirrors admin Communication. IT staff need a place to coordinate
    // (staff_it + staff_all chat) and read system-wide announcements.
    title: 'Communication',
    icon: 'ph-chat-dots',
    items: [
      { label: 'Announcements', icon: 'ph-megaphone', path: '/it/announcements', requires: { category: 'Announcements', action: 'read' } },
      { label: 'Manage Announcements', icon: 'ph-pencil-simple-line', path: '/it/announcements/manage', requires: { category: 'Announcements', action: 'write' } },
      { label: 'Staff Chat', icon: 'ph-chats-teardrop', path: '/it/chatroom', requires: { category: 'Staff Chat', action: 'read' } },
      { label: 'Forms', icon: 'ph-clipboard-text', path: '/it/forms', requires: { category: 'Audit Logs', action: 'read' } },
    ],
    defaultOpen: false,
  },
];
export const itStaticTopItems: DynamicCategoryItem[] = [
  { label: 'IT Dashboard', icon: 'ph-squares-four', path: '/it/dashboard' }
];

export const roleToConfigMap = {
  student: { path: '/student', categories: studentCategories, staticTopItems: studentStaticTopItems },
  admin: { path: '/admin', categories: adminCategories, staticTopItems: adminStaticTopItems },
  ta: { path: '/ta', categories: taCategories, staticTopItems: taStaticTopItems },
  professor: { path: '/professor', categories: professorCategories, staticTopItems: professorStaticTopItems },
  sa: { path: '/sa', categories: saCategories, staticTopItems: saStaticTopItems },
  financial: { path: '/financial', categories: financialCategories, staticTopItems: financialStaticTopItems },
  it: { path: '/it', categories: itCategories, staticTopItems: itStaticTopItems },
};
