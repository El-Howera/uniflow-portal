// frontend/src/pages/admin/ReportsPage.tsx
//
// Consolidated student dossier viewer for admin / SA staff. Lets them search
// for any student and pull up a single screen with:
//   • Identity + photo + standing pill
//   • Academic warnings breakdown (consecutive / total counters with bar)
//   • Per-semester GPA table flagged with warning highlights
//   • Attendance overall + per-course
//   • Financial summary
//   • Open SA cases counts
//   • Current registrations
//   • Drill-down links (Edit Profile, Detailed Attendance, Transcript PDF)
//
// Backed by GET /api/admin/reports/students (search) +
// GET /api/admin/reports/student/:id (dossier).

import React, { FC, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney, useCurrency } from '../../utils/format';
import { generateStudentReportPDF, generateTranscriptPDF, StudentReportPdfData } from '../../utils/pdfGenerator';
import { useT } from '../../i18n';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

interface StudentHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  gpa: number | null;
  level: number | null;
  program: string | null;
  academicStanding: 'good' | 'warning' | 'probation' | 'dismissed';
  completedCredits: number;
}

interface SemesterRow {
  semesterId: string;
  semesterCode: string | null;
  semesterName: string | null;
  term: string | null;
  year: number | null;
  gpa: number;
  cumulativeGpa: number;
  credits: number;
  isBelowProbation: boolean;
  isBelowDismissal: boolean;
  createdAt: string;
}

interface PerCourseAtt {
  courseCode: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  total: number;
  attendanceRate: number;
}

interface Dossier {
  user: {
    id: string; firstName: string; lastName: string; email: string;
    picture: string | null; emailVerified: boolean; activated: boolean;
    suspendedAt: string | null;
  };
  academic: {
    studentId: string | null;
    gpa: number; totalCredits: number; completedCredits: number;
    level: number | null; program: string | null; major: string | null;
    academicStanding: 'good' | 'warning' | 'probation' | 'dismissed';
    honorsEligible: 'none' | 'honors' | 'high_honors' | 'disqualified';
  };
  warnings: {
    totalWarnings: number;
    currentConsecutive: number;
    maxConsecutiveEver: number;
    consecutiveDismissalThreshold: number;
    nonConsecutiveDismissalThreshold: number;
    probationFloor: number;
    dismissalFloor: number;
  };
  semesters: SemesterRow[];
  attendance: {
    present: number; late: number; absent: number; excused: number;
    totalSessions: number; overallRate: number;
    perCourse: PerCourseAtt[];
  };
  financial: {
    balance: number; totalPaid: number; totalCharged: number;
    invoiceCount: number;
    lastPaymentAt: string | null;
    lastPaymentAmount: number | null;
    lastPaymentMethod: string | null;
  };
  cases: {
    openComplaints: number;
    openRequests: number;
    openNameChanges: number;
  };
  registrations: Array<{
    courseCode: string | null;
    courseTitle: string | null;
    credits: number | null;
    sectionType: string | null;
    status: string;
  }>;
}

// Style only — labels are resolved at render via useT() so they localize.
const STANDING_CLS: Record<string, string> = {
  good:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warning:   'bg-amber-500/15 text-amber-300 border-amber-500/30',
  probation: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  dismissed: 'bg-red-500/15 text-red-300 border-red-500/30',
};
const standingLabelKey = (s: string) => {
  switch (s) {
    case 'warning': return 'admin.reportsStandingWarning';
    case 'probation': return 'admin.reportsStandingProbation';
    case 'dismissed': return 'admin.reportsStandingDismissed';
    default: return 'admin.reportsStandingGood';
  }
};

