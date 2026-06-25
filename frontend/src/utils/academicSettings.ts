/**
 * Phase 12 — institution-configurable academic structure, attendance rules,
 * and credit-limit policy.
 *
 * Mirrors the gradingRules pattern: cached at module level, fetched once
 * from the public /api/public-settings endpoint, exposed via React hooks.
 *
 * Three concerns share this file because the same fetch returns all three:
 *   • numberOfAcademicLevels — drives "Level 1, Level 2, …" enumeration.
 *   • attendanceRules — percentage thresholds for warnings + barring.
 *   • creditLimitPolicy — per-rule credit caps for registration enforcement.
 */

import { useEffect, useState } from 'react';
import { API_URLS } from '@shared/config';
import { isPreviewSession } from './previewSession';

export interface AttendanceRules {
  minAttendancePercent: number;   // floor of attendance% (e.g. 75)
  warnAbsencePercents: number[];  // sorted ascending (e.g. [15, 20])
  failAbsencePercent: number;     // barred + FW threshold (e.g. 25)
  barredGradeLetter: string;      // letter assigned when barred (e.g. "FW")
  practicalOnly: boolean;
}

const DEFAULT_RULES: AttendanceRules = {
  minAttendancePercent: 75,
  warnAbsencePercents: [15, 20],
  failAbsencePercent: 25,
  barredGradeLetter: 'FW',
  practicalOnly: false,
};

export interface CreditLimitPolicy {
  summer: number;
  seniorBonus: number;
  freshmanSecondChance: number;
  freshmanSecondChanceMinGpa: number;
  highGpa: number;
  normal: number;
  probation: number;
  highGpaThreshold: number;
  goodStandingThreshold: number;
}

export const DEFAULT_CREDIT_POLICY: CreditLimitPolicy = {
  summer: 9,
  seniorBonus: 21,
  freshmanSecondChance: 19,
  freshmanSecondChanceMinGpa: 1.66,
  highGpa: 21,
  normal: 19,
  probation: 12,
  highGpaThreshold: 3.33,
  goodStandingThreshold: 2.0,
};

export interface LevelThreshold {
  level: number;
  minCredits: number;
}

export interface LevelProgression {
  thresholds: LevelThreshold[];
}

export const DEFAULT_LEVEL_PROGRESSION: LevelProgression = {
  thresholds: [
    { level: 2, minCredits: 28 },
    { level: 3, minCredits: 64 },
    { level: 4, minCredits: 96 },
  ],
};

// Plan 4 Phase 1 — graduation requirements (FCDS Article 8) + semester
// durations (FCDS Article 5). Stored on SystemSettings; admin-tunable.
export interface GraduationPolicy {
  minTotalCredits: number;
  minMainSemesters: number;
  minCgpa: number;
}

export const DEFAULT_GRADUATION_POLICY: GraduationPolicy = {
  minTotalCredits:  140,
  minMainSemesters: 7,
  minCgpa:          2.0,
};

export interface SemesterDurations {
  fallWeeks: number;
  springWeeks: number;
  summerWeeks: number;
}

export const DEFAULT_SEMESTER_DURATIONS: SemesterDurations = {
  fallWeeks:   15,
  springWeeks: 15,
  summerWeeks: 8,
};

// Plan 4 Phase 3 — registration / add-drop / withdrawal windows (FCDS
// Articles 13, 14, 15). Each window is encoded as start-week + end-week per
// main / summer term; resolved into concrete dates against the active
// RegistrationPeriod's startDate.
export interface WeekRange {
  startWeek: number;
  endWeek: number;
}
export interface TermWindow {
  main: WeekRange;
  summer: WeekRange;
}
export interface WindowsPolicy {
  lateRegistration: TermWindow;
  addDrop: TermWindow;
  withdrawal: TermWindow;
}

export const DEFAULT_WINDOWS_POLICY: WindowsPolicy = {
  lateRegistration: {
    main:   { startWeek: 2, endWeek: 2 },
    summer: { startWeek: 1, endWeek: 1 },
  },
  addDrop: {
    main:   { startWeek: 2, endWeek: 3 },
    summer: { startWeek: 1, endWeek: 1 },
  },
  withdrawal: {
    main:   { startWeek: 4, endWeek: 12 },
    summer: { startWeek: 6, endWeek: 6 },
  },
};

