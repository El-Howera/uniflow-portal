/**
 * backend/lib/chat-sync.js — Firestore-backed chat membership sync.
 *
 * Single owner of the registration → chat-group membership link. Every
 * registration lifecycle event (approve, drop, withdraw, swap, force-enroll,
 * SA reject) calls into here so chat membership stays in lockstep with the
 * student's ACTIVE enrollment in a section.
 *
 * Migration note (2026-05-03): this module previously wrote ChatGroup /
 * ChatMember rows to Postgres. The chat path now lives in Firestore (see
 * backend/servers/chat/), so every write here goes to Firestore. Postgres
 * is still used for the *source* data (sections, instructor, TA join rows,
 * user profile fields) — those remain canonical. The Firestore copy is
 * write-through: registration is the producer, the chat server is the
 * consumer.
 *
 * Firestore layout:
 *   chatGroups/{sectionId}                   — one doc per section
 *   chatGroups/{sectionId}/members/{userId}  — one doc per chat member
 *
 * The section's CUID is reused as the Firestore doc id so the mapping is
 * deterministic — no extra lookup needed when registration wants to add a
 * student to a chat.
 *
 * Group naming format:
 *     {course.title} — {section.type} {section.sectionId} — {time-range}
 *
 * If Firebase isn't configured (FIREBASE_SERVICE_ACCOUNT_KEY missing) every
 * call is a silent no-op. Registration / SA paths still complete; chat
 * membership simply doesn't sync until Firebase is wired.
 *
 * Multi-tenant note (Plan 11 / Phase 2 — 2026-05-17): every Firestore doc
 * written by this module carries a `tenantId` field. Reads in the chat
 * server filter by tenantId so cross-tenant data leakage is impossible at
 * the data layer. The tenant id is resolved from the AsyncLocalStorage
 * context bound by `requireAuth` (see `backend/lib/tenant-context.js`).
 * Callers from outside a request lifecycle (seed scripts, backfill jobs)
 * must wrap their critical section in `runWithTenant(tenantId, …)` or set
 * UNIFLOW_BOOTSTRAP=1 and pass tenant explicitly through the helpers below
 * (every public function accepts an optional explicit override).
 */

const { tryDb, serverTimestamp, increment } = require('./firestore');
const { getCurrentTenant } = require('./tenant-context');

/**
 * Resolve the tenant id to stamp on a Firestore doc. Prefer the explicit
 * argument (for bootstrap / cross-tenant admin scripts); otherwise read
 * from AsyncLocalStorage (set by requireAuth). Throws if neither is set —
 * a Firestore write with no tenantId would be unscoped and break the
 * isolation guarantee.
 */
function resolveTenantId(explicit) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const fromCtx = getCurrentTenant();
  if (fromCtx) return fromCtx;
  throw new Error(
    '[chat-sync] No tenant in scope. Either run under requireAuth or pass ' +
    'tenantId explicitly. This guard prevents cross-tenant data leakage in chat.'
  );
}

const TYPE_LABEL = {
  lecture: 'Lecture',
  lab: 'Lab',
  tutorial: 'Tutorial',
  recitation: 'Recitation',
};

function formatSlotTime(slot) {
  if (!slot || !slot.startTime || !slot.endTime) return null;
  const day = slot.day ? String(slot.day).slice(0, 3) : '';
  const start = String(slot.startTime).slice(0, 5);
  const end = String(slot.endTime).slice(0, 5);
  return `${day} ${start}–${end}`.trim();
}

function buildGroupName(section) {
  const courseTitle = section.course?.title ?? section.course?.code ?? '?';
  const typeLabel = TYPE_LABEL[String(section.type || '').toLowerCase()] || 'Section';
  const sectionId = section.sectionId ?? section.id;
  const slots = Array.isArray(section.slots) ? section.slots : [];
  const timeLabel = slots.length === 1
    ? (formatSlotTime(slots[0]) ?? 'TBA')
    : (slots.length > 1 ? 'Multiple times' : 'TBA');
  return `${courseTitle} — ${typeLabel} ${sectionId} — ${timeLabel}`;
}