// ─── Preview mock data ──────────────────────────────────────────────────────────
// Pure front-end mockup — no backend. A small roster of students + a dossier
// builder so the report screen renders fully for any picked student.
const MOCK_STUDENTS: StudentHit[] = [
  { id: 'usr_2001', firstName: 'Yousef', lastName: 'Mahmoud', email: 'yousef.mahmoud@student.uniflow.edu', gpa: 3.42, level: 3, program: 'Computer Science', academicStanding: 'good', completedCredits: 84 },
  { id: 'usr_2002', firstName: 'Mariam', lastName: 'Hassan', email: 'mariam.hassan@student.uniflow.edu', gpa: 3.78, level: 2, program: 'Data Science', academicStanding: 'good', completedCredits: 52 },
  { id: 'usr_2003', firstName: 'Khaled', lastName: 'Abdullah', email: 'khaled.abdullah@student.uniflow.edu', gpa: 1.92, level: 3, program: 'Computer Science', academicStanding: 'probation', completedCredits: 78 },
  { id: 'usr_2007', firstName: 'Layla', lastName: 'Mostafa', email: 'layla.mostafa@student.uniflow.edu', gpa: 2.31, level: 2, program: 'Data Science', academicStanding: 'warning', completedCredits: 48 },
  { id: 'usr_2010', firstName: 'Aya', lastName: 'Sami', email: 'aya.sami@student.uniflow.edu', gpa: 3.15, level: 4, program: 'Information Systems', academicStanding: 'good', completedCredits: 112 },
  { id: 'usr_2013', firstName: 'Omar', lastName: 'Gamal', email: 'omar.gamal@student.uniflow.edu', gpa: 1.48, level: 1, program: 'Cybersecurity', academicStanding: 'dismissed', completedCredits: 24 },
];

function buildMockDossier(hit: StudentHit): Dossier {
  const probationFloor = 2.0;
  const dismissalFloor = 1.5;
  const belowProbation = hit.gpa != null && hit.gpa < probationFloor;
  const belowDismissal = hit.gpa != null && hit.gpa < dismissalFloor;
  const semesters: SemesterRow[] = [
    { semesterId: 's1', semesterCode: 'F25', semesterName: 'Fall 2025', term: 'Fall', year: 2025, gpa: (hit.gpa ?? 3) + 0.1, cumulativeGpa: (hit.gpa ?? 3) + 0.05, credits: 18, isBelowProbation: false, isBelowDismissal: false, createdAt: '2025-09-01T00:00:00.000Z' },
    { semesterId: 's2', semesterCode: 'SP26', semesterName: 'Spring 2026', term: 'Spring', year: 2026, gpa: hit.gpa ?? 3, cumulativeGpa: hit.gpa ?? 3, credits: 18, isBelowProbation: belowProbation, isBelowDismissal: belowDismissal, createdAt: '2026-02-01T00:00:00.000Z' },
  ];
  return {
    user: {
      id: hit.id, firstName: hit.firstName, lastName: hit.lastName, email: hit.email,
      picture: null, emailVerified: true, activated: true,
      suspendedAt: hit.academicStanding === 'dismissed' ? '2026-03-15T00:00:00.000Z' : null,
    },
    academic: {
      studentId: `OD-2023-${hit.id.slice(-4)}`,
      gpa: hit.gpa ?? 0, totalCredits: 140, completedCredits: hit.completedCredits,
      level: hit.level, program: hit.program, major: hit.program,
      academicStanding: hit.academicStanding,
      honorsEligible: (hit.gpa ?? 0) >= 3.66 ? 'high_honors' : (hit.gpa ?? 0) >= 3.33 ? 'honors' : 'none',
    },
    warnings: {
      totalWarnings: belowProbation ? 2 : 0,
      currentConsecutive: belowProbation ? 1 : 0,
      maxConsecutiveEver: belowProbation ? 2 : 0,
      consecutiveDismissalThreshold: 3,
      nonConsecutiveDismissalThreshold: 4,
      probationFloor,
      dismissalFloor,
    },
    semesters,
    attendance: {
      present: 142, late: 8, absent: 6, excused: 4,
      totalSessions: 160, overallRate: 89,
      perCourse: [
        { courseCode: 'CS305', present: 38, late: 2, absent: 2, excused: 1, total: 43, attendanceRate: 88 },
        { courseCode: 'DS210', present: 40, late: 1, absent: 1, excused: 0, total: 42, attendanceRate: 95 },
        { courseCode: 'IS340', present: 32, late: 3, absent: 2, excused: 2, total: 39, attendanceRate: 82 },
      ],
    },
    financial: {
      balance: hit.academicStanding === 'probation' ? 12500 : 0,
      totalPaid: 84000, totalCharged: 96500,
      invoiceCount: 4,
      lastPaymentAt: '2026-02-14T10:24:00.000Z',
      lastPaymentAmount: 30000,
      lastPaymentMethod: 'credit_card',
    },
    cases: {
      openComplaints: hit.academicStanding === 'warning' ? 1 : 0,
      openRequests: 1,
      openNameChanges: 0,
    },
    registrations: [
      { courseCode: 'CS305', courseTitle: 'Operating Systems', credits: 3, sectionType: 'Lecture', status: 'approved' },
      { courseCode: 'DS210', courseTitle: 'Statistical Inference', credits: 3, sectionType: 'Lecture', status: 'approved' },
      { courseCode: 'IS340', courseTitle: 'Database Systems', credits: 3, sectionType: 'Lecture', status: 'pending' },
    ],
  };
}

