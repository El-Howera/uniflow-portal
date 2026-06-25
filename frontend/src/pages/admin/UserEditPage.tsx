// src/pages/admin/UserEditPage.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { formatMoney, useCurrency } from '../../utils/format';
import { downloadPayslipPdf, downloadTranscriptPdf } from '../../utils/pdfGenerator';
import { useAdvisorPolicy } from '../../utils/academicSettings';
import { useAppContext } from '../../context/AppContext';
import SAStudentProfileDetail from '../sa/SAStudentProfileDetail';
import PermissionOverridesPanel from './PermissionOverridesPanel';
import { useT } from '../../i18n';

const glassCardStyle =
    'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
    'w-full bg-white/5 dark:bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50 placeholder:text-gray-500';
const labelStyle = 'block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider';

interface AcademicBlock {
    program?: string | null;
    major?: string | null;
    gpa?: number;
    level?: number | string | null;
    totalCredits?: number;
    standing?: string;
}

interface UserProfile {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    emailVerified: boolean;
    activated?: boolean;
    phone?: string | null;
    secondaryEmail?: string | null;
    adminNotes?: string | null;
    // GET /api/profile/:id returns the academic block under `academic`.
    academic?: AcademicBlock;
    // Plan 4 Phase 8 — academic advisor (Article 12).
    isAcademicAdvisor?: boolean;
    academicAdvisorId?: string | null;
    // Per-student manual switch — when true, this student's registrations
    // route through their assigned advisor before SA review.
    requiresAdvisorApproval?: boolean;
    // Plan 5 Phase 7 — suspension state.
    suspendedAt?: string | null;
    suspendedReason?: string | null;
    deletedAt?: string | null;
}

interface DepartmentOption {
    id: string;
    code: string;
    name: string;
    description?: string | null;
    isActive?: boolean;
}

const STAFF_ROLES = ['professor', 'ta', 'sa', 'admin'];

// ─── Preview mock data ─────────────────────────────────────────────────────────
// Static user directory. Student rows are handled by SAStudentProfileDetail;
// this page renders staff (professor / ta / sa / financial / it / admin).
const MOCK_USERS: Record<string, UserProfile> = {
    'u-prof-fares': {
        id: 'u-prof-fares', firstName: 'Fares', lastName: 'Howera', email: 'fares.howera@fcds.edu',
        role: 'professor', emailVerified: true, activated: true, phone: '+20 100 123 4567',
        secondaryEmail: null, adminNotes: 'Department head — Computer Science.',
        isAcademicAdvisor: true, academicAdvisorId: null, suspendedAt: null, suspendedReason: null, deletedAt: null,
    },
    'u-ta-mona': {
        id: 'u-ta-mona', firstName: 'Mona', lastName: 'Salah', email: 'mona.salah@fcds.edu',
        role: 'ta', emailVerified: true, activated: true, phone: null,
        secondaryEmail: null, adminNotes: null,
        suspendedAt: null, suspendedReason: null, deletedAt: null,
    },
    'u-sa-hana': {
        id: 'u-sa-hana', firstName: 'Hana', lastName: 'Adel', email: 'hana.adel@fcds.edu',
        role: 'sa', emailVerified: true, activated: true, phone: '+20 122 987 6543',
        secondaryEmail: null, adminNotes: null,
        suspendedAt: null, suspendedReason: null, deletedAt: null,
    },
    'u-fin-mariam': {
        id: 'u-fin-mariam', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test',
        role: 'financial', emailVerified: true, activated: true, phone: null,
        secondaryEmail: null, adminNotes: null,
        suspendedAt: null, suspendedReason: null, deletedAt: null,
    },
    'u-it-omar': {
        id: 'u-it-omar', firstName: 'Omar', lastName: 'Hassan', email: 'it@uniflow.test',
        role: 'it', emailVerified: true, activated: true, phone: null,
        secondaryEmail: null, adminNotes: null,
        suspendedAt: null, suspendedReason: null, deletedAt: null,
    },
};

// Fallback when the route id isn't in the mock directory — renders a generic
// professor profile so the page always populates.
const buildFallbackUser = (id: string): UserProfile => ({
    id, firstName: 'Staff', lastName: 'Member', email: 'staff.member@fcds.edu',
    role: 'professor', emailVerified: true, activated: true, phone: null,
    secondaryEmail: null, adminNotes: null,
    suspendedAt: null, suspendedReason: null, deletedAt: null,
});

const MOCK_PROFESSORS: ProfessorOption[] = [
    { id: 'u-prof-fares', firstName: 'Fares', lastName: 'Howera', email: 'fares.howera@fcds.edu', isAcademicAdvisor: true },
    { id: 'u-prof-hala', firstName: 'Hala', lastName: 'Mansour', email: 'hala.mansour@fcds.edu', isAcademicAdvisor: true },
    { id: 'u-prof-tamer', firstName: 'Tamer', lastName: 'Fouad', email: 'tamer.fouad@fcds.edu', isAcademicAdvisor: false },
    { id: 'u-prof-rania', firstName: 'Rania', lastName: 'Kamel', email: 'rania.kamel@fcds.edu', isAcademicAdvisor: true },
];

const MOCK_ROLES: RoleListItem[] = [
    { id: 'r-student', name: 'student', description: 'Default student role', isSystem: true },
    { id: 'r-professor', name: 'professor', description: 'Teaching faculty', isSystem: true },
    { id: 'r-ta', name: 'ta', description: 'Teaching assistant', isSystem: true },
    { id: 'r-sa', name: 'sa', description: 'Student affairs', isSystem: true },
    { id: 'r-admin', name: 'admin', description: 'Full administrator', isSystem: true },
    { id: 'r-financial', name: 'financial', description: 'Financial operations', isSystem: true },
    { id: 'r-it', name: 'it', description: 'IT operations', isSystem: true },
    { id: 'r-level-leader', name: 'level-leader', description: 'Cohort communications lead', isSystem: false },
];

const MOCK_DEPARTMENTS: DepartmentOption[] = [
    { id: 'dept-01', code: '01', name: 'Computer Science', isActive: true },
    { id: 'dept-02', code: '02', name: 'Data Science', isActive: true },
    { id: 'dept-03', code: '03', name: 'Cybersecurity', isActive: true },
    { id: 'dept-cs', code: 'CS', name: 'Computer Science (legacy)', isActive: true },
    { id: 'dept-ma', code: 'MA', name: 'Mathematics', isActive: true },
];

