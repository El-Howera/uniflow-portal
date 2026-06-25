/**
 * MentionInput
 *
 * Controlled text input with an @-mention popup. When the user types `@`
 * (or starts a word with `@`), a glass-morphism dropdown appears above
 * the input listing matching members + a synthetic "Everyone" option for
 * `@all`. Arrow keys / Enter pick a candidate; Esc / outside-click
 * dismiss; clicking inserts the mention name into the text at the
 * cursor.
 *
 * Output is plain text (e.g. "Hi @Sara Hassan and @all"). Mentions are
 * extracted server-side via the helper exported from this file. Keeping
 * mentions as text (vs. a structured rich-text payload) means polls /
 * attachments / system messages all stay simple JSON; the only added
 * complexity is the extractor.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface MentionMember {
  userId: string;
  firstName: string;
  lastName: string;
  role?: string; // 'professor' | 'ta' | 'student' | 'admin' (chat-admin)
  systemRole?: string; // backing User.role
  profilePicture?: string | null;
}

export interface MentionInputHandle {
  focus: () => void;
  /** Returns the current text + the userIds + hasAll flag of mentions. */
  drain: () => { text: string; userIds: string[]; hasAll: boolean };
}

interface MentionInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  members: MentionMember[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const fullName = (m: MentionMember) => `${m.firstName} ${m.lastName}`.trim() || 'Member';

const roleColor = (role?: string): string => {
  switch ((role || '').toLowerCase()) {
    case 'professor': return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30';
    case 'ta':        return 'bg-blue-500/20 text-blue-500 border-blue-500/30';
    case 'admin':     return 'bg-[#6A3FF4]/20 text-[#7B5AFF] border-[#6A3FF4]/30';
    default:          return 'bg-white/10 text-gray-500 dark:text-gray-300 border-white/20';
  }
};

/**
 * Walk back from `cursor` to find an `@`-anchored token. Returns the
 * mention query (text after `@`) and its start index, or null when the
 * cursor isn't currently inside an @-token.
 *
 * A valid mention region:
 *   - starts with `@`
 *   - the char before `@` is the start-of-string OR whitespace
 *   - the run between `@` and the cursor contains no whitespace (so once
 *     the user types a space, the popup auto-dismisses).
 */
function findActiveMention(text: string, cursor: number): { query: string; start: number } | null {
  if (cursor <= 0) return null;
  // Walk back until we hit `@`, whitespace, or start of text.
  let i = cursor - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') break;
    if (/\s/.test(ch)) return null; // crossed a word boundary without finding @
    i -= 1;
  }
  if (i < 0 || text[i] !== '@') return null;
  // Verify the char BEFORE `@` is start-of-text or whitespace.
  if (i > 0 && !/\s/.test(text[i - 1])) return null;
  return { query: text.slice(i + 1, cursor), start: i };
}

/**
 * Extract mention payload from a finished message. Keeps it deterministic:
 *   - Each member is matched by their full display name (case-sensitive
 *     since names are user-clicked from the popup, not typed by hand).
 *   - `@all` is matched as a standalone token (preceded + followed by
 *     whitespace or string-edge). Members literally named "all" are not
 *     special-cased — picking them inserts `@all First` and the regex
 *     check sees `@all` ≠ `@all First`. Fine for now; rare edge case.
 */
