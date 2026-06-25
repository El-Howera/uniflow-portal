/**
 * Group CRUD routes for the chat server.
 *
 * Mounted at /api/chat in index.js.
 *
 * Endpoints (6):
 *   GET    /groups/me                                  → caller's group list
 *   GET    /groups/:groupId                            → group detail + member list
 *   PATCH  /groups/:groupId                            → update name/description
 *   POST   /groups/:groupId/photo                      → multipart photo upload
 *   PATCH  /groups/:groupId/mute                       → caller toggles own mute
 *
 * Notes:
 *   - Firestore availability is checked at the top of GET /groups/me; other
 *     endpoints let the error propagate to the generic 500 handler since they
 *     operate on a single known doc.
 *   - Staff backfill (backfillAllStaffGroupMembership) is fire-and-forget so
 *     it never blocks the response.
 *   - Photo uploads: multer diskStorage, 5 MB limit, files under uploads/photos/.
 *     Served as static at /chat-photos (mounted in index.js).
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const storage = require('../../../lib/storage');
const fs = require('fs');
const multer = require('multer');

const prisma = require('../../../lib/prisma');
const { requireAuth } = require('../../../lib/auth');
const chatSync = require('../../../lib/chat-sync');
const { runWithTenant } = require('../../../lib/tenant-context');

const firestoreHelpers = require('../lib/firestore-helpers');
const {
  groupRef,
  memberRef,
  roomKey,
  serverTimestamp,
  isFirestoreNotFound,
  markFirestoreDown,
  getDocScoped,
  fetchGroupForTenant,
  isModerator,
  timestampToMs,
} = firestoreHelpers;
const { getSectionIdsForUser, ensureMembershipForUser } = require('../lib/staff-groups');
const { getIo } = require('../socket');

// ─── Photo upload ─────────────────────────────────────────────────────────────
// On Fly, UPLOAD_ROOT=/app/uploads (persistent volume). The frontend uses
// `${API_URLS.chat()}/chat-photos/<file>` to display — that path is routed
// through nginx /chat-photos/ → chat:4010 → express.static below, which
// resolves to the volume-backed directory.

const photosDir = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'chat-photos')
  : path.join(__dirname, '../uploads/photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const photoUpload = storage.memoryUpload({ limits: { fileSize: 5 * 1024 * 1024 } });

// ─── GET /groups/me ───────────────────────────────────────────────────────────

router.get('/groups/me', requireAuth, async (req, res) => {
  if (!firestoreHelpers.firestoreReachable) {
    return res.status(503).json({
      error: 'chat_backend_unavailable',
      reason: 'firestore_not_enabled',
      message:
        'Chat backend (Firestore) not reachable. Enable it at ' +
        `https://console.firebase.google.com/project/${
          process.env.FIREBASE_PROJECT_ID || '<your-project>'
        }/firestore and restart the chat server.`,
      detail: firestoreHelpers.firestoreUnreachableReason,
    });
  }

  try {
    const { role, userId, tenantId } = req.user;

    // 1) Section IDs come from Postgres — sidesteps the Firestore
    //    collectionGroup index requirement.
    const sectionIds = await getSectionIdsForUser(userId, role);

    // 1b) Staff groups — non-students get auto-membership. Returns the list
    //     of staff group IDs the user is now a confirmed member of.
    const staffIds =
      role !== 'student'
        ? await chatSync
            .ensureStaffGroupMembership(prisma, userId, role, tenantId)
            .catch(() => [])
        : [];

    // Fire-and-forget bulk backfill so peers are visible in staff groups even
    // when some haven't logged in yet. Wrapped in runWithTenant so the Prisma
    // extension sees the right tenant scope after the request finishes.
    if (role !== 'student') {
      const bgTenant = tenantId;
      setImmediate(() => {
        runWithTenant(bgTenant, () =>
          chatSync.backfillAllStaffGroupMembership(prisma, bgTenant)
        ).catch((err) => {
          console.warn('[chat] staff backfill failed:', err.message);
        });
      });
    }

    const allIds = [...sectionIds, ...staffIds];
    if (allIds.length === 0) return res.json([]);

    // 2) Ensure Firestore group + member docs exist for all section IDs.
    await ensureMembershipForUser(userId, role, sectionIds);

    // 3) Read each group + caller's member doc by direct ID (no collection
    //    queries → no composite-index dependency). Cross-tenant groups are
    //    silently dropped.
    const out = await Promise.all(
      allIds.map(async (sid) => {
        const [gSnap, mSnap] = await Promise.all([
          getDocScoped(groupRef(sid), tenantId),
          getDocScoped(memberRef(sid, userId), tenantId),
        ]);
        if (!gSnap) return null;
        const g = gSnap.data();
        const myRole = mSnap
          ? mSnap.get('role')
          : role === 'admin' ? 'chat-admin'
          : role === 'professor' ? 'professor'
          : role === 'ta' ? 'ta'
          : 'member';
        const kind = g.kind || (typeof g.staffGroupId === 'string' ? 'staff' : 'section');
        return {
          groupId: sid,
          kind,
          myRole,
          muted: mSnap ? !!mSnap.get('muted') : false,
          mutedUntil: mSnap ? timestampToMs(mSnap.get('mutedUntil')) : null,
          name: g.name,
          description: g.description ?? null,
          photoUrl: g.photoUrl ?? null,
          memberCount: g.memberCount ?? 0,
          messageCount: 0,
          sectionId: sid,
          courseCode: g.courseCode ?? null,
          courseTitle: g.courseTitle ?? null,
          sectionType: g.sectionType ?? null,
          sectionLabel: g.sectionLabel ?? null,
          slots: g.slots ?? [],
          lastMessageAt: timestampToMs(g.lastMessageAt),
        };
      })
    );
    const groups = out.filter(Boolean);
    groups.sort((a, b) => {
      const at = a.lastMessageAt ?? 0;
      const bt = b.lastMessageAt ?? 0;
      if (at !== bt) return bt - at;
      return (a.name || '').localeCompare(b.name || '');
    });
    res.json(groups);
  } catch (err) {
    if (isFirestoreNotFound(err)) {
      markFirestoreDown(err);
      return res.status(503).json({
        error: 'chat_backend_unavailable',
        reason: 'firestore_not_enabled',
        message:
          'Chat backend (Firestore) not reachable. Enable it at ' +
          `https://console.firebase.google.com/project/${
            process.env.FIREBASE_PROJECT_ID || '<your-project>'
          }/firestore and restart the chat server.`,
        detail: err.message,
      });
    }
    console.error('GET /api/chat/groups/me:', err.message || err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /groups/:groupId ─────────────────────────────────────────────────────

router.get('/groups/:groupId', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { tenantId, userId, role } = req.user;
    const gSnap = await fetchGroupForTenant(groupId, tenantId);
    if (!gSnap) return res.status(404).json({ error: 'Group not found' });
    const g = gSnap.data();

    const myMember = await getDocScoped(memberRef(groupId, userId), tenantId);
    if (!myMember && role !== 'admin') {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Tenant-filter member list at the query level.
    const membersSnap = await groupRef(groupId)
      .collection('members')
      .where('tenantId', '==', tenantId)
      .get();

    let members = membersSnap.docs.map((d) => {
      const data = d.data();
      return {
        userId: data.userId,
        role: data.role,
        joinedAt: timestampToMs(data.joinedAt),
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        email: data.email ?? '',
        phone: data.phone ?? null,
        profilePicture: data.profilePicture ?? null,
        systemRole: data.systemRole ?? null,
        _docId: d.id,
      };
    });

    // Staff group hygiene — purge ineligible members fire-and-forget.
    if (g.staffGroupId) {
      const def = chatSync.STAFF_GROUP_DEFS.find((s) => s.id === g.staffGroupId);
      const allowed = def?.members ?? [];
      if (allowed.length > 0) {
        const ineligible = members.filter((m) => m.systemRole && !allowed.includes(m.systemRole));
        if (ineligible.length > 0) {
          for (const m of ineligible) {
            groupRef(groupId).collection('members').doc(m._docId).delete().catch(() => {});
          }
          members = members.filter((m) => !m.systemRole || allowed.includes(m.systemRole));
        }
      }
    }
    members = members.map(({ _docId: _, ...rest }) => rest);
    members.sort((a, b) => {
      if (a.role !== b.role) return String(a.role).localeCompare(String(b.role));
      return (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
    });

    res.json({
      id: groupId,
      name: g.name,
      description: g.description ?? null,
      photoUrl: g.photoUrl ?? null,
      sectionId: groupId,
      courseCode: g.courseCode ?? null,
      courseTitle: g.courseTitle ?? null,
      sectionType: g.sectionType ?? null,
      sectionLabel: g.sectionLabel ?? null,
      slots: g.slots ?? [],
      myRole: myMember ? myMember.get('role') : null,
      muted: myMember ? !!myMember.get('muted') : false,
      mutedUntil: myMember ? timestampToMs(myMember.get('mutedUntil')) : null,
      readOnly: !!g.readOnly,
      pinnedMessageId: g.pinnedMessageId ?? null,
      members,
    });
  } catch (err) {
    console.error('GET /api/chat/groups/:groupId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /groups/:groupId ───────────────────────────────────────────────────

router.patch('/groups/:groupId', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { tenantId } = req.user;
    const tenantSnap = await fetchGroupForTenant(groupId, tenantId);
    if (!tenantSnap) return res.status(404).json({ error: 'Group not found' });
    if (!(await isModerator(req, groupId))) return res.status(403).json({ error: 'Forbidden' });

    const { name, description } = req.body || {};
    const data = { updatedAt: serverTimestamp() };
    if (typeof name === 'string') {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = trimmed;
    }
    if (description !== undefined) {
      data.description = description == null ? null : String(description).trim() || null;
    }
    if (Object.keys(data).length === 1) return res.status(400).json({ error: 'Nothing to update' });

    await groupRef(groupId).set(data, { merge: true });
    const fresh = (await groupRef(groupId).get()).data();
    getIo().to(roomKey(tenantId, groupId)).emit('chat:groupUpdated', {
      sectionId: groupId,
      name: fresh?.name ?? null,
      description: fresh?.description ?? null,
      photoUrl: fresh?.photoUrl ?? null,
    });
    res.json({ success: true, group: { id: groupId, ...fresh } });
  } catch (err) {
    console.error('PATCH /api/chat/groups/:groupId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /groups/:groupId/photo ──────────────────────────────────────────────

router.post(
  '/groups/:groupId/photo',
  requireAuth,
  photoUpload.single('photo'),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const { tenantId } = req.user;
      const tenantSnap = await fetchGroupForTenant(groupId, tenantId);
      if (!tenantSnap || !(await isModerator(req, groupId))) {
        // memoryStorage — nothing written yet, so no temp file to clean up.
        return res
          .status(tenantSnap ? 403 : 404)
          .json({ error: tenantSnap ? 'Forbidden' : 'Group not found' });
      }
      if (!req.file) return res.status(400).json({ error: 'photo file required' });

      const { filename } = await storage.saveUpload('chat-photos', req.file);
      const url = `/chat-photos/${filename}`;
      await groupRef(groupId).set({ photoUrl: url, updatedAt: serverTimestamp() }, { merge: true });
      getIo().to(roomKey(tenantId, groupId)).emit('chat:groupUpdated', {
        sectionId: groupId,
        photoUrl: url,
      });
      res.json({ success: true, photoUrl: url });
    } catch (err) {
      console.error('POST /api/chat/groups/:groupId/photo:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── PATCH /groups/:groupId/mute ──────────────────────────────────────────────

router.patch('/groups/:groupId/mute', requireAuth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { tenantId, userId } = req.user;
    const { muted } = req.body || {};
    if (typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'muted (boolean) is required' });
    }
    const ref = memberRef(groupId, userId);
    const snap = await getDocScoped(ref, tenantId);
    if (!snap) return res.status(403).json({ error: 'Not a member of this group' });
    await ref.set({ muted }, { merge: true });
    res.json({ success: true, muted });
  } catch (err) {
    console.error('PATCH mute:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