// Plan 4 Phase 4 — incomplete grade policy (FCDS Article 17).
export interface IncompletePolicy {
  minTermWorkPercent: number;
  maxIncompletesPerStudent: number;
  makeupExamWindowDays: number;
}

export const DEFAULT_INCOMPLETE_POLICY: IncompletePolicy = {
  minTermWorkPercent:        60,
  maxIncompletesPerStudent:  3,
  makeupExamWindowDays:      7,
};

// Plan 4 Phase 4 — course repetition policy (FCDS Article 18).
export interface RepetitionPolicy {
  retakesCountedForGpa: number;
  countAllAttemptsBeyond: boolean;
  allowImprovementForProbation: boolean;
  /** null = no cap on retake grades. Otherwise a letter (e.g. 'B+'). */
  maxGradeAfterRetake: string | null;
  maxGradeAppliesToFirstRetakeOnly: boolean;
  preserveOriginalIfHigher: boolean;
}

export const DEFAULT_REPETITION_POLICY: RepetitionPolicy = {
  retakesCountedForGpa:           8,
  countAllAttemptsBeyond:         true,
  allowImprovementForProbation:   true,
  maxGradeAfterRetake:            null,
  maxGradeAppliesToFirstRetakeOnly: false,
  preserveOriginalIfHigher:       true,
};

// Plan 4 Phase 5 — Honors qualification (FCDS Article 22).
export interface HonorsPolicy {
  maxMainSemesters: number;
  perSemesterMinGpa: number;
  cumulativeMinGpa: number;
  /** null = use gradingRules.academicStanding.highHonorsGpaAbove (default 3.85). */
  highHonorsCumMinGpa: number | null;
  /** Letter grades that disqualify a student from honors (FCDS = F, (F), FW, U). */
  disqualifyingGrades: string[];
  /** When true, a single disciplinary penalty disqualifies. */
  requireNoDisciplinary: boolean;
}

export const DEFAULT_HONORS_POLICY: HonorsPolicy = {
  maxMainSemesters:      9,
  perSemesterMinGpa:     3.333,
  cumulativeMinGpa:      3.666,
  highHonorsCumMinGpa:   null,
  disqualifyingGrades:   ['F', '(F)', 'FW', 'U'],
  requireNoDisciplinary: true,
};

// Plan 4 Phase 6 — enrollment workflow caps (FCDS Articles 20, 21).
export interface SuspensionPolicy {
  maxSuspensionsTotal: number;
  maxConsecutive: number;
  militaryWithdrawalCountsAgainstCap: boolean;
  reEnrollmentWithinSemesters: number;
}

export const DEFAULT_SUSPENSION_POLICY: SuspensionPolicy = {
  maxSuspensionsTotal:                4,
  maxConsecutive:                     4,
  militaryWithdrawalCountsAgainstCap: false,
  reEnrollmentWithinSemesters:        4,
};

// Plan 4 Phase 7 — mobility / exchange + visiting-student caps (Articles 24, 25).
export interface MobilityPolicy {
  maxExternalPercentOfTotal: number;
  includeInCgpa: boolean;
  visitingMaxPerMain: number;
  visitingMaxPerSummer: number;
}

export const DEFAULT_MOBILITY_POLICY: MobilityPolicy = {
  maxExternalPercentOfTotal: 0.25,
  includeInCgpa:             true,
  visitingMaxPerMain:        12,
  visitingMaxPerSummer:      9,
};

// Plan 4 Phase 8 — academic advisor approval gate (Article 12).
export interface AdvisorPolicy {
  requireAdvisorApproval: boolean;
  autoApproveBelowCredits: number;
  gracePeriodHours: number;
  restrictPickerToFlaggedProfessors: boolean;
}

export const DEFAULT_ADVISOR_POLICY: AdvisorPolicy = {
  requireAdvisorApproval:           true,
  autoApproveBelowCredits:          0,
  gracePeriodHours:                 0,
  restrictPickerToFlaggedProfessors: true,
};

// Plan 4 Phase 9 — credit-hour definition (FCDS Article 6).
export interface CreditHourDefinition {
  lectureHoursPerCredit: number;
  practicalHoursPerCredit: number;
  appliedTrainingHoursPerCredit: number;
  fieldTrainingHoursPerCredit: number;
}

