// src/pages/admin/AdminAuditors.tsx
//
// MVP BUILD — pure front-end mockup. No backend calls. The auditor queue,
// user / course / section pickers run on static mock data; create / approve /
// reject / delete are local-only state mutations.
//
// Admin queue for auditor enrollments (FCDS Article 24). Auditors register
// for a section without earning credit. Two flavours:
//   - Internal: an existing FCDS user auditing a course.
//   - External: a non-FCDS visitor (name + email instead of a userId).
import { FC, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useT } from '../../i18n';

const glassCardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg';

interface AuditorRow {
  id: string;
  user_id: string | null;
  external_auditor_name: string | null;
  external_auditor_email: string | null;
  course_section_id: string;
  status: string;
  review_note: string | null;
  approved_at: string | null;
  created_at: string;
  userFirstName?: string;
  userLastName?: string;
  userEmail?: string;
  courseCode?: string;
  courseTitle?: string;
  sectionLabel?: string;
}

interface UserLite { id: string; firstName: string; lastName: string; email: string; }
interface CourseLite { code: string; title: string; }
interface SectionLite { id: string; sectionId: string; type: string; capacity: number; }

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  approved:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected:  'bg-red-500/15 text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_AUDITORS: AuditorRow[] = [
  {
    id: 'aud-1', user_id: 'stu-1204', external_auditor_name: null, external_auditor_email: null,
    course_section_id: 'sec-cs301-l1', status: 'pending', review_note: null, approved_at: null,
    created_at: '2026-04-26T10:00:00.000Z',
    userFirstName: 'Salma', userLastName: 'Farouk', userEmail: 'salma.farouk@uniflow.test',
    courseCode: 'CS301', courseTitle: 'Operating Systems', sectionLabel: 'L1',
  },
  {
    id: 'aud-2', user_id: null, external_auditor_name: 'Dr. Tarek Mansour', external_auditor_email: 'tarek.mansour@external.edu',
    course_section_id: 'sec-ds310-l2', status: 'pending', review_note: null, approved_at: null,
    created_at: '2026-04-25T14:20:00.000Z',
    courseCode: 'DS310', courseTitle: 'Machine Learning', sectionLabel: 'L2',
  },
  {
    id: 'aud-3', user_id: 'stu-1212', external_auditor_name: null, external_auditor_email: null,
    course_section_id: 'sec-cy220-l1', status: 'approved', review_note: 'Approved — alumnus refresher.', approved_at: '2026-04-22T09:00:00.000Z',
    created_at: '2026-04-20T08:30:00.000Z',
    userFirstName: 'Youssef', userLastName: 'Ibrahim', userEmail: 'youssef.ibrahim@uniflow.test',
    courseCode: 'CY220', courseTitle: 'Network Security', sectionLabel: 'L1',
  },
  {
    id: 'aud-4', user_id: null, external_auditor_name: 'Eng. Laila Adel', external_auditor_email: 'laila.adel@external.edu',
    course_section_id: 'sec-ma205-l1', status: 'rejected', review_note: 'Section at capacity.', approved_at: null,
    created_at: '2026-04-18T11:45:00.000Z',
    courseCode: 'MA205', courseTitle: 'Linear Algebra', sectionLabel: 'L1',
  },
];

const MOCK_USERS: UserLite[] = [
  { id: 'stu-1182', firstName: 'Mariam', lastName: 'El-Sayed', email: 'mariam.elsayed@uniflow.test' },
  { id: 'stu-1190', firstName: 'Omar', lastName: 'Hassan', email: 'omar.hassan@uniflow.test' },
  { id: 'stu-1204', firstName: 'Salma', lastName: 'Farouk', email: 'salma.farouk@uniflow.test' },
  { id: 'stu-1212', firstName: 'Youssef', lastName: 'Ibrahim', email: 'youssef.ibrahim@uniflow.test' },
  { id: 'stu-1220', firstName: 'Nour', lastName: 'Abdelrahman', email: 'nour.abdelrahman@uniflow.test' },
  { id: 'stu-1233', firstName: 'Karim', lastName: 'Mostafa', email: 'karim.mostafa@uniflow.test' },
];

const MOCK_COURSES: CourseLite[] = [
  { code: 'CS301', title: 'Operating Systems' },
  { code: 'DS310', title: 'Machine Learning' },
  { code: 'CY220', title: 'Network Security' },
  { code: 'MA205', title: 'Linear Algebra' },
  { code: 'CS101', title: 'Introduction to Programming' },
];

