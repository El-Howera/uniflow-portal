/**
 * AnnouncementComposer — shared compose card used by both the Admin and SA
 * Announcements pages. Drives `POST /api/sa/announcements` (the same endpoint
 * powers admin + SA — server-side guard accepts both roles).
 *
 * Features:
 *   - Title + Body text
 *   - Category selector (events / academic / financial / health / general / student_affairs)
 *   - Recipients selector with four modes:
 *       1. All Students        (targetRoles=['student'])
 *       2. Specific Levels     (targetRoles=['student'], targetLevels=[…])
 *       3. Specific Users      (targetUserIds=[…]) — picker covers every role
 *                              so admins can target an individual professor,
 *                              TA, SA, or student.
 *       4. All Users           (targetRoles=['student','professor','ta','sa','admin'])
 *   - Optional banner image (multipart upload, ≤5 MB)
 *   - Urgency: Normal / Important / Critical (mapped server-side to the priority enum)
 *
 * The composer is fully self-contained: it fetches its own picker options,
 * handles its own state, posts the announcement, and notifies the parent via
 * `onPublished` so the parent can re-fetch the list.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { useAcademicSettings } from '../utils/academicSettings';
import { playSendSuccessSound } from '../context/NotificationContext';
import { MarkdownToolbar, handleMarkdownEnter } from './MarkdownToolbar';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';
const inputStyle =
  'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

export type UrgencyLevel = 'normal' | 'important' | 'critical';
export type AnnouncementCategory =
  | 'general'
  | 'events'
  | 'academic'
  | 'financial'
  | 'health'
  | 'student_affairs';

type RecipientMode = 'all-students' | 'specific-levels' | 'specific-users' | 'all-users';
type SendMode = 'announcement' | 'notification';

// Picker row covers every role — students still have level/program, but
// staff entries (professor / ta / sa / admin) just need name + email + role.
interface PickerUser {
  id: string;
  name: string;
  email: string;
  role: string;
  profilePicture: string | null;
  level: number | null;
  program: string | null;
}

// Role filter for the picker. Helps admins narrow when looking for a
// specific professor or TA without scrolling through 200 students.
type PickerRoleFilter = 'all' | 'student' | 'professor' | 'ta' | 'sa' | 'admin';

const PICKER_ROLE_FILTERS: { value: PickerRoleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'student', label: 'Students' },
  { value: 'professor', label: 'Professors' },
  { value: 'ta', label: 'TAs' },
  { value: 'sa', label: 'SA' },
  { value: 'admin', label: 'Admins' },
];

const ROLE_BADGE_BG: Record<string, string> = {
  student: 'bg-blue-500/15 text-blue-500 dark:text-blue-300 border-blue-500/30',
  professor: 'bg-[#6A3FF4]/15 text-[#6A3FF4] dark:text-[#bda8ff] border-[#6A3FF4]/30',
  ta: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
  sa: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  admin: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
};

const CATEGORY_OPTIONS: { value: AnnouncementCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'events', label: 'Events' },
  { value: 'academic', label: 'Academic' },
  { value: 'financial', label: 'Financial' },
  { value: 'health', label: 'Health' },
  { value: 'student_affairs', label: 'Student Affairs' },
];

const RECIPIENT_OPTIONS: { value: RecipientMode; label: string }[] = [
  { value: 'all-students', label: 'All Students' },
  { value: 'specific-levels', label: 'Specific Levels' },
  { value: 'specific-users', label: 'Specific Users' },
  { value: 'all-users', label: 'All Users' },
];

interface Props {
  /** Called after a successful publish so the parent can refetch the list. */
  onPublished?: () => void;
  /**
   * Restrict the recipient mode picker to a subset. Used by the student
   * surface (Plan 5 follow-up): students with a per-user write-override
   * on Announcements get the composer, but limited to specific-students
   * and specific-levels (no all-students / all-users blast).
   */
  allowedRecipientModes?: RecipientMode[];
  /**
   * Plan 7 Phase 5 — override the POST endpoint. Defaults to the SA
   * announcements URL. The student peer-composer page passes the
   * `/api/student/announcements` URL so the constrained backend
   * validates cohort membership and the per-day rate limit.
   */
  submitEndpoint?: string;
  /**
   * Plan 7 Phase 5 — restrict the level chips to the supplied set
   * (typically the caller's level and below). When omitted the
   * composer falls back to `SystemSettings.numberOfAcademicLevels`.
   */
  availableLevels?: number[];
  /**
   * Plan 7 Phase 5 — pre-loaded picker rows. When provided, skips the
   * `/api/sa/recipient-options` fetch and uses this list verbatim.
   * The student composer passes its cohort peers here.
   */
  pickerOptions?: PickerUser[];
  /**
   * Plan 7 Phase 5 — submission shape. Defaults to the legacy SA
   * announcements payload (audience + targetRoles + image + urgency).
   * `student` builds the simpler `{title, content, mode, targetUserIds,
   * targetLevels, bannerImage}` shape the `/api/student/announcements`
   * endpoint expects.
   */
  payloadVariant?: 'sa' | 'student';
}

