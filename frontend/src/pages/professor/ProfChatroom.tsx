/**
 * ProfChatroom — section-aware chat for professors.
 *
 * Channels list reads from /api/chat/groups/me, so each row is a per-section
 * group named "<course title> — Lec## — <time>". The professor is auto-
 * enrolled in every section they teach (registration server backfill +
 * lifecycle hooks). Selecting a group stores both `groupId` (for the new
 * group-management endpoints) and `courseCode` (for the legacy socket
 * messaging which is still keyed by course code).
 *
 * Right-side Group Info panel exposes the WhatsApp-style controls:
 *   - editable name + description
 *   - photo upload
 *   - member list with promote/demote
 *   - student mute toggle (no-op for prof-side; shown for symmetry)
 * The legacy moderation tools (delete, pin, system message, read-only)
 * still hang off the chat header.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import { io, Socket } from 'socket.io-client';
import { API_URLS, getSocketEndpoint, PORTS } from '@shared/config';
import ChatGroupInfoPanel from '../../components/ChatGroupInfoPanel';
import ChatGroupAvatar from '../../components/ChatGroupAvatar';
import ChatImagePreview from '../../components/ChatImagePreview';
import { chatPinnedPreview } from '../../utils/chatPinnedPreview';
import ChatMessageBubble from '../../components/ChatMessageBubble';
import MentionInput, { extractMentions, MentionMember } from '../../components/MentionInput';
import { ChatAttachmentMenu, VoiceRecorder } from '../../components/ChatAttachmentMenu';
import { FileAttachment, MessageStatus } from '../../utils/websocketService';
import { useT } from '../../i18n';

const glassCardStyle = "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

// ── Types ────────────────────────────────────────────────────────────────
interface Message {
    id: string;
    senderName: string;
    senderAvatar?: string | null;
    message: string;
    createdAt: string;
    userId: string;
    deleted?: boolean;
    pinned?: boolean;
    system?: boolean;
    isDeleted?: boolean;
    attachment?: FileAttachment | null;
    status?: MessageStatus;
}

interface SlotShape {
    day: string;
    startTime: string;
    endTime: string;
}

interface ChatGroupListItem {
    groupId: string;
    myRole: 'student' | 'professor' | 'ta' | 'admin';
    muted: boolean;
    name: string;
    description: string | null;
    photoUrl: string | null;
    memberCount: number;
    sectionId: string;
    courseCode: string | null;
    courseTitle: string | null;
    sectionType: string | null;
    sectionLabel: string | null;
    slots: SlotShape[];
}

// ── Main page ────────────────────────────────────────────────────────────
const ProfChatroom: React.FC = () => {
    const t = useT();
    const [groups, setGroups] = useState<ChatGroupListItem[]>([]);
    const [groupsError, setGroupsError] = useState<string | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [chatMembers, setChatMembers] = useState<MentionMember[]>([]);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [readOnly, setReadOnly] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    // Plan 9 mobile pass — WhatsApp-style single-panel flow on `<lg`.
    const [mobileView, setMobileView] = useState<'list' | 'chat' | 'info'>('list');
    const [systemMsg, setSystemMsg] = useState('');
    const [showAnnounceComposer, setShowAnnounceComposer] = useState(false);
    const [pinnedMsgId, setPinnedMsgId] = useState<string | null>(null);
    // Staff-only composer state — pending attachment + image preview overlay.
    const [pendingAttachment, setPendingAttachment] = useState<FileAttachment | null>(null);
    const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
    const [composerError, setComposerError] = useState<string | null>(null);

    const socketRef = useRef<Socket | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const selectedGroup = useMemo(
        () => groups.find((g) => g.groupId === selectedGroupId) ?? null,
        [groups, selectedGroupId],
    );
    const selectedCourseCode = selectedGroup?.courseCode ?? '';
    const selectedSectionId = selectedGroup?.sectionId ?? '';
    // Ref mirror of the active section so socket handlers can always read
    // the LATEST value (closure captures go stale on fast group switches).
    const activeSectionRef = useRef<string>('');
    activeSectionRef.current = selectedSectionId;
    // Profs are always moderators in their own course's chat. The flag is
    // declared here so the readOnly gate logic stays symmetric across the
    // three chatroom surfaces.
    const isModerator = true;

    const loadGroups = useCallback(async () => {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${API_URLS.chat()}/api/chat/groups/me`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            // 503 with reason='firestore_not_enabled' → surface admin hint;
            // other errors fall through to the generic empty state.
            try {
                const body = await res.json();
                if (body && body.reason === 'firestore_not_enabled') {
                    setGroupsError(body.message || 'Chat backend (Firestore) not reachable.');
                } else if (body && body.error) {
                    setGroupsError(String(body.error));
                }
            } catch { /* non-JSON body */ }
            setGroups([]);
            return [];
        }
        setGroupsError(null);
        const data: ChatGroupListItem[] = await res.json();
        setGroups(data);
        return data;
    }, []);

    useEffect(() => {
        let mounted = true;
        (async () => {
            const data = await loadGroups();
            if (mounted && data.length > 0 && !selectedGroupId) {
                setSelectedGroupId(data[0].groupId);
            }
            setIsLoading(false);
        })();
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadGroups]);

    // Socket lifecycle. The room key is now sectionId-based on the server,
    // so messages on Lec01 don't bleed into Sec01 of the same course. We
    // still pass courseCode for back-compat metadata.
    useEffect(() => {
        // sectionId is the canonical group key (course section ID for
        // course chats; tenant-prefixed staff group docId for staff
        // chats). courseCode is OPTIONAL — staff groups have no
        // courseCode, so the prior `if (!selectedCourseCode) return`
        // gate caused the socket to never open for staff_all / staff_*
        // and the previous course's messages to stay on screen.
        if (!selectedSectionId) return;
        // Wipe prior group's messages before opening the new socket so the
        // old course's thread doesn't briefly flash for the new selection.
        // (See identical fix in student/Chatroom.tsx — same race window.)
        setMessages([]);
        setReadOnly(false);
        setPinnedMsgId(null);

        const token = localStorage.getItem('authToken');
        // `scope: 'single-room'` — chatroom page listens to ONE section
        // only. Cross-room chime handled by NotificationContext's socket.
        {
            const { url, path } = getSocketEndpoint(PORTS.CHAT);
            socketRef.current = io(url, {
                ...(path ? { path } : {}),
                auth: { token: token ?? '', scope: 'single-room' },
            });
        }

        const userData = {
            userId: localStorage.getItem('currentUserId'),
            name: localStorage.getItem('currentUserFirstName'),
            role: 'professor',
        };

        socketRef.current.emit('user:join', userData);
        socketRef.current.emit('chat:join', {
            courseCode: selectedCourseCode,
            sectionId: selectedSectionId,
            userName: userData.name,
        });

        // Normalise raw DB rows so `system` (DB column) becomes `system: true`
        // on the local model — the announcement bubble renders off this.
        const normaliseMsg = (raw: Message & { createdAt?: string; system?: boolean }): Message => ({
            ...raw,
            // legacy rows have `createdAt` only
            createdAt: raw.createdAt || (raw as { sentAt?: string }).sentAt || new Date().toISOString(),
            system: raw.system === true || raw.system === undefined ? raw.system : false,
        });

        const myUserId = localStorage.getItem('currentUserId') || '';
        // Mark received messages as read on arrival — fires the server
        // chat:markRead handler which updates the DB and broadcasts
        // chat:messagesRead so the SENDER's bubble flips to double purple.
        const markIncomingRead = (incoming: Message[]) => {
            const ids = incoming
                .filter((m) => m.id && m.userId !== myUserId && !m.system)
                .map((m) => m.id);
            if (ids.length > 0) {
                socketRef.current?.emit('chat:markRead', {
                    messageIds: ids,
                    sectionId: selectedSectionId,
                    courseCode: selectedCourseCode,
                });
            }
        };

        const handleHistory = ({ sectionId: historySectionId, messages: history }: { sectionId?: string; messages: Message[] }) => {
            // Drop stale-section payloads (fast group switch races) — see
            // the matching student Chatroom for the rationale + same fix.
            if (historySectionId && historySectionId !== activeSectionRef.current) return;
            const visible = history.filter((m) => !m.isDeleted && !m.deleted).map(normaliseMsg);
            setMessages(visible);
            const pinned = visible.find((m) => m.pinned);
            if (pinned) setPinnedMsgId(pinned.id);
            markIncomingRead(visible);
        };
        const handleNewMessage = ({ message, tempId, sectionId: msgSectionId }: { message: Message; tempId?: string | null; sectionId?: string }) => {
            // Socket auto-joins every section the prof teaches so global
            // chime works cross-room. Filter via the LIVE ref so the open
            // panel only shows THIS section's messages even after a fast
            // group switch (closure capture goes stale).
            if (msgSectionId && msgSectionId !== activeSectionRef.current) return;
            if (message.isDeleted || message.deleted) return;
            const normalised = normaliseMsg(message);
            setMessages((prev) => {
                // If the server is echoing back a message we just sent
                // optimistically, replace the pending row in place rather
                // than appending a duplicate. Match by tempId first, fall
                // back to id for non-optimistic flows.
                if (tempId) {
                    const idx = prev.findIndex((m) => m.id === tempId);
                    if (idx >= 0) {
                        const next = [...prev];
                        next[idx] = { ...normalised, status: 'sent' };
                        return next;
                    }
                }
                if (prev.some((m) => m.id === normalised.id)) return prev;
                return [...prev, normalised];
            });
            // Incoming non-self message — mark read. Sound is owned by the
            // global chat socket in NotificationContext (which auto-joins
            // every section room and rings only when the user is NOT on a
            // chatroom URL). Ringing here would double-ring or ring while
            // actively reading the thread — both wrong.
            if (message.userId !== myUserId && !message.system) {
                markIncomingRead([normalised]);
            }
        };
        const handleMessagesRead = ({ messageIds }: { messageIds: string[] }) => {
            // Sender-side: bump our local copy to status='read' so the
            // bubble switches to the double purple check.
            setMessages((prev) =>
                prev.map((m) => (messageIds.includes(m.id) ? { ...m, status: 'read' } : m)),
            );
        };
        const handleMessageDeleted = ({ messageId }: { messageId: string }) => {
            setMessages((prev) => prev.filter((m) => m.id !== messageId));
            setPinnedMsgId((prev) => (prev === messageId ? null : prev));
        };
        const handleMessagePinned = ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
            setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, pinned } : m)));
            if (pinned) setPinnedMsgId(messageId);
            else setPinnedMsgId((prev) => (prev === messageId ? null : prev));
        };
        const handleReadonlyChanged = ({ readOnly: ro }: { readOnly: boolean }) => setReadOnly(ro);
        // Poll vote broadcast — fan out to <PollAttachment> instances via
        // a custom window event so the bubble doesn't need socket access.
        const handlePollVoted = (data: { messageId: string; tallies: Record<string, number>; totalVoters: number }) => {
            window.dispatchEvent(new CustomEvent('uniflow:poll-update', { detail: data }));
        };
        // Live promote / demote — when the prof or chat-admin updates a
        // member's role, the server broadcasts the change. We update the
        // affected user's myRole locally (so isModerator + the lock /
        // composer toolbar update without a refresh), and also fire a
        // window event so the open ChatGroupInfoPanel can re-fetch its
        // member list.
        const myUserIdForRole = localStorage.getItem('currentUserId') || '';
        const handleRoleChanged = (data: { sectionId: string; userId: string; role: string }) => {
            setGroups((prev) =>
                prev.map((g) =>
                    g.groupId === data.sectionId && data.userId === myUserIdForRole
                        ? { ...g, myRole: data.role as ChatGroupListItem['myRole'] }
                        : g,
                ),
            );
            window.dispatchEvent(
                new CustomEvent('uniflow:chat-role-changed', { detail: data }),
            );
        };
        // Section-wide wipe by an admin — drop every local message and the
        // pinned marker so the thread renders empty without a refresh.
        const handleClearAll = () => {
            setMessages([]);
            setPinnedMsgId(null);
        };
        // Group meta updated (name / description / photo). Patch the local
        // group list so the sidebar avatar + header avatar refresh without a
        // page reload, and dispatch a window event so an open ChatGroupInfoPanel
        // can re-fetch its detail block.
        const handleGroupUpdated = (data: { sectionId: string; name?: string; description?: string | null; photoUrl?: string | null }) => {
            setGroups((prev) =>
                prev.map((g) =>
                    g.groupId === data.sectionId
                        ? {
                            ...g,
                            ...(data.name !== undefined ? { name: data.name } : {}),
                            ...(data.description !== undefined ? { description: data.description } : {}),
                            ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl } : {}),
                        }
                        : g,
                ),
            );
            window.dispatchEvent(
                new CustomEvent('uniflow:chat-group-updated', { detail: data }),
            );
        };

        socketRef.current.on('chat:history', handleHistory);
        socketRef.current.on('chat:newMessage', handleNewMessage);
        socketRef.current.on('chat:messagesRead', handleMessagesRead);
        socketRef.current.on('chat:messageDeleted', handleMessageDeleted);
        socketRef.current.on('chat:messagePinned', handleMessagePinned);
        socketRef.current.on('chat:readonlyChanged', handleReadonlyChanged);
        socketRef.current.on('chat:pollVoted', handlePollVoted);
        socketRef.current.on('chat:clearAll', handleClearAll);
        socketRef.current.on('chat:roleChanged', handleRoleChanged);
        socketRef.current.on('chat:groupUpdated', handleGroupUpdated);

        fetch(`${API_URLS.chat()}/api/chat/group/${selectedSectionId}/readonly`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => r.json())
            .then((d) => setReadOnly(d.readOnly ?? false))
            .catch(() => {});

        return () => {
            socketRef.current?.off('chat:history', handleHistory);
            socketRef.current?.off('chat:newMessage', handleNewMessage);
            socketRef.current?.off('chat:messagesRead', handleMessagesRead);
            socketRef.current?.off('chat:messageDeleted', handleMessageDeleted);
            socketRef.current?.off('chat:messagePinned', handleMessagePinned);
            socketRef.current?.off('chat:readonlyChanged', handleReadonlyChanged);
            socketRef.current?.off('chat:pollVoted', handlePollVoted);
            socketRef.current?.off('chat:clearAll', handleClearAll);
            socketRef.current?.off('chat:roleChanged', handleRoleChanged);
            socketRef.current?.off('chat:groupUpdated', handleGroupUpdated);
            socketRef.current?.disconnect();
        };
    }, [selectedCourseCode, selectedSectionId]);

    // Fetch group members for the @-mention popup. Refreshes whenever the
    // user switches groups; powered by GET /api/chat/groups/:groupId which
    // returns the full member list with names + roles + profile pictures.
    useEffect(() => {
        if (!selectedSectionId) {
            setChatMembers([]);
            return;
        }
        let cancelled = false;
        const token = localStorage.getItem('authToken');
        fetch(`${API_URLS.chat()}/api/chat/groups/${selectedSectionId}`, {
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data) return;
                const members = (data.members || []).map((m: { userId: string; firstName: string; lastName: string; role: string; systemRole?: string; profilePicture?: string | null }) => ({
                    userId: m.userId,
                    firstName: m.firstName,
                    lastName: m.lastName,
                    role: m.role,
                    systemRole: m.systemRole,
                    profilePicture: m.profilePicture,
                }));
                setChatMembers(members);
            })
            .catch(() => {
                if (!cancelled) setChatMembers([]);
            });
        return () => { cancelled = true; };
    }, [selectedSectionId]);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        // Allow send if EITHER text OR attachment is present.
        // readOnly only blocks regular members; chat-admin students + system staff
        // (professor/TA/admin) bypass per the backend isModerator policy.
        if ((!inputValue.trim() && !pendingAttachment) || (readOnly && !isModerator) || !selectedCourseCode) return;
        const fallbackText = pendingAttachment
            ? pendingAttachment.type === 'image'
                ? t('chatroomPage.sentImage')
                : pendingAttachment.type === 'video'
                ? t('chatroomPage.sentVideo')
                : pendingAttachment.type === 'audio'
                ? t('chatroomPage.sentVoiceNote')
                : t('chatroomPage.sentFile')
            : '';
        const text = inputValue.trim() || fallbackText;
        const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const myId = localStorage.getItem('currentUserId') || '';
        const myName = localStorage.getItem('currentUserFirstName') || '';
        const myAvatar = localStorage.getItem('currentUserPicture') || undefined;

        // Optimistic insert — message shows up immediately with the clock
        // icon. Replaced by the server echo (status: 'sent') when the
        // chat:newMessage event fires with the matching tempId.
        setMessages((prev) => [
            ...prev,
            {
                id: tempId,
                userId: myId,
                senderName: myName,
                senderAvatar: myAvatar,
                message: text,
                createdAt: new Date().toISOString(),
                attachment: pendingAttachment ?? null,
                status: 'pending' as MessageStatus,
            },
        ]);

        // Mentions — derived from the typed text by matching member
        // display names. The MentionInput component already wrote the
        // mention names into the text on selection; this picks them out
        // again deterministically so the server gets a structured list.
        const mentions = extractMentions(text, chatMembers);
        socketRef.current?.emit('chat:message', {
            courseCode: selectedCourseCode,
            sectionId: selectedSectionId || undefined,
            userId: myId,
            senderName: myName,
            senderAvatar: myAvatar,
            message: text,
            attachment: pendingAttachment ?? undefined,
            mentions,
            tempId,
        });
        setNewMessage('');
        setPendingAttachment(null);
    };

    /**
     * Voice notes auto-send the moment recording stops — staff don't get
     * a "review" step for voice (same as WhatsApp). Same optimistic
     * pending → sent flow as text messages.
     */
    const sendVoiceNote = useCallback(
        (voice: FileAttachment) => {
            if ((readOnly && !isModerator) || !selectedCourseCode) return;
            const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const myId = localStorage.getItem('currentUserId') || '';
            const myName = localStorage.getItem('currentUserFirstName') || '';
            const myAvatar = localStorage.getItem('currentUserPicture') || undefined;
            setMessages((prev) => [
                ...prev,
                {
                    id: tempId,
                    userId: myId,
                    senderName: myName,
                    senderAvatar: myAvatar,
                    message: t('chatroomPage.sentVoiceNote'),
                    createdAt: new Date().toISOString(),
                    attachment: voice,
                    status: 'pending' as MessageStatus,
                },
            ]);
            socketRef.current?.emit('chat:message', {
                courseCode: selectedCourseCode,
                sectionId: selectedSectionId || undefined,
                userId: myId,
                senderName: myName,
                senderAvatar: myAvatar,
                message: t('chatroomPage.sentVoiceNote'),
                attachment: voice,
                tempId,
            });
        },
        [readOnly, isModerator, selectedCourseCode, selectedSectionId, t],
    );

    const handleDeleteMessage = useCallback(async (msgId: string) => {
        // selectedSectionId MUST be in the deps array — empty deps capture
        // the initial empty string and the request 400s on every click.
        if (!selectedSectionId) return;
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URLS.chat()}/api/chat/messages/${msgId}?sectionId=${encodeURIComponent(selectedSectionId)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        });
    }, [selectedSectionId]);

    const handlePinMessage = useCallback(async (msgId: string) => {
        // Same stale-closure trap as handleDeleteMessage above.
        if (!selectedSectionId) return;
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URLS.chat()}/api/chat/messages/${msgId}/pin?sectionId=${encodeURIComponent(selectedSectionId)}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}` },
        });
    }, [selectedSectionId]);

    const handleToggleReadOnly = useCallback(async () => {
        if (!selectedSectionId) return;
        // Capture the target at click time to avoid the toggle race:
        // the server emits chat:readonlyChanged BEFORE returning the HTTP
        // response, so when this fetch resolves the broadcast handler has
        // already flipped local state. setReadOnly((p) => !p) on success
        // would invert it back. Setting to the explicit target makes both
        // updates idempotent.
        const target = !readOnly;
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${API_URLS.chat()}/api/chat/group/${selectedSectionId}/readonly`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: target }),
        });
        if (res.ok) setReadOnly(target);
    }, [selectedSectionId, readOnly]);

    const handleSendSystemMsg = useCallback(async () => {
        if (!systemMsg.trim() || !selectedCourseCode) return;
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URLS.chat()}/api/chat/system-message`, {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                courseCode: selectedCourseCode,
                sectionId: selectedSectionId || undefined,
                content: systemMsg,
            }),
        });
        setSystemMsg('');
    }, [selectedCourseCode, selectedSectionId, systemMsg]);

    const gridCols = showInfo ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('chatroomPage.heading')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">
                    {t('professor.pcrHeadingSubtitle')}
                </p>
            </AnimateOnView>

            <AnimateOnView delay={0.1}>
                {/* Plan 9 follow-up — mobile uses flex column so the visible
                    panel can take `flex-1` and constrain the inner scroll
                    container; lg+ falls back to grid for the side-by-side view. */}
                <div className={`flex flex-col lg:grid lg:grid-cols-1 ${gridCols} gap-4 h-[calc(100vh-16rem)] min-h-0`}>
                    {/* Group list — on mobile (<lg), hidden when user is
                        viewing a chat or info panel (WhatsApp pattern). */}
                    <div className={`${glassCardStyle} p-4 flex-col overflow-hidden flex-1 min-h-0 lg:flex-none lg:col-span-1 lg:flex ${mobileView === 'list' ? 'flex' : 'hidden'}`}>
                        <h3 className="text-black dark:text-white font-bold mb-3">{t('chatroomPage.groupsTitle')}</h3>
                        <div className="flex-1 overflow-y-auto space-y-1">
                            {isLoading ? (
                                [1, 2, 3].map((i) => (
                                    <div key={i} className="h-16 w-full bg-white/5 animate-pulse rounded-xl"></div>
                                ))
                            ) : groups.length === 0 ? (
                                groupsError ? (
                                    <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 leading-relaxed">
                                        <p className="font-semibold mb-1">{t('chatroomPage.backendUnreachable')}</p>
                                        <p className="opacity-90 break-words">{groupsError}</p>
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500 text-center py-6">
                                        {t('professor.pcrNoSectionGroups')}
                                    </p>
                                )
                            ) : (
                                groups.map((g) => {
                                    return (
                                        <button
                                            key={g.groupId}
                                            onClick={() => { setSelectedGroupId(g.groupId); setMobileView('chat'); }}
                                            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                                                selectedGroupId === g.groupId
                                                    ? 'bg-[#6A3FF4]/20 border border-[#6A3FF4]/30 shadow-lg'
                                                    : 'hover:bg-white/5 border border-transparent'
                                            }`}
                                        >
                                            <ChatGroupAvatar group={g} size="md" shape="square" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-black dark:text-white text-sm font-bold truncate">{g.name}</p>
                                                <p className="text-gray-500 text-[10px] truncate">
                                                    {g.memberCount} {g.memberCount === 1 ? t('professor.pcrMemberSingular') : t('professor.pcrMemberPlural')}
                                                    {g.muted && ` · ${t('professor.pcrMutedSuffix')}`}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Chat area — on mobile, visible only when mobileView === 'chat'. */}
                    <div className={`${glassCardStyle} flex-col overflow-hidden flex-1 min-h-0 lg:flex-none lg:col-span-2 lg:flex ${mobileView === 'chat' ? 'flex' : 'hidden'}`}>
                        {/* Header */}
                        <div className="px-3 sm:px-4 py-2 border-b border-white/10 flex items-center justify-between bg-black/10">
                            {/* Mobile back arrow — returns to the group list. */}
                            <button
                                onClick={() => setMobileView('list')}
                                aria-label={t('professor.pcrBackToGroups')}
                                className="lg:hidden mr-1 w-9 h-9 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                            >
                                <i className="ph-bold ph-arrow-left text-lg" />
                            </button>
                            <button
                                onClick={() => { setShowInfo(true); setMobileView('info'); }}
                                disabled={!selectedGroup}
                                className="flex items-center gap-3 text-left flex-1 min-w-0 hover:bg-white/5 rounded-lg -m-1 p-1 transition-colors"
                                title={t('professor.pcrGroupInfo')}
                            >
                                {selectedGroup ? (
                                    <ChatGroupAvatar group={selectedGroup} size="sm" shape="round" />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-[#6A3FF4]/20 flex items-center justify-center text-[#6A3FF4] flex-shrink-0">
                                        <i className="ph-fill ph-users-three"></i>
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-black dark:text-white truncate">
                                        {selectedGroup?.name ?? t('professor.pcrSelectGroup')}
                                    </p>
                                    {selectedGroup && (
                                        <p className="text-[10px] text-gray-500 truncate">
                                            {t('professor.pcrMembersInfo', { n: selectedGroup.memberCount })}
                                        </p>
                                    )}
                                </div>
                            </button>
                            <div className="flex items-center flex-shrink-0 ml-2">
                                {/* Glass-morphism Read-only toggle. Single element
                                    (no separate badge) to avoid the prior dual-pill
                                    visual glitch. ON tints purple, OFF stays neutral
                                    glass — both states use backdrop-blur. */}
                                <button
                                    onClick={handleToggleReadOnly}
                                    title={readOnly ? t('professor.pcrUnlockTip') : t('professor.pcrLockTip')}
                                    aria-pressed={readOnly}
                                    className={`group flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl border backdrop-blur-xl transition-all ${
                                        readOnly
                                            ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 text-[#bda8ff] shadow-md shadow-[#6A3FF4]/10'
                                            : 'bg-white/5 dark:bg-black/20 border-white/15 dark:border-white/10 text-gray-500 dark:text-gray-300 hover:bg-white/10 hover:text-black dark:hover:text-white'
                                    }`}
                                >
                                    <i className={`ph-fill ${readOnly ? 'ph-lock-simple' : 'ph-lock-simple-open'} text-sm transition-transform group-hover:scale-110`}></i>
                                    <span className="leading-none">{t('chatroomPage.readOnlyShort')}</span>
                                    <span
                                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                                            readOnly
                                                ? 'bg-[#6A3FF4]/30 text-[#dec6ff]'
                                                : 'bg-white/10 dark:bg-white/5 text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                        {readOnly ? 'ON' : 'OFF'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Pinned banner — chatPinnedPreview picks the right text + icon
                            so attachments (image/video/voice/document/poll) don't
                            render an empty banner. */}
                        {pinnedMsgId && (() => {
                            const pinned = messages.find((m) => m.id === pinnedMsgId);
                            const { text, icon } = chatPinnedPreview(pinned);
                            return (
                                <div className="px-4 py-2 bg-[#6A3FF4]/10 border-b border-[#6A3FF4]/20 flex items-center gap-2 text-xs text-[#6A3FF4]">
                                    <i className="ph-bold ph-push-pin"></i>
                                    <i className={`ph-fill ${icon}`}></i>
                                    <span className="truncate font-medium">{t('professor.pcrPinnedPrefix', { text })}</span>
                                </div>
                            );
                        })()}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                            {!selectedGroup ? (
                                <div className="flex items-center justify-center h-full">
                                    <p className="text-sm text-gray-500">{t('professor.pcrPickGroupHint')}</p>
                                </div>
                            ) : (
                                messages.map((msg, idx) => {
                                    if (msg.system) {
                                        // Announcement bubble — staff/admins get a hover-revealed
                                        // delete button so a stale or wrong announcement can be
                                        // pulled without nuking the whole chat.
                                        const isStaff = ['professor', 'ta', 'admin'].includes(
                                            (selectedGroup?.myRole || '') as string,
                                        );
                                        return (
                                            <div key={msg.id} className="flex justify-center my-3 group relative">
                                                <div className="inline-flex items-start gap-2 max-w-[85%] px-4 py-2.5 rounded-2xl border-2 border-[#7B5AFF] shadow-lg shadow-[#6A3FF4]/30">
                                                    <i className="ph-fill ph-megaphone-simple text-[#7B5AFF] text-base flex-shrink-0 mt-0.5"></i>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#7B5AFF] mb-0.5">{t('professor.pcrAnnouncementBadge')}</p>
                                                        <p className="text-xs text-black dark:text-white whitespace-pre-wrap break-words">{msg.message}</p>
                                                    </div>
                                                </div>
                                                {isStaff && (
                                                    <button
                                                        onClick={() => handleDeleteMessage(msg.id)}
                                                        title={t('professor.pcrDeleteAnn')}
                                                        className="absolute -top-2 -right-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-md bg-black/50 text-white hover:bg-red-500/70 text-xs flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash"></i>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }
                                    const isMe = msg.userId === localStorage.getItem('currentUserId');
                                    const prev = idx > 0 ? messages[idx - 1] : null;
                                    // Suppress avatar+name on consecutive messages from the
                                    // same sender — keeps the stream tighter, like WhatsApp.
                                    const showSenderInfo =
                                        !isMe && (!prev || prev.userId !== msg.userId || !!prev.system);
                                    return (
                                        <ChatMessageBubble
                                            key={msg.id}
                                            id={msg.id}
                                            text={msg.message}
                                            timestamp={msg.createdAt}
                                            isMe={isMe}
                                            showSenderInfo={showSenderInfo}
                                            sender={{
                                                name: msg.senderName,
                                                avatar: msg.senderAvatar,
                                                // Default the avatar to the student gradient for
                                                // received messages — accurate for the common case
                                                // (the prof's own messages don't render an avatar
                                                // anyway). Mapping userId → real role would need a
                                                // group-member lookup we can wire later.
                                                role: isMe ? 'professor' : 'student',
                                            }}
                                            status={msg.status ?? 'sent'}
                                            pinned={msg.pinned}
                                            attachment={msg.attachment ?? undefined}
                                            onImageClick={(att) =>
                                                setPreviewImage({ url: att.url, name: att.name })
                                            }
                                            sectionId={selectedSectionId}
                                            moderationActions={
                                                <>
                                                    <button
                                                        onClick={() => handleDeleteMessage(msg.id)}
                                                        title={t('professor.pcrDeleteMsg')}
                                                        className="w-6 h-6 rounded-md bg-black/40 text-white hover:bg-red-500/60 text-xs flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash"></i>
                                                    </button>
                                                    <button
                                                        onClick={() => handlePinMessage(msg.id)}
                                                        title={msg.pinned ? t('professor.pcrUnpinMsg') : t('professor.pcrPinMsg')}
                                                        className={`w-6 h-6 rounded-md bg-black/40 text-white hover:bg-[#6A3FF4]/60 text-xs flex items-center justify-center ${
                                                            msg.pinned ? 'text-[#6A3FF4] bg-[#6A3FF4]/20' : ''
                                                        }`}
                                                    >
                                                        <i className="ph-bold ph-push-pin"></i>
                                                    </button>
                                                </>
                                            }
                                        />
                                    );
                                })
                            )}
                            <div ref={scrollRef} />
                        </div>

                        {/* System announcement composer — collapsed by default,
                            expands into a labeled card. Visible only to staff
                            and group-admins. The card mirrors the design of
                            the announcement bubble so the prof sees what's
                            about to land in the thread. */}
                        {selectedGroup && ['professor', 'ta', 'admin'].includes(selectedGroup.myRole) && (
                            showAnnounceComposer ? (
                                <div className="px-4 pt-3 pb-2 border-t-2 border-[#6A3FF4]/40">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <i className="ph-fill ph-megaphone-simple text-[#7B5AFF]"></i>
                                            <span className="text-xs font-bold text-[#7B5AFF] uppercase tracking-wider">{t('professor.pcrAnnouncerTitle')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setShowAnnounceComposer(false); setSystemMsg(''); }}
                                            className="w-6 h-6 rounded-md text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/10 flex items-center justify-center text-xs"
                                            title={t('professor.pcrCloseShort')}
                                        >
                                            <i className="ph-bold ph-x"></i>
                                        </button>
                                    </div>
                                    <textarea
                                        value={systemMsg}
                                        onChange={(e) => setSystemMsg(e.target.value)}
                                        rows={3}
                                        placeholder={t('professor.pcrAnnPlaceholder')}
                                        className="w-full bg-transparent border-2 border-[#6A3FF4]/40 rounded-xl px-3 py-2 text-sm text-black dark:text-white outline-none focus:border-[#6A3FF4] resize-none placeholder:text-gray-500"
                                    />
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] text-gray-500">
                                            {t('professor.pcrAnnFooterNote')}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSystemMsg('')}
                                                disabled={!systemMsg}
                                                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/5 disabled:opacity-30"
                                            >
                                                {t('professor.pcrClearBtn')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    await handleSendSystemMsg();
                                                    setShowAnnounceComposer(false);
                                                }}
                                                disabled={!systemMsg.trim()}
                                                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-xs font-bold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                            >
                                                <i className="ph-bold ph-paper-plane-tilt"></i>
                                                {t('professor.pcrSendAnnouncement')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-4 py-2 border-t border-white/10 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setShowAnnounceComposer(true)}
                                        className="text-xs font-bold text-[#7B5AFF] hover:text-[#6A3FF4] flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#6A3FF4]/10 transition-colors"
                                    >
                                        <i className="ph-bold ph-megaphone-simple"></i>
                                        {t('professor.pcrNewAnnouncement')}
                                    </button>
                                </div>
                            )
                        )}

                        {/* Pending attachment preview — appears above the input
                            when the staff has picked a file but not yet sent it.
                            Click the X to discard. Voice notes auto-send so they
                            never land here. */}
                        {pendingAttachment && (
                            <div className="px-4 py-3 border-t border-[#6A3FF4]/30 flex items-center gap-3">
                                <div className="w-12 h-12 bg-[#6A3FF4]/15 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <i
                                        className={`ph-fill text-xl text-[#7B5AFF] ${
                                            pendingAttachment.type === 'image'
                                                ? 'ph-image'
                                                : pendingAttachment.type === 'video'
                                                ? 'ph-video-camera'
                                                : pendingAttachment.type === 'audio'
                                                ? 'ph-microphone'
                                                : 'ph-file-text'
                                        }`}
                                    ></i>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-black dark:text-white truncate">
                                        {pendingAttachment.name}
                                    </p>
                                    <p className="text-[11px] text-gray-500 capitalize">
                                        {t('professor.pcrAttachmentReady', { type: pendingAttachment.type })}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPendingAttachment(null)}
                                    className="w-7 h-7 rounded-md bg-white/5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 flex items-center justify-center"
                                    title={t('professor.pcrDiscardAttachment')}
                                >
                                    <i className="ph-bold ph-x"></i>
                                </button>
                            </div>
                        )}

                        {composerError && (
                            <div className="px-4 py-2 text-xs text-red-400 border-t border-red-500/20">
                                <i className="ph-bold ph-warning-circle mr-1"></i>
                                {composerError}
                            </div>
                        )}

                        {/* Input — when read-only is on, non-moderator members see a notice
                            instead of the composer. Moderators (chat-admin students,
                            prof/TA, system admin) keep the composer so they can still
                            post announcements / corrections. */}
                        {readOnly && !isModerator ? (
                            <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-center">
                                <span className="text-gray-500 text-sm flex items-center gap-2">
                                    <i className="ph-fill ph-lock-simple text-[#6A3FF4]"></i>
                                    {t('professor.pcrReadOnlyNotice')}
                                </span>
                            </div>
                        ) : selectedGroup ? (
                            <form onSubmit={handleSend} className="px-4 py-3 border-t border-white/10">
                                <div className="flex items-center gap-1.5 bg-white/50 dark:bg-black/30 border border-white/30 dark:border-white/10 rounded-xl px-2 py-1.5 backdrop-blur-sm">
                                    <ChatAttachmentMenu
                                        onAttach={(att) => {
                                            setPendingAttachment(att);
                                            setComposerError(null);
                                        }}
                                        allowStaffOnly={isModerator}
                                        onError={(text) => setComposerError(text)}
                                    />
                                    <MentionInput
                                        value={inputValue}
                                        onChange={setNewMessage}
                                        members={chatMembers}
                                        placeholder={t('professor.pcrComposerPlaceholder')}
                                        className="w-full bg-transparent border-none focus:outline-none text-sm text-black dark:text-white px-2"
                                    />
                                    <VoiceRecorder
                                        onRecorded={(voice) => {
                                            sendVoiceNote(voice);
                                            setComposerError(null);
                                        }}
                                        onError={(text) => setComposerError(text)}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!inputValue.trim() && !pendingAttachment}
                                        className="w-10 h-10 rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <i className="ph-fill ph-paper-plane-tilt text-white"></i>
                                    </button>
                                </div>
                            </form>
                        ) : null}
                    </div>

                    {/* Group Info panel — `h-full min-h-0` so the panel's
                        inner overflow-y-auto can constrain to the grid cell
                        height (otherwise a long member list expands the
                        whole page). On mobile, visible only when
                        mobileView === 'info'; closing returns the user to
                        the chat pane (not the list). */}
                    {showInfo && selectedGroupId && (
                        // Mobile: `flex-1 min-h-0` so the panel fills the
                        // remaining flex space and the inner `overflow-y-auto`
                        // constrains correctly (a long member list previously
                        // overflowed the viewport without scrolling).
                        <div className={`flex-1 min-h-0 lg:flex-none lg:col-span-1 lg:h-full lg:block ${mobileView === 'info' ? 'block' : 'hidden'}`}>
                            <ChatGroupInfoPanel
                                groupId={selectedGroupId}
                                onClose={() => { setShowInfo(false); setMobileView('chat'); }}
                                onGroupUpdated={() => loadGroups()}
                            />
                        </div>
                    )}
                </div>
            </AnimateOnView>

            {previewImage && (
                <ChatImagePreview
                    url={previewImage.url}
                    name={previewImage.name}
                    onClose={() => setPreviewImage(null)}
                />
            )}
        </div>
    );
};

export default ProfChatroom;