const MOCK_SECTIONS: Record<string, SectionLite[]> = {
  CS301: [
    { id: 'sec-cs301-l1', sectionId: 'L1', type: 'Lecture', capacity: 120 },
    { id: 'sec-cs301-b1', sectionId: 'B1', type: 'Lab', capacity: 30 },
  ],
  DS310: [
    { id: 'sec-ds310-l2', sectionId: 'L2', type: 'Lecture', capacity: 90 },
    { id: 'sec-ds310-b1', sectionId: 'B1', type: 'Lab', capacity: 25 },
  ],
  CY220: [{ id: 'sec-cy220-l1', sectionId: 'L1', type: 'Lecture', capacity: 80 }],
  MA205: [{ id: 'sec-ma205-l1', sectionId: 'L1', type: 'Lecture', capacity: 150 }],
  CS101: [
    { id: 'sec-cs101-l1', sectionId: 'L1', type: 'Lecture', capacity: 200 },
    { id: 'sec-cs101-b1', sectionId: 'B1', type: 'Lab', capacity: 40 },
  ],
};

const AdminAuditors: FC = () => {
  const t = useT();
  const [rows, setRows] = useState<AuditorRow[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add-auditor modal state.
  const [showAdd, setShowAdd] = useState(false);
  const [auditorKind, setAuditorKind] = useState<'internal' | 'external'>('internal');
  const [users] = useState<UserLite[]>(MOCK_USERS);
  const [userSearch, setUserSearch] = useState('');
  const [courses] = useState<CourseLite[]>(MOCK_COURSES);
  const [selectedCourseCode, setSelectedCourseCode] = useState('');
  const [sections, setSections] = useState<SectionLite[]>([]);
  const [form, setForm] = useState({
    userId: '',
    externalAuditorName: '',
    externalAuditorEmail: '',
    courseSectionId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Per-row review-note input state.
  const [reviewFor, setReviewFor] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const flash = (type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    window.setTimeout(() => setActionMsg(null), 5000);
  };

  // Load auditor rows from mock data; the filter narrows the visible list.
  useEffect(() => {
    setLoading(true);
    const id = window.setTimeout(() => {
      const all = MOCK_AUDITORS;
      setRows(filter === 'pending' ? all.filter((r) => r.status === 'pending') : all);
      setLoading(false);
    }, 150);
    return () => window.clearTimeout(id);
  }, [filter]);

  // When a course is picked, surface its sections from the mock map.
  useEffect(() => {
    if (!selectedCourseCode) { setSections([]); return; }
    setSections(MOCK_SECTIONS[selectedCourseCode] ?? []);
  }, [selectedCourseCode]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 30);
    return users.filter(
      (u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    ).slice(0, 30);
  }, [users, userSearch]);

  // Local-only create — prepend a new pending auditor row.
  const submitNew = () => {
    if (!form.courseSectionId) return flash('error', t('admin.pickCourseSection'));
    if (auditorKind === 'internal' && !form.userId) return flash('error', t('admin.pickUserInternal'));
    if (auditorKind === 'external' && (!form.externalAuditorName || !form.externalAuditorEmail)) {
      return flash('error', t('admin.externalRequireBoth'));
    }

    setSubmitting(true);
    window.setTimeout(() => {
      const user = users.find((u) => u.id === form.userId);
      const section = sections.find((s) => s.id === form.courseSectionId);
      const course = courses.find((c) => c.code === selectedCourseCode);
      const newRow: AuditorRow = {
        id: `aud-${Date.now()}`,
        user_id: auditorKind === 'internal' ? form.userId : null,
        external_auditor_name: auditorKind === 'external' ? form.externalAuditorName : null,
        external_auditor_email: auditorKind === 'external' ? form.externalAuditorEmail : null,
        course_section_id: form.courseSectionId,
        status: 'pending',
        review_note: null,
        approved_at: null,
        created_at: new Date().toISOString(),
        userFirstName: user?.firstName,
        userLastName: user?.lastName,
        userEmail: user?.email,
        courseCode: course?.code,
        courseTitle: course?.title,
        sectionLabel: section?.sectionId,
      };
      setRows((prev) => [newRow, ...prev]);
      setSubmitting(false);
      flash('success', t('admin.auditorCreatedFlash'));
      setShowAdd(false);
      setForm({ userId: '', externalAuditorName: '', externalAuditorEmail: '', courseSectionId: '' });
      setSelectedCourseCode('');
    }, 400);
  };

  // Local-only approve / reject.
  const doReview = (id: string, action: 'approve' | 'reject', note: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: action === 'approve' ? 'approved' : 'rejected',
              review_note: note || null,
              approved_at: action === 'approve' ? new Date().toISOString() : null,
            }
          : r,
      ),
    );
    flash('success', action === 'approve' ? t('admin.auditorApprovedFlash') : t('admin.auditorRejectedFlash'));
    setReviewFor(null);
    setReviewNote('');
  };

  // Local-only delete.
  const handleDelete = (id: string) => {
    if (!window.confirm(t('admin.deleteAuditorConfirm'))) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    flash('success', t('admin.auditorDeleted'));
  };

  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]';
  const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="pb-16">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-black dark:text-white">{t('admin.auditorEnrollments')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('admin.auditorEnrollmentsSubtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-[#6A3FF4] hover:bg-[#5A32D4] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
        >
          <i className="ph-bold ph-plus" /> {t('admin.newAuditorBtn')}
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
        <p className="text-gray-500 text-center py-10">{t('admin.noAuditorEnrollments')}</p>
      ) : (
        rows.map((r) => {
          const auditorName = r.user_id
            ? `${r.userFirstName || ''} ${r.userLastName || ''}`.trim() || r.userEmail || r.user_id
            : r.external_auditor_name || t('admin.externalAuditorBtn');
          const auditorEmail = r.user_id ? r.userEmail : r.external_auditor_email;
          const isExternal = !r.user_id;
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className={`${glassCardStyle} p-5 mb-3`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-black dark:text-white font-bold">{auditorName}</p>
                    {isExternal && (
                      <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                        {t('admin.externalBadge')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{auditorEmail || '—'}</p>
                </div>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-full border ${STATUS_BADGE[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-medium text-black dark:text-white">
                  {r.courseCode || '?'} — {r.courseTitle || t('admin.courseLabel')}
                  {r.sectionLabel && <span className="text-xs text-gray-500 ml-2">{t('admin.sectionLabel')} {r.sectionLabel}</span>}
                </p>
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

      {/* New auditor modal */}
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
              <h2 className="text-lg font-bold text-black dark:text-white mb-1">{t('admin.newAuditorEnrollment')}</h2>
              <p className="text-xs text-gray-500 mb-4">{t('admin.auditorModalHint')}</p>

              {/* Kind toggle */}
              <div className="flex gap-2 mb-4">
                {(['internal', 'external'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setAuditorKind(k)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      auditorKind === k
                        ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                        : 'bg-white/5 text-gray-500 border-white/10 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    {k === 'internal' ? t('admin.fcdsUserBtn') : t('admin.externalAuditorBtn')}
                  </button>
                ))}
              </div>

              {auditorKind === 'internal' ? (
                <>
                  <label className={labelCls}>{t('admin.fcdsUserLabel')}</label>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder={t('admin.searchByNameOrEmailDots')}
                    className={`${inputCls} mb-2`}
                  />
                  <div className="max-h-32 overflow-y-auto border border-white/10 rounded-lg mb-3">
                    {filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => setForm((f) => ({ ...f, userId: u.id }))}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#6A3FF4]/10 ${form.userId === u.id ? 'bg-[#6A3FF4]/20' : ''}`}
                      >
                        <span className="text-black dark:text-white font-medium">{u.firstName} {u.lastName}</span>
                        <span className="text-gray-500 ml-2">— {u.email}</span>
                      </button>
                    ))}
                    {filteredUsers.length === 0 && (
                      <p className="text-xs text-gray-500 p-2">{t('admin.noUsersMatch')}</p>
                    )}
                  </div>
                  {form.userId && <p className="text-[10px] text-emerald-400 mb-3">{t('admin.selectedLabel', { id: form.userId })}</p>}
                </>
              ) : (
                <>
                  <label className={labelCls}>{t('admin.externalNameLabel')}</label>
                  <input value={form.externalAuditorName} onChange={(e) => setForm((f) => ({ ...f, externalAuditorName: e.target.value }))} className={`${inputCls} mb-3`} />
                  <label className={labelCls}>{t('admin.externalEmailLabel')}</label>
                  <input value={form.externalAuditorEmail} onChange={(e) => setForm((f) => ({ ...f, externalAuditorEmail: e.target.value }))} placeholder={t('admin.externalEmailPlaceholder')} className={`${inputCls} mb-3`} />
                </>
              )}

              <label className={labelCls}>{t('admin.courseLabel')}</label>
              <div className="mb-3">
                <GlassDropdown
                  value={selectedCourseCode}
                  onChange={(v) => { setSelectedCourseCode(v); setForm((f) => ({ ...f, courseSectionId: '' })); }}
                  options={[
                    { value: '', label: t('admin.pickCourse') },
                    ...courses.map((c) => ({ value: c.code, label: `${c.code} — ${c.title}` })),
                  ]}
                  direction="up"
                  className="w-full"
                />
              </div>

              <label className={labelCls}>{t('admin.sectionLabelTitle')}</label>
              <div className="mb-4">
                <GlassDropdown
                  value={form.courseSectionId}
                  onChange={(v) => setForm((f) => ({ ...f, courseSectionId: v }))}
                  options={[
                    { value: '', label: selectedCourseCode ? (sections.length ? t('admin.pickSection') : t('admin.noSectionsForCourse')) : t('admin.pickCourseFirst') },
                    ...sections.map((s) => ({ value: s.id, label: t('admin.sectionOptionFmt', { type: s.type, sectionId: s.sectionId, capacity: s.capacity }) })),
                  ]}
                  direction="up"
                  className="w-full"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={() => !submitting && setShowAdd(false)} className="text-sm text-gray-500 hover:text-black dark:hover:text-white px-4 py-2">{t('admin.cancelBtnSmall')}</button>
                <button
                  onClick={submitNew}
                  disabled={submitting}
                  className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold"
                >
                  {submitting ? t('admin.savingDots2') : t('admin.createEnrollment')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminAuditors;
