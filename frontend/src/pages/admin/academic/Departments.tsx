// src/pages/admin/academic/Departments.tsx
//
// Plan 4 Phase 2 — admin CRUD for academic departments (FCDS Article 2).
// Backed by /api/admin/departments. Two FCDS departments are present from
// the original seed; admins can add more (e.g. for a future program).
//
// Each row shows the linked-courses count so the admin sees the impact of
// a delete attempt — the backend rejects deletes when courses are linked.
import { FC, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useInstitutionConfig } from '../../../config/institutionConfig';
import { glassCardStyle } from './_shared';
import { GlassCheckbox } from '../../../components/GlassCheckbox';
import { useT } from '../../../i18n';

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  // Plan 4 Phase 2 follow-up — program-level fields folded into Department.
  totalCredits: number;
  compulsoryCredits: number;
  electiveCredits: number;
  isActive: boolean;
  courseCount: number;
}

const EMPTY_FORM = {
  code: '',
  name: '',
  description: '',
  totalCredits: 140,
  compulsoryCredits: 106,
  electiveCredits: 24,
  isActive: true,
};

// MVP build — no backend. Inline seed mirrors the 6 FCDS departments.
const MOCK_DEPARTMENTS: DepartmentRow[] = [
  { id: 'd1', code: '01', name: 'Computer Science',          description: 'Core CS program.',                 totalCredits: 140, compulsoryCredits: 106, electiveCredits: 24, isActive: true,  courseCount: 42 },
  { id: 'd2', code: '02', name: 'Data Science',              description: 'Statistics and machine learning.', totalCredits: 140, compulsoryCredits: 104, electiveCredits: 26, isActive: true,  courseCount: 38 },
  { id: 'd3', code: '03', name: 'Cybersecurity',             description: 'Security and networks.',           totalCredits: 140, compulsoryCredits: 108, electiveCredits: 22, isActive: true,  courseCount: 34 },
  { id: 'd4', code: '04', name: 'Software Engineering',      description: 'Software design and process.',     totalCredits: 140, compulsoryCredits: 106, electiveCredits: 24, isActive: true,  courseCount: 36 },
  { id: 'd5', code: '05', name: 'Artificial Intelligence',  description: 'AI and intelligent systems.',      totalCredits: 140, compulsoryCredits: 102, electiveCredits: 28, isActive: true,  courseCount: 31 },
  { id: 'd6', code: '06', name: 'Information Systems',       description: 'Enterprise information systems.',  totalCredits: 140, compulsoryCredits: 100, electiveCredits: 30, isActive: false, courseCount: 0 },
];

let mockIdSeq = 100;

