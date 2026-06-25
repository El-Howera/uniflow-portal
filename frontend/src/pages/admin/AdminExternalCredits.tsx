// src/pages/admin/AdminExternalCredits.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls. The transfer queue +
// student picker run on static mock data; create / approve / reject / delete
// are local-only state mutations.
//
// Admin queue for external credit transfers (FCDS Article 25a). Admin enters
// incoming transfers and approves / rejects them.
import { FC, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

interface TransferRow {
  id: string;
  user_id: string;
  external_course_title: string;
  external_institution: string;
  credit_hours: number;
  grade_letter: string | null;
  equivalent_course_code: string | null;
  status: string;
  include_in_cgpa: boolean;
  review_note: string | null;
  created_at: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail?: string;
}

interface StudentLite { id: string; firstName: string; lastName: string; email: string; }

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  approved:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected:  'bg-red-500/15 text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_TRANSFERS: TransferRow[] = [
  {
    id: 'xc-1', user_id: 'stu-1182', external_course_title: 'Advanced Algorithms',
    external_institution: 'Cairo University', credit_hours: 3, grade_letter: 'A',
    equivalent_course_code: 'CS305', status: 'pending', include_in_cgpa: true,
    review_note: null, created_at: '2026-04-26T09:00:00.000Z',
    userFirstName: 'Mariam', userLastName: 'El-Sayed', userEmail: 'mariam.elsayed@uniflow.test',
  },
  {
    id: 'xc-2', user_id: 'stu-1212', external_course_title: 'Introduction to Statistics',
    external_institution: 'Ain Shams University', credit_hours: 3, grade_letter: 'B+',
    equivalent_course_code: 'MA210', status: 'pending', include_in_cgpa: true,
    review_note: null, created_at: '2026-04-24T13:30:00.000Z',
    userFirstName: 'Youssef', userLastName: 'Ibrahim', userEmail: 'youssef.ibrahim@uniflow.test',
  },
  {
    id: 'xc-3', user_id: 'stu-1204', external_course_title: 'Cloud Computing Fundamentals',
    external_institution: 'Erasmus Exchange — TU Munich', credit_hours: 4, grade_letter: 'A-',
    equivalent_course_code: 'CS340', status: 'approved', include_in_cgpa: true,
    review_note: 'Within the 25% external-credit cap.', created_at: '2026-04-18T10:15:00.000Z',
    userFirstName: 'Salma', userLastName: 'Farouk', userEmail: 'salma.farouk@uniflow.test',
  },
  {
    id: 'xc-4', user_id: 'stu-1190', external_course_title: 'Digital Marketing',
    external_institution: 'Alexandria University', credit_hours: 3, grade_letter: 'B',
    equivalent_course_code: null, status: 'rejected', include_in_cgpa: false,
    review_note: 'No equivalent FCDS course; exceeds external cap.', created_at: '2026-04-15T08:45:00.000Z',
    userFirstName: 'Omar', userLastName: 'Hassan', userEmail: 'omar.hassan@uniflow.test',
  },
];

