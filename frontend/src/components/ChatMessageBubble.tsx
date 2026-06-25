/**
 * ChatMessageBubble
 *
 * Single shared bubble used by Student / TA / Professor chatrooms. Visual
 * language is borrowed from the FCDS chatbot (rounded-2xl with a
 * speaker-side cut, glass-morphism fill, gradient avatar) and augmented
 * with the read-receipt checkmark + timestamp the student chatroom
 * already shipped. Attachments (image / video / audio / document) render
 * inside the bubble; voice notes get a play-button + waveform-stub UI.
 *
 * The bubble is presentation-only — the host page handles socket wiring
 * and decides which messages get rendered. That keeps the three chat
 * pages thin and identical at the message level.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MessageStatus, FileAttachment } from '../utils/websocketService';
import { API_URLS } from '@shared/config';
import { authHeaders } from '../utils/api';
import UniFlowVideoPlayer from './UniFlowVideoPlayer';

export interface ChatBubbleSender {
  /** Display name shown above the bubble for non-self messages. */
  name: string;
  /** Profile picture URL — falls back to the gradient avatar with initial. */
  avatar?: string | null;
  /** System role of the sender — drives the avatar gradient + icon. */
  role?: 'student' | 'professor' | 'ta' | 'admin' | 'system' | string;
}

export interface ChatBubbleAttachment {
  type: string; // 'image' | 'video' | 'audio' | 'document' | 'other'
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
}

export interface ChatMessageBubbleProps {
  id: string;
  text: string;
  timestamp: string;
  isMe: boolean;
  /** Whether to render the sender's name + avatar above/beside the bubble. */
  showSenderInfo?: boolean;
  sender: ChatBubbleSender;
  /** Whether to render a status checkmark (only meaningful for self bubbles). */
  status?: MessageStatus;
  pinned?: boolean;
  attachment?: ChatBubbleAttachment | FileAttachment;
  /** Click handler for image attachments — opens a fullscreen preview. */
  onImageClick?: (attachment: ChatBubbleAttachment | FileAttachment) => void;
  /** Optional moderation hover actions (delete, pin) for staff/admins. */
  moderationActions?: React.ReactNode;
  /** Section id — required for poll attachments to fetch / vote. */
  sectionId?: string;
}

const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTime = (timestamp: string): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
};

const roleAvatar = (role?: string) => {
  switch ((role || '').toLowerCase()) {
    case 'professor':
      return { icon: 'ph-chalkboard-teacher', gradient: 'from-emerald-500 to-emerald-700', shadow: 'shadow-emerald-500/25' };
    case 'ta':
      return { icon: 'ph-student', gradient: 'from-blue-500 to-blue-700', shadow: 'shadow-blue-500/25' };
    case 'admin':
      return { icon: 'ph-shield-check', gradient: 'from-[#6A3FF4] to-[#A855F7]', shadow: 'shadow-purple-500/25' };
    case 'system':
      return { icon: 'ph-megaphone-simple', gradient: 'from-[#6A3FF4] to-[#A855F7]', shadow: 'shadow-purple-500/25' };
    default:
      return { icon: 'ph-user', gradient: 'from-gray-500 to-gray-700', shadow: 'shadow-gray-500/20' };
  }
};

/**
 * StatusCheck — sender-side delivery status. Three states:
 *
 *   pending   → clock icon (still being relayed; offline / network blip
 *               or just waiting on the server's ack).
 *   sent /
 *   delivered → single check (server has saved + broadcast).
 *   read      → double check, purple-tinted (a recipient has marked the
 *               message as read).
 *
 * Used for SELF bubbles only — the host page passes the live status from
 * the message row + socket events. Receiver bubbles render the double
 * purple check unconditionally (handled at the bubble's render level,
 * not here) since "I'm seeing it right now" is itself the read receipt.
 */