const UserEditPage: React.FC = () => {
    const t = useT();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [user, setUser] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError, setFetchError] = useState('');

    // Form fields
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [emailVerified, setEmailVerified] = useState(false);

    // Phase 10 — admin-only contact fields
    const [phone, setPhone] = useState('');
    const [secondaryEmail, setSecondaryEmail] = useState('');
    const [adminNotes, setAdminNotes] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [saveSuccess, setSaveSuccess] = useState(false);

    const loadUser = useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        setFetchError('');
        // Preview mode — resolve the user from the static directory.
        const data = MOCK_USERS[id] ?? buildFallbackUser(id);
        setUser(data);
        setFirstName(data.firstName);
        setLastName(data.lastName);
        setEmail(data.email);
        setEmailVerified(data.emailVerified);
        setPhone(data.phone ?? '');
        setSecondaryEmail(data.secondaryEmail ?? '');
        setAdminNotes(data.adminNotes ?? '');
        setIsLoading(false);
    }, [id]);

    useEffect(() => {
        loadUser();
    }, [loadUser]);

    // Preview mode — persist the edits into local state only. No network.
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        setSubmitting(true);
        setSaveError('');
        setSaveSuccess(false);
        setUser((prev) =>
            prev
                ? {
                      ...prev,
                      firstName,
                      lastName,
                      email,
                      emailVerified,
                      phone: phone.trim() || null,
                      secondaryEmail: secondaryEmail.trim() || null,
                      adminNotes: adminNotes.trim() || null,
                  }
                : prev,
        );
        setSaveSuccess(true);
        setSubmitting(false);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <i className="ph-duotone ph-spinner animate-spin text-4xl text-[#6A3FF4]"></i>
            </div>
        );
    }

    if (fetchError || !user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <p className="text-red-400">{fetchError || t('admin.userNotFound')}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 rounded-xl bg-white/10 text-black dark:text-white hover:bg-white/20 transition-colors text-sm font-bold"
                >
                    {t('admin.goBack')}
                </button>
            </div>
        );
    }

    // For student rows, render the rich SA student profile view (personal
    // info + emergency contact + current enrollments + force-drop +
    // attendance + transcript + academic profile editor + advisor + …).
    // The component reads the `:id` URL param so it works under both
    // /admin/users/:id/edit and /sa/students/:id without changes. Admin
    // also gets every endpoint the page calls — they're all admin-or-sa.
    if (user.role === 'student') {
        return <SAStudentProfileDetail />;
    }

    return (
        <div className="pb-16 space-y-6 px-2 sm:px-0">
            {/* Header */}
            <AnimateOnView enabled={false}>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors text-black dark:text-white flex-shrink-0"
                        title={t('admin.goBackTip')}
                    >
                        <i className="ph-bold ph-arrow-left text-lg"></i>
                    </button>
                    <div>
                        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">
                            {t('admin.editUserTitle')} — {user.firstName} {user.lastName}
                        </h1>
                        <p className="text-black dark:text-gray-400 text-sm mt-0.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#6A3FF4]/20 text-[#7B5AFF] uppercase mr-2">{user.role}</span>
                            {user.email}
                        </p>
                    </div>
                </div>
            </AnimateOnView>

            {/* Edit form */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} p-6 sm:p-8`}>
                    <h2 className="text-black dark:text-white font-bold text-lg mb-6 flex items-center gap-2">
                        <i className="ph-bold ph-user-circle text-[#6A3FF4]"></i> {t('admin.profileInfoCardTitle')}
                    </h2>
                    <form onSubmit={handleSave} className="space-y-5">
                        {/* Name row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className={labelStyle}>{t('admin.firstNameLbl')}</label>
                                <input
                                    required
                                    type="text"
                                    value={firstName}
                                    onChange={e => setFirstName(e.target.value)}
                                    className={inputStyle}
                                    placeholder={t('admin.firstNamePlaceholder')}
                                />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.lastNameLbl')}</label>
                                <input
                                    required
                                    type="text"
                                    value={lastName}
                                    onChange={e => setLastName(e.target.value)}
                                    className={inputStyle}
                                    placeholder={t('admin.lastNamePlaceholder')}
                                />
                            </div>
                        </div>

                        {/* Email */}
                        <div>
                            <label className={labelStyle}>{t('admin.emailLbl')}</label>
                            <input
                                required
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className={inputStyle}
                                placeholder={t('admin.emailPlaceholderEdit')}
                            />
                        </div>

                        {/* Role (read-only) */}
                        <div>
                            <label className={labelStyle}>{t('admin.roleLbl')}</label>
                            <div className={`${inputStyle} text-gray-500 cursor-not-allowed capitalize`}>{user.role}</div>
                        </div>

                        {/* Status toggle */}
                        <div>
                            <label className={labelStyle}>{t('admin.accountStatusLblEd')}</label>
                            <div className="flex items-center gap-4 mt-1">
                                <button
                                    type="button"
                                    onClick={() => setEmailVerified(true)}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                        emailVerified
                                            ? 'bg-green-500/20 text-green-400 border-green-500/40'
                                            : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                                    }`}
                                >
                                    {t('admin.activeBtn')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEmailVerified(false)}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                        !emailVerified
                                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                                            : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                                    }`}
                                >
                                    {t('admin.inactiveBtn')}
                                </button>
                            </div>
                        </div>

                        {/* Feedback */}
                        {saveError && (
                            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                                {saveError}
                            </p>
                        )}
                        {saveSuccess && (
                            <p className="text-green-400 text-xs bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2">
                                {t('admin.saveChangesFmt')}
                            </p>
                        )}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => navigate(-1)}
                                className="border border-white/20 text-black dark:text-white font-bold px-5 py-2 rounded-xl hover:bg-white/10 transition-colors"
                            >
                                {t('admin.cancelBtnGen')}
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold px-5 py-2 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60"
                            >
                                {submitting ? t('admin.savingProgress') : t('admin.saveChangesBtnLbl')}
                            </button>
                        </div>
                    </form>
                </div>
            </AnimateOnView>

            {/* Phase 10 — Contact + admin notes */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} p-6 sm:p-8`}>
                    <h2 className="text-black dark:text-white font-bold text-lg mb-5 flex items-center gap-2">
                        <i className="ph-bold ph-address-book text-[#6A3FF4]"></i> {t('admin.contactNotesTitle')}
                        <span className="text-xs text-gray-500 font-normal ml-1">{t('admin.adminOnlyLabel')}</span>
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className={labelStyle}>{t('admin.phoneLbl')}</label>
                            <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className={inputStyle}
                                placeholder={t('admin.phonePlaceholder')}
                            />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.secondaryEmailLbl')}</label>
                            <input
                                type="email"
                                value={secondaryEmail}
                                onChange={(e) => setSecondaryEmail(e.target.value)}
                                className={inputStyle}
                                placeholder={t('admin.secondaryEmailPlaceholder')}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={labelStyle}>{t('admin.adminNotesLbl')}</label>
                        <textarea
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                            rows={3}
                            className={`${inputStyle} resize-y`}
                            placeholder={t('admin.adminNotesPlaceholder')}
                        />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">
                        {t('admin.contactSaveHint')}
                    </p>
                </div>
            </AnimateOnView>

            {/* Plan 5 Phase 7 — Account Status (suspend / unsuspend) */}
            <AnimateOnView enabled={false}>
                <AccountStatusCard user={user} onChanged={loadUser} />
            </AnimateOnView>

            {/* Plan 5 Phase 7 — Security (reset password, revoke tokens) */}
            <AnimateOnView enabled={false}>
                <SecurityCard userId={user.id} />
            </AnimateOnView>

            {/* Plan 5 Phase 6 + 7 — Communication (send notification, view-as) */}
            <AnimateOnView enabled={false}>
                <CommunicationCard user={user} />
            </AnimateOnView>

            {/* Plan 5 Phase 9 — Manual Enrol Course (student only) */}
            {user.role === 'student' && (
                <AnimateOnView enabled={false}>
                    <ManualEnrolCard userId={user.id} />
                </AnimateOnView>
            )}

            {/* Plan 5 Phase 10 — Generate Transcript PDF (student only) */}
            {user.role === 'student' && (
                <AnimateOnView enabled={false}>
                    <TranscriptPdfCard user={user} />
                </AnimateOnView>
            )}

            {/* Phase 10 — Employment (staff only) */}
            {STAFF_ROLES.includes(user.role) && (
                <AnimateOnView enabled={false}>
                    <EmploymentCard userId={user.id} userRole={user.role} />
                </AnimateOnView>
            )}

            {/* Phase 10 — Payroll history (staff only) */}
            {STAFF_ROLES.includes(user.role) && (
                <AnimateOnView enabled={false}>
                    <PayrollHistoryCard userId={user.id} />
                </AnimateOnView>
            )}

            {/* Role Assignments — Phase 6 RBAC */}
            <AnimateOnView enabled={false}>
                <RoleAssignmentsCard userId={user.id} primaryRole={user.role} />
            </AnimateOnView>

            {/* Plan 4 Phase 8 — Academic Advisor (Article 12) */}
            {(user.role === 'student' || user.role === 'professor') && (
                <AnimateOnView enabled={false}>
                    <AcademicAdvisorCard
                        userId={user.id}
                        userRole={user.role}
                        initialAdvisorId={user.academicAdvisorId ?? null}
                        initialIsAdvisor={!!user.isAcademicAdvisor}
                        initialRequiresApproval={!!user.requiresAdvisorApproval}
                    />
                </AnimateOnView>
            )}

            {/* Academic profile card — students only. Department + level are
                editable here; GPA / credits / standing remain read-only because
                they're computed by the transcript cascade. */}
            {user.role === 'student' && (
                <AnimateOnView enabled={false}>
                    <AcademicProfileCard userId={user.id} academic={user.academic} />
                </AnimateOnView>
            )}

            {/* Access Control — embedded per-user permission override matrix.
                Surfaces every category gated by the role + lets the admin grant
                or deny any of them for THIS user. Wraps the standalone
                PermissionOverridesPanel which lives at /admin/access-control too. */}
            <AnimateOnView enabled={false}>
                <div className={`${glassCardStyle} p-6 sm:p-8`}>
                    <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                        <i className="ph-bold ph-shield-check text-[#6A3FF4]"></i> {t('admin.accessControlPermsTitle')}
                    </h2>
                    <p className="text-gray-500 text-xs mb-5">
                        {t('admin.accessControlPermsHint')}
                    </p>
                    <PermissionOverridesPanel forcedUserId={user.id} hideHeader />
                </div>
            </AnimateOnView>
        </div>
    );
};

