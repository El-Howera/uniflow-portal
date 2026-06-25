/**
 * MiniNotificationComposer — shared by Professor and TA dashboards. Sits
 * where "Quick Actions" used to be on the Professor surface, and replaces
 * the Pending-Proposals / Today's-Sessions stack on the TA surface.
 *
 * Lets the staff member fire a quick notification to either:
 *   - every student in one of their courses (target = whole course)
 *   - one or more specific students they teach/assist (target = specific)
 *
 * Backed by:
 *   - GET /api/{role}/all-students/:email   (course list + roster, deduped
 *                                             across courses for the picker)
 *   - POST /api/notifications/broadcast     (fan-out endpoint shared with
 *                                             admin/SA composers)
 *
 * Glass-morphism throughout; no native `<select>` — `GlassDropdown` for the
 * course picker, pill-bar for the target-mode toggle.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import { GlassDropdown } from './GlassDropdown';
import { playSendSuccessSound } from '../context/NotificationContext';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

const inputStyle =
  'w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 text-black dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#6A3FF4] transition-colors placeholder:text-gray-500 dark:placeholder:text-gray-400';

interface CourseOpt {
  code: string;
  title: string;
}

interface StudentOpt {
  id: string;
  name: string;
  email: string;
  profilePicture: string | null;
  courseCodes: string[];
}

type TargetMode = 'course' | 'specific';

interface Props {
  /** Role of the sender — picks which roster endpoint to call. */
  role: 'professor' | 'ta';
}