const StatusCheck: React.FC<{ status?: MessageStatus; readTint?: 'self' | 'received' }> = ({
  status,
  readTint = 'self',
}) => {
  // Pending → clock (waiting on the server / offline). Lavender in both
  // modes so it stays visible against the self bubble's translucent purple
  // background AND a glass card.
  if (status === ('pending' as MessageStatus)) {
    return (
      <i
        className="ph-bold ph-clock text-[#a78bfa] text-[11px]"
        aria-label="Pending delivery"
      ></i>
    );
  }
  const isRead = status === 'read';
  // Owner directive: checkmarks are PURPLE in both modes (sent = #7B5AFF
  // medium purple, read = #a78bfa lighter lavender) regardless of which
  // bubble (self / received). They sit alongside a gray timestamp in the
  // footer and the contrast is fine on both the lavender self bubble and
  // the glass-morphism received bubble.
  const colorClass = isRead ? 'text-[#a78bfa]' : 'text-[#7B5AFF]';
  void readTint;
  return (
    <svg
      className={`w-4 h-3 ${colorClass}`}
      viewBox="0 0 20 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 6L4 9L11 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {isRead && (
        <path
          d="M6 6L9 9L16 2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
};

/**
 * ReceivedCheck — for the RECEIVER's bubble: always render the double
 * purple check, since the act of seeing the message in the chat IS the
 * read confirmation. Symmetric with the sender's `read` state — both
 * sides see the same "seen" tick.
 */
const ReceivedCheck: React.FC = () => (
  <svg
    className="w-4 h-3 text-[#a78bfa]"
    viewBox="0 0 20 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M1 6L4 9L11 2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 6L9 9L16 2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * VoicePlayer — custom dark-themed audio player for voice-note attachments.
 *
 * Native `<audio controls>` rendered with the browser's default chrome
 * looked out of place against the chat's glass surfaces. This player
 * mirrors WhatsApp's bubble: round play button, faint waveform-strip,
 * elapsed/total time. Built on top of an HTMLAudioElement under the
 * hood so seek, play/pause, and end-of-track all stay native.
 */
const VoicePlayer: React.FC<{ url: string; isMe: boolean }> = ({ url, isMe }) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [current, setCurrent] = React.useState(0);

  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => {
      const d = a.duration;
      if (Number.isFinite(d) && !Number.isNaN(d)) setDuration(d);
    };
    const onTime = () => setCurrent(a.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    a.addEventListener('loadedmetadata', onLoaded);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnded);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * duration;
    setCurrent(ratio * duration);
  };

  const formatSeconds = (s: number): string => {
    if (!Number.isFinite(s) || Number.isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  // 28 vertical bars of varying heights — a stylised waveform that doesn't
  // require parsing the audio's actual amplitude (which is expensive). The
  // played portion lights up purple; unplayed stays dim.
  const bars = React.useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        // Pseudo-random heights derived from the index — deterministic so
        // every voice note shows the same waveform shape (recognisable).
        const seed = (Math.sin(i * 11.37) + 1) * 0.5; // 0..1
        return 30 + seed * 70; // 30%..100% of strip height
      }),
    [],
  );

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-2 min-w-[240px] max-w-[320px] ${
        isMe
          ? 'bg-white/10 border border-white/15'
          : 'bg-[#6A3FF4]/15 border border-[#6A3FF4]/25'
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          isMe
            ? 'bg-white/20 hover:bg-white/30 text-white'
            : 'bg-[#6A3FF4] hover:bg-[#5A32D4] text-white shadow-md shadow-[#6A3FF4]/40'
        }`}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
      >
        <i className={`ph-fill ${playing ? 'ph-pause' : 'ph-play'} text-sm`}></i>
      </button>

      <div className="flex-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-6 cursor-pointer select-none"
          onClick={onSeek}
          role="slider"
          aria-label="Seek voice note"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {bars.map((h, i) => {
            const filled = (i / bars.length) * 100 < progress;
            return (
              <span
                key={i}
                className={`w-[3px] rounded-full transition-colors ${
                  filled
                    ? isMe
                      ? 'bg-white'
                      : 'bg-[#7B5AFF]'
                    : isMe
                    ? 'bg-white/30'
                    : 'bg-[#6A3FF4]/30'
                }`}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
        <div className={`flex items-center gap-1.5 mt-1.5 text-[10px] font-mono ${
          isMe ? 'text-white/80' : 'text-gray-400'
        }`}>
          <i className="ph-bold ph-microphone text-[10px]"></i>
          <span>{formatSeconds(playing || current > 0 ? current : duration)}</span>
        </div>
      </div>

      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
    </div>
  );
};

/**
 * PollAttachment — interactive poll bubble. Self-fetches its tally on
 * mount, listens for the global `uniflow:poll-update` window event so a
 * vote from any user updates the bars in real-time, and posts the
 * current user's vote via REST.
 *
 * Voting model:
 *   - single-choice: clicking an option submits immediately and replaces
 *     any prior vote.
 *   - multiple-choice: each click toggles that option in/out of the vote
 *     set; the user "commits" by clicking again (the latest set is what
 *     persists). For simplicity we send the new set after each click.
 *
 * Theme-matching glass-morphism shell + amber→purple accent so the poll
 * feels distinct from a plain message but still belongs to the chat.
 */
interface PollState {
  question: string;
  options: { id: string; text: string }[];
  multipleChoice: boolean;
  tallies: Record<string, number>;
  totalVoters: number;
  myVote: string[] | null;
}

const PollAttachment: React.FC<{
  messageId: string;
  sectionId: string;
  isMe: boolean;
  poll: { question: string; options: { id: string; text: string }[]; multipleChoice: boolean };
}> = ({ messageId, sectionId, isMe, poll }) => {
  const [state, setState] = useState<PollState>({
    ...poll,
    tallies: Object.fromEntries(poll.options.map((o) => [o.id, 0])),
    totalVoters: 0,
    myVote: null,
  });
  const [busy, setBusy] = useState(false);

  // Fetch the current tallies + caller's vote on mount.
  useEffect(() => {
    if (!sectionId || !messageId) return;
    let cancelled = false;
    const url = `${API_URLS.chat()}/api/chat/messages/${messageId}/poll?sectionId=${encodeURIComponent(sectionId)}`;
    fetch(url, { credentials: 'include', headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setState({
          question: data.question,
          options: data.options,
          multipleChoice: !!data.multipleChoice,
          tallies: data.tallies || {},
          totalVoters: data.totalVoters || 0,
          myVote: Array.isArray(data.myVote) ? data.myVote : data.myVote ?? null,
        });
      })
      .catch(() => { /* leave initial state */ });
    return () => { cancelled = true; };
  }, [messageId, sectionId]);

  // Live updates — host pages dispatch `uniflow:poll-update` whenever the
  // chat socket emits chat:pollVoted. The custom event keeps the bubble
  // self-contained (no socket access in this presentation component).
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ messageId: string; tallies: Record<string, number>; totalVoters: number }>;
      if (!ce.detail || ce.detail.messageId !== messageId) return;
      setState((prev) => ({ ...prev, tallies: ce.detail.tallies, totalVoters: ce.detail.totalVoters }));
    };
    window.addEventListener('uniflow:poll-update', handler as EventListener);
    return () => window.removeEventListener('uniflow:poll-update', handler as EventListener);
  }, [messageId]);

  const submitVote = useCallback(
    async (next: string[]) => {
      if (busy) return;
      setBusy(true);
      const prev = state.myVote;
      // Optimistic — flip myVote locally so the bars react immediately.
      setState((s) => ({ ...s, myVote: next }));
      try {
        const res = await fetch(`${API_URLS.chat()}/api/chat/messages/${messageId}/vote`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ sectionId, optionIds: next }),
        });
        if (!res.ok) {
          // Roll back on failure — server will broadcast the truth via
          // chat:pollVoted anyway, but rolling back prevents UI staleness.
          setState((s) => ({ ...s, myVote: prev }));
          return;
        }
        const data = await res.json();
        setState((s) => ({
          ...s,
          tallies: data.tallies || s.tallies,
          totalVoters: data.totalVoters ?? s.totalVoters,
          myVote: Array.isArray(data.myVote) ? data.myVote : s.myVote,
        }));
      } catch {
        setState((s) => ({ ...s, myVote: prev }));
      } finally {
        setBusy(false);
      }
    },
    [busy, messageId, sectionId, state.myVote],
  );

  const onClickOption = (optId: string) => {
    if (busy) return;
    const current = state.myVote ?? [];
    if (state.multipleChoice) {
      const next = current.includes(optId)
        ? current.filter((id) => id !== optId)
        : [...current, optId];
      submitVote(next);
    } else {
      // Single-choice: clicking the already-selected option retracts it.
      const next = current.length === 1 && current[0] === optId ? [] : [optId];
      submitVote(next);
    }
  };

  const totalVotes = state.totalVoters;
  const accent = isMe ? 'text-white' : 'text-[#7B5AFF] dark:text-[#bda8ff]';

  return (
    <div className={`mb-2 rounded-xl border ${isMe ? 'bg-white/10 border-white/20' : 'bg-amber-500/5 border-amber-500/20'} backdrop-blur-xl p-3 space-y-2.5 min-w-[240px] max-w-[320px]`}>
      <div className="flex items-center gap-2">
        <i className={`ph-fill ph-chart-bar ${accent} text-base`}></i>
        <span className={`text-[10px] uppercase tracking-wider font-bold ${accent}`}>
          {state.multipleChoice ? 'Multi-choice poll' : 'Poll'}
        </span>
      </div>
      <p className={`text-sm font-semibold ${isMe ? 'text-white' : 'text-black dark:text-white'} leading-snug`}>
        {state.question}
      </p>
      <div className="space-y-1.5">
        {state.options.map((opt) => {
          const count = state.tallies[opt.id] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = (state.myVote ?? []).includes(opt.id);
          // Text colors per context: a poll inside the sender's own purple
          // bubble (isMe) needs WHITE labels and counts because lavender or
          // grey on a purple bar blend into the background. Outside the
          // purple bubble we keep the dark/light theme contrast.
          const optionTextCls = isMe
            ? 'text-white'
            : 'text-black dark:text-white';
          const countTextCls = isMe
            ? 'text-white'
            : selected
            ? 'text-[#6A3FF4] dark:text-[#dec6ff]'
            : 'text-gray-700 dark:text-gray-300';
          const iconTextCls = selected
            ? isMe
              ? 'text-white'
              : 'text-[#7B5AFF]'
            : isMe
            ? 'text-white/80'
            : 'text-gray-500 dark:text-gray-400';
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onClickOption(opt.id)}
              disabled={busy}
              className={`relative w-full overflow-hidden rounded-lg border text-left transition-all ${
                selected
                  ? 'border-[#7B5AFF] bg-[#6A3FF4]/15 shadow-md shadow-[#6A3FF4]/20'
                  : 'border-white/15 bg-white/5 hover:bg-white/10 hover:border-[#6A3FF4]/30'
              } ${busy ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
            >
              {/* Result bar (absolute, behind the content) */}
              <div
                className={`absolute inset-y-0 left-0 transition-all ${
                  selected ? 'bg-gradient-to-r from-[#7B5AFF]/40 to-[#5A2AD4]/30' : 'bg-white/10'
                }`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2 min-w-0">
                  <i
                    className={`ph-${selected ? 'fill' : 'bold'} ${
                      state.multipleChoice
                        ? selected
                          ? 'ph-check-square'
                          : 'ph-square'
                        : selected
                        ? 'ph-radio-button'
                        : 'ph-circle'
                    } ${iconTextCls} text-sm flex-shrink-0`}
                  ></i>
                  <span className={`text-xs font-semibold truncate ${optionTextCls}`}>
                    {opt.text}
                  </span>
                </span>
                <span className={`text-[11px] font-bold ml-2 tabular-nums ${countTextCls}`}>
                  {pct}% · {count}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <p className={`text-[10px] flex items-center gap-1 font-medium ${isMe ? 'text-white/85' : 'text-gray-600 dark:text-gray-300'}`}>
        <i className="ph-bold ph-users-three"></i>
        {totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}
        {state.myVote != null && state.myVote.length > 0 && <span> · You voted</span>}
      </p>
    </div>
  );
};