export const DEFAULT_CREDIT_HOUR_DEFINITION: CreditHourDefinition = {
  lectureHoursPerCredit:         1,
  practicalHoursPerCredit:       2,
  appliedTrainingHoursPerCredit: 3,
  fieldTrainingHoursPerCredit:   4,
};

interface AcademicSettings {
  numberOfAcademicLevels: number;
  attendanceRules: AttendanceRules;
  creditLimitPolicy: CreditLimitPolicy;
  levelProgression: LevelProgression;
  graduationPolicy: GraduationPolicy;
  semesterDurations: SemesterDurations;
  windowsPolicy: WindowsPolicy;
  incompletePolicy: IncompletePolicy;
  repetitionPolicy: RepetitionPolicy;
  honorsPolicy: HonorsPolicy;
  suspensionPolicy: SuspensionPolicy;
  mobilityPolicy: MobilityPolicy;
  advisorPolicy: AdvisorPolicy;
  creditHourDefinition: CreditHourDefinition;
}

const DEFAULTS: AcademicSettings = {
  numberOfAcademicLevels: 4,
  attendanceRules: DEFAULT_RULES,
  creditLimitPolicy: DEFAULT_CREDIT_POLICY,
  levelProgression: DEFAULT_LEVEL_PROGRESSION,
  graduationPolicy: DEFAULT_GRADUATION_POLICY,
  semesterDurations: DEFAULT_SEMESTER_DURATIONS,
  windowsPolicy: DEFAULT_WINDOWS_POLICY,
  incompletePolicy: DEFAULT_INCOMPLETE_POLICY,
  repetitionPolicy: DEFAULT_REPETITION_POLICY,
  honorsPolicy: DEFAULT_HONORS_POLICY,
  suspensionPolicy: DEFAULT_SUSPENSION_POLICY,
  mobilityPolicy: DEFAULT_MOBILITY_POLICY,
  advisorPolicy: DEFAULT_ADVISOR_POLICY,
  creditHourDefinition: DEFAULT_CREDIT_HOUR_DEFINITION,
};

let cached: AcademicSettings | null = null;
let inflight: Promise<AcademicSettings> | null = null;
const subscribers = new Set<(s: AcademicSettings) => void>();

