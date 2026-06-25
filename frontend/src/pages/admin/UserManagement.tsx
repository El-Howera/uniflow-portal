import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { useHasPermission } from '../../utils/permissions';
import { RowActionMenu } from '../../components/RowActionMenu';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

const inputStyle = "w-full bg-white/5 dark:bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/50";
const primaryBtnStyle = "bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold px-5 py-2 rounded-xl hover:opacity-90 transition-opacity";
const cancelBtnStyle = "border border-white/20 text-black dark:text-white font-bold px-5 py-2 rounded-xl hover:bg-white/10 transition-colors";
const labelStyle = "block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider";

interface User {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
    emailVerified: boolean;
    createdAt: string;
    academicProfile?: {
        major: string;
        gpa: number;
        level: string;
    };
}

interface AddStudentForm {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    odId: string;
}

interface EditUserForm {
    firstName: string;
    lastName: string;
    email: string;
}

// ─── Preview mock data ─────────────────────────────────────────────────────────
// Static user directory keyed by role. The page mutates copies of these in
// local state only — no backend.
const MOCK_USERS_BY_ROLE: Record<string, User[]> = {
    student: [
        { id: 'u-omar', firstName: 'Omar', lastName: 'Khaled', email: 'omar.khaled@fcds.edu', role: 'student', emailVerified: true, createdAt: '2025-09-01T08:00:00.000Z', academicProfile: { major: 'Computer Science', gpa: 3.42, level: '2' } },
        { id: 'u-sara', firstName: 'Sara', lastName: 'Mahmoud', email: 'sara.mahmoud@fcds.edu', role: 'student', emailVerified: true, createdAt: '2025-09-01T08:05:00.000Z', academicProfile: { major: 'Computer Science', gpa: 3.88, level: '2' } },
        { id: 'u-youssef', firstName: 'Youssef', lastName: 'Tarek', email: 'youssef.tarek@fcds.edu', role: 'student', emailVerified: true, createdAt: '2024-09-01T08:00:00.000Z', academicProfile: { major: 'Data Science', gpa: 2.97, level: '3' } },
        { id: 'u-nour', firstName: 'Nour', lastName: 'Hassan', email: 'nour.hassan@fcds.edu', role: 'student', emailVerified: false, createdAt: '2026-02-10T08:00:00.000Z', academicProfile: { major: 'Computer Science', gpa: 3.15, level: '1' } },
        { id: 'u-laila', firstName: 'Laila', lastName: 'Ibrahim', email: 'laila.ibrahim@fcds.edu', role: 'student', emailVerified: true, createdAt: '2025-09-02T08:00:00.000Z', academicProfile: { major: 'Mathematics', gpa: 3.60, level: '2' } },
        { id: 'u-karim', firstName: 'Karim', lastName: 'Adel', email: 'karim.adel@fcds.edu', role: 'student', emailVerified: true, createdAt: '2024-09-01T08:10:00.000Z', academicProfile: { major: 'Cybersecurity', gpa: 2.45, level: '3' } },
    ],
    professor: [
        { id: 'u-prof-fares', firstName: 'Fares', lastName: 'Howera', email: 'fares.howera@fcds.edu', role: 'professor', emailVerified: true, createdAt: '2022-01-15T08:00:00.000Z' },
        { id: 'u-prof-hala', firstName: 'Hala', lastName: 'Mansour', email: 'hala.mansour@fcds.edu', role: 'professor', emailVerified: true, createdAt: '2021-09-01T08:00:00.000Z' },
        { id: 'u-prof-tamer', firstName: 'Tamer', lastName: 'Fouad', email: 'tamer.fouad@fcds.edu', role: 'professor', emailVerified: true, createdAt: '2023-02-01T08:00:00.000Z' },
        { id: 'u-prof-rania', firstName: 'Rania', lastName: 'Kamel', email: 'rania.kamel@fcds.edu', role: 'professor', emailVerified: true, createdAt: '2020-09-01T08:00:00.000Z' },
    ],
    ta: [
        { id: 'u-ta-mona', firstName: 'Mona', lastName: 'Salah', email: 'mona.salah@fcds.edu', role: 'ta', emailVerified: true, createdAt: '2024-09-01T08:00:00.000Z' },
        { id: 'u-ta-bishoy', firstName: 'Bishoy', lastName: 'Nabil', email: 'bishoy.nabil@fcds.edu', role: 'ta', emailVerified: true, createdAt: '2025-02-01T08:00:00.000Z' },
        { id: 'u-ta-dina', firstName: 'Dina', lastName: 'Fathy', email: 'dina.fathy@fcds.edu', role: 'ta', emailVerified: false, createdAt: '2026-01-20T08:00:00.000Z' },
    ],
    sa: [
        { id: 'u-sa-hana', firstName: 'Hana', lastName: 'Adel', email: 'hana.adel@fcds.edu', role: 'sa', emailVerified: true, createdAt: '2023-03-01T08:00:00.000Z' },
        { id: 'u-sa-tarek', firstName: 'Tarek', lastName: 'Gamal', email: 'tarek.gamal@fcds.edu', role: 'sa', emailVerified: true, createdAt: '2022-08-15T08:00:00.000Z' },
    ],
    financial: [
        { id: 'u-fin-mariam', firstName: 'Mariam', lastName: 'El-Sayed', email: 'financial@uniflow.test', role: 'financial', emailVerified: true, createdAt: '2023-06-01T08:00:00.000Z' },
    ],
    it: [
        { id: 'u-it-omar', firstName: 'Omar', lastName: 'Hassan', email: 'it@uniflow.test', role: 'it', emailVerified: true, createdAt: '2023-06-01T08:05:00.000Z' },
    ],
};

