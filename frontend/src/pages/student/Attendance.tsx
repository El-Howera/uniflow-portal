import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimateOnView } from '../../components/AnimateOnView';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getAttendanceHistory,
  getAttendanceSummary,
  AttendanceRecord,
  CourseSummary,
  AttendanceStats
} from '../../utils/attendanceService';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useMatchHeight } from '../../hooks/useMatchHeight';
import { useRegistration } from '../../context/RegistrationContext';
import { useAppContext } from '../../context/AppContext';
import { GlassDropdown } from '../../components/GlassDropdown';
import { GlassCheckbox } from '../../components/GlassCheckbox';
import { useT } from '../../i18n';
import { useAcademicSettings, classifyAttendance } from '../../utils/academicSettings';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

// Stat Card Component
const AttendanceStatCard: React.FC<{
  title: string;
  value: string | number;
  desc: string;
  icon: string;
  color: string;
  isLoading?: boolean;
}> = ({ title, value, desc, icon, color, isLoading }) => (
  <div className={`${glassCardStyle} p-6 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-200`}>
    <div className="flex justify-between items-start mb-4">
      <span className="text-gray-600 dark:text-gray-400 font-medium text-sm">{title}</span>
      {/* Caller passes its own slash-opacity bg and border (e.g.
          bg-[#6A3FF4]/10 border-[#6A3FF4]/20). The legacy bg-opacity-10 +
          border-opacity-20 modifiers used to live here but they silently
          no-op against arbitrary hex values like bg-[#6A3FF4], which
          produced a solid purple background that made the same-hex icon
          invisible on the Attendance Rate card. */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${color}`}>
        <i className={`ph-fill ${icon} text-xl`}></i>
      </div>
    </div>
    <div>
      {isLoading ? (
        <div className="h-10 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2"></div>
      ) : (
        <p className="text-black dark:text-white text-4xl font-bold mb-2">{value}</p>
      )}
      <p className="text-gray-600 dark:text-gray-500 text-xs">{desc}</p>
    </div>
  </div>
);

// Course Summary Card Component
const CourseSummaryCard: React.FC<{ courses: CourseSummary[] }> = ({ courses }) => {
  // Phase 12 — colour the per-course chip + the regulations footer from
  // SystemSettings.attendanceRules so a tenant overriding 75% (FCDS default)
  // to e.g. 80% sees the new threshold reflected immediately.
  const academic = useAcademicSettings();
  const rules = academic.attendanceRules;
  const navigate = useNavigate();
  const t = useT();

  return (
    <div className={`${glassCardStyle} p-6 flex flex-col`}>
      <h2 className="text-xl font-bold text-black dark:text-white flex items-center gap-2 mb-6">
        <i className="ph-bold ph-chart-pie text-[#6A3FF4]"></i> {t('attendancePage.byCourse')}
      </h2>

      <div className="space-y-4 flex-grow">
        {courses.map((course) => {
          // ── Classification uses TOTAL EXPECTED sessions (full semester),
          // not just the sessions held so far. Without this, missing 1 out
          // of 3 sessions = 33% absence and would mark the student "barred"
          // immediately even though the semester has only just started.
          //
          // With totalExpected (= section slots × semester weeks): missing
          // 1 of 30 expected sessions = 3.3% absence → "good". Barring only
          // fires when even attending every REMAINING session can't bring
          // the student under the threshold — i.e. they're mathematically
          // certain to be barred regardless of future attendance.
          //
          // Falls back to the previous behaviour when totalExpected is
          // absent (older deployments / data we couldn't compute against).
          const denom = (course.totalExpected && course.totalExpected > 0)
            ? course.totalExpected
            : course.total;
          const absencePct = denom > 0 ? (course.absent / denom) * 100 : 0;
          const standing = classifyAttendance(absencePct, rules);
          const chipClass = standing === 'barred'
            ? 'bg-red-500/20 text-red-500'
            : standing === 'final_warning'
            ? 'bg-orange-500/20 text-orange-500'
            : standing === 'warned'
            ? 'bg-yellow-500/20 text-yellow-500'
            : 'bg-green-500/20 text-green-500';
          return (
            <div key={course.courseCode} className="bg-white/50 dark:bg-[#0d0d0d] p-4 rounded-xl border border-gray-300/50 dark:border-[#363636]">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-black dark:text-white text-sm">{course.courseCode}</h3>
                  <p className="text-gray-500 text-xs">{course.courseName}</p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-bold ${chipClass}`}>
                  {course.attendanceRate}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-gray-200 dark:bg-[#262626] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] transition-all duration-500"
                  style={{ width: `${course.attendanceRate}%` }}
                ></div>
              </div>

              <div className="flex justify-between mt-2 text-xs text-gray-500">
                {/* Attended count includes excused — an SA-approved absence
                    excuse is semantically "attended" toward the percentage. */}
                <span>{t('attendancePage.attendedRatio', { a: course.present + course.late + course.excused, t: course.total })}</span>
                <span>{t('attendancePage.absencesCount', { n: course.absent })}</span>
              </div>
              {standing !== 'good' && (
                <p className={`text-[11px] font-bold mt-2 ${
                  standing === 'barred' ? 'text-red-400'
                  : standing === 'final_warning' ? 'text-orange-400'
                  : 'text-yellow-400'
                }`}>
                  {standing === 'barred'
                    ? `Barred — ${rules.barredGradeLetter} grade applies (≥${rules.failAbsencePercent}% absent).`
                    : standing === 'final_warning'
                    ? `Final warning — one more absence and you risk barring at ${rules.failAbsencePercent}%.`
                    : `Warning — your absence has reached the institutional threshold (${rules.warnAbsencePercents[0]}%).`}
                </p>
              )}
            </div>
          );
        })}

        {courses.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <i className="ph-bold ph-book-open text-3xl mb-2 opacity-50"></i>
            <p className="text-sm">{t('attendancePage.noCourseData')}</p>
          </div>
        )}
      </div>
      {/* Institutional regulations footer (Phase 12) — sourced from
          SystemSettings.attendanceRules so a tenant overriding FCDS Article 16
          sees their own values reflected here. */}
      <div className="mt-4 p-3 rounded-xl bg-[#6A3FF4]/10 border border-[#6A3FF4]/20 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
        <p className="font-bold text-[#7B5AFF] mb-1">{t('attendancePage.attendanceRegs')}</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Minimum {rules.minAttendancePercent}% attendance required{rules.practicalOnly ? ' (practical sessions only)' : ''}.</li>
          {rules.warnAbsencePercents.length > 0 && (
            <li>
              Warnings issued at {rules.warnAbsencePercents.join('% and ')}% absence.
            </li>
          )}
          <li>
            At {rules.failAbsencePercent}% absence you are barred from the course and receive a <span className="font-bold text-red-400">{rules.barredGradeLetter}</span> grade.
          </li>
          {/* Plan 6 Phase 2 — holidays excluded from the working-day denominator
              so a missed class on a national/religious holiday doesn't count
              against attendance percent. */}
          <li>Configured institutional holidays are excluded from the working-day count.</li>
        </ul>
      </div>

      <button
        onClick={() => navigate('/student/mark-attendance')}
        className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold py-3 rounded-lg mt-6 hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2"
      >
        <i className="ph-bold ph-qr-code"></i>
        {t('attendancePage.markAttendance')}
      </button>
    </div>
  );
};

