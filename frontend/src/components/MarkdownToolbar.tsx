/**
 * MarkdownToolbar + render helpers
 * ----------------------------------------------------------------------------
 * A small, dependency-free Markdown editor pair used by the announcement,
 * form, and quiz composers. The toolbar inserts Markdown syntax around the
 * user's selected text in the bound textarea; `renderMarkdown` parses the
 * subset we support back into React nodes for the display side.
 *
 * Supported syntax (compose-side toolbar + display-side render):
 *   **bold**            → <strong>bold</strong>
 *   *italic*            → <em>italic</em>
 *   `code`              → <code>code</code>
 *   # heading           → <h-style>heading</h-style>
 *   - bullet            → <li>bullet</li>
 *   1. numbered         → <li>numbered</li>
 *   > quote             → <blockquote>quote</blockquote>
 *
 * Both helpers escape user text before substituting so we never embed raw
 * HTML — safe to use anywhere we render free-form user input.
 */

import React from 'react';

export type MarkdownTextareaRef = React.RefObject<HTMLTextAreaElement | null>;

/**
 * Wrap the current selection in the textarea with `before`/`after`, or insert
 * the prefix at the line start when no selection (used for bullets / heading).
 *
 * @param textareaRef - the textarea whose selection we're editing
 * @param value       - current controlled value
 * @param onChange    - controlled-value setter
 * @param before      - text inserted before the selection
 * @param after       - text inserted after the selection
 * @param linePrefix  - when set, inserts at the line start instead of wrapping
 */
function applyMarkdown(
    textareaRef: MarkdownTextareaRef,
    value: string,
    onChange: (next: string) => void,
    before: string,
    after: string,
    linePrefix?: string,
): void {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);

    let next: string;
    let nextStart: number;
    let nextEnd: number;
    if (linePrefix) {
        // Find the start of the current line (or selection start).
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineText = value.slice(lineStart, end);
        const lines = lineText.split('\n');
        const prefixed = lines.map((l) => `${linePrefix}${l}`).join('\n');
        next = value.slice(0, lineStart) + prefixed + value.slice(end);
        nextStart = lineStart;
        nextEnd = lineStart + prefixed.length;
    } else {
        next = value.slice(0, start) + before + selected + after + value.slice(end);
        nextStart = start + before.length;
        nextEnd = nextStart + selected.length;
    }
    onChange(next);
    // Restore focus + selection on the next tick so the textarea re-renders
    // with the new value before we set the caret.
    requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(nextStart, nextEnd);
    });
}

/**
 * Auto-continue Markdown list prefixes when the user presses Enter. Mirrors
 * the behaviour rich editors (Discord, Notion, GitHub) have trained users
 * to expect: hitting Enter inside a bullet auto-inserts `- ` on the next
 * line; hitting Enter on an EMPTY bullet exits the list. Same logic for
 * `* ` and `1. ` numbered prefixes.
 *
 * Wire this into the consumer textarea's `onKeyDown`:
 *   <textarea onKeyDown={(e) => handleMarkdownEnter(e, body, setBody)} ... />
 *
 * Returns true when the handler swallowed the keypress (so the consumer
 * can short-circuit any chained handler) — currently informational only.
 */
export function handleMarkdownEnter(
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    value: string,
    onChange: (next: string) => void,
): boolean {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start !== end) return false; // selection — let default replace happen
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.slice(lineStart, start);

    // Bullet (- or *) — capture any leading whitespace so indentation is
    // preserved across the new bullet.
    const bullet = /^(\s*)([-*])\s+(.*)$/.exec(currentLine);
    if (bullet) {
        const [, indent, marker, content] = bullet;
        // Empty bullet — Enter on a bare "- " exits the list (strip the
        // prefix and produce a blank line instead).
        if (content === '') {
            e.preventDefault();
            const next = value.slice(0, lineStart) + value.slice(start);
            onChange(next);
            requestAnimationFrame(() => {
                ta.focus();
                ta.setSelectionRange(lineStart, lineStart);
            });
            return true;
        }
        // Continue the list — insert "\n<indent><marker> " at the caret.
        e.preventDefault();
        const insert = `\n${indent}${marker} `;
        const next = value.slice(0, start) + insert + value.slice(end);
        const caret = start + insert.length;
        onChange(next);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(caret, caret);
        });
        return true;
    }

    // Numbered list (`1. `, `2. `, etc.) — increment on continue.
    const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(currentLine);
    if (numbered) {
        const [, indent, n, content] = numbered;
        if (content === '') {
            e.preventDefault();
            const next = value.slice(0, lineStart) + value.slice(start);
            onChange(next);
            requestAnimationFrame(() => {
                ta.focus();
                ta.setSelectionRange(lineStart, lineStart);
            });
            return true;
        }
        e.preventDefault();
        const insert = `\n${indent}${parseInt(n, 10) + 1}. `;
        const next = value.slice(0, start) + insert + value.slice(end);
        const caret = start + insert.length;
        onChange(next);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(caret, caret);
        });
        return true;
    }

    // Blockquote (`> `) — same continuation pattern.
    const quote = /^(\s*)>\s*(.*)$/.exec(currentLine);
    if (quote) {
        const [, indent, content] = quote;
        if (content === '') {
            e.preventDefault();
            const next = value.slice(0, lineStart) + value.slice(start);
            onChange(next);
            requestAnimationFrame(() => {
                ta.focus();
                ta.setSelectionRange(lineStart, lineStart);
            });
            return true;
        }
        e.preventDefault();
        const insert = `\n${indent}> `;
        const next = value.slice(0, start) + insert + value.slice(end);
        const caret = start + insert.length;
        onChange(next);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(caret, caret);
        });
        return true;
    }

    return false;
}

