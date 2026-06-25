// ============================================================================
// UniFlow Seed — fresh, realistic, multi-tenant
// ============================================================================
//
// Replaces the previous 3,200-line random seed. This one is small, coherent,
// and deterministic:
//
//   - 1 primary tenant (fcds) + 1 demo tenant (proves isolation)
//   - 29 users total in fcds: 1 admin + 3 of every other role + 10 students
//   - 8 realistic FCDS courses, 5 active in Fall 2026 with full sections
//   - 5 assignments + 5 quizzes per active course
//   - 2 past semesters of transcript data with grade breakdowns
//   - Each student has a "performance tier" so past grades, current
//     submissions, and GPA all line up (no Strong-student with C transcripts)
//
// Idempotent — re-runs upsert by stable keys. No Math.random anywhere; every
// scoring decision is a deterministic function of (student index, course
// index, weight). Run with: `node backend/scripts/seed.js`.
//
// Multi-tenant note: every Prisma call inside `runWithTenant(tenant.id, ...)`
// is auto-tagged with tenant_id by the Prisma Client Extension at
// backend/lib/prisma.js. The single exception is the initial Tenant.upsert
// itself, which uses `bootstrapPrisma` (the raw client) and is gated by
// `process.env.UNIFLOW_BOOTSTRAP = '1'`.
// ============================================================================

