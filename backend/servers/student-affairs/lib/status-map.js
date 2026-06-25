/**
 * lib/status-map.js — Status vocabulary bridge for requests and complaints.
 *
 * The DB enum is `pending | in_progress | completed | rejected`, but the
 * existing UIs (SA Requests, SA Complaints, student My Requests) speak
 * `processing` / `resolved`. This module owns both direction maps so every
 * route file uses the same conversion instead of duplicating the literals.
 *
 * Also owns the shared helpers:
 *   - isStaff(req)           → bool
 *   - isSaOrAdmin(req)       → bool (alias — same logic, different name used
 *                               in enrollment-workflow code)
 *   - loadProcessorMap(table, ids) → Promise<Map>
 *   - pushStudentItemUpdate(authHeader, opts) → void (fire-and-forget)
 *   - notifyStudent(authHeader, opts)         → void (fire-and-forget)
 *   - cuid()                 → string (collision-resistant id for raw-SQL tables)
 */

'use strict';

const prisma = require('../../../lib/prisma');
const { getCurrentTenant } = require('../../../lib/tenant-context');

// ── Status alias maps ──────────────────────────────────────────────────────

/** Frontend → DB-enum direction */
const STATUS_ALIAS = {
  processing: 'in_progress',
  resolved:   'completed',
};

/** DB-enum → frontend direction */
const STATUS_TO_FRIENDLY = {
  in_progress: 'processing',
  completed:   'resolved',
};

// ── Role checks ────────────────────────────────────────────────────────────

const isStaff    = (req) => ['sa', 'admin'].includes(req.user?.role);
const isSaOrAdmin = (req) => ['sa', 'admin'].includes(req.user?.role);

// ── Processor info hydration ───────────────────────────────────────────────

/**
 * Read processor info for a list of request / complaint ids in one shot.
 * Returns Map<rowId, { id, firstName, lastName, email, processedAt }>.
 *
 * @param {string} table   DB table name (support_requests | complaints)
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>}
 */
async function loadProcessorMap(table, ids) {
  if (!ids?.length) return new Map();
  const tenantId = getCurrentTenant();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT t.id AS row_id,
              t.processed_at AS "processedAt",
              u.id AS user_id,
              u.first_name AS "firstName",
              u.last_name AS "lastName",
              u.email AS email
         FROM ${table} t
         LEFT JOIN users u ON u.id = t.processed_by_id
        WHERE t.id = ANY($1::text[])
          AND t.processed_by_id IS NOT NULL
          AND t.tenant_id = $2
          AND u.tenant_id = $2`,
      ids,
      tenantId,
    );
    return new Map(
      rows.map((r) => [r.row_id, {
        id: r.user_id,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        processedAt: r.processedAt,
      }]),
    );
  } catch (err) {
    console.warn(`[loadProcessorMap] ${table}:`, err.message);
    return new Map();
  }
}

// ── Cross-service notifications ────────────────────────────────────────────

/**
 * Fire a notification + extra socket payload to a single student.
 * `referenceType` must be one of 'SupportRequest' / 'Complaint' so the
 * student client can decide whether the event affects an open page.
 * Fire-and-forget via setImmediate — never awaited.
 *
 * @param {string} authHeader  Value of the Authorization header to forward
 * @param {{ userId, title, content, referenceType, referenceId }} opts
 */
function pushStudentItemUpdate(authHeader, { userId, title, content, referenceType, referenceId }) {
  setImmediate(async () => {
    try {
      await fetch(`${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader || '' },
        body: JSON.stringify({
          userId,
          title,
          content,
          type: 'info',
          referenceType,
          referenceId,
        }),
      });
    } catch (err) {
      console.warn('[student-affairs] live update push failed:', err.message);
    }
  });
}

/**
 * Fire-and-forget student notification (enrollment workflow flavour — uses
 * `recipientId` / `message` fields matching the notification server's schema).
 *
 * @param {string} authHeader
 * @param {{ recipientId, title, message, type? }} opts
 */
function notifyStudent(authHeader, { recipientId, title, message, type = 'system' }) {
  setImmediate(() => {
    fetch(`${process.env.NOTIFICATION_URL || 'http://localhost:4009'}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader || '' },
      body: JSON.stringify({ recipientId, title, message, type }),
    }).catch((err) => console.warn('[student-affairs] notify failed:', err.message));
  });
}

// ── Misc helpers ───────────────────────────────────────────────────────────

/** Collision-resistant cuid for raw-SQL INSERT statements. */
const cuid = () => 'cuid_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

module.exports = {
  STATUS_ALIAS,
  STATUS_TO_FRIENDLY,
  isStaff,
  isSaOrAdmin,
  loadProcessorMap,
  pushStudentItemUpdate,
  notifyStudent,
  cuid,
};
