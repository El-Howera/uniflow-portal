/**
 * ChatGroupInfoPanel
 *
 * Shared "group info" sidebar used by ProfChatroom and student Chatroom.
 * Renders the group's photo / name / description / member list, exposes
 * mute toggle for everyone, and admin tools (edit name, edit description,
 * change photo, promote/demote members) when the caller's group role is
 * `professor` / `ta` / `admin`.
 *
 * Backed by the websocket server's group-aware endpoints:
 *   GET    /api/chat/groups/:groupId
 *   PATCH  /api/chat/groups/:groupId
 *   POST   /api/chat/groups/:groupId/photo
 *   PATCH  /api/chat/groups/:groupId/members/:userId/role
 *   PATCH  /api/chat/groups/:groupId/mute
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URLS } from '@shared/config';
import { courseInitials } from './ChatGroupAvatar';

const glassCardStyle =
  'bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl';

export interface ChatGroupSlot {
  day: string;
  startTime: string;
  endTime: string;
}

// Plan 5 — staff chat introduces 'chat-admin' (admin moderator role) and
// 'member' (default for non-admin staff). Pre-existing values stay valid.
export type ChatMemberRole =
  | 'student'
  | 'professor'
  | 'ta'
  | 'admin'
  | 'chat-admin'
  | 'member';

export interface ChatGroupMember {
  userId: string;
  role: ChatMemberRole;
  joinedAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  profilePicture: string | null;
  systemRole: string;
}

export interface ChatGroupDetail {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  sectionId: string;
  courseCode: string | null;
  courseTitle: string | null;
  sectionType: string | null;
  sectionLabel: string | null;
  slots: ChatGroupSlot[];
  myRole: 'student' | 'professor' | 'ta' | 'admin' | null;
  muted: boolean;
  members: ChatGroupMember[];
}

const photoSrc = (photoUrl: string | null) =>
  photoUrl
    ? photoUrl.startsWith('http')
      ? photoUrl
      : `${API_URLS.chat()}${photoUrl}`
    : null;

const formatSlots = (slots: ChatGroupSlot[]): string => {
  if (!slots || slots.length === 0) return 'TBA';
  return slots
    .map((s) => `${s.day.slice(0, 3)} ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`)
    .join(' · ');
};

// Role pill component — used in the member list. No emojis; relies on
// the design system's color theming. Always look up via `getRolePill` so
// unrecognised member.role values fall back to the neutral pill instead of
// crashing the row (Plan 5 staff chat introduced 'chat-admin' / 'member').
const NEUTRAL_PILL = {
  label: 'Member',
  cls: 'bg-white/5 text-gray-400 border-white/10',
};
const ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  professor: {
    label: 'Prof',
    cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  admin: {
    label: 'Admin',
    cls: 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30',
  },
  'chat-admin': {
    label: 'Admin',
    cls: 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30',
  },
  ta: {
    label: 'TA',
    cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  student: NEUTRAL_PILL,
  member: NEUTRAL_PILL,
};
const getRolePill = (role: string | undefined) =>
  (role && ROLE_LABELS[role]) || NEUTRAL_PILL;

// Member row inside the panel. The role select uses GlassDropdown to
// match the rest of the design system — never a native <select>.
//
// Authorisation: the role-change dropdown only renders when the viewer is
// system staff (professor / TA / admin from the JWT, NOT a student who's
// merely been promoted to a chat-admin). The intent is "the prof manages
// roles; chat-admins can moderate messages but can't promote/demote".
// The self row also hides the dropdown — you can't demote yourself.
const MemberRow: React.FC<{
  member: ChatGroupMember;
  canModerateRoles: boolean;
  isSelf: boolean;
  onChangeRole: (userId: string, role: 'admin' | 'student') => void;
  onViewProfile: (member: ChatGroupMember) => void;
}> = ({ member, canModerateRoles, isSelf, onChangeRole, onViewProfile }) => {
  const isStaffRow = member.role === 'professor' || member.role === 'ta';
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  const initials = (member.firstName?.[0] ?? '') + (member.lastName?.[0] ?? '');
  const rolePill = getRolePill(member.role);
  // Role dropdown visible iff: the viewer can moderate roles AND the row
  // isn't the viewer themselves AND the row isn't a structural staff role
  // (professor / TA — those are tied to the section, not the chat).
  const showRoleDropdown = canModerateRoles && !isSelf && !isStaffRow;
  // Compact two-option select — only Student or Admin. TA is a structural
  // role driven by the CourseSectionTA join table, not a chat-admin choice.
  const dropdownValue: 'student' | 'admin' = member.role === 'admin' ? 'admin' : 'student';

  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors">
      <button
        type="button"
        onClick={() => onViewProfile(member)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
        title="View profile"
      >
        {member.profilePicture ? (
          <img
            src={member.profilePicture}
            alt={fullName}
            className="w-9 h-9 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-[#6A3FF4]/30 text-[#7B5AFF] flex items-center justify-center text-xs font-bold flex-shrink-0">
            {initials.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-black dark:text-white font-semibold truncate">
            {fullName} {isSelf && <span className="text-[9px] text-gray-500 font-normal">(you)</span>}
          </p>
          <p className="text-[10px] text-gray-500 truncate">{member.email}</p>
        </div>
        {!showRoleDropdown && (
          <span
            className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full flex-shrink-0 border ${rolePill.cls}`}
          >
            {rolePill.label}
          </span>
        )}
      </button>
      {showRoleDropdown && (
        // Single-tap promote / demote pill — replaces the dropdown that
        // was forcing the row to scroll horizontally. Click toggles the
        // student between Member and Admin in one move.
        <button
          type="button"
          onClick={() =>
            onChangeRole(member.userId, dropdownValue === 'admin' ? 'student' : 'admin')
          }
          className={`flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-colors ${
            dropdownValue === 'admin'
              ? 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/40 hover:bg-[#6A3FF4]/30'
              : 'bg-white/5 text-gray-400 border-white/10 hover:text-[#7B5AFF] hover:border-[#6A3FF4]/30'
          }`}
          title={dropdownValue === 'admin' ? 'Demote to member' : 'Promote to admin'}
        >
          <i className={`ph-bold ${dropdownValue === 'admin' ? 'ph-shield-check' : 'ph-shield'} mr-1`}></i>
          {dropdownValue === 'admin' ? 'Admin' : 'Promote'}
        </button>
      )}
    </div>
  );
};

export interface ChatGroupInfoPanelProps {
  groupId: string;
  onClose: () => void;
  onGroupUpdated?: () => void;
}

export const ChatGroupInfoPanel: React.FC<ChatGroupInfoPanelProps> = ({
  groupId,
  onClose,
  onGroupUpdated,
}) => {
  const [detail, setDetail] = useState<ChatGroupDetail | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [profileTarget, setProfileTarget] = useState<ChatGroupMember | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_URLS.chat()}/api/chat/groups/${groupId}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setFeedback({ kind: 'error', text: 'Could not load group info.' });
      return;
    }
    const body: ChatGroupDetail = await res.json();
    setDetail(body);
    setEditName(body.name);
    setEditDescription(body.description ?? '');
  }, [groupId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live role updates — when the prof / chat-admin promotes or demotes a
  // member elsewhere (or this panel is the one doing it), the host
  // chatroom dispatches a `uniflow:chat-role-changed` window event after
  // receiving the chat:roleChanged broadcast. Re-fetch so the member list
  // and pill icons reflect the new state without a manual refresh.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ sectionId: string }>;
      if (ce.detail?.sectionId === groupId) reload();
    };
    window.addEventListener('uniflow:chat-role-changed', handler as EventListener);
    return () =>
      window.removeEventListener('uniflow:chat-role-changed', handler as EventListener);
  }, [groupId, reload]);

  // Live group-meta updates (name / description / photo) — the host chatroom
  // dispatches `uniflow:chat-group-updated` after the chat:groupUpdated socket
  // broadcast lands. Re-fetch so the panel header (avatar + title) refreshes
  // for every connected member, not just the uploader.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ sectionId: string }>;
      if (ce.detail?.sectionId === groupId) reload();
    };
    window.addEventListener('uniflow:chat-group-updated', handler as EventListener);
    return () =>
      window.removeEventListener('uniflow:chat-group-updated', handler as EventListener);
  }, [groupId, reload]);

  // Periodic refetch — catches member additions / removals from staff group
  // backfill and from auto-enrollment paths that don't emit a socket event.
  // Without this, the panel showed stale member counts for staff chats and
  // for course chats where new students joined after the panel mounted
  // ("displayed members is static and doesn't fetch from the db"). 30s
  // cadence is a balance between responsiveness and Firestore read cost.
  // Also refreshes once on tab-focus return (page came back from background)
  // so users who Alt+Tab away and back see current state immediately.
  useEffect(() => {
    if (!groupId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 30000);
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [groupId, reload]);

  // System role pulled from JWT-backed localStorage. Used as a fallback
  // when the user's per-group Firestore role is missing (common for staff
  // groups: an admin may not have an explicit 'admin' role doc inside the
  // staff_all / staff_financials / etc. groups, but should still be able
  // to moderate them).
  const systemRole = (localStorage.getItem('currentUserRole') || '').toLowerCase();

  // Group-level moderation (edit name/description/photo, change message
  // moderation tools, etc.) — chat-admins included. System admins can
  // moderate ANY group regardless of their per-group Firestore role.
  const canModerate = useMemo(() => {
    if (['professor', 'ta', 'admin'].includes(systemRole)) return true;
    if (!detail?.myRole) return false;
    return ['professor', 'ta', 'admin'].includes(detail.myRole);
  }, [detail, systemRole]);

  // Role-change moderation is stricter: ONLY the section's professor / TA
  // (system staff role) can promote or demote members. A student promoted
  // to chat-admin can pin / delete / send announcements (group-level
  // moderation), but cannot grant the same powers to anyone else.
  const canModerateRoles = useMemo(
    () => ['professor', 'ta', 'admin'].includes(systemRole),
    [systemRole],
  );

  // For the "(you)" suffix and self-row dropdown hiding.
  const myUserId = localStorage.getItem('currentUserId') || '';

  const flash = (kind: 'success' | 'error', text: string) => {
    setFeedback({ kind, text });
    setTimeout(() => setFeedback(null), 2500);
  };

  const handleSaveMeta = async () => {
    if (!detail) return;
    setSavingMeta(true);
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(`${API_URLS.chat()}/api/chat/groups/${groupId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: editName.trim() || undefined,
          description: editDescription.trim() === '' ? null : editDescription.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash('error', body.error || 'Save failed.');
        return;
      }
      flash('success', 'Group info saved.');
      await reload();
      onGroupUpdated?.();
    } finally {
      setSavingMeta(false);
    }
  };

  const handlePhotoUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    const token = localStorage.getItem('authToken');
    const formData = new FormData();
    formData.append('photo', file);
    try {
      const res = await fetch(`${API_URLS.chat()}/api/chat/groups/${groupId}/photo`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash('error', body.error || 'Photo upload failed.');
        return;
      }
      flash('success', 'Group photo updated.');
      await reload();
      onGroupUpdated?.();
    } finally {
      setUploading(false);
    }
  };

  const handleChangeRole = async (memberUserId: string, newRole: 'admin' | 'student') => {
    const token = localStorage.getItem('authToken');
    const res = await fetch(
      `${API_URLS.chat()}/api/chat/groups/${groupId}/members/${memberUserId}/role`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash('error', body.error || 'Role change failed.');
      return;
    }
    flash('success', `Updated role to ${newRole === 'admin' ? 'Admin' : 'Member'}.`);
    await reload();
  };

  const handleToggleMute = async () => {
    if (!detail) return;
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_URLS.chat()}/api/chat/groups/${groupId}/mute`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ muted: !detail.muted }),
    });
    if (!res.ok) return flash('error', 'Mute toggle failed.');
    await reload();
    onGroupUpdated?.();
    // Tell the global chat-socket listener in NotificationContext to
    // re-fetch its mute-state cache so the new value takes effect on the
    // next incoming message without a page refresh.
    window.dispatchEvent(new CustomEvent('uniflow:chat-mute-changed', { detail: { groupId } }));
  };

  // Two-step "Clear All Chat" — first click flips into a confirm state so
  // a stray tap doesn't nuke the whole thread. Soft-deletes every message
  // in the section's chat; broadcasts `chat:clearAll` so connected clients
  // wipe their local list without a refresh.
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const handleClearAll = async () => {
    if (!detail) return;
    setClearingAll(true);
    const token = localStorage.getItem('authToken');
    try {
      const res = await fetch(
        `${API_URLS.chat()}/api/chat/groups/${groupId}/messages`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash('error', body.error || 'Clear failed.');
        return;
      }
      flash('success', 'Chat cleared.');
      setConfirmClearAll(false);
      onGroupUpdated?.();
    } finally {
      setClearingAll(false);
    }
  };

  if (!detail) {
    return (
      <div className={`${glassCardStyle} p-4 flex items-center justify-center min-h-[200px]`}>
        <p className="text-xs text-gray-500">Loading group info…</p>
      </div>
    );
  }

  return (
    // `h-full min-h-0` fills the parent cell exactly. The root is NOT scrollable
    // — the Members section below is the single bounded scroll region (it has
    // `flex-1 min-h-0 overflow-y-auto`). A root `overflow-y-auto` here made the
    // members `flex-1` collapse to ~0 height on mobile (where the parent is a
    // flex child, not a fixed grid cell), so the member list was invisible when
    // opening group info on a phone.
    <div className={`${glassCardStyle} p-4 flex flex-col gap-4 h-full min-h-0`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-black dark:text-white">Group Info</h3>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md bg-white/5 text-gray-400 hover:text-black dark:hover:text-white hover:bg-white/10 flex items-center justify-center text-xs"
          title="Close"
        >
          <i className="ph-bold ph-x"></i>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-lg px-3 py-2 text-xs font-medium ${
            feedback.kind === 'success'
              ? 'bg-green-500/10 text-green-500 border border-green-500/30'
              : 'bg-red-500/10 text-red-500 border border-red-500/30'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Photo */}
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          disabled={!canModerate}
          onClick={() => fileInputRef.current?.click()}
          className={`relative w-20 h-20 rounded-full overflow-hidden border-2 ${
            canModerate
              ? 'border-[#6A3FF4]/40 hover:border-[#6A3FF4] cursor-pointer'
              : 'border-white/10 cursor-default'
          } transition-colors flex items-center justify-center`}
          title={canModerate ? 'Click to change photo' : 'Group photo'}
        >
          {photoSrc(detail.photoUrl) ? (
            <img src={photoSrc(detail.photoUrl)!} alt="Group" className="w-full h-full object-cover" />
          ) : (
            // Initials in the same purple gradient used by the user-profile
            // avatar — pulls from courseTitle, then the group's display name,
            // then courseCode as a final fallback.
            <div className="w-full h-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center text-white text-2xl font-bold">
              {courseInitials({
                courseTitle: detail.courseTitle,
                name: detail.name,
                courseCode: detail.courseCode,
              })}
            </div>
          )}
          {canModerate && (
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] py-0.5 text-center">
              {uploading ? 'Uploading…' : 'Change'}
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handlePhotoUpload(file);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {/* Name + description */}
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Group name</label>
          <input
            type="text"
            disabled={!canModerate}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white outline-none focus:border-[#6A3FF4] disabled:opacity-70"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Description</label>
          <textarea
            disabled={!canModerate}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={3}
            placeholder={canModerate ? 'What is this group about?' : ''}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-black dark:text-white outline-none focus:border-[#6A3FF4] resize-none disabled:opacity-70"
          />
        </div>
        {canModerate && (
          <button
            onClick={handleSaveMeta}
            disabled={savingMeta}
            className="w-full py-2 rounded-lg bg-[#6A3FF4] hover:bg-[#5A32D4] text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {savingMeta ? 'Saving…' : 'Save changes'}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-500">
        <div>
          <i className="ph-bold ph-book-open text-[#7B5AFF] mr-1"></i> {detail.courseCode} —{' '}
          {detail.courseTitle}
        </div>
        <div className="mt-1">
          <i className="ph-bold ph-clock text-[#7B5AFF] mr-1"></i> {formatSlots(detail.slots)}
        </div>
      </div>

      {/* Mute toggle */}
      <button
        onClick={handleToggleMute}
        className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
      >
        <span className="text-xs text-black dark:text-white font-medium flex items-center gap-2">
          <i className={`ph-bold ${detail.muted ? 'ph-bell-slash' : 'ph-bell'} text-[#6A3FF4]`}></i>
          Notifications
        </span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${
            detail.muted ? 'text-gray-500' : 'text-emerald-400'
          }`}
        >
          {detail.muted ? 'Muted' : 'On'}
        </span>
      </button>

      {/* Clear all chat — destructive admin tool. Two-step confirm so a
          stray tap can't wipe the thread. */}
      {canModerate && (
        confirmClearAll ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 space-y-2">
            <p className="text-xs text-red-400 font-bold flex items-center gap-1.5">
              <i className="ph-bold ph-warning"></i>
              Clear every message in this chat?
            </p>
            <p className="text-[11px] text-gray-400">
              The thread shows up empty for everyone in this section. Audit
              history is preserved server-side.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                disabled={clearingAll}
                className="flex-1 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-gray-400 hover:text-black dark:hover:text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={clearingAll}
                className="flex-1 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {clearingAll ? 'Clearing…' : 'Yes, clear all'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClearAll(true)}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-white/5 border border-red-500/20 hover:bg-red-500/10 hover:border-red-500/40 transition-colors group"
          >
            <span className="text-xs text-red-400 font-medium flex items-center gap-2">
              <i className="ph-bold ph-trash"></i>
              Clear all messages
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500 group-hover:text-red-400">
              Admin
            </span>
          </button>
        )
      )}

      {/* Members */}
      <div className="flex-1 min-h-0 flex flex-col">
        <p className="text-[10px] font-bold uppercase text-gray-500 mb-2">
          {detail.members.length} member{detail.members.length === 1 ? '' : 's'}
        </p>
        <div className="flex-1 overflow-y-auto -mx-2">
          {detail.members.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              canModerateRoles={canModerateRoles}
              isSelf={m.userId === myUserId}
              onChangeRole={handleChangeRole}
              onViewProfile={setProfileTarget}
            />
          ))}
        </div>
      </div>

      {/* Profile modal */}
      {profileTarget && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setProfileTarget(null)}
        >
          <div
            className={`${glassCardStyle} max-w-sm w-full p-6`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-3 mb-4">
              {profileTarget.profilePicture ? (
                <img
                  src={profileTarget.profilePicture}
                  alt=""
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-[#6A3FF4]/30 text-[#7B5AFF] flex items-center justify-center text-2xl font-bold">
                  {(profileTarget.firstName?.[0] ?? '') + (profileTarget.lastName?.[0] ?? '')}
                </div>
              )}
              <div className="text-center">
                <p className="text-base font-bold text-black dark:text-white">
                  {profileTarget.firstName} {profileTarget.lastName}
                </p>
                <p className="text-xs text-gray-500 capitalize">{profileTarget.systemRole}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-gray-500">
                <i className="ph-bold ph-envelope text-[#7B5AFF]"></i>
                <span className="text-black dark:text-white">{profileTarget.email}</span>
              </div>
              {profileTarget.phone && (
                <div className="flex items-center gap-2 text-gray-500">
                  <i className="ph-bold ph-phone text-[#7B5AFF]"></i>
                  <span className="text-black dark:text-white">{profileTarget.phone}</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setProfileTarget(null)}
              className="mt-5 w-full py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-black dark:hover:text-white hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatGroupInfoPanel;
