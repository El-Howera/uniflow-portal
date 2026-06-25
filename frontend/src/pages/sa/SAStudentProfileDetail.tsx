import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { generateTranscriptPDF } from '../../utils/pdfGenerator';
import { useAdvisorPolicy } from '../../utils/academicSettings';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";
const inputStyle = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500";
const labelStyle = "block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider";

interface AcademicBlock {
    program?: string;
    major?: string;
    minor?: string;
    standing?: string;
    level?: number | null;
    advisor?: string;
    advisorEmail?: string;
    enrollmentDate?: string;
    expectedGraduation?: string;
    gpa?: number;
    totalCredits?: number;
    creditsThisSemester?: number;
    status?: string;
}

interface ProfileData {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    role: string;
    odID?: string;
    profilePicture?: string;
    dateOfBirth?: string | null;
    emailVerified?: boolean;
    secondaryEmail?: string | null;
    adminNotes?: string | null;
    academicAdvisorId?: string | null;
    requiresAdvisorApproval?: boolean;
    registeredDeviceId?: string | null;
    registeredDeviceLabel?: string | null;
    deviceRegisteredAt?: string | null;
    deviceReleaseAt?: string | null;
    deviceReleaseType?: string | null;
    academic?: AcademicBlock;
    address?: {
        street?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        country?: string;
    };
    emergencyContact?: {
        name?: string;
        relationship?: string;
        phone?: string;
        email?: string;
    };
}

interface DepartmentOption {
    id: string;
    code: string;
    name: string;
    isActive?: boolean;
}

interface ProfessorOption {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isAcademicAdvisor?: boolean;
}

interface EditableFields {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    ecName: string;
    ecRelationship: string;
    ecPhone: string;
    ecEmail: string;
}

interface RegistrationRow {
    id: string;
    status: string;
    courseCode: string;
    courseName: string;
    credits: number;
    department?: string | null;
    section: {
        id: string;
        sectionId?: string;
        type: string;
        instructor?: string | null;
        location?: string | null;
        room?: string | null;
        slots?: { day: string; start: string; end: string }[];
    };
}

const toDateInput = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
};

// ─── Mock data (MVP build — no backend) ────────────────────────────────────
const MOCK_PROFILE: ProfileData = {
    id: 'stu-001',
    firstName: 'Mariam',
    lastName: 'El-Sayed',
    email: 'mariam.elsayed@uniflow.edu',
    phone: '+20 100 123 4567',
    role: 'student',
    odID: 'CS-2024-0042',
    profilePicture: undefined,
    dateOfBirth: '2004-03-18',
    emailVerified: true,
    secondaryEmail: 'mariam.personal@gmail.com',
    adminNotes: 'Honors track candidate. Strong performance in algorithms.',
    academicAdvisorId: 'prof-002',
    requiresAdvisorApproval: true,
    registeredDeviceId: 'dev-abc123',
    registeredDeviceLabel: 'iPhone 14 Pro',
    deviceRegisteredAt: '2025-09-02T08:30:00.000Z',
    deviceReleaseAt: null,
    deviceReleaseType: null,
    academic: {
        program: 'CS',
        major: 'Computer Science',
        minor: 'Mathematics',
        standing: 'good',
        level: 3,
        advisor: 'Dr. Hany Sobhy',
        advisorEmail: 'hany.sobhy@uniflow.edu',
        enrollmentDate: '2024-09-01',
        expectedGraduation: '2028-06-30',
        gpa: 3.72,
        totalCredits: 84,
        creditsThisSemester: 15,
        status: 'active',
    },
    address: {
        street: '14 El-Nasr Street',
        city: 'Alexandria',
        state: 'Alexandria',
        zipCode: '21500',
        country: 'Egypt',
    },
    emergencyContact: {
        name: 'Hala El-Sayed',
        relationship: 'Mother',
        phone: '+20 122 987 6543',
        email: 'hala.elsayed@gmail.com',
    },
};

const MOCK_REGISTRATIONS: RegistrationRow[] = [
    {
        id: 'reg-001', status: 'approved', courseCode: 'CS301', courseName: 'Algorithms & Data Structures', credits: 3, department: 'CS',
        section: { id: 'sec-cs301-lec', sectionId: 'L1', type: 'Lecture', instructor: 'Dr. Hany Sobhy', location: 'Hall A2', room: 'A2', slots: [{ day: 'Sunday', start: '10:00', end: '11:30' }, { day: 'Tuesday', start: '10:00', end: '11:30' }] },
    },
    {
        id: 'reg-002', status: 'approved', courseCode: 'CS301', courseName: 'Algorithms & Data Structures', credits: 3, department: 'CS',
        section: { id: 'sec-cs301-lab', sectionId: 'S2', type: 'Lab', instructor: 'TA Mona Adel', location: 'Lab 3', room: '3', slots: [{ day: 'Wednesday', start: '13:00', end: '15:00' }] },
    },
    {
        id: 'reg-003', status: 'approved', courseCode: 'MA205', courseName: 'Linear Algebra', credits: 3, department: 'MA',
        section: { id: 'sec-ma205-lec', sectionId: 'L1', type: 'Lecture', instructor: 'Dr. Sara Naguib', location: 'Hall B1', room: 'B1', slots: [{ day: 'Monday', start: '09:00', end: '10:30' }] },
    },
    {
        id: 'reg-004', status: 'pending', courseCode: 'CS340', courseName: 'Database Systems', credits: 3, department: 'CS',
        section: { id: 'sec-cs340-lec', sectionId: 'L2', type: 'Lecture', instructor: 'Dr. Tamer Fares', location: 'Hall A1', room: 'A1', slots: [{ day: 'Thursday', start: '11:00', end: '12:30' }] },
    },
];