/* ─── Plan 4 Phase 8 — Academic Advisor Card ──────────────────────────────
 * Two flavours:
 *   - For a STUDENT row → "Academic Advisor" picker (GlassDropdown) populated
 *     from /api/admin/users?role=professor. Honours
 *     advisorPolicy.restrictPickerToFlaggedProfessors when set.
 *   - For a PROFESSOR row → "Available as academic advisor" toggle. PATCHes
 *     User.isAcademicAdvisor, which is purely a UI hint for the student picker.
 */
interface ProfessorOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isAcademicAdvisor?: boolean;
}

const AcademicAdvisorCard: React.FC<{
    userId: string;
    userRole: string;
    initialAdvisorId: string | null;
    initialIsAdvisor: boolean;
    initialRequiresApproval?: boolean;
}> = ({ userRole, initialAdvisorId, initialIsAdvisor, initialRequiresApproval = false }) => {
    const t = useT();
    const policy = useAdvisorPolicy();
    const [professors, setProfessors] = useState<ProfessorOption[]>([]);
    const [advisorId, setAdvisorId] = useState<string | null>(initialAdvisorId);
    const [isAdvisor, setIsAdvisor] = useState(initialIsAdvisor);
    // Per-student manual switch. Defaults to false — most students don't
    // gate on advisor approval. Admin flips this on for the subset that does.
    const [requiresApproval, setRequiresApproval] = useState(initialRequiresApproval);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState(false);

    useEffect(() => {
        if (userRole !== 'student') return;
        // Preview mode — static professor directory for the picker.
        setProfessors(MOCK_PROFESSORS);
    }, [userRole]);

    const flash = (kind: 'ok' | 'err', text?: string) => {
        if (kind === 'ok') {
            setOk(true);
            setErr(null);
            window.setTimeout(() => setOk(false), 2500);
        } else {
            setErr(text || t('admin.saveFailedShortUe'));
            setOk(false);
        }
    };

    // Preview mode — all advisor mutations update local state only. No network.
    const saveAdvisor = async (newId: string | null) => {
        setSaving(true);
        setAdvisorId(newId);
        flash('ok');
        setSaving(false);
    };

    const toggleRequiresApproval = async (next: boolean) => {
        setSaving(true);
        setRequiresApproval(next);
        flash('ok');
        setSaving(false);
    };

    const toggleAdvisorFlag = async (next: boolean) => {
        setSaving(true);
        setIsAdvisor(next);
        flash('ok');
        setSaving(false);
    };

    const candidates = userRole === 'student'
        ? (policy.restrictPickerToFlaggedProfessors
            ? professors.filter((p) => p.isAcademicAdvisor)
            : professors)
        : [];

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-user-focus text-[#6A3FF4]"></i> {t('admin.academicAdvisorHeading')}
                <span className="text-xs text-gray-500 font-normal ml-1">{t('admin.article12Label')}</span>
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {userRole === 'student'
                    ? t('admin.academicAdvisorStudentHint')
                    : t('admin.academicAdvisorProfHint')}
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {ok && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{t('admin.savedSimple')}</div>
            )}

            {userRole === 'student' ? (
                <>
                    {/* Manual trigger — when ON, this student's registrations
                        route through the assigned advisor before SA review.
                        When OFF (default), they go straight to SA. */}
                    <label className={labelStyle}>{t('admin.requiresAdvisorApprovalLbl')}</label>
                    <div className="flex items-center gap-3 mt-1 mb-5">
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => toggleRequiresApproval(!requiresApproval)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                requiresApproval
                                    ? 'bg-amber-500/20 text-amber-500 border-amber-500/40'
                                    : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                            }`}
                        >
                            {requiresApproval ? t('admin.yesGateRegistrations') : t('admin.noAutoPassSA')}
                        </button>
                        <span className="text-[11px] text-gray-500">
                            {requiresApproval
                                ? t('admin.advisorGateHintOn')
                                : t('admin.advisorGateHintOff')}
                        </span>
                    </div>

                    <label className={labelStyle}>{t('admin.assignedAdvisorLbl')}</label>
                    <GlassDropdown
                        value={advisorId ?? ''}
                        onChange={(v) => saveAdvisor(v ? String(v) : null)}
                        options={[
                            { value: '', label: t('admin.noneUnassigned') },
                            ...candidates.map((p) => ({
                                value: p.id,
                                label: t('admin.advisorEmailFmt', { firstName: p.firstName, lastName: p.lastName, email: p.email }),
                            })),
                        ]}
                        direction="auto"
                        className="w-full"
                    />
                    <p className="text-[11px] text-gray-500 mt-2">
                        {policy.restrictPickerToFlaggedProfessors
                            ? t('admin.advisorPickerCountFlagged', { n: candidates.length })
                            : t('admin.advisorPickerCountAll', { n: candidates.length })}
                        {t('admin.advisorPickerSavesHint')}
                    </p>
                </>
            ) : (
                <div>
                    <label className={labelStyle}>{t('admin.availableAsAdvisorLbl')}</label>
                    <div className="flex items-center gap-3 mt-1">
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => toggleAdvisorFlag(!isAdvisor)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                isAdvisor
                                    ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/40'
                                    : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                            }`}
                        >
                            {isAdvisor ? t('admin.yesFlagged') : t('admin.noNotAdvising')}
                        </button>
                        <span className="text-[11px] text-gray-500">
                            {t('admin.availableAsAdvisorHint')}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ─── Role Assignments Card ───────────────────────────────────────────────
 * Lists every role assigned to this user, lets the admin add/remove non-
 * primary roles. The primary role (matches User.role enum) is shown but
 * cannot be removed here — change User.role first if you want to swap it.
 */
interface RoleListItem {
    id: string;
    name: string;
    description?: string | null;
    isSystem: boolean;
    usersCount?: number;
    assignedAt?: string;
}

const RoleAssignmentsCard: React.FC<{ userId: string; primaryRole: string }> = ({ primaryRole }) => {
    const t = useT();
    const [allRoles, setAllRoles] = useState<RoleListItem[]>([]);
    const [assigned, setAssigned] = useState<RoleListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [selectedRoleId, setSelectedRoleId] = useState('');

    const refresh = useCallback(async () => {
        // Preview mode — static role catalog; the user's primary role is the only
        // assignment seeded so the add/remove flow has something to work with.
        setLoading(true);
        setError(null);
        setAllRoles(MOCK_ROLES);
        const primary = MOCK_ROLES.find((r) => r.name === primaryRole);
        setAssigned(primary ? [primary] : []);
        setLoading(false);
    }, [primaryRole]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Preview mode — assign adds the role to local state. No network.
    const handleAssign = async () => {
        if (!selectedRoleId) return;
        setPendingId(selectedRoleId);
        const role = allRoles.find((r) => r.id === selectedRoleId);
        if (role) setAssigned((prev) => [...prev, role]);
        setSelectedRoleId('');
        setPendingId(null);
    };

    // Preview mode — unassign removes the role from local state. No network.
    const handleUnassign = async (roleId: string) => {
        setPendingId(roleId);
        setAssigned((prev) => prev.filter((r) => r.id !== roleId));
        setPendingId(null);
    };

    // Roles available to ADD = every role not already assigned.
    const assignedIds = new Set(assigned.map((r) => r.id));
    const candidates = allRoles.filter((r) => !assignedIds.has(r.id));

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-5 flex items-center gap-2">
                <i className="ph-bold ph-shield-check text-[#6A3FF4]"></i> {t('admin.roleAssignmentsHeading')}
                <span className="text-xs text-gray-500 font-normal ml-1 capitalize">
                    {t('admin.primaryRolePrefix', { role: primaryRole })}
                </span>
            </h2>

            {error && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="animate-pulse h-24 rounded-xl bg-white/5"></div>
            ) : (
                <>
                    <div className="space-y-2 mb-4">
                        {assigned.length === 0 ? (
                            <p className="text-sm text-gray-500 italic">{t('admin.noRolesAssigned')}</p>
                        ) : (
                            assigned.map((r) => {
                                const isPrimary = r.name === primaryRole;
                                return (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between bg-white/5 dark:bg-black/10 rounded-xl px-4 py-2.5 border border-white/10"
                                    >
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-black dark:text-white text-sm font-medium capitalize truncate">{r.name}</span>
                                                {r.isSystem && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase tracking-wider">
                                                        {t('admin.systemRoleBadge')}
                                                    </span>
                                                )}
                                                {isPrimary && (
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                                                        {t('admin.primaryRoleBadge')}
                                                    </span>
                                                )}
                                            </div>
                                            {r.description && (
                                                <p className="text-xs text-gray-500 mt-0.5 truncate">{r.description}</p>
                                            )}
                                        </div>
                                        {!isPrimary && (
                                            <button
                                                onClick={() => handleUnassign(r.id)}
                                                disabled={pendingId === r.id}
                                                className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
                                            >
                                                <i className="ph-bold ph-x"></i> {t('admin.removeRole')}
                                            </button>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {candidates.length > 0 && (
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                            <GlassDropdown
                                value={selectedRoleId}
                                onChange={setSelectedRoleId}
                                options={[
                                    { value: '', label: t('admin.chooseRoleToAdd') },
                                    ...candidates.map((r) => ({
                                        value: r.id,
                                        label: r.description ? `${r.name} — ${r.description}` : r.name,
                                    })),
                                ]}
                                direction="up"
                                className="w-full"
                            />
                            <button
                                onClick={handleAssign}
                                disabled={!selectedRoleId || pendingId !== null}
                                className="px-4 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-60"
                            >
                                <i className="ph-bold ph-plus mr-1"></i> {t('admin.assignRoleBtn')}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

/* ─── Phase 10 — Employment Card ──────────────────────────────────────────
 * Lazy-creates / edits the EmployeeProfile row for a staff user.
 * Lives only on UserEditPage; staff don't edit their own employment data.
 */

interface EmployeeProfileShape {
    id?: string;
    employmentType?: string;
    hireDate?: string | null;
    terminationDate?: string | null;
    position?: string | null;
    office?: string | null;
    payrollId?: string | null;
    contractType?: string | null;
    baseSalary?: number | string;
    currency?: string;
    bankName?: string | null;
    bankAccount?: string | null;
    taxId?: string | null;
}

const EmploymentCard: React.FC<{ userId: string; userRole: string }> = ({ userId, userRole }) => {
    const t = useT();
    const currency = useCurrency();
    const [profile, setProfile] = useState<EmployeeProfileShape | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const load = useCallback(async () => {
        // Preview mode — seed a realistic employment profile. No network.
        setLoading(true);
        setErr(null);
        setProfile({
            id: `emp-${userId}`,
            employmentType: 'full_time',
            hireDate: '2022-09-01',
            terminationDate: null,
            position: 'Lecturer',
            office: 'Main Building · Room 214',
            payrollId: `PR-${userId.slice(-4).toUpperCase()}`,
            contractType: 'Permanent',
            baseSalary: 18000,
            currency,
            bankName: 'National Bank of Egypt',
            bankAccount: '****-****-1234',
            taxId: 'TAX-99812',
        });
        setLoading(false);
    }, [userId, currency]);

    useEffect(() => { load(); }, [load]);

    const update = (k: keyof EmployeeProfileShape, v: EmployeeProfileShape[keyof EmployeeProfileShape]) =>
        setProfile((p) => ({ ...(p || {}), [k]: v }));

    // Preview mode — persist edits into local state only. No network.
    const handleSave = async () => {
        if (!profile) return;
        setSaving(true);
        setErr(null);
        setSaved(false);
        setProfile((p) => ({
            ...(p || {}),
            baseSalary: typeof profile.baseSalary === 'number'
                ? profile.baseSalary
                : parseFloat(String(profile.baseSalary || 0)),
            currency: profile.currency || currency,
        }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setSaving(false);
    };

    if (loading) {
        return (
            <div className={`${glassCardStyle} p-6 sm:p-8`}>
                <div className="animate-pulse h-32 bg-white/5 rounded-xl" />
            </div>
        );
    }

    const dateValue = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-briefcase text-[#6A3FF4]"></i> {t('admin.employmentCardTitle')}
                <span className="text-xs text-gray-500 font-normal ml-1 capitalize">{t('admin.employmentRoleSuffix', { role: userRole })}</span>
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.employmentRecordHint')}
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {err}
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className={labelStyle}>{t('admin.employmentTypeLbl')}</label>
                    <GlassDropdown
                        value={profile?.employmentType ?? 'full_time'}
                        onChange={(v) => update('employmentType', v)}
                        options={[
                            { value: 'full_time', label: t('admin.employmentFullTime') },
                            { value: 'part_time', label: t('admin.employmentPartTime') },
                            { value: 'contract',  label: t('admin.employmentContract') },
                            { value: 'hourly',    label: t('admin.employmentHourly') },
                            { value: 'intern',    label: t('admin.employmentIntern') },
                        ]}
                        direction="auto"
                        className="w-full"
                    />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.positionLbl')}</label>
                    <input className={inputStyle} value={profile?.position ?? ''} onChange={(e) => update('position', e.target.value)} placeholder={t('admin.positionPlaceholder')} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.hireDateLbl')}</label>
                    <input type="date" className={`${inputStyle} [color-scheme:dark]`} value={dateValue(profile?.hireDate)} onChange={(e) => update('hireDate', e.target.value)} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.terminationDateLbl')}</label>
                    <input type="date" className={`${inputStyle} [color-scheme:dark]`} value={dateValue(profile?.terminationDate)} onChange={(e) => update('terminationDate', e.target.value)} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.officeLbl')}</label>
                    <input className={inputStyle} value={profile?.office ?? ''} onChange={(e) => update('office', e.target.value)} placeholder={t('admin.officePlaceholder')} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.payrollIdLbl')}</label>
                    <input className={inputStyle} value={profile?.payrollId ?? ''} onChange={(e) => update('payrollId', e.target.value)} placeholder={t('admin.payrollIdPlaceholder')} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.contractTypeLbl')}</label>
                    <input className={inputStyle} value={profile?.contractType ?? ''} onChange={(e) => update('contractType', e.target.value)} placeholder={t('admin.contractTypePlaceholder')} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.baseSalaryLbl', { currency: profile?.currency || currency })}</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={inputStyle}
                        value={profile?.baseSalary ?? 0}
                        onChange={(e) => update('baseSalary', parseFloat(e.target.value) || 0)}
                    />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.bankNameLbl')}</label>
                    <input className={inputStyle} value={profile?.bankName ?? ''} onChange={(e) => update('bankName', e.target.value)} />
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.bankAccountLbl')}</label>
                    <input className={inputStyle} value={profile?.bankAccount ?? ''} onChange={(e) => update('bankAccount', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                    <label className={labelStyle}>{t('admin.taxIdLbl')}</label>
                    <input className={inputStyle} value={profile?.taxId ?? ''} onChange={(e) => update('taxId', e.target.value)} />
                </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-5">
                {saved && <span className="text-green-400 text-xs">{t('admin.savedSimple')}</span>}
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                    {saving ? t('admin.savingEmpDots') : t('admin.saveEmployment')}
                </button>
            </div>
        </div>
    );
};

/* ─── Phase 10 — Payroll History Card ───────────────────────────────────── */

interface PayslipSummary {
    id: string;
    period: string;
    status: string;
    currency: string;
    gross: number;
    deductionsTotal: number;
    net: number;
    generatedAt: string;
}

const PayrollHistoryCard: React.FC<{ userId: string }> = ({ userId }) => {
    const t = useT();
    const [slips, setSlips] = useState<PayslipSummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Preview mode — synthesise a short payslip history. No network.
        const slipFor = (period: string, status: string): PayslipSummary => ({
            id: `slip-${userId}-${period.replace(/\s/g, '')}`,
            period,
            status,
            currency: 'EGP',
            gross: 18000,
            deductionsTotal: 2700,
            net: 15300,
            generatedAt: '2026-05-01T00:00:00.000Z',
        });
        setSlips([
            slipFor('May 2026', 'paid'),
            slipFor('Apr 2026', 'paid'),
            slipFor('Mar 2026', 'finalized'),
        ]);
        setLoading(false);
    }, [userId]);

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-5 flex items-center gap-2">
                <i className="ph-bold ph-receipt text-[#6A3FF4]"></i> {t('admin.payrollHistoryHeading')}
                <span className="text-xs text-gray-500 font-normal ml-1">{t('admin.latestSixLbl')}</span>
            </h2>
            {loading ? (
                <div className="animate-pulse h-24 bg-white/5 rounded-xl" />
            ) : slips.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('admin.noPayslipsYet')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-white/10 text-gray-500 uppercase text-xs">
                                <th className="text-left py-2 pr-4 font-bold">{t('admin.periodCol')}</th>
                                <th className="text-left py-2 pr-4 font-bold">{t('admin.statusCol')}</th>
                                <th className="text-right py-2 pr-4 font-bold">{t('admin.grossCol')}</th>
                                <th className="text-right py-2 pr-4 font-bold">{t('admin.deductionsCol')}</th>
                                <th className="text-right py-2 pr-4 font-bold">{t('admin.netCol')}</th>
                                <th className="text-right py-2 font-bold">{t('admin.pdfCol')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {slips.map((s) => (
                                <tr key={s.id} className="hover:bg-white/5 transition-colors">
                                    <td className="py-2 pr-4 text-black dark:text-white font-medium">{s.period}</td>
                                    <td className="py-2 pr-4">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                            s.status === 'paid'      ? 'bg-green-500/10 text-green-400'
                                            : s.status === 'finalized' ? 'bg-blue-500/10 text-blue-400'
                                            : s.status === 'cancelled' ? 'bg-red-500/10 text-red-400'
                                            : 'bg-yellow-500/10 text-yellow-400'
                                        }`}>{s.status}</span>
                                    </td>
                                    <td className="py-2 pr-4 text-right text-gray-400">{formatMoney(s.gross, { code: s.currency })}</td>
                                    <td className="py-2 pr-4 text-right text-red-400">−{formatMoney(s.deductionsTotal, { code: s.currency })}</td>
                                    <td className="py-2 pr-4 text-right font-bold text-black dark:text-white">{formatMoney(s.net, { code: s.currency })}</td>
                                    <td className="py-2 text-right">
                                        <button
                                            onClick={() => downloadPayslipPdf(s.id, 'admin')}
                                            className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold"
                                        >
                                            {t('admin.downloadShort')}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

/* ─── Academic Profile Card (student only) ────────────────────────────────
 * Editable: program (department picker), level. Read-only: GPA, total credits,
 * standing — those are computed by the transcript cascade and shouldn't be
 * hand-edited.
 *
 * Department list comes from /api/admin/departments which is the canonical
 * source after the Phase 2 follow-up that consolidated programs into the
 * departments table (codes 01–06 for FCDS programs + the legacy CS / MA / etc.).
 */
const AcademicProfileCard: React.FC<{ userId: string; academic?: AcademicBlock }> = ({ academic }) => {
    const t = useT();
    const [departments, setDepartments] = useState<DepartmentOption[]>([]);
    const [program, setProgram] = useState<string>(academic?.program ?? '');
    const [level, setLevel] = useState<string>(
        academic?.level !== null && academic?.level !== undefined ? String(academic.level) : ''
    );
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState(false);
    const [loadingDepts, setLoadingDepts] = useState(true);

    useEffect(() => {
        // Preview mode — static department list. No network.
        setLoadingDepts(true);
        const list = [...MOCK_DEPARTMENTS].sort((a, b) => {
            if ((a.isActive !== false) !== (b.isActive !== false)) {
                return a.isActive === false ? 1 : -1;
            }
            return (a.code || '').localeCompare(b.code || '');
        });
        setDepartments(list);
        setLoadingDepts(false);
    }, []);

    // Preview mode — persist the program/level into local component state only.
    const handleSave = async () => {
        setSaving(true);
        setErr(null);
        setOk(false);
        setOk(true);
        window.setTimeout(() => setOk(false), 2000);
        setSaving(false);
    };

    const departmentOptions = [
        { value: '', label: t('admin.noDepartmentAssigned') },
        ...departments
            .filter((d) => d.isActive !== false || d.code === program) // keep selected even if deactivated
            .map((d) => ({
                value: d.code,
                label: `${d.code} — ${d.name}`,
            })),
    ];

    const levelOptions = [
        { value: '', label: t('admin.notSet') },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: t('admin.levelN', { n }) })),
    ];

    const gpa = academic?.gpa;
    const totalCredits = academic?.totalCredits ?? 0;
    const standing = academic?.standing ?? '—';

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-graduation-cap text-[#6A3FF4]"></i> {t('admin.academicProfileHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.academicProfileHint')}
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {ok && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{t('admin.academicProfileSaved')}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                    <label className={labelStyle}>{t('admin.departmentProgramLbl')}</label>
                    {loadingDepts ? (
                        <div className={`${inputStyle} text-gray-500 italic`}>{t('admin.loadingDepartmentsDots')}</div>
                    ) : (
                        <GlassDropdown
                            value={program}
                            onChange={(v) => setProgram(v)}
                            options={departmentOptions}
                            direction="auto"
                            className="w-full"
                        />
                    )}
                    <p className="text-[11px] text-gray-500 mt-1.5">
                        {departments.length > 0
                            ? t('admin.nDeptsAvailable', { n: departments.filter((d) => d.isActive !== false).length })
                            : t('admin.noDepartmentsConfigured')}
                    </p>
                </div>
                <div>
                    <label className={labelStyle}>{t('admin.academicLevelLblShort')}</label>
                    <GlassDropdown
                        value={level}
                        onChange={(v) => setLevel(v)}
                        options={levelOptions}
                        direction="auto"
                        className="w-full"
                    />
                    <p className="text-[11px] text-gray-500 mt-1.5">
                        {t('admin.fcdsLevelHint')}
                    </p>
                </div>
            </div>

            {/* Read-only computed fields */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <i className="ph-bold ph-chart-bar text-[#7B5AFF]"></i> {t('admin.gpaShort')}
                    </p>
                    <p className="text-black dark:text-white font-bold text-base">
                        {typeof gpa === 'number' ? gpa.toFixed(2) : '—'}
                    </p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <i className="ph-bold ph-medal text-[#7B5AFF]"></i> {t('admin.creditsShort')}
                    </p>
                    <p className="text-black dark:text-white font-bold text-base">{totalCredits}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                        <i className="ph-bold ph-stack text-[#7B5AFF]"></i> {t('admin.standingShort')}
                    </p>
                    <p className="text-black dark:text-white font-bold text-base capitalize">{standing}</p>
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving || loadingDepts}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-60 flex items-center gap-2"
                >
                    {saving ? (
                        <><i className="ph-bold ph-spinner-gap animate-spin"></i> {t('admin.savingEmpDots')}</>
                    ) : (
                        <><i className="ph-bold ph-floppy-disk"></i> {t('admin.saveAcademicProfileBtn')}</>
                    )}
                </button>
            </div>
        </div>
    );
};

/* ─── Plan 5 Phase 7 — Account Status Card ────────────────────────────────
 * Suspend / Unsuspend a user. Suspended users see `account_inactive` on
 * login (backend enforces this). Suspend revokes refresh tokens server-side.
 */
const AccountStatusCard: React.FC<{ user: UserProfile; onChanged: () => void | Promise<void> }> = ({
    user,
    onChanged,
}) => {
    const t = useT();
    const [showSuspend, setShowSuspend] = useState(false);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const flash = (text: string) => {
        setOk(text);
        window.setTimeout(() => setOk(null), 3000);
    };

    // Preview mode — suspend mutates the in-memory mock store so loadUser picks
    // up the change on the parent's onChanged() reload. No network.
    const handleSuspend = async () => {
        if (reason.trim().length < 3) {
            setErr(t('admin.reasonMinChars'));
            return;
        }
        setSubmitting(true);
        setErr(null);
        if (MOCK_USERS[user.id]) {
            MOCK_USERS[user.id].suspendedAt = new Date().toISOString();
            MOCK_USERS[user.id].suspendedReason = reason.trim();
        }
        setShowSuspend(false);
        setReason('');
        flash(t('admin.accountSuspendedFlash'));
        await onChanged();
        setSubmitting(false);
    };

    const handleUnsuspend = async () => {
        setSubmitting(true);
        setErr(null);
        if (MOCK_USERS[user.id]) {
            MOCK_USERS[user.id].suspendedAt = null;
            MOCK_USERS[user.id].suspendedReason = null;
        }
        flash(t('admin.accountReactivatedFlash'));
        await onChanged();
        setSubmitting(false);
    };

    const isSuspended = !!user.suspendedAt;

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-shield-warning text-[#6A3FF4]"></i> {t('admin.accountStatusHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.accountStatusHint')}
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {ok && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{ok}</div>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-4">
                {isSuspended ? (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/40 uppercase tracking-wider">
                        <i className="ph-bold ph-prohibit mr-1"></i> {t('admin.suspendedBadge')}
                    </span>
                ) : (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/40 uppercase tracking-wider">
                        <i className="ph-bold ph-check-circle mr-1"></i> {t('admin.activeBadgeUe')}
                    </span>
                )}
                {isSuspended && user.suspendedReason && (
                    <span className="text-xs text-gray-400">
                        {t('admin.reasonLabelInline')} <span className="text-black dark:text-white">{user.suspendedReason}</span>
                    </span>
                )}
            </div>

            <div className="flex gap-3">
                {isSuspended ? (
                    <button
                        type="button"
                        onClick={handleUnsuspend}
                        disabled={submitting}
                        className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                        {submitting ? t('admin.workingDots') : t('admin.unsuspendAccount')}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowSuspend(true)}
                        disabled={submitting}
                        className="bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-300 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                        {t('admin.suspendAccount')}
                    </button>
                )}
            </div>

            {showSuspend && (
                <Modal title={t('admin.suspendAccountTitle')} onClose={() => { if (!submitting) { setShowSuspend(false); setReason(''); } }}>
                    <p className="text-sm text-gray-300 mb-4">
                        {t('admin.suspendAccountHint')}
                    </p>
                    <label className={labelStyle}>{t('admin.reasonRangeLbl')}</label>
                    <textarea
                        rows={4}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                        className={`${inputStyle} resize-y`}
                        placeholder={t('admin.suspendReasonPlaceholderLong')}
                    />
                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => { setShowSuspend(false); setReason(''); }}
                            disabled={submitting}
                            className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            {t('admin.cancelBtnGen')}
                        </button>
                        <button
                            type="button"
                            onClick={handleSuspend}
                            disabled={submitting || reason.trim().length < 3}
                            className="bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-300 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                            {submitting ? t('admin.suspendingDots') : t('admin.suspendBtn')}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

/* ─── Plan 5 Phase 7 — Security Card ───────────────────────────────────────
 * Reset password (random or specific) + revoke all sessions.
 */
const SecurityCard: React.FC<{ userId: string }> = () => {
    const t = useT();
    const [showReset, setShowReset] = useState(false);
    const [resetMode, setResetMode] = useState<'random' | 'specific'>('random');
    const [newPassword, setNewPassword] = useState('');
    const [sendEmail, setSendEmail] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [resultPassword, setResultPassword] = useState<string | null>(null);
    const [resultEmailDelivered, setResultEmailDelivered] = useState<boolean | null>(null);
    const [copied, setCopied] = useState(false);

    const [showRevoke, setShowRevoke] = useState(false);
    const [revokeMessage, setRevokeMessage] = useState<string | null>(null);

    const openReset = () => {
        setShowReset(true);
        setResetMode('random');
        setNewPassword('');
        setSendEmail(true);
        setErr(null);
        setResultPassword(null);
        setResultEmailDelivered(null);
        setCopied(false);
    };

    // Preview mode — synthesise a temp password locally. No network.
    const handleReset = async () => {
        setErr(null);
        if (resetMode === 'specific' && newPassword.length < 8) {
            setErr(t('admin.pwMinChars'));
            return;
        }
        setSubmitting(true);
        const tempPassword = resetMode === 'specific'
            ? newPassword
            : `Uf-${Math.random().toString(36).slice(2, 8)}${Math.floor(Math.random() * 90 + 10)}!`;
        setResultPassword(tempPassword);
        setResultEmailDelivered(sendEmail);
        setSubmitting(false);
    };

    const copyPassword = async () => {
        if (!resultPassword) return;
        try {
            await navigator.clipboard.writeText(resultPassword);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            /* ignore */
        }
    };

    const closeReset = () => {
        if (submitting) return;
        setShowReset(false);
        setNewPassword('');
        setResultPassword(null);
        setResultEmailDelivered(null);
    };

    // Preview mode — flash a plausible revoke count. No network.
    const handleRevoke = async () => {
        setSubmitting(true);
        setRevokeMessage(t('admin.revokedNTokens', { n: 2 }));
        setShowRevoke(false);
        window.setTimeout(() => setRevokeMessage(null), 3000);
        setSubmitting(false);
    };

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-lock-key text-[#6A3FF4]"></i> {t('admin.securityHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.securityHint')}
            </p>

            {err && !showReset && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {revokeMessage && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{revokeMessage}</div>
            )}

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={openReset}
                    className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold"
                >
                    <i className="ph-bold ph-key mr-1.5"></i> {t('admin.resetPasswordBtn')}
                </button>
                <button
                    type="button"
                    onClick={() => setShowRevoke(true)}
                    className="bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-300 rounded-xl px-4 py-2 text-sm font-semibold"
                >
                    <i className="ph-bold ph-sign-out mr-1.5"></i> {t('admin.revokeAllSessionsBtn')}
                </button>
            </div>

            {showReset && (
                <Modal title={t('admin.resetPasswordTitle')} onClose={closeReset}>
                    {!resultPassword ? (
                        <>
                            {err && (
                                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
                            )}
                            <p className="text-sm text-gray-300 mb-4">
                                {t('admin.resetPasswordModalHint')}
                            </p>
                            <div className="flex gap-3 mb-5">
                                <button
                                    type="button"
                                    onClick={() => setResetMode('random')}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                        resetMode === 'random'
                                            ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/40'
                                            : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                                >
                                    {t('admin.generateRandom')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setResetMode('specific')}
                                    className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                                        resetMode === 'specific'
                                            ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/40'
                                            : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                                    }`}
                                >
                                    {t('admin.setSpecificPassword')}
                                </button>
                            </div>
                            {resetMode === 'specific' && (
                                <div className="mb-5">
                                    <label className={labelStyle}>{t('admin.newPasswordMinLbl')}</label>
                                    <input
                                        type="text"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className={inputStyle}
                                        placeholder={t('admin.enterNewPasswordPlaceholder')}
                                        minLength={8}
                                    />
                                </div>
                            )}
                            <div onClick={() => setSendEmail(!sendEmail)} className="flex items-center gap-2 mb-5 cursor-pointer w-fit">
                                <GlassCheckbox checked={sendEmail} onChange={setSendEmail} size="sm" />
                                <span className="text-sm text-black dark:text-white">{t('admin.emailNewPassword')}</span>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={closeReset}
                                    disabled={submitting}
                                    className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                                >
                                    {t('admin.cancelBtnGen')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleReset}
                                    disabled={submitting}
                                    className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                                >
                                    {submitting ? t('admin.resettingDots') : t('admin.resetPasswordSmall')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-green-300 mb-4">
                                <i className="ph-bold ph-check-circle mr-1"></i> {t('admin.passwordResetSuccess')}
                            </p>
                            <label className={labelStyle}>{t('admin.temporaryPasswordLbl')}</label>
                            <div className="flex gap-2 items-center mb-3">
                                <code className="flex-1 font-mono text-base bg-black/30 border border-white/15 rounded-xl px-3 py-2 text-[#7B5AFF] select-all">
                                    {resultPassword}
                                </code>
                                <button
                                    type="button"
                                    onClick={copyPassword}
                                    className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-3 py-2 text-xs font-bold"
                                >
                                    {copied ? (
                                        <><i className="ph-bold ph-check mr-1"></i> {t('admin.copiedShort')}</>
                                    ) : (
                                        <><i className="ph-bold ph-copy mr-1"></i> {t('admin.copyShort')}</>
                                    )}
                                </button>
                            </div>
                            {resultEmailDelivered === true && (
                                <p className="text-xs text-green-300 mb-4">
                                    <i className="ph-bold ph-envelope-simple mr-1"></i> {t('admin.emailedToUser')}
                                </p>
                            )}
                            {resultEmailDelivered === false && (
                                <p className="text-xs text-yellow-300 mb-4">
                                    <i className="ph-bold ph-warning mr-1"></i> {t('admin.emailNotDelivered')}
                                </p>
                            )}
                            <p className="text-[11px] text-gray-500 mb-4">
                                {t('admin.showOncePwHint')}
                            </p>
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={closeReset}
                                    className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold"
                                >
                                    {t('admin.doneBtn')}
                                </button>
                            </div>
                        </>
                    )}
                </Modal>
            )}

            {showRevoke && (
                <Modal title={t('admin.revokeAllSessionsTitle')} onClose={() => { if (!submitting) setShowRevoke(false); }}>
                    <p className="text-sm text-gray-300 mb-5">
                        {t('admin.revokeAllSessionsHint')}
                    </p>
                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setShowRevoke(false)}
                            disabled={submitting}
                            className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            {t('admin.cancelBtnGen')}
                        </button>
                        <button
                            type="button"
                            onClick={handleRevoke}
                            disabled={submitting}
                            className="bg-red-500/15 border border-red-500/40 hover:bg-red-500/25 text-red-300 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                            {submitting ? t('admin.revokingDots') : t('admin.revokeAllShort')}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

/* ─── Plan 5 Phase 6 + 7 — Communication Card ──────────────────────────────
 * Send a notification to this user. View-as-user (impersonation) button
 * lives here too. View-as is hidden when already impersonating, when the
 * target IS the admin themselves, or when the target is soft-deleted.
 */
const NOTIFY_PRIORITY_KEYS: { value: string; labelKey: string }[] = [
    { value: 'low',      labelKey: 'admin.priorityLow' },
    { value: 'normal',   labelKey: 'admin.priorityNormal' },
    { value: 'info',     labelKey: 'admin.priorityInfo' },
    { value: 'warning',  labelKey: 'admin.priorityWarning' },
    { value: 'critical', labelKey: 'admin.priorityCritical' },
];

const CommunicationCard: React.FC<{ user: UserProfile }> = ({ user }) => {
    const t = useT();
    const { impersonation } = useAppContext();

    const [showNotify, setShowNotify] = useState(false);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [priority, setPriority] = useState<string>('normal');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const [showViewAs, setShowViewAs] = useState(false);
    const [viewAsErr, setViewAsErr] = useState<string | null>(null);
    const [viewAsSubmitting, setViewAsSubmitting] = useState(false);

    // Hide View-as when:
    //   • The admin is already impersonating someone (avoid nested view-as)
    //   • The target is the admin themselves
    //   • The target is soft-deleted
    const adminUserId = localStorage.getItem('currentUserId');
    const canViewAs = !impersonation && user.id !== adminUserId && !user.deletedAt;

    const flash = (text: string) => {
        setOk(text);
        window.setTimeout(() => setOk(null), 3000);
    };

    const openNotify = () => {
        setShowNotify(true);
        setTitle('');
        setBody('');
        setPriority('normal');
        setErr(null);
    };

    // Preview mode — flash the sent confirmation. No network.
    const handleSend = async () => {
        setErr(null);
        if (title.trim().length < 3) {
            setErr(t('admin.titleMinErr'));
            return;
        }
        if (body.trim().length < 3) {
            setErr(t('admin.messageMinErr'));
            return;
        }
        setSubmitting(true);
        setShowNotify(false);
        flash(t('admin.notificationSentFlash'));
        setSubmitting(false);
    };

    // Preview mode — view-as is disabled (no impersonation session). The button
    // closes the dialog and surfaces an explanatory message. No network, no
    // localStorage swap.
    const handleViewAsConfirm = async () => {
        setViewAsSubmitting(true);
        setViewAsErr(null);
        window.setTimeout(() => {
            setShowViewAs(false);
            setViewAsSubmitting(false);
        }, 400);
    };

    const notifyPriorityOptions = NOTIFY_PRIORITY_KEYS.map((p) => ({ value: p.value, label: t(p.labelKey) }));

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-chats-circle text-[#6A3FF4]"></i> {t('admin.communicationHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.communicationHint')}
            </p>

            {ok && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{ok}</div>
            )}

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={openNotify}
                    className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold"
                >
                    <i className="ph-bold ph-paper-plane-tilt mr-1.5"></i> {t('admin.sendNotificationBtn')}
                </button>
                {canViewAs && (
                    <button
                        type="button"
                        onClick={() => setShowViewAs(true)}
                        className="border border-[#6A3FF4]/40 bg-[#6A3FF4]/10 hover:bg-[#6A3FF4]/20 text-[#7B5AFF] rounded-xl px-4 py-2 text-sm font-semibold"
                    >
                        <i className="ph-bold ph-eye mr-1.5"></i> {t('admin.viewAsUserBtn')}
                    </button>
                )}
            </div>

            {showNotify && (
                <Modal title={t('admin.notifyUserModal', { firstName: user.firstName, lastName: user.lastName })} onClose={() => { if (!submitting) setShowNotify(false); }}>
                    {err && (
                        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
                    )}
                    <div className="space-y-4">
                        <div>
                            <label className={labelStyle}>{t('admin.titleRangeLbl')}</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className={inputStyle}
                                placeholder={t('admin.titlePlaceholder')}
                                maxLength={200}
                            />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.messageRangeLbl')}</label>
                            <textarea
                                rows={5}
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                className={`${inputStyle} resize-y`}
                                placeholder={t('admin.messagePlaceholderShort')}
                                maxLength={1000}
                            />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('admin.priorityLbl')}</label>
                            <GlassDropdown
                                value={priority}
                                onChange={setPriority}
                                options={notifyPriorityOptions}
                                direction="up"
                                className="w-full"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => setShowNotify(false)}
                            disabled={submitting}
                            className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            {t('admin.cancelBtnGen')}
                        </button>
                        <button
                            type="button"
                            onClick={handleSend}
                            disabled={submitting}
                            className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                            {submitting ? t('admin.sendingDots') : t('admin.sendBtn')}
                        </button>
                    </div>
                </Modal>
            )}

            {showViewAs && (
                <Modal title={t('admin.viewAsUserModal', { firstName: user.firstName, lastName: user.lastName })} onClose={() => { if (!viewAsSubmitting) setShowViewAs(false); }}>
                    {viewAsErr && (
                        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{viewAsErr}</div>
                    )}
                    <p className="text-sm text-gray-300 mb-2">
                        {t('admin.viewAsHintPrefix')}{' '}<span className="text-black dark:text-white font-semibold">{user.firstName} {user.lastName}</span>{' '}{t('admin.viewAsHintMid')}{' '}<span className="capitalize text-[#7B5AFF] font-semibold">{user.role}</span>{t('admin.viewAsHintSuffix')}
                    </p>
                    <ul className="text-xs text-gray-400 list-disc list-inside space-y-1 mb-5">
                        <li>{t('admin.viewAsBullet1')}</li>
                        <li>{t('admin.viewAsBullet2')}</li>
                        <li>{t('admin.viewAsBullet3')}</li>
                    </ul>
                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => setShowViewAs(false)}
                            disabled={viewAsSubmitting}
                            className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            {t('admin.cancelBtnGen')}
                        </button>
                        <button
                            type="button"
                            onClick={handleViewAsConfirm}
                            disabled={viewAsSubmitting}
                            className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                            {viewAsSubmitting ? t('admin.switchingDots') : t('admin.viewAsUserSmall')}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

/* ─── Plan 5 Phase 9 — Manual Enrol Course (student only) ─────────────────
 * Admin-only manual enrolment that can bypass selected gates. Lecture
 * section required, lab optional. Reason 5-500 chars required.
 */

interface CourseListItem {
    id: string;
    code: string;
    title?: string;
    name?: string;
}

interface SectionListItem {
    id: string;
    sectionId?: string;
    type?: string;
    capacity?: number;
    enrolled?: number;
}

const BYPASS_GATE_KEYS: { key: 'prereq' | 'level' | 'window' | 'credit_cap' | 'capacity' | 'semester' | 'advisor'; labelKey: string }[] = [
    { key: 'prereq',     labelKey: 'admin.bypassPrereq' },
    { key: 'level',      labelKey: 'admin.bypassLevel' },
    { key: 'window',     labelKey: 'admin.bypassWindow' },
    { key: 'credit_cap', labelKey: 'admin.bypassCreditCap' },
    { key: 'capacity',   labelKey: 'admin.bypassCapacity' },
    { key: 'semester',   labelKey: 'admin.bypassSemester' },
    { key: 'advisor',    labelKey: 'admin.bypassAdvisor' },
];

const ManualEnrolCard: React.FC<{ userId: string }> = () => {
    const t = useT();
    const [showModal, setShowModal] = useState(false);
    const [courses, setCourses] = useState<CourseListItem[]>([]);
    const [coursesLoading, setCoursesLoading] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState('');

    const [sections, setSections] = useState<SectionListItem[]>([]);
    const [sectionsLoading, setSectionsLoading] = useState(false);
    const [lectureSectionId, setLectureSectionId] = useState('');
    const [labSectionId, setLabSectionId] = useState('');

    const [bypassSet, setBypassSet] = useState<Set<string>>(new Set());
    const [reason, setReason] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState<string | null>(null);

    const openModal = async () => {
        setShowModal(true);
        setSelectedCourse('');
        setLectureSectionId('');
        setLabSectionId('');
        setSections([]);
        setBypassSet(new Set());
        setReason('');
        setErr(null);

        // Preview mode — static course catalog. No network.
        setCoursesLoading(true);
        setCourses([
            { id: 'c-cs101', code: 'CS101', title: 'Introduction to Computer Science' },
            { id: 'c-cs201', code: 'CS201', title: 'Data Structures & Algorithms' },
            { id: 'c-ma205', code: 'MA205', title: 'Linear Algebra' },
            { id: 'c-ds340', code: 'DS340', title: 'Machine Learning' },
        ]);
        setCoursesLoading(false);
    };

    const loadSections = useCallback(async (courseCode: string) => {
        if (!courseCode) {
            setSections([]);
            return;
        }
        // Preview mode — synthesise a lecture + two lab sections. No network.
        setSectionsLoading(true);
        const code = courseCode.toUpperCase();
        setSections([
            { id: `${code}-L1`, sectionId: 'L1', type: 'Lecture', capacity: 200, enrolled: 142 },
            { id: `${code}-B1`, sectionId: 'B1', type: 'Lab', capacity: 40, enrolled: 31 },
            { id: `${code}-B2`, sectionId: 'B2', type: 'Lab', capacity: 40, enrolled: 28 },
        ]);
        setSectionsLoading(false);
    }, []);

    useEffect(() => {
        if (selectedCourse) {
            setLectureSectionId('');
            setLabSectionId('');
            loadSections(selectedCourse);
        }
    }, [selectedCourse, loadSections]);

    const toggleGate = (key: string) => {
        setBypassSet((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const lectureSections = sections.filter((s) => (s.type ?? '').toLowerCase() === 'lecture');
    const labSections     = sections.filter((s) => (s.type ?? '').toLowerCase() === 'lab');

    const lectureOptions = [
        { value: '', label: t('admin.chooseLectureSection') },
        ...lectureSections.map((s) => ({
            value: s.id,
            label: `${s.sectionId ?? s.id}${typeof s.capacity === 'number' ? ` · ${s.enrolled ?? 0}/${s.capacity}` : ''}`,
        })),
    ];
    const labOptions = [
        { value: '', label: t('admin.noLabLbl') },
        ...labSections.map((s) => ({
            value: s.id,
            label: `${s.sectionId ?? s.id}${typeof s.capacity === 'number' ? ` · ${s.enrolled ?? 0}/${s.capacity}` : ''}`,
        })),
    ];
    const courseOptions = [
        { value: '', label: t('admin.chooseCourseLbl') },
        ...courses.map((c) => ({
            value: c.code,
            label: `${c.code} — ${c.title ?? c.name ?? ''}`,
        })),
    ];

    // Preview mode — flash the enrolment confirmation. No network.
    const handleSubmit = async () => {
        setErr(null);
        if (!lectureSectionId) {
            setErr(t('admin.pickLectureSectionErr'));
            return;
        }
        if (reason.trim().length < 5) {
            setErr(t('admin.reasonMin5Err'));
            return;
        }
        setSubmitting(true);
        setShowModal(false);
        setOk(t('admin.enrolledInFlash', { code: selectedCourse }));
        window.setTimeout(() => setOk(null), 3000);
        setSubmitting(false);
    };

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-plus-circle text-[#6A3FF4]"></i> {t('admin.manualEnrolmentHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.manualEnrolmentHint')}
            </p>

            {ok && (
                <div className="mb-4 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{ok}</div>
            )}

            <button
                type="button"
                onClick={openModal}
                className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold"
            >
                <i className="ph-bold ph-plus mr-1.5"></i> {t('admin.manuallyEnrolCourse')}
            </button>

            {showModal && (
                <Modal title={t('admin.manualCourseEnrolment')} onClose={() => { if (!submitting) setShowModal(false); }} wide>
                    {err && (
                        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <label className={labelStyle}>{t('admin.courseLbl')}</label>
                            {coursesLoading ? (
                                <div className={`${inputStyle} text-gray-500 italic`}>{t('admin.loadingCoursesDots')}</div>
                            ) : (
                                <GlassDropdown
                                    value={selectedCourse}
                                    onChange={setSelectedCourse}
                                    options={courseOptions}
                                    direction="up"
                                    className="w-full"
                                />
                            )}
                        </div>

                        {selectedCourse && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelStyle}>{t('admin.lectureSectionLbl')}</label>
                                    {sectionsLoading ? (
                                        <div className={`${inputStyle} text-gray-500 italic`}>{t('admin.loadingSectionsDots')}</div>
                                    ) : (
                                        <GlassDropdown
                                            value={lectureSectionId}
                                            onChange={setLectureSectionId}
                                            options={lectureOptions}
                                            direction="up"
                                            className="w-full"
                                        />
                                    )}
                                </div>
                                <div>
                                    <label className={labelStyle}>{t('admin.labSectionOptionalLbl')}</label>
                                    {sectionsLoading ? (
                                        <div className={`${inputStyle} text-gray-500 italic`}>{t('admin.loadingSectionsDots')}</div>
                                    ) : (
                                        <GlassDropdown
                                            value={labSectionId}
                                            onChange={setLabSectionId}
                                            options={labOptions}
                                            direction="up"
                                            className="w-full"
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className={labelStyle}>{t('admin.bypassGatesLbl')}</label>
                            <p className="text-[11px] text-gray-500 mb-2">{t('admin.bypassGatesHint')}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {BYPASS_GATE_KEYS.map((g) => {
                                    const checked = bypassSet.has(g.key);
                                    const label = t(g.labelKey);
                                    return (
                                        <div
                                            key={g.key}
                                            onClick={() => toggleGate(g.key)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors border ${
                                                checked
                                                    ? 'bg-[#6A3FF4]/10 border-[#6A3FF4]/40'
                                                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                                            }`}
                                        >
                                            <GlassCheckbox checked={checked} onChange={() => toggleGate(g.key)} size="sm" ariaLabel={label} />
                                            <span className="text-sm text-black dark:text-white">{label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <label className={labelStyle}>{t('admin.reasonManualEnrolLbl')}</label>
                            <textarea
                                rows={3}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className={`${inputStyle} resize-y`}
                                maxLength={500}
                                placeholder={t('admin.reasonManualEnrolPlaceholder')}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => setShowModal(false)}
                            disabled={submitting}
                            className="border border-white/20 text-black dark:text-white font-bold px-4 py-2 rounded-xl hover:bg-white/10 transition-colors text-sm"
                        >
                            {t('admin.cancelBtnGen')}
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60"
                        >
                            {submitting ? t('admin.enrollingDots') : t('admin.enrolBtn')}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

/* ─── Plan 5 Phase 10 — Transcript PDF (student only) ─────────────────────
 * Thin wrapper around `downloadTranscriptPdf` from utils/pdfGenerator.
 * Pre-fills the student's display name + email so the PDF header is right.
 */
const TranscriptPdfCard: React.FC<{ user: UserProfile }> = ({ user }) => {
    const t = useT();
    const [downloading, setDownloading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const handleDownload = async () => {
        setDownloading(true);
        setErr(null);
        try {
            const ok = await downloadTranscriptPdf(user.id, {
                name: `${user.firstName} ${user.lastName}`.trim(),
                studentId: user.id,
                email: user.email,
                major: user.academic?.program ?? user.academic?.major ?? t('admin.undeclaredMajor'),
                isAdmin: true,
            });
            if (!ok) setErr(t('admin.transcriptCouldNotGenerate'));
        } catch (e) {
            setErr(e instanceof Error ? e.message : t('admin.transcriptFailedMsg'));
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className={`${glassCardStyle} p-6 sm:p-8`}>
            <h2 className="text-black dark:text-white font-bold text-lg mb-1 flex items-center gap-2">
                <i className="ph-bold ph-file-text text-[#6A3FF4]"></i> {t('admin.academicTranscriptHeading')}
            </h2>
            <p className="text-gray-500 text-xs mb-5">
                {t('admin.academicTranscriptHint')}
            </p>

            {err && (
                <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}

            <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="text-[#7B5AFF] hover:text-[#6A3FF4] text-xs font-bold disabled:opacity-60"
            >
                {downloading ? (
                    <><i className="ph-bold ph-spinner-gap animate-spin mr-1"></i> {t('admin.generatingDots')}</>
                ) : (
                    <><i className="ph-bold ph-download-simple mr-1"></i> {t('admin.generateTranscriptPdf')}</>
                )}
            </button>
        </div>
    );
};

/* ─── Shared modal shell ───────────────────────────────────────────────────
 * Portaled to document.body so the glass card's backdrop-filter doesn't clip
 * the overlay. Click-outside + Escape both dismiss.
 */
interface ModalProps {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    wide?: boolean;
}

const Modal: React.FC<ModalProps> = ({ title, onClose, children, wide = false }) => {
    const t = useT();
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={`${glassCardStyle} relative p-6 sm:p-8 w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
            >
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-black dark:text-white font-bold text-lg">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-black dark:text-white flex items-center justify-center"
                        aria-label={t('admin.closeAriaLabel')}
                    >
                        <i className="ph-bold ph-x"></i>
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body
    );
};

export default UserEditPage;