function mergeWithDefaults(raw: unknown): AcademicSettings {
  const r = (raw ?? {}) as Partial<AcademicSettings> & {
    attendanceRules?: Partial<AttendanceRules>;
    creditLimitPolicy?: Partial<CreditLimitPolicy>;
    levelProgression?: Partial<LevelProgression>;
    graduationPolicy?: Partial<GraduationPolicy>;
    semesterDurations?: Partial<SemesterDurations>;
    windowsPolicy?: Partial<WindowsPolicy>;
    incompletePolicy?: Partial<IncompletePolicy>;
    repetitionPolicy?: Partial<RepetitionPolicy>;
    honorsPolicy?: Partial<HonorsPolicy>;
    suspensionPolicy?: Partial<SuspensionPolicy>;
    mobilityPolicy?: Partial<MobilityPolicy>;
    advisorPolicy?: Partial<AdvisorPolicy>;
    creditHourDefinition?: Partial<CreditHourDefinition>;
  };
  const ar: Partial<AttendanceRules> = r.attendanceRules || {};
  const cp: Partial<CreditLimitPolicy> = r.creditLimitPolicy || {};
  const lp: Partial<LevelProgression> = r.levelProgression || {};
  const gp: Partial<GraduationPolicy> = r.graduationPolicy || {};
  const sd: Partial<SemesterDurations> = r.semesterDurations || {};
  const wp: Partial<WindowsPolicy> = r.windowsPolicy || {};
  const ip: Partial<IncompletePolicy> = r.incompletePolicy || {};
  const rp: Partial<RepetitionPolicy> = r.repetitionPolicy || {};
  const hp: Partial<HonorsPolicy> = r.honorsPolicy || {};
  const sp: Partial<SuspensionPolicy> = r.suspensionPolicy || {};
  const mp: Partial<MobilityPolicy> = r.mobilityPolicy || {};
  const advp: Partial<AdvisorPolicy> = r.advisorPolicy || {};
  const chd: Partial<CreditHourDefinition> = r.creditHourDefinition || {};
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const posInt = (v: unknown, fallback: number): number =>
    Number.isInteger(v) && (v as number) > 0 ? (v as number) : fallback;
  const mergeRange = (stored: Partial<WeekRange> | undefined, fallback: WeekRange): WeekRange => ({
    startWeek: posInt(stored?.startWeek, fallback.startWeek),
    endWeek:   posInt(stored?.endWeek,   fallback.endWeek),
  });
  const mergeTerm = (stored: Partial<TermWindow> | undefined, fallback: TermWindow): TermWindow => ({
    main:   mergeRange(stored?.main,   fallback.main),
    summer: mergeRange(stored?.summer, fallback.summer),
  });
  // Level-progression sanitiser: drop malformed rows, sort, dedupe by level.
  const rawThresholds = Array.isArray(lp.thresholds) ? lp.thresholds : [];
  const cleanedThresholds = rawThresholds
    .filter(
      (t): t is LevelThreshold =>
        !!t &&
        Number.isInteger((t as LevelThreshold).level) &&
        Number.isInteger((t as LevelThreshold).minCredits) &&
        (t as LevelThreshold).level >= 2 &&
        (t as LevelThreshold).minCredits >= 0,
    )
    .sort((a, b) => a.level - b.level);
  const finalThresholds: LevelThreshold[] =
    cleanedThresholds.length > 0 ? cleanedThresholds : DEFAULT_LEVEL_PROGRESSION.thresholds;
  return {
    numberOfAcademicLevels:
      typeof r.numberOfAcademicLevels === 'number' && r.numberOfAcademicLevels > 0
        ? r.numberOfAcademicLevels
        : DEFAULTS.numberOfAcademicLevels,
    attendanceRules: {
      minAttendancePercent: typeof ar.minAttendancePercent === 'number'
        ? ar.minAttendancePercent : DEFAULT_RULES.minAttendancePercent,
      warnAbsencePercents: Array.isArray(ar.warnAbsencePercents)
        ? [...ar.warnAbsencePercents].sort((a, b) => a - b)
        : DEFAULT_RULES.warnAbsencePercents,
      failAbsencePercent: typeof ar.failAbsencePercent === 'number'
        ? ar.failAbsencePercent : DEFAULT_RULES.failAbsencePercent,
      barredGradeLetter: typeof ar.barredGradeLetter === 'string'
        ? ar.barredGradeLetter : DEFAULT_RULES.barredGradeLetter,
      practicalOnly: typeof ar.practicalOnly === 'boolean'
        ? ar.practicalOnly : DEFAULT_RULES.practicalOnly,
    },
    creditLimitPolicy: {
      summer:                     num(cp.summer,                     DEFAULT_CREDIT_POLICY.summer),
      seniorBonus:                num(cp.seniorBonus,                DEFAULT_CREDIT_POLICY.seniorBonus),
      freshmanSecondChance:       num(cp.freshmanSecondChance,       DEFAULT_CREDIT_POLICY.freshmanSecondChance),
      freshmanSecondChanceMinGpa: num(cp.freshmanSecondChanceMinGpa, DEFAULT_CREDIT_POLICY.freshmanSecondChanceMinGpa),
      highGpa:                    num(cp.highGpa,                    DEFAULT_CREDIT_POLICY.highGpa),
      normal:                     num(cp.normal,                     DEFAULT_CREDIT_POLICY.normal),
      probation:                  num(cp.probation,                  DEFAULT_CREDIT_POLICY.probation),
      highGpaThreshold:           num(cp.highGpaThreshold,           DEFAULT_CREDIT_POLICY.highGpaThreshold),
      goodStandingThreshold:      num(cp.goodStandingThreshold,      DEFAULT_CREDIT_POLICY.goodStandingThreshold),
    },
    levelProgression: { thresholds: finalThresholds },
    graduationPolicy: {
      minTotalCredits:  posInt(gp.minTotalCredits,  DEFAULT_GRADUATION_POLICY.minTotalCredits),
      minMainSemesters: posInt(gp.minMainSemesters, DEFAULT_GRADUATION_POLICY.minMainSemesters),
      minCgpa:          num   (gp.minCgpa,          DEFAULT_GRADUATION_POLICY.minCgpa),
    },
    semesterDurations: {
      fallWeeks:   posInt(sd.fallWeeks,   DEFAULT_SEMESTER_DURATIONS.fallWeeks),
      springWeeks: posInt(sd.springWeeks, DEFAULT_SEMESTER_DURATIONS.springWeeks),
      summerWeeks: posInt(sd.summerWeeks, DEFAULT_SEMESTER_DURATIONS.summerWeeks),
    },
    windowsPolicy: {
      lateRegistration: mergeTerm(wp.lateRegistration, DEFAULT_WINDOWS_POLICY.lateRegistration),
      addDrop:          mergeTerm(wp.addDrop,          DEFAULT_WINDOWS_POLICY.addDrop),
      withdrawal:       mergeTerm(wp.withdrawal,       DEFAULT_WINDOWS_POLICY.withdrawal),
    },
    incompletePolicy: {
      minTermWorkPercent:       num(ip.minTermWorkPercent,       DEFAULT_INCOMPLETE_POLICY.minTermWorkPercent),
      maxIncompletesPerStudent: posInt(ip.maxIncompletesPerStudent, DEFAULT_INCOMPLETE_POLICY.maxIncompletesPerStudent),
      makeupExamWindowDays:     posInt(ip.makeupExamWindowDays,     DEFAULT_INCOMPLETE_POLICY.makeupExamWindowDays),
    },
    repetitionPolicy: {
      // Use Number.isInteger check directly — `posInt` rejects 0, but
      // retakesCountedForGpa = 0 is a legitimate setting (count every attempt).
      retakesCountedForGpa:             Number.isInteger(rp.retakesCountedForGpa) && (rp.retakesCountedForGpa as number) >= 0
                                          ? (rp.retakesCountedForGpa as number)
                                          : DEFAULT_REPETITION_POLICY.retakesCountedForGpa,
      countAllAttemptsBeyond:           bool  (rp.countAllAttemptsBeyond,           DEFAULT_REPETITION_POLICY.countAllAttemptsBeyond),
      allowImprovementForProbation:     bool  (rp.allowImprovementForProbation,     DEFAULT_REPETITION_POLICY.allowImprovementForProbation),
      maxGradeAfterRetake:              typeof rp.maxGradeAfterRetake === 'string' && rp.maxGradeAfterRetake.length > 0
                                          ? rp.maxGradeAfterRetake
                                          : null,
      maxGradeAppliesToFirstRetakeOnly: bool  (rp.maxGradeAppliesToFirstRetakeOnly, DEFAULT_REPETITION_POLICY.maxGradeAppliesToFirstRetakeOnly),
      preserveOriginalIfHigher:         bool  (rp.preserveOriginalIfHigher,         DEFAULT_REPETITION_POLICY.preserveOriginalIfHigher),
    },
    honorsPolicy: {
      maxMainSemesters:      posInt(hp.maxMainSemesters,  DEFAULT_HONORS_POLICY.maxMainSemesters),
      perSemesterMinGpa:     num   (hp.perSemesterMinGpa, DEFAULT_HONORS_POLICY.perSemesterMinGpa),
      cumulativeMinGpa:      num   (hp.cumulativeMinGpa,  DEFAULT_HONORS_POLICY.cumulativeMinGpa),
      highHonorsCumMinGpa:   typeof hp.highHonorsCumMinGpa === 'number' && Number.isFinite(hp.highHonorsCumMinGpa)
                                ? hp.highHonorsCumMinGpa
                                : null,
      disqualifyingGrades:   Array.isArray(hp.disqualifyingGrades)
                                ? hp.disqualifyingGrades.filter((s) => typeof s === 'string')
                                : DEFAULT_HONORS_POLICY.disqualifyingGrades,
      requireNoDisciplinary: bool(hp.requireNoDisciplinary, DEFAULT_HONORS_POLICY.requireNoDisciplinary),
    },
    suspensionPolicy: {
      maxSuspensionsTotal:                Number.isInteger(sp.maxSuspensionsTotal) && (sp.maxSuspensionsTotal as number) >= 0
                                            ? (sp.maxSuspensionsTotal as number)
                                            : DEFAULT_SUSPENSION_POLICY.maxSuspensionsTotal,
      maxConsecutive:                     Number.isInteger(sp.maxConsecutive) && (sp.maxConsecutive as number) >= 0
                                            ? (sp.maxConsecutive as number)
                                            : DEFAULT_SUSPENSION_POLICY.maxConsecutive,
      militaryWithdrawalCountsAgainstCap: bool(sp.militaryWithdrawalCountsAgainstCap, DEFAULT_SUSPENSION_POLICY.militaryWithdrawalCountsAgainstCap),
      reEnrollmentWithinSemesters:        Number.isInteger(sp.reEnrollmentWithinSemesters) && (sp.reEnrollmentWithinSemesters as number) >= 0
                                            ? (sp.reEnrollmentWithinSemesters as number)
                                            : DEFAULT_SUSPENSION_POLICY.reEnrollmentWithinSemesters,
    },
    mobilityPolicy: {
      maxExternalPercentOfTotal: typeof mp.maxExternalPercentOfTotal === 'number' && mp.maxExternalPercentOfTotal >= 0 && mp.maxExternalPercentOfTotal <= 1
                                  ? mp.maxExternalPercentOfTotal
                                  : DEFAULT_MOBILITY_POLICY.maxExternalPercentOfTotal,
      includeInCgpa:             bool(mp.includeInCgpa, DEFAULT_MOBILITY_POLICY.includeInCgpa),
      visitingMaxPerMain:        Number.isInteger(mp.visitingMaxPerMain) && (mp.visitingMaxPerMain as number) >= 0
                                  ? (mp.visitingMaxPerMain as number)
                                  : DEFAULT_MOBILITY_POLICY.visitingMaxPerMain,
      visitingMaxPerSummer:      Number.isInteger(mp.visitingMaxPerSummer) && (mp.visitingMaxPerSummer as number) >= 0
                                  ? (mp.visitingMaxPerSummer as number)
                                  : DEFAULT_MOBILITY_POLICY.visitingMaxPerSummer,
    },
    advisorPolicy: {
      requireAdvisorApproval:           bool(advp.requireAdvisorApproval, DEFAULT_ADVISOR_POLICY.requireAdvisorApproval),
      autoApproveBelowCredits:          Number.isInteger(advp.autoApproveBelowCredits) && (advp.autoApproveBelowCredits as number) >= 0
                                          ? (advp.autoApproveBelowCredits as number)
                                          : DEFAULT_ADVISOR_POLICY.autoApproveBelowCredits,
      gracePeriodHours:                 Number.isInteger(advp.gracePeriodHours) && (advp.gracePeriodHours as number) >= 0
                                          ? (advp.gracePeriodHours as number)
                                          : DEFAULT_ADVISOR_POLICY.gracePeriodHours,
      restrictPickerToFlaggedProfessors: bool(advp.restrictPickerToFlaggedProfessors, DEFAULT_ADVISOR_POLICY.restrictPickerToFlaggedProfessors),
    },
    creditHourDefinition: {
      lectureHoursPerCredit:         num(chd.lectureHoursPerCredit,         DEFAULT_CREDIT_HOUR_DEFINITION.lectureHoursPerCredit),
      practicalHoursPerCredit:       num(chd.practicalHoursPerCredit,       DEFAULT_CREDIT_HOUR_DEFINITION.practicalHoursPerCredit),
      appliedTrainingHoursPerCredit: num(chd.appliedTrainingHoursPerCredit, DEFAULT_CREDIT_HOUR_DEFINITION.appliedTrainingHoursPerCredit),
      fieldTrainingHoursPerCredit:   num(chd.fieldTrainingHoursPerCredit,   DEFAULT_CREDIT_HOUR_DEFINITION.fieldTrainingHoursPerCredit),
    },
  };
}

