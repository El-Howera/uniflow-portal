import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimateOnView } from '../../components/AnimateOnView';
import {
  sendChatMessage as sendBotMessage,
  streamChatMessage,
  resetChatSession,
} from '../../utils/chatbotService';
import { useT } from '../../i18n';

/* ─── types ─── */
interface ChatMsg {
  id: number;
  role: 'bot' | 'user';
  text: string;
  suggestions?: string[];
  ts: string;
  /** Inline widget rendered below the message text — currently the only
   *  case is the FCDS location card with embedded map. */
  widget?: 'fcds-location';
}

/* ─── lightweight markdown renderer ───
 * Mistral emits **bold**, *italic*, ### headers, and - bullet lists. Rather
 * than pulling in react-markdown (heavy), we render the subset the chatbot
 * actually produces. React's text-escaping keeps this XSS-safe — we never
 * dangerouslySetInnerHTML.
 */
const renderInline = (line: string, key: string | number): React.ReactNode => {
  // Match **bold** or *italic* or `code`. Order matters in the regex —
  // double-asterisk first so it doesn't get eaten by single-asterisk.
  const parts: React.ReactNode[] = [];
  let m: RegExpExecArray | null;
  const re = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  let last = 0;
  let n = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={`${key}-b${n++}`} className="font-semibold text-black dark:text-white">{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<em key={`${key}-i${n++}`}>{m[3]}</em>);
    else if (m[4] !== undefined) parts.push(<code key={`${key}-c${n++}`} className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[0.85em] font-mono">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length > 0 ? parts : line;
};

// Strip hallucinated markdown URLs that the LLM occasionally invents
// (e.g. "[Article 22(b)](https://example.com)"). Nothing in the regulations
// corpus has URLs, so any [text](http(s)://...) link is a fabrication.
// Keep the link text, drop the URL part. Also handles bare <http://...>
// angle-bracket URLs.
const stripFakeUrls = (text: string): string => {
  let out = text;
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');
  out = out.replace(/<https?:\/\/[^>]+>/g, '');
  return out;
};

const formatMarkdown = (text: string): React.ReactNode => {
  if (!text) return null;
  const lines = stripFakeUrls(text).split('\n');
  const out: React.ReactNode[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const trimmed = raw.trimStart();
    // Headers (#, ##, ###, ####). Render bigger + bolder.
    const hMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (hMatch) {
      const level = hMatch[1].length;
      const sizeClass = level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm';
      out.push(
        <div key={`h-${idx}`} className={`${sizeClass} font-bold text-black dark:text-white mt-2 mb-1`}>
          {renderInline(hMatch[2], `h${idx}`)}
        </div>
      );
      continue;
    }
    // Bullet list item (-, *, •)
    const bulletMatch = /^[-*•]\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      out.push(
        <div key={`b-${idx}`} className="flex gap-2 my-0.5 pl-1">
          <span className="text-[#6A3FF4] flex-shrink-0">•</span>
          <span className="flex-1">{renderInline(bulletMatch[1], `b${idx}`)}</span>
        </div>
      );
      continue;
    }
    // Numbered list item
    const numMatch = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    if (numMatch) {
      out.push(
        <div key={`n-${idx}`} className="flex gap-2 my-0.5 pl-1">
          <span className="text-[#6A3FF4] flex-shrink-0 font-semibold">{numMatch[1]}.</span>
          <span className="flex-1">{renderInline(numMatch[2], `n${idx}`)}</span>
        </div>
      );
      continue;
    }
    // Blank line — spacer
    if (raw.trim() === '') {
      out.push(<div key={`s-${idx}`} className="h-2" />);
      continue;
    }
    // Plain paragraph line with inline formatting
    out.push(<div key={`p-${idx}`}>{renderInline(raw, `p${idx}`)}</div>);
  }
  return <>{out}</>;
};

/* ─── initial welcome ─── */
const WELCOME: ChatMsg = {
  id: 1,
  role: 'bot',
  text: "Hi there! 👋 I'm your AI-powered University Regulations Assistant.\nAsk me anything about academic policies, grading, credit hours, study plans, and more.",
  suggestions: [
    'What are the graduation requirements?',
    'How is GPA calculated?',
    'Where is the FCDS campus?',
    'Cybersecurity semester 4 courses',
  ],
  ts: 'Just now',
};

