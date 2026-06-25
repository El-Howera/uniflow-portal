// src/App.tsx
import React, { useState, useEffect, ReactNode, useRef } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { isElectronApp } from '@shared/config';
import { AnimatePresence, motion } from 'framer-motion';
import Aurora from './components/Aurora';
import LightModeBackground from './components/LightModeBackground';
import ClickSpark from './components/ClickSpark'; // Import the ClickSpark component
import ToastContainer from './components/ToastNotification'; // Import Toast notifications
import ImpersonationBanner from './components/ImpersonationBanner';
import ElectronTitleBar from './components/ElectronTitleBar';
import RequirePermission from './components/RequirePermission';
import UniFlowLoader from './components/UniFlowLoader';
import { gsap } from 'gsap';

// --- Context and Data Imports ---
import { AppProvider, useAppContext, UserRole } from './context/AppContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';
import { RegistrationProvider } from './context/RegistrationContext';
// Plan 8 Phase 1 — Brand palette context. Loads /api/public-settings/brand
// at boot and injects CSS custom properties for `bg-brand-primary` etc.
import { BrandProvider, useBrand } from './context/BrandContext';
import { Logo } from './components/Logo';
import { roleToConfigMap } from './data/navigationData';
// Plan 8 Phase 4/5 — per-route flags (hideSearchBar, hideMobileNav).
import { resolveRouteFlags } from './data/routeMeta';
import { useFilteredNavCategories, clearPermissionsCache } from './utils/permissions';
import { firebase } from './utils/firebase';
import { webpush } from './utils/webpush';
import { nativePush } from './utils/capacitor-push';
import { bootstrapCapacitorShell } from './utils/capacitor-shell';
import { getGuideUrl } from './utils/guideUrl';
import NetworkBanner from './components/NetworkBanner';
import SessionEndedOverlay from './components/SessionEndedOverlay';
import { useT, useTr } from './i18n';

// --- Student Pages ---
import {
    Dashboard, Payments, PaymentSuccess, Courses, GpaCalculator, Registrations, Timetable,
    Attendance, MarkAttendance, Chatbot, StudentAffairs, Notifications,
    Announcements, Chatroom, ViewProfile, FullTranscript, Settings as StudentSettings,
    ViewCourseContent, AssignmentsPageContent, OnlineLecturesContent
} from './pages/student';
import More from './pages/student/More'; // Import More page for mobile
import Quizzes from './pages/student/Quizzes';
import AssignedForms from './pages/student/AssignedForms';
import RespondForm from './pages/student/RespondForm';
// Plan 7 Phase 5 — student peer announcement composer (restricted recipients).
// Plan 7 Phase 6 — student financial aid surface.
import FinancialAid from './pages/student/FinancialAid';
import FinancialAidApply from './pages/student/FinancialAidApply';
import LiveSessionRoom from './pages/LiveSessionRoom';
import QuizManagement from './pages/professor/QuizManagement';
import ProfessorDashboard from './pages/professor/ProfessorDashboard';
import ProfCourseOverview from './pages/professor/ProfCourseOverview';
import ProfAttendance from './pages/professor/ProfAttendance';
import ProfGrading from './pages/professor/ProfGrading';
import ProfMaterials from './pages/professor/ProfMaterials';
import ProfLiveSessions from './pages/professor/ProfLiveSessions';
import ProfChatroom from './pages/professor/ProfChatroom';
import ProfGradeBook from './pages/professor/ProfGradeBook';
import ProfessorSettings from './pages/professor/Settings';
import ProfCourseDetail from './pages/professor/ProfCourseDetail';
import ProfBroadcast from './pages/professor/ProfBroadcast';
import ProfFormsList from './pages/professor/FormsList';
import ProfFormComposer from './pages/professor/FormComposer';
import ProfFormResponses from './pages/professor/FormResponses';

// --- TA Pages ---
import TADashboard from './pages/ta/TADashboard';
import TACourseOverview from './pages/ta/TACourseOverview';
import TAAttendance from './pages/ta/TAAttendance';
import TAGrading from './pages/ta/TAGrading';
import TAMaterials from './pages/ta/TAMaterials';
import TALiveSessions from './pages/ta/TALiveSessions';
import TACourseDetail from './pages/ta/TACourseDetail';
import TAChatroom from './pages/ta/TAChatroom';
import TASettings from './pages/ta/Settings';
import TAFormsList from './pages/ta/FormsList';
import TAFormComposer from './pages/ta/FormComposer';
import TAFormResponses from './pages/ta/FormResponses';
import MobileNavbar from './components/MobileNavbar';
import MobileSidebarDrawer from './components/MobileSidebarDrawer';

// --- SA Pages ---
import SADashboard from './pages/sa/SADashboard';
import SAStudentProfiles from './pages/sa/SAStudentProfiles';
import SAStudentProfileDetail from './pages/sa/SAStudentProfileDetail';
import SAStudentAttendanceHistory from './pages/sa/SAStudentAttendanceHistory';
import SACategories from './pages/sa/SACategories';
import SAEnrollment from './pages/sa/SAEnrollment';
import SAComplaints from './pages/sa/SAComplaints';
import SARequests from './pages/sa/SARequests';
import SAPayments from './pages/sa/SAPayments';
import SAAnnouncements from './pages/sa/SAAnnouncements';
import SANameChangeRequests from './pages/sa/SANameChangeRequests';
import SASettings from './pages/sa/Settings';
import SAFormsList from './pages/sa/FormsList';
import SAFormComposer from './pages/sa/FormComposer';
import SAFormResponses from './pages/sa/FormResponses';

// --- Admin Pages ---
import AnnouncementsPage from './pages/admin/Announcements';
import CoursesManagementPage from './pages/admin/ManageCourses';
import ManageCourseDetail from './pages/admin/ManageCourseDetail';
import AdminDashboardContent from './pages/admin/AdminDashboard';
import FinancialsPage from './pages/admin/Financials';
import TransactionDetailPage from './pages/admin/TransactionDetailPage';
import DefaulterDetailPage from './pages/admin/DefaulterDetailPage';
import { PendingActivations } from './pages/admin/UserManagement';
import UserManagementPage from './pages/admin/UserManagement';
import UserEditPage from './pages/admin/UserEditPage';
import AccessControlPage from './pages/admin/AccessControlPage';
import ReportsPage from './pages/admin/ReportsPage';
import { SystemHealth, AuditLogs } from './pages/admin/SystemAudit';
import AdminSettingsPage from './pages/admin/Settings';
import Analytics from './pages/admin/Analytics';
import GradeOverride from './pages/admin/GradeOverride';
import GradeOverrideCoursePage from './pages/admin/GradeOverrideCourse';
import GradeOverrideStudentPage from './pages/admin/GradeOverrideStudent';
import GradeOverrideHistoryPage from './pages/admin/GradeOverrideHistory';
import RegistrationControl from './pages/admin/RegistrationControl';
import HallsPage from './pages/admin/Halls';
import SignInLocksPage from './pages/admin/SignInLocks';
import TimetableWizardPage from './pages/admin/TimetableWizard';
import TimetablePage from './pages/admin/Timetable';
import TranscriptsPage from './pages/admin/TranscriptsPage';
import SchedulePolicyPage from './pages/admin/academic/SchedulePolicy';
import FeeManagement from './pages/admin/FeeManagement';
import ServiceRequestsQueue from './pages/admin/ServiceRequestsQueue';
import IssuedInvoices from './pages/admin/IssuedInvoices';
import PayrollPage from './pages/admin/Payroll';
import PayrollRunDetailPage from './pages/admin/PayrollRunDetail';
// Academic top-level category (lifted out of Settings → Academic tab)
// Plan 6 mergers — tabbed wrapper pages that render the legacy standalone
// pages inside tabs. Old standalone imports remain so the wrappers can
// reference them; old paths redirect to the merged page via App.tsx routes.
import CalendarPage from './pages/admin/academic/CalendarPage';
import CourseSettingsPage from './pages/admin/academic/CourseSettingsPage';
import CourseDetailsPage from './pages/admin/academic/CourseDetailsPage';
import DegreeRequirementsPage from './pages/admin/academic/DegreeRequirementsPage';
import GradePoliciesPage from './pages/admin/academic/GradePoliciesPage';
import AcademicStandingPage from './pages/admin/academic/AcademicStandingPage';
import StudentMobilityPage from './pages/admin/academic/StudentMobilityPage';

// Plan 6 Phase 7 — the standalone Academic Settings page imports were
// removed from App.tsx because their routes were replaced with redirects
// to the merged wrapper pages. The legacy pages themselves still live in
// `pages/admin/academic/` and are imported by the wrappers that render
// them inside tabs. Departments + AdminExternalCredits + AdminAuditors +
// Advisees stay imported here because they remain top-level routes.
import DepartmentsPage from './pages/admin/academic/Departments';
// Registration Windows was retired — the same policy editor is already
// embedded in Registration Control (/admin/registration-control). No
// separate page, no separate route. Legacy bookmarks redirect there.
import AdminExternalCredits from './pages/admin/AdminExternalCredits';
import AdminAuditors from './pages/admin/AdminAuditors';
import Advisees from './pages/professor/Advisees';
import SAEnrollmentWorkflows from './pages/sa/SAEnrollmentWorkflows';
import SAAttendanceExcuses from './pages/sa/SAAttendanceExcuses';
// Plan 5 Phase 5 — admin staff chatroom (6 staff Firestore groups).
import AdminChatroom from './pages/admin/AdminChatroom';
import AdminFormsList from './pages/admin/FormsList';
import AdminFormComposer from './pages/admin/FormComposer';
import AdminFormResponses from './pages/admin/FormResponses';
// Plan 7 Phase 6 — financial aid admin queue + detail.
import FinancialAidQueue from './pages/admin/FinancialAidQueue';
import FinancialAidDetail from './pages/admin/FinancialAidDetail';

