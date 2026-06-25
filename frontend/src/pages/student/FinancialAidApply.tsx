/**
 * FinancialAidApply — Plan 7 Phase 6 application form.
 *
 * Submits to `POST /api/financial-aid`. Required: requestedAmount (>0),
 * justification (3-2000 chars). Optional: applicantIncome, dependents,
 * supportingDocs[] (max 5 files × 10 MB each). Files upload one-at-a-time
 * via `POST /api/financial-aid/upload` and the returned `{url, name,
 * sizeBytes}` is collected into the `supportingDocs[]` payload.
 */

import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { apiFetch, authHeaders } from '../../utils/api';
import { useCurrency } from '../../utils/format';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
  'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

interface SupportingDoc {
  name: string;
  url: string;
  sizeBytes: number;
}

const MAX_DOCS = 5;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const FinancialAidApply: React.FC = () => {
  const navigate = useNavigate();
  const currency = useCurrency();
  const t = useT();

  const [requestedAmount, setRequestedAmount] = useState('');
  const [applicantIncome, setApplicantIncome] = useState('');
  const [dependents, setDependents] = useState('');
  const [justification, setJustification] = useState('');
  const [docs, setDocs] = useState<SupportingDoc[]>([]);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerFilePick = () => fileInputRef.current?.click();

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // reset so picking the same file twice still fires onChange
    if (files.length === 0) return;
    if (docs.length + files.length > MAX_DOCS) {
      setError(t('financialAidApply.errMaxDocs', { max: MAX_DOCS }));
      return;
    }
    setUploading(true);
    try {
      for (const f of files) {
        if (f.size > MAX_DOC_BYTES) {
          setError(t('financialAidApply.errFileTooLarge', { name: f.name, size: formatBytes(f.size) }));
          continue;
        }
        const fd = new FormData();
        fd.append('file', f);
        // Multer endpoint expects multipart — don't let apiFetch set
        // Content-Type to application/json. Raw fetch with the auth header.
        const res = await fetch(`${API_URLS.payments()}/api/financial-aid/upload`, {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders() as Record<string, string>,
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string; message?: string }).message
            || (data as { error?: string }).error
            || t('financialAidApply.errUploadFor', { name: f.name }));
          continue;
        }
        if (data && (data as { url?: string }).url) {
          setDocs((prev) => [
            ...prev,
            {
              name: (data as { name: string }).name,
              url: (data as { url: string }).url,
              sizeBytes: (data as { sizeBytes: number }).sizeBytes,
            },
          ]);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = (idx: number) => {
    setDocs((prev) => prev.filter((_, i) => i !== idx));
  };

  const validate = (): string | null => {
    const amt = Number(requestedAmount);
    if (!Number.isFinite(amt) || amt <= 0) return t('financialAidApply.errAmountGt0');
    if (!justification.trim() || justification.trim().length < 10) return t('financialAidApply.errJustifyShort');
    if (justification.trim().length > 2000) return t('financialAidApply.errJustifyLong');
    if (applicantIncome && (!Number.isFinite(Number(applicantIncome)) || Number(applicantIncome) < 0)) {
      return t('financialAidApply.errIncomeNonNeg');
    }
    if (dependents && (!Number.isInteger(Number(dependents)) || Number(dependents) < 0)) {
      return t('financialAidApply.errDependentsInt');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        requestedAmount: Number(requestedAmount),
        justification: justification.trim(),
      };
      if (applicantIncome) payload.applicantIncome = Number(applicantIncome);
      if (dependents) payload.dependents = Number(dependents);
      if (docs.length > 0) payload.supportingDocs = docs;

      const res = await apiFetch(`${API_URLS.payments()}/api/financial-aid`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data as {
          error?: string;
          message?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        };
        // Surface server-side Zod field errors instead of a bare "validation".
        const fieldErrs = d.details?.fieldErrors;
        const firstFieldMsg = fieldErrs
          ? Object.values(fieldErrs).flat().find(Boolean)
          : undefined;
        setError(d.message || firstFieldMsg || d.error || t('financialAidApply.errCouldNotSubmit'));
        return;
      }
      setSuccess(t('financialAidApply.submittedOk'));
      setTimeout(() => navigate('/student/financial-aid'), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('financialAidApply.errNetwork'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 pb-16 space-y-5 p-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`${glassCardStyle} p-6 flex items-start justify-between gap-4 flex-wrap`}
      >
        <div>
          <h1 className="text-black dark:text-white text-2xl font-bold flex items-center gap-2">
            <i className="ph-bold ph-hand-coins text-[#6A3FF4]"></i>
            {t('financialAidApply.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
            {t('financialAidApply.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/student/financial-aid')}
          className="px-4 py-2 rounded-xl bg-white/30 dark:bg-black/30 border border-white/20 dark:border-white/10 text-black dark:text-white font-bold text-sm hover:bg-white/40 dark:hover:bg-black/40 transition-colors flex items-center gap-2"
        >
          <i className="ph-bold ph-arrow-left"></i> {t('financialAidApply.backBtn')}
        </button>
      </motion.div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-x-circle"></i> {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i> {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className={`${glassCardStyle} p-6 space-y-5`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
              {t('financialAidApply.requestedAmountLabel', { currency })} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={requestedAmount}
              onChange={(e) => setRequestedAmount(e.target.value)}
              placeholder={t('financialAidApply.requestedAmountPlaceholder')}
              className={inputStyle}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
              {t('financialAidApply.applicantIncomeLabel', { currency })}
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={applicantIncome}
              onChange={(e) => setApplicantIncome(e.target.value)}
              placeholder={t('financialAidApply.optionalPlaceholder')}
              className={inputStyle}
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
              {t('financialAidApply.dependentsLabel')}
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={dependents}
              onChange={(e) => setDependents(e.target.value)}
              placeholder={t('financialAidApply.optionalPlaceholder')}
              className={inputStyle}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
            {t('financialAidApply.justificationLabel')} <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            maxLength={2000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder={t('financialAidApply.justificationPlaceholder')}
            className={`${inputStyle} resize-none`}
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
            {justification.length} / 2000
          </p>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
            {t('financialAidApply.supportingDocsLabel')}{' '}
            <span className="text-gray-400 dark:text-gray-500 font-normal">
              {t('financialAidApply.supportingDocsHint', { max: MAX_DOCS })}
            </span>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFiles}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          />
          <button
            type="button"
            disabled={uploading || docs.length >= MAX_DOCS}
            onClick={triggerFilePick}
            className="w-full border-2 border-dashed border-gray-300/50 dark:border-[#363636] rounded-xl p-4 hover:border-[#6A3FF4]/50 transition-colors text-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i
              className={`ph-bold ${
                uploading ? 'ph-spinner animate-spin' : 'ph-upload-simple'
              } text-2xl text-[#6A3FF4] block mb-1`}
            ></i>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {uploading
                ? t('financialAidApply.uploading')
                : docs.length >= MAX_DOCS
                ? t('financialAidApply.limitReached', { n: MAX_DOCS, max: MAX_DOCS })
                : t('financialAidApply.clickToAddFiles')}
            </span>
            <span className="block text-[10px] text-gray-500 mt-0.5">
              {t('financialAidApply.fileTypesHint')}
            </span>
          </button>

          {docs.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {docs.map((d, i) => (
                <li
                  key={`${d.url}-${i}`}
                  className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0 text-black dark:text-white">
                    <i className="ph-bold ph-file text-[#6A3FF4]"></i>
                    <span className="truncate">{d.name}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      ({formatBytes(d.sizeBytes)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDoc(i)}
                    className="text-red-500 hover:text-red-700 text-xs"
                    aria-label={t('financialAidApply.removeDoc')}
                  >
                    <i className="ph-bold ph-x"></i>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || uploading}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50"
          >
            <i
              className={`ph-bold ${
                submitting ? 'ph-spinner animate-spin' : 'ph-paper-plane-tilt'
              }`}
            ></i>
            {submitting ? t('financialAidApply.submitting') : t('financialAidApply.submitBtn')}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => navigate('/student/financial-aid')}
            className={`px-5 py-3 rounded-xl ${glassCardStyle} text-black dark:text-gray-300 font-bold hover:bg-white/20 dark:hover:bg-black/30 transition-colors disabled:opacity-50`}
          >
            {t('financialAidApply.cancelBtn')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default FinancialAidApply;