const DepartmentsPage: FC = () => {
  const t = useT();
  const institution = useInstitutionConfig();
  const [departments, setDepartments] = useState<DepartmentRow[]>(MOCK_DEPARTMENTS);
  const loading = false;
  const loadError = null;
  const [search, setSearch] = useState('');

  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Plan 6 Phase 6 — typed-confirmation modal state. Admin must type the
  // department code to enable the Delete button; prevents accidental deletes
  // and gives explicit warning about courses that will be unlinked.
  const [deleteTarget, setDeleteTarget] = useState<DepartmentRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q),
    );
  }, [departments, search]);

  const beginCreate = () => {
    setMode('create');
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setSaveError(null);
  };

  const beginEdit = (d: DepartmentRow) => {
    setMode('edit');
    setEditingId(d.id);
    setForm({
      code: d.code,
      name: d.name,
      description: d.description ?? '',
      totalCredits: d.totalCredits,
      compulsoryCredits: d.compulsoryCredits,
      electiveCredits: d.electiveCredits,
      isActive: d.isActive,
    });
    setSaveError(null);
  };

  const validationError = useMemo(() => {
    if (form.code.trim().length < 1) return 'Code is required.';
    if (form.code.length > 16) return 'Code must be 16 characters or fewer.';
    if (form.name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (form.totalCredits < 30 || form.totalCredits > 300) {
      return 'Total credits must be between 30 and 300.';
    }
    if (form.compulsoryCredits + form.electiveCredits > form.totalCredits) {
      return 'Compulsory + elective credits cannot exceed total credits.';
    }
    return null;
  }, [form]);

  // MVP build — no backend. Mutate the local list only.
  const handleSave = () => {
    if (validationError) return;
    setSaving(true);
    setSaveError(null);
    const isCreate = mode === 'create';
    if (isCreate) {
      const newRow: DepartmentRow = {
        id: `d-mock-${mockIdSeq++}`,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        totalCredits: form.totalCredits,
        compulsoryCredits: form.compulsoryCredits,
        electiveCredits: form.electiveCredits,
        isActive: form.isActive,
        courseCount: 0,
      };
      setDepartments((prev) => [...prev, newRow]);
      flashToast(t('admin.deptCreated'));
      beginCreate();
    } else {
      setDepartments((prev) =>
        prev.map((d) =>
          d.id === editingId
            ? {
                ...d,
                code: form.code.trim(),
                name: form.name.trim(),
                description: form.description.trim() || null,
                totalCredits: form.totalCredits,
                compulsoryCredits: form.compulsoryCredits,
                electiveCredits: form.electiveCredits,
                isActive: form.isActive,
              }
            : d,
        ),
      );
      flashToast(t('admin.deptUpdated'));
    }
    setSaving(false);
  };

  // Plan 6 Phase 6 — typed-confirmation modal. The trash button opens the
  // modal; the actual API call only fires when the admin types the
  // department code AND clicks Delete. The single-click `window.confirm`
  // flow was too easy to misfire when a department had linked courses.
  const handleDelete = (d: DepartmentRow) => {
    setDeleteTarget(d);
    setDeleteConfirmText('');
  };

  const closeDeleteModal = () => {
    if (deleting) return; // don't close mid-call
    setDeleteTarget(null);
    setDeleteConfirmText('');
  };

  // MVP build — no backend. Remove the row from local state only.
  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim() !== deleteTarget.code) return;
    setDeleting(true);
    const wasEditing = editingId === deleteTarget.id;
    const unlinked = deleteTarget.courseCount;
    const targetId = deleteTarget.id;
    setDepartments((prev) => prev.filter((d) => d.id !== targetId));
    setDeleteTarget(null);
    setDeleteConfirmText('');
    if (wasEditing) beginCreate();
    flashToast(unlinked > 0
      ? `Deleted — ${unlinked} course${unlinked === 1 ? '' : 's'} moved to Unassigned`
      : t('admin.deptDeleted'));
    setDeleting(false);
  };

  const inputStyle =
    'w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelStyle = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="space-y-6 pb-16 px-2 sm:px-0">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white">{t('admin.departmentsTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('admin.departmentsSubtitle')}
        </p>
      </motion.div>

      {toast && (
        <div className="fixed top-24 right-4 z-50 px-4 py-2 rounded-xl bg-green-500/90 text-white text-sm font-medium shadow-lg">
          <i className="ph-bold ph-check-circle mr-1.5" /> {toast}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left rail — list */}
        <div className={`${glassCardStyle} p-4 lg:col-span-1`}>
          <div className="relative mb-3">
            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.searchCodeOrName')}
              className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
            />
          </div>

          <button
            onClick={beginCreate}
            className={`w-full mb-3 px-3 py-2 rounded-xl text-sm font-bold transition-colors ${
              mode === 'create' && !editingId
                ? 'bg-[#6A3FF4] text-white'
                : 'bg-white/5 dark:bg-black/10 text-[#7B5AFF] hover:bg-[#6A3FF4]/10'
            }`}
          >
            <i className="ph-bold ph-plus-circle mr-1.5" /> {t('admin.newDepartment')}
          </button>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              <i className="ph-bold ph-warning-circle mr-2" /> {loadError}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-6">
              {search ? 'No departments match.' : 'No departments yet.'}
            </p>
          ) : (
            <div className="max-h-[640px] overflow-y-auto space-y-1 pr-1">
              {filtered.map((d) => {
                const isActive = editingId === d.id;
                return (
                  <div
                    key={d.id}
                    className={`p-3 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-[#6A3FF4]/15 border-l-2 border-[#6A3FF4]'
                        : 'hover:bg-white/5 dark:hover:bg-black/20 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => beginEdit(d)} className="flex-1 text-left">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-black dark:text-white">{d.code}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6A3FF4]/20 text-[#7B5AFF]">
                            {d.courseCount} courses
                          </span>
                          {!d.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-400">{t('admin.apDeptInactiveBadge')}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{d.name}</p>
                      </button>
                      <button
                        onClick={() => handleDelete(d)}
                        title={
                          d.courseCount > 0
                            ? `Delete — ${d.courseCount} course${d.courseCount === 1 ? '' : 's'} will be unlinked`
                            : 'Delete department'
                        }
                        className="text-xs text-red-400 hover:text-red-500 px-2 py-1"
                      >
                        <i className="ph-bold ph-trash" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right pane — form */}
        <div className="lg:col-span-2">
          <div className={`${glassCardStyle} p-6`}>
            <h2 className="text-lg font-bold text-black dark:text-white mb-1">
              {mode === 'edit' ? t('admin.editDept', { code: form.code }) : t('admin.newDepartment')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {mode === 'edit' ? 'Update the department metadata.' : 'Add a new academic department.'}
            </p>

            {/* Plan 4 Phase 2 follow-up — seed-state hint. The 6 FCDS
                academic programs (codes 01–06 per Article 1) live in this
                same table; they appear in the list on the left. Always
                visible (create + edit) since it's informational. */}
            <div className="mb-5 rounded-xl border border-[#6A3FF4]/30 bg-[#6A3FF4]/5 px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
              <div className="flex items-start gap-2">
                <i className="ph-bold ph-info text-[#7B5AFF] mt-0.5"></i>
                <p>
                  Add a custom department. The 6 {institution.regulatoryFramework} departments (codes 01–06) are seeded by default.
                </p>
              </div>
            </div>

            {saveError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                <i className="ph-bold ph-warning-circle mr-2" /> {saveError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className={labelStyle}>{t('admin.codeCol')}</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="e.g. CS"
                  className={inputStyle}
                />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.nameCol')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Computer Science"
                  className={inputStyle}
                />
              </div>
            </div>

            <div className="mb-3">
              <label className={labelStyle}>{t('admin.descriptionCol')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                placeholder={t('admin.apDeptOptionalDescPh')}
                className={inputStyle}
              />
            </div>

            {/* Plan 4 Phase 2 follow-up — program-level fields. Defaults
                match FCDS Article 8 (140 cr total = 106 compulsory + 24
                elective + 10 university requirements). Validator above
                blocks compulsory + elective > total. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className={labelStyle}>{t('admin.totalCreditsCol')}</label>
                <input
                  type="number"
                  min={30}
                  max={300}
                  value={form.totalCredits}
                  onChange={(e) => setForm((p) => ({ ...p, totalCredits: parseInt(e.target.value, 10) || 0 }))}
                  onFocus={(e) => e.currentTarget.select()}
                  className={inputStyle}
                />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.compulsoryCreditsCol')}</label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={form.compulsoryCredits}
                  onChange={(e) => setForm((p) => ({ ...p, compulsoryCredits: parseInt(e.target.value, 10) || 0 }))}
                  onFocus={(e) => e.currentTarget.select()}
                  className={inputStyle}
                />
              </div>
              <div>
                <label className={labelStyle}>{t('admin.electiveCreditsCol')}</label>
                <input
                  type="number"
                  min={0}
                  max={300}
                  value={form.electiveCredits}
                  onChange={(e) => setForm((p) => ({ ...p, electiveCredits: parseInt(e.target.value, 10) || 0 }))}
                  onFocus={(e) => e.currentTarget.select()}
                  className={inputStyle}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 mb-5 cursor-pointer" onClick={() => setForm((p) => ({ ...p, isActive: !p.isActive }))}>
              <GlassCheckbox
                checked={form.isActive}
                onChange={(v) => setForm((p) => ({ ...p, isActive: v }))}
                size="sm"
                ariaLabel="Active"
              />
              <span className="text-sm text-black dark:text-white">{t('admin.activeLbl')}</span>
              <span className="text-xs text-gray-500">— {t('admin.inactiveHidden')}</span>
            </div>

            {validationError && (
              <p className="text-xs text-red-400 mb-3">{validationError}</p>
            )}

            <div className="flex justify-end pt-3 border-t border-white/10">
              <button
                onClick={handleSave}
                disabled={saving || !!validationError}
                className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 text-sm font-bold rounded-lg transition-colors"
              >
                {saving ? t('admin.saving') : mode === 'edit' ? t('admin.saveChangesPolicy') : t('admin.createDept')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Plan 6 Phase 6 — typed-confirmation delete modal. The admin must
          type the department code to enable the Delete button. When courses
          are linked, the modal also calls out that they'll move to
          "Unassigned" so the admin can see the impact before committing. */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
          onClick={closeDeleteModal}
        >
          <div
            className={`${glassCardStyle} max-w-md w-full p-6 space-y-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center flex-shrink-0">
                <i className="ph-bold ph-warning-circle text-red-400 text-xl" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-black dark:text-white">
                  {t('admin.deleteDept', { name: deleteTarget.name })}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  This will permanently delete the department row.
                  {deleteTarget.courseCount > 0 && (
                    <>
                      {' '}
                      <span className="text-amber-300 font-medium">
                        {deleteTarget.courseCount} course
                        {deleteTarget.courseCount === 1 ? '' : 's'} currently linked will move to{' '}
                        <span className="text-black dark:text-white font-bold">{t('admin.apDeptUnassignedBold')}</span>.
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {t('admin.typeCodeConfirm', { code: deleteTarget.code })}
              </label>
              <input
                autoFocus
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={deleteTarget.code}
                disabled={deleting}
                className="w-full bg-white/5 dark:bg-black/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-red-400 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeDeleteModal}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-white/5 dark:bg-black/20 text-gray-600 dark:text-gray-300 hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {t('admin.cancelBtn')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmText.trim() !== deleteTarget.code}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? t('admin.deleting') : t('admin.deleteDeptBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepartmentsPage;