/* ─── typing indicator ─── */
const TypingDots: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -10 }}
    className="flex items-start gap-3"
  >
    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#6A3FF4] to-[#A855F7] flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/25">
      <i className="ph-fill ph-robot text-white text-sm" />
    </div>
    <div className="px-5 py-3.5 rounded-2xl rounded-tl-md bg-white/10 dark:bg-white/[0.04] backdrop-blur-xl border border-white/15 dark:border-white/10">
      <div className="flex gap-1.5 items-center h-5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-gradient-to-r from-[#6A3FF4] to-[#A855F7]"
            animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </div>
  </motion.div>
);

/* ─── FCDS location card ─────────────────────────────────────────────────────
 * Glass-morphism map card that the chatbot drops in below its text response
 * whenever the user asks about the campus location. Uses Google Maps' free
 * iframe embed (no API key, no usage limit for static centred maps) and
 * frames it in the project's brand chrome — purple gradient header strip,
 * inset rings, frosted glass — so it doesn't look like a foreign widget.
 *
 * The exact pin is the share link the user provided:
 *   https://maps.app.goo.gl/cDogrYvLLfe6dZBB9
 * which resolves to FCDS — Faculty of Computers and Data Science, Alexandria
 * University, Smouha. We render the search query rather than raw lat/lng so
 * the marker label reads "Faculty of Computers and Data Science" in the
 * embedded map.
 */
const FCDS_MAPS_QUERY = encodeURIComponent('Faculty of Computers and Data Science Alexandria University');
const FCDS_MAPS_EMBED = `https://maps.google.com/maps?q=${FCDS_MAPS_QUERY}&t=&z=16&ie=UTF8&iwloc=&output=embed`;
const FCDS_MAPS_OPEN = `https://maps.google.com/maps?q=${FCDS_MAPS_QUERY}`;
const FCDS_ADDRESS_LINES = [
  'Faculty of Computers and Data Science',
  'Alexandria University, Smouha',
  'Alexandria, Egypt',
];

