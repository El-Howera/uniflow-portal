/**
 * AdminChatroom — staff-only chat surface for admins (and admin sub-scope
 * roles: financial / it).
 *
 * MVP BUILD — pure front-end mockup. No Socket.io / no backend calls. The 6
 * staff groups + their message threads are static mock data; send, delete,
 * pin, read-only toggle, and system announcements are all local-only state
 * mutations (no network).
 *
 * There are 6 stable staff groups:
 *   - staff_all          — Staff — All
 *   - staff_financials   — Staff — Financials
 *   - staff_sa           — Staff — Student Affairs
 *   - staff_ta           — Staff — Teaching Assistants
 *   - staff_professors   — Staff — Professors
 *   - staff_it           — Staff — IT
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import ChatImagePreview from '../../components/ChatImagePreview';
import { chatPinnedPreview } from '../../utils/chatPinnedPreview';
import ChatMessageBubble from '../../components/ChatMessageBubble';
import MentionInput, { MentionMember } from '../../components/MentionInput';
import { FileAttachment, MessageStatus } from '../../utils/websocketService';
import { ChatAttachmentMenu, VoiceRecorder } from '../../components/ChatAttachmentMenu';
import ChatGroupInfoPanel from '../../components/ChatGroupInfoPanel';
import ChatGroupAvatar from '../../components/ChatGroupAvatar';
import { useT } from '../../i18n';

const glassCardStyle =
    "bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-2xl shadow-lg backdrop-filter backdrop-blur-xl";

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

interface StaffGroup {
    groupId: string;
    name: string;
    description: string | null;
    photoUrl: string | null;
    memberCount: number;
    myRole: 'student' | 'professor' | 'ta' | 'admin' | 'chat-admin' | 'member' | string;
    muted?: boolean;
    readOnly?: boolean;
}

// ── Static mock data ────────────────────────────────────────────────────────
const MOCK_GROUPS: StaffGroup[] = [
    { groupId: 'staff_all', name: 'Staff — All', description: 'All non-student staff members.', photoUrl: null, memberCount: 28, myRole: 'admin' },
    { groupId: 'staff_financials', name: 'Staff — Financials', description: 'Admin + financial officers.', photoUrl: null, memberCount: 5, myRole: 'admin' },
    { groupId: 'staff_sa', name: 'Staff — Student Affairs', description: 'Admin + student-affairs team.', photoUrl: null, memberCount: 6, myRole: 'admin' },
    { groupId: 'staff_ta', name: 'Staff — Teaching Assistants', description: 'Admin + teaching assistants.', photoUrl: null, memberCount: 9, myRole: 'admin' },
    { groupId: 'staff_professors', name: 'Staff — Professors', description: 'Admin + professors.', photoUrl: null, memberCount: 11, myRole: 'admin' },
    { groupId: 'staff_it', name: 'Staff — IT', description: 'Admin + IT team.', photoUrl: null, memberCount: 4, myRole: 'admin' },
];

const MOCK_MEMBERS: MentionMember[] = [
    { userId: 'admin-1', firstName: 'Hisham', lastName: 'Kamal', role: 'admin' },
    { userId: 'prof-1', firstName: 'Amira', lastName: 'Saleh', role: 'professor' },
    { userId: 'prof-2', firstName: 'Tarek', lastName: 'Mansour', role: 'professor' },
    { userId: 'ta-1', firstName: 'Karim', lastName: 'Adel', role: 'ta' },
    { userId: 'sa-1', firstName: 'Nour', lastName: 'Abdelrahman', role: 'sa' },
    { userId: 'fin-1', firstName: 'Mariam', lastName: 'El-Sayed', role: 'financial' },
    { userId: 'it-1', firstName: 'Omar', lastName: 'Hassan', role: 'it' },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
    staff_all: [
        { id: 'm1', userId: 'admin-1', senderName: 'Hisham Kamal', message: 'Reminder: Faculty Council meeting on May 6 at 1:00 PM in Hall A-204.', createdAt: '2026-04-28T08:00:00.000Z', status: 'read', system: true },
        { id: 'm2', userId: 'prof-1', senderName: 'Amira Saleh', message: 'Thanks Hisham — I will prepare the curriculum-review slides.', createdAt: '2026-04-28T08:05:00.000Z', status: 'read' },
        { id: 'm3', userId: 'sa-1', senderName: 'Nour Abdelrahman', message: 'Student Affairs will share the updated attendance policy draft before the meeting.', createdAt: '2026-04-28T08:12:00.000Z', status: 'read' },
        { id: 'm4', userId: 'admin-1', senderName: 'Hisham Kamal', message: 'Perfect. Please keep the agenda items to 5 minutes each.', createdAt: '2026-04-28T08:15:00.000Z', status: 'read' },
    ],
    staff_financials: [
        { id: 'f1', userId: 'fin-1', senderName: 'Mariam El-Sayed', message: 'The April reconciliation is complete — outstanding balances flagged for the cron.', createdAt: '2026-04-27T11:00:00.000Z', status: 'read' },
        { id: 'f2', userId: 'admin-1', senderName: 'Hisham Kamal', message: 'Great. Let me know if any students need a manual hold release.', createdAt: '2026-04-27T11:10:00.000Z', status: 'read' },
    ],
    staff_sa: [
        { id: 's1', userId: 'sa-1', senderName: 'Nour Abdelrahman', message: 'We have 12 pending registration approvals for Level 2 today.', createdAt: '2026-04-26T09:30:00.000Z', status: 'read' },
    ],
    staff_ta: [
        { id: 't1', userId: 'ta-1', senderName: 'Karim Adel', message: 'Lab C-204 projector is fixed — sessions can resume tomorrow.', createdAt: '2026-04-25T15:00:00.000Z', status: 'read' },
    ],
    staff_professors: [
        { id: 'p1', userId: 'prof-2', senderName: 'Tarek Mansour', message: 'Submitting final grades for DS310 by Thursday.', createdAt: '2026-04-24T10:00:00.000Z', status: 'read' },
        { id: 'p2', userId: 'prof-1', senderName: 'Amira Saleh', message: 'Same for CS101 — almost done with the term-work component.', createdAt: '2026-04-24T10:20:00.000Z', status: 'read' },
    ],
    staff_it: [
        { id: 'i1', userId: 'it-1', senderName: 'Omar Hassan', message: 'Scheduled maintenance window confirmed for May 1, 18:00–22:00.', createdAt: '2026-04-23T13:00:00.000Z', status: 'read' },
    ],
};

// ── Main page ────────────────────────────────────────────────────────────
const AdminChatroom: React.FC = () => {
    const t = useT();
    const [groups, setGroups] = useState<StaffGroup[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>('');
    const [chatMembers] = useState<MentionMember[]>(MOCK_MEMBERS);
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setNewMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [readOnly, setReadOnly] = useState(false);
    const [systemMsg, setSystemMsg] = useState('');
    const [showInfo, setShowInfo] = useState(false);
    // Plan 9 mobile pass — WhatsApp-style single-panel flow on `<lg`.
    const [mobileView, setMobileView] = useState<'list' | 'chat' | 'info'>('list');
    const [showAnnounceComposer, setShowAnnounceComposer] = useState(false);
    const [pinnedMsgId, setPinnedMsgId] = useState<string | null>(null);
    // Staff chat: composer attachment.
    const [pendingAttachment, setPendingAttachment] = useState<FileAttachment | null>(null);
    const [composerError, setComposerError] = useState<string | null>(null);
    const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

    // Per-group message store (mock, mutated locally as the user sends).
    const messagesByGroup = useRef<Record<string, Message[]>>(
        Object.fromEntries(Object.entries(MOCK_MESSAGES).map(([k, v]) => [k, v.map((m) => ({ ...m }))])),
    );
    const scrollRef = useRef<HTMLDivElement>(null);

    const selectedGroup = useMemo(
        () => groups.find((g) => g.groupId === selectedGroupId) ?? null,
        [groups, selectedGroupId],
    );
    const myRole = selectedGroup?.myRole ?? '';
    const isModerator = myRole === 'admin' || myRole === 'chat-admin';

    const myUserId = 'admin-1';
    const myName = 'Hisham';

    // Hydrate groups from mock data once on mount + auto-select the first.
    useEffect(() => {
        setGroups(MOCK_GROUPS.map((g) => ({ ...g })));
        if (MOCK_GROUPS.length > 0) setSelectedGroupId((prev) => prev || MOCK_GROUPS[0].groupId);
        setIsLoading(false);
    }, []);

    // Load the selected group's messages from the local store.
    useEffect(() => {
        if (!selectedGroupId) {
            setMessages([]);
            return;
        }
        const list = messagesByGroup.current[selectedGroupId] ?? [];
        const visible = list.filter((m) => !m.isDeleted && !m.deleted);
        setMessages(visible);
        const pinned = visible.find((m) => m.pinned);
        setPinnedMsgId(pinned ? pinned.id : null);
        setReadOnly(selectedGroup?.readOnly ?? false);
    }, [selectedGroupId, selectedGroup?.readOnly]);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Persist the visible thread back into the per-group store so switching
    // groups and returning keeps the mutations.
    const persist = (groupId: string, next: Message[]) => {
        messagesByGroup.current[groupId] = next;
    };

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if ((!inputValue.trim() && !pendingAttachment) || (readOnly && !isModerator) || !selectedGroupId) return;
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
        const newMsg: Message = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userId: myUserId,
            senderName: myName,
            senderAvatar: undefined,
            message: text,
            createdAt: new Date().toISOString(),
            attachment: pendingAttachment ?? null,
            status: 'sent',
        };
        setMessages((prev) => {
            const next = [...prev, newMsg];
            persist(selectedGroupId, next);
            return next;
        });
        setNewMessage('');
        setPendingAttachment(null);
    };

    // Voice notes auto-send the moment recording stops (local-only).
    const sendVoiceNote = (voice: FileAttachment) => {
        if ((readOnly && !isModerator) || !selectedGroupId) return;
        const newMsg: Message = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userId: myUserId,
            senderName: myName,
            senderAvatar: undefined,
            message: t('chatroomPage.sentVoiceNote'),
            createdAt: new Date().toISOString(),
            attachment: voice,
            status: 'sent',
        };
        setMessages((prev) => {
            const next = [...prev, newMsg];
            persist(selectedGroupId, next);
            return next;
        });
    };

    const handleDeleteMessage = (msgId: string) => {
        if (!selectedGroupId) return;
        setMessages((prev) => {
            const next = prev.filter((m) => m.id !== msgId);
            persist(selectedGroupId, next);
            return next;
        });
        setPinnedMsgId((prev) => (prev === msgId ? null : prev));
    };

    const handlePinMessage = (msgId: string) => {
        if (!selectedGroupId) return;
        setMessages((prev) => {
            const next = prev.map((m) =>
                m.id === msgId ? { ...m, pinned: !m.pinned } : m,
            );
            persist(selectedGroupId, next);
            const target = next.find((m) => m.id === msgId);
            setPinnedMsgId(target?.pinned ? msgId : null);
            return next;
        });
    };

    const handleToggleReadOnly = () => {
        if (!selectedGroupId) return;
        const target = !readOnly;
        setReadOnly(target);
        setGroups((prev) => prev.map((g) => (g.groupId === selectedGroupId ? { ...g, readOnly: target } : g)));
    };

    const handleSendSystemMsg = () => {
        if (!systemMsg.trim() || !selectedGroupId) return;
        const newMsg: Message = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userId: myUserId,
            senderName: myName,
            message: systemMsg,
            createdAt: new Date().toISOString(),
            system: true,
            status: 'sent',
        };
        setMessages((prev) => {
            const next = [...prev, newMsg];
            persist(selectedGroupId, next);
            return next;
        });
        setSystemMsg('');
    };

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView enabled={false}>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">
                    {t('staff.staffChatLink')}
                </h2>
                <p className="text-black dark:text-gray-300 text-sm">
                    {t('admin.adminChatroomSubtitle')}
                </p>
            </AnimateOnView>

            <AnimateOnView delay={0.1} enabled={false}>
                {/* Plan 9 follow-up — mobile uses flex column so the visible
                    panel can take `flex-1` and constrain the inner scroll
                    container; lg+ falls back to grid for the side-by-side view. */}
                <div className={`flex flex-col lg:grid lg:grid-cols-1 ${showInfo ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4 h-[calc(100vh-16rem)] min-h-0`}>
                    {/* Group list — on mobile (<lg), hidden when user is
                        viewing a chat or info panel (WhatsApp pattern). */}
                    <div
                        className={`${glassCardStyle} p-4 flex-col overflow-hidden flex-1 min-h-0 lg:flex-none lg:col-span-1 lg:flex ${mobileView === 'list' ? 'flex' : 'hidden'}`}
                    >
                        <h3 className="text-black dark:text-white font-bold mb-3">{t('admin.staffGroupsHeader')}</h3>
                        <div className="flex-1 overflow-y-auto space-y-1">
                            {isLoading ? (
                                [1, 2, 3, 4, 5, 6].map((i) => (
                                    <div
                                        key={i}
                                        className="h-16 w-full bg-white/5 animate-pulse rounded-xl"
                                    ></div>
                                ))
                            ) : groups.length === 0 ? (
                                <p className="text-xs text-gray-500 text-center py-6">
                                    {t('admin.noStaffGroupsYet')}
                                </p>
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
                                                <p className="text-black dark:text-white text-sm font-bold truncate">
                                                    {g.name}
                                                </p>
                                                <p className="text-gray-500 text-[10px] truncate">
                                                    {g.memberCount} {g.memberCount === 1 ? t('admin.memberSingular') : t('admin.memberPlural')}
                                                    {g.muted && t('admin.mutedSuffix')}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Chat area — on mobile, visible only when mobileView === 'chat'. */}
                    <div
                        className={`${glassCardStyle} flex-col overflow-hidden flex-1 min-h-0 lg:flex-none lg:col-span-2 lg:flex ${mobileView === 'chat' ? 'flex' : 'hidden'}`}
                    >
                        {/* Header — click anywhere on the title block to toggle the info panel */}
                        <div className="px-3 sm:px-4 py-2 border-b border-white/10 flex items-center justify-between bg-black/10">
                            {/* Mobile back arrow — returns to the group list. */}
                            <button
                                type="button"
                                onClick={() => setMobileView('list')}
                                aria-label={t('admin.backToGroups')}
                                className="lg:hidden mr-1 w-9 h-9 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                            >
                                <i className="ph-bold ph-arrow-left text-lg" />
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!selectedGroupId) return;
                                    setShowInfo((v) => !v);
                                    setMobileView('info');
                                }}
                                disabled={!selectedGroupId}
                                className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-default"
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
                                        {selectedGroup?.name ?? t('admin.selectAGroup')}
                                    </p>
                                    {selectedGroup && (
                                        <p className="text-[10px] text-gray-500 truncate">
                                            {selectedGroup.memberCount} {selectedGroup.memberCount === 1 ? t('admin.memberSingular') : t('admin.memberPlural')}
                                            {isModerator && t('admin.youAreAnAdmin')}
                                            {t('admin.tapForInfo')}
                                        </p>
                                    )}
                                </div>
                            </button>
                            {selectedGroup && isModerator && (
                                <div className="flex items-center flex-shrink-0 ml-2">
                                    <button
                                        onClick={handleToggleReadOnly}
                                        title={
                                            readOnly
                                                ? t('admin.unlockTooltip')
                                                : t('admin.lockTooltip')
                                        }
                                        aria-pressed={readOnly}
                                        className={`group flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl border backdrop-blur-xl transition-all ${
                                            readOnly
                                                ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 text-[#bda8ff] shadow-md shadow-[#6A3FF4]/10'
                                                : 'bg-white/5 dark:bg-black/20 border-white/15 dark:border-white/10 text-gray-500 dark:text-gray-300 hover:bg-white/10 hover:text-black dark:hover:text-white'
                                        }`}
                                    >
                                        <i
                                            className={`ph-fill ${
                                                readOnly
                                                    ? 'ph-lock-simple'
                                                    : 'ph-lock-simple-open'
                                            } text-sm transition-transform group-hover:scale-110`}
                                        ></i>
                                        <span className="leading-none">{t('admin.readOnlyLabel')}</span>
                                        <span
                                            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                                                readOnly
                                                    ? 'bg-[#6A3FF4]/30 text-[#dec6ff]'
                                                    : 'bg-white/10 dark:bg-white/5 text-gray-500 dark:text-gray-400'
                                            }`}
                                        >
                                            {readOnly ? t('admin.onLbl') : t('admin.offLbl')}
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Pinned banner */}
                        {pinnedMsgId &&
                            (() => {
                                const pinned = messages.find((m) => m.id === pinnedMsgId);
                                const { text, icon } = chatPinnedPreview(pinned);
                                return (
                                    <div className="px-4 py-2 bg-[#6A3FF4]/10 border-b border-[#6A3FF4]/20 flex items-center gap-2 text-xs text-[#6A3FF4]">
                                        <i className="ph-bold ph-push-pin"></i>
                                        <i className={`ph-fill ${icon}`}></i>
                                        <span className="truncate font-medium">
                                            {t('admin.pinnedPrefix', { text })}
                                        </span>
                                    </div>
                                );
                            })()}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                            {!selectedGroup ? (
                                <div className="flex items-center justify-center h-full">
                                    <p className="text-sm text-gray-500">
                                        {t('admin.pickStaffGroupHint')}
                                    </p>
                                </div>
                            ) : (
                                messages.map((msg, idx) => {
                                    if (msg.system) {
                                        return (
                                            <div
                                                key={msg.id}
                                                className="flex justify-center my-3 group relative"
                                            >
                                                <div className="inline-flex items-start gap-2 max-w-[85%] px-4 py-2.5 rounded-2xl border-2 border-[#7B5AFF] shadow-lg shadow-[#6A3FF4]/30">
                                                    <i className="ph-fill ph-megaphone-simple text-[#7B5AFF] text-base flex-shrink-0 mt-0.5"></i>
                                                    <div className="min-w-0">
                                                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#7B5AFF] mb-0.5">
                                                            {t('admin.announcementBadge')}
                                                        </p>
                                                        <p className="text-xs text-black dark:text-white whitespace-pre-wrap break-words">
                                                            {msg.message}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isModerator && (
                                                    <button
                                                        onClick={() => handleDeleteMessage(msg.id)}
                                                        title={t('admin.deleteAnnouncementTip')}
                                                        className="absolute -top-2 -right-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-md bg-black/50 text-white hover:bg-red-500/70 text-xs flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash"></i>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }
                                    const isMe = msg.userId === myUserId;
                                    const prev = idx > 0 ? messages[idx - 1] : null;
                                    const showSenderInfo =
                                        !isMe &&
                                        (!prev || prev.userId !== msg.userId || !!prev.system);
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
                                                role: isMe ? 'admin' : 'student',
                                            }}
                                            status={msg.status ?? 'sent'}
                                            pinned={msg.pinned}
                                            attachment={msg.attachment ?? undefined}
                                            onImageClick={(att) =>
                                                setPreviewImage({ url: att.url, name: att.name })
                                            }
                                            sectionId={selectedGroupId}
                                            moderationActions={
                                                isModerator ? (
                                                    <>
                                                        <button
                                                            onClick={() =>
                                                                handleDeleteMessage(msg.id)
                                                            }
                                                            title={t('admin.deleteMessageTip')}
                                                            className="w-6 h-6 rounded-md bg-black/40 text-white hover:bg-red-500/60 text-xs flex items-center justify-center"
                                                        >
                                                            <i className="ph-bold ph-trash"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handlePinMessage(msg.id)}
                                                            title={
                                                                msg.pinned
                                                                    ? t('admin.unpinMessageTip')
                                                                    : t('admin.pinMessageTip')
                                                            }
                                                            className={`w-6 h-6 rounded-md bg-black/40 text-white hover:bg-[#6A3FF4]/60 text-xs flex items-center justify-center ${
                                                                msg.pinned
                                                                    ? 'text-[#6A3FF4] bg-[#6A3FF4]/20'
                                                                    : ''
                                                            }`}
                                                        >
                                                            <i className="ph-bold ph-push-pin"></i>
                                                        </button>
                                                    </>
                                                ) : null
                                            }
                                        />
                                    );
                                })
                            )}
                            <div ref={scrollRef} />
                        </div>

                        {/* Announcement composer — moderators only. */}
                        {selectedGroup && isModerator && (
                            showAnnounceComposer ? (
                                <div className="px-4 pt-3 pb-2 border-t-2 border-[#6A3FF4]/40">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <i className="ph-fill ph-megaphone-simple text-[#7B5AFF]"></i>
                                            <span className="text-xs font-bold text-[#7B5AFF] uppercase tracking-wider">
                                                {t('admin.newAnnouncementBig')}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowAnnounceComposer(false);
                                                setSystemMsg('');
                                            }}
                                            className="w-6 h-6 rounded-md text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/10 flex items-center justify-center text-xs"
                                            title={t('admin.closeBtn')}
                                        >
                                            <i className="ph-bold ph-x"></i>
                                        </button>
                                    </div>
                                    <textarea
                                        value={systemMsg}
                                        onChange={(e) => setSystemMsg(e.target.value)}
                                        rows={3}
                                        placeholder={t('admin.announcementPlaceholder')}
                                        className="w-full bg-transparent border-2 border-[#6A3FF4]/40 rounded-xl px-3 py-2 text-sm text-black dark:text-white outline-none focus:border-[#6A3FF4] resize-none placeholder:text-gray-500"
                                    />
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] text-gray-500">
                                            {t('admin.announcementHint')}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSystemMsg('')}
                                                disabled={!systemMsg}
                                                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/5 disabled:opacity-30"
                                            >
                                                {t('admin.clearBtnChat')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handleSendSystemMsg();
                                                    setShowAnnounceComposer(false);
                                                }}
                                                disabled={!systemMsg.trim()}
                                                className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] text-white text-xs font-bold shadow-lg shadow-purple-500/20 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                            >
                                                <i className="ph-bold ph-paper-plane-tilt"></i>
                                                {t('admin.sendAnnouncement')}
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
                                        {t('admin.newAnnouncement')}
                                    </button>
                                </div>
                            )
                        )}

                        {/* Input — read-only blocks non-moderators only. */}
                        {readOnly && !isModerator ? (
                            <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-center">
                                <span className="text-gray-500 text-sm flex items-center gap-2">
                                    <i className="ph-fill ph-lock-simple text-[#6A3FF4]"></i>
                                    {t('admin.chatIsReadOnly')}
                                </span>
                            </div>
                        ) : selectedGroup ? (
                            <form
                                onSubmit={handleSend}
                                className="px-4 py-3 border-t border-white/10"
                            >
                                {/* Pending attachment preview chip */}
                                {pendingAttachment && (
                                    <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-white/10 dark:bg-black/30 border border-white/20 dark:border-white/10">
                                        <i className={`ph-fill ${
                                            pendingAttachment.type === 'image'
                                                ? 'ph-image'
                                                : pendingAttachment.type === 'video'
                                                ? 'ph-video-camera'
                                                : pendingAttachment.type === 'audio'
                                                ? 'ph-microphone'
                                                : pendingAttachment.type === 'poll'
                                                ? 'ph-chart-bar'
                                                : 'ph-paperclip'
                                        } text-[#6A3FF4] text-lg`}></i>
                                        <span className="flex-1 text-xs text-black dark:text-white truncate">{pendingAttachment.name || pendingAttachment.type}</span>
                                        <button type="button" onClick={() => setPendingAttachment(null)} className="text-red-400 hover:text-red-500">
                                            <i className="ph-bold ph-x"></i>
                                        </button>
                                    </div>
                                )}
                                {composerError && (
                                    <div className="mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                                        {composerError}
                                    </div>
                                )}
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
                                        placeholder={t('admin.typeMessageMention')}
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

                    {/* Group Info panel — members list, group photo / description / pin / etc.
                        On mobile, visible only when mobileView === 'info'. */}
                    {showInfo && selectedGroupId && (
                        <div className={`flex-1 min-h-0 lg:flex-none lg:col-span-1 lg:h-full lg:block ${mobileView === 'info' ? 'block' : 'hidden'}`}>
                            <ChatGroupInfoPanel
                                groupId={selectedGroupId}
                                onClose={() => { setShowInfo(false); setMobileView('chat'); }}
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

export default AdminChatroom;
