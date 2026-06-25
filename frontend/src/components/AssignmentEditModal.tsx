/**
 * AssignmentEditModal — staff-side edit for an existing Assignment row.
 * Shared by ProfCourseDetail and TACourseDetail so both surfaces get
 * identical controls.
 *
 * Backed by:
 *   - PATCH /api/courses/:courseCode/assignments/:id
 *
 * Field set mirrors the create form in ProfMaterials/TAMaterials so an
 * admin doesn't have to re-learn the layout: title, due date (glass
 * picker), max score, missing-grace hours, missing-penalty score delta.
 *
 * Optimistic save — calls onSaved with the updated assignment so the
 * parent list can swap the row without a full refetch.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { GlassDateTimePicker } from './GlassDateTimePicker';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

const inputStyle =
  'w-full bg-white/5 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-black dark:text-white focus:outline-none focus:border-[#6A3FF4]/60 transition-colors placeholder:text-gray-500';

export interface EditableAssignment {
  id: string;
  title: string;
  dueDate?: string | null;
  maxScore?: number | null;
  latePenalty?: number | null;
  missingAfterHours?: number | null;
}

interface Props {
  courseCode: string;
  assignment: EditableAssignment;
  onClose: () => void;
  /** Fires after a successful save with the API's returned assignment. */
  onSaved: (updated: EditableAssignment) => void;
}

// `<input type="datetime-local">` and the GlassDateTimePicker both expect
// the local-ISO format `YYYY-MM-DDTHH:MM`. The DB hands back a full ISO
// (UTC). Trim it to local without timezone math — exact-second precision
// isn't useful for a due date, so we just keep the stable prefix.
const toLocalIso = (iso?: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Format as YYYY-MM-DDTHH:MM in local time so the picker shows what the
  // staff originally chose, not the UTC equivalent.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const AssignmentEditModal: React.FC<Props> = ({
  courseCode,
  assignment,
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState(assignment.title);
  const [dueDate, setDueDate] = useState(toLocalIso(assignment.dueDate));
  const [maxScore, setMaxScore] = useState(
    assignment.maxScore != null ? String(assignment.maxScore) : '100',
  );
  const [latePenalty, setLatePenalty] = useState(
    assignment.latePenalty != null ? String(assignment.latePenalty) : '-2',
  );
  const [missingAfterHours, setMissingAfterHours] = useState(
    assignment.missingAfterHours != null ? String(assignment.missingAfterHours) : '0',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC closes the modal — same affordance as every other modal in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!dueDate) {
      setError('Due date is required.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        dueDate,
      };
      if (maxScore !== '' && !Number.isNaN(parseFloat(maxScore))) body.maxScore = parseFloat(maxScore);
      if (latePenalty !== '' && !Number.isNaN(parseFloat(latePenalty))) body.latePenalty = parseFloat(latePenalty);
      if (missingAfterHours !== '' && !Number.isNaN(parseInt(missingAfterHours, 10))) {
        body.missingAfterHours = parseInt(missingAfterHours, 10);
      }
      const res = await fetch(
        `${API_URLS.courseContent()}/api/courses/${encodeURIComponent(courseCode)}/assignments/${encodeURIComponent(assignment.id)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(authHeaders() as Record<string, string>) },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `Save failed (HTTP ${res.status})`);
        return;
      }
      onSaved((data as { assignment: EditableAssignment }).assignment);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className={`relative w-full max-w-lg ${glassCardStyle} p-6 space-y-4`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
              <i className="ph-bold ph-clipboard-text text-[#6A3FF4]"></i>
              Edit Assignment
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {courseCode} · {assignment.title}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-red-500/15 hover:text-red-500 text-gray-400 border border-white/10 hover:border-red-500/30 transition-colors flex items-center justify-center"
          >
            <i className="ph-bold ph-x text-xs"></i>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
            <i className="ph-bold ph-warning-circle"></i>
            {error}
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Assignment title"
            className={inputStyle}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Due Date &amp; Time
            </label>
            <GlassDateTimePicker
              value={dueDate}
              onChange={setDueDate}
              placeholder="Pick a date &amp; time"
              direction="auto"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
              Max Score
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              className={inputStyle}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"
              title="Hours after the due date before the assignment flips to 'Missing' on the student card."
            >
              Missing After (hours)
            </label>
            <input
              type="number"
              min="0"
              max="168"
              step="1"
              value={missingAfterHours}
              onChange={(e) => setMissingAfterHours(e.target.value)}
              className={inputStyle}
            />
          </div>
          <div>
            <label
              className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5"
              title="Score delta on missing. Negative = deduction. 0 disables the penalty."
            >
              Missing Penalty
            </label>
            <input
              type="number"
              step="0.5"
              value={latePenalty}
              onChange={(e) => setLatePenalty(e.target.value)}
              className={inputStyle}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-xl border border-white/20 dark:border-white/10 text-black dark:text-white text-sm font-semibold hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 flex items-center gap-2"
          >
            <i className={`ph-bold ${saving ? 'ph-spinner animate-spin' : 'ph-floppy-disk'}`}></i>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AssignmentEditModal;