const MOCK_STUDENTS: StudentLite[] = [
  { id: 'stu-1182', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.test' },
  { id: 'stu-1190', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.test' },
  { id: 'stu-1204', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@uniflow.test' },
  { id: 'stu-1212', firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.test' },
  { id: 'stu-1220', firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.test' },
  { id: 'stu-1233', firstName: 'Karim', lastName: 'Mostafa', email: 'karim.mostafa@uniflow.test' },
];

const AdminExternalCredits: FC = () => {
  const t = useT();
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add-transfer modal state.
  const [showAdd, setShowAdd] = useState(false);
  const [students] = useState<StudentLite[]>(MOCK_STUDENTS);
  const [studentSearch, setStudentSearch] = useState('');
  const [form, setForm] = useState({
    userId: '',
    externalCourseTitle: '',
    externalInstitution: '',
    creditHours: 3,
    gradeLetter: '',
    equivalentCourseCode: '',
    includeInCgpa: true,
  });
  const [submitting, setSubmitting] = useState(false);

  // Per-row review-note input state.
  const [reviewFor, setReviewFor] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const flash = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    window.setTimeout(() => setActionMsg(null), 5000);
  };

  // Load transfers from mock data; the filter narrows the visible list.
  useEffect(() => {
    setLoading(true);
    const id = window.setTimeout(() => {
      const all = MOCK_TRANSFERS;
      setRows(filter === 'pending' ? all.filter((r) => r.status === 'pending') : all);
      setLoading(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [filter]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students.slice(0, 30);
    return students.filter(
      (s) =>
        `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q),
    ).slice(0, 30);
  }, [students, studentSearch]);

  // Local-only create — prepend a new pending transfer row.
  const submitNew = () => {
    if (!form.userId)             return flash('error', t('admin.pickStudentErr'));
    if (!form.externalCourseTitle) return flash('error', t('admin.courseTitleRequired'));
    if (!form.externalInstitution) return flash('error', t('admin.institutionRequired'));
    if (form.creditHours < 1 || form.creditHours > 30) return flash('error', t('admin.creditHoursRange'));

    setSubmitting(true);
    window.setTimeout(() => {
      const student = students.find((s) => s.id === form.userId);
      const newRow: TransferRow = {
        id: `xc-${Date.now()}`,
        user_id: form.userId,
        external_course_title: form.externalCourseTitle,
        external_institution: form.externalInstitution,
        credit_hours: form.creditHours,
        grade_letter: form.gradeLetter || null,
        equivalent_course_code: form.equivalentCourseCode || null,
        status: 'pending',
        include_in_cgpa: form.includeInCgpa,
        review_note: null,
        created_at: new Date().toISOString(),
        userFirstName: student?.firstName,
        userLastName: student?.lastName,
        userEmail: student?.email,
      };
      setRows((prev) => [newRow, ...prev]);
      setSubmitting(false);
      flash('success', t('admin.transferCreatedFlash'));
      setShowAdd(false);
      setForm({
        userId: '', externalCourseTitle: '', externalInstitution: '',
        creditHours: 3, gradeLetter: '', equivalentCourseCode: '', includeInCgpa: true,
      });
    }, 400);
  };

  // Local-only approve / reject.
  const doReview = (id: string, action: 'approve' | 'reject', note: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status: action === 'approve' ? 'approved' : 'rejected', review_note: note || null }
          : r,
      ),
    );
    flash('success', action === 'approve' ? t('admin.transferApprovedFlash') : t('admin.transferRejectedFlash'));
    setReviewFor(null);
    setReviewNote('');
  };

  // Local-only delete.
  const handleDelete = (id: string) => {
    if (!window.confirm(t('admin.deleteTransferConfirm'))) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    flash('success', t('admin.transferDeleted'));
  };

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="pb-16">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-black dark:text-white">{t('admin.externalCredits')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('admin.externalCreditsSubtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          <i className="ph-bold ph-plus" /> {t('admin.newTransferBtn')}
        </button>
      </motion.div>

      <div className="flex gap-2 mb-4">
        <div className="min-w-[180px]">
          <GlassDropdown
            value={filter}
            onChange={(v) => setFilter(v as 'pending' | 'all')}
            options={[
              { value: 'pending', label: t('admin.pendingOnly') },
              { value: 'all', label: t('admin.allStatuses') },
            ]}
            direction="down"
            className="w-full"
          />
        </div>
      </div>

      <AnimatePresence>
        {actionMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className={`mb-4 p-3 rounded-xl text-sm border ${actionMsg.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}
          >
            <i className={`ph-bold ${actionMsg.type === 'success' ? 'ph-check-circle' : 'ph-warning'} mr-1.5`} />
            {actionMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p className="text-gray-500 text-center py-10">{t('admin.loadingShort')}</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 text-center py-10">{t('admin.noExternalTransfers')}</p>
      ) : (
        rows.map((r) => {
          const studentName = `${r.userFirstName || ''} ${r.userLastName || ''}`.trim() || r.userEmail || r.user_id;
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`${glassCardStyle} p-5 mb-3`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-black dark:text-white font-bold">{studentName}</p>
                  <p className="text-xs text-gray-500">{r.userEmail}</p>
                </div>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full border ${STATUS_BADGE[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium text-black dark:text-white">{r.external_course_title}</p>
                <p className="text-xs text-gray-500">{t('admin.transferAtInstitution', { institution: r.external_institution, credits: r.credit_hours, grade: r.grade_letter || '—' })}{r.equivalent_course_code && t('admin.mapsTo', { code: r.equivalent_course_code })}</p>
                {r.review_note && <p className="text-xs text-gray-500 italic mt-1">{t('admin.auditorNoteLabel', { note: r.review_note })}</p>}
                <p className="text-xs text-gray-500 mt-1">{t('admin.submittedOn', { date: new Date(r.created_at).toLocaleDateString() })}</p>
              </div>

              {r.status === 'pending' ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => setReviewFor({ id: r.id, action: 'approve' })}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 px-4 py-1.5 rounded-lg text-sm font-bold"
                  >
                    <i className="ph-bold ph-check mr-1.5" />{t('admin.approveBtn2')}
                  </button>
                  <button
                    onClick={() => setReviewFor({ id: r.id, action: 'reject' })}
                    className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 px-4 py-1.5 rounded-lg text-sm font-bold"
                  >
                    <i className="ph-bold ph-x mr-1.5" />{t('admin.rejectBtn')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-xs text-red-400 hover:text-red-500 mt-3"
                >
                  <i className="ph-bold ph-trash mr-1" />{t('admin.deleteRecordBtn')}
                </button>
              )}

              {reviewFor?.id === r.id && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 dark:bg-black/20 p-3">
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder={reviewFor.action === 'approve' ? t('admin.reviewNoteApprove') : t('admin.reviewNoteReject')}
                    rows={2}
                    className={inputCls}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => { setReviewFor(null); setReviewNote(''); }} className="text-xs text-gray-500 hover:text-black dark:hover:text-white">{t('admin.cancelBtnSmall')}</button>
                    <button
                      onClick={() => doReview(r.id, reviewFor.action, reviewNote)}
                      className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white px-4 py-1.5 rounded-lg text-xs font-bold"
                    >
                      {reviewFor.action === 'approve' ? t('admin.confirmApproval') : t('admin.confirmRejection')}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          );
        })
      )}

      {/* New transfer modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !submitting && setShowAdd(false)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="w-full max-w-lg bg-white dark:bg-[#1a1a1a] rounded-2xl p-6 border border-white/10 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.newExternalCreditTransfer')}</h2>
              <p className="text-xs text-gray-500 mb-4">{t('admin.transferModalHint')}</p>

              {/* Student picker */}
              <label className={labelCls}>{t('admin.studentLabel')}</label>
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder={t('admin.searchByNameOrEmailDots')}
                className={`${inputCls} mb-2`}
              />
              <div className="max-h-32 overflow-y-auto border border-white/10 rounded-lg mb-3">
                {filteredStudents.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setForm((f) => ({ ...f, userId: s.id }))}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#6A3FF4]/10 ${form.userId === s.id ? 'bg-[#6A3FF4]/20' : ''}`}
                  >
                    <span className="text-black dark:text-white font-medium">{s.firstName} {s.lastName}</span>
                    <span className="text-gray-500 ml-2">— {s.email}</span>
                  </button>
                ))}
                {filteredStudents.length === 0 && (
                  <p className="text-xs text-gray-500 p-2">{t('admin.noStudentsMatch')}</p>
                )}
              </div>
              {form.userId && <p className="text-[10px] text-emerald-400 mb-3">{t('admin.selectedLabel', { id: form.userId })}</p>}

              <label className={labelCls}>{t('admin.extCourseTitleLabel')}</label>
              <input value={form.externalCourseTitle} onChange={(e) => setForm((f) => ({ ...f, externalCourseTitle: e.target.value }))} className={`${inputCls} mb-3`} />

              <label className={labelCls}>{t('admin.institutionLabel')}</label>
              <input value={form.externalInstitution} onChange={(e) => setForm((f) => ({ ...f, externalInstitution: e.target.value }))} className={`${inputCls} mb-3`} />

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <label className={labelCls}>{t('admin.creditHoursLabel')}</label>
                  <input type="number" min={1} max={30} value={form.creditHours} onChange={(e) => setForm((f) => ({ ...f, creditHours: parseInt(e.target.value, 10) || 0 }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('admin.gradeLetterLabel')}</label>
                  <input value={form.gradeLetter} onChange={(e) => setForm((f) => ({ ...f, gradeLetter: e.target.value }))} placeholder={t('admin.gradeLetterPlaceholder')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('admin.fcdsEquivalentLabel')}</label>
                  <input value={form.equivalentCourseCode} onChange={(e) => setForm((f) => ({ ...f, equivalentCourseCode: e.target.value }))} placeholder={t('admin.optionalLabelLc')} className={inputCls} />
                </div>
              </div>

              <div
                className="flex items-center gap-2 mb-4 cursor-pointer"
                onClick={() => setForm((f) => ({ ...f, includeInCgpa: !f.includeInCgpa }))}
              >
                <GlassCheckbox
                  checked={form.includeInCgpa}
                  onChange={(v) => setForm((f) => ({ ...f, includeInCgpa: v }))}
                  size="sm"
                />
                <span className="text-sm text-black dark:text-white">{t('admin.includeInCgpaLabel')}</span>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => !submitting && setShowAdd(false)} className="text-sm text-gray-500 hover:text-black dark:hover:text-white px-4 py-2">{t('admin.cancelBtnSmall')}</button>
                <button
                  onClick={submitNew}
                  disabled={submitting}
                  className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold"
                >
                  {submitting ? t('admin.savingDots2') : t('admin.createTransfer')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminExternalCredits;