const AttachmentBlock: React.FC<{
  attachment: ChatBubbleAttachment | FileAttachment;
  isMe: boolean;
  onImageClick?: (attachment: ChatBubbleAttachment | FileAttachment) => void;
  messageId?: string;
  sectionId?: string;
}> = ({ attachment, isMe, onImageClick, messageId, sectionId }) => {
  if (attachment.type === 'poll' && 'poll' in attachment && attachment.poll && messageId && sectionId) {
    return (
      <PollAttachment
        messageId={messageId}
        sectionId={sectionId}
        isMe={isMe}
        poll={attachment.poll}
      />
    );
  }
  if (attachment.type === 'image') {
    return (
      <button
        type="button"
        onClick={() => onImageClick?.(attachment)}
        className="block -mx-1 -mt-1 mb-2 max-w-full rounded-xl overflow-hidden border border-white/10 cursor-zoom-in"
      >
        <img
          src={attachment.url}
          alt={attachment.name}
          // Responsive: never exceed the bubble width on a phone (max-w-full),
          // cap at 280px on larger screens, cap height, preserve aspect (no
          // crop) so portrait/landscape images both lay out cleanly.
          className="w-auto max-w-full sm:max-w-[280px] max-h-[300px] rounded-lg hover:opacity-95 transition-opacity"
        />
      </button>
    );
  }
  if (attachment.type === 'video') {
    // Use the UniFlow custom-controls player (compact variant) so chat
    // videos look like the rest of the app instead of falling back to
    // browser-default chrome. Width is capped to fit the bubble's
    // attachment slot.
    return (
      <div className="mb-2 max-w-[280px]">
        <UniFlowVideoPlayer
          src={attachment.url}
          mimeType={'mimeType' in attachment ? attachment.mimeType : undefined}
          compact
        />
      </div>
    );
  }
  if (attachment.type === 'audio') {
    return <VoicePlayer url={attachment.url} isMe={isMe} />;
  }
  // Document / other — anchor download.
  const fileIcon =
    attachment.type === 'document' ? 'ph-file-doc' : 'ph-file';
  return (
    <a
      href={attachment.url}
      download={attachment.name}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-3 p-2 rounded-lg mb-2 text-sm ${
        isMe ? 'bg-white/15' : 'bg-[#6A3FF4]/10'
      }`}
    >
      <i className={`ph-fill ${fileIcon} text-xl text-[#7B5AFF] flex-shrink-0`}></i>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{attachment.name}</p>
        {attachment.size != null && (
          <p className="text-xs opacity-70">{formatFileSize(attachment.size)}</p>
        )}
      </div>
      <i className="ph-bold ph-download-simple text-sm opacity-70"></i>
    </a>
  );
};

/**
 * renderMentions — split a message string into plain text + highlighted
 * @-mentions. Matches one of:
 *   - `@all` (literal, case-insensitive)
 *   - `@<Capitalized>` with up to 2 additional capitalized words
 *     (covers "Sara", "Sara Hassan", "Mohamed Ahmed Saad")
 *
 * Each match must start at the beginning-of-string or after whitespace,
 * and end before whitespace / punctuation / end-of-string. Lowercase
 * follow-on words like the trailing "focus" in "@all focus" stay outside
 * the chip — fixing the previous over-greedy regex that wrapped them.
 */
function renderMentions(text: string, isMe: boolean): React.ReactNode {
  const out: React.ReactNode[] = [];
  // (1) `@all` standalone (case-insensitive) OR
  // (2) `@<Cap><lowers>` followed by 0-2 additional capitalized words.
  // Lookahead enforces: next char is whitespace, punctuation, or EOS.
  const re = /(^|\s)(@all\b|@[A-Z][A-Za-z'_-]*(?:\s[A-Z][A-Za-z'_-]*){0,2})(?=$|\s|[.,!?;:])/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, prefix, mention] = m;
    const start = m.index + prefix.length;
    if (start > last) out.push(<React.Fragment key={key++}>{text.slice(last, start)}</React.Fragment>);
    const isAll = /^@all$/i.test(mention);
    out.push(
      <span
        key={key++}
        className={`inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold ${
          isAll
            ? isMe
              ? 'bg-white/30 text-white'
              : 'bg-[#6A3FF4]/20 text-[#7B5AFF] dark:text-[#bda8ff]'
            : isMe
            ? 'bg-white/20 text-white'
            : 'bg-[#6A3FF4]/10 text-[#6A3FF4] dark:text-[#bda8ff]'
        }`}
      >
        {mention}
      </span>,
    );
    last = m.index + prefix.length + mention.length;
  }
  if (last < text.length) out.push(<React.Fragment key={key++}>{text.slice(last)}</React.Fragment>);
  return out.length > 0 ? out : text;
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  id,
  text,
  timestamp,
  isMe,
  showSenderInfo = true,
  sender,
  status,
  pinned,
  attachment,
  onImageClick,
  moderationActions,
  sectionId,
}) => {
  const { icon, gradient, shadow } = roleAvatar(sender.role);
  // Hide the sender chip + avatar entirely for the user's own messages.
  // For others, only render when `showSenderInfo` is true (consecutive
  // messages from the same sender suppress it for a cleaner stream).
  const renderSenderInfo = !isMe && showSenderInfo;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`flex flex-col group relative ${isMe ? 'items-end' : 'items-start'}`}
    >
      {/* Moderation hover bar */}
      {moderationActions && (
        <div className={`absolute -top-3 ${isMe ? 'left-2' : 'right-2'} opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10`}>
          {moderationActions}
        </div>
      )}

      <div className={`flex gap-3 max-w-[90%] md:max-w-[78%] ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        {!isMe && (
          <div className="flex-shrink-0 self-end mb-1">
            {renderSenderInfo ? (
              sender.avatar ? (
                <img
                  src={sender.avatar}
                  alt={sender.name}
                  className="w-9 h-9 rounded-xl object-cover shadow-lg"
                />
              ) : (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg bg-gradient-to-br ${gradient} ${shadow}`}
                >
                  <i className={`ph-fill ${icon} text-white text-sm`}></i>
                </div>
              )
            ) : (
              <div className="w-9 h-9" aria-hidden="true" />
            )}
          </div>
        )}

        <div className="space-y-1.5 min-w-0">
          {renderSenderInfo && (
            <span className="text-[10px] uppercase tracking-wider font-bold text-[#7B5AFF] block px-1">
              {sender.name}
            </span>
          )}

          {/* Bubble */}
          <div
            className={`px-4 md:px-5 py-3 text-sm leading-relaxed break-words ${
              isMe
                ? `whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[#6A3FF4]/40 backdrop-blur-xl text-white border border-[#6A3FF4]/30 shadow-lg shadow-purple-500/20 ${
                    pinned ? 'ring-2 ring-[#A855F7]/60' : ''
                  }`
                : `whitespace-pre-wrap rounded-2xl rounded-tl-md bg-white/10 dark:bg-white/[0.04] backdrop-blur-xl text-gray-800 dark:text-gray-100 border border-white/15 dark:border-white/10 shadow-lg shadow-black/5 ${
                    pinned ? 'ring-2 ring-[#A855F7]/60' : ''
                  }`
            }`}
          >
            {attachment && (
              <AttachmentBlock
                attachment={attachment}
                isMe={isMe}
                onImageClick={onImageClick}
                messageId={id}
                sectionId={sectionId}
              />
            )}
            {text && <span className="block">{renderMentions(text, isMe)}</span>}
          </div>

          {/* Footer — timestamp + status checkmark.
              SELF bubbles: clock → 1 check → 2 purple checks as the socket
              walks the message through pending → sent → read.
              RECEIVED bubbles: always 2 purple checks — viewing the bubble
              is the read confirmation.

              Per owner directive (2026-05-17 follow-up):
                - timestamp: gray in BOTH modes for BOTH sides.
                - checkmarks: purple/lavender in BOTH modes for BOTH sides.
              The previous "light-mode swap" rendered both as white on the
              self bubble's lavender-on-white surface, making them invisible.
              Using gray-400 (vs gray-500) on the self bubble so it has just
              enough contrast against the translucent purple background. */}
          <span
            className={`text-[10px] flex items-center gap-1 px-1 ${
              isMe ? 'justify-end' : 'justify-start'
            }`}
          >
            {timestamp && (
              <span className={isMe ? 'text-gray-300 dark:text-gray-400' : 'text-gray-500 dark:text-gray-500'}>
                {formatTime(timestamp)}
              </span>
            )}
            {isMe ? <StatusCheck status={status} /> : <ReceivedCheck />}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default ChatMessageBubble;
