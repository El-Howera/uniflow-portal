/**
 * lib/user-context.js
 * ----------------------------------------------------------------------------
 * Builds a compact, LLM-friendly snapshot of the authenticated user that the
 * chatbot can use to personalise replies. The snapshot is computed on demand
 * inside the chat route, memoised per session (10-minute TTL) inside the
 * session store so we don't refetch on every turn, and rendered as a Markdown-
 * ish block of "User: …" lines that gets prepended to the regulation
 * passages in rag.buildMessages.
 *
 * Owner directive (2026-06-09): the bot should have MAXIMUM awareness of the
 * student — name, role, enrolled courses, GPA, level, attendance, balance,
 * pending requests — so it can field "what's my GPA?", "did I pay my fees?",
 * "should I drop my Calculus retake?" without losing the regulation grounding.
 *
 * Design notes:
 *   - All Prisma reads are wrapped in try/catch so a stale FK / missing
 *     table can't take the chat endpoint down. Each section degrades to
 *     empty silently and the system prompt simply omits it.
 *   - The output is human-readable (Mistral takes natural-language context
 *     better than JSON dumps) but bounded — we cap each section at the most
 *     relevant N rows so the system prompt stays under ~2 KB.
 *   - Sensitive fields like password, full address, raw phone are NOT
 *     included. The bot already has the user's identity from JWT auth; the
 *     snapshot is academic context only.
 */

const prisma = require('../../../lib/prisma');

const SECTION_LIMIT = 8;       // max rows per section we include
const RECENT_TXN_LIMIT = 3;    // most recent payments

// In-memory cache keyed on userId. Sits ALONGSIDE the session store so the
// snapshot survives session resets but still expires fast enough that a
// dropped/added course this minute shows up on the next turn after ~10 min.
const cache = new Map(); // userId -> { snapshot, ts }
const TTL_MS = 10 * 60 * 1000;

function pickLetter(grade) {
  if (!grade) return null;
  // Normalise prisma Decimal etc. to a short letter or score.
  const s = String(grade).trim();
  return s.length ? s : null;
}

function fmtMoney(n) {
  const v = parseFloat(String(n || 0));
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}

async function fetchAcademicSummary(userId) {
  try {
    const profile = await prisma.academicProfile.findFirst({
      where: { userId },
      select: {
        program: true, level: true, gpa: true, totalCredits: true,
        completedCredits: true, academicStanding: true, honorsEligible: true,
      },
    });
    return profile;
  } catch { return null; }
}

async function fetchActiveCourses(userId) {
  try {
    const regs = await prisma.registration.findMany({
      where: { userId, status: { in: ['approved', 'pending'] }, isActive: true },
      take: SECTION_LIMIT,
      include: {
        course: { select: { code: true, title: true, credits: true } },
        section: { select: { sectionId: true, type: true } },
      },
    });
    // Group by course so a lecture+lab pair shows up as one entry.
    const byCourse = new Map();
    for (const r of regs) {
      const code = r.course?.code || r.courseCode;
      if (!code) continue;
      if (!byCourse.has(code)) {
        byCourse.set(code, {
          code, title: r.course?.title || code, credits: r.course?.credits || 0,
          sections: [],
        });
      }
      const sec = r.section;
      if (sec) byCourse.get(code).sections.push(`${sec.type || ''} ${sec.sectionId || ''}`.trim());
    }
    return Array.from(byCourse.values());
  } catch { return []; }
}

async function fetchCurrentGrades(userId) {
  try {
    // Most recent semester's transcript courses (cumulative view).
    const rows = await prisma.transcriptCourse.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: SECTION_LIMIT,
      select: {
        courseCode: true, courseTitle: true, credits: true, grade: true,
        semester: { select: { name: true } },
      },
    });
    return rows;
  } catch { return []; }
}

async function fetchAttendance(userId) {
  try {
    const records = await prisma.attendanceRecord.findMany({
      where: { userId },
      select: { status: true },
    });
    if (records.length === 0) return null;
    const buckets = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of records) {
      const k = (r.status || '').toLowerCase();
      if (k in buckets) buckets[k] += 1;
    }
    const total = records.length;
    const rate = total > 0 ? Math.round(((buckets.present + buckets.late) / total) * 1000) / 10 : null;
    return { ...buckets, total, rate };
  } catch { return null; }
}

async function fetchFinancial(userId) {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { userId },
      select: { amount: true, balance: true, status: true },
    });
    if (invoices.length === 0) return null;
    const totalCharged = invoices.reduce((s, i) => s + parseFloat(String(i.amount || 0)), 0);
    const outstanding = Math.max(
      0,
      invoices.reduce((s, i) => s + parseFloat(String(i.balance || 0)), 0),
    );
    const paidAgg = await prisma.transaction.aggregate({
      where: { userId, status: { in: ['applied', 'completed'] }, type: 'payment' },
      _sum: { amount: true },
    });
    const totalPaid = paidAgg._sum.amount != null ? parseFloat(String(paidAgg._sum.amount)) : 0;
    return { invoiceCount: invoices.length, totalCharged, totalPaid, outstanding };
  } catch { return null; }
}

async function fetchPendingCases(userId) {
  try {
    const [complaints, requests] = await Promise.all([
      prisma.complaint.count({
        where: { complainantId: userId, status: { in: ['open', 'in_progress'] } },
      }).catch(() => 0),
      prisma.supportRequest.count({
        where: { userId, status: { in: ['submitted', 'in_progress', 'pending'] } },
      }).catch(() => 0),
    ]);
    return { complaints, requests };
  } catch { return { complaints: 0, requests: 0 }; }
}

