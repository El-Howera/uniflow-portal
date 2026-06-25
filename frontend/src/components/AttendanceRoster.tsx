/**
 * AttendanceRoster — staff-facing manual-mark grid for an active attendance
 * session. Shared by ProfAttendance and TAAttendance so both surfaces have
 * the exact same controls (the roster, the buttons, the polling cadence).
 *
 * Backed by:
 *   - GET  /api/attendance/sessions/:sessionId/roster
 *   - POST /api/attendance/sessions/:sessionId/mark-student
 *
 * The roster auto-refreshes every 5 s while a session is active so QR
 * scans (the student-facing path) flow into the grid without a manual
 * reload. Optimistic updates on the manual buttons keep clicks snappy
 * even on slow networks.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

interface RosterRow {
  id: string;
  name: string;
  email: string;
  odId: string | null;
  profilePicture: string | null;
  status: AttendanceStatus | null;
  verificationMethod: string | null;
  markedAt: string | null;
}

interface Props {
  /** Active session id — null when no session is running. The card
   *  still renders (with an empty state) so the staff knows it's there. */
  sessionId: string | null;
  /** Used as the empty-state hint when sessionId is null. */
  courseCode?: string;
}

const STATUS_STYLES: Record<AttendanceStatus, { label: string; bg: string; text: string; icon: string }> = {
  present: { label: 'Present', bg: 'bg-green-500', text: 'text-white', icon: 'ph-check-circle' },
  late:    { label: 'Late',    bg: 'bg-amber-500', text: 'text-white', icon: 'ph-clock' },
  absent:  { label: 'Absent',  bg: 'bg-red-500',   text: 'text-white', icon: 'ph-x-circle' },
  excused: { label: 'Excused', bg: 'bg-blue-500',  text: 'text-white', icon: 'ph-note' },
};

const STATUS_PILL: Record<AttendanceStatus | 'unmarked', string> = {
  present: 'bg-green-500/15 text-green-500 border-green-500/30',
  late:    'bg-amber-500/15 text-amber-500 border-amber-500/30',
  absent:  'bg-red-500/15 text-red-500 border-red-500/30',
  excused: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  unmarked: 'bg-white/5 text-gray-400 border-white/10',
};