// ── File helpers (shared by the AbsenceRequestCard + the Appeal modal) ──
// Hoisted to module scope so both surfaces render the same icon/size strings
// without duplicating the small functions inside each component.
const getFileIconClass = (type: string): string => {
  if (type.startsWith('image/')) return 'ph-image';
  if (type === 'application/pdf') return 'ph-file-pdf';
  if (type.includes('word')) return 'ph-file-doc';
  return 'ph-file';
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Absence Request Card Component
//
// `courses` here is the list of *enrolled* courses pulled from RegistrationContext
// — not from attendance summary — so newly-registered courses with no attendance
// record yet are still selectable. Each entry is just `{ courseCode, courseName }`.
const AbsenceRequestCard: React.FC<{
  courses: { courseCode: string; courseName: string }[];
  /** When set, the card is in APPEAL mode: course selection is locked
   *  to this record's course, and submit sends attendanceRecordId instead
   *  of a courseCodes[] array. Cleared by `onClearPrefill` to switch
   *  back to the generic multi-course early-request mode. */
  prefillRecord?: AttendanceRecord | null;
  onClearPrefill?: () => void;
}> = ({ courses, prefillRecord, onClearPrefill }) => {
  const t = useT();
  const [message, setMessage] = useState('');
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAppealMode = !!prefillRecord && !!prefillRecord.id;

  // When a record arrives from the history table (Appeal click), reset the
  // course checkboxes so the lock state is unambiguous, and pulse the card
  // briefly. The textarea is left untouched in case the student is already
  // typing.
  useEffect(() => {
    if (isAppealMode) setSelectedCourses([]);
  }, [isAppealMode, prefillRecord]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setSubmitResult({ success: false, message: 'File size must be less than 5 MB.' });
        setTimeout(() => setSubmitResult(null), 3000);
        return;
      }
      setAttachment(file);
    }
  };

  const handleCourseToggle = (courseCode: string) => {
    setSelectedCourses(prev =>
      prev.includes(courseCode)
        ? prev.filter(c => c !== courseCode)
        : [...prev, courseCode]
    );
  };

  const handleSubmit = async () => {
    const reasonTrim = message.trim();
    if (!reasonTrim) {
      setSubmitResult({ success: false, message: 'Please provide a reason for the absence' });
      setTimeout(() => setSubmitResult(null), 3000);
      return;
    }
    if (!isAppealMode && selectedCourses.length === 0) {
      setSubmitResult({ success: false, message: 'Please select at least one course' });
      setTimeout(() => setSubmitResult(null), 3000);
      return;
    }

    setIsSubmitting(true);
    try {
      // Always use multipart so the same endpoint handles requests with and without
      // an attached evidence file. The backend reads `evidence` (file) and the
      // text fields uniformly. In appeal mode we send attendanceRecordId; in
      // generic mode we send courseCodes[] (multi-course early request).
      const fd = new FormData();
      fd.append('reason', reasonTrim);
      if (isAppealMode && prefillRecord?.id) {
        fd.append('attendanceRecordId', prefillRecord.id);
      } else {
        fd.append('courseCodes', JSON.stringify(selectedCourses));
      }
      if (attachment) fd.append('evidence', attachment);

      const res = await fetch(`${API_URLS.attendance()}/api/attendance/excuse`, {
        method: 'POST',
        credentials: 'include',
        // No Content-Type header — let the browser set the multipart boundary.
        headers: { ...authHeaders() },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Submission failed');
      }
      const successMsg = isAppealMode
        ? 'Appeal submitted. Student Affairs will review your request.'
        : (data as { message?: string }).message
          || `Absence request submitted for ${selectedCourses.length} course(s). Student Affairs will review your request.`;
      setSubmitResult({ success: true, message: successMsg });
      setMessage('');
      setSelectedCourses([]);
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Drop appeal lock on success so the card returns to its idle generic
      // state for the next request.
      if (isAppealMode) onClearPrefill?.();
      setTimeout(() => setSubmitResult(null), 5000);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to submit request';
      setSubmitResult({ success: false, message: errMsg });
      setTimeout(() => setSubmitResult(null), 4500);
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getStatusChipStyle = (status?: string) => {
    switch (status) {
      case 'absent':  return 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30';
      case 'late':    return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30';
      case 'excused': return 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30';
      default:        return 'bg-gray-500/20 text-gray-500 border border-gray-500/30';
    }
  };

  return (
    <div className={`${glassCardStyle} p-6 flex flex-col ${isAppealMode ? 'ring-2 ring-[#6A3FF4]/40' : ''}`}>
      <h2 className="text-xl font-bold text-black dark:text-white flex items-center gap-2 mb-2">
        <i className={`ph-bold ${isAppealMode ? 'ph-scales text-[#6A3FF4]' : 'ph-warning-circle text-yellow-500'}`}></i>
        {isAppealMode ? 'Appeal an Absence' : t('attendancePage.requestAbsence')}
      </h2>
      <p className="text-gray-500 text-sm mb-6">
        {isAppealMode
          ? 'You\'re disputing a specific recorded absence. Student Affairs will review and either restore your attendance or decline with a note.'
          : t('attendancePage.reasonPlaceholder')}
      </p>

      {/* Result Message */}
      <AnimatePresence>
        {submitResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-xl mb-4 flex items-start gap-3 ${submitResult.success
                ? 'bg-green-500/20 border border-green-500/30'
                : 'bg-red-500/20 border border-red-500/30'
              }`}
          >
            <i className={`text-xl mt-0.5 ${submitResult.success ? 'ph-bold ph-check-circle text-green-500' : 'ph-bold ph-x-circle text-red-500'
              }`}></i>
            <p className={`text-sm ${submitResult.success ? 'text-green-500' : 'text-red-500'}`}>
              {submitResult.message}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mode-aware selection block:
           - Appeal mode: a locked banner naming the specific record
             (course + date + marked status) with a "Switch to early
             request" escape hatch. No checkbox list.
           - Generic mode: the GlassCheckbox course list (early absence
             request that covers an upcoming session). */}
      {isAppealMode && prefillRecord ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Appealing this absence
            </label>
            <button
              onClick={onClearPrefill}
              className="text-[11px] font-semibold text-[#6A3FF4] dark:text-[#bda8ff] hover:underline"
            >
              <i className="ph-bold ph-arrow-counter-clockwise mr-1" />
              Switch to early request
            </button>
          </div>
          <div className="bg-[#6A3FF4]/10 dark:bg-[#6A3FF4]/15 border border-[#6A3FF4]/40 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-black dark:text-white text-sm truncate">
                  {prefillRecord.courseCode}
                  {prefillRecord.courseName && (
                    <span className="font-normal text-gray-600 dark:text-gray-400 ml-2 text-xs">
                      {prefillRecord.courseName}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>
                    <i className="ph-bold ph-calendar-blank mr-1" />
                    {new Date(prefillRecord.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {prefillRecord.markedAt && (
                    <span>
                      <i className="ph-bold ph-clock mr-1" />
                      {new Date(prefillRecord.markedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </p>
              </div>
              <span className={`px-2 py-1 rounded-full text-[10px] font-bold capitalize flex-shrink-0 ${getStatusChipStyle(prefillRecord.status)}`}>
                {prefillRecord.status}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('attendancePage.selectCourses')} <span className="text-red-500">*</span>
          </label>
          <p className="text-[11px] text-gray-500 mb-2">
            Selecting a day from your history flips this into an appeal. Leaving it empty
            files an early absence request for whichever course(s) you tick.
          </p>
          <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
            {courses.map(course => {
              const checked = selectedCourses.includes(course.courseCode);
              return (
                <div
                  key={course.courseCode}
                  onClick={() => handleCourseToggle(course.courseCode)}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${checked
                      ? 'bg-[#6A3FF4]/20 border border-[#6A3FF4]/50'
                      : 'bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] hover:border-[#6A3FF4]/30'
                    }`}
                >
                  <GlassCheckbox
                    checked={checked}
                    onChange={() => handleCourseToggle(course.courseCode)}
                    size="sm"
                    ariaLabel={`Select ${course.courseCode}`}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-black dark:text-white text-sm">{course.courseCode}</span>
                    <span className="text-gray-500 text-xs ml-2">- {course.courseName}</span>
                  </div>
                </div>
              );
            })}
            {courses.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">{t('coursesPage.noCourses')}</p>
            )}
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('attendancePage.reasonLabel')} <span className="text-red-500">*</span>
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('attendancePage.reasonPlaceholder')}
          className="w-full bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] rounded-xl px-4 py-3 text-sm text-black dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] resize-none"
          rows={3}
          maxLength={500}
        />
        <p className="text-right text-xs text-gray-400 mt-1">{message.length}/500</p>
      </div>

      {/* File Attachment */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('attendancePage.attachment')}
        </label>

        {attachment ? (
          <div className="bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] rounded-xl p-3 flex items-center gap-3">
            <div className="w-10 h-10 bg-[#6A3FF4]/20 rounded-lg flex items-center justify-center">
              <i className={`ph-bold ${getFileIconClass(attachment.type)} text-[#6A3FF4] text-xl`}></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-black dark:text-white text-sm truncate">{attachment.name}</p>
              <p className="text-gray-500 text-xs">{formatFileSize(attachment.size)}</p>
            </div>
            <button
              onClick={removeAttachment}
              className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
            >
              <i className="ph-bold ph-x text-red-500"></i>
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-gray-300/50 dark:border-[#363636] rounded-xl p-4 hover:border-[#6A3FF4]/50 transition-colors group"
          >
            <div className="flex flex-col items-center gap-2 text-gray-500 group-hover:text-[#6A3FF4] transition-colors">
              <i className="ph-bold ph-upload-simple text-2xl"></i>
              <span className="text-sm">{t('attendancePage.clickToUploadFile')}</span>
              <span className="text-xs">PDF, Image, or Document (Max 5MB)</span>
            </div>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileChange}
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          className="hidden"
        />
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || (!isAppealMode && selectedCourses.length === 0) || !message.trim()}
        className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white font-bold py-3 rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <>
            <i className="ph-bold ph-spinner animate-spin"></i>
            {t('attendancePage.submitting')}
          </>
        ) : (
          <>
            <i className={`ph-bold ${isAppealMode ? 'ph-scales' : 'ph-paper-plane-tilt'}`}></i>
            {isAppealMode ? 'Submit appeal' : t('attendancePage.submitExcuse')}
          </>
        )}
      </button>

      <p className="text-center text-xs text-gray-500 mt-3">
        <i className="ph-bold ph-info mr-1"></i>
        Requests are reviewed by Student Affairs within 24-48 hours
      </p>
    </div>
  );
};