// --- Financial sub-role dashboard ---
// Read-only financial-ops landing for the `financial` role. All the
// working pages (Revenue Overview, Fee Management, Payroll, Financial
// Aid, Transactions) are aliased from the admin surface so we don't
// duplicate components — only the route prefix differs.
import FinancialDashboard from './pages/financial/FinancialDashboard';
import TransactionsLedger from './pages/financial/TransactionsLedger';

// --- IT sub-role dashboard ---
// Read-only platform observability for the `it` role. Same alias pattern
// as Financial — System Health, Audit Logs, Analytics, Sign-In Locks
// reuse the admin components.
import ITDashboard from './pages/it/ITDashboard';

// --- AuthPage ---
import { AuthPage } from './pages/AuthPage';

// Router selection — Electron loads index.html via file://, so BrowserRouter
// (history API) can't rewrite that URL and React Router silently breaks.
// HashRouter uses the URL fragment (#/student/dashboard) which works under
// file:// without touching the underlying file path. Picked at module load
// so the choice is stable across renders. Web builds keep BrowserRouter
// (cleaner URLs, server-side route handling for SSR + deep-links).
const Router = isElectronApp() ? HashRouter : BrowserRouter;

// Plan 5 — non-admin roles granted `Announcements: write` get the same
// composer page admin uses, but with a restricted recipient picker (no
// all-students / all-users blast). Backend also enforces this server-side
// in POST /api/sa/announcements.
const NonAdminManageAnnouncements: React.FC = () => (
    <AnnouncementsPage allowedRecipientModes={['specific-users', 'specific-levels']} />
);


// --- MOCK TYPES ---
interface DynamicCategoryItem { label: string; icon: string; path?: string; }
interface DynamicCategory { title: string; icon: string; items: DynamicCategoryItem[]; defaultOpen: boolean; }
interface RoleRoutesProps { onLogout: () => void; }

// --- Base style for the glass morphism effect ---
const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// --- HELPER & UI COMPONENTS ---
interface NavItemProps { icon: string; label: string; path: string; isExpanded: boolean; }
const NavItem: React.FC<NavItemProps> = ({ icon, label, path, isExpanded }) => {
    const location = useLocation();
    const tr = useTr();
    const isActive = location.pathname === path;
    return (
        // Padding kept tight (px-2) so longer labels like "Registration
        // Windows" or "Degree Requirements" fit at 256 px sidebar width
        // without triggering the ellipsis. `text-left` forces the label
        // to hug the icon (otherwise the button's default text-align:
        // center kicks in for the truncated span). `min-w-0` lets the
        // span shrink past its content width if it does overflow.
        <Link to={path} title={tr(label)} className={`flex items-center h-10 rounded-lg transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] min-w-0 ${isActive ? 'bg-[#6A3FF4] text-white' : 'text-black dark:text-white hover:bg-white/30 dark:hover:bg-white/10'} ${isExpanded ? 'px-2 text-left' : 'justify-center'}`}>
            <i className={`ph-fill ${icon} text-lg flex-shrink-0 ${isExpanded ? 'w-5' : ''}`}></i>
            {/* Plan 9 follow-up — labels fade + slide in via opacity + max-width.
                Using `transition-all` (not the bracket-arbitrary syntax) because
                the latter compiled inconsistently across Tailwind/CRACO and the
                opacity transition was getting dropped — labels popped instead
                of fading. `transition-all` covers opacity AND max-width AND
                margin-left at the 450 ms curve. */}
            {/* `ms-2` (margin-inline-start) instead of `ml-2` so the gap
                between icon and label sits on the START side — right of
                the icon in LTR, left of the icon in RTL. The previous
                `ml-2` was always physical-left, which in RTL put the gap
                on the WRONG side and the label visually butted up against
                the icon. */}
            <span className={`font-medium text-sm whitespace-nowrap text-left transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${isExpanded ? 'opacity-100 max-w-[200px] ms-2' : 'opacity-0 max-w-0 ms-0'}`}>{tr(label)}</span>
        </Link>
    );
};

