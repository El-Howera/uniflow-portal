import { useEffect, useRef, useState, useCallback } from "react";
import { useAppContext } from "../../context/AppContext";
import { useRegistration } from "../../context/RegistrationContext";
import { AnimateOnView } from "../../components/AnimateOnView";
import {
  fetchCourseAssignments,
  fetchUserSubmissions,
  submitAssignment,
  Submission,
} from "../../utils/courseContentService";
import { useT } from "../../i18n";
import { API_URLS } from "@shared/config";

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

type AssignmentStatus = 'Due Soon' | 'Missing' | 'Submitted' | 'Graded';

interface DetailedAssignment {
  // Stable React-key id. Was a local counter that incremented per fetch —
  // every reload of loadAssignments minted fresh IDs, which made
  // <AnimateOnView key={assignment.id}> unmount + remount every card and
  // wiped any in-flight file-picker state (the "I picked a file but it
  // vanishes" bug). Switched to the backend's assignment id (CUID, a
  // string) so the keys stay stable across re-fetches.
  id: string;
  title: string;
  course: string;
  dueDate: string;
  description: string;
  status: AssignmentStatus;
  scoreChange?: number;
  courseCode?: string;
  assignmentId?: string;
  // When the assignment has been submitted to the backend, we hold the real
  // submission row so the card can display the file name, score, and feedback.
  submission?: Submission;
  maxScore?: number;
  // Spec files attached at create time (e.g. the PDF the staff dropped via
  // the Materials uploader). Students click these to download the brief.
  attachments?: string[];
}