// Load .env BEFORE the override, so DIRECT_URL is available when we rewrite
// DATABASE_URL. Force the seed to bypass PgBouncer (port 6432) and connect
// directly to Postgres via DIRECT_URL (port 5432). The seed is a one-shot
// bulk write — it doesn't need pooling, and going through PgBouncer just
// adds a flaky dependency on Docker Desktop being up.
require('dotenv').config({ quiet: true });
if (process.env.DIRECT_URL && process.env.DIRECT_URL !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { bootstrapPrisma } = require('../lib/prisma');
const { runWithTenant } = require('../lib/tenant-context');

const HASH = bcrypt.hashSync('Password123!', 10);

// ----------------------------------------------------------------------------
// Static reference data
// ----------------------------------------------------------------------------

// Departments map to FCDS programs (codes 01–06). Names + program affiliations
// come from backend/corpus/regulations_en.jsonl Article 32 + program metadata.
// Article 2 lists two physical departments (Computing and Information Systems,
// Data Sciences and Analytics); the schema's Department table holds program
// rows after the Plan 4 Phase 2 merge, so each program is one department.
const FCDS_DEPARTMENTS = [
  { code: '01', name: 'Computing and Data Sciences',          shortName: 'CDS' },
  { code: '02', name: 'Business Analytics',                   shortName: 'BA'  },
  { code: '03', name: 'Intelligent Systems',                  shortName: 'IS'  },
  { code: '04', name: 'Healthcare Informatics and Data Analytics', shortName: 'HIDA' },
  { code: '05', name: 'Media Analytics',                      shortName: 'MA'  },
  { code: '06', name: 'Cybersecurity',                        shortName: 'CYB' },
];

// 8 real FCDS courses pulled from the corpus (Article 4 coding system:
// 02-24-PPPLL — university-24-program-level). All belong to Program 01
// (Computing and Data Sciences) Levels 1-2. 5 are active in Fall 2026; the
// other 3 appear only in past-semester transcript history.
const COURSE_CATALOG = [
  // ----- Active Fall 2026 -----
  { code: '02-24-00101', title: 'Linear Algebra',                     credits: 3, level: 1, deptCode: '01', semester: 'Fall',   activeFall26: true,  category: 'faculty_compulsory' },
  { code: '02-24-00105', title: 'Programming I',                      credits: 3, level: 1, deptCode: '01', semester: 'Fall',   activeFall26: true,  category: 'faculty_compulsory' },
  { code: '02-24-00108', title: 'Data Structures and Algorithms',     credits: 3, level: 1, deptCode: '01', semester: 'Fall',   activeFall26: true,  category: 'faculty_compulsory' },
  { code: '02-24-00109', title: 'Introduction to Artificial Intelligence', credits: 3, level: 1, deptCode: '01', semester: 'Fall', activeFall26: true, category: 'program_compulsory' },
  { code: '02-24-00202', title: 'Introduction to Databases',          credits: 3, level: 2, deptCode: '01', semester: 'Fall',   activeFall26: true,  category: 'faculty_compulsory' },
  // ----- Past-only (transcript history) -----
  { code: '02-24-00102', title: 'Calculus',                           credits: 3, level: 1, deptCode: '01', semester: 'Fall',   activeFall26: false, category: 'faculty_compulsory' },
  { code: '02-24-00106', title: 'Probability and Statistics I',       credits: 3, level: 1, deptCode: '01', semester: 'Spring', activeFall26: false, category: 'faculty_compulsory' },
  { code: '02-24-00205', title: 'Machine Learning',                   credits: 3, level: 2, deptCode: '01', semester: 'Spring', activeFall26: false, category: 'program_compulsory' },
];

// Prereqs from corpus study plans: 00108 (DSA) needs 00105 (Programming I);
// 00202 (Databases) needs 00105; 00205 (ML) needs 00109 (Intro to AI).
const COURSE_PREREQS = [
  { code: '02-24-00108', prereq: '02-24-00105', minGrade: 'C' },
  { code: '02-24-00202', prereq: '02-24-00105', minGrade: 'C' },
  { code: '02-24-00205', prereq: '02-24-00109', minGrade: 'C' },
];

// FCDS GPA scale (11-letter; no A+; D+ supported). Quality points per credit.
const GRADE_SCALE = [
  { letter: 'A',  qp: 4.0, minPct: 90 },
  { letter: 'A-', qp: 3.7, minPct: 87 },
  { letter: 'B+', qp: 3.3, minPct: 83 },
  { letter: 'B',  qp: 3.0, minPct: 80 },
  { letter: 'B-', qp: 2.7, minPct: 77 },
  { letter: 'C+', qp: 2.3, minPct: 73 },
  { letter: 'C',  qp: 2.0, minPct: 70 },
  { letter: 'C-', qp: 1.7, minPct: 67 },
  { letter: 'D+', qp: 1.3, minPct: 63 },
  { letter: 'D',  qp: 1.0, minPct: 60 },
  { letter: 'F',  qp: 0.0, minPct: 0  },
];

function pctToLetter(pct) {
  for (const row of GRADE_SCALE) if (pct >= row.minPct) return row;
  return GRADE_SCALE[GRADE_SCALE.length - 1];
}

// Performance tiers — used to keep transcripts coherent with current grades.
const TIERS = {
  strong:     { gpaTarget: 3.8, basePct: 92, swing: 4 },
  average:    { gpaTarget: 3.1, basePct: 78, swing: 6 },
  struggling: { gpaTarget: 2.4, basePct: 67, swing: 7 },
};

// 10 students. 9 are seeded with the canonical student1@..student9@uniflow.test
// emails; #10 is the owner (Elfares Howera, elhowera@gmail.com) seeded as a
// regular student. Level + tier mix is preserved from the previous design so
// transcripts stay coherent (Strong → A/B+, Average → B/C+, Struggling → C/D).
const STUDENT_DEFS = [
  { email: 'student1@uniflow.test',  odId: 'S001', firstName: 'Yara',    lastName: 'Mohamed',  deptCode: '01', level: 3, tier: 'strong'     },
  { email: 'student2@uniflow.test',  odId: 'S002', firstName: 'Khaled',  lastName: 'Hassan',   deptCode: '02', level: 3, tier: 'strong'     },
  { email: 'student3@uniflow.test',  odId: 'S003', firstName: 'Salma',   lastName: 'Ibrahim',  deptCode: '06', level: 3, tier: 'strong'     },
  { email: 'student4@uniflow.test',  odId: 'S004', firstName: 'Ahmed',   lastName: 'Saleh',    deptCode: '01', level: 2, tier: 'average'    },
  { email: 'student5@uniflow.test',  odId: 'S005', firstName: 'Nada',    lastName: 'Farouk',   deptCode: '03', level: 2, tier: 'average'    },
  { email: 'student6@uniflow.test',  odId: 'S006', firstName: 'Omar',    lastName: 'El-Sayed', deptCode: '01', level: 2, tier: 'average'    },
  { email: 'student7@uniflow.test',  odId: 'S007', firstName: 'Habiba',  lastName: 'Adel',     deptCode: '02', level: 2, tier: 'average'    },
  { email: 'student8@uniflow.test',  odId: 'S008', firstName: 'Youssef', lastName: 'Magdy',    deptCode: '06', level: 2, tier: 'average'    },
  { email: 'student9@uniflow.test',  odId: 'S009', firstName: 'Mariam',  lastName: 'Tarek',    deptCode: '01', level: 1, tier: 'struggling' },
  { email: 'elhowera@gmail.com',     odId: 'ELF001', firstName: 'Elfares', lastName: 'Howera', deptCode: '01', level: 3, tier: 'average'    },
];

const PROFESSOR_DEFS = [
  { odId: 'P001', firstName: 'Mona',     lastName: 'Aly',         email: 'prof1@uniflow.test', deptCode: '01' },
  { odId: 'P002', firstName: 'Hossam',   lastName: 'El-Din',      email: 'prof2@uniflow.test', deptCode: '02' },
  { odId: 'P003', firstName: 'Layla',    lastName: 'Shawky',      email: 'prof3@uniflow.test', deptCode: '06' },
];

const TA_DEFS = [
  { odId: 'T001', firstName: 'Sara',     lastName: 'Naguib',      email: 'ta1@uniflow.test'  },
  { odId: 'T002', firstName: 'Mohamed',  lastName: 'Refaat',      email: 'ta2@uniflow.test' },
  { odId: 'T003', firstName: 'Heba',     lastName: 'Zaki',        email: 'ta3@uniflow.test' },
];

const SA_DEFS = [
  { odId: 'A001', firstName: 'Rania',    lastName: 'Kamal',       email: 'sa1@uniflow.test' },
  { odId: 'A002', firstName: 'Tamer',    lastName: 'Fathy',       email: 'sa2@uniflow.test' },
  { odId: 'A003', firstName: 'Dina',     lastName: 'Sherif',      email: 'sa3@uniflow.test' },
];

const FINANCIAL_DEFS = [
  { odId: 'F001', firstName: 'Hany',     lastName: 'Naim',        email: 'fin1@uniflow.test' },
  { odId: 'F002', firstName: 'Reem',     lastName: 'El-Sheikh',   email: 'fin2@uniflow.test' },
  { odId: 'F003', firstName: 'Bassem',   lastName: 'Roushdy',     email: 'fin3@uniflow.test' },
];

const IT_DEFS = [
  { odId: 'I001', firstName: 'Maged',    lastName: 'Helmy',       email: 'it1@uniflow.test' },
  { odId: 'I002', firstName: 'Asmaa',    lastName: 'Wagdy',       email: 'it2@uniflow.test' },
  { odId: 'I003', firstName: 'Kareem',   lastName: 'Nabil',       email: 'it3@uniflow.test' },
];

// Plan 22: SUPERUSER_DEFS removed — the `superuser` admin sub-role was
// deleted in 20260526000000_drop_superuser_role. Pre-existing superuser
// users are listed in ORPHANED_EMAILS so re-running the seed purges them.

// Course codes from prior seed runs that no longer belong. Deleted (with all
// dependent sections / registrations / assignments etc.) before course creation
// so re-running the seed converges on the corpus-based codes cleanly.
const ORPHANED_COURSE_CODES = [
  'CS101', 'CS102', 'CS201', 'CS202', 'AI301', 'IS201', 'SWE301', 'MA101',
];

// Users from prior seed runs that no longer belong. Deleted before user
// creation so re-running the seed cleans up obsolete rows. Add new entries
// here when removing a role from the DEFS arrays so the DB stays in sync.
const ORPHANED_EMAILS = [
  // Plan 22: superuser role removed entirely — purge the seeded superuser.
  'super@uniflow.test',
  // Previous superusers from Plan 5 era
  'aya.mansour@uniflow.test',
  'ziad.gamal@uniflow.test',
  // Old staff emails replaced by the new <role><n>@uniflow.test convention
  'sherif.mostafa@uniflow.test',
  'mona.aly@uniflow.test',
  'hossam.eldin@uniflow.test',
  'layla.shawky@uniflow.test',
  'sara.naguib@uniflow.test',
  'mohamed.refaat@uniflow.test',
  'heba.zaki@uniflow.test',
  'rania.kamal@uniflow.test',
  'tamer.fathy@uniflow.test',
  'dina.sherif@uniflow.test',
  'hany.naim@uniflow.test',
  'reem.elsheikh@uniflow.test',
  'bassem.roushdy@uniflow.test',
  'maged.helmy@uniflow.test',
  'asmaa.wagdy@uniflow.test',
  'kareem.nabil@uniflow.test',
  // Old auto-generated student emails replaced by student1-9@uniflow.test
  'yara.mohamed@student.uniflow.test',
  'khaled.hassan@student.uniflow.test',
  'salma.ibrahim@student.uniflow.test',
  'ahmed.saleh@student.uniflow.test',
  'nada.farouk@student.uniflow.test',
  'omar.elsayed@student.uniflow.test',
  'habiba.adel@student.uniflow.test',
  'youssef.magdy@student.uniflow.test',
  'mariam.tarek@student.uniflow.test',
  'karim.hosny@student.uniflow.test',
];

// Days of week the FCDS schedule actually runs on. Keyed by course code from
// the corpus (02-24-XXXXX format).
const SLOT_PATTERNS = {
  '02-24-00101': [{ day: 'Sunday',   start: '09:00', end: '10:30' }, { day: 'Tuesday',   start: '09:00', end: '10:30' }],
  '02-24-00105': [{ day: 'Monday',   start: '11:00', end: '12:30' }, { day: 'Wednesday', start: '11:00', end: '12:30' }],
  '02-24-00108': [{ day: 'Sunday',   start: '13:00', end: '14:30' }, { day: 'Tuesday',   start: '13:00', end: '14:30' }],
  '02-24-00109': [{ day: 'Monday',   start: '09:00', end: '10:30' }, { day: 'Wednesday', start: '09:00', end: '10:30' }],
  '02-24-00202': [{ day: 'Thursday', start: '10:00', end: '13:00' }],
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function log(s) { console.log(s); }

// Stable per-(student, course) score in [base-swing, base+swing]. Deterministic.
function tieredScore(studentIdx, courseIdx, tier) {
  const t = TIERS[tier];
  // Hash-ish but pure: cycle through swing*2+1 values based on indices
  const cycle = ((studentIdx * 7 + courseIdx * 11) % (t.swing * 2 + 1)) - t.swing;
  return Math.max(0, Math.min(100, t.basePct + cycle));
}

// Each student's transcript history — past courses with grades aligned to
// their tier. Course titles and credits pulled from the FCDS corpus.
function buildTranscriptHistory(student) {
  // Level 3 students have 2 past semesters (Fall 2025 + Spring 2026)
  // Level 2 students have 1 past semester (Spring 2026)
  // Level 1 students have nothing
  const courses = [];
  if (student.level >= 2) {
    courses.push(
      { semesterCode: 'SP2026', code: '02-24-00102', title: 'Calculus',                     credits: 3 },
      { semesterCode: 'SP2026', code: '02-24-00106', title: 'Probability and Statistics I', credits: 3 },
      { semesterCode: 'SP2026', code: '02-24-00205', title: 'Machine Learning',             credits: 3 },
    );
  }
  if (student.level >= 3) {
    courses.push(
      { semesterCode: 'FA2025', code: '02-24-00101', title: 'Linear Algebra',                       credits: 3 },
      { semesterCode: 'FA2025', code: '02-24-00105', title: 'Programming I',                        credits: 3 },
    );
  }
  return courses;
}

// ----------------------------------------------------------------------------
// Tenant seed — runs the full FCDS body inside runWithTenant
// ----------------------------------------------------------------------------

async function seedFcdsTenant(tenantId) {
  log('  → cleanup obsolete users + courses from prior seed runs');
  if (ORPHANED_EMAILS.length > 0) {
    const deleted = await prisma.user.deleteMany({
      where: { email: { in: ORPHANED_EMAILS } },
    });
    if (deleted.count > 0) log(`     removed ${deleted.count} orphaned user(s)`);
  }
  if (ORPHANED_COURSE_CODES.length > 0) {
    // CoursePrerequisite FK is RESTRICT — drop prereq rows first so the
    // course delete is allowed. Most other dependents cascade.
    const orphanIds = (await prisma.course.findMany({
      where: { code: { in: ORPHANED_COURSE_CODES } },
      select: { id: true },
    })).map((c) => c.id);
    if (orphanIds.length > 0) {
      await prisma.coursePrerequisite.deleteMany({
        where: { OR: [{ courseId: { in: orphanIds } }, { prerequisiteCourseId: { in: orphanIds } }] },
      });
      const deleted = await prisma.course.deleteMany({
        where: { code: { in: ORPHANED_COURSE_CODES } },
      });
      if (deleted.count > 0) log(`     removed ${deleted.count} orphaned course(s)`);
    }
  }

  log('  → departments');
  const deptMap = {};
  for (const d of FCDS_DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { tenantId_code: { tenantId, code: d.code } },
      update: { name: d.name, description: d.shortName, isActive: true },
      create: { code: d.code, name: d.name, description: d.shortName, totalCredits: 140, isActive: true },
    });
    deptMap[d.code] = row.id;
  }

  log('  → semesters');
  const fall2025 = await prisma.semester.upsert({
    where: { tenantId_code: { tenantId, code: 'FA2025' } },
    update: { name: 'Fall 2025', academicYear: '2025-2026', startDate: new Date('2025-09-01'), endDate: new Date('2025-12-20') },
    create: { code: 'FA2025', name: 'Fall 2025', academicYear: '2025-2026', startDate: new Date('2025-09-01'), endDate: new Date('2025-12-20') },
  });
  const spring2026 = await prisma.semester.upsert({
    where: { tenantId_code: { tenantId, code: 'SP2026' } },
    update: { name: 'Spring 2026', academicYear: '2025-2026', startDate: new Date('2026-02-01'), endDate: new Date('2026-05-20') },
    create: { code: 'SP2026', name: 'Spring 2026', academicYear: '2025-2026', startDate: new Date('2026-02-01'), endDate: new Date('2026-05-20') },
  });
  const fall2026 = await prisma.semester.upsert({
    where: { tenantId_code: { tenantId, code: 'FA2026' } },
    update: { name: 'Fall 2026', academicYear: '2026-2027', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-20') },
    create: { code: 'FA2026', name: 'Fall 2026', academicYear: '2026-2027', startDate: new Date('2026-09-01'), endDate: new Date('2026-12-20') },
  });
  const semesterByCode = { FA2025: fall2025, SP2026: spring2026, FA2026: fall2026 };

  log('  → current term + registration period');
  await prisma.currentTerm.upsert({
    where: { semesterId: fall2026.id },
    update: {},
    create: { semesterId: fall2026.id, setAt: new Date() },
  });
  const regPeriod = await prisma.registrationPeriod.findFirst({
    where: { semesterId: fall2026.id },
  });
  if (!regPeriod) {
    await prisma.registrationPeriod.create({
      data: {
        name: 'Fall 2026 Registration',
        semesterId: fall2026.id,
        semester: 'Fall 2026',
        status: 'open',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-15'),
        addDropDeadline: new Date('2026-09-25'),
        lateDeadline: new Date('2026-09-30'),
        isActive: true,
      },
    });
  }

  log('  → hall');
  const hall = await prisma.bssidLocation.upsert({
    where: { tenantId_bssid: { tenantId, bssid: '00:11:22:33:44:55' } },
    update: { capacity: 50, isActive: true },
    create: {
      bssid: '00:11:22:33:44:55',
      location: 'Main Building',
      building: 'A',
      floor: '1',
      room: 'A101',
      name: 'Lecture Hall A101',
      capacity: 50,
      isActive: true,
    },
  });

  log('  → system roles');
  // Scope values must match the DB CHECK constraint from migration
  // 20260510000000_phase5_role_split_and_admin_tools — Plan 22 removed
  // 'superuser'; the remaining valid scopes are:
  // 'financial','it','admin','professor','ta','sa','student','custom'
  const roleDefs = [
    { name: 'admin',     description: 'Full system access',  scope: 'admin',     isSystem: true, permissions: {} },
    { name: 'financial', description: 'Money flow',          scope: 'financial', isSystem: true, permissions: {} },
    { name: 'it',        description: 'Operational tools',   scope: 'it',        isSystem: true, permissions: {} },
    { name: 'sa',        description: 'Student Affairs',     scope: 'sa',        isSystem: true, permissions: {} },
    { name: 'professor', description: 'Teaching',            scope: 'professor', isSystem: true, permissions: {} },
    { name: 'ta',        description: 'Teaching Assistant',  scope: 'ta',        isSystem: true, permissions: {} },
    { name: 'student',   description: 'Student',             scope: 'student',   isSystem: true, permissions: {} },
  ];
  const roleMap = {};
  for (const r of roleDefs) {
    const row = await prisma.role.upsert({
      where: { tenantId_name: { tenantId, name: r.name } },
      update: { description: r.description, scope: r.scope, permissions: r.permissions },
      create: r,
    });
    roleMap[r.name] = row.id;
  }

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  log('  → admin (admin@uniflow.test)');
  const admin = await createUser(tenantId, {
    odId: 'ADM001',
    email: 'admin@uniflow.test',
    firstName: 'UniFlow',
    lastName: 'Admin',
    role: 'admin',
    phone: '+20-10-0000-0001',
    gender: 'Male',
    nationality: 'Egyptian',
  }, roleMap);

  // Plan 22: superuser role removed entirely — no superuser users seeded.

  log('  → 3 financial');
  const financials = [];
  for (const def of FINANCIAL_DEFS) {
    financials.push(await createUser(tenantId, { ...def, role: 'financial', gender: pickGender(def.firstName), nationality: 'Egyptian' }, roleMap));
  }

  log('  → 3 IT');
  const itUsers = [];
  for (const def of IT_DEFS) {
    itUsers.push(await createUser(tenantId, { ...def, role: 'it', gender: pickGender(def.firstName), nationality: 'Egyptian' }, roleMap));
  }

  log('  → 3 SA');
  const saUsers = [];
  for (const def of SA_DEFS) {
    saUsers.push(await createUser(tenantId, { ...def, role: 'sa', gender: pickGender(def.firstName), nationality: 'Egyptian' }, roleMap));
  }

  log('  → 3 professors');
  const profs = [];
  for (const def of PROFESSOR_DEFS) {
    const p = await createUser(tenantId, { ...def, role: 'professor', gender: pickGender(def.firstName), nationality: 'Egyptian', isAcademicAdvisor: true }, roleMap);
    profs.push(p);
  }

  log('  → 3 TAs');
  const tas = [];
  for (const def of TA_DEFS) {
    tas.push(await createUser(tenantId, { ...def, role: 'ta', gender: pickGender(def.firstName), nationality: 'Egyptian' }, roleMap));
  }

  log('  → 10 students (with academic profiles)');
  const students = [];
  for (let i = 0; i < STUDENT_DEFS.length; i++) {
    const def = STUDENT_DEFS[i];
    const u = await createUser(tenantId, {
      odId: def.odId,
      email: def.email,
      firstName: def.firstName,
      lastName: def.lastName,
      role: 'student',
      gender: pickGender(def.firstName),
      nationality: 'Egyptian',
      academicAdvisorId: profs[i % profs.length].id,
    }, roleMap);

    // Academic profile — GPA derived from tier target.
    const dept = FCDS_DEPARTMENTS.find(d => d.code === def.deptCode);
    const completedCredits = def.level === 3 ? 64 : def.level === 2 ? 34 : 0;
    await prisma.academicProfile.upsert({
      where: { userId: u.id },
      update: {
        program: dept.name,
        department: dept.name,
        major: dept.name,
        studentId: def.odId,
        level: def.level,
        gpa: TIERS[def.tier].gpaTarget.toFixed(2),
        totalCredits: completedCredits,
        completedCredits,
        creditHours: completedCredits,
        creditsThisSemester: 0,
        standing: def.level >= 3 ? 'Junior' : def.level === 2 ? 'Sophomore' : 'Freshman',
        enrollmentDate: new Date('2024-09-01'),
      },
      create: {
        userId: u.id,
        program: dept.name,
        department: dept.name,
        major: dept.name,
        studentId: def.odId,
        level: def.level,
        gpa: TIERS[def.tier].gpaTarget.toFixed(2),
        totalCredits: completedCredits,
        completedCredits,
        creditHours: completedCredits,
        creditsThisSemester: 0,
        standing: def.level >= 3 ? 'Junior' : def.level === 2 ? 'Sophomore' : 'Freshman',
        enrollmentDate: new Date('2024-09-01'),
      },
    });

    students.push({ user: u, def, tier: def.tier });
  }

  // -------------------------------------------------------------------------
  // Courses + Sections
  // -------------------------------------------------------------------------

  log('  → 8 courses');
  const courseMap = {};
  for (const c of COURSE_CATALOG) {
    const row = await prisma.course.upsert({
      where: { tenantId_code: { tenantId, code: c.code } },
      update: {
        title: c.title, credits: c.credits, level: c.level,
        departmentId: deptMap[c.deptCode], semester: c.semester,
        category: c.category, isActive: true,
      },
      create: {
        code: c.code, title: c.title, credits: c.credits, level: c.level,
        departmentId: deptMap[c.deptCode], semester: c.semester,
        category: c.category, language: 'en', isActive: true, maxStudents: 50,
        description: `${c.title} — Level ${c.level} course in ${FCDS_DEPARTMENTS.find(d => d.code === c.deptCode).name}.`,
      },
    });
    courseMap[c.code] = row;
  }

  log('  → prerequisites');
  for (const p of COURSE_PREREQS) {
    const course = courseMap[p.code];
    const prereq = courseMap[p.prereq];
    if (!course || !prereq) continue;
    const exists = await prisma.coursePrerequisite.findFirst({
      where: { courseId: course.id, prerequisiteCourseId: prereq.id },
    });
    if (!exists) {
      await prisma.coursePrerequisite.create({
        data: { courseId: course.id, prerequisiteCourseId: prereq.id, minGrade: p.minGrade },
      });
    }
  }

  log('  → sections for active courses (Fall 2026)');
  const sectionMap = {}; // courseCode → section row
  for (let i = 0; i < COURSE_CATALOG.length; i++) {
    const c = COURSE_CATALOG[i];
    if (!c.activeFall26) continue;

    const instructor = profs[i % profs.length];
    const sec = await prisma.courseSection.upsert({
      where: { courseId_sectionId: { courseId: courseMap[c.code].id, sectionId: 'L1' } },
      update: {
        type: 'Lecture', instructorId: instructor.id, instructorName: `Dr. ${instructor.firstName} ${instructor.lastName}`,
        hallId: hall.id, semester: 'Fall', year: 2026, capacity: 30,
      },
      create: {
        courseId: courseMap[c.code].id,
        sectionId: 'L1',
        type: 'Lecture',
        instructorId: instructor.id,
        instructorName: `Dr. ${instructor.firstName} ${instructor.lastName}`,
        hallId: hall.id,
        location: 'A101',
        room: 'A101',
        semester: 'Fall',
        year: 2026,
        capacity: 30,
        enrolled: 0,
      },
    });
    sectionMap[c.code] = sec;

    // Slots
    for (const slot of (SLOT_PATTERNS[c.code] || [])) {
      const exists = await prisma.sectionSlot.findFirst({
        where: { sectionId: sec.id, day: slot.day, startTime: slot.start },
      });
      if (!exists) {
        await prisma.sectionSlot.create({
          data: { sectionId: sec.id, day: slot.day, startTime: slot.start, endTime: slot.end, room: 'A101' },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Registrations (Fall 2026 — current term)
  // -------------------------------------------------------------------------

  log('  → registrations for current term');
  // Each student registers for active Fall 2026 courses by level. Prereqs are
  // honoured: 00108 (DSA) and 00202 (Databases) need 00105 (Programming I),
  // which Level 3 students have in their past transcript and Level 2 students
  // pick up now. Level 1 takes only no-prereq courses.
  const regsByStudent = {
    3: ['02-24-00108', '02-24-00109', '02-24-00202'], // upper-level (prereq 00105 already in transcript)
    2: ['02-24-00101', '02-24-00105', '02-24-00109'], // catch-up + AI
    1: ['02-24-00101', '02-24-00105'],                // no-prereq foundation
  };
  let regCount = 0;
  for (const s of students) {
    const codes = regsByStudent[s.def.level] || [];
    for (const code of codes) {
      const sec = sectionMap[code];
      if (!sec) continue;
      const reg = await prisma.registration.upsert({
        where: { userId_sectionId: { userId: s.user.id, sectionId: sec.id } },
        update: { status: 'approved', isActive: true, advisorApproved: true, advisorApprovedAt: new Date(), advisorApprovedById: s.user.academicAdvisorId },
        create: {
          userId: s.user.id,
          courseId: courseMap[code].id,
          sectionId: sec.id,
          status: 'approved',
          isActive: true,
          advisorApproved: true,
          advisorApprovedAt: new Date(),
          advisorApprovedById: s.user.academicAdvisorId,
          registeredAt: new Date('2026-09-05'),
        },
      });
      // Mirror into student_enrollments — the per-course de-duped table the
      // admin Manage Courses page counts as the authoritative enrollment
      // number (see registration server `_count: { studentEnrollments }`).
      // upsert by the @@unique([userId, courseId]) so lecture+lab on the
      // same course only writes one row.
      await prisma.studentEnrollment.upsert({
        where: { userId_courseId: { userId: s.user.id, courseId: courseMap[code].id } },
        update: { courseCode: code },
        create: {
          userId: s.user.id,
          courseId: courseMap[code].id,
          courseCode: code,
        },
      });
      regCount++;
    }
    // Update creditsThisSemester
    const totalCreditsThisTerm = codes.reduce((sum, code) => sum + (courseMap[code]?.credits || 0), 0);
    await prisma.academicProfile.update({
      where: { userId: s.user.id },
      data: { creditsThisSemester: totalCreditsThisTerm },
    });
  }
  // Refresh section enrolled counts
  for (const code of Object.keys(sectionMap)) {
    const count = await prisma.registration.count({
      where: { sectionId: sectionMap[code].id, status: 'approved', isActive: true },
    });
    await prisma.courseSection.update({
      where: { id: sectionMap[code].id },
      data: { enrolled: count },
    });
  }

  // -------------------------------------------------------------------------
  // Assignments + Quizzes (current-term active courses)
  // -------------------------------------------------------------------------

  log('  → assignments + quizzes for active courses');
  const assignmentMap = {}; // courseCode → [assignment...]
  const quizMap = {}; // courseCode → [quiz...]
  for (const code of Object.keys(sectionMap)) {
    const course = courseMap[code];
    const instructor = sectionMap[code].instructorId;
    assignmentMap[code] = [];
    quizMap[code] = [];

    // 5 assignments, due weeks 3 / 6 / 9 / 12 / 14
    const assignWeeks = [3, 6, 9, 12, 14];
    for (let n = 1; n <= 5; n++) {
      const week = assignWeeks[n - 1];
      const dueDate = new Date('2026-09-01');
      dueDate.setDate(dueDate.getDate() + week * 7);

      const existing = await prisma.assignment.findFirst({
        where: { courseId: course.id, title: `Assignment ${n}` },
      });
      const a = existing || await prisma.assignment.create({
        data: {
          courseId: course.id,
          title: `Assignment ${n}`,
          description: `Assignment ${n} for ${course.code} — see instructions.`,
          dueDate,
          maxScore: 100,
          weight: 6, // 5 × 6% = 30% of grade
          status: 'active',
          allowLate: true,
          instructions: `Submit your work for ${course.code} Assignment ${n}. Due by ${dueDate.toDateString()}.`,
        },
      });
      assignmentMap[code].push(a);
    }

    // 5 quizzes, weeks 2 / 5 / 8 / 11 / 13
    const quizWeeks = [2, 5, 8, 11, 13];
    for (let n = 1; n <= 5; n++) {
      const week = quizWeeks[n - 1];
      const dueDate = new Date('2026-09-01');
      dueDate.setDate(dueDate.getDate() + week * 7);

      const existing = await prisma.quiz.findFirst({
        where: { courseId: course.id, title: `Quiz ${n}` },
      });
      const q = existing || await prisma.quiz.create({
        data: {
          courseId: course.id,
          title: `Quiz ${n}`,
          description: `Quiz ${n} for ${course.code}`,
          timeLimit: 30,
          maxAttempts: 1,
          passingScore: 60,
          isPublished: true,
          dueDate,
          totalPoints: 10,
          createdById: instructor,
        },
      });
      quizMap[code].push(q);

      // 5 questions per quiz (4 MCQ + 1 written — the only types in the schema enum)
      const existingQuestions = await prisma.quizQuestion.count({ where: { quizId: q.id } });
      if (existingQuestions === 0) {
        await prisma.quizQuestion.createMany({
          data: [
            { quizId: q.id, type: 'mcq', text: `Q1 (${course.code} Quiz ${n}): What is the primary concept here?`, points: 2, options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option A', sortOrder: 1 },
            { quizId: q.id, type: 'mcq', text: `Q2 (${course.code} Quiz ${n}): Which best describes this topic?`,    points: 2, options: ['First',    'Second',   'Third',    'Fourth'  ], correctAnswer: 'Second',   sortOrder: 2 },
            { quizId: q.id, type: 'mcq', text: `Q3 (${course.code} Quiz ${n}): Identify the correct example.`,        points: 2, options: ['Sample 1', 'Sample 2', 'Sample 3', 'Sample 4'], correctAnswer: 'Sample 3', sortOrder: 3 },
            { quizId: q.id, type: 'mcq', text: `Q4 (${course.code} Quiz ${n}): The fundamental theorem holds in all cases.`, points: 2, options: ['True', 'False'], correctAnswer: 'False', sortOrder: 4 },
            { quizId: q.id, type: 'written', text: `Q5 (${course.code} Quiz ${n}): Briefly explain the core idea.`, points: 2, correctAnswer: 'A correct, concise explanation.', sortOrder: 5 },
          ],
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Assignment + Quiz submissions (graded — tier-aligned)
  // -------------------------------------------------------------------------

  log('  → submissions (tier-aligned)');
  let submissionCount = 0;
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const codes = regsByStudent[s.def.level] || [];

    for (let cIdx = 0; cIdx < codes.length; cIdx++) {
      const code = codes[cIdx];
      if (!assignmentMap[code]) continue;
      const targetPct = tieredScore(i, cIdx, s.tier);

      // Submit first 3 of 5 assignments (others still pending)
      for (let aIdx = 0; aIdx < 3; aIdx++) {
        const a = assignmentMap[code][aIdx];
        const variance = ((i * 3 + aIdx) % 7) - 3; // -3..+3
        const score = Math.max(0, Math.min(100, targetPct + variance));
        await prisma.assignmentSubmission.upsert({
          where: { assignmentId_userId: { assignmentId: a.id, userId: s.user.id } },
          update: { score, status: 'graded', gradedAt: new Date(), gradedById: sectionMap[code].instructorId },
          create: {
            assignmentId: a.id,
            userId: s.user.id,
            courseId: courseMap[code].id,
            content: `Submission by ${s.user.firstName} for ${a.title}`,
            score,
            status: 'graded',
            gradedAt: new Date(),
            gradedById: sectionMap[code].instructorId,
            attemptNumber: 1,
          },
        });
        submissionCount++;
      }

      // Submit first 3 of 5 quizzes (others not started)
      for (let qIdx = 0; qIdx < 3; qIdx++) {
        const q = quizMap[code][qIdx];
        const variance = ((i * 5 + qIdx) % 5) - 2;
        const targetOut10 = (targetPct + variance) / 10; // out of 10
        const finalScore = Math.max(0, Math.min(10, Math.round(targetOut10 * 10) / 10));
        await prisma.quizSubmission.upsert({
          where: { quizId_userId_attempt: { quizId: q.id, userId: s.user.id, attempt: 1 } },
          update: { score: finalScore, status: 'graded', submittedAt: new Date(), maxPoints: 10 },
          create: {
            quizId: q.id,
            userId: s.user.id,
            courseId: courseMap[code].id,
            startedAt: new Date(Date.now() - 30 * 60 * 1000),
            submittedAt: new Date(),
            score: finalScore,
            maxPoints: 10,
            status: 'graded',
            attempt: 1,
          },
        });
        submissionCount++;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Transcript history (past semesters)
  // -------------------------------------------------------------------------

  log('  → transcript history + grade breakdowns');
  let transcriptCount = 0;
  let breakdownCount = 0;
  const semGpaBySem = {}; // userId → semCode → { earnedPts, attempted }

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const history = buildTranscriptHistory(s.def);
    semGpaBySem[s.user.id] = {};

    for (let cIdx = 0; cIdx < history.length; cIdx++) {
      const h = history[cIdx];
      const sem = semesterByCode[h.semesterCode];
      if (!sem) continue;

      const pct = tieredScore(i, cIdx, s.tier);
      const grade = pctToLetter(pct);
      const qp = grade.qp * h.credits;

      // Upsert transcript course
      const tc = await prisma.transcriptCourse.upsert({
        where: {
          userId_semesterId_courseCode_attemptNumber: {
            userId: s.user.id, semesterId: sem.id, courseCode: h.code, attemptNumber: 1,
          },
        },
        update: { grade: grade.letter, qualityPoints: qp.toFixed(1), credits: h.credits },
        create: {
          userId: s.user.id,
          semesterId: sem.id,
          courseCode: h.code,
          courseTitle: h.title,
          credits: h.credits,
          grade: grade.letter,
          qualityPoints: qp.toFixed(1),
          attemptNumber: 1,
        },
      });
      transcriptCount++;

      // 5 grade breakdowns per course: Quizzes 20%, Assignments 30%, Midterm 20%, Final 25%, Participation 5%
      const breakdowns = [
        { categoryTitle: 'Quizzes',       componentName: 'Quizzes Total',      grade: pct.toFixed(0),                  weight: '20%', contribution: (pct * 0.20).toFixed(1) },
        { categoryTitle: 'Assignments',   componentName: 'Assignments Total',  grade: (pct + ((i % 3) - 1)).toFixed(0), weight: '30%', contribution: ((pct + ((i % 3) - 1)) * 0.30).toFixed(1) },
        { categoryTitle: 'Midterm',       componentName: 'Midterm Exam',       grade: (pct - 2).toFixed(0),             weight: '20%', contribution: ((pct - 2) * 0.20).toFixed(1) },
        { categoryTitle: 'Final',         componentName: 'Final Exam',         grade: (pct - 1).toFixed(0),             weight: '25%', contribution: ((pct - 1) * 0.25).toFixed(1) },
        { categoryTitle: 'Participation', componentName: 'Class Participation', grade: '95',                              weight: '5%',  contribution: '4.8' },
      ];
      for (const b of breakdowns) {
        const existing = await prisma.gradeBreakdown.findFirst({
          where: { transcriptCourseId: tc.id, componentName: b.componentName },
        });
        if (!existing) {
          await prisma.gradeBreakdown.create({ data: { ...b, transcriptCourseId: tc.id } });
          breakdownCount++;
        }
      }

      // Aggregate for SemesterGpa
      if (!semGpaBySem[s.user.id][h.semesterCode]) {
        semGpaBySem[s.user.id][h.semesterCode] = { earnedPts: 0, attempted: 0, semesterId: sem.id, semesterName: sem.name };
      }
      semGpaBySem[s.user.id][h.semesterCode].earnedPts += qp;
      semGpaBySem[s.user.id][h.semesterCode].attempted += h.credits;
    }

    // Write SemesterGpa rows for this student
    let cumulativeEarned = 0;
    let cumulativeAttempted = 0;
    // Order: Fall 2025 first, then Spring 2026
    for (const semCode of ['FA2025', 'SP2026']) {
      const data = semGpaBySem[s.user.id][semCode];
      if (!data) continue;
      cumulativeEarned += data.earnedPts;
      cumulativeAttempted += data.attempted;
      const semGpa = data.attempted > 0 ? data.earnedPts / data.attempted : 0;
      const cumGpa = cumulativeAttempted > 0 ? cumulativeEarned / cumulativeAttempted : 0;
      await prisma.semesterGpa.upsert({
        where: { userId_semesterId: { userId: s.user.id, semesterId: data.semesterId } },
        update: { gpa: semGpa.toFixed(2), cumulativeGpa: cumGpa.toFixed(2), credits: data.attempted },
        create: {
          userId: s.user.id,
          semesterId: data.semesterId,
          gpa: semGpa.toFixed(2),
          cumulativeGpa: cumGpa.toFixed(2),
          credits: data.attempted,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Financials — accounts + invoices + 1 paid transaction per student
  // -------------------------------------------------------------------------

  log('  → financials (accounts, invoices, transactions)');
  for (const s of students) {
    await prisma.studentAccount.upsert({
      where: { userId: s.user.id },
      update: {},
      create: { userId: s.user.id, balance: 6000, currency: 'EGP', totalPaid: 6000 },
    });

    // Tuition invoice for Fall 2026 (half-paid)
    const tuitionAmount = 12000;
    const vat = 0; // tuition is VAT-exempt in this seed
    const totalAmount = tuitionAmount + vat;
    const paid = tuitionAmount / 2;
    const balance = totalAmount - paid;

    const existingInv = await prisma.invoice.findFirst({
      where: { userId: s.user.id, semesterId: fall2026.id, title: 'Fall 2026 Tuition' },
    });
    const tuitionInvoice = existingInv || await prisma.invoice.create({
      data: {
        userId: s.user.id,
        semesterId: fall2026.id,
        title: 'Fall 2026 Tuition',
        category: 'tuition',
        amount: tuitionAmount,
        vatAmount: vat,
        totalAmount,
        paid,
        balance,
        status: 'partial',
        dueDate: new Date('2026-10-01'),
        semester: 'Fall 2026',
      },
    });

    // 1 completed transaction (the half-payment that's already on the invoice)
    const txExists = await prisma.transaction.findFirst({ where: { invoiceId: tuitionInvoice.id } });
    if (!txExists) {
      await prisma.transaction.create({
        data: {
          userId: s.user.id,
          invoiceId: tuitionInvoice.id,
          type: 'payment',
          method: 'visa',
          amount: paid,
          status: 'completed',
          referenceNumber: `TXN-${s.def.odId}-001`,
          confirmedAt: new Date('2026-09-10'),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Sample announcement + a few notifications
  // -------------------------------------------------------------------------

  log('  → 1 announcement + sample notifications');
  const annExists = await prisma.announcement.findFirst({ where: { title: 'Fall 2026 Registration Open' } });
  if (!annExists) {
    await prisma.announcement.create({
      data: {
        title: 'Fall 2026 Registration Open',
        content: 'Welcome to the Fall 2026 term. Registration closes September 15. Add/drop deadline: September 25.',
        category: 'academic',
        priority: 'high',
        authorId: saUsers[0].id,
        author: `${saUsers[0].firstName} ${saUsers[0].lastName}`,
        publishedAt: new Date('2026-09-01'),
        targetRoles: ['student'],
        isPublished: true,
      },
    });
  }

  // 1 welcome notification per student
  for (const s of students) {
    const exists = await prisma.notification.findFirst({
      where: { userId: s.user.id, title: 'Welcome to UniFlow' },
    });
    if (!exists) {
      await prisma.notification.create({
        data: {
          userId: s.user.id,
          title: 'Welcome to UniFlow',
          content: 'Your Fall 2026 schedule is ready. Visit your dashboard to view assignments and grades.',
          type: 'info',
          isRead: false,
          priority: 'normal',
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Summary counts
  // -------------------------------------------------------------------------

  // Note: Firestore chat-sync is intentionally NOT seeded. Chat groups
  // bootstrap lazily on first connect via backend/lib/chat-sync.js; no
  // seed-time write is needed (and would just add a flaky Firebase dependency).

  const totalUsers = 1 + FINANCIAL_DEFS.length + IT_DEFS.length
    + SA_DEFS.length + PROFESSOR_DEFS.length + TA_DEFS.length + STUDENT_DEFS.length;

  return {
    departments: FCDS_DEPARTMENTS.length,
    semesters: 3,
    users: totalUsers,
    courses: COURSE_CATALOG.length,
    sections: Object.keys(sectionMap).length,
    registrations: regCount,
    assignments: Object.values(assignmentMap).reduce((s, a) => s + a.length, 0),
    quizzes: Object.values(quizMap).reduce((s, q) => s + q.length, 0),
    submissions: submissionCount,
    transcriptCourses: transcriptCount,
    gradeBreakdowns: breakdownCount,
  };
}

// ----------------------------------------------------------------------------
// User creation helper (with all the satellite rows)
// ----------------------------------------------------------------------------

async function createUser(tenantId, opts, roleMap) {
  const u = await prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: opts.email } },
    update: {
      firstName: opts.firstName,
      lastName: opts.lastName,
      role: opts.role,
      status: 'Active',
      activated: true,
      emailVerified: true,
      deletedAt: null,
      suspendedAt: null,
      ...(opts.academicAdvisorId ? { academicAdvisorId: opts.academicAdvisorId } : {}),
      ...(opts.isAcademicAdvisor ? { isAcademicAdvisor: true } : {}),
    },
    create: {
      odId: opts.odId,
      email: opts.email,
      firstName: opts.firstName,
      lastName: opts.lastName,
      password: HASH,
      role: opts.role,
      status: 'Active',
      phone: opts.phone || null,
      gender: opts.gender || null,
      nationality: opts.nationality || 'Egyptian',
      activated: true,
      emailVerified: true,
      isAcademicAdvisor: !!opts.isAcademicAdvisor,
      academicAdvisorId: opts.academicAdvisorId || null,
      dateOfBirth: new Date(2002, (opts.odId.charCodeAt(opts.odId.length - 1) % 12), 15),
    },
  });

  // Settings + address + emergency contact
  await prisma.userSettings.upsert({
    where: { userId: u.id },
    update: {},
    create: { userId: u.id },
  });
  await prisma.userAddress.upsert({
    where: { userId: u.id },
    update: {},
    create: { userId: u.id, city: 'Alexandria', country: 'Egypt', street: 'University District' },
  });
  await prisma.emergencyContact.upsert({
    where: { userId: u.id },
    update: {},
    create: {
      userId: u.id,
      name: 'Family Contact',
      relationship: 'Parent',
      phone: '+20-10-1234-5678',
      email: 'family@example.com',
    },
  });

  // UserRoleAssignment for RBAC
  if (roleMap[opts.role]) {
    const existing = await prisma.userRoleAssignment.findFirst({
      where: { userId: u.id, roleId: roleMap[opts.role] },
    });
    if (!existing) {
      await prisma.userRoleAssignment.create({
        data: { userId: u.id, roleId: roleMap[opts.role] },
      });
    }
  }

  return u;
}

function pickGender(firstName) {
  // Simple heuristic for the seeded names; not generally correct.
  const female = ['Yara', 'Salma', 'Nada', 'Habiba', 'Mariam', 'Mona', 'Layla', 'Sara', 'Heba', 'Rania', 'Dina', 'Reem', 'Asmaa', 'Aya'];
  return female.includes(firstName) ? 'Female' : 'Male';
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('');
  console.log('🌱 UniFlow Seed — starting...');
  console.log('');

  // ------ Tenants (bootstrap; bypass tenant extension) ------
  console.log('▸ Tenants (bootstrap)');
  process.env.UNIFLOW_BOOTSTRAP = '1';
  const fcds = await bootstrapPrisma.tenant.upsert({
    where: { code: 'fcds' },
    update: { name: 'Faculty of Computers and Data Science', shortName: 'FCDS', isActive: true },
    create: { code: 'fcds', name: 'Faculty of Computers and Data Science', shortName: 'FCDS', isActive: true },
  });
  const demo = await bootstrapPrisma.tenant.upsert({
    where: { code: 'demo' },
    update: { name: 'Demo Faculty', shortName: 'DEMO', isActive: true },
    create: { code: 'demo', name: 'Demo Faculty', shortName: 'DEMO', isActive: true },
  });
  delete process.env.UNIFLOW_BOOTSTRAP;

  // ------ FCDS (full seed) ------
  console.log('');
  console.log('▸ FCDS tenant');
  const fcdsStats = await runWithTenant(fcds.id, () => seedFcdsTenant(fcds.id));

  // ------ Demo (1 admin only, proves isolation) ------
  console.log('');
  console.log('▸ Demo tenant (1 admin only)');
  await runWithTenant(demo.id, async () => {
    // Demo gets a minimal Role row so the admin login works
    await prisma.role.upsert({
      where: { tenantId_name: { tenantId: demo.id, name: 'admin' } },
      update: { description: 'Full system access', scope: 'admin', permissions: {} },
      create: { name: 'admin', description: 'Full system access', scope: 'admin', isSystem: true, permissions: {} },
    });
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: demo.id, email: 'admin@demo.uniflow.test' } },
      update: { status: 'Active', activated: true, emailVerified: true, deletedAt: null },
      create: {
        odId: 'DEMO-A001',
        email: 'admin@demo.uniflow.test',
        firstName: 'Demo',
        lastName: 'Admin',
        password: HASH,
        role: 'admin',
        status: 'Active',
        activated: true,
        emailVerified: true,
      },
    });
  });

  // ------ Summary ------
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Seed complete');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Tenants:        2 (fcds + demo)');
  console.log(`  Departments:    ${fcdsStats.departments}`);
  console.log(`  Semesters:      ${fcdsStats.semesters} (Fall 2025, Spring 2026, Fall 2026 [active])`);
  console.log(`  Users (fcds):   ${fcdsStats.users}`);
  console.log(`  Courses:        ${fcdsStats.courses} (${fcdsStats.sections} active in Fall 2026)`);
  console.log(`  Registrations:  ${fcdsStats.registrations}`);
  console.log(`  Assignments:    ${fcdsStats.assignments}`);
  console.log(`  Quizzes:        ${fcdsStats.quizzes}`);
  console.log(`  Submissions:    ${fcdsStats.submissions} (assignment + quiz)`);
  console.log(`  Transcript:     ${fcdsStats.transcriptCourses} courses + ${fcdsStats.gradeBreakdowns} breakdowns`);
  console.log('');
  console.log('  Login (all passwords: Password123!):');
  console.log('    Admin:       admin@uniflow.test');
  console.log('    Superuser:   super@uniflow.test');
  console.log('    Professors:  prof1@uniflow.test, prof2@..., prof3@...');
  console.log('    TAs:         ta1@uniflow.test, ta2@..., ta3@...');
  console.log('    SA:          sa1@uniflow.test, sa2@..., sa3@...');
  console.log('    Financial:   fin1@uniflow.test, fin2@..., fin3@...');
  console.log('    IT:          it1@uniflow.test, it2@..., it3@...');
  console.log('    Students:    student1@uniflow.test … student9@uniflow.test');
  console.log('    Owner:       elhowera@gmail.com  (Elfares Howera, role=student)');
  console.log('    Demo tenant: admin@demo.uniflow.test  (X-Tenant-Code: demo)');
  console.log('');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await bootstrapPrisma.$disconnect();
  });