export const AttendanceRoster: React.FC<Props> = ({ sessionId, courseCode }) => {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AttendanceStatus | 'all' | 'unmarked'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRoster = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `${API_URLS.attendance()}/api/attendance/sessions/${sessionId}/roster`,
        { credentials: 'include', headers: authHeaders() as Record<string, string> },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setRoster(Array.isArray(data?.roster) ? data.roster : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    }
  }, [sessionId]);

  // Initial load + 5 s polling so QR scans show up live.
  useEffect(() => {
    if (!sessionId) {
      setRoster([]);
      return;
    }
    setLoading(true);
    fetchRoster().finally(() => setLoading(false));
    const t = setInterval(fetchRoster, 5000);
    return () => clearInterval(t);
  }, [sessionId, fetchRoster]);

  const handleMark = useCallback(
    async (userId: string, status: AttendanceStatus) => {
      if (!sessionId) return;
      // Optimistic update — the click feels instant. If the POST fails,
      // a refetch puts the row back to its real value.
      setRoster((prev) =>
        prev.map((r) =>
          r.id === userId
            ? { ...r, status, verificationMethod: 'manual', markedAt: new Date().toISOString() }
            : r,
        ),
      );
      setBusyId(userId);
      try {
        const res = await fetch(
          `${API_URLS.attendance()}/api/attendance/sessions/${sessionId}/mark-student`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(authHeaders() as Record<string, string>) },
            body: JSON.stringify({ userId, status }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError((body as { error?: string }).error || `Mark failed (HTTP ${res.status})`);
          await fetchRoster();
        } else {
          setError(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error');
        await fetchRoster();
      } finally {
        setBusyId(null);
      }
    },
    [sessionId, fetchRoster],
  );

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
    for (const r of roster) {
      if (r.status) c[r.status]++;
      else c.unmarked++;
    }
    return c;
  }, [roster]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roster.filter((r) => {
      if (filter === 'all') {
        // pass
      } else if (filter === 'unmarked') {
        if (r.status != null) return false;
      } else if (r.status !== filter) {
        return false;
      }
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.odId ?? '').toLowerCase().includes(q)
      );
    });
  }, [roster, filter, search]);

  // Empty state — no active session yet. Keeps the slot visible so the
  // staff sees "this is where the roster will appear".
  if (!sessionId) {
    return (
      <div className={`${glassCardStyle} p-6`}>
        <h3 className="text-black dark:text-white text-lg font-bold mb-1 flex items-center gap-2">
          <i className="ph-bold ph-users text-[#6A3FF4]"></i>
          Class Roster
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Start a session to load the student roster. You&apos;ll then be able to
          mark anyone present / late / absent / excused without QR.
          {courseCode ? ` (${courseCode})` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className={`${glassCardStyle} p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-black dark:text-white text-lg font-bold flex items-center gap-2">
            <i className="ph-bold ph-users text-[#6A3FF4]"></i>
            Class Roster
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
              ({roster.length} enrolled)
            </span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL.present}`}>
              {counts.present} Present
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL.late}`}>
              {counts.late} Late
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL.absent}`}>
              {counts.absent} Absent
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL.excused}`}>
              {counts.excused} Excused
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_PILL.unmarked}`}>
              {counts.unmarked} Unmarked
            </span>
          </div>
        </div>
      </div>

      {/* Filter row — search + status pill bar matching the design system. */}
      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-9 pr-3 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
          />
        </div>
        <div className="flex items-center gap-1 bg-white/30 dark:bg-black/20 backdrop-blur-lg p-1 rounded-lg border border-white/20 dark:border-white/10 shadow-lg">
          {(['all', 'present', 'late', 'absent', 'excused', 'unmarked'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold capitalize transition-colors ${
                filter === f
                  ? 'bg-[#6A3FF4] text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-center gap-2">
          <i className="ph-bold ph-warning-circle"></i>
          {error}
        </div>
      )}

      {/* Roster list — manual mark buttons per row. */}
      <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-white/10 dark:border-white/5 divide-y divide-white/5">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 w-full bg-white/5 animate-pulse"></div>
          ))
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 italic">
            {roster.length === 0 ? 'No students enrolled in this course.' : 'No students match the current filter.'}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((s) => {
              const initials = s.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase();
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
                >
                  {s.profilePicture ? (
                    <img
                      src={s.profilePicture}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#6A3FF4] to-[#9D7BFF] text-white font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initials || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-black dark:text-white truncate">{s.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          STATUS_PILL[s.status ?? 'unmarked']
                        }`}
                      >
                        {s.status ?? 'unmarked'}
                      </span>
                      {s.verificationMethod && (
                        <span className="text-[10px] text-gray-500 capitalize">
                          {s.verificationMethod === 'qr_code' ? 'QR' : s.verificationMethod}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {(Object.keys(STATUS_STYLES) as AttendanceStatus[]).map((k) => {
                      const cfg = STATUS_STYLES[k];
                      const isActive = s.status === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          disabled={busyId === s.id}
                          onClick={() => handleMark(s.id, k)}
                          title={cfg.label}
                          aria-label={`Mark ${s.name} ${cfg.label}`}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-50 ${
                            isActive
                              ? `${cfg.bg} ${cfg.text} shadow-sm`
                              : 'bg-white/5 dark:bg-black/10 border border-white/10 text-gray-500 hover:text-black dark:hover:text-white hover:border-[#6A3FF4]/40'
                          }`}
                        >
                          <i className={`ph-bold ${cfg.icon} text-sm`}></i>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

export default AttendanceRoster;