const MOCK_DEPARTMENTS: DepartmentOption[] = [
    { id: 'd1', code: 'CS', name: 'Computer Science', isActive: true },
    { id: 'd2', code: 'DS', name: 'Data Science', isActive: true },
    { id: 'd3', code: 'CYS', name: 'Cybersecurity', isActive: true },
    { id: 'd4', code: 'AI', name: 'Artificial Intelligence', isActive: true },
    { id: 'd5', code: 'SE', name: 'Software Engineering', isActive: true },
    { id: 'd6', code: 'MA', name: 'Mathematics', isActive: true },
];

const MOCK_PROFESSORS: ProfessorOption[] = [
    { id: 'prof-001', firstName: 'Hany', lastName: 'Sobhy', email: 'hany.sobhy@uniflow.edu', isAcademicAdvisor: true },
    { id: 'prof-002', firstName: 'Sara', lastName: 'Naguib', email: 'sara.naguib@uniflow.edu', isAcademicAdvisor: true },
    { id: 'prof-003', firstName: 'Tamer', lastName: 'Fares', email: 'tamer.fares@uniflow.edu', isAcademicAdvisor: true },
    { id: 'prof-004', firstName: 'Dina', lastName: 'Kamel', email: 'dina.kamel@uniflow.edu', isAcademicAdvisor: false },
];