const MiniNotificationComposer: React.FC<Props> = ({ role }) => {
  const [courses, setCourses] = useState<CourseOpt[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [targetMode, setTargetMode] = useState<TargetMode>('course');
  const [selectedCourseCode, setSelectedCourseCode] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // Fetch courses + roster once on mount. Endpoint differs only by role
  // segment — both return the identical { courses, students } shape.
  //
  // Identity preference order:
  //   1. `currentUserId` (CUID — unambiguous, case-insensitive collisions
  //      impossible). Earlier the bug was that we sent EMAIL and the DB
  //      lookup was case-sensitive on first-deploy seeds.
  //   2. `me` sentinel — the backend resolves it to the JWT identity. Safe
  //      fallback when neither id nor email is in localStorage.
  //   3. `currentUserEmail` — last resort if the other two are missing.
  // Plus we surface the actual server error so this stops being an
  // opaque "could not load" for the user.
  useEffect(() => {
    let cancelled = false;
    const userId = localStorage.getItem('currentUserId') || '';
    const email = localStorage.getItem('currentUserEmail') || '';
    const identity = userId || 'me' || email;
    setPickerLoading(true);
    setLoadError('');
    fetch(`${API_URLS.courseContent()}/api/${role}/all-students/${encodeURIComponent(identity)}`, {
      credentials: 'include',
      headers: authHeaders() as Record<string, string>,
    })
      .then(async (r) => {
        if (r.ok) return r.json();
        const body = await r.json().catch(() => ({}));
        // eslint-disable-next-line no-console
        console.warn('[MiniNotificationComposer] roster load failed', r.status, body);
        return Promise.reject({ status: r.status, ...body });
      })
      .then((data) => {
        if (cancelled) return;
        const cs = Array.isArray(data?.courses) ? (data.courses as CourseOpt[]) : [];
        const ss = Array.isArray(data?.students) ? (data.students as StudentOpt[]) : [];
        setCourses(cs);
        setStudents(ss);
        if (cs.length > 0) setSelectedCourseCode(cs[0].code);
      })
      .catch((e) => {
        if (cancelled) return;
        // Surface the real backend error message + status so the failure
        // is debuggable from the visible UI instead of a generic "Could
        // not load roster." Helps spot 404 (user not resolved) vs 500
        // (server crashed) at a glance.
        const detail = e?.error || e?.message;
        const status = e?.status ? ` (HTTP ${e.status})` : '';
        setLoadError(detail ? `${detail}${status}` : `Could not load roster.${status}`);
      })
      .finally(() => !cancelled && setPickerLoading(false));
    return () => {
      cancelled = true;
    };
  }, [role]);

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.courseCodes.some((c) => c.toLowerCase().includes(q))
    );
  }, [students, studentSearch]);

  const toggleStudent = (id: string) =>
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const courseDropdownOptions = useMemo(
    () =>
      courses.map((c) => ({
        value: c.code,
        label: `${c.code} — ${c.title}`,
      })),
    [courses]
  );

  const targetModeOptions = useMemo(
    () => [
      { value: 'course', label: 'Whole Course', icon: 'ph-users-three' },
      { value: 'specific', label: 'Specific Students', icon: 'ph-user-circle' },
    ],
    []
  );

  const validate = (): string | null => {
    if (!title.trim()) return 'Title is required.';
    if (!message.trim()) return 'Message is required.';
    if (targetMode === 'course' && !selectedCourseCode) {
      return 'Pick a target course.';
    }
    if (targetMode === 'specific' && selectedStudentIds.length === 0) {
      return 'Pick at least one student.';
    }
    return null;
  };

  const handleSend = async () => {
    setError('');
    setSuccess('');
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSending(true);
    try {
      // Broadcast endpoint expects `content` (not `body`) — the legacy
      // ProfBroadcast page had a typo; this composer uses the correct field.
      const payload: Record<string, unknown> = {
        title: title.trim(),
        content: message.trim(),
        type: 'message',
      };
      if (targetMode === 'course') {
        payload.courseCode = selectedCourseCode;
        payload.targetRole = 'student';
      } else {
        payload.userIds = selectedStudentIds;
      }

      const res = await fetch(`${API_URLS.notification()}/api/notifications/broadcast`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeaders() as Record<string, string>),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || 'Could not send notification.');
        return;
      }

      const recipientWord =
        targetMode === 'course'
          ? `students in ${selectedCourseCode}`
          : `${selectedStudentIds.length} student${selectedStudentIds.length === 1 ? '' : 's'}`;
      setSuccess(`Sent to ${recipientWord}.`);
      playSendSuccessSound();
      setTitle('');
      setMessage('');
      setSelectedStudentIds([]);
      setStudentSearch('');
      setTimeout(() => setSuccess(''), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send notification.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`${glassCardStyle} p-5 h-full flex flex-col gap-4`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
          <i className="ph-bold ph-paper-plane-tilt text-[#6A3FF4]"></i>
          Notify Students
        </h3>
        {/* Glass pill-bar for the target-mode toggle (design-system shortcut
            for short, mutually-exclusive sets — no native <select>). */}
        <div className="flex items-center gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
          {targetModeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTargetMode(opt.value as TargetMode)}
              title={opt.label}
              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors flex items-center gap-1 ${
                targetMode === opt.value
                  ? 'bg-[#6A3FF4] text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'
              }`}
            >
              <i className={`ph-bold ${opt.icon}`}></i>
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-lg px-3 py-2 text-xs">
          <i className="ph-bold ph-warning mr-1"></i>
          {loadError}
        </div>
      )}

      {/* Course picker — visible in 'course' mode. */}
      {targetMode === 'course' && (
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
            Target Course
          </label>
          {pickerLoading ? (
            <div className="h-10 w-full bg-white/5 animate-pulse rounded-xl border border-white/10"></div>
          ) : courses.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              {role === 'professor'
                ? "You don't teach any courses this term."
                : "You're not assigned to any course this term."}
            </p>
          ) : (
            <GlassDropdown
              value={selectedCourseCode}
              onChange={setSelectedCourseCode}
              options={courseDropdownOptions}
              direction="auto"
              className="w-full"
            />
          )}
        </div>
      )}

      {/* Specific-students picker — visible in 'specific' mode. */}
      {targetMode === 'specific' && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 dark:bg-black/20 border border-white/10 dark:border-white/5 rounded-xl p-3 space-y-2 backdrop-filter backdrop-blur-xl"
        >
          <div className="relative">
            <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs"></i>
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search by name, email, or course…"
              className={`${inputStyle} pl-8`}
            />
          </div>

          {pickerLoading ? (
            <p className="text-xs text-gray-500 text-center py-2">
              <i className="ph-bold ph-spinner animate-spin mr-1"></i>
              Loading students…
            </p>
          ) : students.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-3 italic">
              {role === 'professor'
                ? 'No students enrolled in your courses yet.'
                : 'No students enrolled in your sections yet.'}
            </p>
          ) : (
            <>
              {selectedStudentIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                  {selectedStudentIds.map((id) => {
                    const s = students.find((x) => x.id === id);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 bg-[#6A3FF4]/20 text-[#6A3FF4] dark:text-[#bda8ff] border border-[#6A3FF4]/30 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      >
                        {s?.name || id}
                        <button
                          type="button"
                          onClick={() => toggleStudent(id)}
                          className="hover:text-red-500"
                          aria-label="Remove"
                        >
                          <i className="ph-bold ph-x text-[9px]"></i>
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 dark:border-white/5 divide-y divide-white/5">
                {filteredStudents.slice(0, 80).map((s) => {
                  const checked = selectedStudentIds.includes(s.id);
                  const initials = s.name
                    ?.split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase();
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStudent(s.id)}
                      className={`w-full flex items-center justify-between text-left px-2.5 py-2 text-xs transition-colors gap-2 ${
                        checked ? 'bg-[#6A3FF4]/10' : 'hover:bg-white/5 dark:hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {s.profilePicture ? (
                          <img
                            src={s.profilePicture}
                            alt=""
                            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#6A3FF4] to-[#9D7BFF] text-white font-bold text-[9px] flex items-center justify-center flex-shrink-0">
                            {initials || '?'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-black dark:text-white truncate">
                            {s.name}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            {s.courseCodes.length > 0
                              ? s.courseCodes.join(' · ')
                              : s.email}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`w-4 h-4 rounded-md border flex-shrink-0 ${
                          checked
                            ? 'bg-[#6A3FF4] border-[#6A3FF4]'
                            : 'border-gray-400/40'
                        }`}
                      >
                        {checked && (
                          <i className="ph-bold ph-check text-[9px] text-white block text-center leading-4"></i>
                        )}
                      </span>
                    </button>
                  );
                })}
                {filteredStudents.length === 0 && (
                  <p className="text-[11px] text-gray-500 text-center py-3 italic">
                    No students match your search.
                  </p>
                )}
              </div>
            </>
          )}
        </motion.div>
      )}

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Reminder: Quiz tomorrow"
          className={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
          Message
        </label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you want to tell them?"
          className={`${inputStyle} resize-none`}
        />
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
          <i className="ph-bold ph-check-circle"></i>
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
          <i className="ph-bold ph-warning-circle"></i>
          {error}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || pickerLoading}
        className="mt-auto w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold py-2.5 rounded-xl text-xs hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <i className={`ph-bold ${sending ? 'ph-spinner animate-spin' : 'ph-paper-plane-tilt'}`}></i>
        {sending
          ? 'Sending…'
          : targetMode === 'course'
          ? 'Send to Course'
          : `Send to ${selectedStudentIds.length || 0} Selected`}
      </button>
    </div>
  );
};

export default MiniNotificationComposer;