// Attendance History Table Component
const AttendanceHistoryTable: React.FC<{
  records: AttendanceRecord[];
  isLoading: boolean;
  selectedCourse: string;
  onCourseChange: (course: string) => void;
  courses: CourseSummary[];
  matchHeight?: number | null;
  /** Fired when the user clicks Appeal on an absent row. Parent scrolls
   *  the AbsenceRequestCard into view and pre-fills it with this record. */
  onAppealClick?: (record: AttendanceRecord) => void;
  /** Highlight the row whose appeal is currently being composed below. */
  activeAppealRecordId?: string | null;
}> = ({ records, isLoading, selectedCourse, onCourseChange, courses, matchHeight, onAppealClick, activeAppealRecordId }) => {
  const t = useT();

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'present': return 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30';
      case 'absent': return 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30';
      case 'late': return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30';
      case 'excused': return 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30';
      default: return 'bg-gray-500/20 text-gray-600 dark:text-gray-400';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // On lg+ screens, cap this card to the height of "Attendance by Course" (passed via matchHeight)
  // by setting a CSS variable that the lg:max-h-[var(...)] utility consumes.
  const cardStyle = matchHeight
    ? ({ ['--match-h' as string]: `${matchHeight}px` } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`${glassCardStyle} p-6 flex flex-col lg:max-h-[var(--match-h,none)] lg:h-[var(--match-h,auto)]`}
      style={cardStyle}
    >
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-black dark:text-white flex items-center">
          <i className="ph-bold ph-clock-counter-clockwise mr-2 text-[#6A3FF4]"></i> {t('attendancePage.history')}
        </h3>

        <GlassDropdown
          value={selectedCourse}
          onChange={onCourseChange}
          options={[
            { value: '', label: t('attendancePage.allCourses'), icon: 'ph-stack' },
            ...courses.map((course) => ({
              value: course.courseCode,
              label: course.courseCode,
              icon: 'ph-book',
            })),
          ]}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"></div>
          ))}
        </div>
      ) : records.length > 0 ? (
        <div className="overflow-x-auto flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-300/50 dark:border-[#363636] text-xs font-bold text-gray-600 dark:text-gray-500 uppercase tracking-wider">
                <th className="py-3 pr-4 pl-2">{t('attendancePage.course')}</th>
                <th className="py-3 pr-4">{t('attendancePage.date')}</th>
                <th className="py-3 pr-4">{t('attendancePage.timeMarked')}</th>
                <th className="py-3 pr-4">{t('attendancePage.status')}</th>
                <th className="py-3 pr-4 text-right">{t('attendancePage.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-300/50 dark:divide-[#363636]">
              {records.slice(0, 15).map((record, index) => (
                <tr key={index} className="group hover:bg-white/30 dark:hover:bg-[#262626]/50 transition-colors">
                  <td className="py-4 pr-4 pl-2">
                    <div className="font-medium text-black dark:text-white">{record.courseCode}</div>
                    <div className="text-gray-500 text-xs">{record.courseName}</div>
                  </td>
                  <td className="py-4 pr-4 text-gray-600 dark:text-gray-400 text-sm">
                    <div className="flex items-center gap-2">
                      <i className="ph-bold ph-calendar-blank text-[#6A3FF4]"></i>
                      {formatDate(record.date)}
                    </div>
                  </td>
                  <td className="py-4 pr-4 text-gray-600 dark:text-gray-400 text-sm">
                    {record.markedAt ? new Date(record.markedAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit'
                    }) : '-'}
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getStatusStyle(record.status)}`}>
                      {record.status}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-right">
                    {/* Appeal button only on absent rows. Excused/late/present
                        rows are either not in dispute, already resolved, or
                        positive — nothing to appeal. Click jumps the page to
                        the AbsenceRequestCard below pre-filled with THIS
                        record (parent-driven scroll). */}
                    {record.status === 'absent' && record.id ? (
                      <button
                        onClick={() => onAppealClick?.(record)}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                          activeAppealRecordId === record.id
                            ? 'bg-[#6A3FF4] text-white border-[#6A3FF4]'
                            : 'bg-[#6A3FF4]/10 text-[#6A3FF4] dark:text-[#bda8ff] border-[#6A3FF4]/30 hover:bg-[#6A3FF4]/20'
                        }`}
                      >
                        <i className="ph-bold ph-scales mr-1" />
                        {activeAppealRecordId === record.id ? 'Appealing' : 'Appeal'}
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {records.length > 15 && (
            <div className="text-center mt-4">
              <button className="text-[#6A3FF4] text-sm font-medium hover:underline">
                View all {records.length} records
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <i className="ph-bold ph-clipboard-text text-5xl mb-4 block opacity-50"></i>
          <p className="font-medium">{t('attendancePage.noRecords')}</p>
          <p className="text-sm mt-2">{t('attendancePage.noRecords')}</p>
        </div>
      )}

    </div>
  );
};

// Main Attendance Component
const Attendance: React.FC = () => {
  const { searchTerm } = useAppContext();
  const t = useT();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // Track Attendance-by-Course's natural height so the History card can match it.
  const [courseSummaryRef, courseSummaryHeight] = useMatchHeight<HTMLDivElement>();

  // Inline-appeal coordination. The history table fires `onAppealClick` with
  // the absent record; we scroll the AbsenceRequestCard into view and pass the
  // record down so the card pre-fills with the course + date + an
  // attendanceRecordId on submit. Clearing flips the card back to its
  // generic multi-course request mode.
  const [appealRecord, setAppealRecord] = useState<AttendanceRecord | null>(null);
  const absenceCardRef = useRef<HTMLDivElement>(null);
  const handleAppealClick = useCallback((record: AttendanceRecord) => {
    setAppealRecord(record);
    // Defer one tick so the card has the new prefill state before we scroll
    // — keeps the visual "select then jump" sequence smooth.
    setTimeout(() => {
      absenceCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);
  const clearAppealPrefill = useCallback(() => setAppealRecord(null), []);

  // Pull the student's enrolled courses (active registrations) from the
  // registration context so the absence-excuse form covers courses that have
  // no attendance records yet — not just ones present in the attendance summary.
  const { registeredCourses } = useRegistration();
  const enrolledCoursesForExcuse = React.useMemo(() => {
    const seen = new Set<string>();
    const list: { courseCode: string; courseName: string }[] = [];
    for (const r of registeredCourses) {
      if (seen.has(r.courseCode)) continue;
      seen.add(r.courseCode);
      list.push({ courseCode: r.courseCode, courseName: r.courseName });
    }
    return list;
  }, [registeredCourses]);

  const userId = localStorage.getItem('currentUserEmail') || '';

  const fetchData = useCallback(async () => {
    setIsLoading(true);

    const [historyData, summaryData] = await Promise.all([
      getAttendanceHistory(userId, selectedCourse || undefined),
      getAttendanceSummary(userId)
    ]);

    if (historyData) {
      setRecords(historyData.records);
      setStats(historyData.stats);
    }

    if (summaryData) {
      setCourses(summaryData);
    }

    setIsLoading(false);
  }, [userId, selectedCourse]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Apply the global navbar search to the history table — matches against
  // course code, course name, and status (e.g. "present", "late").
  const filteredRecords = React.useMemo(() => {
    if (!searchTerm) return records;
    const needle = searchTerm.toLowerCase();
    return records.filter(
      (r) =>
        r.courseCode?.toLowerCase().includes(needle) ||
        r.courseName?.toLowerCase().includes(needle) ||
        r.status?.toLowerCase().includes(needle)
    );
  }, [records, searchTerm]);

  return (
    <div className="pb-16 space-y-8">
      <AnimateOnView>
        <div>
          <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('attendancePage.title')}</h2>
          <p className="text-gray-600 dark:text-gray-400">{t('attendancePage.subtitle')}</p>
        </div>
      </AnimateOnView>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <AnimateOnView delay={0.1}>
          <AttendanceStatCard
            title={t('attendancePage.rate')}
            value={`${stats?.attendanceRate || 0}%`}
            desc={t('attendancePage.rateDesc')}
            icon="ph-chart-line-up"
            color="text-[#6A3FF4] bg-[#6A3FF4]/10 border-[#6A3FF4]/20"
            isLoading={isLoading}
          />
        </AnimateOnView>

        <AnimateOnView delay={0.15}>
          <AttendanceStatCard
            title={t('attendancePage.classesAttended')}
            value={stats?.present || 0}
            desc={t('attendancePage.classesAttendedDesc')}
            icon="ph-check-circle"
            color="text-green-500 dark:text-green-400 bg-green-500/10 border-green-500/20"
            isLoading={isLoading}
          />
        </AnimateOnView>

        <AnimateOnView delay={0.2}>
          <AttendanceStatCard
            title={t('attendancePage.statusLate')}
            value={stats?.late || 0}
            desc={t('attendancePage.lateDesc')}
            icon="ph-clock"
            color="text-yellow-500 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/20"
            isLoading={isLoading}
          />
        </AnimateOnView>

        <AnimateOnView delay={0.25}>
          <AttendanceStatCard
            title={t('attendancePage.absences')}
            value={stats?.absent || 0}
            desc={t('attendancePage.absencesDesc')}
            icon="ph-x-circle"
            color="text-red-500 dark:text-red-400 bg-red-500/10 border-red-500/20"
            isLoading={isLoading}
          />
        </AnimateOnView>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:items-start">
        <AnimateOnView delay={0.3} className="lg:col-span-2">
          <AttendanceHistoryTable
            records={filteredRecords}
            isLoading={isLoading}
            selectedCourse={selectedCourse}
            onCourseChange={setSelectedCourse}
            courses={courses}
            matchHeight={courseSummaryHeight}
            onAppealClick={handleAppealClick}
            activeAppealRecordId={appealRecord?.id ?? null}
          />
        </AnimateOnView>

        <div ref={courseSummaryRef}>
          <AnimateOnView delay={0.35}>
            <CourseSummaryCard courses={courses} />
          </AnimateOnView>
        </div>
      </div>

      {/* Absence Request — full-width row.
          Source list = enrolled (active registrations), not attendance-summary courses,
          so a freshly-registered course can still be excused. The card flips
          into "appeal" mode when the history table fires onAppealClick — we
          pass the prefill record + a clear handler down so the same card
          handles both flows without a separate modal. */}
      <div ref={absenceCardRef} className="scroll-mt-32">
        <AnimateOnView delay={0.4}>
          <AbsenceRequestCard
            courses={enrolledCoursesForExcuse}
            prefillRecord={appealRecord}
            onClearPrefill={clearAppealPrefill}
          />
        </AnimateOnView>
      </div>
    </div>
  );
};

export default Attendance;