interface ToolbarProps {
    textareaRef: MarkdownTextareaRef;
    value: string;
    onChange: (next: string) => void;
    /** Hides the heading button in tight layouts (e.g. quiz question rows). */
    compact?: boolean;
}

export const MarkdownToolbar: React.FC<ToolbarProps> = ({
    textareaRef,
    value,
    onChange,
    compact = false,
}) => {
    const btnCls = 'w-7 h-7 rounded text-black dark:text-gray-300 hover:bg-white/20 dark:hover:bg-white/10 flex items-center justify-center transition-colors text-xs font-bold';
    const buttons: Array<{ key: string; label: React.ReactNode; title: string; onClick: () => void; hideOnCompact?: boolean }> = [
        {
            key: 'bold',
            label: <span className="font-bold">B</span>,
            title: 'Bold (**text**)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '**', '**'),
        },
        {
            key: 'italic',
            label: <span className="italic">I</span>,
            title: 'Italic (*text*)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '*', '*'),
        },
        {
            key: 'code',
            label: <i className="ph-bold ph-code"></i>,
            title: 'Inline code (`text`)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '`', '`'),
        },
        {
            key: 'heading',
            label: <span className="font-bold text-[10px]">H</span>,
            title: 'Heading (# text)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '', '', '# '),
            hideOnCompact: true,
        },
        {
            key: 'bullet',
            label: <i className="ph-bold ph-list-bullets"></i>,
            title: 'Bullet list (- text)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '', '', '- '),
        },
        {
            key: 'numbered',
            label: <i className="ph-bold ph-list-numbers"></i>,
            title: 'Numbered list (1. text)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '', '', '1. '),
        },
        {
            key: 'quote',
            label: <i className="ph-bold ph-quotes"></i>,
            title: 'Quote (> text)',
            onClick: () => applyMarkdown(textareaRef, value, onChange, '', '', '> '),
        },
    ];

    return (
        <div className="flex items-center gap-0.5 mb-1.5 px-1.5 py-1 rounded-lg bg-white/5 dark:bg-black/20 border border-white/10 w-fit">
            {buttons
                .filter((b) => !(compact && b.hideOnCompact))
                .map((b) => (
                    <button
                        key={b.key}
                        type="button"
                        title={b.title}
                        onClick={b.onClick}
                        className={btnCls}
                    >
                        {b.label}
                    </button>
                ))}
        </div>
    );
};

// ─── Render side ─────────────────────────────────────────────────────────────

/** Escape user text before substituting Markdown so no raw HTML leaks through. */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Inline subset: bold, italic, code. */
function renderInline(line: string): React.ReactNode {
    // We escape line first, then re-substitute the safe Markdown markers.
    let safe = escapeHtml(line);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
    safe = safe.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-white/10 dark:bg-black/30 text-[0.9em]">$1</code>');
    return <span dangerouslySetInnerHTML={{ __html: safe }} />;
}

/**
 * Render the Markdown subset we support to React nodes. Returns null when the
 * input is empty so callers can short-circuit with `||`.
 *
 * Block-level: headings (# ## ###), bullet lists (- / *), numbered lists
 * (1. 2. 3.), blockquotes (>). Everything else renders as a <p>.
 */
