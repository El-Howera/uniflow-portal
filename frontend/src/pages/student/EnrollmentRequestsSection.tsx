// src/pages/student/EnrollmentRequestsSection.tsx
//
// Plan 4 Phase 6 — student-side compose UI for the three enrollment
// workflows (suspension / cancellation / programme change). Mirrors the
// name-change flow's pattern: status pill when an existing request is
// pending, button + modal otherwise. Each workflow has its own state and
// own POST endpoint; SA / admin reviews them in SAEnrollmentWorkflows.
import { FC, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';

const cardStyle = 'bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl p-6 backdrop-filter backdrop-blur-lg';

type Workflow = 'suspension' | 'cancellation' | 'programme-change';
interface RowMin { id: string; status: string; created_at: string; }

const STATUS_CHIP: Record<string, string> = {
  pending:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  approved:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  rejected:  'bg-red-500/15 text-red-400 border-red-500/30',
  withdrawn: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
};

interface Department { code: string; name: string; }

const EnrollmentRequestsSection: FC = () => {
  const t = useT();
  // Per-workflow state.
  const [suspensions,   setSuspensions]   = useState<RowMin[]>([]);
  const [cancellations, setCancellations] = useState<RowMin[]>([]);
  const [programmeChanges, setProgrammeChanges] = useState<(RowMin & { from_program_code?: string | null; to_program_code: string })[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [openModal, setOpenModal] = useState<Workflow | null>(null);
  const [modalReason, setModalReason] = useState('');
  const [modalSemesters, setModalSemesters] = useState(1);
  const [modalIsMilitary, setModalIsMilitary] = useState(false);
  const [modalToProgramCode, setModalToProgramCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const refresh = async () => {
    const headers = authHeaders();
    try {
      const [sRes, cRes, pcRes] = await Promise.all([
        fetch(`${API_URLS.studentAffairs()}/api/sa/suspensions`, { headers, credentials: 'include' }),
        fetch(`${API_URLS.studentAffairs()}/api/sa/cancellations`, { headers, credentials: 'include' }),
        fetch(`${API_URLS.studentAffairs()}/api/sa/programme-changes`, { headers, credentials: 'include' }),
      ]);
      const sJ = sRes.ok ? await sRes.json() : { suspensions: [] };
      const cJ = cRes.ok ? await cRes.json() : { cancellations: [] };
      const pcJ = pcRes.ok ? await pcRes.json() : { programmeChanges: [] };
      setSuspensions(Array.isArray(sJ.suspensions) ? sJ.suspensions : []);
      setCancellations(Array.isArray(cJ.cancellations) ? cJ.cancellations : []);
      setProgrammeChanges(Array.isArray(pcJ.programmeChanges) ? pcJ.programmeChanges : []);
    } catch {
      // Silent — keep previous state.
    }
  };

  useEffect(() => {
    refresh();
    // Pull active departments for the programme-change picker.
    fetch(`${API_URLS.registration()}/api/admin/departments`, {
      headers: authHeaders(),
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d?.departments) ? d.departments : [];
        const active = list.filter((x: Department & { isActive?: boolean }) => x.isActive !== false);
        setDepartments(active.map((x: Department) => ({ code: x.code, name: x.name })));
      })
      .catch(() => {});
  }, []);

  const pendingSuspension = useMemo(() => suspensions.find((s) => s.status === 'pending'), [suspensions]);
  const pendingCancellation = useMemo(() => cancellations.find((c) => c.status === 'pending'), [cancellations]);
  const pendingProgrammeChange = useMemo(() => programmeChanges.find((p) => p.status === 'pending'), [programmeChanges]);

  const openFor = (w: Workflow) => {
    setOpenModal(w);
    setModalReason('');
    setModalSemesters(1);
    setModalIsMilitary(false);
    setModalToProgramCode('');
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setOkMsg(null);
    try {
      let url = '';
      let body: Record<string, unknown> = {};
      if (openModal === 'suspension') {
        if (modalReason.trim().length < 3) throw new Error(t('enrollmentReqs.errReasonShort'));
        url = `${API_URLS.studentAffairs()}/api/sa/suspensions`;
        body = { reason: modalReason.trim(), semesters: modalSemesters, isMilitary: modalIsMilitary };
      } else if (openModal === 'cancellation') {
        if (modalReason.trim().length < 3) throw new Error(t('enrollmentReqs.errReasonShort'));
        url = `${API_URLS.studentAffairs()}/api/sa/cancellations`;
        body = { reason: modalReason.trim() };
      } else if (openModal === 'programme-change') {
        if (modalReason.trim().length < 3) throw new Error(t('enrollmentReqs.errReasonShort'));
        if (!modalToProgramCode) throw new Error(t('enrollmentReqs.errPickDept'));
        url = `${API_URLS.studentAffairs()}/api/sa/programme-changes`;
        body = { toProgramCode: modalToProgramCode, reason: modalReason.trim() };
      } else {
        return;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setOpenModal(null);
      setOkMsg(t('enrollmentReqs.okSubmitted'));
      setTimeout(() => setOkMsg(null), 3500);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('enrollmentReqs.errSubmit'));
    } finally {
      setSubmitting(false);
    }
  };

  const programmeOptions = useMemo(
    () => departments.map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` })),
    [departments],
  );

  return (
    <div className={cardStyle}>
      <div className="flex items-center gap-3 mb-1">
        <i className="ph-bold ph-pause-circle text-2xl text-[#6A3FF4]"></i>
        <div>
          <h3 className="text-lg font-bold text-black dark:text-white">{t('enrollmentReqs.sectionTitle')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('enrollmentReqs.sectionSubtitle')}</p>
        </div>
      </div>

      {okMsg && (
        <div className="mt-3 mb-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
          <i className="ph-bold ph-check-circle mr-1.5" />{okMsg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        {/* Suspension */}
        <button
          onClick={() => openFor('suspension')}
          disabled={!!pendingSuspension}
          className={`text-left rounded-xl border p-4 transition-all ${
            pendingSuspension
              ? 'bg-white/5 border-white/10 cursor-not-allowed opacity-60'
              : 'bg-white/5 border-white/10 hover:border-[#6A3FF4]/40 hover:bg-[#6A3FF4]/5'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <i className="ph-bold ph-pause text-[#7B5AFF]" />
            <span className="text-sm font-bold text-black dark:text-white">{t('enrollmentReqs.suspendTitle')}</span>
          </div>
          <p className="text-[11px] text-gray-500">{t('enrollmentReqs.suspendBody')}</p>
          {pendingSuspension && (
            <span className={`inline-block mt-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${STATUS_CHIP.pending}`}>
              {t('enrollmentReqs.pendingReview')}
            </span>
          )}
        </button>

        {/* Cancellation */}
        <button
          onClick={() => openFor('cancellation')}
          disabled={!!pendingCancellation}
          className={`text-left rounded-xl border p-4 transition-all ${
            pendingCancellation
              ? 'bg-white/5 border-white/10 cursor-not-allowed opacity-60'
              : 'bg-white/5 border-white/10 hover:border-[#6A3FF4]/40 hover:bg-[#6A3FF4]/5'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <i className="ph-bold ph-x-circle text-red-400" />
            <span className="text-sm font-bold text-black dark:text-white">{t('enrollmentReqs.cancelTitle')}</span>
          </div>
          <p className="text-[11px] text-gray-500">{t('enrollmentReqs.cancelBody')}</p>
          {pendingCancellation && (
            <span className={`inline-block mt-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${STATUS_CHIP.pending}`}>
              {t('enrollmentReqs.pendingReview')}
            </span>
          )}
        </button>

        {/* Programme Change */}
        <button
          onClick={() => openFor('programme-change')}
          disabled={!!pendingProgrammeChange}
          className={`text-left rounded-xl border p-4 transition-all ${
            pendingProgrammeChange
              ? 'bg-white/5 border-white/10 cursor-not-allowed opacity-60'
              : 'bg-white/5 border-white/10 hover:border-[#6A3FF4]/40 hover:bg-[#6A3FF4]/5'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <i className="ph-bold ph-arrows-left-right text-blue-400" />
            <span className="text-sm font-bold text-black dark:text-white">{t('enrollmentReqs.changeTitle')}</span>
          </div>
          <p className="text-[11px] text-gray-500">{t('enrollmentReqs.changeBody')}</p>
          {pendingProgrammeChange && (
            <span className={`inline-block mt-2 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${STATUS_CHIP.pending}`}>
              {t('enrollmentReqs.pendingReview')}
            </span>
          )}
        </button>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {openModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !submitting && setOpenModal(null)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl p-6 border border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-black dark:text-white mb-1">
                {openModal === 'suspension' && t('enrollmentReqs.suspendTitle')}
                {openModal === 'cancellation' && t('enrollmentReqs.cancelTitle')}
                {openModal === 'programme-change' && t('enrollmentReqs.changeTitle')}
              </h2>
              <p className="text-xs text-gray-500 mb-4">
                {openModal === 'suspension' && t('enrollmentReqs.modalSuspendDesc')}
                {openModal === 'cancellation' && t('enrollmentReqs.modalCancelDesc')}
                {openModal === 'programme-change' && t('enrollmentReqs.modalChangeDesc')}
              </p>

              {openModal === 'suspension' && (
                <>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">{t('enrollmentReqs.semestersLabel')}</label>
                  <input
                    type="number" min={1} max={20}
                    value={modalSemesters}
                    onChange={(e) => setModalSemesters(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white mb-3"
                  />
                  <div
                    className="flex items-center gap-2 mb-3 cursor-pointer"
                    onClick={() => setModalIsMilitary(!modalIsMilitary)}
                  >
                    <GlassCheckbox
                      checked={modalIsMilitary}
                      onChange={setModalIsMilitary}
                      size="sm"
                    />
                    <span className="text-sm text-black dark:text-white">{t('enrollmentReqs.militaryLabel')}</span>
                  </div>
                </>
              )}

              {openModal === 'programme-change' && (
                <>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">{t('enrollmentReqs.targetProgrammeLabel')}</label>
                  <div className="mb-3">
                    <GlassDropdown
                      value={modalToProgramCode}
                      onChange={setModalToProgramCode}
                      options={[{ value: '', label: t('enrollmentReqs.pickDeptPlaceholder') }, ...programmeOptions]}
                      direction="auto"
                      className="w-full"
                    />
                  </div>
                </>
              )}

              <label className="block text-[10px] uppercase font-bold tracking-wider text-gray-500 mb-1">{t('enrollmentReqs.reasonLabel')}</label>
              <textarea
                rows={3}
                value={modalReason}
                onChange={(e) => setModalReason(e.target.value)}
                placeholder={t('enrollmentReqs.reasonPlaceholder')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white placeholder-gray-500 mb-3"
              />

              {error && (
                <p className="text-xs text-red-400 mb-3">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => !submitting && setOpenModal(null)}
                  className="text-sm text-gray-500 hover:text-black dark:hover:text-white px-4 py-2"
                >
                  {t('enrollmentReqs.cancelBtn')}
                </button>
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="bg-[#6A3FF4] hover:bg-[#5A32D4] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-bold"
                >
                  {submitting ? t('enrollmentReqs.submitting') : t('enrollmentReqs.submitBtn')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EnrollmentRequestsSection;