const Category: React.FC<DynamicCategory & { isExpanded: boolean; isOpen: boolean; onClick: () => void; }> = ({ title, icon, items, isOpen, isExpanded, onClick }) => {
    const location = useLocation();
    const tr = useTr();
    // Check if current path matches any item in this category
    const isActiveCategory = items.some(item => item.path && location.pathname === item.path);

    return (
        <div className="overflow-hidden">
            {/* Tight px-2 + text-left so the category title hugs the icon
                on the left (button's default text-align is center). gap-2
                between the title group and the caret keeps them apart
                without needing flex justify-between with extra spacing. */}
            <button onClick={onClick} className={`flex items-center h-10 w-full rounded-lg transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] min-w-0 ${!isExpanded && isActiveCategory ? 'bg-[#6A3FF4] text-white' : 'text-black dark:text-white hover:bg-white/30 dark:hover:bg-white/10'} ${isExpanded ? 'px-2 gap-2 text-left' : 'justify-center'}`}>
                <div className={`flex items-center min-w-0 ${!isExpanded ? 'justify-center' : 'flex-1'}`}>
                    <i className={`ph-fill ${icon} text-lg flex-shrink-0 ${isExpanded ? 'w-5' : ''}`}></i>
                    <span className={`font-semibold text-sm whitespace-nowrap text-left transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${isExpanded ? 'opacity-100 max-w-[200px] ms-2' : 'opacity-0 max-w-0 ms-0'}`}>{tr(title)}</span>
                </div>
                <i className={`ph-bold ph-caret-down text-xs flex-shrink-0 transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${isOpen ? 'rotate-180' : ''} ${isExpanded ? 'opacity-100 max-w-[16px]' : 'opacity-0 max-w-0'}`}></i>
            </button>
            {/* Plan 6 mergers brought Academic Settings down from 19 → 10
                entries, so no nested scrollbar is needed. pl-4 (was pl-8)
                gives child items room for longer labels without ellipsis
                while still indenting them visibly under the category. */}
            {/* `ps-4` (padding-inline-start) instead of `pl-4` so nested
                child nav items indent from the start side — right in RTL,
                left in LTR. */}
            <div className={`ps-4 space-y-1 transition-[max-height,opacity,margin-top] duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${isOpen && isExpanded ? 'max-h-screen opacity-100 mt-2' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                {items.map((item) => (<NavItem key={item.label} icon={item.icon} label={item.label} path={item.path || '#'} isExpanded={isExpanded} />))}
            </div>
        </div>
    );
};

interface SidebarProps {
    onLogout: () => void;
    categories: DynamicCategory[];
    staticTopItems?: DynamicCategoryItem[];
    isExpanded: boolean;
    openCategory: string | null;
    onCategoryClick: (title: string) => void;
}
// The interactive User Guide is a separate static site served by nginx at
// /userguide (NOT a React Router route). It MUST render as a real anchor with
// a full-page load — a <Link> would be intercepted client-side and 404 inside
// the SPA. Opens in a new tab so the dashboard session stays intact. URL
// resolved per-platform by getGuideUrl() (relative on web/Electron, absolute
// on Capacitor native).
const GuideLink: React.FC<{ isExpanded: boolean }> = ({ isExpanded }) => {
    const tr = useTr();
    return (
        <a
            href={getGuideUrl()}
            target="_blank"
            rel="noopener noreferrer"
            title={tr('User Guide')}
            className={`flex items-center h-10 rounded-lg transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] min-w-0 text-black dark:text-white hover:bg-white/30 dark:hover:bg-white/10 ${isExpanded ? 'px-2 text-left' : 'justify-center'}`}
        >
            <i className={`ph-fill ph-question text-lg flex-shrink-0 ${isExpanded ? 'w-5' : ''}`}></i>
            <span className={`font-medium text-sm whitespace-nowrap text-left transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden ${isExpanded ? 'opacity-100 max-w-[200px] ms-2' : 'opacity-0 max-w-0 ms-0'}`}>{tr('User Guide')}</span>
        </a>
    );
};

const Sidebar: React.FC<SidebarProps> = ({ onLogout, categories, staticTopItems = [], isExpanded, openCategory, onCategoryClick }) => {
    const navigate = useNavigate();
    const { userRole } = useAppContext();
    const tr = useTr();
    // Just delegate up — App.tsx now shows a confirmation modal, and the
    // post-confirm navigation/cleanup happens there too. Don't navigate
    // here or the redirect fires before the user sees the modal.
    const handleLogout = () => { onLogout(); };
    const settingsPath = `/${userRole}/settings`;

    const dashboardPath = `/${userRole || 'student'}/dashboard`;
    return (
        <aside className={`${glassCardStyle} w-full h-full flex-col p-2 overflow-hidden hidden md:flex`}>
            <button
                type="button"
                onClick={() => navigate(dashboardPath)}
                aria-label={tr('Go to dashboard')}
                title={tr('Go to dashboard')}
                className={`flex items-center flex-shrink-0 h-14 mb-6 rounded-lg hover:opacity-80 active:opacity-70 cursor-pointer text-left transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${isExpanded ? 'px-3' : 'justify-center'}`}
            >
                <i className="ph-fill ph-graduation-cap text-[#6A3FF4] text-4xl flex-shrink-0"></i>
                {/* Plan 8 Phase 1 — wordmark reads from BrandContext so an
                    admin renaming the product (e.g. "AlexUni") updates the
                    sidebar live. `text-black dark:text-white` on the wrapper
                    becomes the second-half color via currentColor. */}
                <h1 className={`text-2xl font-bold tracking-tight whitespace-nowrap transition-all duration-[450ms] ease-[cubic-bezier(0.22,1,0.36,1)] text-black dark:text-white overflow-hidden ${isExpanded ? 'opacity-100 max-w-[200px] ml-2' : 'opacity-0 max-w-0 ml-0'}`}><Logo /></h1>
            </button>
            <nav className="flex-grow space-y-2 overflow-y-auto overflow-x-hidden">
                {staticTopItems.map((item) => (<NavItem key={item.label} icon={item.icon} label={item.label} path={item.path || '#'} isExpanded={isExpanded} />))}
                {categories.map((category) => (
                    <Category
                        key={category.title}
                        {...category}
                        isExpanded={isExpanded}
                        isOpen={openCategory === category.title}
                        onClick={() => onCategoryClick(category.title)}
                    />
                ))}
            </nav>
            {/* Footer — Settings + Logout share one row when the sidebar
                is expanded so the chrome stays compact. Settings takes the
                left side (link + label), Logout sits on the right as an
                icon-only red button (label kept for screen readers via
                aria-label). When the sidebar is collapsed, both stack as
                icon-only buttons. */}
            <div className="mt-auto pt-4 border-t border-gray-400/30 dark:border-white/10 flex-shrink-0 space-y-1">
                <GuideLink isExpanded={isExpanded} />
                {isExpanded ? (
                    <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <NavItem icon="ph-gear" label="Settings" path={settingsPath} isExpanded={isExpanded} />
                        </div>
                        <button
                            onClick={handleLogout}
                            aria-label={tr('Log out')}
                            title={tr('Log out')}
                            className="flex items-center justify-center h-10 w-10 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                        >
                            <i className="ph-bold ph-sign-out text-lg" />
                        </button>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <NavItem icon="ph-gear" label="Settings" path={settingsPath} isExpanded={isExpanded} />
                        <button
                            onClick={handleLogout}
                            aria-label={tr('Log out')}
                            title={tr('Log out')}
                            className="w-full flex items-center justify-center h-10 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                            <i className="ph-bold ph-sign-out text-lg" />
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
};

interface HeaderProps {
    style?: React.CSSProperties;
    onMenuClick?: () => void;
}
const Header = React.forwardRef<HTMLElement, HeaderProps>(({ style, onMenuClick }, ref) => {
    const { searchTerm, setSearchTerm, userRole, language, setLanguage } = useAppContext();
    const isRtl = language === 'ar';
    const { unreadCount } = useNotifications();
    const t = useT();
    const tr = useTr();
    const navigate = useNavigate();
    const location = useLocation();
    const profilePath = `/${userRole}/view-profile`;
    // Plan 8 Phase 4 — hide the global search input on pages that have no
    // content list to filter (chat, settings, dashboards, etc.).
    const { hideSearchBar } = resolveRouteFlags(location.pathname);
    // Plan 9 mobile pass — search bar is always visible on mobile (the
    // earlier collapse-to-icon experiment was reverted per owner feedback).
    // Width is `flex-1` of the remaining header slot so the input fills the
    // available width between the hamburger and the right-side controls.
    const [userName, setUserName] = useState<string>('Guest');
    const [avatarUrl, setAvatarUrl] = useState<string>('');

    useEffect(() => {
        const firstName = localStorage.getItem('currentUserFirstName') || '';
        const lastName = localStorage.getItem('currentUserLastName') || '';
        if (firstName && lastName) {
            setUserName(`${firstName} ${lastName}`);
        }
    }, []);

    // Avatar URL: prefer the stored profile picture (kept in sync by the
    // ViewProfile page on upload + on profile load). If the user hasn't
    // uploaded one yet, return empty string and the render path falls back
    // to an initials avatar — no third-party pravatar.
    // The "uniflow:profile-updated" custom event lets us refresh without
    // a full page reload after the user changes their avatar.
    useEffect(() => {
        const computeUrl = () => {
            const stored = localStorage.getItem('currentUserPicture') || '';
            if (stored) {
                // Cache-bust on every header mount so a freshly-uploaded image
                // (same backend filename, new mtime) actually re-fetches.
                return stored.includes('?')
                    ? stored
                    : `${stored}?v=${localStorage.getItem('currentUserPictureV') || '1'}`;
            }
            return '';
        };
        setAvatarUrl(computeUrl());

        const onUpdate = () => setAvatarUrl(computeUrl());
        window.addEventListener('uniflow:profile-updated', onUpdate);
        window.addEventListener('storage', onUpdate); // cross-tab sync
        return () => {
            window.removeEventListener('uniflow:profile-updated', onUpdate);
            window.removeEventListener('storage', onUpdate);
        };
    }, []);

    return (
        <header ref={ref} style={style} className={`${glassCardStyle} fixed top-[calc(0.75rem+max(env(safe-area-inset-top,0px),47px))] md:top-[calc(2rem+env(safe-area-inset-top,0px))] ${isRtl ? 'md:left-8' : 'md:right-8'} w-[calc(100vw-1.5rem)] md:w-auto max-w-[640px] md:max-w-none px-3 md:px-8 py-3 md:py-4 flex justify-between items-center gap-2 md:gap-4 z-30`}>
            {/* Plan 9 mobile pass — hamburger trigger on the left edge. On
                desktop the sidebar is always rendered so this button is
                redundant (`md:hidden`). The button is role-aware via the
                drawer it opens, not directly. */}
            <button
                type="button"
                onClick={onMenuClick}
                aria-label={tr('Open menu')}
                className="md:hidden w-10 h-10 rounded-full bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 flex items-center justify-center text-black dark:text-white hover:ring-2 hover:ring-[#6A3FF4] transition-all flex-shrink-0"
            >
                <i className="ph-bold ph-list text-lg" />
            </button>

            {hideSearchBar ? (
                // Spacer keeps the right-side controls in their normal column
                // on desktop. On mobile the hamburger already sits in this slot,
                // so the spacer collapses (flex-1 still works to push right-side).
                <div className="flex-1 md:flex-none md:w-1/3 mr-0 md:mr-0" />
            ) : (
                // Always-visible search input on mobile + desktop. On mobile
                // the input fills the flex slot between the hamburger and the
                // right-side controls; on desktop the slot is fixed at md:w-1/3.
                <div className="relative flex-1 md:flex-none md:w-1/3 mr-0 md:mr-0">
                    <i className="ph-bold ph-magnifying-glass absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input
                        type="text"
                        placeholder={t('navbar.placeholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/50 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-lg py-2 md:py-2.5 pl-9 md:pl-12 pr-8 md:pr-4 text-sm md:text-base text-black dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4]"
                    />
                    {searchTerm && (
                        <button
                            type="button"
                            onClick={() => setSearchTerm('')}
                            aria-label={tr('Clear search')}
                            className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-gray-500 hover:text-black dark:hover:text-white"
                        >
                            <i className="ph-bold ph-x text-xs" />
                        </button>
                    )}
                </div>
            )}
            <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
                <button
                    onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
                    title={language === 'en' ? 'Switch to Arabic / التبديل إلى العربية' : 'Switch to English'}
                    className="w-8 h-8 md:w-10 md:h-10 bg-white/50 dark:bg-black/20 rounded-full flex items-center justify-center hover:ring-2 hover:ring-[#6A3FF4] transition-all border border-white/20 dark:border-white/10 text-black dark:text-white text-xs md:text-sm font-bold"
                    aria-label="Toggle language"
                >
                    {language === 'en' ? 'ع' : 'EN'}
                </button>
                <div onClick={() => navigate(profilePath)} className="flex items-center gap-2 md:gap-4 cursor-pointer group select-none">
                    <span className="hidden md:inline text-black dark:text-white font-medium transition-colors duration-200 group-hover:text-[#6A3FF4] dark:group-hover:text-[#c89eff]">{userName}</span>
                    {avatarUrl ? (
                        <img src={avatarUrl} alt="Portrait" className="w-8 h-8 md:w-10 md:h-10 rounded-full object-cover transition-all duration-200 group-hover:ring-2 group-hover:ring-[#6A3FF4]" />
                    ) : (
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-xs md:text-sm font-bold transition-all duration-200 group-hover:ring-2 group-hover:ring-[#6A3FF4]">
                            {(userName || '? ').split(' ').filter(Boolean).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('') || '?'}
                        </div>
                    )}
                </div>
                <button onClick={() => navigate(`/${userRole}/notifications`)} className="w-8 h-8 md:w-10 md:h-10 bg-white/50 dark:bg-black/20 rounded-full flex items-center justify-center hover:ring-2 hover:ring-[#6A3FF4] transition-all relative border border-white/20 dark:border-white/10">
                    <i className="ph-fill ph-bell text-black dark:text-white text-lg md:text-xl"></i>
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold px-1">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </button>
            </div>
        </header>
    );
});

/**
 * Route guard with optional role enforcement.
 *
 *   <ProtectedRoute>                       — only checks isAuthenticated.
 *   <ProtectedRoute requiredRole="admin">  — also enforces role; mismatched
 *                                            users get bounced to their own
 *                                            dashboard.
 *
 * This is the "you can only use your own dashboard" guard. Per-user
 * permission overrides surface inside the user's OWN role-scoped sidebar
 * (e.g. a student granted `Announcements:write` sees `/student/announcements/
 * manage`, NEVER `/admin/announcements/manage`). For the inner per-page
 * permission gate ("Can-Do?" check), wrap the route element with
 * <RequirePermission> from components/RequirePermission.tsx.
 */
const ProtectedRoute: React.FC<{
    children: ReactNode;
    requiredRole?: string | string[];
}> = ({ children, requiredRole }) => {
    const { isAuthenticated, userRole } = useAppContext();
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    if (requiredRole) {
        const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!allowed.includes(userRole)) {
            // Send the user to their own dashboard instead of letting them
            // wander into another role's URL prefix. The user IS their role;
            // permissions only decide which pages WITHIN their dashboard they
            // can use.
            return <Navigate to={`/${userRole}/dashboard`} replace />;
        }
    }
    return <>{children}</>;
};

const TransitionWrapper: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        return () => setIsMounted(false);
    }, []);

    return (
        <div
            // `min-h-full` (not `h-full`): the wrapper expands to fit
            // children instead of being capped at main's content height.
            // With `h-full` + overflow:visible, tall page children
            // visually extend BELOW the wrapper's box and overlap any
            // sibling spacer that comes after — that's why the bottom-of-
            // page spacer wasn't producing visible empty space above the
            // bubble bar. `min-h-full` keeps the wrapper full-height when
            // content is short (so the transition look still covers the
            // area) but lets it grow with tall content so the spacer
            // genuinely sits below the last card.
            className="w-full min-h-full transition-all duration-500 ease-out"
            style={{
                opacity: isMounted ? 1 : 0,
                transform: isMounted ? 'translateY(0)' : 'translateY(20px)'
            }}
        >
            {children}
        </div>
    );
};

interface UniversalLayoutProps {
    categories: DynamicCategory[];
    staticTopItems: DynamicCategoryItem[];
    onLogout: () => void;
    children: ReactNode;
}

/**
 * Permission-aware layout wrapper. Filters the role's native sidebar by
 * the live permission matrix and renders it.
 *
 * The Plan 5 "Granted Access" cross-role category was REMOVED — surfacing
 * admin nav inside a student sidebar (because a per-user permission
 * override was granted) made admin routes navigable from non-admin
 * roles. Backend gates still apply, but a student should never see admin
 * UI in their sidebar at all. If a non-default role needs a route,
 * promote the user to that role or build a role-scoped view of the
 * underlying data — don't bolt it onto the wrong dashboard.
 */
const PermissionAwareLayout: React.FC<{
    primaryRole: keyof typeof roleToConfigMap;
    onLogout: () => void;
    children: ReactNode;
}> = ({ primaryRole, onLogout, children }) => {
    const cfg = roleToConfigMap[primaryRole];
    const filtered = useFilteredNavCategories(cfg.categories, []);
    return (
        <UniversalDashboardLayout categories={filtered} staticTopItems={cfg.staticTopItems} onLogout={onLogout}>
            {children}
        </UniversalDashboardLayout>
    );
};

// Legacy alias for the admin route block — keeps prior route wiring readable.
const AdminLayout: React.FC<{ onLogout: () => void; children: ReactNode }> = (props) => (
    <PermissionAwareLayout primaryRole="admin" {...props} />
);

const UniversalDashboardLayout: React.FC<UniversalLayoutProps> = ({ categories, staticTopItems, onLogout, children }) => {
    const { isDarkMode, animationsEnabled, language } = useAppContext();
    const isRtl = language === 'ar';
    // Aurora dark-mode stops come from BrandContext so the admin Brand tab
    // can re-skin the atmosphere live without a rebuild.
    const brand = useBrand();
    // Aurora wants exactly 3 stops; pad with the last entry if the admin
    // saved fewer so the WebGL shader still has its expected uniform shape.
    const auroraStops = (() => {
        const src = brand.dark.backgroundColors;
        if (!src || src.length === 0) return ['#5A2AD4', '#7B5AFF', '#5A2AD4'] as [string, string, string];
        const last = src[src.length - 1];
        return [src[0] ?? last, src[1] ?? last, src[2] ?? last] as [string, string, string];
    })();
    const [openCategory, setOpenCategory] = useState<string | null>(null);
    const isSidebarExpanded = openCategory !== null;
    // Plan 9 mobile pass — controls the slide-in drawer triggered by the
    // hamburger in the Header. Lives at layout scope so it survives route
    // changes within the same role.
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
    const location = useLocation();
    // Auto-close the drawer on any route change so navigating from within
    // the drawer doesn't leave it sticky over the destination.
    useEffect(() => {
        setMobileDrawerOpen(false);
    }, [location.pathname]);

    const sidebarRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const mainRef = useRef<HTMLElement>(null);

    const handleCategoryClick = (title: string) => {
        setOpenCategory(prev => prev === title ? null : title);
    };

    const updateLayout = React.useCallback(() => {
        const isMobile = window.innerWidth < 768;
        const sidebarWidth = isMobile ? 0 : (isSidebarExpanded ? 256 : 80);
        const contentInset = isMobile ? 0 : (sidebarWidth + 32 + 32);
        // RTL: anchor header + main to `right` (sidebar is on right in RTL).
        // LTR: anchor to `left` (default — sidebar on left).
        const insetSide = isRtl ? 'right' : 'left';
        const otherSide = isRtl ? 'left' : 'right';

        if (isMobile) {
            // Plan 9 follow-up — on mobile the header is centered via
            // `left: 50%` + GSAP's `xPercent: -50` (= translateX(-50%)).
            gsap.set(headerRef.current, { clearProps: 'right', left: '50%', xPercent: -50 });
            gsap.set(mainRef.current, { clearProps: 'left,right' });
        } else {
            // Desktop — header / main anchor to the sidebar's INNER edge.
            // In LTR that's the sidebar's right edge → `left: contentInset`
            //   (className provides `right-0` on main + `md:right-8` on header).
            // In RTL that's the sidebar's left edge → `right: contentInset`
            //   (className provides `left-0` on main + `md:left-8` on header).
            // `clearProps` on the OPPOSITE side removes any inline-style
            // leftover from a previous language switch so the className-
            // defined opposite anchor takes effect.
            gsap.set(headerRef.current, { xPercent: 0, clearProps: otherSide });
            gsap.set(mainRef.current, { clearProps: otherSide });
            gsap.to(sidebarRef.current, { width: sidebarWidth, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
            gsap.to([headerRef.current, mainRef.current], { [insetSide]: contentInset, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
        }
    }, [isSidebarExpanded, isRtl]);

    useEffect(() => {
        updateLayout();
        const handleResize = () => updateLayout();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [updateLayout]);

    return (
        <ClickSpark
            sparkColor={isDarkMode ? '#FFFFFF' : '#6A3FF4'}
            sparkSize={10}
            sparkRadius={15}
            sparkCount={8}
            duration={400}
        >
            <motion.div
                className="min-h-screen text-black dark:text-white font-sans bg-canvas-light dark:bg-canvas-dark relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="fixed top-0 left-0 w-screen h-[100lvh] z-0">
                    {/* iPhone 14 Pro fix — Aurora's fragment shader was
                       modified to use `max(uv.y, 1.0 - uv.y)` instead of
                       `uv.y` for the height calculation, so the canvas is
                       vibrant at BOTH top AND bottom edges (instead of
                       only at the top). With that change the live Aurora
                       reaches behind both the Dynamic Island AND the home
                       indicator on iPhone 14 Pro — no static gradient
                       fill, no canvas stretching needed.
                       Explicit `w-screen h-[100lvh]` (instead of
                       `inset-0 w-full h-full`) sidesteps containing-block
                       traps from Framer Motion ancestors with
                       `will-change: transform` — viewport units are always
                       measured against the visual viewport regardless of
                       the parent's box.
                       `lvh` (LARGE viewport height) NOT `dvh` (DYNAMIC) —
                       Android edge-to-edge mode has `dvh` exclude the
                       transparent system-bar zones; using `dvh` left the
                       page's body bg (white in light mode) showing
                       through under the bubble bar. `lvh` matches the
                       body's `100lvh` so Aurora bleeds to the same edge. */}
                    {/* Aurora (WebGL, additive blending) only works on a dark canvas —
                       its `intensity * rampColor` math darkens any pale stop on white
                       into a muddy wash. Light mode uses a CSS-gradient-blob backdrop
                       instead, which keeps the canvas clean white and gives translucent
                       cards a real glass-morphic surface to bleed through. */}
                    {/* Plan 8 follow-up — when the user disables animations,
                        the background should freeze too. Aurora is a WebGL
                        rAF loop (CSS overrides don't touch it), so we pass
                        speed=0 to halt the shader uniform increment.
                        LightModeBackground's blobs use CSS keyframes — those
                        are already covered by the global `.no-anim` rule. */}
                    {isDarkMode ? (
                        <Aurora
                            // `key` forces a clean Aurora remount when the
                            // admin saves new stops — the WebGL uniforms are
                            // initialised once on mount, so swapping the
                            // prop alone wouldn't visibly re-skin until the
                            // next page reload.
                            key={auroraStops.join('|')}
                            colorStops={auroraStops}
                            blend={1}
                            amplitude={animationsEnabled ? 1.0 : 0}
                            speed={animationsEnabled ? 0.5 : 0}
                        />
                    ) : (
                        <LightModeBackground />
                    )}
                </div>

                <motion.div
                    ref={sidebarRef}
                    // Sidebar mirrors to the opposite screen edge in Arabic
                    // (RTL). `position: fixed` ignores logical properties,
                    // so we toggle physical `left-8` vs `right-8`. The
                    // slide-in animation also flips sign so the sidebar
                    // always enters from the edge it's anchored to.
                    className={`fixed top-8 ${isRtl ? 'right-8' : 'left-8'} h-[calc(100vh-4rem)] z-40 hidden md:block`}
                    style={{ width: 80 }}
                    initial={{ opacity: 0, x: isRtl ? 30 : -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1, duration: 0.5, type: 'spring', stiffness: 200, damping: 24 }}
                >
                    <Sidebar onLogout={onLogout} categories={categories} staticTopItems={staticTopItems} isExpanded={isSidebarExpanded} openCategory={openCategory} onCategoryClick={handleCategoryClick} />
                </motion.div>

                <div className="md:hidden">
                    <MobileNavbar />
                    <MobileSidebarDrawer
                        open={mobileDrawerOpen}
                        onClose={() => setMobileDrawerOpen(false)}
                        onLogout={onLogout}
                    />
                </div>

                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                    <Header
                        ref={headerRef}
                        // Plan 9 follow-up — positioning lives entirely in
                        // GSAP's updateLayout (which already runs on mount
                        // + resize). On mobile it sets `left: 50%` +
                        // `xPercent: -50`; on desktop it sets `left:
                        // sidebar-edge`. No inline React style needed —
                        // having both fight produced the half-off-screen
                        // header on first mobile render.
                        onMenuClick={() => setMobileDrawerOpen(true)}
                    />
                </motion.div>

                <motion.main
                    ref={mainRef}
                    // pt-32 (128 px) on desktop clears the fixed header
                    // (top-8 = 32 px + py-4·2 = 32 px + ~40 px content ≈ 104 px
                    // tall) with a comfortable ~24 px breathing gap. Mobile
                    // pt-28 mirrors the same spacing for the smaller header.
                    // env(safe-area-inset-top) is added ONLY to pt so content
                    // clears the notch-shifted header; the mask gradient stays
                    // anchored at 7rem/8rem so the fade-in length doesn't grow
                    // on notched devices (a longer fade reads as a dim band).
                    className={`fixed top-0 bottom-0 ${isRtl ? 'left-0' : 'right-0'} overflow-y-auto pt-[calc(7rem+max(env(safe-area-inset-top,0px),47px))] md:pt-[calc(8rem+env(safe-area-inset-top,0px))] px-3 sm:px-4 md:px-8 md:pb-8 [mask-image:linear-gradient(to_bottom,transparent,black_7rem,black_calc(100%-4rem),transparent)] md:[mask-image:linear-gradient(to_bottom,transparent,black_8rem,black_calc(100%-4rem),transparent)] w-full md:w-auto`}
                    style={{
                        [isRtl ? 'right' : 'left']: window.innerWidth < 768 ? 0 : (80 + 32 + 32),
                        transform: 'translateZ(0)',
                    }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.6, type: 'spring', stiffness: 180, damping: 22 }}
                >
                    <TransitionWrapper key={useLocation().pathname}>
                        {children}
                    </TransitionWrapper>
                    {/* Mobile-only bottom scroll spacer — guarantees the last
                        card on every page clears the floating bubble bar with
                        plenty of empty scroll space below.
                        We use an explicit spacer div instead of padding-bottom
                        on <main> because some page containers render with
                        height: 100% that absorbs main's padding and prevents
                        the scroll area from extending. A real DOM element
                        (block-level, fixed height, aria-hidden) reliably
                        adds scrollable space inside main's overflow region.
                        Height ≈ 28rem + iPhone home-indicator inset; that
                        gives ~380 px between the last card and the bubble
                        bar top on iPhone 14 Pro. `md:hidden` skips desktop
                        where there's no bubble bar. */}
                    <div
                        aria-hidden="true"
                        className="md:hidden"
                        style={{ height: 'calc(4rem + max(env(safe-area-inset-bottom, 0px), 34px))' }}
                    />
                </motion.main>
            </motion.div>
        </ClickSpark>
    );
};

