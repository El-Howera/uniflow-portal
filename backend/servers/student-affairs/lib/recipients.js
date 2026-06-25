/**
 * lib/recipients.js — Announcement recipient resolution helpers.
 *
 * Owns:
 *   - resolveRecipients(prisma, { parsedTargetUserIds, parsedTargetLevels,
 *       effectiveRoles }) → string[]
 *
 * Called by announcements.routes.js when the SA/admin compose form is
 * submitted and we need to fan-out to the correct user-id set before
 * delegating the actual push to the notification server.
 *
 * No side effects. Pure data fetch — caller drives the fan-out.
 */

'use strict';

/**
 * Resolve the set of recipient user-ids for an announcement or notification blast.
 *
 * Priority (mirrors the GET /api/announcements filter logic):
 *   1. Explicit user-id list (`parsedTargetUserIds`)
 *   2. Level-targeted students (`parsedTargetLevels`)
 *   3. Role-targeted users (`effectiveRoles`)
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{
 *   parsedTargetUserIds: string[],
 *   parsedTargetLevels: number[],
 *   effectiveRoles: string[],
 *   tenantId: string,
 * }} opts
 * @returns {Promise<string[]>} Array of user.id strings
 */
async function resolveRecipients(prisma, { parsedTargetUserIds, parsedTargetLevels, effectiveRoles, tenantId }) {
  let recipients = [];

  if (parsedTargetUserIds.length > 0) {
    recipients = await prisma.user.findMany({
      where: { id: { in: parsedTargetUserIds }, status: 'Active', tenantId },
      select: { id: true },
    });
  } else if (parsedTargetLevels.length > 0) {
    recipients = await prisma.user.findMany({
      where: {
        role: { in: effectiveRoles.includes('student') ? ['student'] : effectiveRoles },
        status: 'Active',
        tenantId,
        academicProfile: { level: { in: parsedTargetLevels } },
      },
      select: { id: true },
    });
  } else {
    recipients = await prisma.user.findMany({
      where: { role: { in: effectiveRoles }, status: 'Active', tenantId },
      select: { id: true },
    });
  }

  return recipients.map((u) => u.id);
}

module.exports = { resolveRecipients };