async function load(): Promise<AcademicSettings> {
  // Preview (mock-role) sessions never call the backend — use FCDS defaults.
  if (isPreviewSession()) {
    cached = DEFAULTS;
    return DEFAULTS;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${API_URLS.userProfile()}/api/public-settings`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        cached = mergeWithDefaults(data);
        subscribers.forEach((cb) => cb(cached!));
        return cached!;
      }
    } catch { /* fall through */ }
    cached = DEFAULTS;
    subscribers.forEach((cb) => cb(DEFAULTS));
    return DEFAULTS;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function useAcademicSettings(): AcademicSettings {
  const [s, setS] = useState<AcademicSettings>(cached ?? DEFAULTS);

  useEffect(() => {
    let mounted = true;
    if (!cached) {
      load().then((next) => { if (mounted) setS(next); });
    } else {
      setS(cached);
    }
    const cb = (next: AcademicSettings) => { if (mounted) setS(next); };
    subscribers.add(cb);
    return () => { mounted = false; subscribers.delete(cb); };
  }, []);

  return s;
}

/** Override the cached settings (admin Settings save fires this). */
export function setAcademicSettings(patch: Partial<AcademicSettings>): void {
  cached = mergeWithDefaults({ ...(cached ?? DEFAULTS), ...patch });
  subscribers.forEach((cb) => cb(cached!));
}

/**
 * Classify the caller's attendance state from an absence percentage.
 * Returns one of 'good' | 'warned' | 'final_warning' | 'barred'. Drives
 * the badge colour on the student attendance page.
 */
export function classifyAttendance(absencePercent: number, rules: AttendanceRules): 'good' | 'warned' | 'final_warning' | 'barred' {
  if (absencePercent >= rules.failAbsencePercent) return 'barred';
  const warns = [...rules.warnAbsencePercents].sort((a, b) => a - b);
  if (warns.length >= 2 && absencePercent >= warns[warns.length - 1]) return 'final_warning';
  if (warns.length >= 1 && absencePercent >= warns[0]) return 'warned';
  return 'good';
}

/**
 * Convenience hook for components that only need the credit-limit policy
 * (e.g. the admin Settings card, or any future student-facing surface that
 * wants to show "your max credit hours this semester is X").
 */
export function useCreditLimitPolicy(): CreditLimitPolicy {
  return useAcademicSettings().creditLimitPolicy;
}

/**
 * Compute a student's academic level from earned credits and the active
 * level-progression policy. Mirrors backend/lib/level-progression.js so that
 * frontend computations match the backend gate decision exactly.
 */
export function computeLevel(credits: number | null | undefined, policy: LevelProgression): number {
  const c = Number(credits) || 0;
  const sorted = [...policy.thresholds].sort((a, b) => a.level - b.level);
  let level = 1;
  for (const t of sorted) {
    if (c >= t.minCredits) {
      level = t.level;
    } else {
      break;
    }
  }
  return level;
}

/**
 * Convenience hook for components that only need the level-progression policy
 * (e.g. the admin Level Progression editor, or any future student-facing
 * "you'll reach Level 3 in X credits" hint).
 */
export function useLevelProgression(): LevelProgression {
  return useAcademicSettings().levelProgression;
}

/** Convenience hook — Plan 4 Phase 1 graduation policy. */
export function useGraduationPolicy(): GraduationPolicy {
  return useAcademicSettings().graduationPolicy;
}

/** Convenience hook — Plan 4 Phase 1 semester durations. */
export function useSemesterDurations(): SemesterDurations {
  return useAcademicSettings().semesterDurations;
}

/**
 * Decide whether a student meets the graduation policy. Mirrors
 * backend/lib/graduation-policy.js exactly so frontend hints (the transcript
 * "Eligible to graduate" pill) match what an admin enforcement path would
 * decide. Each criterion is reported individually so the UI can show
 * "12 credits short" rather than just true/false.
 */
export interface GraduationCriterion {
  key: 'credits' | 'cgpa' | 'semesters';
  ok: boolean;
  current: number;
  required: number;
  label: string;
}

export interface GraduationEvaluation {
  eligible: boolean;
  criteria: GraduationCriterion[];
}

export function evaluateGraduationEligibility(
  input: { totalCredits?: number; cgpa?: number; mainSemesters?: number },
  policy: GraduationPolicy = DEFAULT_GRADUATION_POLICY,
): GraduationEvaluation {
  const totalCredits  = Number(input.totalCredits)  || 0;
  const cgpa          = Number(input.cgpa)          || 0;
  const mainSemesters = Number(input.mainSemesters) || 0;
  const criteria: GraduationCriterion[] = [
    {
      key: 'credits',
      ok: totalCredits >= policy.minTotalCredits,
      current: totalCredits,
      required: policy.minTotalCredits,
      label: 'Total credit hours',
    },
    {
      key: 'cgpa',
      ok: cgpa >= policy.minCgpa,
      current: cgpa,
      required: policy.minCgpa,
      label: 'Cumulative GPA',
    },
    {
      key: 'semesters',
      ok: mainSemesters >= policy.minMainSemesters,
      current: mainSemesters,
      required: policy.minMainSemesters,
      label: 'Main semesters completed',
    },
  ];
  return { eligible: criteria.every((c) => c.ok), criteria };
}

/** Convenience hook — Plan 4 Phase 3 windows policy. */
export function useWindowsPolicy(): WindowsPolicy {
  return useAcademicSettings().windowsPolicy;
}

/** Convenience hook — Plan 4 Phase 4 incomplete-grade policy. */
export function useIncompletePolicy(): IncompletePolicy {
  return useAcademicSettings().incompletePolicy;
}

/** Convenience hook — Plan 4 Phase 4 repetition policy. */
export function useRepetitionPolicy(): RepetitionPolicy {
  return useAcademicSettings().repetitionPolicy;
}

/** Convenience hook — Plan 4 Phase 5 honors policy. */
export function useHonorsPolicy(): HonorsPolicy {
  return useAcademicSettings().honorsPolicy;
}

/** Convenience hook — Plan 4 Phase 6 suspension/cancellation policy. */
export function useSuspensionPolicy(): SuspensionPolicy {
  return useAcademicSettings().suspensionPolicy;
}

/** Convenience hook — Plan 4 Phase 7 mobility / visiting policy. */
export function useMobilityPolicy(): MobilityPolicy {
  return useAcademicSettings().mobilityPolicy;
}

export function useAdvisorPolicy(): AdvisorPolicy {
  return useAcademicSettings().advisorPolicy;
}

export function useCreditHourDefinition(): CreditHourDefinition {
  return useAcademicSettings().creditHourDefinition;
}

// ─── Window resolver (mirrors backend/lib/registration-windows.js) ──────────

/**
 * Resolve a single named window to concrete `{ start, end, isOpen }` Date
 * objects, anchored to a RegistrationPeriod's startDate. Used by the student
 * Registrations page to show "Withdrawal window open until <date>" and
 * gate the Withdraw button.
 */
export function resolveWindow(
  period: { startDate: string | Date; semester?: string | null; type?: string | null; name?: string | null } | null | undefined,
  policy: WindowsPolicy,
  kind: 'lateRegistration' | 'addDrop' | 'withdrawal',
  today: Date = new Date(),
): { start: Date; end: Date; isOpen: boolean } | null {
  if (!period) return null;
  const isSummer = /(summer)/i.test(`${period.semester ?? ''} ${period.type ?? ''} ${period.name ?? ''}`);
  const range = policy[kind][isSummer ? 'summer' : 'main'];
  const periodStart = new Date(period.startDate);
  const start = new Date(periodStart.getTime() + (range.startWeek - 1) * 7 * 24 * 60 * 60 * 1000);
  const end = new Date(periodStart.getTime() + range.endWeek * 7 * 24 * 60 * 60 * 1000 - 1);
  const t = today.getTime();
  return { start, end, isOpen: t >= start.getTime() && t <= end.getTime() };
}

/** Mirrors backend `getCurrentWindow` — returns the single active window. */
export function getCurrentWindow(
  period: { startDate: string | Date; endDate: string | Date; semester?: string | null; type?: string | null; name?: string | null } | null | undefined,
  policy: WindowsPolicy,
  today: Date = new Date(),
): 'closed' | 'register' | 'late' | 'add_drop' | 'withdrawal' {
  if (!period) return 'closed';
  const t = today.getTime();
  const periodStart = new Date(period.startDate).getTime();
  const periodEnd = new Date(period.endDate).getTime();
  if (t < periodStart || t > periodEnd) return 'closed';
  const late = resolveWindow(period, policy, 'lateRegistration', today);
  const addDrop = resolveWindow(period, policy, 'addDrop', today);
  const withdrawal = resolveWindow(period, policy, 'withdrawal', today);
  if (late?.isOpen) return 'late';
  if (addDrop?.isOpen) return 'add_drop';
  if (withdrawal?.isOpen) return 'withdrawal';
  const earliestStart = Math.min(
    late?.start.getTime() ?? Infinity,
    addDrop?.start.getTime() ?? Infinity,
    withdrawal?.start.getTime() ?? Infinity,
  );
  if (t < earliestStart) return 'register';
  return 'closed';
}