// ─── Student picker — debounced search ──────────────────────────────────────
const StudentSearch: FC<{
  selectedId: string | null;
  onSelect: (s: StudentHit) => void;
  scope: 'admin' | 'sa';
}> = ({ selectedId, onSelect }) => {
  const t = useT();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim().toLowerCase();
    const tm = setTimeout(() => {
      setLoading(true);
      // Preview: filter the static roster client-side, no backend.
      const filtered = trimmed
        ? MOCK_STUDENTS.filter(
            (s) =>
              `${s.firstName} ${s.lastName}`.toLowerCase().includes(trimmed) ||
              s.email.toLowerCase().includes(trimmed) ||
              (s.program ?? '').toLowerCase().includes(trimmed),
          )
        : MOCK_STUDENTS;
      setHits(filtered);
      setLoading(false);
    }, 300);
    return () => clearTimeout(tm);
  }, [query]);

  return (
    <div className={`${glassCardStyle} p-5`}>
      <h2 className="text-base font-bold text-black dark:text-white mb-1">{t('admin.reportsFindStudent')}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('admin.reportsFindStudentHint')}
      </p>
      <div className="relative mb-3">
        <i className="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.reportsSearchPh')}
          className="w-full bg-white/5 dark:bg-black/10 border border-white/10 dark:border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm text-black dark:text-white placeholder-gray-500 focus:outline-none focus:border-[#6A3FF4] backdrop-filter backdrop-blur-xl"
        />
      </div>
      {error && (
        <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <i className="ph-bold ph-warning-circle mr-2"></i>{error}
        </div>
      )}
      {loading && (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
          <i className="ph-bold ph-circle-notch animate-spin mr-2"></i>{t('admin.reportsLoading')}
        </div>
      )}
      {!loading && hits.length === 0 && !error && (
        <div className="text-xs text-gray-500 dark:text-gray-400 py-2">
          {query.trim() ? t('admin.reportsNoMatch') : t('admin.reportsNoStudents')}
        </div>
      )}
      {hits.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 dark:border-white/5 divide-y divide-white/5">
          {hits.map((s) => {
            const isSelected = s.id === selectedId;
            const cls = STANDING_CLS[s.academicStanding] ?? STANDING_CLS.good;
            const label = t(standingLabelKey(s.academicStanding));
            return (
              <button
                key={s.id}
                onClick={() => onSelect(s)}
                className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-3 ${
                  isSelected ? 'bg-[#6A3FF4]/15' : 'hover:bg-white/5'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-black dark:text-white truncate">{s.firstName} {s.lastName}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {s.email}{s.gpa != null && ` · GPA ${s.gpa.toFixed(2)}`}{s.level != null && ` · L${s.level}`}
                  </div>
                </div>
                <span className={`text-[9px] uppercase tracking-wide font-bold border rounded px-2 py-0.5 flex-shrink-0 ${cls}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Dossier render helpers ────────────────────────────────────────────────
const StatTile: FC<{ label: string; value: React.ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'success'; sub?: string }> = ({ label, value, tone = 'neutral', sub }) => {
  const cls = tone === 'danger' ? 'border-red-500/30 bg-red-500/10' :
              tone === 'warning' ? 'border-amber-500/30 bg-amber-500/10' :
              tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10' :
              'border-white/10 dark:border-white/5 bg-white/5 dark:bg-black/10';
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-black dark:text-white">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{sub}</div>}
    </div>
  );
};

// ─── Dossier ────────────────────────────────────────────────────────────────
const StudentDossier: FC<{ id: string; scope: 'admin' | 'sa' }> = ({ id, scope }) => {
  const t = useT();
  const navigate = useNavigate();
  const currency = useCurrency();
  const [data, setData] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    // Preview: build the dossier from the static roster, no backend. Falls back to
    // the first student when the id isn't in the roster.
    const hit = MOCK_STUDENTS.find((s) => s.id === id) ?? MOCK_STUDENTS[0];
    setData(buildMockDossier({ ...hit, id }));
    setLoading(false);
  }, [id]);

  if (loading) {
    return (
      <div className={`${glassCardStyle} p-5 text-sm text-gray-500 dark:text-gray-400`}>
        <i className="ph-bold ph-circle-notch animate-spin mr-2"></i>{t('admin.reportsLoadingDossier')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <i className="ph-bold ph-warning-circle mr-2"></i>{error}
      </div>
    );
  }
  if (!data) return null;

  const standingCls = STANDING_CLS[data.academic.academicStanding] ?? STANDING_CLS.good;
  const standingLabel = t(standingLabelKey(data.academic.academicStanding));
  const honorsLabel: Record<string, string> = {
    none: t('admin.reportsHonorsNone'),
    honors: t('admin.reportsHonorsHonors'),
    high_honors: t('admin.reportsHonorsHigh'),
    disqualified: t('admin.reportsHonorsDisqualified'),
  };
  const w = data.warnings;
  const consecutivePct = Math.min(100, Math.round((w.currentConsecutive / Math.max(1, w.consecutiveDismissalThreshold)) * 100));
  const totalPct = Math.min(100, Math.round((w.totalWarnings / Math.max(1, w.nonConsecutiveDismissalThreshold)) * 100));

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className={`${glassCardStyle} p-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
              {data.user.firstName.charAt(0)}{data.user.lastName.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-black dark:text-white">{data.user.firstName} {data.user.lastName}</h2>
                <span className={`text-[10px] uppercase tracking-wide font-bold border rounded px-2 py-0.5 ${standingCls}`}>{standingLabel}</span>
                {data.academic.honorsEligible !== 'none' && (
                  <span className="text-[10px] uppercase tracking-wide font-bold border rounded px-2 py-0.5 bg-[#6A3FF4]/15 text-[#7B5AFF] border-[#6A3FF4]/30">
                    {honorsLabel[data.academic.honorsEligible]}
                  </span>
                )}
                {data.user.suspendedAt && (
                  <span className="text-[10px] uppercase tracking-wide font-bold border rounded px-2 py-0.5 bg-red-500/15 text-red-300 border-red-500/30">{t('admin.reportsSuspended')}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                {data.user.email}{data.academic.studentId && ` · ${t('admin.reportsIdLabel', { id: data.academic.studentId })}`}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {data.academic.program ?? t('admin.reportsNoProgram')}{data.academic.level != null && ` · ${t('admin.reportsLevelN', { n: data.academic.level })}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => navigate(`/${scope}/students/${data.user.id}`)}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-black dark:text-white"
              title={t('admin.reportsBtnEditProfileTitle')}
            >
              <i className="ph-bold ph-pencil mr-1"></i>{t('admin.reportsBtnEditProfile')}
            </button>
            <button
              onClick={() => navigate(`/${scope}/students/${data.user.id}/attendance`)}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-black dark:text-white"
              title={t('admin.reportsBtnAttendanceTitle')}
            >
              <i className="ph-bold ph-calendar-check mr-1"></i>{t('admin.reportsBtnAttendance')}
            </button>
            <button
              onClick={() => {
                // Preview: build the report PDF directly from the loaded mock
                // dossier — no fetch.
                const pdfData: StudentReportPdfData = {
                  user: {
                    id: data.user.id, firstName: data.user.firstName, lastName: data.user.lastName,
                    email: data.user.email, suspendedAt: data.user.suspendedAt,
                  },
                  academic: data.academic,
                  warnings: data.warnings,
                  semesters: data.semesters.map((s) => ({
                    semesterCode: s.semesterCode, semesterName: s.semesterName, year: s.year,
                    gpa: s.gpa, cumulativeGpa: s.cumulativeGpa, credits: s.credits,
                    isBelowProbation: s.isBelowProbation, isBelowDismissal: s.isBelowDismissal,
                  })),
                  attendance: data.attendance,
                  financial: data.financial,
                  cases: data.cases,
                  registrations: data.registrations,
                  currency,
                };
                generateStudentReportPDF(pdfData);
              }}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-black dark:text-white"
              title={t('admin.reportsBtnPrintReportTitle')}
            >
              <i className="ph-bold ph-printer mr-1"></i>{t('admin.reportsBtnPrintReport')}
            </button>
            <button
              onClick={() => {
                // Preview: build the transcript PDF directly from mock data — no fetch.
                generateTranscriptPDF({
                  student: {
                    name: `${data.user.firstName} ${data.user.lastName}`,
                    studentId: data.academic.studentId ?? data.user.id,
                    major: data.academic.major ?? 'Undeclared',
                    email: data.user.email,
                    enrollmentDate: '2023-09-01',
                    expectedGraduation: '2027-06-30',
                  },
                  courses: data.registrations.map((r) => ({
                    code: r.courseCode ?? '—',
                    name: r.courseTitle ?? '—',
                    credits: r.credits ?? 0,
                    grade: 'IP',
                    semester: 'Spring 2026',
                  })),
                  cumulativeGPA: data.academic.gpa,
                  totalCredits: data.academic.totalCredits,
                  totalEarned: data.academic.completedCredits,
                });
              }}
              className="px-3 py-2 rounded-xl bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-xs font-bold hover:opacity-90"
              title={t('admin.reportsBtnTranscriptTitle')}
            >
              <i className="ph-bold ph-download mr-1"></i>{t('admin.reportsBtnTranscriptPdf')}
            </button>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label={t('admin.reportsTileGPA')} value={data.academic.gpa.toFixed(2)} sub={t('admin.reportsTileGPASub', { done: data.academic.completedCredits, total: data.academic.totalCredits })} tone={data.academic.gpa < w.probationFloor ? 'warning' : 'success'} />
        <StatTile label={t('admin.reportsTileAttendance')} value={`${data.attendance.overallRate}%`} sub={t('admin.reportsTileAttendanceSub', { n: data.attendance.totalSessions })} tone={data.attendance.overallRate < 75 ? 'warning' : 'success'} />
        <StatTile label={t('admin.reportsTileOutstanding')} value={formatMoney(data.financial.balance, { code: currency })} sub={t('admin.reportsTileOutstandingSub', { n: data.financial.invoiceCount, paid: formatMoney(data.financial.totalPaid, { code: currency }) })} tone={data.financial.balance > 0 ? 'warning' : 'neutral'} />
        <StatTile label={t('admin.reportsTileOpenCases')} value={data.cases.openComplaints + data.cases.openRequests + data.cases.openNameChanges} sub={t('admin.reportsTileOpenCasesSub', { c: data.cases.openComplaints, r: data.cases.openRequests, nc: data.cases.openNameChanges })} tone={(data.cases.openComplaints + data.cases.openRequests + data.cases.openNameChanges) > 0 ? 'warning' : 'neutral'} />
      </div>

      {/* Academic warnings — counters + per-semester table */}
      <div className={`${glassCardStyle} p-5`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <i className="ph-bold ph-warning text-xl text-amber-400"></i>
            <h3 className="font-bold text-black dark:text-white">{t('admin.reportsAcademicWarnings')}</h3>
          </div>
          {scope === 'admin' && (
            <button
              onClick={() => navigate('/admin/academic/academic-standing')}
              className="text-xs font-bold text-[#7B5AFF] hover:underline"
              title={t('admin.reportsEditThresholdsTitle')}
            >
              <i className="ph-bold ph-sliders-horizontal mr-1"></i>{t('admin.reportsEditThresholds')}
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-4">
          {t('admin.reportsWarningsBody')}
          <strong>{w.probationFloor.toFixed(2)}</strong>{t('admin.reportsWarningsBody2', { consec: w.consecutiveDismissalThreshold, nonConsec: w.nonConsecutiveDismissalThreshold })}
          <strong>{w.dismissalFloor.toFixed(2)}</strong>{t('admin.reportsWarningsBody3')}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[10px] uppercase tracking-wide font-bold text-gray-500">{t('admin.reportsConsecLabel')}</span>
              <span className="text-xs text-gray-400">{w.currentConsecutive} / {w.consecutiveDismissalThreshold}</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full transition-all ${consecutivePct >= 100 ? 'bg-red-500' : consecutivePct >= 66 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${consecutivePct}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{t('admin.reportsMaxEver', { n: w.maxConsecutiveEver })}</p>
          </div>
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[10px] uppercase tracking-wide font-bold text-gray-500">{t('admin.reportsTotalLabel')}</span>
              <span className="text-xs text-gray-400">{w.totalWarnings} / {w.nonConsecutiveDismissalThreshold}</span>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className={`h-full transition-all ${totalPct >= 100 ? 'bg-red-500' : totalPct >= 66 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${totalPct}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{t('admin.reportsAnyOrder')}</p>
          </div>
        </div>

        {data.semesters.length === 0 ? (
          <p className="text-xs text-gray-500 italic">{t('admin.reportsNoSemesters')}</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-white/10">
                  <th className="text-left font-bold pb-2 pr-3">{t('admin.reportsColSemester')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColGPA')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColCumulative')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColCredits')}</th>
                  <th className="text-left font-bold pb-2 px-2">{t('admin.reportsColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {data.semesters.map((s) => (
                  <tr key={s.semesterId} className={`border-t border-white/5 ${s.isBelowProbation ? 'bg-amber-500/5' : ''}`}>
                    <td className="py-2 pr-3 text-sm text-black dark:text-white">
                      {s.semesterName ?? s.semesterCode ?? '—'}
                      {s.term && s.year && <span className="text-[10px] text-gray-500 ml-2">{s.term} {s.year}</span>}
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-sm text-black dark:text-white">{s.gpa.toFixed(2)}</td>
                    <td className="py-2 px-2 text-center font-mono text-sm text-black dark:text-white">{s.cumulativeGpa.toFixed(2)}</td>
                    <td className="py-2 px-2 text-center text-sm text-gray-400">{s.credits}</td>
                    <td className="py-2 px-2">
                      {s.isBelowDismissal ? (
                        <span className="text-[9px] uppercase font-bold border rounded px-1.5 py-0.5 bg-red-500/15 text-red-300 border-red-500/30">{t('admin.reportsBadgeDismissLow')}</span>
                      ) : s.isBelowProbation ? (
                        <span className="text-[9px] uppercase font-bold border rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-300 border-amber-500/30">{t('admin.reportsBadgeWarning')}</span>
                      ) : (
                        <span className="text-[9px] uppercase font-bold border rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 border-emerald-500/30">{t('admin.reportsBadgeOK')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Attendance breakdown */}
      <div className={`${glassCardStyle} p-5`}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <i className="ph-bold ph-calendar-check text-xl text-[#7B5AFF]"></i>
            <h3 className="font-bold text-black dark:text-white">{t('admin.reportsAttendance')}</h3>
          </div>
          <button
            onClick={() => navigate(`/${scope}/students/${data.user.id}/attendance`)}
            className="text-xs font-bold text-[#7B5AFF] hover:underline"
          >
            {t('admin.reportsViewDetailedRecords')}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatTile label={t('admin.reportsTilePresent')} value={data.attendance.present} sub={`${data.attendance.totalSessions ? Math.round((data.attendance.present / data.attendance.totalSessions) * 100) : 0}%`} tone="success" />
          <StatTile label={t('admin.reportsTileLate')} value={data.attendance.late} sub={`${data.attendance.totalSessions ? Math.round((data.attendance.late / data.attendance.totalSessions) * 100) : 0}%`} tone="warning" />
          <StatTile label={t('admin.reportsTileAbsent')} value={data.attendance.absent} sub={`${data.attendance.totalSessions ? Math.round((data.attendance.absent / data.attendance.totalSessions) * 100) : 0}%`} tone={data.attendance.absent > data.attendance.present ? 'danger' : 'neutral'} />
          <StatTile label={t('admin.reportsTileExcused')} value={data.attendance.excused} sub={`${data.attendance.totalSessions ? Math.round((data.attendance.excused / data.attendance.totalSessions) * 100) : 0}%`} tone="neutral" />
        </div>
        {data.attendance.perCourse.length > 0 ? (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-white/10">
                  <th className="text-left font-bold pb-2 pr-3">{t('admin.reportsColCourse')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColRate')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColPLAE')}</th>
                  <th className="text-center font-bold pb-2 px-2">{t('admin.reportsColTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {data.attendance.perCourse.map((c) => (
                  <tr key={c.courseCode} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-sm text-black dark:text-white">{c.courseCode}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`text-[11px] font-bold ${c.attendanceRate >= 75 ? 'text-emerald-300' : c.attendanceRate >= 50 ? 'text-amber-300' : 'text-red-300'}`}>
                        {c.attendanceRate}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center text-xs text-gray-400 font-mono">{c.present} / {c.late} / {c.absent} / {c.excused}</td>
                    <td className="py-2 px-2 text-center text-xs text-gray-400">{c.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic">{t('admin.reportsNoAttendance')}</p>
        )}
      </div>

      {/* Financial summary */}
      <div className={`${glassCardStyle} p-5`}>
        <div className="flex items-center gap-2 mb-3">
          <i className="ph-bold ph-currency-circle-dollar text-xl text-emerald-400"></i>
          <h3 className="font-bold text-black dark:text-white">{t('admin.reportsFinancialSummary')}</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatTile label={t('admin.reportsTileOutstandingOnly')} value={formatMoney(data.financial.balance, { code: currency })} tone={data.financial.balance > 0 ? 'warning' : 'success'} />
          <StatTile label={t('admin.reportsTileTotalPaid')} value={formatMoney(data.financial.totalPaid, { code: currency })} sub={data.financial.invoiceCount === 1 ? t('admin.reportsInvoiceOne', { n: data.financial.invoiceCount }) : t('admin.reportsInvoiceMany', { n: data.financial.invoiceCount })} tone="neutral" />
          <StatTile
            label={t('admin.reportsTileLastPayment')}
            value={data.financial.lastPaymentAt ? new Date(data.financial.lastPaymentAt).toLocaleDateString() : '—'}
            sub={data.financial.lastPaymentAmount != null ? `${formatMoney(data.financial.lastPaymentAmount, { code: currency })}${data.financial.lastPaymentMethod ? ` · ${data.financial.lastPaymentMethod}` : ''}` : t('admin.reportsNoPayments')}
            tone="neutral"
          />
        </div>
      </div>

      {/* Current registrations + cases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className={`${glassCardStyle} p-5`}>
          <h3 className="font-bold text-black dark:text-white mb-3 flex items-center gap-2">
            <i className="ph-bold ph-books text-xl text-[#7B5AFF]"></i>
            {t('admin.reportsCurrentRegistrations')}
          </h3>
          {data.registrations.length === 0 ? (
            <p className="text-xs text-gray-500 italic">{t('admin.reportsNoActiveRegs')}</p>
          ) : (
            <ul className="text-sm divide-y divide-white/5">
              {data.registrations.map((r, i) => (
                <li key={i} className="py-2 flex justify-between items-center">
                  <div>
                    <div className="text-black dark:text-white">{r.courseCode}</div>
                    <div className="text-[11px] text-gray-500">{r.courseTitle}{r.credits != null && ` · ${t('admin.reportsCredits', { n: r.credits })}`}{r.sectionType && ` · ${r.sectionType}`}</div>
                  </div>
                  <span className={`text-[9px] uppercase tracking-wide font-bold border rounded px-2 py-0.5 ${r.status === 'pending' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}`}>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`${glassCardStyle} p-5`}>
          <h3 className="font-bold text-black dark:text-white mb-3 flex items-center gap-2">
            <i className="ph-bold ph-folder-notch text-xl text-[#7B5AFF]"></i>
            {t('admin.reportsOpenCases')}
          </h3>
          <ul className="text-sm divide-y divide-white/5">
            <li className="py-2 flex justify-between items-center">
              <span className="text-black dark:text-white">{t('admin.reportsCaseComplaints')}</span>
              <span className={`text-sm font-bold ${data.cases.openComplaints > 0 ? 'text-amber-300' : 'text-gray-400'}`}>{data.cases.openComplaints}</span>
            </li>
            <li className="py-2 flex justify-between items-center">
              <span className="text-black dark:text-white">{t('admin.reportsCaseRequests')}</span>
              <span className={`text-sm font-bold ${data.cases.openRequests > 0 ? 'text-amber-300' : 'text-gray-400'}`}>{data.cases.openRequests}</span>
            </li>
            <li className="py-2 flex justify-between items-center">
              <span className="text-black dark:text-white">{t('admin.reportsCaseNameChanges')}</span>
              <span className={`text-sm font-bold ${data.cases.openNameChanges > 0 ? 'text-amber-300' : 'text-gray-400'}`}>{data.cases.openNameChanges}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// ─── Top-level page ─────────────────────────────────────────────────────────
interface ReportsPageProps {
  /** Scope decides whether drill-down buttons target /admin/* or /sa/* paths. */
  scope?: 'admin' | 'sa';
}

const ReportsPage: FC<ReportsPageProps> = ({ scope = 'admin' }) => {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="pb-16 space-y-6 px-2 sm:px-0">
      <div>
        <h1 className="text-xl sm:text-3xl font-bold text-black dark:text-white flex items-center gap-3">
          <i className="ph-bold ph-file-text text-[#6A3FF4]"></i>
          {t('admin.reportsTitle')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 max-w-3xl">{t('admin.reportsPageSubtitle')}</p>
      </div>
      <StudentSearch
        selectedId={selectedId}
        onSelect={(s) => setSelectedId(s.id)}
        scope={scope}
      />
      {selectedId ? (
        <StudentDossier id={selectedId} scope={scope} />
      ) : (
        <div className={`${glassCardStyle} p-8 text-center text-sm text-gray-500 dark:text-gray-400`}>
          <i className="ph-bold ph-magnifying-glass-plus text-3xl text-[#6A3FF4]/60 mb-2 block" />
          {t('admin.reportsEmptyHint')}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