export function renderMarkdown(text: string | null | undefined): React.ReactNode {
    if (!text) return null;
    // Normalize Windows / mixed line endings — without this, `- bullet\r`
    // matches the bullet regex but the trailing \r leaks into the rendered
    // text. Also normalises any unicode bullet glyphs the user might have
    // pasted (•, ●) to the standard `- ` markdown form so they render
    // through the same code path.
    const normalized = String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Collapse pasted unicode bullet glyphs to standard `- `. IMPORTANT:
        // do NOT include a literal SPACE in the character class — an
        // earlier draft did, which silently converted any space-indented
        // line into a forced bullet. Only real bullet glyphs map here.
        .replace(/^[\u2022\u25CF\u25E6\u2043\u2219]\s+/gm, '- ');
    const lines = normalized.split('\n');
    const out: React.ReactNode[] = [];
    let inList: 'ul' | 'ol' | null = null;
    let listItems: React.ReactNode[] = [];

    const flushList = () => {
        if (inList && listItems.length > 0) {
            // Bullet + numbered lists render as the chatbot/student-announcements
            // styles: purple Phosphor dot for bullets, circular purple badge with
            // the index number for ordered lists. Using a custom UL means we don't
            // need `list-disc` (Tailwind utility) which prose plugins sometimes
            // strip, and the icon stays visually consistent with the rest of UI.
            out.push(
                <ul key={`list-${out.length}`} className="space-y-1 my-1 pl-0">
                    {listItems}
                </ul>,
            );
        }
        inList = null;
        listItems = [];
    };

    // Pre-detect whether a blank line is INSIDE a list block. If the next
    // non-blank line is also a list item of the same type, the blank line
    // is just visual padding between bullets — we don't want to flush the
    // ul/ol. This fixes the most common composer authoring pattern:
    //   - First bullet
    //
    //   - Second bullet     <-- blank line between is intentional spacing
    //
    //   - Third bullet
    // …which previously rendered as three separate single-item ULs and
    // looked broken next to "tight" lists with no spacing.
    const peekNextNonBlankKind = (fromIdx: number): 'ul' | 'ol' | null => {
        for (let j = fromIdx; j < lines.length; j++) {
            const t = lines[j].trimStart();
            if (!t) continue;
            if (/^[-*]\s+/.test(t)) return 'ul';
            if (/^\d+\.\s+/.test(t)) return 'ol';
            return null;
        }
        return null;
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trimStart();

        // Blank line — soft separator inside an active list (don't flush),
        // gap-emitting paragraph break otherwise.
        if (!trimmed) {
            const nextKind = peekNextNonBlankKind(i + 1);
            if (inList && nextKind === inList) {
                // Within-list spacing — preserve the list but emit a tiny
                // visual breather inside it. Don't flush; the loop's next
                // iteration appends to the same ul/ol.
                continue;
            }
            flushList();
            out.push(<div key={`gap-${i}`} className="h-2" />);
            continue;
        }

        // Heading
        const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        if (h) {
            flushList();
            const level = h[1].length;
            const cls = level === 1
                ? 'text-lg font-bold mt-1 mb-1'
                : level === 2
                    ? 'text-base font-bold mt-1 mb-1'
                    : 'text-sm font-bold mt-1 mb-1';
            const Tag = (level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
            out.push(<Tag key={`h-${i}`} className={cls}>{renderInline(h[2])}</Tag>);
            continue;
        }

        // Bullet list — chatbot-style purple dot icon next to each item.
        const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
        if (bullet) {
            if (inList !== 'ul') {
                flushList();
                inList = 'ul';
            }
            listItems.push(
                <li
                    key={`li-${i}`}
                    className="text-gray-700 dark:text-gray-300 ml-4 mb-1 flex items-start gap-2 list-none"
                >
                    <i className="ph-fill ph-dot text-[#6A3FF4] text-2xl leading-none mt-[-2px]"></i>
                    <span className="flex-1 min-w-0">{renderInline(bullet[1])}</span>
                </li>,
            );
            continue;
        }

        // Numbered list — chatbot-style purple circular badge with the index.
        // We capture the typed number itself (group 1) and use IT in the badge,
        // rather than counting list items off `listItems.length + 1`. Why:
        // when a numbered list gets interrupted by other content (a bullet
        // list, a paragraph, a heading) and resumes later, the resume block
        // is a brand new <ol> internally — counting would always start back
        // at 1 even though the author wrote "2." or "3." Honouring the typed
        // number preserves the author's intent across interruptions.
        const num = /^(\d+)\.\s+(.*)$/.exec(trimmed);
        if (num) {
            if (inList !== 'ol') {
                flushList();
                inList = 'ol';
            }
            const idx = parseInt(num[1], 10) || (listItems.length + 1);
            listItems.push(
                <li
                    key={`li-${i}`}
                    className="text-gray-700 dark:text-gray-300 ml-4 mb-1 flex items-start gap-3 list-none"
                >
                    <span className="w-6 h-6 rounded-full bg-[#6A3FF4]/20 text-[#6A3FF4] flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                        {idx}
                    </span>
                    <span className="flex-1 min-w-0">{renderInline(num[2])}</span>
                </li>,
            );
            continue;
        }

        // Blockquote
        const quote = /^>\s*(.*)$/.exec(trimmed);
        if (quote) {
            flushList();
            out.push(
                <blockquote
                    key={`q-${i}`}
                    className="border-l-2 border-[#6A3FF4]/50 pl-3 italic text-gray-700 dark:text-gray-300 my-1"
                >
                    {renderInline(quote[1])}
                </blockquote>,
            );
            continue;
        }

        // Plain paragraph
        flushList();
        out.push(<p key={`p-${i}`} className="my-1">{renderInline(raw)}</p>);
    }
    flushList();
    return <>{out}</>;
}

export default MarkdownToolbar;