export const AnnouncementComposer: React.FC<Props> = ({
  onPublished,
  allowedRecipientModes,
  submitEndpoint,
  availableLevels: availableLevelsProp,
  pickerOptions,
  payloadVariant = 'sa',
}) => {
  const recipientOptions = allowedRecipientModes && allowedRecipientModes.length > 0
    ? RECIPIENT_OPTIONS.filter((o) => allowedRecipientModes.includes(o.value))
    : RECIPIENT_OPTIONS;
  const initialRecipientMode: RecipientMode = recipientOptions[0]?.value ?? 'all-students';

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [category, setCategory] = useState<AnnouncementCategory>('general');
  const [urgency, setUrgency] = useState<UrgencyLevel>('normal');
  const [recipientMode, setRecipientMode] = useState<RecipientMode>(initialRecipientMode);
  // Type of message: 'announcement' creates a public feed entry + a per-user
  // notification; 'notification' is a transient blast — no feed entry, just
  // the notification.
  const [sendMode, setSendMode] = useState<SendMode>('announcement');

  const [selectedLevels, setSelectedLevels] = useState<number[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [pickerRoleFilter, setPickerRoleFilter] = useState<PickerRoleFilter>('all');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [pickerUsers, setPickerUsers] = useState<PickerUser[]>([]);
  const [availableLevels, setAvailableLevels] = useState<number[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // When the parent supplied a pre-loaded picker list (student peer flow),
  // seed it once on mount and skip the SA-wide fetch entirely.
  useEffect(() => {
    if (pickerOptions && pickerOptions.length > 0 && pickerUsers.length === 0) {
      setPickerUsers(pickerOptions);
    }
    if (availableLevelsProp && availableLevelsProp.length > 0 && availableLevels.length === 0) {
      setAvailableLevels(availableLevelsProp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOptions, availableLevelsProp]);

  // Lazy-load the picker the first time the user picks a mode that needs it.
  const needsPicker = recipientMode === 'specific-users' || recipientMode === 'specific-levels';
  useEffect(() => {
    if (!needsPicker || pickerUsers.length > 0) return;
    // Caller pre-loaded the picker (student peer flow) — skip remote fetch.
    if (pickerOptions && pickerOptions.length > 0) return;
    let cancelled = false;
    setPickerLoading(true);
    fetch(`${API_URLS.studentAffairs()}/api/sa/recipient-options`, {
      credentials: 'include',
      headers: authHeaders() as Record<string, string>,
    })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json())))
      .then((data) => {
        if (cancelled) return;
        // Backend returns the list as both `users` (new generalised name)
        // and `students` (legacy alias). Prefer `users` so the picker
        // can include staff rows; fall back gracefully to `students`.
        const list = Array.isArray(data?.users)
          ? data.users
          : Array.isArray(data?.students)
          ? data.students
          : [];
        setPickerUsers(list);
        setAvailableLevels(Array.isArray(data?.levels) ? data.levels : []);
      })
      .catch((e) => !cancelled && setError(e?.error || 'Could not load users.'))
      .finally(() => !cancelled && setPickerLoading(false));
    return () => {
      cancelled = true;
    };
  }, [needsPicker, pickerUsers.length, pickerOptions]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    let list = pickerUsers;
    if (pickerRoleFilter !== 'all') {
      list = list.filter((u) => u.role === pickerRoleFilter);
    }
    if (!q) return list;
    return list.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.program && u.program.toLowerCase().includes(q))
    );
  }, [pickerUsers, userSearch, pickerRoleFilter]);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('Please pick an image file (JPG / PNG / WEBP / GIF).');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError(`Image too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
      return;
    }
    setImageFile(f);
    const reader = new FileReader();
    reader.onload = (ev) =>
      setImagePreview(typeof ev.target?.result === 'string' ? ev.target.result : null);
    reader.readAsDataURL(f);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const reset = useCallback(() => {
    setTitle('');
    setBody('');
    setCategory('general');
    setUrgency('normal');
    setRecipientMode('all-students');
    setSendMode('announcement');
    setSelectedLevels([]);
    setSelectedUserIds([]);
    setUserSearch('');
    setPickerRoleFilter('all');
    clearImage();
  }, []);

  // Build the body that goes to the backend based on the recipient mode.
  const buildPayload = () => {
    const PRIORITY_MAP: Record<UrgencyLevel, string> = {
      normal: 'normal',
      important: 'high',
      critical: 'high',
    };
    const base: Record<string, unknown> = {
      title: title.trim(),
      content: body.trim(),
      category,
      urgency,
      priority: PRIORITY_MAP[urgency],
      mode: sendMode,
    };
    if (recipientMode === 'all-students') {
      base.audience = 'all-students';
      base.targetRoles = ['student'];
    } else if (recipientMode === 'all-users') {
      base.audience = 'all';
      base.targetRoles = ['student', 'professor', 'ta', 'sa', 'admin'];
    } else if (recipientMode === 'specific-levels') {
      base.audience = 'specific-levels';
      base.targetRoles = ['student'];
      base.targetLevels = selectedLevels;
    } else if (recipientMode === 'specific-users') {
      // 'specific-students' kept as the audience tag for backward
      // compatibility with the existing announcement filter logic; the
      // user list itself can now contain users of any role.
      base.audience = 'specific-students';
      base.targetUserIds = selectedUserIds;
    }
    return base;
  };

  const validate = (): string | null => {
    if (!title.trim()) return 'Title is required.';
    if (!body.trim()) return 'Body is required.';
    if (recipientMode === 'specific-levels' && selectedLevels.length === 0) {
      return 'Pick at least one level.';
    }
    if (recipientMode === 'specific-users' && selectedUserIds.length === 0) {
      return 'Pick at least one user.';
    }
    return null;
  };

  const handlePublish = async (isDraft = false) => {
    setError('');
    setSuccess('');
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    try {
      const targetUrl = submitEndpoint || `${API_URLS.studentAffairs()}/api/sa/announcements`;

      // Student variant — POST the simpler `{title, content, mode,
      // targetUserIds, targetLevels, bannerImage}` body the constrained
      // /api/student/announcements endpoint expects. No multipart, no
      // urgency, no category, no draft toggle.
      if (payloadVariant === 'student') {
        const studentMode: 'specific-students' | 'specific-levels' =
          recipientMode === 'specific-users' ? 'specific-students' : 'specific-levels';
        const studentPayload: Record<string, unknown> = {
          title: title.trim(),
          content: body.trim(),
          mode: studentMode,
        };
        if (studentMode === 'specific-students') studentPayload.targetUserIds = selectedUserIds;
        if (studentMode === 'specific-levels')   studentPayload.targetLevels = selectedLevels;
        const res = await fetch(targetUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeaders() as Record<string, string>),
          },
          body: JSON.stringify(studentPayload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((data as { error?: string; message?: string }).message
            || (data as { error?: string }).error
            || 'Could not publish announcement.');
          return;
        }
        setSuccess('Announcement sent.');
        playSendSuccessSound();
        reset();
        onPublished?.();
        setTimeout(() => setSuccess(''), 4000);
        return;
      }

      const payload = buildPayload();
      payload.isDraft = isDraft;

      let res: Response;
      if (imageFile) {
        const fd = new FormData();
        for (const [k, val] of Object.entries(payload)) {
          if (Array.isArray(val)) fd.append(k, JSON.stringify(val));
          else if (val != null) fd.append(k, String(val));
        }
        fd.append('image', imageFile);
        res = await fetch(targetUrl, {
          method: 'POST',
          credentials: 'include',
          headers: authHeaders() as Record<string, string>,
          body: fd,
        });
      } else {
        res = await fetch(targetUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeaders() as Record<string, string>),
          },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Could not publish announcement.');
        return;
      }
      setSuccess(isDraft ? 'Draft saved!' : 'Announcement published.');
      // Audible cue so the sender knows the broadcast went out — they don't
      // hear the recipient's own notification (filtered by their senderId)
      // and the green banner alone was easy to miss.
      if (!isDraft) playSendSuccessSound();
      reset();
      onPublished?.();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish announcement.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLevel = (n: number) => {
    setSelectedLevels((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort()));
  };
  const toggleUser = (id: string) => {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Levels offered: when a constrained `availableLevels` prop is passed
  // (student composer — caller's level and below), use it exclusively so
  // the picker can't accidentally widen. Otherwise union (a) distinct
  // levels in the picker with (b) the institution-configured 1..N range
  // from `SystemSettings.numberOfAcademicLevels`.
  const academic = useAcademicSettings();
  const levelChips = useMemo(() => {
    if (availableLevelsProp && availableLevelsProp.length > 0) {
      return [...new Set(availableLevelsProp)].sort((a, b) => a - b);
    }
    const configured = Array.from(
      { length: Math.max(1, academic.numberOfAcademicLevels) },
      (_, i) => i + 1,
    );
    return [...new Set([...availableLevels, ...configured])].sort((a, b) => a - b);
  }, [availableLevels, availableLevelsProp, academic.numberOfAcademicLevels]);

  return (
    <div className={`${glassCardStyle} p-6 space-y-5`}>
      {/* Header — title + send-as toggle.
          Stack vertically on mobile so the two Announcement / Notification
          pills don't crowd the title or overflow the card on narrow phones.
          Row layout returns at sm+. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <h2 className="text-black dark:text-white text-xl font-bold flex items-center">
          <i className={`ph-bold ${sendMode === 'announcement' ? 'ph-megaphone' : 'ph-bell'} mr-2 text-[#6A3FF4]`}></i>{' '}
          {sendMode === 'announcement' ? 'Compose New Announcement' : 'Compose New Notification'}
        </h2>
        {/* Send-as toggle — picks whether the message creates a public
            announcement feed entry or is a transient notification only.
            On mobile the pill bar becomes full-width with each button
            taking `flex-1` so they split the row evenly. */}
        <div className="flex items-center gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg w-full sm:w-auto sm:shrink-0">
          <button
            type="button"
            onClick={() => setSendMode('announcement')}
            title="Creates a public feed entry + sends a notification to recipients"
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
              sendMode === 'announcement'
                ? 'bg-[#6A3FF4] text-white'
                : 'text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white'
            }`}
          >
            <i className="ph-bold ph-megaphone"></i> Announcement
          </button>
          <button
            type="button"
            onClick={() => setSendMode('notification')}
            title="Sends a transient notification only — no public feed entry"
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
              sendMode === 'notification'
                ? 'bg-[#6A3FF4] text-white'
                : 'text-gray-500 dark:text-gray-300 hover:text-black dark:hover:text-white'
            }`}
          >
            <i className="ph-bold ph-bell"></i> Notification
          </button>
        </div>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i> {success}
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-x-circle"></i> {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title…"
          className={inputStyle}
        />
      </div>

      <div>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Message Body</label>
        <MarkdownToolbar textareaRef={bodyRef} value={body} onChange={setBody} />
        <textarea
          ref={bodyRef}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => handleMarkdownEnter(e, body, setBody)}
          placeholder="Write your announcement… (use **bold**, *italic*, `code`, # heading, - bullet, 1. numbered, > quote)"
          className={`${inputStyle} resize-none`}
        />
      </div>

      {/* Category — only shown in announcement mode (notifications are transient
          and don't have a category column). */}
      {sendMode === 'announcement' && (
        <div>
          <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Category</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  category === c.value
                    ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                    : 'bg-white/5 text-gray-500 dark:text-gray-300 border-white/10 hover:border-[#6A3FF4]/40'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recipients */}
      <div>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Recipients</label>
        <div className="flex gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
          {recipientOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setRecipientMode(o.value)}
              className={`flex-1 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-colors ${
                recipientMode === o.value ? 'bg-[#6A3FF4] text-white' : 'text-black dark:text-gray-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Specific Levels picker */}
        {recipientMode === 'specific-levels' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl"
          >
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Choose one or more academic levels.
            </p>
            <div className="flex flex-wrap gap-2">
              {levelChips.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleLevel(n)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    selectedLevels.includes(n)
                      ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                      : 'bg-white/5 text-gray-500 dark:text-gray-300 border-white/10 hover:border-[#6A3FF4]/40'
                  }`}
                >
                  Level {n}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Specific Users picker — covers every role; admins can target a
            single professor / TA / SA / admin / student. The role filter
            row narrows the list when looking for a specific person. */}
        {recipientMode === 'specific-users' && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl space-y-2"
          >
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name, email, role, or program…"
              className={inputStyle}
            />

            {/* Role filter chips — quick narrow without typing the role
                into the search box. */}
            <div className="flex flex-wrap gap-1.5">
              {PICKER_ROLE_FILTERS.map((rf) => (
                <button
                  key={rf.value}
                  type="button"
                  onClick={() => setPickerRoleFilter(rf.value)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    pickerRoleFilter === rf.value
                      ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                      : 'bg-white/5 text-gray-500 dark:text-gray-300 border-white/10 hover:border-[#6A3FF4]/40'
                  }`}
                >
                  {rf.label}
                </button>
              ))}
            </div>

            {pickerLoading ? (
              <p className="text-xs text-gray-500 text-center py-2">
                <i className="ph-bold ph-spinner animate-spin mr-1"></i> Loading users…
              </p>
            ) : (
              <>
                {selectedUserIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedUserIds.map((id) => {
                      const u = pickerUsers.find((x) => x.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 bg-[#6A3FF4]/20 text-[#6A3FF4] dark:text-[#bda8ff] border border-[#6A3FF4]/30 px-2 py-0.5 rounded-full text-xs"
                        >
                          {u?.name || id}
                          {u?.role && (
                            <span className="text-[9px] uppercase font-bold opacity-80">
                              · {u.role}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleUser(id)}
                            className="hover:text-red-500"
                            aria-label="Remove"
                          >
                            <i className="ph-bold ph-x text-xs"></i>
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="max-h-56 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
                  {filteredUsers.slice(0, 150).map((u) => {
                    const checked = selectedUserIds.includes(u.id);
                    const badge = ROLE_BADGE_BG[u.role] || 'bg-white/10 text-gray-400 border-white/10';
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        className={`w-full flex items-center justify-between text-left px-3 py-2 text-sm transition-colors gap-2 ${
                          checked ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {u.profilePicture ? (
                            <img
                              src={u.profilePicture}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#6A3FF4] to-[#9D7BFF] text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                              {u.name
                                ?.split(/\s+/)
                                .slice(0, 2)
                                .map((w) => w[0])
                                .join('')
                                .toUpperCase() || '?'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-black dark:text-white truncate">{u.name}</p>
                              <span
                                className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border ${badge}`}
                              >
                                {u.role}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 truncate">
                              {u.email}
                              {u.level != null ? ` · Level ${u.level}` : ''}
                              {u.program ? ` · ${u.program}` : ''}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`w-4 h-4 rounded-md border flex-shrink-0 ${
                            checked ? 'bg-[#6A3FF4] border-[#6A3FF4]' : 'border-gray-400/40'
                          }`}
                        >
                          {checked && (
                            <i className="ph-bold ph-check text-[10px] text-white block text-center leading-4"></i>
                          )}
                        </span>
                      </button>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-4">
                      No users match your search.
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>

      {/* Banner image — only meaningful for announcement mode. */}
      {sendMode === 'announcement' && (
      <div>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">
          Banner Image{' '}
          <span className="text-gray-400 dark:text-gray-500 font-normal">(optional · max 5 MB)</span>
        </label>
        {imagePreview ? (
          <div className="relative rounded-xl overflow-hidden border border-white/20 dark:border-[#363636]">
            <img src={imagePreview} alt="Banner preview" className="w-full max-h-48 object-cover" />
            <button
              type="button"
              onClick={clearImage}
              className="absolute top-2 right-2 bg-black/60 hover:bg-red-500/80 text-white rounded-full p-1.5 transition-colors"
              aria-label="Remove image"
            >
              <i className="ph-bold ph-x text-sm"></i>
            </button>
          </div>
        ) : (
          <label className="block w-full border-2 border-dashed border-gray-300/50 dark:border-[#363636] rounded-xl p-4 hover:border-[#6A3FF4]/50 transition-colors cursor-pointer text-center">
            <input type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
            <i className="ph-bold ph-image-square text-2xl text-[#6A3FF4] block mb-1"></i>
            <span className="text-sm text-gray-600 dark:text-gray-400">Click to add a banner image</span>
            <span className="block text-[10px] text-gray-500 mt-0.5">JPG / PNG / WEBP / GIF</span>
          </label>
        )}
      </div>
      )}

      {/* Urgency */}
      <div>
        <label className="block text-sm font-bold text-gray-500 dark:text-gray-400 mb-2">Urgency</label>
        <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
          {(['normal', 'important', 'critical'] as UrgencyLevel[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUrgency(u)}
              className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-colors capitalize ${
                urgency === u
                  ? u === 'critical'
                    ? 'bg-red-500 text-white'
                    : u === 'important'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Mirrored feedback banner — the one at the top of the composer is
          easy to miss when the form is long and the user is at the bottom
          near the Publish button. Same state, rendered twice. */}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i> {success}
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-500 rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2">
          <i className="ph-bold ph-x-circle"></i> {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handlePublish(false)}
          disabled={submitting}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className={`ph-bold ${submitting ? 'ph-spinner animate-spin' : 'ph-paper-plane-tilt'}`}></i>
          {submitting
            ? sendMode === 'announcement' ? 'Publishing…' : 'Sending…'
            : sendMode === 'announcement' ? 'Publish' : 'Send Notification'}
        </button>
        {sendMode === 'announcement' && (
          <button
            type="button"
            onClick={() => handlePublish(true)}
            disabled={submitting}
            className={`px-5 py-3 rounded-xl ${glassCardStyle} text-black dark:text-gray-300 font-bold hover:bg-white/20 dark:hover:bg-black/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Save Draft
          </button>
        )}
      </div>
    </div>
  );
};

export default AnnouncementComposer;