export const AssignmentsPageContent: React.FC = () => {

// Helper: Status Badge
const AssignmentStatusBadge: React.FC<{
  status: AssignmentStatus;
  scoreChange?: number;
  score?: number | null;
  maxScore?: number;
}> = ({ status, scoreChange, score, maxScore }) => {
  switch (status) {
    case 'Due Soon':
      return <div className="px-3 py-1 bg-[#6A3FF4]/20 text-[#6A3FF4] dark:text-[#bda8ff] border border-[#6A3FF4]/30 text-xs font-semibold rounded-full">{t('dashboard.badgeDueSoon')}</div>;
    case 'Missing':
      return (
        <div className="flex items-center space-x-2">
          <div className="px-3 py-1 bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 text-xs font-semibold rounded-full">{t('dashboard.badgeMissing')}</div>
          {scoreChange && <div className="text-red-500 font-bold text-sm">{scoreChange}</div>}
        </div>
      );
    case 'Submitted':
      return <div className="px-3 py-1 bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30 text-xs font-semibold rounded-full">{t('dashboard.badgeSubmitted')}</div>;
    case 'Graded':
      return (
        <div className="px-3 py-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-xs font-semibold rounded-full">
          Graded {score != null ? `— ${score}${maxScore ? `/${maxScore}` : ''}` : ''}
        </div>
      );
    default:
      return null;
  }
};

// Sub-Component: Assignment Card
//
// Real backend flow (no localStorage). Selecting a file → calling the multipart
// POST /api/submissions endpoint creates/upserts an AssignmentSubmission row.
// Status flips based on the row that comes back: 'submitted' → "Submitted",
// 'graded' → "Graded — score/maxScore". Re-uploading replaces the file (the
// backend upserts on the (assignmentId, userId) unique index).
const DetailedAssignmentCard: React.FC<{
  assignment: DetailedAssignment;
  onSubmitted?: () => void;
}> = ({ assignment, onSubmitted }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [comment, setComment] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isSubmitted = assignment.status === 'Submitted' || assignment.status === 'Graded';
  const submission = assignment.submission;

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSubmitError(null);
    if (!file) return;
    // Backend accepts up to 25 MB by default (multer limit); we cap at 25 MB on the client too.
    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      setSubmitError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`);
      return;
    }
    // Owner directive: submit immediately on file pick instead of the
    // legacy two-step "stage then click Submit". The stage-then-submit
    // flow lost the staged file whenever the parent re-rendered (window
    // focus event → RegistrationContext refresh → assignments reload →
    // card re-mount), so the user could never get from "I picked a file"
    // to "I clicked Submit". Direct submit on pick sidesteps the whole
    // race.
    setPendingFile(file);
    if (!assignment.assignmentId) {
      setSubmitError('Assignment ID missing. Please reload the page.');
      return;
    }
    const userId = localStorage.getItem('currentUserId') || '';
    if (!userId) {
      setSubmitError('Could not determine your user ID. Please re-login.');
      return;
    }
    setIsUploading(true);
    try {
      const res = await submitAssignment(
        userId,
        assignment.courseCode || '',
        assignment.assignmentId,
        file,
      );
      if (!res.success) {
        setSubmitError(res.message || 'Submission failed.');
        return;
      }
      setPendingFile(null);
      setComment('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSubmitted?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setIsUploading(false);
    }
    return;
  };

  const handleSubmit = async () => {
    if (!pendingFile || !assignment.assignmentId) return;
    const userId = localStorage.getItem('currentUserId') || '';
    if (!userId) {
      setSubmitError('Could not determine your user ID. Please re-login.');
      return;
    }
    setIsUploading(true);
    setSubmitError(null);
    try {
      const res = await submitAssignment(
        userId,
        assignment.courseCode || '',
        assignment.assignmentId,
        pendingFile
      );
      if (!res.success) {
        setSubmitError(res.message || 'Submission failed.');
        return;
      }
      setPendingFile(null);
      setComment('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSubmitted?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClearPending = () => {
    setPendingFile(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatBytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className={`${glassCardStyle} p-6 flex flex-col hover:-translate-y-1 transition-transform duration-200`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="text-black dark:text-white font-bold text-lg">{assignment.title}</h3>
        <AssignmentStatusBadge
          status={assignment.status}
          scoreChange={assignment.scoreChange}
          score={submission?.score ?? null}
          maxScore={submission?.maxScore ?? assignment.maxScore}
        />
      </div>

      <div className="flex items-center text-[#6A3FF4] text-sm mb-1 font-medium">
        <i className="ph-bold ph-book-open mr-2"></i>
        <span>{assignment.course}</span>
      </div>

      <div className="flex items-center text-gray-600 dark:text-gray-400 text-sm mb-4">
        <i className="ph-bold ph-calendar-blank mr-2"></i>
        <span>Due: {assignment.dueDate}</span>
      </div>

      <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 flex-grow leading-relaxed">{assignment.description}</p>

      {/* Spec attachments — the staff-uploaded PDF/files the student needs
          to read before working. Each renders as a glass pill that links
          to the file on the course-content static handler. */}
      {assignment.attachments && assignment.attachments.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
            Assignment Spec
          </p>
          <div className="flex flex-wrap gap-2">
            {assignment.attachments.map((url, idx) => {
              const fileName = url.split('/').pop() || `attachment-${idx + 1}`;
              const isPdf = fileName.toLowerCase().endsWith('.pdf');
              return (
                <a
                  key={url}
                  href={`${API_URLS.courseContent()}${url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/30 dark:bg-black/20 backdrop-blur-lg border border-white/20 dark:border-white/10 text-black dark:text-white hover:border-[#6A3FF4]/60 hover:bg-[#6A3FF4]/10 transition-colors"
                >
                  <i className={`ph-fill ${isPdf ? 'ph-file-pdf text-red-500' : 'ph-file text-[#6A3FF4]'}`}></i>
                  <span className="truncate max-w-[12rem]">{fileName}</span>
                  <i className="ph-bold ph-download-simple text-[10px]"></i>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* Submitted view: show the existing submission + feedback if any */}
      {isSubmitted && submission && (
        <div className="bg-white/50 dark:bg-[#0d0d0d] border border-green-500/30 rounded-lg p-3 mb-4 text-sm">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold mb-1">
            <i className="ph-bold ph-check-circle"></i>
            Submitted{submission.isLate ? ' (late)' : ''}
            {submission.attemptNumber && submission.attemptNumber > 1 ? ` · attempt #${submission.attemptNumber}` : ''}
          </div>
          {submission.originalFileName && (
            <div className="text-gray-600 dark:text-gray-400 truncate">
              <i className="ph-bold ph-file mr-1"></i> {submission.originalFileName}
            </div>
          )}
          {submission.submittedAt && (
            <div className="text-xs text-gray-500 mt-1">
              {new Date(submission.submittedAt).toLocaleString()}
            </div>
          )}
          {assignment.status === 'Graded' && submission.feedback && (
            <div className="mt-2 pt-2 border-t border-gray-300/40 dark:border-[#363636] text-gray-700 dark:text-gray-300 text-xs">
              <span className="font-semibold">{t('assignmentsPage.feedback')} </span>{submission.feedback}
            </div>
          )}
        </div>
      )}

      {/* Pending file (selected but not yet submitted) */}
      {!isSubmitted && pendingFile && (
        <div className="bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] rounded-lg p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-grow min-w-0">
            <i className="ph-bold ph-file text-[#6A3FF4] text-2xl"></i>
            <div className="min-w-0">
              <p className="text-black dark:text-white font-semibold text-sm truncate">{pendingFile.name}</p>
              <p className="text-gray-600 dark:text-gray-400 text-xs">{formatBytes(pendingFile.size)}</p>
            </div>
          </div>
          <button
            onClick={handleClearPending}
            className="text-gray-600 dark:text-gray-400 hover:text-red-500 transition-colors p-2"
            title={t('common.delete')}
            disabled={isUploading}
          >
            <i className="ph-bold ph-trash text-lg"></i>
          </button>
        </div>
      )}

      {/* Comment box */}
      {!isSubmitted && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add submission comments (optional)"
          className="bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] rounded-lg w-full p-3 text-sm text-black dark:text-gray-300 placeholder-gray-600 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#6A3FF4] mb-3 h-20 resize-none"
          disabled={isUploading}
        />
      )}

      {submitError && (
        <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3">
          <i className="ph-bold ph-x-circle mr-1"></i> {submitError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col space-y-3 mt-auto">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFilePick}
          className="hidden"
          accept="*/*"
        />
        {isSubmitted ? (
          // Re-submit (replaces the existing row via the backend's upsert path)
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || assignment.status === 'Graded'}
            title={assignment.status === 'Graded' ? 'Already graded — submission locked' : 'Replace your submission'}
            className="w-full bg-white/50 dark:bg-[#2d2d2d] text-black dark:text-gray-200 py-3 rounded-lg font-semibold flex items-center justify-center hover:bg-gray-300/50 dark:hover:bg-[#3d3d3d] transition-colors border border-gray-300/50 dark:border-[#363636] disabled:opacity-50"
          >
            <i className="ph-bold ph-upload-simple mr-2 text-lg"></i>
            {assignment.status === 'Graded' ? 'Graded — locked' : 'Re-upload'}
          </button>
        ) : pendingFile ? (
          <button
            onClick={handleSubmit}
            disabled={isUploading}
            className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white py-3 rounded-lg font-semibold flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-50"
          >
            <i className={`ph-bold ${isUploading ? 'ph-spinner animate-spin' : 'ph-paper-plane-tilt'} mr-2 text-lg`}></i>
            {isUploading ? 'Submitting…' : 'Submit'}
          </button>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white py-3 rounded-lg font-semibold flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20"
          >
            <i className="ph-bold ph-upload-simple mr-2 text-lg"></i>
            Upload File
          </button>
        )}
      </div>
    </div>
  );
};


    const { searchTerm } = useAppContext();
    const { registeredCourses } = useRegistration();
    const t = useT();
    const [upcomingAssignments, setUpcomingAssignments] = useState<DetailedAssignment[]>([]);
    const [submittedAssignments, setSubmittedAssignments] = useState<DetailedAssignment[]>([]);
    const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);
    // True once the first load finishes. Background refetches (window focus,
    // RegistrationContext refresh) must NOT flip the list back to skeletons —
    // that unmounts the SubmissionCard mid-upload and resets the form. The
    // file-picker dialog closing fires a `focus` event → fetchCourses() →
    // registeredCourses changes → loadAssignments re-runs; on production the
    // RDS round-trip is slow enough that the skeleton swap always wins the
    // race and the assignment never submits. Keep cards mounted on refetch.
    const hasLoadedOnceRef = useRef(false);

    // Fetch assignments from all enrolled courses + the user's submissions, then
    // join on assignmentId so each card knows its real backend submission state.
    const loadAssignments = useCallback(async () => {
      if (registeredCourses.length === 0) {
        setIsLoadingAssignments(false);
        setUpcomingAssignments([]);
        setSubmittedAssignments([]);
        return;
      }

      // Only show the skeleton on the very first load. Subsequent refetches
      // run silently in the background so an in-flight upload's card is never
      // torn down underneath it.
      if (!hasLoadedOnceRef.current) setIsLoadingAssignments(true);
      try {
        const userId = localStorage.getItem('currentUserId') || '';
        const allUpcoming: DetailedAssignment[] = [];
        const allSubmitted: DetailedAssignment[] = [];

        const submissions = userId ? await fetchUserSubmissions(userId) : [];
        const submissionsByAssignmentId = new Map<string, Submission>(
          submissions.map((s) => [s.assignmentId, s])
        );

        // The backend returns one Registration row per section, so a course
        // with both lecture and lab appears twice in `registeredCourses`.
        // Dedupe by courseCode before fetching — otherwise every assignment
        // is added to the list twice. (Same root cause as the Courses tab.)
        const uniqueCourses = Array.from(
          new Map(registeredCourses.map((r) => [r.courseCode, r])).values()
        );

        // idCounter retired — see DetailedAssignment.id comment above.
        for (const reg of uniqueCourses) {
          try {
            const assignments = await fetchCourseAssignments(reg.courseCode, userId || undefined);
            for (const a of assignments) {
              const dueDate = new Date(a.dueDate);
              const isPastDue = dueDate < new Date();
              const sub = submissionsByAssignmentId.get(a.id);

              // Map backend assignment.status + submission row → UI status.
              // Trust the backend's computed status when it's 'missing' (it
              // already evaluates dueDate vs. now there). Fall back to local
              // dueDate check for older payloads.
              let status: AssignmentStatus;
              const isGraded = sub?.score != null || sub?.status === 'graded' || a.status === 'graded';
              const isSubmitted = !!sub || a.status === 'submitted' || a.status === 'graded';
              if (isGraded) {
                status = 'Graded';
              } else if (isSubmitted) {
                status = 'Submitted';
              } else if (a.status === 'missing' || isPastDue) {
                status = 'Missing';
              } else {
                status = 'Due Soon';
              }

              const item: DetailedAssignment = {
                id: a.id,
                title: a.title,
                course: reg.courseName,
                dueDate: dueDate.toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                }),
                description: a.description || '',
                status,
                // latePenalty is now stored per-assignment on the backend
                // (default -2). Surface it only for the Missing state.
                scoreChange: status === 'Missing' ? (a.latePenalty ?? -2) : undefined,
                courseCode: reg.courseCode,
                assignmentId: a.id,
                submission: sub,
                maxScore: a.maxScore,
                attachments: Array.isArray(a.attachments) ? a.attachments : [],
              };

              if (status === 'Submitted' || status === 'Graded') {
                allSubmitted.push(item);
              } else {
                allUpcoming.push(item);
              }
            }
          } catch {
            // skip individual course failures silently
          }
        }

        setUpcomingAssignments(allUpcoming);
        setSubmittedAssignments(allSubmitted);
      } catch {
        // leave lists empty on total failure
      } finally {
        setIsLoadingAssignments(false);
        hasLoadedOnceRef.current = true;
      }
    }, [registeredCourses]);

    useEffect(() => {
      loadAssignments();
    }, [loadAssignments]);

    // --- ADDED: Filter Logic ---
    const filterAssignment = (assignment: DetailedAssignment) => 
        assignment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        assignment.course.toLowerCase().includes(searchTerm.toLowerCase());
        
    const filteredUpcoming = upcomingAssignments.filter(filterAssignment);
    const filteredSubmitted = submittedAssignments.filter(filterAssignment);
    // --------------------------------

    if (isLoadingAssignments) {
        return (
            <div className="pb-16 space-y-12">
                <section>
                    <div className="h-7 w-56 animate-pulse bg-gray-200 dark:bg-gray-700 rounded mb-6"></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={`${glassCardStyle} p-6 animate-pulse`}>
                                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
                                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2"></div>
                                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-6"></div>
                                <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
                                <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded"></div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        );
    }

    if (!isLoadingAssignments && upcomingAssignments.length === 0 && submittedAssignments.length === 0 && !searchTerm) {
        return (
            <div className="pb-16">
                <div className={`${glassCardStyle} p-12 text-center`}>
                    <i className="ph-bold ph-file-text text-6xl text-gray-400 dark:text-gray-600 mb-4 block"></i>
                    <h3 className="text-xl font-bold text-gray-600 dark:text-gray-400 mb-2">{t('assignmentsPage.noAssignments')}</h3>
                    <p className="text-gray-500 dark:text-gray-500 text-sm">
                        {registeredCourses.length === 0
                            ? t('assignmentsPage.registerHint')
                            : t('assignmentsPage.noAssignmentsHint')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="pb-16 space-y-12">
            <AnimateOnView>
                <section>
                    <h3 className="text-black dark:text-white text-xl font-bold mb-6 flex items-center">
                        <i className="ph-bold ph-clock-countdown mr-2 text-orange-400"></i> {t('assignmentsPage.dueSoonAndMissing')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredUpcoming.map((assignment, index) => (
                            <AnimateOnView key={assignment.id} delay={index * 0.1}>
                                <DetailedAssignmentCard
                                assignment={assignment}
                                onSubmitted={loadAssignments}
                                />
                            </AnimateOnView>
                        ))}
                        {filteredUpcoming.length === 0 && searchTerm && (
                            <div className="col-span-full text-center py-10 text-gray-500">{t('assignmentsPage.noResults')}</div>
                        )}
                        {filteredUpcoming.length === 0 && !searchTerm && (
                            <div className="col-span-full text-center py-10 text-gray-500">{t('assignmentsPage.noUpcoming')}</div>
                        )}
                    </div>
                </section>
            </AnimateOnView>

            <AnimateOnView delay={0.2}>
                <section>
                    <h3 className="text-black dark:text-white text-xl font-bold mb-6 flex items-center">
                        <i className="ph-bold ph-check-circle mr-2 text-green-400"></i> {t('assignmentsPage.recentlySubmitted')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredSubmitted.map((assignment, index) => (
                            <AnimateOnView key={assignment.id} delay={index * 0.1}>
                                <DetailedAssignmentCard
                                assignment={assignment}
                                onSubmitted={loadAssignments}
                                />
                            </AnimateOnView>
                        ))}
                        {filteredSubmitted.length === 0 && searchTerm && (
                            <div className="col-span-full text-center py-10 text-gray-500">{t('assignmentsPage.noSubmissionsResults')}</div>
                        )}
                        {filteredSubmitted.length === 0 && !searchTerm && (
                            <div className="col-span-full text-center py-10 text-gray-500">{t('assignmentsPage.noSubmissions')}</div>
                        )}
                    </div>
                </section>
            </AnimateOnView>
        </div>
    );
};