const ChatroomWrapper: React.FC = () => { const { courseCode } = useParams<{ courseCode?: string }>(); return <Chatroom courseCode={courseCode} />; };

// --- Role Routes ---
const StudentRoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="courses" element={<Courses />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="assignments" element={<AssignmentsPageContent />} />
        <Route path="quizzes" element={<Quizzes />} />
        <Route path="forms" element={<AssignedForms />} />
        <Route path="forms/:id" element={<RespondForm />} />
        <Route path="online-lectures" element={<OnlineLecturesContent />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="mark-attendance" element={<MarkAttendance />} />
        <Route path="gpa-calculator" element={<GpaCalculator />} />
        <Route path="payments" element={<Payments />} />
        <Route path="payments/success" element={<PaymentSuccess />} />
        <Route path="registrations" element={<Registrations />} />
        <Route path="student-affairs" element={<StudentAffairs />} />
        <Route path="announcements" element={<Announcements />} />
        {/* Plan 5 — manage view appears only when Announcements:write is granted.
            Single composer entry for level-leader students; the Plan 7 Phase 5
            duplicate route `/announcements/compose` has been removed in favour
            of this canonical path. */}
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><NonAdminManageAnnouncements /></RequirePermission>
        } />
        {/* Plan 7 Phase 6 — financial aid list + apply form. */}
        <Route path="financial-aid" element={<FinancialAid />} />
        <Route path="financial-aid/apply" element={<FinancialAidApply />} />
        {/* Plan 7 follow-up — in-app live session room (Jitsi IFrame API). */}
        <Route path="live-session/:sessionId" element={<LiveSessionRoom />} />
        <Route path="faq-chatbot" element={<Chatbot />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="more" element={<More />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="full-transcript" element={<FullTranscript />} />
        <Route path="view-course/:courseCode" element={<ViewCourseContent />} />
        <Route path="chatroom/:courseCode?" element={<ChatroomWrapper />} />
        <Route path="settings" element={<StudentSettings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/student/dashboard" replace />} />
    </Routes>
);

const AdminRoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        {/* Read-only feed (everyone) + compose page (gated on Announcements:write). */}
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><AnnouncementsPage /></RequirePermission>
        } />
        <Route path="manage-courses" element={
            <RequirePermission category="Course Management" action="read"><CoursesManagementPage /></RequirePermission>
        } />
        <Route path="courses/:code" element={
            <RequirePermission category="Course Management" action="read"><ManageCourseDetail /></RequirePermission>
        } />
        <Route path="dashboard" element={<AdminDashboardContent />} />
        <Route path="revenue-overview" element={
            <RequirePermission category="Financial Management" action="read"><FinancialsPage /></RequirePermission>
        } />
        <Route path="financials/transactions/:id" element={
            <RequirePermission category="Financial Management" action="read"><TransactionDetailPage /></RequirePermission>
        } />
        <Route path="financials/defaulters/:userId" element={
            <RequirePermission category="Financial Management" action="read"><DefaulterDetailPage /></RequirePermission>
        } />
        <Route path="fee-management" element={
            <RequirePermission category="Financial Management" action="write"><FeeManagement /></RequirePermission>
        } />
        <Route path="service-requests" element={
            <RequirePermission category="Financial Management" action="write"><ServiceRequestsQueue /></RequirePermission>
        } />
        <Route path="issued-invoices" element={
            <RequirePermission category="Financial Management" action="write"><IssuedInvoices /></RequirePermission>
        } />
        <Route path="payroll" element={
            <RequirePermission category="Financial Management" action="write"><PayrollPage /></RequirePermission>
        } />
        <Route path="payroll/:id" element={
            <RequirePermission category="Financial Management" action="write"><PayrollRunDetailPage /></RequirePermission>
        } />
        {/* Plan 7 Phase 6 — financial aid admin queue + detail. */}
        <Route path="financial-aid" element={
            <RequirePermission category="Financial Management" action="read"><FinancialAidQueue /></RequirePermission>
        } />
        <Route path="financial-aid/:id" element={
            <RequirePermission category="Financial Management" action="read"><FinancialAidDetail /></RequirePermission>
        } />
        <Route path="user-management" element={
            <RequirePermission category="Faculty Management" action="read"><UserManagementPage /></RequirePermission>
        } />
        <Route path="users/:id/edit" element={
            <RequirePermission category="Faculty Management" action="write"><UserEditPage /></RequirePermission>
        } />
        <Route path="manage-students" element={
            <RequirePermission category="Faculty Management" action="read"><UserManagementPage /></RequirePermission>
        } />
        <Route path="manage-faculty" element={
            <RequirePermission category="Faculty Management" action="read"><UserManagementPage /></RequirePermission>
        } />
        <Route path="pending-activations" element={
            <RequirePermission category="Faculty Management" action="write"><PendingActivations /></RequirePermission>
        } />
        {/* Plan 8 / RBAC recovery — top-level Access Control. Per-user
            override matrix for any user, surfaced from the admin sidebar so
            it's not buried under Settings → Roles & Permissions → Overrides. */}
        <Route path="access-control" element={
            <RequirePermission category="Per-User Permissions" action="write"><AccessControlPage /></RequirePermission>
        } />
        {/* SA-side queues admin oversees. Each renders the existing SA
            component at /admin/* so admins stay inside their own role
            URL prefix and the role-gating in ProtectedRoute doesn't reject
            them (which it would for /sa/* since requiredRole="sa" there).
            SA components are path-agnostic — they call API_URLS.studentAffairs()
            directly and the backend endpoints accept both sa + admin scope. */}
        <Route path="complaints" element={
            <RequirePermission category="Complaints" action="read"><SAComplaints /></RequirePermission>
        } />
        <Route path="name-change-requests" element={
            <RequirePermission category="Name Change Requests" action="read"><SANameChangeRequests /></RequirePermission>
        } />
        <Route path="enrollment-workflows" element={
            <RequirePermission category="Enrollment Workflows" action="read"><SAEnrollmentWorkflows /></RequirePermission>
        } />
        {/* Consolidated student dossier — search any student to view their
            academic standing, warnings, attendance, financials, open cases. */}
        <Route path="reports" element={
            <RequirePermission category="Reports" action="read"><ReportsPage scope="admin" /></RequirePermission>
        } />
        {/* Drill-down targets used by the Reports page (and any other admin
            surface that links to a student's profile / attendance log).
            Same SA components — they're path-agnostic and the backend routes
            already accept both sa + admin scope. Gated on Student Management
            since these expose full student PII. */}
        <Route path="students/:id" element={
            <RequirePermission category="Student Management" action="read"><SAStudentProfileDetail /></RequirePermission>
        } />
        <Route path="students/:id/attendance" element={
            <RequirePermission category="Student Management" action="read"><SAStudentAttendanceHistory /></RequirePermission>
        } />
        <Route path="system-health" element={
            <RequirePermission category="Audit Logs" action="read"><SystemHealth /></RequirePermission>
        } />
        <Route path="audit-logs" element={
            <RequirePermission category="Audit Logs" action="read"><AuditLogs /></RequirePermission>
        } />
        {/* Plan 5 Phase 5 — staff chat across the 6 admin Firestore groups. */}
        <Route path="chatroom" element={
            <RequirePermission category="Staff Chat" action="read"><AdminChatroom /></RequirePermission>
        } />
        <Route path="forms" element={<AdminFormsList />} />
        <Route path="forms/composer" element={<AdminFormComposer />} />
        <Route path="forms/composer/:id" element={<AdminFormComposer />} />
        <Route path="forms/:id/responses" element={<AdminFormResponses />} />
        <Route path="analytics" element={
            <RequirePermission category="Analytics Dashboard" action="read"><Analytics /></RequirePermission>
        } />
        <Route path="grade-override" element={
            <RequirePermission category="Grading" action="read"><GradeOverride /></RequirePermission>
        } />
        <Route path="grade-override/:courseCode" element={
            <RequirePermission category="Grading" action="read"><GradeOverrideCoursePage /></RequirePermission>
        } />
        <Route path="grade-override/:courseCode/:userId" element={
            <RequirePermission category="Grading" action="read"><GradeOverrideStudentPage /></RequirePermission>
        } />
        <Route path="grade-overrides/history" element={
            <RequirePermission category="Grading" action="read"><GradeOverrideHistoryPage /></RequirePermission>
        } />
        <Route path="registration-control" element={
            <RequirePermission category="Course Management" action="write"><RegistrationControl /></RequirePermission>
        } />
        <Route path="halls" element={
            <RequirePermission category="Course Management" action="write"><HallsPage /></RequirePermission>
        } />
        <Route path="signin-locks" element={
            <RequirePermission category="Sign-In Locks" action="read"><SignInLocksPage /></RequirePermission>
        } />
        <Route path="timetable" element={
            <RequirePermission category="Course Management" action="read"><TimetablePage /></RequirePermission>
        } />
        <Route path="timetable/wizard" element={
            <RequirePermission category="Course Management" action="write"><TimetableWizardPage /></RequirePermission>
        } />
        <Route path="transcripts" element={<TranscriptsPage />} />
        <Route path="notifications" element={<Notifications />} />

        {/* Academic Settings — Plan 6 mergers.
            7 tabbed wrapper pages cover 17 of the old standalone pages.
            Each wrapper imports the legacy page's default export and
            renders it inside a tab — no functionality is deleted.
            Old paths redirect to the merged page (+ optional ?tab= so
            old bookmarks land on the right panel). */}
        {/* Merged wrapper guards use anyOf so a granular sidebar entry
            (e.g. Honors Policy) can deep-link into the wrapper without the
            user also needing Academic Settings:read. */}
        <Route path="academic/calendar" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Semester Calendar' },
            ]}><CalendarPage /></RequirePermission>
        } />
        <Route path="academic/course-settings" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Credit Hour Definition' },
            ]}><CourseSettingsPage /></RequirePermission>
        } />
        <Route path="academic/course-details" element={
            <RequirePermission category="Academic Settings" action="read"><CourseDetailsPage /></RequirePermission>
        } />
        <Route path="academic/degree-requirements" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Graduation Policy' },
            ]}><DegreeRequirementsPage /></RequirePermission>
        } />
        <Route path="academic/grade-policies" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Incomplete Policy' },
                { category: 'Repetition Policy' },
            ]}><GradePoliciesPage /></RequirePermission>
        } />
        <Route path="academic/academic-standing" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Honors Policy' },
            ]}><AcademicStandingPage /></RequirePermission>
        } />
        <Route path="academic/student-mobility" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Mobility Policy' },
                { category: 'Advisor Policy' },
            ]}><StudentMobilityPage /></RequirePermission>
        } />

        {/* Standalone Academic Settings pages that didn't merge — entity
            CRUD (Departments) and standalone policies (Schedule Policy,
            Registration Windows, External Credits, Auditors). */}
        <Route path="academic/departments" element={
            <RequirePermission anyOf={[
                { category: 'Academic Settings' },
                { category: 'Departments' },
            ]}><DepartmentsPage /></RequirePermission>
        } />
        <Route path="academic/schedule-policy" element={
            <RequirePermission category="Academic Settings" action="read"><SchedulePolicyPage /></RequirePermission>
        } />
        {/* Old /admin/academic/registration-windows bookmarks land on
            Registration Control where the same editor now lives. */}
        <Route path="academic/registration-windows" element={<Navigate to="/admin/registration-control" replace />} />
        <Route path="external-credits" element={
            <RequirePermission category="External Credits" action="read"><AdminExternalCredits /></RequirePermission>
        } />
        <Route path="auditors" element={
            <RequirePermission category="Auditors" action="read"><AdminAuditors /></RequirePermission>
        } />

        {/* Plan 6 Phase 7 — redirects from the old standalone paths to
            the new merged wrappers. Bookmarks keep working. */}
        <Route path="academic/semester-calendar" element={<Navigate to="/admin/academic/calendar?tab=semester" replace />} />
        <Route path="academic/course-configurations" element={<Navigate to="/admin/academic/course-settings?tab=config" replace />} />
        <Route path="academic/grading-rules" element={<Navigate to="/admin/academic/course-settings?tab=grading" replace />} />
        <Route path="academic/credit-hour-definition" element={<Navigate to="/admin/academic/course-settings?tab=credit-hours" replace />} />
        <Route path="academic/course-rules" element={<Navigate to="/admin/academic/course-details?tab=rules" replace />} />
        <Route path="academic/prerequisites" element={<Navigate to="/admin/academic/course-details?tab=prereqs" replace />} />
        <Route path="academic/level-progression" element={<Navigate to="/admin/academic/degree-requirements?tab=levels" replace />} />
        <Route path="academic/levels-attendance" element={<Navigate to="/admin/academic/degree-requirements?tab=attendance" replace />} />
        <Route path="academic/graduation-policy" element={<Navigate to="/admin/academic/degree-requirements?tab=graduation" replace />} />
        <Route path="academic/credit-limits" element={<Navigate to="/admin/academic/degree-requirements?tab=credits" replace />} />
        <Route path="academic/incomplete-policy" element={<Navigate to="/admin/academic/grade-policies?tab=incomplete" replace />} />
        <Route path="academic/repetition-policy" element={<Navigate to="/admin/academic/grade-policies?tab=repetition" replace />} />
        <Route path="academic/honors-policy" element={<Navigate to="/admin/academic/academic-standing?tab=honors" replace />} />
        <Route path="academic/suspension-policy" element={<Navigate to="/admin/academic/academic-standing?tab=suspension" replace />} />
        <Route path="academic/mobility-policy" element={<Navigate to="/admin/academic/student-mobility?tab=mobility" replace />} />
        <Route path="academic/advisor-policy" element={<Navigate to="/admin/academic/student-mobility?tab=advisor" replace />} />

        {/* admin settings */}
        <Route path="settings" element={<AdminSettingsPage onLogout={onLogout} />} />

        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
);

const TARoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<TADashboard />} />
        <Route path="courses" element={<TACourseOverview />} />
        <Route path="courses/:code" element={<TACourseDetail />} />
        <Route path="gradebook" element={<TAGrading />} />
        <Route path="quiz-management" element={<QuizManagement />} />
        <Route path="attendance" element={<TAAttendance />} />
        <Route path="materials" element={<TAMaterials />} />
        <Route path="schedule" element={<TALiveSessions />} />
        <Route path="live-sessions" element={<TALiveSessions />} />
        <Route path="live-session/:sessionId" element={<LiveSessionRoom />} />
        <Route path="chatroom" element={<TAChatroom />} />
        <Route path="forms" element={<TAFormsList />} />
        <Route path="forms/composer" element={<TAFormComposer />} />
        <Route path="forms/composer/:id" element={<TAFormComposer />} />
        <Route path="forms/:id/responses" element={<TAFormResponses />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><NonAdminManageAnnouncements /></RequirePermission>
        } />
        <Route path="notifications" element={<Notifications />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="settings" element={<TASettings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/ta/dashboard" replace />} />
    </Routes>
);

const ProfessorRoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<ProfessorDashboard />} />
        <Route path="course-overview" element={<ProfCourseOverview />} />
        <Route path="courses/:code" element={<ProfCourseDetail />} />
        {/* Plan 4 Phase 8 — academic advisor queue (Article 12). */}
        <Route path="advisees" element={<Advisees />} />
        <Route path="attendance" element={<ProfAttendance />} />
        <Route path="grading" element={<ProfGrading />} />
        <Route path="materials" element={<ProfMaterials />} />
        <Route path="live-sessions" element={<ProfLiveSessions />} />
        <Route path="live-session/:sessionId" element={<LiveSessionRoom />} />
        <Route path="chatroom" element={<ProfChatroom />} />
        <Route path="quiz-management" element={<QuizManagement />} />
        <Route path="gradebook" element={<ProfGradeBook />} />
        <Route path="broadcast" element={<ProfBroadcast />} />
        <Route path="forms" element={<ProfFormsList />} />
        <Route path="forms/composer" element={<ProfFormComposer />} />
        <Route path="forms/composer/:id" element={<ProfFormComposer />} />
        <Route path="forms/:id/responses" element={<ProfFormResponses />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><NonAdminManageAnnouncements /></RequirePermission>
        } />
        <Route path="notifications" element={<Notifications />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="settings" element={<ProfessorSettings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/professor/dashboard" replace />} />
    </Routes>
);

const SARoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<SADashboard />} />
        <Route path="student-profiles" element={<SAStudentProfiles />} />
        <Route path="students/:id" element={<SAStudentProfileDetail />} />
        <Route path="students/:id/attendance" element={<SAStudentAttendanceHistory />} />
        <Route path="enrollment" element={<SAEnrollment />} />
        <Route path="complaints" element={<SAComplaints />} />
        <Route path="requests" element={<SARequests />} />
        <Route path="payments" element={<SAPayments />} />
        {/* Read-only feed (everyone) + compose page (sa only) */}
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><SAAnnouncements /></RequirePermission>
        } />
        <Route path="name-changes" element={<SANameChangeRequests />} />
        {/* Plan 4 Phase 6 — enrollment workflows review queue. */}
        <Route path="enrollment-workflows" element={<SAEnrollmentWorkflows />} />
        <Route path="attendance-excuses" element={<SAAttendanceExcuses />} />
        <Route path="categories" element={<SACategories />} />
        {/* SA mirror of the admin Reports page — same component, scope="sa"
            so drill-down buttons land on /sa/* routes. */}
        <Route path="reports" element={
            <RequirePermission category="Reports" action="read"><ReportsPage scope="sa" /></RequirePermission>
        } />
        {/* SA aliases for the two finance pages that admins also use day-to-day.
            Same components, same backend endpoints — sa users pass the
            requireScope('financial') gate via admin⊇sa? No: sa is NOT a
            financial sub-scope, so the backend requireScope on those
            endpoints needs to accept sa explicitly. Where it doesn't, the
            page renders an empty state — acceptable since the SA workflow
            is the same pages-shaped triage view, not full CRUD. */}
        <Route path="fee-management" element={<FeeManagement />} />
        <Route path="service-requests" element={<ServiceRequestsQueue />} />
        <Route path="issued-invoices" element={<IssuedInvoices />} />
        <Route path="financial-aid" element={<FinancialAidQueue />} />
        <Route path="financial-aid/:id" element={<FinancialAidDetail />} />
        <Route path="forms" element={<SAFormsList />} />
        <Route path="forms/composer" element={<SAFormComposer />} />
        <Route path="forms/composer/:id" element={<SAFormComposer />} />
        <Route path="forms/:id/responses" element={<SAFormResponses />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="settings" element={<SASettings onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/sa/dashboard" replace />} />
    </Routes>
);

// Financial sub-role — read-only financial operations dashboard. All
// inner pages reuse the admin components (FinancialsPage,
// FeeManagement, PayrollPage, FinancialAidQueue, etc.) so changes to
// those surfaces propagate everywhere automatically.
const FinancialRoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<FinancialDashboard />} />
        <Route path="revenue-overview" element={<FinancialsPage />} />
        <Route path="financials/transactions/:id" element={<TransactionDetailPage />} />
        <Route path="financials/defaulters/:userId" element={<DefaulterDetailPage />} />
        {/* Standalone ledger view — focused single-purpose page so
            "Transactions" in the sidebar isn't a duplicate of Revenue
            Overview (which embeds the same ledger as one section). */}
        <Route path="transactions" element={<TransactionsLedger />} />
        <Route path="fee-management" element={<FeeManagement />} />
        <Route path="service-requests" element={<ServiceRequestsQueue />} />
        <Route path="issued-invoices" element={<IssuedInvoices />} />
        <Route path="payroll" element={<PayrollPage />} />
        <Route path="payroll/:id" element={<PayrollRunDetailPage />} />
        <Route path="financial-aid" element={<FinancialAidQueue />} />
        <Route path="financial-aid/:id" element={<FinancialAidDetail />} />
        {/* Communication — read-only feed + composer (if Announcements:write
            override granted) + staff chat + forms. AdminChatroom uses
            /api/chat/groups/me which auto-returns staff_all + staff_financials
            for financial role; no special filtering needed. */}
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><NonAdminManageAnnouncements /></RequirePermission>
        } />
        <Route path="chatroom" element={<AdminChatroom />} />
        <Route path="forms" element={<AdminFormsList />} />
        <Route path="forms/composer" element={<AdminFormComposer />} />
        <Route path="forms/composer/:id" element={<AdminFormComposer />} />
        <Route path="forms/:id/responses" element={<AdminFormResponses />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="settings" element={<AdminSettingsPage onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/financial/dashboard" replace />} />
    </Routes>
);

// IT sub-role — read-only platform observability. Reuses admin's
// SystemHealth, AuditLogs, Analytics, and SignInLocksPage components.
const ITRoutes: React.FC<RoleRoutesProps> = ({ onLogout }) => (
    <Routes>
        <Route path="dashboard" element={<ITDashboard />} />
        <Route path="system-health" element={<SystemHealth />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="signin-locks" element={<SignInLocksPage />} />
        {/* Communication — same shape as the financial role: chat-on-staff-groups
            via AdminChatroom (server returns staff_all + staff_it), read-only
            announcements feed, optional composer when Announcements:write is
            granted, and the shared forms surface. */}
        <Route path="announcements" element={<Announcements />} />
        <Route path="announcements/manage" element={
            <RequirePermission category="Announcements" action="write"><NonAdminManageAnnouncements /></RequirePermission>
        } />
        <Route path="chatroom" element={<AdminChatroom />} />
        <Route path="forms" element={<AdminFormsList />} />
        <Route path="forms/composer" element={<AdminFormComposer />} />
        <Route path="forms/composer/:id" element={<AdminFormComposer />} />
        <Route path="forms/:id/responses" element={<AdminFormResponses />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="view-profile" element={<ViewProfile />} />
        <Route path="settings" element={<AdminSettingsPage onLogout={onLogout} />} />
        <Route path="*" element={<Navigate to="/it/dashboard" replace />} />
    </Routes>
);


// --- MAIN APP CONTROLLER ---
// Orchestrates: AuthPage (exit) → UniFlowLoader (handshake) → Dashboard (entrance)
const App: React.FC = () => {
    const { isAuthenticated, userRole, setIsAuthenticated, setUserRole } = useAppContext();
    // Transition phases: 'idle' | 'exiting-auth' | 'loading' | 'entering-dashboard' | 'ready'
    const [phase, setPhase] = useState<'idle' | 'exiting-auth' | 'loading' | 'entering-dashboard' | 'ready'>(
        isAuthenticated ? 'ready' : 'idle'
    );

    const handleLogin = (role: UserRole) => {
        setUserRole(role);
        // Belt-and-suspenders: even if logout cleared the cache, an admin
        // logging in fresh in a never-logged-out tab should get a clean
        // permission fetch (no inherited state). Same reasoning as the
        // logout clear above.
        clearPermissionsCache();
        // Start the cinematic exit → loader → dashboard sequence
        setPhase('exiting-auth');
        // Phase 1: Auth card exit (0.6s) → Phase 2: Loader handshake
        setTimeout(() => {
            setIsAuthenticated(true);
            setPhase('loading');
            // Phase 2: Loader shows for 1.4s → Phase 3: Dashboard entrance
            setTimeout(() => {
                setPhase('entering-dashboard');
                // Phase 3: Dashboard slides up (0.7s) → Phase 4: Ready
                setTimeout(() => setPhase('ready'), 800);
            }, 1400);
        }, 650);
    };

    // Sign-out confirmation gate. Every entry point in the app (desktop
    // sidebar footer, mobile drawer footer, role Settings pages) calls
    // `handleLogout` — which now just opens this modal instead of tearing
    // the session down immediately. The actual cleanup + redirect lives in
    // `performLogout`, fired only when the user confirms.
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const handleLogout = () => {
        setShowLogoutConfirm(true);
    };
    const cancelLogout = () => setShowLogoutConfirm(false);
    const performLogout = () => {
        setShowLogoutConfirm(false);
        setPhase('idle');
        setIsAuthenticated(false);
        // Best-effort: tell the backend to forget this device's FCM token so
        // post-logout pushes don't keep arriving. No-op if FCM isn't wired.
        firebase.clearFcmTokenWithBackend().catch(() => {});
        // Standard Web Push (iOS PWA) — unsubscribe + drop the backend row.
        webpush.unsubscribeWebPush().catch(() => {});
        // Native shell — same teardown for @capacitor/push-notifications.
        nativePush.unregister().catch(() => {});
        // Drop the cached avatar URL so the next user's session starts with
        // a clean pravatar fallback instead of the previous user's photo.
        try {
            localStorage.removeItem('currentUserPicture');
            localStorage.removeItem('currentUserPictureV');
        } catch { /* ignore */ }
        // Clear the module-scope permissions cache too — without this, the
        // NEXT user to log in on the same tab inherits the PREVIOUS user's
        // permission matrix until they hard-refresh. That's the root cause
        // of the "only attendance heatmap visible on first login" bug: the
        // dashboard's per-permission gates rendered against stale data, and
        // the grid collapsed to a single column for the one widget that
        // happened to be allowed under that stale matrix.
        clearPermissionsCache();
        window.dispatchEvent(new CustomEvent('uniflow:profile-updated'));
    };

    const defaultDashboardPath = `/${userRole}/dashboard`;

    // Show loader during transition
    const showLoader = phase === 'loading';
    // Show auth when not authenticated and not in exit phase
    const showAuth = !isAuthenticated && phase !== 'exiting-auth';
    // Show auth exit animation
    const showAuthExit = phase === 'exiting-auth';

    return (
        <>
            <Routes>
                <Route path="/login" element={
                    showAuth ? (
                        <AuthPage onLogin={handleLogin} />
                    ) : showAuthExit ? (
                        /* Phase 1: shrink + fade the auth page over 0.6s.
                           Note: NO `filter: blur(...)` on this wrapper —
                           combining `fixed inset-0` with `filter` creates a
                           GPU compositing layer that some Chrome/Edge builds
                           render as a flat grey rectangle, hiding the form
                           entirely. Opacity + scale alone produces a clean
                           fade without the GPU side-effect. */
                        <motion.div
                            key="auth-exit"
                            initial={{ opacity: 1, scale: 1 }}
                            animate={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                            className="fixed inset-0 z-[60] anim-essential pointer-events-none"
                        >
                            <AuthPage onLogin={() => {}} />
                        </motion.div>
                    ) : (
                        <Navigate to={defaultDashboardPath} replace />
                    )
                } />
                <Route path="/" element={isAuthenticated ? <Navigate to={defaultDashboardPath} replace /> : <Navigate to="/login" replace />} />

                <Route path="/student/*" element={
                    <ProtectedRoute requiredRole="student">
                        <PermissionAwareLayout primaryRole="student" onLogout={handleLogout}>
                            <StudentRoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="/admin/*" element={
                    <ProtectedRoute requiredRole="admin">
                        <AdminLayout onLogout={handleLogout}>
                            <AdminRoutes onLogout={handleLogout} />
                        </AdminLayout>
                    </ProtectedRoute>
                } />

                <Route path="/ta/*" element={
                    <ProtectedRoute requiredRole="ta">
                        <PermissionAwareLayout primaryRole="ta" onLogout={handleLogout}>
                            <TARoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="/professor/*" element={
                    <ProtectedRoute requiredRole="professor">
                        <PermissionAwareLayout primaryRole="professor" onLogout={handleLogout}>
                            <ProfessorRoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="/sa/*" element={
                    <ProtectedRoute requiredRole="sa">
                        <PermissionAwareLayout primaryRole="sa" onLogout={handleLogout}>
                            <SARoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="/financial/*" element={
                    <ProtectedRoute requiredRole="financial">
                        <PermissionAwareLayout primaryRole="financial" onLogout={handleLogout}>
                            <FinancialRoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="/it/*" element={
                    <ProtectedRoute requiredRole="it">
                        <PermissionAwareLayout primaryRole="it" onLogout={handleLogout}>
                            <ITRoutes onLogout={handleLogout} />
                        </PermissionAwareLayout>
                    </ProtectedRoute>
                } />

                <Route path="*" element={<Navigate to={defaultDashboardPath} replace />} />
            </Routes>

            {/* Phase 2: Loader overlay — mesh background persists underneath */}
            <AnimatePresence>
                {showLoader && (
                    <UniFlowLoader key="transition-loader" message="Preparing your dashboard" />
                )}
            </AnimatePresence>

            {/* Phase 3: Dashboard entrance overlay (slide-up + fade-in with stagger) */}
            <AnimatePresence>
                {phase === 'entering-dashboard' && (
                    <motion.div
                        key="dashboard-entrance"
                        className="fixed inset-0 z-[55] pointer-events-none"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    />
                )}
            </AnimatePresence>

            {/* Sign-out confirmation modal — gates every logout entry point
                in the app so a misclick doesn't tear the session down. The
                actual cleanup + redirect lives in performLogout. */}
            <SignOutConfirmDialog
                open={showLogoutConfirm}
                onCancel={cancelLogout}
                onConfirm={performLogout}
            />
        </>
    );
};

interface SignOutConfirmDialogProps {
    open: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

const SignOutConfirmDialog: React.FC<SignOutConfirmDialogProps> = ({ open, onCancel, onConfirm }) => {
    const tr = useTr();
    // Esc-to-cancel, Enter-to-confirm — same keyboard contract as the rest
    // of the dialogs in the app.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onConfirm();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onCancel, onConfirm]);
    // Style mirrors SessionEndedOverlay (the canonical UniFlow modal pattern):
    //   - charcoal `#141414` glass card in dark mode (NOT the prior `#0d0d18`
    //     which read as blueish-black against the rest of the app)
    //   - top accent stripe in the brand purple gradient
    //   - icon in the brand-purple tint
    //   - destructive confirm button stays red (matches user mental model for
    //     "this kills my session"); cancel uses the brand glass treatment.
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="signout-confirm"
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm anim-essential"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="signout-confirm-title"
                >
                    {/* Backdrop — click to cancel */}
                    <button
                        type="button"
                        aria-label={tr('Cancel')}
                        onClick={onCancel}
                        className="absolute inset-0 cursor-default"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        className="relative w-full max-w-md rounded-2xl bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 shadow-2xl shadow-black/40 ring-1 ring-inset ring-white/30 dark:ring-white/5 backdrop-blur-2xl backdrop-saturate-150 overflow-hidden"
                    >
                        {/* Top accent stripe — same gradient as the brand buttons */}
                        <div className="h-1.5 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4]" />
                        <div className="p-6 sm:p-7 flex flex-col items-center text-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-[#6A3FF4]/15 dark:bg-[#6A3FF4]/20 flex items-center justify-center">
                                <i className="ph-bold ph-sign-out text-3xl text-[#6A3FF4]" />
                            </div>
                            <div>
                                <h2
                                    id="signout-confirm-title"
                                    className="text-black dark:text-white text-xl font-bold mb-1.5"
                                >
                                    {tr('Sign out?')}
                                </h2>
                                <p className="text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
                                    {tr('You will need to sign in again to access your dashboard.')}
                                </p>
                            </div>
                            <div className="w-full flex flex-col-reverse sm:flex-row gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    className="flex-1 py-2.5 px-5 rounded-xl text-sm font-semibold text-black dark:text-white bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 ring-1 ring-inset ring-black/10 dark:ring-white/10 transition-colors"
                                >
                                    {tr('Cancel')}
                                </button>
                                <button
                                    type="button"
                                    onClick={onConfirm}
                                    autoFocus
                                    className="flex-1 py-2.5 px-5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-500 to-red-600 hover:opacity-95 transition-opacity shadow-lg shadow-red-500/30"
                                >
                                    {tr('Sign out')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// --- ROOT WITH PROVIDER ---
const Root: React.FC = () => {
    const [appReady, setAppReady] = useState(false);

    // Auto-hiding scrollbars — toggle `html.is-scrolling` on every scroll
    // event, clear after 700ms of inactivity. The matching CSS rules in
    // index.css fade the thumb in/out via opacity transitions. Uses
    // capture-phase listener so it catches scroll events from any nested
    // overflow:auto container (not just the document).
    useEffect(() => {
        const html = document.documentElement;
        let timer: number | null = null;
        const onScroll = () => {
            html.classList.add('is-scrolling');
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                html.classList.remove('is-scrolling');
                timer = null;
            }, 700);
        };
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll, { capture: true });
            if (timer !== null) window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setAppReady(true);
            const htmlLoader = document.getElementById('app-loader');
            if (htmlLoader) {
                htmlLoader.classList.add('loaded');
                setTimeout(() => htmlLoader.remove(), 700);
            }
        }, 1200);
        return () => clearTimeout(timer);
    }, []);

    // Capacitor native shell wiring — status bar tint, splash hide, and
    // Android hardware-back routing through React Router. Safe no-op on web.
    useEffect(() => {
        bootstrapCapacitorShell().catch((err) =>
            console.warn('[Root] capacitor shell bootstrap failed:', err),
        );
    }, []);

    // Electron-only: tag the root element so CSS can push the existing
    // floating header down by the title-bar height (32px). Removing the
    // class on unmount keeps the rule strictly opt-in even if the
    // component remounts in a hybrid scenario.
    useEffect(() => {
        if (!isElectronApp()) return;
        document.documentElement.classList.add('is-electron');
        return () => document.documentElement.classList.remove('is-electron');
    }, []);

    return (
        <Router>
            {/* AppProvider OUTSIDE BrandProvider so BrandContext can read
                isDarkMode for theme-aware brand color + wordmark segment
                resolution. (Was reversed before — flipping the order so
                useBrand() consumers still work everywhere they did and
                BrandContext gains access to dark-mode state.) */}
            <AppProvider>
            <BrandProvider>
                <NotificationProvider>
                    <RegistrationProvider>
                        <AnimatePresence mode="wait">
                            {!appReady ? (
                                <UniFlowLoader key="boot-loader" message="Starting UniFlow" />
                            ) : (
                                <motion.div
                                    key="app"
                                    initial={{ opacity: 0, scale: 0.98, filter: 'blur(8px)' }}
                                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                                    className="w-full h-full"
                                >
                                    <App />
                                </motion.div>
                            )}
                        </AnimatePresence>
                        <ToastContainer />
                        <ImpersonationBanner />
                        <NetworkBanner />
                        {/* Global overlay shown when a session is kicked
                            (cross-browser sign-in or 15-min refresh fail).
                            Replaces the previous window.alert popup. */}
                        <SessionEndedOverlay />
                        {/* Electron-only frameless title bar. Renders null
                            on the web build via isElectronApp() guard. */}
                        <ElectronTitleBar />
                    </RegistrationProvider>
                </NotificationProvider>
            </BrandProvider>
            </AppProvider>
        </Router>
    );
};

export default Root;