/**
 * Snapshot the user fields the chat UI needs (avatar, contact card data) so
 * the member doc carries them inline — saves a round-trip per render. The
 * chat server doesn't talk to Postgres; member docs are self-contained.
 */
async function loadUserSnapshot(prisma, userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      profilePicture: true,
      role: true,
    },
  });
}

/**
 * Idempotently ensure a chatGroups/{sectionId} doc exists with the
 * instructor + every assigned TA in its members subcollection. Returns the
 * Firestore doc ref (or null if Firebase isn't configured).
 *
 * Safe to call repeatedly. Re-runs upgrade the group's name and freshen the
 * instructor / TA member rows (in case admin reassigned).
 *
 * @param prisma         Prisma client.
 * @param sectionId      Section CUID — also used as the Firestore group doc id.
 * @param explicitTenantId Optional override; otherwise read from AsyncLocalStorage.
 */
async function ensureChatGroupForSection(prisma, sectionId, explicitTenantId) {
  const db = tryDb();
  if (!db) return null;

  const tenantId = resolveTenantId(explicitTenantId);

  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    include: {
      course: { select: { id: true, code: true, title: true } },
      slots: { select: { day: true, startTime: true, endTime: true } },
      taAssignments: { select: { taId: true } },
    },
  });
  if (!section) return null;

  const canonicalName = buildGroupName(section);
  const groupRef = db.collection('chatGroups').doc(section.id);

  // Build the group doc payload. Use merge:true so admin-edited name /
  // description / photoUrl don't get clobbered by a later sync pass — only
  // create-time fields are forced.
  const existing = await groupRef.get();
  const groupPayload = {
    tenantId,
    sectionId: section.id,
    courseCode: section.course?.code ?? null,
    courseTitle: section.course?.title ?? null,
    sectionType: section.type ?? null,
    sectionLabel: section.sectionId ?? null,
    slots: (section.slots || []).map((s) => ({
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    updatedAt: serverTimestamp(),
  };
  if (!existing.exists) {
    Object.assign(groupPayload, {
      name: canonicalName,
      description: null,
      photoUrl: null,
      pinnedMessageId: null,
      readOnly: false,
      memberCount: 0,
      lastMessageAt: null,
      createdAt: serverTimestamp(),
    });
  } else {
    // Existing — only overwrite the canonical name when the admin hasn't
    // customised it. The canonical pattern always contains '—'; if the saved
    // name lacks it we treat it as a legacy auto-name and upgrade.
    const currentName = existing.get('name');
    if (typeof currentName !== 'string' || !currentName.includes('—')) {
      groupPayload.name = canonicalName;
    }
    // Defence in depth: if an existing doc somehow lacks the tenantId
    // (legacy pre-multi-tenant data), refuse to overwrite a doc whose
    // stored tenantId DOESN'T match the current scope — that would be a
    // cross-tenant write attempt. Otherwise the tenantId in groupPayload
    // backfills the missing field on the next merge.
    const storedTenant = existing.get('tenantId');
    if (storedTenant && storedTenant !== tenantId) {
      throw new Error(
        `[chat-sync] tenant mismatch on section ${section.id}: ` +
        `stored=${storedTenant} current=${tenantId}`
      );
    }
  }
  await groupRef.set(groupPayload, { merge: true });

  // Upsert instructor member.
  if (section.instructorId) {
    const inst = await loadUserSnapshot(prisma, section.instructorId);
    if (inst) {
      // Lecture instructor → 'professor'. Lab instructor → 'ta'. Mirrors the
      // existing role-based picker rules for section editing.
      const role = String(section.type || '').toLowerCase() === 'lab' ? 'ta' : 'professor';
      await upsertMember(db, section.id, inst, role, false, tenantId);
    }
  }

  // Upsert TA join rows — owner directive (2026-05-17): TAs belong in
  // Lab section chats only. Lecture chats are professor-only because the
  // lecture is the professor's space (TA-led labs have their own chats
  // already). When this runs on a LAB section we add the TAs; when on a
  // Lecture (or any non-Lab type) we explicitly REMOVE any pre-existing
  // TA member docs from legacy data so the cleanup is self-healing.
  const isLab = String(section.type || '').toLowerCase() === 'lab';
  if (isLab) {
    for (const t of section.taAssignments || []) {
      if (!t.taId) continue;
      const ta = await loadUserSnapshot(prisma, t.taId);
      if (ta) {
        await upsertMember(db, section.id, ta, 'ta', /* preserveExistingRole */ true, tenantId);
      }
    }
  } else {
    // Non-lab section — drop any TA member docs that snuck in earlier.
    for (const t of section.taAssignments || []) {
      if (!t.taId) continue;
      try {
        await db
          .collection('chatGroups').doc(section.id)
          .collection('members').doc(t.taId)
          .delete();
      } catch { /* idempotent — missing doc is fine */ }
    }
  }

  return groupRef;
}

/**
 * Upsert one member doc in chatGroups/{sectionId}/members/{userId}.
 *
 * @param {string} sectionId        Firestore group id (= section CUID).
 * @param {object} user             user snapshot from Postgres.
 * @param {string} role             'student' | 'professor' | 'ta' | 'admin'.
 * @param {boolean} preserveExistingRole
 *        When true and the member already exists, don't downgrade. Used for
 *        the TA upsert path so a chat-admin promoted student doesn't get
 *        bumped back down to 'ta' when the admin resyncs the section.
 * @param {string} tenantId         Tenant scope — written on every member doc
 *        so Firestore queries can filter by tenant without joining the group
 *        doc. Required.
 */
async function upsertMember(db, sectionId, user, role, preserveExistingRole = false, tenantId) {
  if (!tenantId) {
    throw new Error('[chat-sync] upsertMember: tenantId is required');
  }
  const ref = db.collection('chatGroups').doc(sectionId).collection('members').doc(user.id);
  const existing = await ref.get();

  // Defence in depth: an existing member doc whose tenantId differs is a
  // cross-tenant write attempt — refuse rather than silently overwriting.
  if (existing.exists) {
    const storedTenant = existing.get('tenantId');
    if (storedTenant && storedTenant !== tenantId) {
      throw new Error(
        `[chat-sync] upsertMember tenant mismatch on ${sectionId}/${user.id}: ` +
        `stored=${storedTenant} current=${tenantId}`
      );
    }
  }

  const base = {
    tenantId,
    userId: user.id,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    email: user.email ?? '',
    phone: user.phone ?? null,
    profilePicture: user.profilePicture ?? null,
    systemRole: user.role ?? null,
  };

  if (!existing.exists) {
    await ref.set({
      ...base,
      role,
      muted: false,
      mutedUntil: null,
      joinedAt: serverTimestamp(),
    });
    // Bump the group's member counter.
    await db.collection('chatGroups').doc(sectionId).set(
      { memberCount: increment(1) },
      { merge: true }
    );
    return;
  }

  // Existing member — refresh the snapshot fields, but only update role
  // when we're allowed to. Mute state and joinedAt stay untouched.
  const update = { ...base };
  if (!preserveExistingRole) {
    update.role = role;
  }
  await ref.set(update, { merge: true });
}

/**
 * Add a student to a section's chat group (creating the group + instructor /
 * TA members if needed). Idempotent. Re-enrolling a student keeps any prior
 * promoted role intact (don't downgrade chat-admin).
 *
 * `tenantId` is resolved from AsyncLocalStorage when called from inside an
 * authenticated request. Bootstrap / cross-tenant callers may pass it
 * explicitly via the third `opts.tenantId` argument.
 */
async function addStudentToSectionChat(prisma, { userId, sectionId, tenantId: explicit }) {
  const db = tryDb();
  if (!db) return null;

  const tenantId = resolveTenantId(explicit);

  await ensureChatGroupForSection(prisma, sectionId, tenantId);
  const user = await loadUserSnapshot(prisma, userId);
  if (!user) return null;

  await upsertMember(db, sectionId, user, 'student', /* preserveExistingRole */ true, tenantId);
  return db.collection('chatGroups').doc(sectionId);
}

/**
 * Remove a student from a section's chat group. No-op when missing.
 * Tenant-checked: refuses to delete a member doc whose stored tenantId
 * doesn't match the current scope.
 */
async function removeStudentFromSectionChat(prisma, { userId, sectionId, tenantId: explicit }) {
  const db = tryDb();
  if (!db) return false;

  const tenantId = resolveTenantId(explicit);

  const ref = db
    .collection('chatGroups')
    .doc(sectionId)
    .collection('members')
    .doc(userId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const storedTenant = snap.get('tenantId');
  if (storedTenant && storedTenant !== tenantId) {
    throw new Error(
      `[chat-sync] removeStudent tenant mismatch on ${sectionId}/${userId}: ` +
      `stored=${storedTenant} current=${tenantId}`
    );
  }
  await ref.delete();
  await db.collection('chatGroups').doc(sectionId).set(
    { memberCount: increment(-1) },
    { merge: true }
  );
  return true;
}

/**
 * SA swap: kick the student out of fromSection, add them to toSection in
 * one call. Each side is independently idempotent.
 */
async function transferStudentBetweenSections(
  prisma,
  { userId, fromSectionId, toSectionId, tenantId: explicit },
) {
  const tenantId = resolveTenantId(explicit);
  if (fromSectionId) {
    await removeStudentFromSectionChat(prisma, { userId, sectionId: fromSectionId, tenantId });
  }
  if (toSectionId) {
    await addStudentToSectionChat(prisma, { userId, sectionId: toSectionId, tenantId });
  }
}

// ============================================================================
// Plan 5 Phase 5 — Staff chat groups
// ============================================================================
//
// 6 admin-facing groups. Membership is auto-derived from the user's role at
// connection time — no manual sync. Admin is `chat-admin` in every group;
// scope-specific staff (financial / sa / ta / professor / it) sit in their
// own dedicated group + the shared `staff_all` group.
//
// Group ids are stable strings so the chat server can reference them
// directly. Following the section-room convention they live in the same
// `chatGroups` collection — just with the `kind: 'staff'` discriminator.

const STAFF_GROUP_DEFS = [
  { id: 'staff_all',         name: 'Staff — All',           members: ['admin', 'financial', 'it', 'sa', 'ta', 'professor'] },
  { id: 'staff_financials',  name: 'Staff — Financials',    members: ['admin', 'financial'] },
  { id: 'staff_sa',          name: 'Staff — Student Affairs', members: ['admin', 'sa'] },
  { id: 'staff_ta',          name: 'Staff — Teaching Assistants', members: ['admin', 'ta'] },
  { id: 'staff_professors',  name: 'Staff — Professors',    members: ['admin', 'professor'] },
  { id: 'staff_it',          name: 'Staff — IT',            members: ['admin', 'it'] },
];

/**
 * Idempotently ensure a single staff group doc exists in Firestore.
 * Uses `kind: 'staff'` so the chat server can list staff groups separately
 * from course section groups.
 *
 * Tenant-scoped: each tenant gets its own staff_all / staff_financials /
 * etc. groups. The Firestore doc id is namespaced with the tenant prefix
 * (`t__<tenantId>__staff_all`) so two tenants can both have a staff_all
 * group without collision. The original short id is preserved as
 * `staffGroupId` for the chat server's role-set lookups.
 */
function staffGroupDocId(tenantId, defId) {
  return `t__${tenantId}__${defId}`;
}

async function ensureStaffGroupDoc(db, def, tenantId) {
  if (!tenantId) {
    throw new Error('[chat-sync] ensureStaffGroupDoc: tenantId is required');
  }
  const docId = staffGroupDocId(tenantId, def.id);
  const ref = db.collection('chatGroups').doc(docId);
  const existing = await ref.get();
  const payload = {
    tenantId,
    sectionId: null,        // staff groups are NOT tied to a section
    kind: 'staff',
    staffGroupId: def.id,   // 'staff_all', 'staff_it', etc. — for role-set lookups
    courseCode: null,
    courseTitle: null,
    sectionType: null,
    sectionLabel: null,
    slots: [],
    updatedAt: serverTimestamp(),
  };
  if (!existing.exists) {
    Object.assign(payload, {
      name: def.name,
      description: null,
      photoUrl: null,
      pinnedMessageId: null,
      readOnly: false,
      memberCount: 0,
      lastMessageAt: null,
      createdAt: serverTimestamp(),
    });
  } else {
    // Existing — only re-write the canonical name when it's missing or
    // hasn't been customised by the admin.
    const currentName = existing.get('name');
    if (typeof currentName !== 'string' || currentName === def.name) {
      payload.name = def.name;
    }
    const storedTenant = existing.get('tenantId');
    if (storedTenant && storedTenant !== tenantId) {
      throw new Error(
        `[chat-sync] staff group tenant mismatch on ${docId}: ` +
        `stored=${storedTenant} current=${tenantId}`
      );
    }
  }
  await ref.set(payload, { merge: true });
  return ref;
}

/**
 * Ensure a single user is a member of every staff group their role qualifies
 * for. Admin is `chat-admin` in every group; everyone else is `member`.
 *
 * Called from the chat server on socket connect (in addition to the existing
 * section-room auto-join). Safe to call repeatedly — idempotent at every
 * level (group doc, member doc).
 *
 * Returns the list of group ids the user was confirmed a member of — these
 * are the TENANT-PREFIXED Firestore doc ids so the chat server can join
 * the matching room directly.
 */
async function ensureStaffGroupMembership(prisma, userId, role, explicitTenantId) {
  const db = tryDb();
  if (!db) return [];
  if (!role || role === 'student') return []; // students have no staff chat

  const tenantId = resolveTenantId(explicitTenantId);

  const user = await loadUserSnapshot(prisma, userId);
  if (!user) return [];

  const memberRole = role === 'admin' ? 'chat-admin' : 'member';
  const ids = [];
  for (const def of STAFF_GROUP_DEFS) {
    if (!def.members.includes(role)) continue;
    const docId = staffGroupDocId(tenantId, def.id);
    await ensureStaffGroupDoc(db, def, tenantId);
    await upsertMember(db, docId, user, memberRole, /* preserveExistingRole */ false, tenantId);
    ids.push(docId);
  }
  return ids;
}

/**
 * Bulk-backfill: ensure EVERY non-student user (in Postgres) is a member of
 * the staff groups their role qualifies for. Idempotent — re-running just
 * upserts existing member docs.
 *
 * Called from the chat server when an admin opens AdminChatroom (via the
 * `GET /api/chat/groups/me` path) so the admin sees the full staff cohort
 * even before each individual staff member has connected.
 */
async function backfillAllStaffGroupMembership(prisma, explicitTenantId) {
  const db = tryDb();
  if (!db) return { groups: 0, members: 0 };

  const tenantId = resolveTenantId(explicitTenantId);

  // Make sure every group doc exists first (tenant-scoped).
  for (const def of STAFF_GROUP_DEFS) {
    await ensureStaffGroupDoc(db, def, tenantId);
  }

  // Prisma extension auto-scopes this findMany to the current tenant, so
  // we only sweep users in the SAME tenant — never cross-pollinate.
  const staff = await prisma.user.findMany({
    where: {
      role: { in: ['professor', 'ta', 'sa', 'admin', 'financial', 'it'] },
      deletedAt: null,
    },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      phone: true, profilePicture: true, role: true,
    },
  });
  const validUserIds = new Set(staff.map((u) => u.id));

  let memberCount = 0;
  let removedCount = 0;
  for (const def of STAFF_GROUP_DEFS) {
    const docId = staffGroupDocId(tenantId, def.id);

    // Reconciliation pass — remove member docs whose userId doesn't match
    // any current Prisma User in this tenant. Without this, every fresh
    // seed (which mints new cuid userIDs each run) leaves old member docs
    // orphaned in Firestore. Over time the staff chat groups accumulate
    // dozens of stale members with no matching user row. Sweeping these
    // here means the staff chat membership list always reflects the
    // current User table.
    try {
      const existingMembers = await db
        .collection('chatGroups').doc(docId)
        .collection('members')
        .where('tenantId', '==', tenantId)
        .get();
      for (const m of existingMembers.docs) {
        const data = m.data();
        // Stale if: not in current user set, OR the role doesn't qualify
        // for THIS staff group anymore (e.g. promoted/demoted user).
        const stale = !validUserIds.has(data.userId)
          || (data.systemRole && !def.members.includes(data.systemRole));
        if (stale) {
          await m.ref.delete().catch(() => {});
          removedCount++;
        }
      }
    } catch (err) {
      // Reconciliation failure is non-fatal — the upserts below still add
      // current members. Log and continue.
      console.warn(`[chat-sync] staff group ${def.id} reconciliation failed:`, err.message);
    }

    // Upsert every current staff user whose role qualifies for this group.
    for (const u of staff) {
      if (!def.members.includes(u.role)) continue;
      const memberRole = u.role === 'admin' ? 'chat-admin' : 'member';
      await upsertMember(db, docId, u, memberRole, /* preserveExistingRole */ true, tenantId);
      memberCount++;
    }
  }
  if (removedCount > 0) {
    console.log(`[chat-sync] staff backfill: pruned ${removedCount} stale members (tenant=${tenantId})`);
  }
  return { groups: STAFF_GROUP_DEFS.length, members: memberCount, removed: removedCount };
}

/**
 * Remove a user from staff groups they no longer qualify for. Used by the
 * `chat:roleChanged` cleanup hook so a demoted user (e.g. ex-IT) stops
 * seeing IT-private messages immediately.
 */
async function pruneStaffGroupMembership(userId, role, explicitTenantId) {
  const db = tryDb();
  if (!db) return [];

  const tenantId = resolveTenantId(explicitTenantId);

  const removed = [];
  for (const def of STAFF_GROUP_DEFS) {
    if (def.members.includes(role)) continue; // user still qualifies — keep
    const docId = staffGroupDocId(tenantId, def.id);
    const ref = db.collection('chatGroups').doc(docId).collection('members').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    // Tenant-check before deleting — must match the member doc's stored
    // tenantId so a misconfigured cross-tenant call can't drop a peer.
    const storedTenant = snap.get('tenantId');
    if (storedTenant && storedTenant !== tenantId) {
      // Skip rather than throw — pruning is a bulk best-effort cleanup
      // and a single mismatched doc shouldn't crash the loop. Log it so
      // an audit picks up any drift.
      console.warn(
        `[chat-sync] prune skip tenant mismatch on ${docId}/${userId}: ` +
        `stored=${storedTenant} current=${tenantId}`
      );
      continue;
    }
    await ref.delete();
    await db.collection('chatGroups').doc(docId).set(
      { memberCount: increment(-1) },
      { merge: true }
    );
    removed.push(docId);
  }
  return removed;
}

module.exports = {
  buildGroupName,
  ensureChatGroupForSection,
  addStudentToSectionChat,
  removeStudentFromSectionChat,
  transferStudentBetweenSections,
  // Plan 5 Phase 5 — staff chat
  STAFF_GROUP_DEFS,
  ensureStaffGroupMembership,
  backfillAllStaffGroupMembership,
  pruneStaffGroupMembership,
  // Plan 11 / Phase 2 — multi-tenant helpers
  staffGroupDocId,
  resolveTenantId,
};