const SAStudentProfileDetail: React.FC = () => {
    const t = useT();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    // Path-aware prefix so drill-down buttons stay inside the current
    // dashboard's URL space. `/sa/students/:id` → /sa/students/:id/attendance,
    // `/admin/users/:id/edit` (UserEditPage delegating to this component) →
    // /admin/students/:id/attendance. Without this, admin-area users were
    // bounced to /sa/* and hit ProtectedRoute's requiredRole="sa" guard.
    const dashboardPrefix = location.pathname.startsWith('/admin') ? '/admin' : '/sa';
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [isRevoking, setIsRevoking] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState('');
    const [actionMsg, setActionMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
    const [confirmDropId, setConfirmDropId] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [pdfBusy, setPdfBusy] = useState(false);
    const [photoVersion, setPhotoVersion] = useState(0);
    const [fields, setFields] = useState<EditableFields>({
        firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '',
        street: '', city: '', state: '', zipCode: '', country: '',
        ecName: '', ecRelationship: '', ecPhone: '', ecEmail: '',
    });

    const loadProfile = useCallback(async () => {
        if (!id) return;
        setIsLoading(true);
        setError('');
        // MVP build: populate from static mock data, no backend.
        const data: ProfileData = { ...MOCK_PROFILE, id };
        setProfile(data);
        setFields({
            firstName: data.firstName ?? '',
            lastName: data.lastName ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            dateOfBirth: toDateInput(data.dateOfBirth),
            street: data.address?.street ?? '',
            city: data.address?.city ?? '',
            state: data.address?.state ?? '',
            zipCode: data.address?.zipCode ?? '',
            country: data.address?.country ?? '',
            ecName: data.emergencyContact?.name ?? '',
            ecRelationship: data.emergencyContact?.relationship ?? '',
            ecPhone: data.emergencyContact?.phone ?? '',
            ecEmail: data.emergencyContact?.email ?? '',
        });
        setRegistrations(MOCK_REGISTRATIONS);
        setIsLoading(false);
    }, [id]);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    const handleChange = (key: keyof EditableFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFields(prev => ({ ...prev, [key]: e.target.value }));
        setSaveSuccess(false);
    };

    const handleSave = async () => {
        if (!id) return;
        setIsSaving(true);
        setError('');
        // MVP build: apply changes to local state only, no backend.
        setProfile(prev => prev ? {
            ...prev,
            firstName: fields.firstName,
            lastName: fields.lastName,
            email: fields.email,
            phone: fields.phone,
            dateOfBirth: fields.dateOfBirth || null,
            address: {
                street: fields.street,
                city: fields.city,
                state: fields.state,
                zipCode: fields.zipCode,
                country: fields.country,
            },
            emergencyContact: {
                name: fields.ecName,
                relationship: fields.ecRelationship,
                phone: fields.ecPhone,
                email: fields.ecEmail,
            },
        } : prev);
        setSaveSuccess(true);
        setIsSaving(false);
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow same-file re-pick
        if (!file || !id) return;
        if (!file.type.startsWith('image/')) {
            setActionMsg({ kind: 'error', text: t('sa.pleaseSelectImage') });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setActionMsg({ kind: 'error', text: t('sa.imageUnder5MB') });
            return;
        }
        setIsUploading(true);
        // MVP build: preview the picked image locally via an object URL.
        const localUrl = URL.createObjectURL(file);
        setProfile(prev => prev ? { ...prev, profilePicture: localUrl } : prev);
        setPhotoVersion(v => v + 1);
        setActionMsg({ kind: 'success', text: t('sa.profilePhotoUpdated') });
        setIsUploading(false);
    };

    // Drop the WHOLE course — every active section row for this student.
    // MVP build: optimistic local removal of the course's section rows.
    const handleForceDrop = async (courseCode: string) => {
        if (!id) return;
        setActionMsg({ kind: 'success', text: t('sa.courseDropped', { courseCode }) });
        setConfirmDropId(null);
        setRegistrations((prev) => prev.filter((r) => r.courseCode !== courseCode));
    };

    const handleDelete = async () => {
        if (!id) return;
        // MVP build: navigate back as if the student were deleted.
        navigate(-1);
    };

    // Grant a device release (Attendance Doc §3.5.3.5).
    //   'instant' → unbinds the device; the student can register a new one now.
    //   'normal'  → unbinds + starts a 48h cooldown (manual attendance meanwhile).
    const handleRelease = async (type: 'instant' | 'normal') => {
        if (!id) return;
        const ok = window.confirm(
            type === 'instant'
                ? 'Grant an instant device release? The current device is unbound and the student can register a new one immediately.'
                : 'Grant a 48-hour device release? The current device is unbound now and the student must wait 48h before registering a new one (manual attendance meanwhile).'
        );
        if (!ok) return;
        setIsRevoking(true);
        // MVP build: update local device state only.
        const releaseAt = type === 'normal' ? new Date(Date.now() + 48 * 3600000).toISOString() : null;
        setProfile(prev => prev ? {
            ...prev,
            registeredDeviceId: null, registeredDeviceLabel: null, deviceRegisteredAt: null,
            deviceReleaseAt: releaseAt,
            deviceReleaseType: type,
        } : prev);
        setActionMsg({
            kind: 'success',
            text: type === 'instant'
                ? 'Instant release granted — the student can register a new device now.'
                : '48-hour release granted — the cooldown is counting down.',
        });
        setIsRevoking(false);
    };

    const handleGenerateTranscript = async () => {
        if (!id || !profile) return;
        setPdfBusy(true);
        // MVP build: build the PDF from static mock transcript data.
        const mockCourses = [
            { code: 'CS101', name: 'Intro to Programming', credits: 3, grade: 'A', semester: 'Fall 2024' },
            { code: 'MA101', name: 'Calculus I', credits: 3, grade: 'A-', semester: 'Fall 2024' },
            { code: 'CS201', name: 'Object-Oriented Programming', credits: 3, grade: 'B+', semester: 'Spring 2025' },
            { code: 'MA205', name: 'Linear Algebra', credits: 3, grade: 'A', semester: 'Spring 2025' },
            { code: 'CS301', name: 'Algorithms & Data Structures', credits: 3, grade: 'IP', semester: 'Fall 2025' },
        ];
        generateTranscriptPDF({
            student: {
                name: `${profile.firstName} ${profile.lastName}`.trim(),
                studentId: profile.odID || profile.id,
                major: profile.academic?.major || 'Undeclared',
                email: profile.email || '',
                enrollmentDate: profile.academic?.enrollmentDate || '',
                expectedGraduation: profile.academic?.expectedGraduation || '',
            },
            courses: mockCourses,
            cumulativeGPA: profile.academic?.gpa ?? 0,
            totalCredits: profile.academic?.totalCredits ?? 0,
            totalEarned: profile.academic?.totalCredits ?? 0,
        });
        setActionMsg({ kind: 'success', text: t('sa.transcriptDownloaded') });
        setPdfBusy(false);
    };

    if (isLoading) {
        return (
            <div className="space-y-4 pb-16 px-2 sm:px-0">
                <div className="h-10 w-48 bg-white/5 animate-pulse rounded-xl"></div>
                <div className="h-64 w-full bg-white/5 animate-pulse rounded-2xl"></div>
            </div>
        );
    }

    if (error && !profile) {
        return (
            <div className="space-y-4 pb-16 px-2 sm:px-0">
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors text-sm font-semibold">
                    <i className="ph-bold ph-arrow-left"></i> {t('sa.backBtn')}
                </button>
                <div className={`${glassCardStyle} p-10 text-center`}>
                    <i className="ph-duotone ph-warning text-5xl text-red-400 mb-3 block"></i>
                    <p className="text-red-400 font-bold">{error}</p>
                </div>
            </div>
        );
    }

    const academic = profile?.academic;
    const major = academic?.major || 'Undeclared';
    const program = academic?.program || '—';
    const credits = academic?.totalCredits ?? 0;
    // Group section rows by courseCode so a lecture+lab pair renders as
    // ONE card (with both section pills inline) and the credits sum doesn't
    // double-count the same course.
    const enrollmentByCourse = new Map<string, RegistrationRow[]>();
    for (const r of registrations) {
        const key = r.courseCode || r.id;
        if (!enrollmentByCourse.has(key)) enrollmentByCourse.set(key, []);
        enrollmentByCourse.get(key)!.push(r);
    }
    const enrollmentGroups = Array.from(enrollmentByCourse.entries()).map(([courseCode, rows]) => ({
        courseCode,
        rows,
        credits: rows[0]?.credits || 0, // every section row carries the same Course.credits
        courseName: rows[0]?.courseName || courseCode,
        status: rows[0]?.status || 'pending',
    }));
    const semesterCredits = enrollmentGroups.reduce((sum, g) => sum + (g.credits || 0), 0);
    const dbLevel = academic?.level;
    const photoSrc = profile?.profilePicture
        ? `${profile.profilePicture}${profile.profilePicture.includes('?') ? '&' : '?'}v=${photoVersion}`
        : null;

    return (
        <div className="space-y-4 pb-16 px-2 sm:px-0">
            {/* Back + Header */}
            <AnimateOnView enabled={false}>
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-[#6A3FF4] transition-colors text-sm font-semibold mb-2">
                    <i className="ph-bold ph-arrow-left"></i> {t('sa.backToStudentProfiles')}
                </button>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            {photoSrc ? (
                                <img
                                    src={photoSrc}
                                    alt={`${profile?.firstName} ${profile?.lastName}`}
                                    className="w-14 h-14 rounded-2xl object-cover shadow-lg shadow-purple-500/20 border border-white/20"
                                />
                            ) : (
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-purple-500/20">
                                    {profile?.firstName?.charAt(0) ?? '?'}
                                </div>
                            )}
                        </div>
                        <div>
                            <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold">{profile?.firstName} {profile?.lastName}</h2>
                            <p className="text-gray-500 text-sm">{profile?.email} · {profile?.odID || '—'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            onClick={() => navigate(`${dashboardPrefix}/students/${id}/attendance`)}
                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] hover:border-[#6A3FF4]/30 transition-colors text-xs font-bold flex items-center gap-2"
                        >
                            <i className="ph-bold ph-calendar"></i> {t('sa.attendanceBtn')}
                        </button>
                        <button
                            onClick={handleGenerateTranscript}
                            disabled={pdfBusy}
                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-[#6A3FF4]/20 hover:text-[#6A3FF4] hover:border-[#6A3FF4]/30 transition-colors text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                        >
                            <i className={`ph-bold ${pdfBusy ? 'ph-spinner-gap animate-spin' : 'ph-file-pdf'}`}></i> {t('sa.transcriptBtn')}
                        </button>
                        <button
                            onClick={() => setConfirmDelete(true)}
                            className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500/20 transition-colors text-xs font-bold flex items-center gap-2"
                        >
                            <i className="ph-bold ph-trash"></i> {t('sa.deleteStudentBtn')}
                        </button>
                    </div>
                </div>
            </AnimateOnView>

            {/* Action banner */}
            <AnimatePresence>
                {actionMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className={`${glassCardStyle} px-4 py-3 flex items-center justify-between gap-3 ${
                            actionMsg.kind === 'success' ? 'border-green-500/30' : 'border-red-500/30'
                        }`}
                    >
                        <div className={`flex items-center gap-2 text-sm font-semibold ${
                            actionMsg.kind === 'success' ? 'text-green-400' : 'text-red-400'
                        }`}>
                            <i className={`ph-bold ${actionMsg.kind === 'success' ? 'ph-check-circle' : 'ph-warning-circle'}`}></i>
                            {actionMsg.text}
                        </div>
                        <button onClick={() => setActionMsg(null)} className="text-gray-500 hover:text-white text-xs">
                            <i className="ph-bold ph-x"></i>
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Row 1: Personal Info | Academic Info (matched height via grid items-stretch) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
                <AnimateOnView delay={0.1} enabled={false} className="lg:col-span-2 h-full">
                    <div className={`${glassCardStyle} p-6 space-y-5 h-full flex flex-col`}>
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-user-gear text-[#6A3FF4]"></i> {t('sa.personalInformation')}
                        </h3>

                        {/* Profile photo row */}
                        <div className="flex items-center gap-4">
                            {photoSrc ? (
                                <img
                                    src={photoSrc}
                                    alt="Profile"
                                    className="w-20 h-20 rounded-2xl object-cover border border-white/20"
                                />
                            ) : (
                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-2xl font-bold text-white">
                                    {profile?.firstName?.charAt(0) ?? '?'}
                                </div>
                            )}
                            <div className="flex flex-col gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handlePhotoUpload}
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="px-3 py-2 rounded-lg bg-[#6A3FF4]/20 text-[#6A3FF4] hover:bg-[#6A3FF4]/30 transition-colors text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                                >
                                    <i className={`ph-bold ${isUploading ? 'ph-spinner-gap animate-spin' : 'ph-camera'}`}></i>
                                    {isUploading ? t('sa.uploadingDots') : t('sa.changePhoto')}
                                </button>
                                <p className="text-[10px] text-gray-500">{t('sa.photoUploadHint')}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className={labelStyle}>{t('sa.firstNameLabel')}</label>
                                <input type="text" value={fields.firstName} onChange={handleChange('firstName')} className={inputStyle} placeholder={t('sa.firstNamePlaceholder')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.lastNameLabel')}</label>
                                <input type="text" value={fields.lastName} onChange={handleChange('lastName')} className={inputStyle} placeholder={t('sa.lastNamePlaceholder')} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className={labelStyle}>{t('sa.emailLabel')}</label>
                                <input type="email" value={fields.email} onChange={handleChange('email')} className={inputStyle} placeholder={t('sa.emailPlaceholder')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.phoneLabel')}</label>
                                <input type="text" value={fields.phone} onChange={handleChange('phone')} className={inputStyle} placeholder={t('sa.phonePlaceholder')} />
                            </div>
                        </div>

                        <div>
                            <label className={labelStyle}>{t('sa.dateOfBirthLabel')}</label>
                            <input
                                type="date"
                                value={fields.dateOfBirth}
                                onChange={handleChange('dateOfBirth')}
                                className={`${inputStyle} [color-scheme:dark]`}
                            />
                        </div>

                        <h4 className="text-black dark:text-white font-semibold text-sm pt-2 border-t border-white/10">{t('sa.addressLabel')}</h4>

                        <div>
                            <label className={labelStyle}>{t('sa.streetLabel')}</label>
                            <input type="text" value={fields.street} onChange={handleChange('street')} className={inputStyle} placeholder={t('sa.streetPlaceholder')} />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className={labelStyle}>{t('sa.cityLabel')}</label>
                                <input type="text" value={fields.city} onChange={handleChange('city')} className={inputStyle} placeholder={t('sa.cityPlaceholder')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.stateLabel')}</label>
                                <input type="text" value={fields.state} onChange={handleChange('state')} className={inputStyle} placeholder={t('sa.statePlaceholder')} />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('sa.postalCodeLabel')}</label>
                                <input type="text" value={fields.zipCode} onChange={handleChange('zipCode')} className={inputStyle} placeholder={t('sa.statePlaceholder')} />
                            </div>
                        </div>

                        <div>
                            <label className={labelStyle}>{t('sa.countryLabel')}</label>
                            <input type="text" value={fields.country} onChange={handleChange('country')} className={inputStyle} placeholder={t('sa.countryPlaceholder')} />
                        </div>

                        {error && (
                            <p className="text-red-400 text-xs font-semibold">{error}</p>
                        )}
                        {saveSuccess && (
                            <p className="text-green-400 text-xs font-semibold flex items-center gap-1">
                                <i className="ph-bold ph-check-circle"></i> {t('sa.changesSavedSuccessfully')}
                            </p>
                        )}

                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="mt-auto w-full py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isSaving ? (
                                <><i className="ph-bold ph-spinner-gap animate-spin"></i> {t('sa.savingDots')}</>
                            ) : (
                                <><i className="ph-bold ph-floppy-disk"></i> {t('sa.saveChangesBtn')}</>
                            )}
                        </button>
                    </div>
                </AnimateOnView>

                {/* Right column — Academic Info, matched height with auto-scroll inside */}
                <AnimateOnView delay={0.15} enabled={false} className="lg:col-span-1 h-full">
                    <div className={`${glassCardStyle} p-6 space-y-3 h-full flex flex-col`}>
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-graduation-cap text-[#6A3FF4]"></i> {t('sa.academicInfo')}
                        </h3>

                        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                <p className={labelStyle}>{t('sa.gpaLabel')}</p>
                                <p className="text-[#6A3FF4] font-bold text-3xl">{academic?.gpa?.toFixed(2) ?? '—'}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                    <p className={labelStyle}>{t('sa.levelLabel')}</p>
                                    <p className="text-black dark:text-white font-bold text-lg">
                                        {dbLevel != null ? t('sa.levelN', { n: dbLevel }) : '—'}
                                    </p>
                                </div>
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                    <p className={labelStyle}>{t('sa.creditsLabel')}</p>
                                    <p className="text-blue-500 font-bold text-lg">{credits}</p>
                                </div>
                            </div>

                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                <p className={labelStyle}>{t('sa.standingLabel')}</p>
                                <p className="text-black dark:text-white font-semibold text-sm capitalize">{academic?.standing ?? '—'}</p>
                            </div>

                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                <p className={labelStyle}>{t('sa.majorLabel')}</p>
                                <p className="text-black dark:text-white font-semibold text-sm">{major}</p>
                            </div>

                            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                <p className={labelStyle}>{t('sa.programLabel')}</p>
                                <p className="text-black dark:text-white font-semibold text-sm">{program}</p>
                            </div>

                            {academic?.minor && (
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                    <p className={labelStyle}>{t('sa.minorLabel')}</p>
                                    <p className="text-black dark:text-white font-semibold text-sm">{academic.minor}</p>
                                </div>
                            )}

                            {academic?.advisor && (
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                                    <p className={labelStyle}>{t('sa.advisorLabel')}</p>
                                    <p className="text-black dark:text-white font-semibold text-sm">{academic.advisor}</p>
                                    {academic.advisorEmail && (
                                        <p className="text-gray-500 text-xs mt-0.5">{academic.advisorEmail}</p>
                                    )}
                                </div>
                            )}

                            {(academic?.enrollmentDate || academic?.expectedGraduation) && (
                                <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-2">
                                    {academic.enrollmentDate && (
                                        <div>
                                            <p className={labelStyle}>{t('sa.enrolledLabel')}</p>
                                            <p className="text-black dark:text-white text-xs">{new Date(academic.enrollmentDate).toLocaleDateString()}</p>
                                        </div>
                                    )}
                                    {academic.expectedGraduation && (
                                        <div>
                                            <p className={labelStyle}>{t('sa.expectedGraduationLabel')}</p>
                                            <p className="text-black dark:text-white text-xs">{new Date(academic.expectedGraduation).toLocaleDateString()}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </AnimateOnView>
            </div>

            {/* Row 2: Registered Device (full width) */}
            <AnimateOnView delay={0.18} enabled={false}>
                <div className={`${glassCardStyle} p-6`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                profile?.registeredDeviceId ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-400'
                            }`}>
                                <i className="ph-fill ph-device-mobile text-lg"></i>
                            </div>
                            <div>
                                <h3 className="text-black dark:text-white text-base font-bold">{t('sa.registeredAttendanceDevice')}</h3>
                                {profile?.registeredDeviceId ? (
                                    <p className="text-gray-500 text-xs mt-0.5">
                                        <span className="text-black dark:text-white font-semibold">{profile.registeredDeviceLabel || t('sa.unnamedDevice')}</span>
                                        {profile.deviceRegisteredAt && (
                                            <> · {t('sa.registeredOnDate', { date: new Date(profile.deviceRegisteredAt).toLocaleDateString() })}</>
                                        )}
                                    </p>
                                ) : profile?.deviceReleaseAt && new Date(profile.deviceReleaseAt) > new Date() ? (
                                    <p className="text-amber-600 dark:text-amber-400 text-xs mt-0.5 font-semibold">
                                        <i className="ph-bold ph-lock-key"></i> Release cooldown until {new Date(profile.deviceReleaseAt).toLocaleString()}
                                    </p>
                                ) : (
                                    <p className="text-gray-500 text-xs mt-0.5">{t('sa.noDeviceRegistered')}</p>
                                )}
                            </div>
                        </div>
                        {profile?.registeredDeviceId && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => handleRelease('instant')}
                                    disabled={isRevoking}
                                    className="px-3 py-2 rounded-lg bg-[#6A3FF4]/10 border border-[#6A3FF4]/30 text-[#6A3FF4] dark:text-[#A98BFF] hover:bg-[#6A3FF4]/20 transition-colors text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                                >
                                    <i className="ph-bold ph-lightning"></i> Instant release
                                </button>
                                <button
                                    onClick={() => handleRelease('normal')}
                                    disabled={isRevoking}
                                    className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                                >
                                    <i className="ph-bold ph-timer"></i> 48h release
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </AnimateOnView>

            {/* Row 3: Emergency Contact (full width) */}
            <AnimateOnView delay={0.2} enabled={false}>
                <div className={`${glassCardStyle} p-6 space-y-4`}>
                    <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                        <i className="ph-bold ph-first-aid-kit text-[#6A3FF4]"></i> {t('sa.emergencyContactHeader')}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className={labelStyle}>{t('sa.contactNameLabel')}</label>
                            <input type="text" value={fields.ecName} onChange={handleChange('ecName')} className={inputStyle} placeholder={t('sa.contactNamePlaceholder')} />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('sa.relationshipLabel')}</label>
                            <input type="text" value={fields.ecRelationship} onChange={handleChange('ecRelationship')} className={inputStyle} placeholder={t('sa.relationshipPlaceholder')} />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('sa.phoneLabel')}</label>
                            <input type="text" value={fields.ecPhone} onChange={handleChange('ecPhone')} className={inputStyle} placeholder={t('sa.phonePlaceholder')} />
                        </div>
                        <div>
                            <label className={labelStyle}>{t('sa.emailLabel')}</label>
                            <input type="email" value={fields.ecEmail} onChange={handleChange('ecEmail')} className={inputStyle} placeholder={t('sa.contactEmailPlaceholder')} />
                        </div>
                    </div>

                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('sa.emergencyContactSaveHint')}
                    </p>
                </div>
            </AnimateOnView>

            {/* Account Status + Contact & Notes (admin-only fields surfaced for SA) */}
            <AnimateOnView delay={0.21} enabled={false}>
                <AccountAdminCard
                    userId={profile!.id}
                    initialActive={!!profile?.emailVerified}
                    initialSecondaryEmail={profile?.secondaryEmail || ''}
                    initialAdminNotes={profile?.adminNotes || ''}
                    onSaved={loadProfile}
                />
            </AnimateOnView>

            {/* Academic Profile editor (department + level) */}
            <AnimateOnView delay={0.22} enabled={false}>
                <AcademicProfileEditor
                    userId={profile!.id}
                    academic={profile?.academic}
                    onSaved={loadProfile}
                />
            </AnimateOnView>

            {/* Academic Advisor — student picker + per-student requires-approval flag (Article 12) */}
            <AnimateOnView delay={0.23} enabled={false}>
                <AcademicAdvisorEditor
                    userId={profile!.id}
                    initialAdvisorId={profile?.academicAdvisorId ?? null}
                    initialRequiresApproval={!!profile?.requiresAdvisorApproval}
                    onSaved={loadProfile}
                />
            </AnimateOnView>

            {/* Row 4: Current Enrollments (full width). Grouped by course so the
                lecture + lab pair shows as one card; Force Drop drops the whole
                course in one transaction. */}
            <AnimateOnView delay={0.25} enabled={false}>
                <div className={`${glassCardStyle} p-6 space-y-4`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                            <i className="ph-bold ph-books text-[#6A3FF4]"></i> {t('sa.currentEnrollmentsHeader')}
                        </h3>
                        <span className="text-[10px] font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-1 rounded-md uppercase tracking-wider">
                            {t('sa.enrollmentSummary', { count: enrollmentGroups.length, plural: enrollmentGroups.length === 1 ? '' : 's', credits: semesterCredits })}
                        </span>
                    </div>

                    {enrollmentGroups.length === 0 ? (
                        <p className="text-sm text-gray-500 italic py-6 text-center">
                            {t('sa.noActiveRegistrations')}
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {enrollmentGroups.map((g) => (
                                <div key={g.courseCode} className="p-4 bg-white/5 dark:bg-black/10 border border-white/10 rounded-xl flex items-start justify-between gap-3 flex-wrap">
                                    <div className="flex-1 min-w-[200px]">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[11px] font-mono font-bold text-[#6A3FF4] bg-[#6A3FF4]/10 px-2 py-0.5 rounded-md">
                                                {g.courseCode}
                                            </span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                                                g.status === 'approved'
                                                    ? 'bg-green-500/10 text-green-500'
                                                    : g.status === 'pending'
                                                    ? 'bg-amber-500/10 text-amber-500'
                                                    : 'bg-gray-500/10 text-gray-400'
                                            }`}>
                                                {g.status}
                                            </span>
                                            {g.rows.map((reg) => (
                                                <span key={reg.id} className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase bg-white/5 text-gray-400 border border-white/10">
                                                    {reg.section.type}{reg.section.sectionId ? ` · ${reg.section.sectionId}` : ''}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-black dark:text-white font-semibold text-sm mt-1.5">{g.courseName}</p>
                                        <p className="text-gray-500 text-xs mt-0.5">
                                            {g.rows[0]?.section.instructor || t('sa.instructorTBA')} · {g.credits} {t('sa.creditsAbbr')} · {g.rows.length} {g.rows.length === 1 ? t('sa.sectionLabel') : t('sa.sectionsLabel')}
                                        </p>
                                        {/* Show schedule slots from every row in the group. */}
                                        {g.rows.some((r) => r.section.slots && r.section.slots.length > 0) && (
                                            <div className="mt-1 text-[11px] text-gray-500 space-y-0.5">
                                                {g.rows.map((r) => (
                                                    r.section.slots && r.section.slots.length > 0 ? (
                                                        <p key={r.id}>
                                                            <span className="font-semibold uppercase tracking-wider mr-1">{r.section.type}:</span>
                                                            {r.section.slots.map((s, i) => (
                                                                <span key={i}>{i > 0 ? ', ' : ''}{s.day} {s.start}–{s.end}</span>
                                                            ))}
                                                        </p>
                                                    ) : null
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {confirmDropId === g.courseCode ? (
                                            <>
                                                <button
                                                    onClick={() => handleForceDrop(g.courseCode)}
                                                    className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-colors"
                                                >
                                                    {t('sa.confirmDropBtn')}
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDropId(null)}
                                                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs font-bold hover:text-white transition-colors"
                                                >
                                                    {t('sa.cancelBtn')}
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={() => setConfirmDropId(g.courseCode)}
                                                className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold hover:bg-red-500/20 transition-colors flex items-center gap-1"
                                            >
                                                <i className="ph-bold ph-x-circle"></i> {t('sa.forceDropCourseBtn')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </AnimateOnView>

            {/* Confirm Modals */}
            <AnimatePresence>
                {confirmDelete && (
                    <ConfirmModal
                        title={t('sa.deleteStudentAccountQ')}
                        body={
                            <>{t('sa.deleteStudentBodyA')} <span className="text-white font-semibold">{profile?.firstName} {profile?.lastName}</span>{t('sa.deleteStudentBodyB')}</>
                        }
                        confirmLabel={t('sa.yesDelete')}
                        cancelLabel={t('sa.cancelBtn')}
                        confirmTone="red"
                        onConfirm={handleDelete}
                        onCancel={() => setConfirmDelete(false)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

interface ConfirmModalProps {
    title: string;
    body: React.ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    confirmTone?: 'red' | 'purple';
    disabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ title, body, confirmLabel, cancelLabel, confirmTone = 'red', disabled, onConfirm, onCancel }) => {
    const toneClass = confirmTone === 'red'
        ? 'bg-red-500 hover:bg-red-600'
        : 'bg-[#6A3FF4] hover:bg-[#5A32D4]';
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onCancel}
        >
            <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className={`${glassCardStyle} max-w-md w-full p-6 space-y-4`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center">
                    <i className="ph-fill ph-warning text-2xl text-red-500"></i>
                </div>
                <h3 className="text-black dark:text-white text-lg font-bold">{title}</h3>
                <p className="text-gray-400 text-sm">{body}</p>
                <div className="flex gap-2 pt-2">
                    <button
                        onClick={onCancel}
                        disabled={disabled}
                        className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-semibold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        {cancelLabel || 'Cancel'}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={disabled}
                        className={`flex-1 py-2.5 rounded-xl text-white font-bold text-sm transition-colors disabled:opacity-50 ${toneClass}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
};

// ─── Account Status + Contact & Notes ───────────────────────────────────────
// Mirrors the admin UserEditPage's "Profile Information" status toggle and
// the "Contact & Notes" block. Hits the same admin endpoint — the backend
// allows SA on student rows.
const AccountAdminCard: React.FC<{
    userId: string;
    initialActive: boolean;
    initialSecondaryEmail: string;
    initialAdminNotes: string;
    onSaved: () => void;
}> = ({ initialActive, initialSecondaryEmail, initialAdminNotes, onSaved }) => {
    const t = useT();
    const [active, setActive] = useState(initialActive);
    const [secondaryEmail, setSecondaryEmail] = useState(initialSecondaryEmail);
    const [adminNotes, setAdminNotes] = useState(initialAdminNotes);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState(false);

    useEffect(() => { setActive(initialActive); }, [initialActive]);
    useEffect(() => { setSecondaryEmail(initialSecondaryEmail); }, [initialSecondaryEmail]);
    useEffect(() => { setAdminNotes(initialAdminNotes); }, [initialAdminNotes]);

    const save = async () => {
        setSaving(true);
        setErr(null);
        setOk(false);
        // MVP build: no backend; flash success locally.
        setOk(true);
        onSaved();
        window.setTimeout(() => setOk(false), 2000);
        setSaving(false);
    };

    return (
        <div className={`${glassCardStyle} p-6 space-y-4`}>
            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                <i className="ph-bold ph-shield-check text-[#6A3FF4]"></i> {t('sa.accountStatusAndNotes')}
                <span className="text-xs text-gray-500 font-normal ml-1">{t('sa.staffOnlyTag')}</span>
            </h3>

            <div>
                <label className={labelStyle}>{t('sa.accountStatusLabel')}</label>
                <div className="flex items-center gap-3 mt-1">
                    <button
                        type="button"
                        onClick={() => setActive(true)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                            active
                                ? 'bg-green-500/20 text-green-400 border-green-500/40'
                                : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                        }`}
                    >
                        {t('sa.activeBtn')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActive(false)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                            !active
                                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                                : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                        }`}
                    >
                        {t('sa.inactiveBtn')}
                    </button>
                </div>
            </div>

            <div>
                <label className={labelStyle}>{t('sa.secondaryEmailLabel2')}</label>
                <input
                    type="email"
                    value={secondaryEmail}
                    onChange={(e) => setSecondaryEmail(e.target.value)}
                    className={inputStyle}
                    placeholder={t('sa.secondaryEmailPlaceholder')}
                />
            </div>

            <div>
                <label className={labelStyle}>{t('sa.adminNotesLabel2')}</label>
                <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                    className={`${inputStyle} resize-y`}
                    placeholder={t('sa.adminNotesPlaceholder2')}
                />
            </div>

            {err && (
                <p className="text-red-400 text-xs font-semibold">{err}</p>
            )}
            {ok && (
                <p className="text-green-400 text-xs font-semibold flex items-center gap-1">
                    <i className="ph-bold ph-check-circle"></i> {t('sa.savedDot')}
                </p>
            )}

            <button
                onClick={save}
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
                {saving ? (
                    <><i className="ph-bold ph-spinner-gap animate-spin"></i> {t('sa.savingEllipsis')}</>
                ) : (
                    <><i className="ph-bold ph-floppy-disk"></i> {t('sa.saveAccountAndNotes')}</>
                )}
            </button>
        </div>
    );
};

// ─── Academic Profile editor (department + level) ───────────────────────────
const AcademicProfileEditor: React.FC<{
    userId: string;
    academic?: AcademicBlock;
    onSaved: () => void;
}> = ({ academic, onSaved }) => {
    const t = useT();
    const [departments, setDepartments] = useState<DepartmentOption[]>([]);
    const [program, setProgram] = useState<string>(academic?.program ?? '');
    const [level, setLevel] = useState<string>(
        academic?.level !== null && academic?.level !== undefined ? String(academic.level) : ''
    );
    const [loadingDepts, setLoadingDepts] = useState(true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState(false);

    useEffect(() => { setProgram(academic?.program ?? ''); }, [academic?.program]);
    useEffect(() => {
        setLevel(academic?.level !== null && academic?.level !== undefined ? String(academic.level) : '');
    }, [academic?.level]);

    useEffect(() => {
        // MVP build: static department list, no backend.
        const list = [...MOCK_DEPARTMENTS].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        setDepartments(list);
        setLoadingDepts(false);
    }, []);

    const save = async () => {
        setSaving(true);
        setErr(null);
        setOk(false);
        // MVP build: no backend; flash success locally.
        setOk(true);
        onSaved();
        window.setTimeout(() => setOk(false), 2000);
        setSaving(false);
    };

    const departmentOptions = [
        { value: '', label: t('sa.noDepartmentAssigned') },
        // Public endpoint doesn't surface isActive — show every department
        // and let the SA pick. Pre-selected value remains valid even if it
        // no longer appears in the list.
        ...departments
            .filter((d) => d.isActive !== false || d.code === program)
            .map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` })),
    ];
    const levelOptions = [
        { value: '', label: t('sa.notSet') },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: t('sa.levelN', { n }) })),
    ];

    return (
        <div className={`${glassCardStyle} p-6 space-y-4`}>
            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                <i className="ph-bold ph-graduation-cap text-[#6A3FF4]"></i> {t('sa.academicProfileHeader')}
            </h3>
            <p className="text-gray-500 text-xs">
                {t('sa.academicProfileHint')}
            </p>

            {err && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {ok && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{t('sa.academicProfileSaved')}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className={labelStyle}>{t('sa.departmentProgramLabel')}</label>
                    {loadingDepts ? (
                        <div className={`${inputStyle} text-gray-500 italic`}>{t('sa.loadingDepartmentsDots')}</div>
                    ) : (
                        <GlassDropdown
                            value={program}
                            onChange={setProgram}
                            options={departmentOptions}
                            direction="up"
                            className="w-full"
                        />
                    )}
                </div>
                <div>
                    <label className={labelStyle}>{t('sa.academicLevelLabel')}</label>
                    <GlassDropdown
                        value={level}
                        onChange={setLevel}
                        options={levelOptions}
                        direction="up"
                        className="w-full"
                    />
                </div>
            </div>

            <div className="flex justify-end">
                <button
                    onClick={save}
                    disabled={saving || loadingDepts}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold text-sm hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-2"
                >
                    {saving ? (
                        <><i className="ph-bold ph-spinner-gap animate-spin"></i> {t('sa.savingEllipsis')}</>
                    ) : (
                        <><i className="ph-bold ph-floppy-disk"></i> {t('sa.saveAcademicProfile')}</>
                    )}
                </button>
            </div>
        </div>
    );
};

// ─── Academic Advisor (FCDS Article 12) ─────────────────────────────────────
// Same picker the admin sees, hitting the same endpoints — backend now
// allows SA when target is a student.
const AcademicAdvisorEditor: React.FC<{
    userId: string;
    initialAdvisorId: string | null;
    initialRequiresApproval: boolean;
    onSaved: () => void;
}> = ({ initialAdvisorId, initialRequiresApproval, onSaved }) => {
    const t = useT();
    const policy = useAdvisorPolicy();
    const [professors, setProfessors] = useState<ProfessorOption[]>([]);
    const [advisorId, setAdvisorId] = useState<string | null>(initialAdvisorId);
    const [requiresApproval, setRequiresApproval] = useState(initialRequiresApproval);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [ok, setOk] = useState(false);

    useEffect(() => { setAdvisorId(initialAdvisorId); }, [initialAdvisorId]);
    useEffect(() => { setRequiresApproval(initialRequiresApproval); }, [initialRequiresApproval]);

    useEffect(() => {
        // MVP build: static professor list, no backend.
        setProfessors(MOCK_PROFESSORS);
    }, []);

    const flash = (kind: 'ok' | 'err', text?: string) => {
        if (kind === 'ok') {
            setOk(true);
            setErr(null);
            window.setTimeout(() => setOk(false), 2000);
        } else {
            setErr(text || t('sa.deleteFailed'));
            setOk(false);
        }
    };

    const saveAdvisor = async (newId: string | null) => {
        setSaving(true);
        // MVP build: update local state only.
        setAdvisorId(newId);
        onSaved();
        flash('ok');
        setSaving(false);
    };

    const toggleRequiresApproval = async (next: boolean) => {
        setSaving(true);
        // MVP build: update local state only.
        setRequiresApproval(next);
        onSaved();
        flash('ok');
        setSaving(false);
    };

    const candidates = policy.restrictPickerToFlaggedProfessors
        ? professors.filter((p) => p.isAcademicAdvisor)
        : professors;

    return (
        <div className={`${glassCardStyle} p-6 space-y-4`}>
            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
                <i className="ph-bold ph-user-focus text-[#6A3FF4]"></i> {t('sa.academicAdvisorHeader')}
                <span className="text-xs text-gray-500 font-normal ml-1">{t('sa.fcdsArticle12')}</span>
            </h3>
            <p className="text-gray-500 text-xs">
                {t('sa.advisorEditorHint')}
            </p>

            {err && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{err}</div>
            )}
            {ok && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{t('sa.savedDot')}</div>
            )}

            <div>
                <label className={labelStyle}>{t('sa.registrationsRequireAdvisorApproval')}</label>
                <div className="flex items-center gap-3 mt-1">
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggleRequiresApproval(!requiresApproval)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                            requiresApproval
                                ? 'bg-amber-500/20 text-amber-500 border-amber-500/40'
                                : 'bg-white/5 text-gray-500 border-white/10 hover:bg-white/10'
                        } disabled:opacity-50`}
                    >
                        {requiresApproval ? t('sa.yesGateRegistrations') : t('sa.noAutoPassToSA')}
                    </button>
                    <span className="text-[11px] text-gray-500">
                        {requiresApproval
                            ? t('sa.registrationsHeldUntilAdvisor')
                            : t('sa.defaultNoAdvisorStep')}
                    </span>
                </div>
            </div>

            <div>
                <label className={labelStyle}>{t('sa.assignedAdvisor')}</label>
                <GlassDropdown
                    value={advisorId ?? ''}
                    onChange={(v) => saveAdvisor(v ? String(v) : null)}
                    options={[
                        { value: '', label: t('sa.noneUnassigned') },
                        ...candidates.map((p) => ({
                            value: p.id,
                            label: `${p.firstName} ${p.lastName} — ${p.email}`,
                        })),
                    ]}
                    direction="up"
                    className="w-full"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                    {policy.restrictPickerToFlaggedProfessors
                        ? t('sa.showingFlaggedAdvisors', { count: candidates.length })
                        : t('sa.showingAllProfessors', { count: candidates.length })}
                    {' '}{t('sa.savesImmediately')}
                </p>
            </div>
        </div>
    );
};

export default SAStudentProfileDetail;