const filterUsers = (list: User[], search: string): User[] => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
        (u) =>
            `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q),
    );
};

// --- HELPER COMPONENT ---
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const t = useT();
    const baseClasses = "px-3 py-1 text-[10px] font-bold rounded-full inline-block border uppercase";
    switch (status) {
        case 'active':
            return <span className={`${baseClasses} bg-green-500/10 text-green-400 border-green-500/20`}>{t('admin.statusActive')}</span>;
        case 'pending':
            return <span className={`${baseClasses} bg-yellow-500/10 text-yellow-400 border-yellow-500/20`}>{t('admin.statusPending')}</span>;
        case 'probation':
            return <span className={`${baseClasses} bg-red-500/10 text-red-400 border-red-500/20`}>{t('admin.statusProbation')}</span>;
        default:
            return <span className={`${baseClasses} bg-gray-500/10 text-gray-400 border-gray-500/20`}>{status}</span>;
    }
};

// --- MAIN COMPONENT: ManageStudents ---
export const ManageStudents: React.FC = () => {
    const t = useT();
    const canDelete = useHasPermission('Student Management', 'delete');
    const navigate = useNavigate();
    const [students, setStudents] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Add student modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState<AddStudentForm>({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        odId: '',
    });
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState('');

    // Edit student modal
    const [editTarget, setEditTarget] = useState<User | null>(null);
    const [editForm, setEditForm] = useState<EditUserForm>({ firstName: '', lastName: '', email: '' });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState('');

    useEffect(() => {
        // Preview mode — load + filter the static student directory locally.
        setIsLoading(true);
        const delaySearch = setTimeout(() => {
            setStudents(filterUsers(MOCK_USERS_BY_ROLE.student, searchTerm));
            setIsLoading(false);
        }, 300);
        return () => clearTimeout(delaySearch);
    }, [searchTerm]);

    // Preview mode — append a new student to local state. No network.
    const handleAddSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddSubmitting(true);
        setAddError('');
        const created: User = {
            id: `u-${Date.now()}`,
            firstName: addForm.firstName,
            lastName: addForm.lastName,
            email: addForm.email,
            role: 'student',
            emailVerified: false,
            createdAt: new Date().toISOString(),
            academicProfile: { major: 'Unassigned', gpa: 0, level: '1' },
        };
        setStudents((prev) => [created, ...prev]);
        setShowAddModal(false);
        setAddForm({ firstName: '', lastName: '', email: '', password: '', odId: '' });
        setAddSubmitting(false);
    };

    const openEditModal = (student: User) => {
        setEditTarget(student);
        setEditForm({ firstName: student.firstName, lastName: student.lastName, email: student.email });
        setEditError('');
    };

    // Preview mode — update the row in local state. No network.
    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editTarget) return;
        setEditSubmitting(true);
        setEditError('');
        const targetId = editTarget.id;
        setStudents((prev) =>
            prev.map((s) => (s.id === targetId ? { ...s, ...editForm } : s)),
        );
        setEditTarget(null);
        setEditSubmitting(false);
    };

    // Preview mode — deactivate marks the row unverified in local state. No network.
    const handleDeactivate = async (id: string) => {
        if (!window.confirm('Deactivate this account? The user is signed out everywhere and blocked from logging in until reactivated.')) return;
        setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, emailVerified: false } : s)));
    };

    // Preview mode — delete removes the row from local state. No network.
    const handleDelete = async (id: string) => {
        if (!window.confirm(t('admin.confirmDeleteStudent'))) return;
        setStudents((prev) => prev.filter((s) => s.id !== id));
    };

    return (
        <div className="pb-16 space-y-6">
            <AnimateOnView>
                <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('admin.studentsMgmtTitle')}</h1>
                <p className="text-black dark:text-gray-300">{t('admin.studentsMgmtSubtitle')}</p>
            </AnimateOnView>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="relative w-full md:w-64">
                    <i className="ph-bold ph-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input
                        type="text"
                        placeholder={t('admin.searchByNameEmail')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/5 dark:bg-black/10 text-black dark:text-gray-300 border border-white/10 rounded-xl py-2.5 pl-11 focus:outline-none focus:border-[#6A3FF4]"
                    />
                </div>
                <button
                    onClick={() => { setShowAddModal(true); setAddError(''); }}
                    className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center gap-2"
                >
                    <i className="ph-bold ph-plus"></i> {t('admin.addStudent')}
                </button>
            </div>

            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.studentCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.programCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.gpaCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.courseStatus')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('admin.actionsCol')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                [1, 2, 3].map(i => <tr key={i}><td colSpan={5} className="p-8 animate-pulse bg-white/5"></td></tr>)
                            ) : students.map((s) => (
                                <tr key={s.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-[#6A3FF4]/20 flex items-center justify-center text-xs font-bold text-[#6A3FF4]">
                                                {s.firstName.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-black dark:text-white">{s.firstName} {s.lastName}</p>
                                                <p className="text-[10px] text-gray-500 font-mono">{s.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 text-sm text-gray-400">{s.academicProfile?.major || t('admin.unassignedDept')}</td>
                                    <td className="p-4 text-sm font-bold text-[#6A3FF4]">{s.academicProfile?.gpa || '0.00'}</td>
                                    <td className="p-4"><StatusBadge status={s.emailVerified ? 'active' : 'pending'} /></td>
                                    <td className="p-4 text-right">
                                        <RowActionMenu
                                            ariaLabel={`Actions for ${s.firstName} ${s.lastName}`}
                                            items={[
                                                { label: t('admin.viewProfile'), icon: 'ph-bold ph-user-circle-gear', onClick: () => navigate(`/admin/users/${s.id}/edit`) },
                                                { label: t('admin.quickEdit'), icon: 'ph-bold ph-pencil-simple', onClick: () => openEditModal(s) },
                                                {
                                                    label: t('admin.viewAsUser'),
                                                    icon: 'ph-bold ph-eye',
                                                    // Preview mode — confirmation only, no impersonation session.
                                                    onClick: () => {
                                                        window.confirm(t('admin.viewAsConfirm', { name: `${s.firstName} ${s.lastName}` }));
                                                    },
                                                },
                                                { label: t('admin.deactivateBtn'), icon: 'ph-bold ph-prohibit', iconColor: 'text-yellow-500', onClick: () => handleDeactivate(s.id) },
                                                { label: t('admin.deleteBtn'), icon: 'ph-bold ph-trash', danger: true, hidden: !canDelete, onClick: () => handleDelete(s.id) },
                                            ]}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Student Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center px-4">
                    <div className={`${glassCardStyle} max-w-md w-full mx-auto mt-24 p-6`}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.addNewStudent')}</h3>
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <i className="ph-bold ph-x text-lg"></i>
                            </button>
                        </div>
                        <form onSubmit={handleAddSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelStyle}>{t('admin.userFirstName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={addForm.firstName}
                                        onChange={e => setAddForm(f => ({ ...f, firstName: e.target.value }))}
                                        className={inputStyle}
                                        placeholder={t('admin.phAhmed')}
                                    />
                                </div>
                                <div>
                                    <label className={labelStyle}>{t('admin.userLastName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={addForm.lastName}
                                        onChange={e => setAddForm(f => ({ ...f, lastName: e.target.value }))}
                                        className={inputStyle}
                                        placeholder={t('admin.phHassan')}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userEmail')}</label>
                                <input
                                    required
                                    type="email"
                                    value={addForm.email}
                                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                                    className={inputStyle}
                                    placeholder={t('admin.phStudentEmail')}
                                />
                            </div>
                            <div>
                                <label className={labelStyle}>
                                    {t('admin.userPassword')}{' '}
                                    <span className="text-gray-600 normal-case font-normal">(optional — leave blank to send an activation email)</span>
                                </label>
                                <input
                                    type="text"
                                    value={addForm.password}
                                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                                    className={inputStyle}
                                    placeholder="Leave blank for self-activation via email"
                                />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userOdId')} <span className="text-gray-600 normal-case font-normal">{t('admin.odIdOptional')}</span></label>
                                <input
                                    type="text"
                                    value={addForm.odId}
                                    onChange={e => setAddForm(f => ({ ...f, odId: e.target.value }))}
                                    className={inputStyle}
                                    placeholder={t('admin.phOdId')}
                                />
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userRole')}</label>
                                <div className={`${inputStyle} text-gray-500 cursor-not-allowed`}>{t('admin.roleLblStudent')}</div>
                            </div>
                            {addError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{addError}</p>
                            )}
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddModal(false)} className={cancelBtnStyle}>
                                    {t('common.cancel')}
                                </button>
                                <button type="submit" disabled={addSubmitting} className={`${primaryBtnStyle} disabled:opacity-60`}>
                                    {addSubmitting ? t('admin.saving') : t('admin.saveStudent')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Student Modal */}
            {editTarget && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center px-4">
                    <div className={`${glassCardStyle} max-w-md w-full mx-auto mt-24 p-6`}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.editStudent')}</h3>
                            <button
                                onClick={() => setEditTarget(null)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <i className="ph-bold ph-x text-lg"></i>
                            </button>
                        </div>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelStyle}>{t('admin.userFirstName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.firstName}
                                        onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                                        className={inputStyle}
                                    />
                                </div>
                                <div>
                                    <label className={labelStyle}>{t('admin.userLastName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.lastName}
                                        onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                                        className={inputStyle}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userEmail')}</label>
                                <input
                                    required
                                    type="email"
                                    value={editForm.email}
                                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                    className={inputStyle}
                                />
                            </div>
                            {editError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{editError}</p>
                            )}
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setEditTarget(null)} className={cancelBtnStyle}>
                                    {t('common.cancel')}
                                </button>
                                <button type="submit" disabled={editSubmitting} className={`${primaryBtnStyle} disabled:opacity-60`}>
                                    {editSubmitting ? t('admin.saving') : t('admin.saveChangesBtn2')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- MAIN COMPONENT: ManageFaculty ---
export const ManageFaculty: React.FC = () => {
    const t = useT();
    const [faculty, setFaculty] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Edit faculty modal
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<EditUserForm>({ firstName: '', lastName: '', email: '' });
    const [editSubmitting, setEditSubmitting] = useState(false);
    const [editError, setEditError] = useState('');

    useEffect(() => {
        // Preview mode — load the static professor directory.
        setIsLoading(true);
        const data = MOCK_USERS_BY_ROLE.professor;
        setFaculty(data);
        if (data.length > 0) setSelectedId(data[0].id);
        setIsLoading(false);
    }, []);

    const selectedProf = faculty.find(f => f.id === selectedId);

    const openEditModal = () => {
        if (!selectedProf) return;
        setEditForm({ firstName: selectedProf.firstName, lastName: selectedProf.lastName, email: selectedProf.email });
        setEditError('');
        setShowEditModal(true);
    };

    // Preview mode — update the faculty row in local state. No network.
    const handleEditSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedProf) return;
        setEditSubmitting(true);
        setEditError('');
        const targetId = selectedProf.id;
        setFaculty((prev) => prev.map((f) => (f.id === targetId ? { ...f, ...editForm } : f)));
        setShowEditModal(false);
        setEditSubmitting(false);
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-2">{t('admin.manageFacultyTitle')}</h2>
                <p className="text-black dark:text-gray-300">{t('admin.manageFacultySubtitle')}</p>
            </AnimateOnView>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className={`${glassCardStyle} p-6 xl:col-span-1`}>
                    <h3 className="font-bold text-white mb-4">{t('admin.directoryLbl')}</h3>
                    <div className="space-y-2">
                        {isLoading ? (
                            <div className="h-32 bg-white/5 animate-pulse rounded-xl"></div>
                        ) : faculty.map(f => (
                            <button
                                key={f.id}
                                onClick={() => setSelectedId(f.id)}
                                className={`w-full text-left p-3 rounded-xl transition-all border ${
                                    selectedId === f.id ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40' : 'border-transparent hover:bg-white/5'
                                }`}
                            >
                                <p className="text-sm font-bold text-white">{f.firstName} {f.lastName}</p>
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{f.role}</p>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={`${glassCardStyle} p-8 xl:col-span-2`}>
                    {selectedProf ? (
                        <div>
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">{selectedProf.firstName} {selectedProf.lastName}</h2>
                                    <p className="text-gray-500">{selectedProf.email}</p>
                                </div>
                                <button
                                    onClick={openEditModal}
                                    className="px-4 py-2 rounded-xl bg-white/10 text-xs font-bold hover:bg-white/20 text-black dark:text-white transition-colors"
                                >
                                    {t('admin.editProfileBtn')}
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('admin.accountStatusLbl')}</p>
                                    <StatusBadge status={selectedProf.emailVerified ? 'active' : 'pending'} />
                                </div>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                                    <p className="text-[10px] text-gray-500 font-bold uppercase mb-1">{t('admin.joinedDateLbl')}</p>
                                    <p className="text-white font-bold">{new Date(selectedProf.createdAt).toLocaleDateString()}</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-500">{t('admin.selectFacultyMember')}</div>
                    )}
                </div>
            </div>

            {/* Edit Faculty Modal */}
            {showEditModal && selectedProf && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center px-4">
                    <div className={`${glassCardStyle} max-w-md w-full mx-auto mt-24 p-6`}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.editProfileTitle')}</h3>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                            >
                                <i className="ph-bold ph-x text-lg"></i>
                            </button>
                        </div>
                        <form onSubmit={handleEditSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelStyle}>{t('admin.userFirstName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.firstName}
                                        onChange={e => setEditForm(f => ({ ...f, firstName: e.target.value }))}
                                        className={inputStyle}
                                    />
                                </div>
                                <div>
                                    <label className={labelStyle}>{t('admin.userLastName')}</label>
                                    <input
                                        required
                                        type="text"
                                        value={editForm.lastName}
                                        onChange={e => setEditForm(f => ({ ...f, lastName: e.target.value }))}
                                        className={inputStyle}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userEmail')}</label>
                                <input
                                    required
                                    type="email"
                                    value={editForm.email}
                                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                    className={inputStyle}
                                />
                            </div>
                            {editError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{editError}</p>
                            )}
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setShowEditModal(false)} className={cancelBtnStyle}>
                                    {t('common.cancel')}
                                </button>
                                <button type="submit" disabled={editSubmitting} className={`${primaryBtnStyle} disabled:opacity-60`}>
                                    {editSubmitting ? t('admin.saving') : t('admin.saveChangesBtn2')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- MAIN COMPONENT: PendingActivations ---
// Plan 5 — three actions per row:
//   Approve  → activates the account (PUT /api/admin/users/:id { emailVerified: true })
//   Decline  → soft-rejects (POST /api/admin/users/:id/decline-activation);
//              the user can self-reactivate via the verify-code flow
//   Resend   → re-emails the activation code (POST /api/admin/users/:id/resend-activation)
export const PendingActivations: React.FC = () => {
    const t = useT();
    type PendingUser = User & { suspendedReason?: string | null };
    const [users, setUsers] = useState<PendingUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [flashMsg, setFlashMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const showFlash = (kind: 'ok' | 'err', text: string) => {
        setFlashMsg({ kind, text });
        setTimeout(() => setFlashMsg(null), 3000);
    };

    useEffect(() => {
        // Preview mode — pending = every unverified user across all roles.
        setIsLoading(true);
        const pending: PendingUser[] = Object.values(MOCK_USERS_BY_ROLE)
            .flat()
            .filter((u) => !u.emailVerified)
            .map((u) => ({ ...u }));
        setUsers(pending);
        setIsLoading(false);
    }, []);

    // Preview mode — approve removes the row from the pending queue. No network.
    const handleApprove = async (id: string) => {
        setBusyId(id);
        setUsers((prev) => prev.filter((u) => u.id !== id));
        showFlash('ok', t('admin.approvedFlash'));
        setBusyId(null);
    };

    // Preview mode — decline flags the row + shows the success banner. No network.
    const handleDecline = async (id: string) => {
        if (!window.confirm(t('admin.confirmDeclineActivation'))) return;
        setBusyId(id);
        setUsers((prev) =>
            prev.map((u) => (u.id === id ? { ...u, suspendedReason: t('admin.activationDeclinedReason') } : u)),
        );
        showFlash('ok', t('admin.declinedFlash'));
        setBusyId(null);
    };

    // Preview mode — resend just flashes the confirmation. No network.
    const handleResend = async (id: string) => {
        setBusyId(id);
        showFlash('ok', t('admin.activationEmailed'));
        setBusyId(null);
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-2">{t('admin.pendingActivationsTitle')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.pendingActivationsSubtitle')}</p>
                <p className="text-gray-500 text-xs mt-2">
                    {t('admin.pendingActivationsHint')}
                </p>
            </AnimateOnView>

            {flashMsg && (
                <div className={`p-3 rounded-xl text-sm ${flashMsg.kind === 'ok'
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
                    {flashMsg.text}
                </div>
            )}

            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.userCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.requestedRoleCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.courseStatus')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.dateCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('admin.actionsCol')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr><td colSpan={5} className="p-12 text-center animate-pulse">{t('admin.loadingDots')}</td></tr>
                            ) : users.length === 0 ? (
                                <tr><td colSpan={5} className="p-12 text-center text-gray-500 italic">{t('admin.noPendingActivations')}</td></tr>
                            ) : users.map(user => {
                                const isDeclined = !!user.suspendedReason;
                                const busy = busyId === user.id;
                                return (
                                    <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-[#7B5AFF] text-white flex items-center justify-center font-bold text-xs">
                                                    {user.firstName.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-white">{user.firstName} {user.lastName}</p>
                                                    <p className="text-[10px] text-gray-500">{user.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-blue-500/20 text-blue-400 uppercase">{user.role}</span>
                                        </td>
                                        <td className="p-4">
                                            {isDeclined ? (
                                                <span title={user.suspendedReason ?? ''} className="text-[10px] font-bold px-2 py-1 rounded-md bg-red-500/20 text-red-300 uppercase">{t('admin.declinedBadge')}</span>
                                            ) : (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-yellow-500/20 text-yellow-300 uppercase">{t('admin.awaitingBadge')}</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-sm text-gray-400">{new Date(user.createdAt).toLocaleDateString()}</td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2 flex-wrap">
                                                <button disabled={busy} onClick={() => handleResend(user.id)} className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs font-bold hover:bg-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{t('admin.resendCodeBtn')}</button>
                                                <button disabled={busy} onClick={() => handleApprove(user.id)} className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-xs font-bold hover:bg-green-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{t('admin.approveBtn')}</button>
                                                {!isDeclined && (
                                                    <button disabled={busy} onClick={() => handleDecline(user.id)} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-bold hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{t('admin.declineBtn')}</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// Role-Tab system
// ─────────────────────────────────────────────────────────────────────────────

// Plan 5 — admin sub-scope roles (financial / it) get their own tabs so
// admins can create + manage them in the same surface as the original 4.
// (Plan 22: the `superuser` sub-role was removed entirely.)
type RoleTab = 'student' | 'professor' | 'ta' | 'sa' | 'financial' | 'it';

interface AddUserForm {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    odId: string;
}

const RoleUsersTab: React.FC<{ role: RoleTab }> = ({ role }) => {
    const t = useT();
    const navigate = useNavigate();
    // Delete permission depends on which tab the admin is on:
    //   students → Student Management:delete
    //   professors / TAs / SAs → Faculty Management:delete
    const deleteCategory = role === 'student' ? 'Student Management' : 'Faculty Management';
    const canDelete = useHasPermission(deleteCategory, 'delete');
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Add user modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState<AddUserForm>({
        firstName: '', lastName: '', email: '', password: '', odId: '',
    });
    const [addSubmitting, setAddSubmitting] = useState(false);
    const [addError, setAddError] = useState('');

    useEffect(() => {
        // Preview mode — load + filter the static directory for the active role.
        setIsLoading(true);
        const timer = setTimeout(() => {
            setUsers(filterUsers(MOCK_USERS_BY_ROLE[role] ?? [], searchTerm));
            setIsLoading(false);
        }, 300);
        return () => clearTimeout(timer);
    }, [role, searchTerm]);

    // Preview mode — deactivate marks the row unverified in local state. No network.
    const handleDeactivate = async (id: string) => {
        if (!window.confirm('Deactivate this account? The user is signed out everywhere and blocked from logging in until reactivated.')) return;
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, emailVerified: false } : u)));
    };

    // Preview mode — delete removes the row from local state. No network.
    const handleDeleteUser = async (id: string) => {
        if (!window.confirm(t('admin.confirmDeleteUserGeneric'))) return;
        setUsers((prev) => prev.filter((u) => u.id !== id));
    };

    // Preview mode — append the new user to local state. No network.
    const handleAddSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAddSubmitting(true);
        setAddError('');
        const created: User = {
            id: `u-${Date.now()}`,
            firstName: addForm.firstName,
            lastName: addForm.lastName,
            email: addForm.email,
            role,
            emailVerified: false,
            createdAt: new Date().toISOString(),
            ...(role === 'student'
                ? { academicProfile: { major: 'Unassigned', gpa: 0, level: '1' } }
                : {}),
        };
        setUsers((prev) => [created, ...prev]);
        setShowAddModal(false);
        setAddForm({ firstName: '', lastName: '', email: '', password: '', odId: '' });
        setAddSubmitting(false);
    };

    const roleLabelMap: Record<RoleTab, string> = {
        student: t('admin.roleLblStudent'),
        professor: t('admin.roleLblProfessor'),
        ta: t('admin.roleLblTA'),
        sa: t('admin.roleLblSA'),
        financial: t('admin.roleLblFinancial'),
        it: t('admin.roleLblIT'),
    };

    const isStudent = role === 'student';

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                <div className="relative w-full md:w-64">
                    <i className="ph-bold ph-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"></i>
                    <input
                        type="text"
                        placeholder={t('admin.searchByNameOrEmail')}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full bg-white/5 dark:bg-black/10 text-black dark:text-gray-300 border border-white/10 rounded-xl py-2.5 pl-11 focus:outline-none focus:border-[#6A3FF4]"
                    />
                </div>
                <button
                    onClick={() => { setShowAddModal(true); setAddError(''); }}
                    className="bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center gap-2"
                >
                    <i className="ph-bold ph-plus"></i> {t('admin.addRoleLabel', { role: roleLabelMap[role] })}
                </button>
            </div>

            {/* Table */}
            <div className={`${glassCardStyle} overflow-hidden`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-white/5 border-b border-white/10">
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.userCol')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.userRole')}</th>
                                {isStudent && <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.programCol')}</th>}
                                {isStudent && <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.gpaCol')}</th>}
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase">{t('admin.courseStatus')}</th>
                                <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">{t('admin.actionsCol')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        <td colSpan={isStudent ? 6 : 4} className="p-8 animate-pulse">
                                            <div className="h-4 bg-white/10 rounded"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={isStudent ? 6 : 4} className="p-12 text-center text-gray-500 italic">
                                        {t('admin.noUsersFound', { role: roleLabelMap[role].toLowerCase() })}
                                    </td>
                                </tr>
                            ) : users.map(u => (
                                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                    <td className="p-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-[#6A3FF4]/20 flex items-center justify-center text-xs font-bold text-[#6A3FF4]">
                                                {u.firstName.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-black dark:text-white">{u.firstName} {u.lastName}</p>
                                                <p className="text-[10px] text-gray-500 font-mono">{u.email}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-[#6A3FF4]/20 text-[#7B5AFF] uppercase">{u.role}</span>
                                    </td>
                                    {isStudent && (
                                        <td className="p-4 text-sm text-gray-400">{u.academicProfile?.major || t('admin.unassignedDept')}</td>
                                    )}
                                    {isStudent && (
                                        <td className="p-4 text-sm font-bold text-[#6A3FF4]">{u.academicProfile?.gpa ?? '0.00'}</td>
                                    )}
                                    <td className="p-4">
                                        <StatusBadge status={u.emailVerified ? 'active' : 'pending'} />
                                    </td>
                                    <td className="p-4 text-right">
                                        <RowActionMenu
                                            ariaLabel={`Actions for ${u.firstName} ${u.lastName}`}
                                            items={[
                                                { label: t('admin.viewProfile'), icon: 'ph-bold ph-user-circle-gear', onClick: () => navigate(`/admin/users/${u.id}/edit`) },
                                                {
                                                    label: t('admin.viewAsUser'),
                                                    icon: 'ph-bold ph-eye',
                                                    // Preview mode — confirmation only, no impersonation session.
                                                    onClick: () => {
                                                        window.confirm(t('admin.viewAsConfirm', { name: `${u.firstName} ${u.lastName}` }));
                                                    },
                                                },
                                                { label: t('admin.deactivateBtn'), icon: 'ph-bold ph-prohibit', iconColor: 'text-yellow-500', onClick: () => handleDeactivate(u.id) },
                                                { label: t('admin.deleteBtn'), icon: 'ph-bold ph-trash', danger: true, hidden: !canDelete, onClick: () => handleDeleteUser(u.id) },
                                            ]}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add User Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center px-4">
                    <div className={`${glassCardStyle} max-w-md w-full mx-auto mt-24 p-6`}>
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-black dark:text-white">{t('admin.addRoleLabel', { role: roleLabelMap[role] })}</h3>
                            <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white transition-colors">
                                <i className="ph-bold ph-x text-lg"></i>
                            </button>
                        </div>
                        <form onSubmit={handleAddSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelStyle}>{t('admin.userFirstName')}</label>
                                    <input required type="text" value={addForm.firstName}
                                        onChange={e => setAddForm(f => ({ ...f, firstName: e.target.value }))}
                                        className={inputStyle} placeholder={t('admin.phAhmed')} />
                                </div>
                                <div>
                                    <label className={labelStyle}>{t('admin.userLastName')}</label>
                                    <input required type="text" value={addForm.lastName}
                                        onChange={e => setAddForm(f => ({ ...f, lastName: e.target.value }))}
                                        className={inputStyle} placeholder={t('admin.phHassan')} />
                                </div>
                            </div>
                            <div>
                                <label className={labelStyle}>{t('admin.userEmail')}</label>
                                <input required type="email" value={addForm.email}
                                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                                    className={inputStyle} placeholder={t('admin.phUserEmail')} />
                            </div>
                            <div>
                                <label className={labelStyle}>
                                    {t('admin.userPassword')}{' '}
                                    <span className="text-gray-600 normal-case font-normal">(optional — leave blank to send an activation email)</span>
                                </label>
                                <input type="text" value={addForm.password}
                                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                                    className={inputStyle} placeholder="Leave blank for self-activation via email" />
                            </div>
                            {isStudent && (
                                <div>
                                    <label className={labelStyle}>{t('admin.userOdId')} <span className="text-gray-600 normal-case font-normal">{t('admin.odIdOptional')}</span></label>
                                    <input type="text" value={addForm.odId}
                                        onChange={e => setAddForm(f => ({ ...f, odId: e.target.value }))}
                                        className={inputStyle} placeholder={t('admin.phOdId')} />
                                </div>
                            )}
                            <div>
                                <label className={labelStyle}>{t('admin.userRole')}</label>
                                <div className={`${inputStyle} text-gray-500 cursor-not-allowed`}>{roleLabelMap[role]}</div>
                            </div>
                            {addError && (
                                <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{addError}</p>
                            )}
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setShowAddModal(false)} className={cancelBtnStyle}>{t('common.cancel')}</button>
                                <button type="submit" disabled={addSubmitting} className={`${primaryBtnStyle} disabled:opacity-60`}>
                                    {addSubmitting ? t('admin.saving') : t('admin.saveUserBtn')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// UserManagementPage — default export (4-role tab bar)
// ─────────────────────────────────────────────────────────────────────────────

const UserManagementPage: React.FC = () => {
    const t = useT();
    const [activeTab, setActiveTab] = useState<RoleTab>('student');

    const tabs: { role: RoleTab; label: string; icon: string }[] = [
        { role: 'student', label: t('admin.tabStudents'), icon: 'ph-student' },
        { role: 'professor', label: t('admin.tabProfessors'), icon: 'ph-chalkboard-teacher' },
        { role: 'ta', label: t('admin.tabTAs'), icon: 'ph-user-circle' },
        { role: 'sa', label: t('admin.tabSA'), icon: 'ph-identification-card' },
        // Plan 5 — admin sub-scope roles
        { role: 'financial', label: t('admin.tabFinancial'), icon: 'ph-currency-dollar' },
        { role: 'it', label: t('admin.tabIT'), icon: 'ph-monitor' },
    ];

    return (
        <div className="pb-16 space-y-6 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white mb-1">{t('admin.userMgmtTitle')}</h1>
                <p className="text-black dark:text-gray-300 text-sm">{t('admin.userMgmtSubtitle')}</p>
            </AnimateOnView>

            {/* Tab bar */}
            <div className="flex flex-wrap gap-2">
                {tabs.map(tab => (
                    <button
                        key={tab.role}
                        onClick={() => setActiveTab(tab.role)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                            activeTab === tab.role
                                ? 'bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white shadow-lg shadow-purple-500/20'
                                : 'bg-white/5 dark:bg-black/10 text-gray-400 hover:text-white hover:bg-white/10 border border-white/10'
                        }`}
                    >
                        <i className={`ph-bold ${tab.icon}`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <RoleUsersTab role={activeTab} key={activeTab} />
        </div>
    );
};

export default UserManagementPage;