export function extractMentions(
  text: string,
  members: MentionMember[],
): { userIds: string[]; hasAll: boolean } {
  const userIds = new Set<string>();
  for (const m of members) {
    const needle = `@${fullName(m)}`;
    if (text.includes(needle)) userIds.add(m.userId);
  }
  const hasAll = /(^|\s)@all(?=\s|$)/i.test(text);
  return { userIds: [...userIds], hasAll };
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(function MentionInput(
  { value, onChange, onSubmit, members, placeholder, className, disabled },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ query: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState(0);

  // Filtered candidates — "Everyone" first when the query matches `all`
  // or is empty; then members ranked by name prefix match.
  const candidates = useMemo(() => {
    if (!active) return [] as Array<MentionMember | { kind: 'all' }>;
    const q = active.query.trim().toLowerCase();
    const everyone = { kind: 'all' as const };
    const filtered = members
      .filter((m) => {
        if (!q) return true;
        const name = fullName(m).toLowerCase();
        return name.includes(q) || m.firstName.toLowerCase().startsWith(q);
      })
      // Rank: prefix match on first name first, then includes.
      .sort((a, b) => {
        const ap = fullName(a).toLowerCase().startsWith(q) ? 0 : 1;
        const bp = fullName(b).toLowerCase().startsWith(q) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return fullName(a).localeCompare(fullName(b));
      })
      .slice(0, 6);
    const showEveryone = !q || 'all'.startsWith(q);
    return showEveryone ? [everyone, ...filtered] : filtered;
  }, [active, members]);

  // Reset highlight when candidates change.
  useEffect(() => {
    setHighlight(0);
  }, [active?.query, candidates.length]);

  const closePopup = useCallback(() => {
    setActive(null);
    setHighlight(0);
  }, []);

  // Re-evaluate active mention whenever value or cursor changes.
  const reevaluate = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    setActive(findActiveMention(value, cursor));
  }, [value]);

  useEffect(() => {
    reevaluate();
  }, [reevaluate]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    drain: () => {
      const m = extractMentions(value, members);
      return { text: value, userIds: m.userIds, hasAll: m.hasAll };
    },
  }));

  const insertMention = useCallback(
    (label: string) => {
      const el = inputRef.current;
      if (!el || !active) return;
      const cursor = el.selectionStart ?? value.length;
      const before = value.slice(0, active.start);
      const after = value.slice(cursor);
      const insertion = `@${label}`;
      // Append a space after the mention so the popup closes and the next
      // keystroke continues a normal sentence.
      const next = `${before}${insertion} ${after}`;
      onChange(next);
      closePopup();
      // Move cursor to end of inserted mention.
      requestAnimationFrame(() => {
        const at = before.length + insertion.length + 1;
        el.focus();
        try {
          el.setSelectionRange(at, at);
        } catch {
          /* ignore — input might not support setSelectionRange */
        }
      });
    },
    [active, value, onChange, closePopup],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (active && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = candidates[highlight];
        if (!pick) return;
        if ('kind' in pick && pick.kind === 'all') insertMention('all');
        else insertMention(fullName(pick as MentionMember));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopup();
        return;
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Popup is closed and Enter pressed. If a custom onSubmit is
      // wired, swallow the default and call it. Otherwise let the
      // event bubble — that way the surrounding `<form onSubmit>`
      // submits naturally (matching the input's previous behaviour).
      if (onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  // Outside click closes the popup.
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      const root = popupRef.current;
      const inp = inputRef.current;
      if (root && root.contains(e.target as Node)) return;
      if (inp && inp.contains(e.target as Node)) return;
      closePopup();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, closePopup]);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onClick={reevaluate}
        onKeyUp={reevaluate}
        onFocus={reevaluate}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />

      <AnimatePresence>
        {active && candidates.length > 0 && (
          <motion.div
            ref={popupRef}
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 mb-2 min-w-[260px] max-w-sm bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 rounded-2xl shadow-2xl backdrop-blur-2xl overflow-hidden z-50"
          >
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-gray-500 border-b border-white/10 flex items-center gap-1.5">
              <i className="ph-bold ph-at"></i>
              Mention {active.query ? `· ${active.query}` : ''}
            </div>
            {candidates.map((c, i) => {
              const selected = i === highlight;
              const isAll = 'kind' in c && c.kind === 'all';
              const onPick = () => (isAll ? insertMention('all') : insertMention(fullName(c as MentionMember)));
              return (
                <button
                  key={isAll ? '__all__' : (c as MentionMember).userId}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onPick}
                  className={`flex items-center gap-3 w-full text-left px-3 py-2 transition-colors ${
                    selected ? 'bg-[#6A3FF4]/15' : 'hover:bg-white/5'
                  }`}
                >
                  {isAll ? (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7B5AFF] to-[#5A2AD4] flex items-center justify-center flex-shrink-0">
                      <i className="ph-fill ph-megaphone-simple text-white text-sm"></i>
                    </div>
                  ) : (c as MentionMember).profilePicture ? (
                    <img
                      src={(c as MentionMember).profilePicture as string}
                      alt={fullName(c as MentionMember)}
                      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-bold">
                        {fullName(c as MentionMember).slice(0, 1).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-black dark:text-white truncate">
                      {isAll ? 'Everyone' : fullName(c as MentionMember)}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {isAll ? '@all — notify all members' : `@${fullName(c as MentionMember)}`}
                    </p>
                  </div>
                  {!isAll && (c as MentionMember).role && (
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${roleColor((c as MentionMember).role)}`}>
                      {(c as MentionMember).role}
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

MentionInput.displayName = 'MentionInput';

export default MentionInput;
