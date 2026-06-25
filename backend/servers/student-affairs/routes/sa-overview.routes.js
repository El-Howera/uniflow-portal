/**
 * routes/sa-overview.routes.js — public contacts + student quick-links.
 *
 * Owns (MVP build — public + student-self only):
 *   GET /api/contacts              — department contacts (public, with fallback)
 *   GET /api/student/quick-links   — student dashboard quick links (requireAuth)
 *
 * MVP build notes:
 *   - The SA dashboard overview (GET /api/sa/overview), the SA/admin
 *     department-contact CRUD (POST/PUT/DELETE /api/sa/department-contacts),
 *     and the SA/admin student-quick-links management endpoints
 *     (GET/PUT /api/sa/student-quick-links) have all been removed — the preview
 *     build keeps a real backend only for student & professor.
 *
 * Mounted at app.use('/api', saOverviewRoutes) in index.js.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const prisma          = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');

// ── GET /api/contacts ─────────────────────────────────────────────────────
//
// Returns the tenant's department-contact directory. Falls back to a built-in
// FCDS roster when the table is empty so the student-affairs page never
// renders empty — new deploys, ad-hoc test DBs, and tenants who haven't yet
// curated their own list all get a usable starter set.

const FALLBACK_CONTACTS = [
  {
    id: 'fallback-dean',
    deptKey: 'dean',
    department: 'Dean\'s Office',
    title: 'Dean of FCDS',
    name: 'Prof. Mohamed El-Sayed',
    role: 'Dean',
    email: 'dean@uni-flow.tech',
    phone: '+20 3 555 0100',
    office: 'Building A, Floor 4, Room 401',
    hours: 'Sun–Thu · 10:00 – 14:00',
    location: 'Main Campus · Building A',
    description: 'Final escalation for academic appeals and inter-departmental matters.',
  },
  {
    id: 'fallback-registrar',
    deptKey: 'registrar',
    department: 'Registrar / Student Affairs',
    title: 'Registrar',
    name: 'Ms. Salma Hassan',
    role: 'Head of Student Affairs',
    email: 'registrar@uni-flow.tech',
    phone: '+20 3 555 0110',
    office: 'Building A, Floor 1, Room 105',
    hours: 'Sun–Thu · 09:00 – 16:00',
    location: 'Main Campus · Building A · Ground floor',
    description: 'Registration, transcripts, attendance excuses, official letters.',
  },
  {
    id: 'fallback-finance',
    deptKey: 'finance',
    department: 'Financial Affairs',
    title: 'Financial Office',
    name: 'Mr. Karim Mostafa',
    role: 'Cashier & Accounts',
    email: 'finance@uni-flow.tech',
    phone: '+20 3 555 0120',
    office: 'Building B, Floor 1, Room 12',
    hours: 'Sun–Thu · 09:30 – 14:30',
    location: 'Main Campus · Building B · Cashier counter',
    description: 'Tuition payments, fee inquiries, refunds, financial aid intake.',
  },
  {
    id: 'fallback-it',
    deptKey: 'it',
    department: 'IT Helpdesk',
    title: 'IT Support',
    name: 'Mr. Ahmed Fathy',
    role: 'IT Manager',
    email: 'it-helpdesk@uni-flow.tech',
    phone: '+20 3 555 0130',
    office: 'Building C, Floor 2, Room 218',
    hours: 'Sun–Thu · 09:00 – 17:00',
    location: 'Main Campus · Building C',
    description: 'Account access issues, password resets, Wi-Fi, lab equipment.',
  },
  {
    id: 'fallback-library',
    deptKey: 'library',
    department: 'Library',
    title: 'Library Services',
    name: 'Ms. Nour Adel',
    role: 'Chief Librarian',
    email: 'library@uni-flow.tech',
    phone: '+20 3 555 0140',
    office: 'Library Building',
    hours: 'Sat–Thu · 09:00 – 20:00',
    location: 'Main Campus · Library Building',
    description: 'Book loans, study room booking, e-resources.',
  },
  {
    id: 'fallback-careers',
    deptKey: 'careers',
    department: 'Careers & Internships',
    title: 'Career Services',
    name: 'Ms. Heba Mahmoud',
    role: 'Careers Advisor',
    email: 'careers@uni-flow.tech',
    phone: '+20 3 555 0150',
    office: 'Building A, Floor 2, Room 215',
    hours: 'Sun–Thu · 10:00 – 15:00',
    location: 'Main Campus · Building A',
    description: 'Internship placements, CV reviews, employer connections.',
  },
];

router.get('/contacts', async (req, res) => {
  try {
    const contacts = await prisma.departmentContact.findMany({
      orderBy: { department: 'asc' },
    });
    if (contacts.length > 0) return res.json(contacts);
    // Empty tenant — serve the fallback roster. Returned with synthetic
    // 'fallback-*' IDs so a UI that keys on id stays stable; if an admin
    // later seeds real rows, those replace the fallback automatically.
    return res.json(FALLBACK_CONTACTS);
  } catch (error) {
    // Even on DB error, give the user the fallback list rather than 500.
    console.warn('[contacts] DB read failed, serving fallback:', error?.message);
    return res.json(FALLBACK_CONTACTS);
  }
});

// ── Student dashboard Quick Links (read-only, student-self) ────────────────
// Stored as a JSON array of { label, url, icon? } on
// system_settings.student_quick_links via the raw-SQL bridge. The SA/admin
// management write path has been removed in the MVP build; the student-facing
// read remains so the dashboard can render whatever links exist.

const DEFAULT_QUICK_LINKS = [];

async function readQuickLinks() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT student_quick_links FROM system_settings LIMIT 1
    `;
    const raw = rows?.[0]?.student_quick_links;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { const p = JSON.parse(raw); return Array.isArray(p) ? p : DEFAULT_QUICK_LINKS; }
      catch { return DEFAULT_QUICK_LINKS; }
    }
    return DEFAULT_QUICK_LINKS;
  } catch (err) {
    if (/column .* does not exist/i.test(err.message)) {
      // Lazy migration — column is added the first time someone writes.
      return DEFAULT_QUICK_LINKS;
    }
    console.warn('[quick-links] read failed:', err.message);
    return DEFAULT_QUICK_LINKS;
  }
}

// GET /api/student/quick-links — student-readable (any authed user)
router.get('/student/quick-links', requireAuth, async (req, res) => {
  res.json({ links: await readQuickLinks() });
});

module.exports = router;