async function fetchRecentPayments(userId) {
  try {
    const tx = await prisma.transaction.findMany({
      where: { userId, status: { in: ['applied', 'completed'] }, type: 'payment' },
      orderBy: { createdAt: 'desc' },
      take: RECENT_TXN_LIMIT,
      select: { amount: true, createdAt: true, method: true },
    });
    return tx;
  } catch { return []; }
}

/**
 * Renders the snapshot as a single English-language block that the LLM can
 * read directly. We keep it in English regardless of the user's chat language
 * because Mistral handles English context + Arabic question fine, but
 * doesn't always handle Arabic context cleanly when mixed with Arabic
 * regulation passages. The bot's reply will still be in the user's language.
 */
function renderSnapshot(user, parts) {
  const lines = [];
  lines.push('=== STUDENT CONTEXT ===');
  lines.push(`Name: ${user.firstName || ''} ${user.lastName || ''}`.trim());
  lines.push(`Email: ${user.email}`);
  lines.push(`Role: ${user.role || 'student'}`);
  if (user.odId) lines.push(`Student ID: ${user.odId}`);

  if (parts.academic) {
    const a = parts.academic;
    if (a.program) lines.push(`Program: ${a.program}`);
    if (a.level != null) lines.push(`Academic level: ${a.level}`);
    if (a.gpa != null) lines.push(`Cumulative GPA: ${parseFloat(String(a.gpa)).toFixed(2)}`);
    if (a.completedCredits != null) lines.push(`Completed credits: ${a.completedCredits}`);
    if (a.totalCredits != null) lines.push(`Total credits enrolled: ${a.totalCredits}`);
    if (a.academicStanding) lines.push(`Academic standing: ${a.academicStanding}`);
    if (a.honorsEligible) lines.push(`Honors eligibility: ${a.honorsEligible}`);
  }

  if (parts.activeCourses?.length) {
    lines.push('');
    lines.push('Currently enrolled courses (this semester):');
    for (const c of parts.activeCourses) {
      const sections = c.sections.length ? ` [${c.sections.join(', ')}]` : '';
      lines.push(`- ${c.code} ${c.title} (${c.credits || 0} cr)${sections}`);
    }
  }

  if (parts.currentGrades?.length) {
    lines.push('');
    lines.push('Recent transcript grades:');
    for (const g of parts.currentGrades) {
      const letter = pickLetter(g.grade);
      const sem = g.semester?.name ? ` — ${g.semester.name}` : '';
      lines.push(`- ${g.courseCode} ${g.courseTitle}: ${letter || 'N/A'}${sem}`);
    }
  }

  if (parts.attendance) {
    const a = parts.attendance;
    lines.push('');
    lines.push(
      `Attendance: ${a.present} present, ${a.late} late, ${a.absent} absent, ${a.excused} excused ` +
      `(${a.rate != null ? a.rate + '%' : 'N/A'} of ${a.total} records).`,
    );
  }

  if (parts.financial) {
    const f = parts.financial;
    lines.push('');
    lines.push(
      `Financials: ${f.invoiceCount} invoices · charged ${fmtMoney(f.totalCharged)} · ` +
      `paid ${fmtMoney(f.totalPaid)} · outstanding ${fmtMoney(f.outstanding)}.`,
    );
  }

  if (parts.recentPayments?.length) {
    lines.push('');
    lines.push('Recent payments:');
    for (const tx of parts.recentPayments) {
      const d = new Date(tx.createdAt).toISOString().slice(0, 10);
      lines.push(`- ${d}: ${fmtMoney(tx.amount)} via ${tx.method || 'unknown'}`);
    }
  }

  if (parts.pendingCases && (parts.pendingCases.complaints > 0 || parts.pendingCases.requests > 0)) {
    lines.push('');
    lines.push(
      `Open with Student Affairs: ${parts.pendingCases.requests} support request(s), ` +
      `${parts.pendingCases.complaints} complaint(s).`,
    );
  }

  lines.push('=== END STUDENT CONTEXT ===');
  return lines.join('\n');
}

/**
 * Public entry point. Returns the rendered snapshot string (or null if the
 * user isn't a student and there's nothing useful to surface). Memoised.
 */
async function getUserContext(user) {
  if (!user || !user.userId) return null;

  const cached = cache.get(user.userId);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached.snapshot;
  }

  // Always fetch the User row so we have firstName / lastName / odId even
  // when the JWT doesn't carry them.
  let userRow = user;
  try {
    const fresh = await prisma.user.findFirst({
      where: { id: user.userId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, odId: true,
      },
    });
    if (fresh) userRow = { ...user, ...fresh };
  } catch { /* keep JWT payload */ }

  // For non-student roles, only render the minimal identity block so the
  // bot can greet by name without exposing financial details that don't
  // apply.
  if (userRow.role !== 'student') {
    const snapshot = renderSnapshot(userRow, {});
    cache.set(user.userId, { snapshot, ts: Date.now() });
    return snapshot;
  }

  // Student — fetch everything in parallel.
  const [academic, activeCourses, currentGrades, attendance, financial, pendingCases, recentPayments] =
    await Promise.all([
      fetchAcademicSummary(user.userId),
      fetchActiveCourses(user.userId),
      fetchCurrentGrades(user.userId),
      fetchAttendance(user.userId),
      fetchFinancial(user.userId),
      fetchPendingCases(user.userId),
      fetchRecentPayments(user.userId),
    ]);

  const snapshot = renderSnapshot(userRow, {
    academic, activeCourses, currentGrades, attendance, financial,
    pendingCases, recentPayments,
  });

  cache.set(user.userId, { snapshot, ts: Date.now() });
  return snapshot;
}

function invalidateUserContext(userId) {
  if (!userId) return;
  cache.delete(userId);
}

module.exports = {
  getUserContext,
  invalidateUserContext,
};