const FcdsLocationCard: React.FC = () => (
  <div className="mt-3 rounded-2xl overflow-hidden bg-white/95 dark:bg-[#141414]/95 border border-white/30 dark:border-white/10 ring-1 ring-inset ring-white/30 dark:ring-white/5 shadow-lg shadow-black/20 backdrop-blur-2xl">
    {/* Brand accent stripe */}
    <div className="h-1.5 w-full bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4]" />
    <div className="p-4 flex items-center gap-3 border-b border-black/5 dark:border-white/10">
      <div className="w-10 h-10 rounded-xl bg-[#6A3FF4]/15 flex items-center justify-center flex-shrink-0">
        <i className="ph-fill ph-map-pin text-2xl text-[#6A3FF4]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-black dark:text-white truncate">
          Faculty of Computers &amp; Data Science
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
          Alexandria University · Smouha campus
        </div>
      </div>
    </div>
    <div className="relative w-full aspect-[16/10] bg-black">
      <iframe
        title="FCDS — Faculty of Computers and Data Science"
        src={FCDS_MAPS_EMBED}
        className="absolute inset-0 w-full h-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      {/* Subtle inner ring so the map edges feel framed against the card */}
      <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-white/5" />
    </div>
    <div className="p-4 flex items-center justify-between gap-3">
      <div className="text-xs text-gray-600 dark:text-gray-400 leading-tight min-w-0">
        {FCDS_ADDRESS_LINES.map((line) => (
          <div key={line} className="truncate">{line}</div>
        ))}
      </div>
      <a
        href={FCDS_MAPS_OPEN}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-[#7B5AFF] to-[#5A2AD4] hover:opacity-95 shadow shadow-purple-500/30 transition-opacity"
      >
        <i className="ph-bold ph-navigation-arrow" /> Open in Maps
      </a>
    </div>
  </div>
);

/* ─── intent: did the user ask about FCDS / campus location? ──────────────
 * Conservative regex — fires on EN + AR queries that name an address-like
 * concept. Used by the send() handler to short-circuit before the chatbot
 * API call: the campus location isn't in the RAG corpus, so the LLM would
 * otherwise refuse. We return a hard-coded response + render the map card.
 */
const isFcdsLocationQuery = (text: string): boolean => {
  const t = text.toLowerCase().trim();
  // EN — "where is FCDS / the campus / the faculty / the university",
  // "campus location / address / how to get to / find / on map".
  if (/\b(where|location|address|map|directions|how do i (get|find)|how to (get|find))\b/.test(t)
      && /\b(fcds|campus|faculty|college|university|uni|building|class(es)?)\b/.test(t)) {
    return true;
  }
  // Standalone "FCDS location" / "campus address" patterns.
  if (/\b(fcds|campus|faculty)\b.*\b(location|address|map|directions)\b/.test(t)) {
    return true;
  }
  if (/\b(location|address|map|directions)\b.*\b(fcds|campus|faculty)\b/.test(t)) {
    return true;
  }
  // AR — "أين" + الكليه/الحرم/الجامعه/FCDS, etc.
  if (/(أين|اين|عنوان|موقع|خريطة).*(كلية|الكليه|الحرم|الجامعة|الجامعه|fcds)/i.test(text)) {
    return true;
  }
  return false;
};

/* ─── single message bubble ─── */
const MessageBubble: React.FC<{ msg: ChatMsg; onSuggestion: (s: string) => void }> = ({
  msg,
  onSuggestion,
}) => {
  const isUser = msg.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div className={`flex gap-3 max-w-[90%] md:max-w-[75%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* avatar */}
        <motion.div
          whileHover={{ scale: 1.1 }}
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 shadow-lg ${
            isUser
              ? 'bg-gradient-to-br from-gray-600 to-gray-800 shadow-gray-500/20'
              : 'bg-gradient-to-br from-[#6A3FF4] to-[#A855F7] shadow-purple-500/25'
          }`}
        >
          <i className={`ph-fill ${isUser ? 'ph-user' : 'ph-robot'} text-white text-sm`} />
        </motion.div>

        {/* bubble */}
        <div className="space-y-1.5 min-w-0">
          <div
            className={`px-4 md:px-5 py-3 md:py-3.5 text-sm leading-relaxed break-words ${
              isUser
                ? 'whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[#6A3FF4]/40 backdrop-blur-xl text-white border border-[#6A3FF4]/30 shadow-lg shadow-purple-500/20'
                : 'rounded-2xl rounded-tl-md bg-white/10 dark:bg-white/[0.04] backdrop-blur-xl text-gray-800 dark:text-gray-100 border border-white/15 dark:border-white/10 shadow-lg shadow-black/5'
            }`}
          >
            {isUser ? msg.text : formatMarkdown(msg.text)}
            {/* Inline widget — currently the FCDS map card. Sits under
                the prose so the answer reads first, the map opens second. */}
            {!isUser && msg.widget === 'fcds-location' && <FcdsLocationCard />}
          </div>
          <span
            className={`text-[10px] text-gray-500 dark:text-gray-600 block px-1 ${
              isUser ? 'text-right' : 'text-left'
            }`}
          >
            {msg.ts}
          </span>
        </div>
      </div>

      {/* suggestion chips */}
      {msg.suggestions && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="ml-12 mt-3 flex flex-wrap gap-2"
        >
          {msg.suggestions.map((s) => (
            <motion.button
              key={s}
              whileHover={{ scale: 1.04, y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSuggestion(s)}
              className="text-xs px-4 py-2 rounded-full border border-[#6A3FF4]/30 dark:border-[#6A3FF4]/20
                         bg-white/10 dark:bg-white/[0.04] backdrop-blur-md
                         text-[#6A3FF4] dark:text-purple-300
                         hover:bg-[#6A3FF4] hover:text-white hover:border-transparent
                         hover:shadow-lg hover:shadow-purple-500/20
                         transition-all duration-200"
            >
              {s}
            </motion.button>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};

/* ══════════════════════════════════════════════════════════ */
/*  Main Chatbot Component                                   */
/* ══════════════════════════════════════════════════════════ */
const Chatbot: React.FC = () => {
  const t = useT();
  // Build the welcome message lazily so its strings respect the active locale.
  // The hardcoded WELCOME constant is kept for type-shape reference only.
  const localizedWelcome = useMemo<ChatMsg>(() => ({
    id: 1,
    role: 'bot',
    text: t('chatbotPage.welcomeText'),
    suggestions: [
      t('chatbotPage.suggestion1'),
      t('chatbotPage.suggestion2'),
      // Location suggestion intercepted client-side; works in both locales
      // via the bilingual isFcdsLocationQuery regex.
      t('chatbotPage.suggestionLocation') || 'Where is the FCDS campus?',
      t('chatbotPage.suggestion3'),
    ],
    ts: t('chatbotPage.justNow'),
  }), [t]);
  const [messages, setMessages] = useState<ChatMsg[]>([localizedWelcome]);
  // Re-localise the FIRST message (the welcome) when locale flips. We only
  // touch index 0 so user/bot conversation history is preserved.
  useEffect(() => {
    setMessages((prev) => prev.length === 0
      ? [localizedWelcome]
      : [localizedWelcome, ...prev.slice(1)]);
  }, [localizedWelcome]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  /* ── send handler ── */
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      const userMsg: ChatMsg = { id: Date.now(), role: 'user', text: trimmed, ts: 'Just now' };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');

      // Intent intercept — campus location isn't in the RAG corpus, so the
      // LLM would otherwise refuse. Detect and answer with a hard-coded
      // response + map widget BEFORE the network round-trip. Keeps the
      // chatbot helpful for the most common navigation question.
      if (isFcdsLocationQuery(trimmed)) {
        const botMsg: ChatMsg = {
          id: Date.now() + 1,
          role: 'bot',
          text:
            "FCDS — the Faculty of Computers and Data Science — is on Alexandria University's Smouha campus. Here's the pin on the map:",
          widget: 'fcds-location',
          ts: 'Just now',
        };
        // Brief micro-pause so the bubble doesn't pop in the same frame as
        // the user message (otherwise it feels jarring).
        setLoading(true);
        window.setTimeout(() => {
          setMessages((prev) => [...prev, botMsg]);
          setLoading(false);
        }, 280);
        return;
      }

      setLoading(true);

      // Streaming opt-in via localStorage flag (default ON per Plan 13 Phase 5).
      // Set localStorage.chatStreaming = 'false' to disable.
      const streamEnabled =
        (typeof localStorage !== 'undefined' &&
          localStorage.getItem('chatStreaming') !== 'false');

      try {
        if (streamEnabled) {
          // Append an empty bot message and grow its text as deltas arrive.
          const botId = Date.now() + 1;
          let acc = '';
          let metaFallback = false;
          setMessages((prev) => [...prev, { id: botId, role: 'bot', text: '', ts: 'Just now' }]);
          try {
            for await (const chunk of streamChatMessage(trimmed)) {
              if (typeof chunk === 'string') {
                acc += chunk;
                const snapshot = acc;
                setMessages((prev) =>
                  prev.map((m) => (m.id === botId ? { ...m, text: snapshot } : m))
                );
              } else if (chunk && typeof chunk === 'object' && '__meta' in chunk) {
                metaFallback = !!chunk.__meta.fallback;
              }
            }
          } catch (streamErr) {
            // Stream failed — fall back to a single-shot request below.
            // Mirror the non-streaming path's defensive parse so object-shaped
            // responses ({text}/{content}) don't render as [object Object].
            console.warn('[chatbot] stream error, falling back to /api/chat:', streamErr);
            const data = await sendBotMessage(trimmed);
            let fallbackText = 'Sorry, the chatbot is unavailable right now.';
            if (data?.response) {
              fallbackText = typeof data.response === 'string'
                ? data.response
                : ((data.response as { text?: string; content?: string })?.text
                    ?? (data.response as { text?: string; content?: string })?.content
                    ?? JSON.stringify(data.response));
            } else if (data?.error && !['Internal server error', 'llm_error'].includes(data.error)) {
              fallbackText = data.error;
            }
            acc = fallbackText;
            setMessages((prev) =>
              prev.map((m) => (m.id === botId ? { ...m, text: fallbackText } : m))
            );
            metaFallback = !!data?.fallback;
          }
          if (!acc.trim()) {
            // Empty stream → show a friendly fallback.
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botId ? { ...m, text: 'Sorry, I could not get a response. Please try again.' } : m
              )
            );
          }
          if (metaFallback) {
            setMessages((prev) => [
              ...prev,
              { id: Date.now() + 3, role: 'bot', text: '⚠️ The model is currently unavailable. Showing source excerpts.', ts: 'Just now' },
            ]);
          }
        } else {
          const data = await sendBotMessage(trimmed);
          let botText = 'Sorry, I could not get a response. Please try again.';
          if (data?.response) {
            botText = typeof data.response === 'string'
              ? data.response
              : ((data.response as any)?.text ?? (data.response as any)?.content ?? JSON.stringify(data.response));
          } else if (data?.error && !['Internal server error', 'llm_error'].includes(data.error))
            botText = data.error;

          const botMsg: ChatMsg = { id: Date.now() + 1, role: 'bot', text: botText, ts: 'Just now' };
          setMessages((prev) => [...prev, botMsg]);

          if (data?.fallback) {
            setMessages((prev) => [
              ...prev,
              { id: Date.now() + 3, role: 'bot', text: '⚠️ The model is currently unavailable. Showing source excerpts.', ts: 'Just now' },
            ]);
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'bot',
            text: "Sorry, I'm having trouble connecting to the server. Please make sure the backend is running.",
            ts: 'Just now',
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [loading],
  );

  /* ── clear chat ── */
  const clearChat = useCallback(() => {
    resetChatSession();
    setMessages([WELCOME]);
  }, []);

  return (
    <div ref={containerRef} className="flex flex-col pb-4 md:pb-8">

      {/* ── header ── */}
      <AnimateOnView>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 4 }}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6A3FF4] to-[#A855F7] flex items-center justify-center shadow-lg shadow-purple-500/25"
              >
                <i className="ph-fill ph-robot text-white text-lg" />
              </motion.div>
              <div>
                <h2 className="text-black dark:text-white text-2xl md:text-3xl font-bold">
                  {t('chatbotPage.title')}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('chatbotPage.subtitle')}</span>
                </div>
              </div>
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={clearChat}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium
                       bg-white/10 dark:bg-white/5 backdrop-blur-md
                       border border-white/15 dark:border-white/10
                       text-gray-600 dark:text-gray-400
                       hover:text-red-500 hover:border-red-500/30
                       transition-colors duration-200"
          >
            <i className="ph ph-trash text-sm" />
            {t('chatbotPage.clear')}
          </motion.button>
        </div>
      </AnimateOnView>

      {/* ── chat container — glass card ── */}
      <AnimateOnView delay={0.1}>
        <div className="relative overflow-hidden rounded-2xl
                        bg-white/20 dark:bg-black/20
                        border border-white/20 dark:border-white/10
                        shadow-2xl shadow-purple-500/5
                        backdrop-blur-2xl"
             style={{ height: 'calc(100vh - 14rem)' }}
        >
          {/* ── decorative gradient orbs inside the card ── */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <motion.div
              className="absolute -top-20 -left-20 w-64 h-64 rounded-full bg-purple-500/15 blur-3xl"
              animate={{ scale: [1, 1.15, 1], x: [0, 20, 0], y: [0, -15, 0] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-indigo-600/10 blur-3xl"
              animate={{ scale: [1, 1.2, 1], x: [0, -25, 0], y: [0, 15, 0] }}
              transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="absolute top-1/2 left-1/3 w-48 h-48 rounded-full bg-fuchsia-500/10 blur-3xl"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>

          <div className="relative z-10 flex flex-col h-full">
            {/* ── messages area ── */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg} onSuggestion={send} />
                ))}
              </AnimatePresence>

              <AnimatePresence>{loading && <TypingDots />}</AnimatePresence>

              <div ref={bottomRef} />
            </div>

            {/* ── input bar ── */}
            <div className="p-3 md:p-4 border-t border-white/10 dark:border-white/5
                            bg-white/10 dark:bg-black/20 backdrop-blur-xl flex-shrink-0">
              <div
                className={`flex items-center gap-2 rounded-xl p-1.5 pl-4 transition-all duration-300
                           bg-white/15 dark:bg-white/5 backdrop-blur-md
                           border ${
                             input.trim()
                               ? 'border-[#6A3FF4]/50 shadow-lg shadow-purple-500/10'
                               : 'border-white/15 dark:border-white/10'
                           }`}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send(input)}
                  placeholder={t('chatbotPage.placeholder')}
                  disabled={loading}
                  className="flex-1 bg-transparent text-black dark:text-white
                             placeholder-gray-500 dark:placeholder-gray-500
                             focus:outline-none text-sm disabled:opacity-40"
                />
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => send(input)}
                  disabled={loading || !input.trim()}
                  className="bg-gradient-to-r from-[#6A3FF4] to-[#A855F7]
                             hover:from-[#5833CD] hover:to-[#9333EA]
                             text-white p-2.5 rounded-lg
                             shadow-lg shadow-purple-500/25
                             disabled:opacity-30 disabled:cursor-not-allowed
                             transition-all duration-200"
                >
                  <i className="ph-fill ph-paper-plane-right text-lg" />
                </motion.button>
              </div>

              <p className="text-center text-[10px] text-gray-500 dark:text-gray-600 mt-2">
                Powered by RAG + Mistral AI · Answers based on official FCDS regulations
              </p>
            </div>
          </div>
        </div>
      </AnimateOnView>
    </div>
  );
};

export default Chatbot;

