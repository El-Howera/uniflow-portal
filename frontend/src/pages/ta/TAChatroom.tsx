/**
 * TAChatroom — section-aware chat for teaching assistants. Mirror of
 * ProfChatroom — TAs are full chat moderators with the same UI parity.
 *
 * MVP build — fully front-end. No socket, no backend calls; messages live
 * in local React state seeded from static mock data.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AnimateOnView } from '../../components/AnimateOnView';
import ChatGroupInfoPanel from '../../components/ChatGroupInfoPanel';
import ChatGroupAvatar from '../../components/ChatGroupAvatar';
import ChatImagePreview from '../../components/ChatImagePreview';
import { chatPinnedPreview } from '../../utils/chatPinnedPreview';
import ChatMessageBubble from '../../components/ChatMessageBubble';
import MentionInput, { MentionMember } from '../../components/MentionInput';
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

// ── Static preview data ───────────────────────────────────────────────────────
const MOCK_GROUPS: ChatGroupListItem[] = [
    {
        groupId: 'g1', myRole: 'ta', muted: false, name: 'CS201 — Data Structures (Lab B)',
        description: 'Lab section discussion for Data Structures', photoUrl: null, memberCount: 49,
        sectionId: 'sec-cs201-b', courseCode: 'CS201', courseTitle: 'Data Structures',
        sectionType: 'Lab', sectionLabel: 'B', slots: [{ day: 'Monday', startTime: '09:00', endTime: '10:30' }],
    },
    {
        groupId: 'g2', myRole: 'ta', muted: false, name: 'MA205 — Linear Algebra',
        description: 'Course chatroom for Linear Algebra', photoUrl: null, memberCount: 57,
        sectionId: 'sec-ma205', courseCode: 'MA205', courseTitle: 'Linear Algebra',
        sectionType: 'Lecture', sectionLabel: 'A', slots: [{ day: 'Tuesday', startTime: '11:00', endTime: '12:30' }],
    },
    {
        groupId: 'g3', myRole: 'ta', muted: true, name: 'CS101 — Intro to Programming',
        description: 'Course chatroom for Intro to Programming', photoUrl: null, memberCount: 39,
        sectionId: 'sec-cs101', courseCode: 'CS101', courseTitle: 'Intro to Programming',
        sectionType: 'Lecture', sectionLabel: 'A', slots: [{ day: 'Wednesday', startTime: '14:00', endTime: '15:30' }],
    },
];

const MOCK_MEMBERS: Record<string, MentionMember[]> = {
    'sec-cs201-b': [
        { userId: 'st1', firstName: 'Omar', lastName: 'Farouk', role: 'student' },
        { userId: 'st3', firstName: 'Yara', lastName: 'Mahmoud', role: 'student' },
        { userId: 'st6', firstName: 'Hana', lastName: 'Said', role: 'student' },
        { userId: 'prof1', firstName: 'Karim', lastName: 'Mansour', role: 'professor' },
    ],
    'sec-ma205': [
        { userId: 'st2', firstName: 'Nour', lastName: 'El-Din', role: 'student' },
        { userId: 'st7', firstName: 'Kareem', lastName: 'Adel', role: 'student' },
        { userId: 'prof2', firstName: 'Hala', lastName: 'Sabry', role: 'professor' },
    ],
    'sec-cs101': [
        { userId: 'st4', firstName: 'Ziad', lastName: 'Tarek', role: 'student' },
        { userId: 'st5', firstName: 'Salma', lastName: 'Adel', role: 'student' },
    ],
};

const MOCK_MESSAGES: Record<string, Message[]> = {
    'sec-cs201-b': [
        { id: 'm1', userId: 'st1', senderName: 'Omar Farouk', message: 'Will the lab cover AVL rotations today?', createdAt: '2026-04-20T09:05:00Z', status: 'read' },
        { id: 'm2', userId: 'ta-self', senderName: 'You', message: 'Yes — bring your starter code, we will trace insertions together.', createdAt: '2026-04-20T09:07:00Z', status: 'read' },
        { id: 'm3', userId: 'sys', senderName: 'System', message: 'Reminder: Assignment 3 is due Friday at 11:59 PM.', createdAt: '2026-04-20T09:10:00Z', system: true, pinned: true },
        { id: 'm4', userId: 'st3', senderName: 'Yara Mahmoud', message: 'Thanks! See you in the lab.', createdAt: '2026-04-20T09:12:00Z', status: 'read' },
    ],
    'sec-ma205': [
        { id: 'm5', userId: 'st2', senderName: 'Nour El-Din', message: 'Can you re-share the eigenvalues notes?', createdAt: '2026-04-19T11:30:00Z', status: 'read' },
        { id: 'm6', userId: 'ta-self', senderName: 'You', message: 'Posted under Materials → Lectures. Let me know if it does not open.', createdAt: '2026-04-19T11:33:00Z', status: 'sent' },
    ],
    'sec-cs101': [
        { id: 'm7', userId: 'st4', senderName: 'Ziad Tarek', message: 'Is the while-loop example on the slides?', createdAt: '2026-04-18T14:05:00Z', status: 'read' },
    ],
};

// ── Main page ────────────────────────────────────────────────────────────
const TAChatroom: React.FC = () => {
    const t = useT();
    const [groups, setGroups] = useState<ChatGroupListItem[]>([]);
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

    const scrollRef = useRef<HTMLDivElement>(null);

    const selectedGroup = useMemo(
        () => groups.find((g) => g.groupId === selectedGroupId) ?? null,
        [groups, selectedGroupId],
    );
    const selectedCourseCode = selectedGroup?.courseCode ?? '';
    const selectedSectionId = selectedGroup?.sectionId ?? '';
    // TAs are always moderators in their own section's chat. Symmetric
    // with prof / student chatrooms so the readOnly gate logic works.
    const isModerator = true;

    // MVP build — load chat groups from static mock data on mount.
    useEffect(() => {
        setGroups(MOCK_GROUPS);
        if (MOCK_GROUPS.length > 0) {
            setSelectedGroupId((prev) => prev || MOCK_GROUPS[0].groupId);
        }
        setIsLoading(false);
    }, []);

    // Load messages + members for the selected section from mock data.
    useEffect(() => {
        if (!selectedSectionId) {
            setMessages([]);
            setChatMembers([]);
            setPinnedMsgId(null);
            return;
        }
        const msgs = MOCK_MESSAGES[selectedSectionId] ?? [];
        setMessages(msgs);
        const pinned = msgs.find((m) => m.pinned);
        setPinnedMsgId(pinned ? pinned.id : null);
        setReadOnly(false);
        setChatMembers(MOCK_MEMBERS[selectedSectionId] ?? []);
    }, [selectedSectionId]);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        // MVP build — local-only send. Allow if EITHER text OR attachment.
        if ((!inputValue.trim() && !pendingAttachment) || (readOnly && !isModerator) || !selectedCourseCode) return;
        const fallbackText = pendingAttachment
            ? pendingAttachment.type === 'image'
                ? t('professor.fallbackImage')
                : pendingAttachment.type === 'video'
                ? t('professor.fallbackVideo')
                : pendingAttachment.type === 'audio'
                ? t('professor.fallbackVoice')
                : t('professor.fallbackFile')
            : '';
        const text = inputValue.trim() || fallbackText;
        const newId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const myName = localStorage.getItem('currentUserFirstName') || 'You';
        const myAvatar = localStorage.getItem('currentUserPicture') || undefined;

        setMessages((prev) => [
            ...prev,
            {
                id: newId,
                userId: 'ta-self',
                senderName: myName,
                senderAvatar: myAvatar,
                message: text,
                createdAt: new Date().toISOString(),
                attachment: pendingAttachment ?? null,
                status: 'sent' as MessageStatus,
            },
        ]);
        setNewMessage('');
        setPendingAttachment(null);
    };

    /**
     * Voice notes auto-send the moment recording stops — staff don't get
     * a "review" step for voice (same as WhatsApp). Local-only insert.
     */
    const sendVoiceNote = useCallback(
        (voice: FileAttachment) => {
            if ((readOnly && !isModerator) || !selectedCourseCode) return;
            const newId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const myName = localStorage.getItem('currentUserFirstName') || 'You';
            const myAvatar = localStorage.getItem('currentUserPicture') || undefined;
            setMessages((prev) => [
                ...prev,
                {
                    id: newId,
                    userId: 'ta-self',
                    senderName: myName,
                    senderAvatar: myAvatar,
                    message: t('professor.fallbackVoice'),
                    createdAt: new Date().toISOString(),
                    attachment: voice,
                    status: 'sent' as MessageStatus,
                },
            ]);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [readOnly, selectedCourseCode, selectedSectionId],
    );

    const handleDeleteMessage = useCallback((msgId: string) => {
        // MVP build — local-only delete.
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
        setPinnedMsgId((prev) => (prev === msgId ? null : prev));
    }, []);

    const handlePinMessage = useCallback((msgId: string) => {
        // MVP build — local-only pin toggle.
        setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, pinned: !m.pinned } : m)),
        );
        setPinnedMsgId((prev) => (prev === msgId ? null : msgId));
    }, []);

    const handleToggleReadOnly = useCallback(() => {
        // MVP build — local-only read-only toggle.
        if (!selectedSectionId) return;
        setReadOnly((prev) => !prev);
    }, [selectedSectionId]);

    const handleSendSystemMsg = useCallback(() => {
        // MVP build — local-only system announcement insert.
        if (!systemMsg.trim() || !selectedCourseCode) return;
        const newId = `local_sys_${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: newId,
                userId: 'sys',
                senderName: 'System',
                message: systemMsg,
                createdAt: new Date().toISOString(),
                system: true,
            },
        ]);
        setSystemMsg('');
    }, [selectedCourseCode, systemMsg]);

    const gridCols = showInfo ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

    return (
        <div className="space-y-6 pb-16 px-2 sm:px-0">
            <AnimateOnView>
                <h2 className="text-black dark:text-white text-xl sm:text-3xl font-bold mb-1">{t('ta.chatroomHeading')}</h2>
                <p className="text-black dark:text-gray-300 text-sm">
                    {t('ta.chatroomSubtitleTA')}
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
                        <h3 className="text-black dark:text-white font-bold mb-3">{t('ta.chatGroupsTitle')}</h3>
                        <div className="flex-1 overflow-y-auto space-y-1">
                            {isLoading ? (
                                [1, 2, 3].map((i) => (
                                    <div key={i} className="h-16 w-full bg-white/5 animate-pulse rounded-xl"></div>
                                ))
                            ) : groups.length === 0 ? (
                                <p className="text-xs text-gray-500 text-center py-6">
                                    {t('ta.noSectionGroupsYet')}
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
                                                <p className="text-black dark:text-white text-sm font-bold truncate">{g.name}</p>
                                                <p className="text-gray-500 text-[10px] truncate">
                                                    {g.memberCount === 1 ? t('ta.nMember', { n: g.memberCount }).split(' · ')[0] : t('ta.nMembers', { n: g.memberCount }).split(' · ')[0]}
                                                    {g.muted && ` · ${t('ta.mutedShort')}`}
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
                                aria-label={t('ta.backToGroupsAria')}
                                className="lg:hidden mr-1 w-9 h-9 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-white/10 transition-colors flex-shrink-0"
                            >
                                <i className="ph-bold ph-arrow-left text-lg" />
                            </button>
                            <button
                                onClick={() => { setShowInfo(true); setMobileView('info'); }}
                                disabled={!selectedGroup}
                                className="flex items-center gap-3 text-left flex-1 min-w-0 hover:bg-white/5 rounded-lg -m-1 p-1 transition-colors"
                                title={t('ta.groupInfoTooltip')}
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
                                        {selectedGroup?.name ?? t('ta.selectGroupHint')}
                                    </p>
                                    {selectedGroup && (
                                        <p className="text-[10px] text-gray-500 truncate">
                                            {t('ta.nMembers', { n: selectedGroup.memberCount })}
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
                                    title={readOnly ? t('ta.unlockSendTooltip') : t('ta.lockSendTooltip')}
                                    aria-pressed={readOnly}
                                    className={`group flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl border backdrop-blur-xl transition-all ${
                                        readOnly
                                            ? 'bg-[#6A3FF4]/20 border-[#6A3FF4]/40 text-[#bda8ff] shadow-md shadow-[#6A3FF4]/10'
                                            : 'bg-white/5 dark:bg-black/20 border-white/15 dark:border-white/10 text-gray-500 dark:text-gray-300 hover:bg-white/10 hover:text-black dark:hover:text-white'
                                    }`}
                                >
                                    <i className={`ph-fill ${readOnly ? 'ph-lock-simple' : 'ph-lock-simple-open'} text-sm transition-transform group-hover:scale-110`}></i>
                                    <span className="leading-none">{t('ta.readOnlyShort')}</span>
                                    <span
                                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                                            readOnly
                                                ? 'bg-[#6A3FF4]/30 text-[#dec6ff]'
                                                : 'bg-white/10 dark:bg-white/5 text-gray-500 dark:text-gray-400'
                                        }`}
                                    >
                                        {readOnly ? t('ta.onLabel') : t('ta.offLabel')}
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
                                    <span className="truncate font-medium">{t('ta.pinnedPrefix')} {text}</span>
                                </div>
                            );
                        })()}

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                            {!selectedGroup ? (
                                <div className="flex items-center justify-center h-full">
                                    <p className="text-sm text-gray-500">{t('ta.pickGroupHintLong')}</p>
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
                                                        <p className="text-[10px] uppercase tracking-wider font-bold text-[#7B5AFF] mb-0.5">{t('ta.announcementBadgeTA')}</p>
                                                        <p className="text-xs text-black dark:text-white whitespace-pre-wrap break-words">{msg.message}</p>
                                                    </div>
                                                </div>
                                                {isStaff && (
                                                    <button
                                                        onClick={() => handleDeleteMessage(msg.id)}
                                                        title={t('ta.deleteAnnouncementTooltipTA')}
                                                        className="absolute -top-2 -right-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-md bg-black/50 text-white hover:bg-red-500/70 text-xs flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash"></i>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    }
                                    const isMe = msg.userId === 'ta-self';
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
                                                role: isMe ? 'ta' : 'student',
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
                                                        title={t('ta.deleteMessageTooltipTA')}
                                                        className="w-6 h-6 rounded-md bg-black/40 text-white hover:bg-red-500/60 text-xs flex items-center justify-center"
                                                    >
                                                        <i className="ph-bold ph-trash"></i>
                                                    </button>
                                                    <button
                                                        onClick={() => handlePinMessage(msg.id)}
                                                        title={msg.pinned ? t('ta.unpinTooltipTA') : t('ta.pinTooltipTA')}
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
                                            <span className="text-xs font-bold text-[#7B5AFF] uppercase tracking-wider">{t('ta.announcementComposerTitleTA')}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setShowAnnounceComposer(false); setSystemMsg(''); }}
                                            className="w-6 h-6 rounded-md text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/10 flex items-center justify-center text-xs"
                                            title={t('ta.closeTooltipShort')}
                                        >
                                            <i className="ph-bold ph-x"></i>
                                        </button>
                                    </div>
                                    <textarea
                                        value={systemMsg}
                                        onChange={(e) => setSystemMsg(e.target.value)}
                                        rows={3}
                                        placeholder={t('ta.announcementTextareaPh')}
                                        className="w-full bg-transparent border-2 border-[#6A3FF4]/40 rounded-xl px-3 py-2 text-sm text-black dark:text-white outline-none focus:border-[#6A3FF4] resize-none placeholder:text-gray-500"
                                    />
                                    <div className="flex items-center justify-between mt-2">
                                        <span className="text-[10px] text-gray-500">
                                            {t('ta.sendsAsAnnouncementHint')}
                                        </span>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setSystemMsg('')}
                                                disabled={!systemMsg}
                                                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-gray-500 hover:text-black dark:hover:text-white hover:bg-white/5 disabled:opacity-30"
                                            >
                                                {t('ta.clearBtnShort')}
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
                                                {t('ta.sendAnnouncementBtnTA')}
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
                                        {t('ta.newAnnouncementBtnTA')}
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
                                        {pendingAttachment.type} · {t('ta.readyToSendLabel')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPendingAttachment(null)}
                                    className="w-7 h-7 rounded-md bg-white/5 hover:bg-red-500/15 text-gray-400 hover:text-red-400 flex items-center justify-center"
                                    title={t('ta.discardAttachmentTooltip')}
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
                                    {t('ta.chatReadOnlyNoticeTA')}
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
                                        placeholder={t('ta.typeMessageMentionPh')}
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
                        height. On mobile, visible only when mobileView === 'info';
                        closing returns the user to the chat pane. */}
                    {showInfo && selectedGroupId && (
                        <div className={`flex-1 min-h-0 lg:flex-none lg:col-span-1 lg:h-full lg:block ${mobileView === 'info' ? 'block' : 'hidden'}`}>
                            <ChatGroupInfoPanel
                                groupId={selectedGroupId}
                                onClose={() => { setShowInfo(false); setMobileView('chat'); }}
                                onGroupUpdated={() => { /* MVP build — no-op */ }}
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

export default TAChatroom;
