import React, { useState, useEffect, useMemo } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { GlassDropdown } from '../../components/GlassDropdown';
import { useAppContext } from '../../context/AppContext';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchTranscript, TranscriptData, TranscriptSemester, TranscriptCourse } from '../../utils/userProfileService';
import { downloadTranscriptPdf } from '../../utils/pdfGenerator';
import { fetchUserProfile } from '../../utils/userProfileService';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../../utils/api';
import { useT } from '../../i18n';
// Plan 4 Phase 1 — graduation policy eligibility pill.
import {
  useGraduationPolicy,
  evaluateGraduationEligibility,
  GraduationEvaluation,
} from '../../utils/academicSettings';

const glassCardStyle = "bg-white/30 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-lg";

// --- Components ---

// Plan 4 Phase 5 — display pills for academic standing (Article 19) and
// honors eligibility (Article 22). Both come from AcademicProfile and are
// updated by the transcript cascade after every override / withdraw / etc.
const STANDING_STYLES: Record<string, { label: string; cls: string; icon: string }> = {
  good:       { label: 'Good standing',  cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: 'ph-check-circle' },
  warning:    { label: 'Warning',        cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30',       icon: 'ph-warning-circle' },
  probation:  { label: 'On probation',   cls: 'bg-orange-500/10 text-orange-500 border-orange-500/30',    icon: 'ph-flag' },
  dismissed:  { label: 'Dismissed',      cls: 'bg-red-500/10 text-red-500 border-red-500/30',             icon: 'ph-x-circle' },
};
const HONORS_STYLES: Record<string, { label: string; cls: string; icon: string }> = {
  honors:        { label: 'Honors track',     cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',    icon: 'ph-medal' },
  high_honors:   { label: 'High Honors',      cls: 'bg-purple-500/10 text-purple-400 border-purple-500/30', icon: 'ph-trophy' },
  disqualified:  { label: 'Honors disqualified', cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30',  icon: 'ph-prohibit' },
  // 'none' renders no pill — student isn't on track but isn't disqualified either.
};

// Pick the single most-specific current-status pill from the available
// signals. Priority is academic-risk first (dismissed > probation > warning)
// so a probation student doesn't see a misleading "Strong Standing", then
// positive outcomes (ready to graduate > high honors > honors), then GPA
// bands as a fallback for students with no specific flag. The returned
// shape mirrors STANDING_STYLES so the pill renderer stays uniform.
function resolveCurrentStatus(args: {
  gpa: number;
  credits: number;
  standing?: string | null;
  honors?: string | null;
  eligibility: GraduationEvaluation | null;
}): { label: string; cls: string; icon: string } {
  const { gpa, credits, standing, honors, eligibility } = args;
  if (standing === 'dismissed')  return { label: 'Academic Dismissal', cls: 'bg-red-500/10 text-red-500 border-red-500/30',                 icon: 'ph-x-circle' };
  if (standing === 'probation')  return { label: 'On Probation',       cls: 'bg-orange-500/10 text-orange-500 border-orange-500/30',       icon: 'ph-flag' };
  if (standing === 'warning')    return { label: 'Academic Warning',   cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30',          icon: 'ph-warning-circle' };
  if (eligibility?.eligible)     return { label: 'Ready to Graduate',  cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',    icon: 'ph-graduation-cap' };
  if (honors === 'high_honors')  return { label: "Dean's List Track",  cls: 'bg-purple-500/10 text-purple-400 border-purple-500/30',       icon: 'ph-trophy' };
  if (honors === 'honors')       return { label: 'Honors Track',       cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',             icon: 'ph-medal' };
  if (credits === 0)             return { label: 'No Records Yet',     cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30',             icon: 'ph-hourglass' };
  if (gpa >= 3.5)                return { label: 'Excellent Progress', cls: 'bg-[#6A3FF4]/10 text-[#6A3FF4] border-[#6A3FF4]/30',          icon: 'ph-star' };
  if (gpa >= 3.0)                return { label: 'Strong Standing',    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',    icon: 'ph-check-circle' };
  if (gpa >= 2.5)                return { label: 'Good Progress',      cls: 'bg-teal-500/10 text-teal-400 border-teal-500/30',             icon: 'ph-thumbs-up' };
  if (gpa >= 2.0)                return { label: 'Satisfactory',       cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',             icon: 'ph-circle-half' };
  if (gpa > 0)                   return { label: 'Needs Attention',    cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30',          icon: 'ph-warning' };
  return { label: 'In Progress', cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30', icon: 'ph-clock' };
}

// FCDS-style level bands derived from earned credits (matches the default
// SystemSettings.levelProgression seed: L2@28, L3@64, L4@96). Kept inline
// rather than fetching the live policy so the card stays self-contained.
function resolveClassLevel(credits: number): { label: string; cls: string; icon: string } | null {
  if (credits <= 0) return null;
  if (credits < 28)  return { label: 'Freshman',  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30',     icon: 'ph-seedling' };
  if (credits < 64)  return { label: 'Sophomore', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',     icon: 'ph-plant' };
  if (credits < 96)  return { label: 'Junior',    cls: 'bg-teal-500/10 text-teal-400 border-teal-500/30',     icon: 'ph-tree' };
  return                       { label: 'Senior',    cls: 'bg-purple-500/10 text-purple-400 border-purple-500/30', icon: 'ph-graduation-cap' };
}

// Compare the two most-recent graded semesters' GPAs. Returns null when
// fewer than 2 semesters exist OR either GPA is missing so the chip
// doesn't appear with meaningless data.
function resolveGpaTrend(semesters: { gpa: number }[]): { label: string; cls: string; icon: string } | null {
  const graded = semesters.filter((s) => typeof s.gpa === 'number' && s.gpa > 0);
  if (graded.length < 2) return null;
  const last = graded[graded.length - 1].gpa;
  const prev = graded[graded.length - 2].gpa;
  const delta = last - prev;
  if (Math.abs(delta) < 0.05)
    return { label: 'GPA Steady',     cls: 'bg-gray-500/10 text-gray-400 border-gray-500/30',          icon: 'ph-arrow-right' };
  if (delta > 0)
    return { label: 'GPA Improving',  cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30', icon: 'ph-arrow-up-right' };
  return   { label: 'GPA Declining', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30',       icon: 'ph-arrow-down-right' };
}

const TranscriptPerformanceCard: React.FC<{
  gpa: number;
  credits: number;
  eligibility: GraduationEvaluation | null;
  standing?: string | null;
  honors?: string | null;
  semesters?: { gpa: number }[];
}> = ({ gpa, credits, eligibility, standing, honors, semesters }) => {
  const t = useT();
  const safeGpa = typeof gpa === 'number' ? gpa : 0;
  const standingStyle = standing ? STANDING_STYLES[standing] : null;
  const honorsStyle = honors && honors !== 'none' ? HONORS_STYLES[honors] : null;
  const currentStatus = resolveCurrentStatus({ gpa: safeGpa, credits, standing, honors, eligibility });
  const classLevel = resolveClassLevel(credits);
  const gpaTrend = resolveGpaTrend(semesters ?? []);
  return (
    <div className={`${glassCardStyle} p-8 mb-8`}>
      <h2 className="text-xl font-bold text-black dark:text-white">{t('fullTranscriptPage.overallPerformance')}</h2>
      <p className="text-gray-600 dark:text-gray-400 mt-1 mb-8">{t('fullTranscriptPage.snapshotIntro')}</p>

      <div className="flex flex-col md:flex-row items-center justify-between gap-8 md:gap-0">
        <div className="text-center w-full">
          <p className="text-6xl font-bold text-black dark:text-white bg-clip-text dark:text-transparent bg-gradient-to-r from-[#6A3FF4] to-[#A855F7]">
            {safeGpa.toFixed(2)}
          </p>
          <p className="text-gray-600 dark:text-gray-400 uppercase text-xs font-bold tracking-wider mt-2">{t('fullTranscriptPage.overallGpa')}</p>
        </div>
        <div className="hidden md:block h-16 w-px bg-gray-300/50 dark:bg-[#363636]"></div>
        <div className="text-center w-full">
          <p className="text-6xl font-bold text-black dark:text-white">{credits}</p>
          <p className="text-gray-600 dark:text-gray-400 uppercase text-xs font-bold tracking-wider mt-2">{t('fullTranscriptPage.totalCredits')}</p>
        </div>
        <div className="hidden md:block h-16 w-px bg-gray-300/50 dark:bg-[#363636]"></div>
        <div className="text-center w-full">
          <div className={`text-sm font-bold px-6 py-2 rounded-full inline-flex items-center gap-2 border ${currentStatus.cls}`}>
            <i className={`ph-bold ${currentStatus.icon}`}></i>
            {currentStatus.label}
          </div>
          <p className="text-gray-600 dark:text-gray-400 uppercase text-xs font-bold tracking-wider mt-3">{t('fullTranscriptPage.currentStatus')}</p>
          {(classLevel || gpaTrend) && (
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              {classLevel && (
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${classLevel.cls}`}>
                  <i className={`ph-bold ${classLevel.icon}`}></i>
                  {classLevel.label}
                </span>
              )}
              {gpaTrend && (
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${gpaTrend.cls}`}>
                  <i className={`ph-bold ${gpaTrend.icon}`}></i>
                  {gpaTrend.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Plan 4 Phase 5 — standing + honors pills. Sit above the graduation
          eligibility row so the student sees their current academic state
          before the graduation criteria. */}
      {(standingStyle || honorsStyle) && (
        <div className="mt-6 pt-6 border-t border-gray-300/50 dark:border-[#363636] flex flex-wrap items-center gap-3">
          {standingStyle && (
            <span className={`inline-flex items-center gap-2 ${standingStyle.cls} text-sm font-bold px-4 py-1.5 rounded-full border`}>
              <i className={`ph-bold ${standingStyle.icon}`}></i>
              {standingStyle.label}
            </span>
          )}
          {honorsStyle && (
            <span className={`inline-flex items-center gap-2 ${honorsStyle.cls} text-sm font-bold px-4 py-1.5 rounded-full border`}>
              <i className={`ph-bold ${honorsStyle.icon}`}></i>
              {honorsStyle.label}
            </span>
          )}
        </div>
      )}

      {/* Plan 4 Phase 1 — graduation eligibility pill. Reads the live
          SystemSettings.graduationPolicy (FCDS Article 8 by default). */}
      {eligibility && (
        <div className="mt-6 pt-6 border-t border-gray-300/50 dark:border-[#363636]">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {eligibility.eligible ? (
                <span className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 text-sm font-bold px-4 py-1.5 rounded-full">
                  <i className="ph-bold ph-check-circle"></i>
                  {t('fullTranscriptPage.eligibleToGraduate')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-500 border border-amber-500/30 text-sm font-bold px-4 py-1.5 rounded-full">
                  <i className="ph-bold ph-warning-circle"></i>
                  {t('fullTranscriptPage.notYetEligible')}
                </span>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 hidden md:block">
                {t('fullTranscriptPage.eligibilityIntro')}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              {eligibility.criteria.map((c) => (
                <span
                  key={c.key}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border ${
                    c.ok
                      ? 'bg-emerald-500/5 text-emerald-500 border-emerald-500/20'
                      : 'bg-red-500/5 text-red-500 border-red-500/20'
                  }`}
                >
                  <i className={`ph-bold ${c.ok ? 'ph-check' : 'ph-x'}`}></i>
                  <span className="font-medium">{c.label}:</span>
                  <span>
                    {c.key === 'cgpa' ? c.current.toFixed(2) : c.current} / {c.key === 'cgpa' ? c.required.toFixed(2) : c.required}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const TranscriptGradeBadge: React.FC<{ grade: string }> = ({ grade }) => {
  const getStyle = (g: string) => {
    // Live in-progress sentinel — render with the same neutral grey the
    // breakdown rows use for ungraded items so the row reads consistently.
    if (g === 'IP' || g === 'N/A') return 'bg-gray-500/15 text-gray-500 border border-gray-500/30';
    if (g.startsWith('A')) return 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30';
    if (g.startsWith('B')) return 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30';
    if (g.startsWith('C')) return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30';
    return 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30';
  };

  // FCDS "(F)" — incomplete fail (passing total but final exam < 30%).
  // Three-character grade needs a slightly wider cell + smaller text to fit.
  const isIncompleteFail = grade === '(F)';
  const isWide = isIncompleteFail || grade === 'IP' || grade === 'N/A';

  return (
    <div
      title={
        isIncompleteFail
          ? 'Incomplete fail — coursework was passing but the final exam scored under 30% of its maximum.'
          : grade === 'IP'
          // Plan 7 Phase 1 — covers both "still being graded" and "final
          // entered but awaiting professor confirmation". Students don't
          // need to distinguish the two; both mean "wait".
          ? 'In progress — final grade is being graded or awaiting professor confirmation.'
          : undefined
      }
      className={`${isWide ? 'w-12 text-xs' : 'w-9 text-sm'} h-9 rounded-lg flex items-center justify-center font-bold ${getStyle(grade)}`}
    >
      {grade}
    </div>
  );
};

const TranscriptCourseCard: React.FC<{ course: TranscriptCourse }> = ({ course }) => {
  const t = useT();
  const [isExpanded, setIsExpanded] = useState(false);
  const hasBreakdown = course.breakdown && course.breakdown.length > 0;

  return (
    <div className={`${glassCardStyle} overflow-hidden transition-all duration-200`}>
      <div
        className={`flex items-center justify-between p-4 md:p-6 transition-all duration-200 ${hasBreakdown ? 'cursor-pointer hover:bg-gradient-to-r hover:from-purple-500/5 hover:to-blue-500/5 dark:hover:from-purple-500/10 dark:hover:to-blue-500/10' : ''}`}
        onClick={() => hasBreakdown && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/50 dark:bg-[#0d0d0d] border border-gray-300/50 dark:border-[#363636] flex items-center justify-center text-gray-600 dark:text-gray-400 flex-shrink-0">
            <i className="ph-bold ph-book-bookmark"></i>
          </div>
          <div className="min-w-0">
            <h3 className="text-base md:text-lg font-bold text-black dark:text-white truncate">{course.title}</h3>
            <p className="text-xs md:text-sm text-[#6A3FF4] font-medium">{course.code} • {course.credits} Credits</p>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-6 flex-shrink-0">
          <TranscriptGradeBadge grade={course.grade} />
          {hasBreakdown && (
            <i className={`ph-bold ph-caret-down text-gray-600 dark:text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}></i>
          )}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && hasBreakdown && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 bg-white/10 dark:bg-[#0d0d0d]/30 border-t border-gray-300/50 dark:border-[#2d2d2d]">
              {course.breakdown!.map((category) => {
                // Plan 7 Phase 2 — Override category gets a distinct purple
                // treatment + "Adjustment by Admin" badge so students see
                // exactly why their final differs from the component sum.
                const isOverride = category.title === 'Override';
                return (
                <div key={category.title} className="mt-6">
                  <h4 className="text-sm font-bold text-black dark:text-white mb-3 uppercase tracking-wider flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${isOverride ? 'bg-purple-400' : 'bg-[#6A3FF4]'}`}></span>
                      <span className={isOverride ? 'text-purple-400' : ''}>{isOverride ? 'Adjustment by Admin' : category.title}</span>
                      {isOverride && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 normal-case tracking-normal"
                          title="The admin applied a manual override to this course's final grade. The numbers above reflect what was earned; this line reflects what was applied."
                        >
                          override
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 font-medium normal-case tracking-normal">
                      {category.subtotalEarned == null ? 'N/A' : category.subtotalEarned} / {category.subtotalMax}
                    </span>
                  </h4>

                  <div className={`rounded-xl border overflow-hidden ${isOverride ? 'bg-purple-500/5 border-purple-500/30' : 'bg-white/30 dark:bg-[#1a1a1a] border-gray-300/50 dark:border-[#363636]'}`}>
                    <div className="hidden md:grid grid-cols-3 gap-4 px-4 py-2 bg-white/20 dark:bg-[#262626] text-[10px] font-bold text-gray-600 dark:text-gray-500 uppercase tracking-wider border-b border-gray-300/50 dark:border-[#363636]">
                      <div>{t('fullTranscriptPage.component')}</div>
                      <div className="text-right">{t('fullTranscriptPage.score')}</div>
                      <div className="text-right">{t('fullTranscriptPage.max')}</div>
                    </div>
                    <div className="divide-y divide-gray-300/50 dark:divide-[#363636]">
                      {category.assignments.map((item) => (
                        <div key={item.name} className="px-4 py-3 hover:bg-purple-500/5 dark:hover:bg-purple-500/10 transition-colors">
                          <div className="md:grid md:grid-cols-3 md:gap-4 text-sm text-gray-700 dark:text-gray-300">
                            <div className="font-medium text-black dark:text-white mb-1 md:mb-0">{item.name}</div>
                            <div className={`flex md:block justify-between md:text-right font-semibold ${item.earned == null ? 'text-gray-500' : 'text-[#6A3FF4]'}`}>
                              <span className="text-xs text-gray-500 md:hidden">{t('fullTranscriptPage.score')}: </span>
                              {item.earned == null ? 'N/A' : item.earned}
                            </div>
                            <div className="flex md:block justify-between md:text-right text-gray-600 dark:text-gray-500">
                              <span className="text-xs text-gray-500 md:hidden">{t('fullTranscriptPage.max')}: </span>
                              {item.max}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                );
              })}

              <div className="mt-6 pt-4 border-t border-gray-300/50 dark:border-[#2d2d2d] flex flex-col md:flex-row justify-end items-end md:items-center gap-2 md:gap-6">
                <div className="flex items-center gap-3">
                  <span className="text-gray-600 dark:text-gray-400 text-sm font-medium">{t('fullTranscriptPage.courseTotal')}</span>
                  <span className={`text-xl font-bold ${course.totalEarned == null ? 'text-gray-500' : 'text-[#6A3FF4]'}`}>
                    {course.totalEarned == null ? 'N/A' : course.totalEarned} / {course.totalMax ?? 100}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-600 dark:text-gray-400 text-sm font-medium">{t('fullTranscriptPage.finalGrade')}</span>
                  <span className="text-2xl font-bold text-black dark:text-white">{course.grade}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TranscriptSemesterGroup: React.FC<{ semester: TranscriptSemester }> = ({ semester }) => {
  const t = useT();
  const isOverCreditLimit = semester.credits > 21;

  return (
    <div className="mb-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 px-2 gap-2">
        <h3 className="text-lg md:text-xl font-bold text-black dark:text-white flex items-center gap-2 md:gap-3">
          {semester.name}
          {isOverCreditLimit && (
            <span className="bg-red-500/10 text-red-500 text-xs px-2 py-1 rounded-full border border-red-500/20 flex items-center gap-1">
              <i className="ph-bold ph-warning"></i>
              {t('fullTranscriptPage.overCreditsWarn')}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2 md:gap-4 text-sm">
          <div className="px-3 py-1 rounded-lg bg-white/50 dark:bg-[#262626] border border-gray-300/50 dark:border-[#363636] text-gray-600 dark:text-gray-400">
            <span className="font-bold text-black dark:text-white">{semester.gpa.toFixed(2)}</span> {t('fullTranscriptPage.gpaAbbr')}
          </div>
          <div className={`px-3 py-1 rounded-lg border ${isOverCreditLimit ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-white/50 dark:bg-[#262626] border-gray-300/50 dark:border-[#363636] text-gray-600 dark:text-gray-400'}`}>
            <span className={`font-bold ${isOverCreditLimit ? 'text-red-500' : 'text-black dark:text-white'}`}>{semester.credits}</span> {t('fullTranscriptPage.creditsAbbr')}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {semester.courses.map((course, idx) => (
          // Index-suffixed key so a retake in the same semester (two
          // TranscriptCourse rows with the same code, different
          // attemptNumber) renders as TWO cards rather than React
          // collapsing them by duplicate key. Course code alone is no
          // longer unique inside a semester after Plan 22 retake support.
          <TranscriptCourseCard key={`${course.code}-${idx}`} course={course} />
        ))}
      </div>
    </div>
  );
};

// --- Current Semester (live grades, fetched from gradebook) ---
//
// Reuses TranscriptSemesterGroup + TranscriptCourseCard so the live in-progress
// view renders with exactly the same UI as a finished semester. The live data
// is mapped from the gradebook column shape into the transcript breakdown
// shape; ungraded items pass `earned: null` so the card shows "N/A".

interface LiveColumn {
  key: string;
  label: string;
  type: 'assignment' | 'quiz' | 'midterm' | 'final';
  maxScore: number;
  refId?: string;
}

interface LiveCourse {
  courseCode: string;
  courseTitle: string;
  credits: number;
  sectionType?: string | null;
  registrationStatus?: string;
  columns: LiveColumn[];
  scores: Record<string, number | null>;
  meta?: Record<string, { status?: string }>;
  // Plan 22 — confirmed final letter (Confirm vs Release split). Populated
  // once the prof confirms the final but BEFORE they release it to the
  // official transcript. The Current Semester card renders this in place
  // of the "IP" badge so the student sees the letter immediately.
  finalLetter?: string | null;
}

// Group columns by the breakdown bucket the existing card expects.
const CATEGORY_LABEL: Record<LiveColumn['type'], string> = {
  assignment: 'Assignments',
  quiz: 'Quizzes',
  midterm: 'Exams',
  final: 'Exams',
};

function mapLiveCourseToTranscriptCourse(c: LiveCourse): TranscriptCourse {
  // Build the breakdown buckets in a stable order (Assignments → Quizzes →
  // Exams) so the breakdown reads the same way every render.
  const order: LiveColumn['type'][] = ['assignment', 'quiz', 'midterm', 'final'];
  const grouped = new Map<string, { type: LiveColumn['type']; cols: LiveColumn[] }>();
  for (const col of c.columns) {
    const title = CATEGORY_LABEL[col.type];
    if (!grouped.has(title)) grouped.set(title, { type: col.type, cols: [] });
    grouped.get(title)!.cols.push(col);
  }

  const breakdown = Array.from(grouped.entries())
    .sort(([a], [b]) => order.indexOf(grouped.get(a)!.type) - order.indexOf(grouped.get(b)!.type))
    .map(([title, { cols }]) => {
      const assignments = cols.map((col) => {
        const v = c.scores[col.key];
        return {
          name: col.label,
          earned: typeof v === 'number' ? v : null,
          max: col.maxScore,
        };
      });
      const subtotalEarnedNums = assignments
        .map((a) => a.earned)
        .filter((v): v is number => typeof v === 'number');
      const subtotalEarned = subtotalEarnedNums.length > 0
        ? subtotalEarnedNums.reduce((s, v) => s + v, 0)
        : null;
      const subtotalMax = assignments.reduce((s, a) => s + (a.max ?? 0), 0);
      return {
        title,
        assignments,
        subtotalEarned,
        subtotalMax,
      };
    });

  const allScores = c.columns
    .map((col) => c.scores[col.key])
    .filter((v): v is number => typeof v === 'number');
  const totalEarned = allScores.length > 0 ? allScores.reduce((s, v) => s + v, 0) : null;
  const totalMax = c.columns.reduce((s, col) => s + (col.maxScore ?? 0), 0);

  return {
    code: c.courseCode,
    title: c.courseTitle,
    credits: c.credits,
    // Once the prof confirms the final, the backend surfaces the letter
    // here. Until then ("IP" = in progress) — same as before.
    grade: c.finalLetter ?? 'IP',
    points: 0,
    totalEarned,
    totalMax,
    breakdown,
  };
}

const CurrentSemesterSection: React.FC = () => {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<LiveCourse[]>([]);
  // Owner directive (2026-05-19): show the actual semester name (e.g.
  // "Spring 2026") as the section header instead of the static
  // "Current Semester" label. Sourced from the active RegistrationPeriod
  // by the backend.
  const [semesterName, setSemesterName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `${API_URLS.courseContent()}/api/me/gradebook/current-semester`,
          { credentials: 'include', headers: authHeaders() },
        );
        if (cancelled) return;
        if (!res.ok) {
          setError(`Failed to load current semester (HTTP ${res.status}).`);
          return;
        }
        const data = await res.json();
        setCourses(Array.isArray(data?.courses) ? data.courses : []);
        if (typeof data?.semesterName === 'string' && data.semesterName.length > 0) {
          setSemesterName(data.semesterName);
        }
      } catch {
        if (!cancelled) setError('Network error loading current semester.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Map the live courses into a synthetic TranscriptSemester so we can hand
  // them straight to the same TranscriptSemesterGroup / TranscriptCourseCard
  // the historical transcript uses. GPA stays 0 — there isn't one until the
  // semester closes — and the card's grade badge reads "IP" (in progress).
  const liveSemester: TranscriptSemester | null = useMemo(() => {
    if (courses.length === 0) return null;
    const totalCredits = courses.reduce((s, c) => s + (c.credits ?? 0), 0);
    return {
      id: 'current',
      // Fallback to "Current Semester" when the backend couldn't resolve a
      // semester name (e.g. no active RegistrationPeriod configured yet).
      name: semesterName || 'Current Semester',
      gpa: 0,
      credits: totalCredits,
      courses: courses.map(mapLiveCourseToTranscriptCourse),
    };
  }, [courses, semesterName]);

  if (loading) {
    return (
      <div className="space-y-3 mb-8">
        {[1, 2].map((i) => (
          <div key={i} className="h-40 bg-white/5 animate-pulse rounded-2xl" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="mb-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
        <i className="ph-bold ph-warning-circle" /> {error}
      </div>
    );
  }
  if (!liveSemester) return null;

  // Plan 7 Phase 3 — clarifying note above the in-progress card. Communicates
  // that the live numbers are partial and will lock in once the professor
  // confirms each course's final grade.
  return (
    <div>
      <div className="mb-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
        <i className="ph-bold ph-info text-base mt-0.5" />
        <span>
          <strong>{t('fullTranscriptPage.inProgressTotalBold')}</strong> {t('fullTranscriptPage.inProgressTotalBody')}
        </span>
      </div>
      <TranscriptSemesterGroup semester={liveSemester} />
    </div>
  );
};

// --- Main Page Component ---

const FullTranscript: React.FC = () => {
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  // Get actual logged-in user's email from localStorage
  const studentId = localStorage.getItem('currentUserEmail') || '';
  const t = useT();

  const { searchTerm } = useAppContext();

  const [gradeFilter, setGradeFilter] = useState('All');
  const [semesterFilter, setSemesterFilter] = useState('All');

  // Plan 4 Phase 1 — graduation eligibility (FCDS Article 8). Live policy
  // is fetched once via useAcademicSettings(); main-semester count derives
  // from semester names (Summer terms are excluded per Article 8 wording).
  const graduationPolicy = useGraduationPolicy();
  const eligibility = useMemo<GraduationEvaluation | null>(() => {
    if (!transcriptData) return null;
    const mainSemesters = transcriptData.semesters.filter(
      (s) => !/summer/i.test(s.name),
    ).length;
    return evaluateGraduationEligibility(
      {
        totalCredits: transcriptData.totalCredits,
        cgpa: transcriptData.gpa,
        mainSemesters,
      },
      graduationPolicy,
    );
  }, [transcriptData, graduationPolicy]);

  useEffect(() => {
    const loadTranscript = async () => {
      try {
        const data = await fetchTranscript(studentId);
        if (data) {
          setTranscriptData(data);
        } else {
          console.warn('No transcript data returned');
          setTranscriptData({
            studentId: studentId,
            gpa: 0,
            totalCredits: 0,
            semesters: []
          });
        }
      } catch (error) {
        console.error("Failed to load transcript", error);
        setTranscriptData({
          studentId: studentId,
          gpa: 0,
          totalCredits: 0,
          semesters: []
        });
      } finally {
        setLoading(false);
      }
    };
    loadTranscript();
    // Mount-only fetch; studentId is read from localStorage and stable per page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uniqueSemesters = useMemo(() => {
    if (!transcriptData?.semesters) return [];
    return Array.from(new Set(transcriptData.semesters.map(s => s.name)));
  }, [transcriptData]);

  const uniqueGrades = useMemo(() => {
    if (!transcriptData?.semesters) return [];
    const grades = new Set<string>();
    transcriptData.semesters.forEach(s => s.courses.forEach(c => grades.add(c.grade)));
    return Array.from(grades).sort();
  }, [transcriptData]);

  const filteredSemesters = useMemo(() => {
    if (!transcriptData) return [];

    return transcriptData.semesters.map(semester => {
      if (semesterFilter !== 'All' && semester.name !== semesterFilter) {
        return null;
      }

      const filteredCourses = semester.courses.filter(course => {
        const matchesSearch =
          course.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          course.code.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesGrade = gradeFilter === 'All' || course.grade === gradeFilter;

        return matchesSearch && matchesGrade;
      });

      if (filteredCourses.length === 0) return null;

      return {
        ...semester,
        courses: filteredCourses
      };
    }).filter((s): s is TranscriptSemester => s !== null);
  }, [transcriptData, searchTerm, gradeFilter, semesterFilter]);

  const handleExportPDF = async () => {
    if (!transcriptData) {
      alert("Transcript data not loaded yet.");
      return;
    }

    try {
      const userProfile = await fetchUserProfile(studentId);
      const userId = localStorage.getItem('currentUserId') || studentId;

      // Use the shared `downloadTranscriptPdf` helper so the student's PDF
      // includes the current-semester (in-progress) courses just like the
      // admin's path does. The previous local inline export diverged and
      // only included historical semesters, hiding any in-progress courses.
      const ok = await downloadTranscriptPdf(userId, {
        name: userProfile ? `${userProfile.firstName} ${userProfile.lastName}` : 'Student',
        studentId: userProfile?.odID || studentId,
        major: userProfile?.academic.major || 'Undeclared',
        email: userProfile?.email || '',
        enrollmentDate: userProfile?.academic.enrollmentDate || '',
        expectedGraduation: userProfile?.academic.expectedGraduation || '',
        isAdmin: false,
      });
      if (!ok) {
        alert('Failed to generate PDF. Please try again.');
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      alert("Failed to generate PDF. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <i className="ph-bold ph-spinner animate-spin text-4xl mb-4 text-[#6A3FF4]"></i>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="pb-16 space-y-6">
      <AnimateOnView>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-black dark:text-white text-3xl font-bold mb-2">{t('fullTranscriptPage.title')}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t('fullTranscriptPage.subtitle')}</p>
          </div>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 bg-[#6A3FF4] hover:bg-[#5a32d4] text-white px-6 py-2.5 rounded-xl transition-colors duration-200 shadow-lg shadow-purple-500/20"
          >
            <i className="ph-bold ph-file-pdf text-lg"></i>
            <span className="font-medium">{t('fullTranscriptPage.download')}</span>
          </button>
        </div>
      </AnimateOnView>

      <AnimateOnView delay={0.1}>
        <TranscriptPerformanceCard
          gpa={transcriptData?.gpa || 0}
          credits={transcriptData?.totalCredits || 0}
          eligibility={eligibility}
          standing={transcriptData?.academicStanding}
          honors={transcriptData?.honorsEligible}
          semesters={transcriptData?.semesters ?? []}
        />
      </AnimateOnView>

      {/* Current semester — live marks for in-progress enrollments. Pulled
          from the same gradebook source the professor sees, so a freshly
          graded quiz / assignment shows up here without any cascade lag. */}
      <AnimateOnView delay={0.13}>
        <CurrentSemesterSection />
      </AnimateOnView>

      {/* Filters */}
      <AnimateOnView delay={0.15}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="relative z-30">
            <GlassDropdown
              value={semesterFilter}
              onChange={setSemesterFilter}
              options={[
                { value: 'All', label: t('fullTranscriptPage.title'), icon: 'ph-calendar' },
                ...uniqueSemesters.map(s => ({ value: s, label: s, icon: 'ph-calendar' }))
              ]}
              className="w-full"
            />
          </div>

          <div className="relative z-20">
            <GlassDropdown
              value={gradeFilter}
              onChange={setGradeFilter}
              options={[
                { value: 'All', label: 'All Grades', icon: 'ph-exam' },
                ...uniqueGrades.map(g => ({ value: g, label: g, icon: 'ph-exam' }))
              ]}
              className="w-full"
            />
          </div>
        </div>
      </AnimateOnView>

      <div className="space-y-6">
        {filteredSemesters.length > 0 ? (
          filteredSemesters.map((semester, index) => (
            <AnimateOnView key={semester.id} delay={0.2 + index * 0.1}>
              <TranscriptSemesterGroup semester={semester} />
            </AnimateOnView>
          ))
        ) : (
          <div className="text-center text-gray-500 py-16 bg-white/5 dark:bg-white/5 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
            <i className="ph-bold ph-magnifying-glass text-4xl mb-4 block opacity-30"></i>
            <p className="font-medium">{t('coursesPage.noMatch')}</p>
            <p className="text-sm mt-1">{t('coursesPage.tryDifferent')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default FullTranscript;
