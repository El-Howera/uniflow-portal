/**
 * Main chat endpoints — both share the same shape:
 *
 *   POST /api/chat         — single-shot JSON response (the historical default)
 *   POST /api/chat/stream  — Server-Sent Events streaming variant (Plan 13 Phase 5)
 *
 * Both run the same pre-flight pipeline:
 *   1. Resolve / create sessionId, fetch history, detect language
 *   2. Chitchat short-circuit (greetings, thanks, farewells, "who are you")
 *      — canned reply, no Mistral call, no RAG retrieval
 *   3. RAG retrieval (topK=16) — pulls passages from the corpus
 *   4. OOS short-circuit — if passages.length === 0, refuse without LLM call
 *   5. Build LLM messages, call Mistral, fall back to raw passages on failure
 *   6. Citation enforcement (Plan 13 Phase 7) — append a footer if the LLM
 *      forgot the inline [N] marker and we didn't already fall back to raw
 *      passages (which have their own labels) and the answer isn't a refusal
 *   7. Trim + save session, write through to DB (fire-and-forget)
 *
 * The streaming variant differs only in output: SSE deltas as tokens
 * arrive, a final `event: meta` carrying the citations, and a
 * terminating `event: done`. The DB persist step is identical and lives
 * in a shared helper.
 *
 * chatLimiter (30 req/min per userId by default, env-tunable via
 * CHATBOT_RATE_LIMIT_MAX) is applied to both endpoints.
 */
const express = require('express');
const { randomUUID } = require('crypto');

const prisma = require('../../../lib/prisma');
const { asyncHandler } = require('../../../lib/errors');
const { requireAuth } = require('../../../lib/auth');
const { buildLimiter } = require('../../../lib/rate-limit');

const mistral = require('../mistral');
const rag = require('../rag');
const { matchChitchat } = require('../chitchat');

const { getIndex, isCorpusLoaded } = require('../lib/corpus');
const { getUserContext } = require('../lib/user-context');
const {
  getSession,
  saveSession,
  trimHistory,
  clearSession,
  clearAllSessions,
} = require('../lib/session-store');
const {
  hasInlineCitation,
  isRefusalAnswer,
  appendCitationFooter,
  stripFakeUrls,
} = require('../lib/citation');

const router = express.Router();

// Rate limiter — keyed on userId when authenticated, falls back to IP for
// unauthenticated probes (which shouldn't happen on /api/chat because
// requireAuth runs first, but defence-in-depth). Uses Redis when available
// (shared across processes) — see backend/lib/rate-limit.js.
const CHAT_RATE_MAX = Number(process.env.CHATBOT_RATE_LIMIT_MAX) || 30;
const chatLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: CHAT_RATE_MAX,
  keyPrefix: 'chatbot:user',
  message: { error: 'Too many chat requests, please slow down.' },
  keyGenerator: (req) => req.user?.userId || req.ip,
});

// Canonical OOS refusal text — used by both endpoints when the BM25 search
// returns nothing. Skips the LLM round-trip and gives the user the exact
// "rephrase or ask something else" hint regardless of the streaming mode.
function oosRefusal(lang) {
  return lang === 'ar'
    ? 'أنا مساعد مخصص للإجابة عن أسئلة لائحة كلية الحاسبات وعلوم البيانات (FCDS) فقط. ' +
        'لم أتمكن من العثور على هذا الموضوع في اللائحة — هل يمكنك إعادة الصياغة أو طرح سؤال آخر يتعلق باللائحة؟'
    : "I'm designed to answer questions from the FCDS regulations. " +
        "I couldn't find this topic in them — could you rephrase or ask " +
        'something else from the regulations?';
}

/**
 * Push the latest Q&A pair into the session, trim to MAX_HISTORY_TURNS,
 * and persist. Both endpoints call this identically — extracted so a
 * future change to the persistence path only touches one site.
 */
async function recordTurn(sessionId, session, question, answer) {
  session.history.push({ question, answer });
  trimHistory(session);
  await saveSession(sessionId, session);
}

/**
 * Fire-and-forget DB write-through. Same shape used by both endpoints.
 * Failures are logged but never bubble up — the DB persist is a "nice
 * to have" record, not a hot-path dependency.
 */
function persistToDb(userId, sessionId, message, answer, lang, citations, source) {
  if (!userId) return;
  setImmediate(async () => {
    try {
      let conv = await prisma.chatbotConversation.findFirst({
        where: { sessionId },
      });
      if (!conv) {
        conv = await prisma.chatbotConversation.create({
          data: { userId, sessionId },
        });
      }
      await prisma.chatbotMessage.createMany({
        data: [
          { conversationId: conv.id, role: 'user', content: message, language: lang, citations: [] },
          { conversationId: conv.id, role: 'assistant', content: answer, language: lang, citations },
        ],
      });
    } catch (err) {
      console.warn(`[chatbot] ${source} DB persist error:`, err.message);
    }
  });
}

// ============================================================================
// POST /api/chat/clear-cache — session-management endpoint
// ============================================================================
//
// Body: `{ session_id }` clears one session; empty body clears all. Clears
// both the Redis-backed cache AND the in-memory Map. Used by the chatbot
// test harness between fixtures so a previous Q&A pair doesn't leak into
// the next test's history.
router.post(
  '/clear-cache',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { session_id } = req.body || {};
    if (session_id) await clearSession(session_id);
    else await clearAllSessions();
    res.json({ success: true });
  })
);

// ============================================================================
// POST /api/chat — single-shot JSON response
// ============================================================================
router.post(
  '/',
  chatLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isCorpusLoaded()) return res.status(503).json({ error: 'corpus not loaded' });
    const message = (req.body.message || req.body.question || '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });

    const sessionId = req.body.session_id || randomUUID();
    const session = await getSession(sessionId);
    const lang = rag.detectLanguage(message);

    // Fetch a personalised snapshot of the student (name, courses, GPA,
    // attendance, balance, …). Cached in memory for 10 min so it adds
    // ~0ms to most turns. Returns null for non-students or when the
    // backend can't reach the DB — buildMessages tolerates either.
    let userContext = null;
    try { userContext = await getUserContext(req.user); }
    catch (err) { console.warn('[chatbot] user-context failed:', err.message); }

    // Chitchat short-circuit: greetings, thanks, farewells, "who are you"
    // don't need RAG retrieval — the corpus has no rules about saying hello,
    // and running them through Mistral would either burn tokens on a generic
    // reply or trigger a "not enough information" refusal. Canned reply in
    // the right language, persisted to history so multi-turn context still
    // flows. We swap in the user's first name so the greeting feels personal
    // ("Hi Elfares!" instead of a generic "Hi!").
    const chit = matchChitchat(message, lang);
    if (chit) {
      const firstName = (req.user && req.user.firstName) || '';
      let personalised = chit.reply;
      if (firstName) {
        // Inject before the first sentence-ending punctuation. EN form:
        // "Hi! How can I help…" → "Hi Elfares! How can I help…".
        if (lang === 'ar') {
          personalised = personalised.replace(/^(\S+)/, `$1 يا ${firstName}`);
        } else {
          personalised = personalised.replace(/^([A-Za-z]+)([!,. ])/, `$1 ${firstName}$2`);
        }
      }
      await recordTurn(sessionId, session, message, personalised);
      return res.json({
        success: true,
        response: personalised,
        language: lang,
        session_id: sessionId,
        citations: [],
        fallback: false,
        chitchat: chit.kind,
      });
    }

    // topK=16 so a query like "all data science semester courses" has room
    // to include all 8 semester docs + 2 summer docs + the program overview
    // without dropping any. Was 10 — too tight for multi-semester listings.
    const passages = getIndex().search(message, { topK: 16, lang });

    // Out-of-scope short-circuit: if BM25 + n-gram + cross-language all fail
    // to surface anything, the question is GENUINELY outside the FCDS
    // regulations — skip the LLM call and refuse. BUT: when the user has a
    // student-context snapshot attached, the question might be personal
    // (e.g. "what's my GPA?", "did I pay my fees?") which the LLM can
    // legitimately answer from the STUDENT CONTEXT block. We let those
    // through to the LLM with empty regulation context so the model still
    // anchors on real data + can pull from the snapshot.
    if (passages.length === 0 && !userContext) {
      const refusal = oosRefusal(lang);
      await recordTurn(sessionId, session, message, refusal);
      return res.json({
        success: true,
        response: refusal,
        language: lang,
        session_id: sessionId,
        citations: [],
        fallback: false,
        outOfScope: true,
      });
    }

    const messages = rag.buildMessages({
      question: message,
      passages,
      history: session.history,
      lang,
      userContext,
    });

    let answer;
    let usedFallback = false;
    try {
      answer = await mistral.chat(messages, { temperature: 0.3 });
    } catch (err) {
      console.warn('[chatbot] mistral failed, falling back:', err.message);
      answer = rag.fallbackAnswer(passages, lang);
      usedFallback = true;
    }

    // Plan 13 Phase 7 — citation enforcement. Real RAG answers must reference
    // their sources. If the LLM forgot to inline a `[N]` marker (and we
    // didn't fall back to raw passages which already have inline labels),
    // append a soft footer pointing at the top retrieval passage.
    if (!usedFallback && !hasInlineCitation(answer) && !isRefusalAnswer(answer)) {
      answer = appendCitationFooter(answer, passages, lang);
    }

    // Strip hallucinated markdown URLs (e.g. "[Article 22(b)](https://example.com)").
    // The model invents URLs because nothing in the corpus has them. Keep the
    // visible text, drop the bogus link.
    answer = stripFakeUrls(answer);

    await recordTurn(sessionId, session, message, answer);

    const citations = rag.buildCitations(passages);
    persistToDb(req.user?.userId, sessionId, message, answer, lang, citations, 'chat');

    res.json({
      success: true,
      response: answer,
      language: lang,
      session_id: sessionId,
      citations,
      fallback: usedFallback,
    });
  })
);

// ============================================================================
// POST /api/chat/stream — SSE streaming variant
// ============================================================================
//
// Identical pre-flight (chitchat / OOS / RAG retrieval / citation enforcement)
// but pipes Mistral's token-by-token output to the client as Server-Sent
// Events. The citation payload arrives as a final `event: meta` once
// streaming completes so the frontend can render the [N] index map.
router.post(
  '/stream',
  chatLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isCorpusLoaded()) return res.status(503).json({ error: 'corpus not loaded' });
    const message = (req.body.message || req.body.question || '').trim();
    if (!message) return res.status(400).json({ error: 'message required' });

    const sessionId = req.body.session_id || randomUUID();
    const session = await getSession(sessionId);
    const lang = rag.detectLanguage(message);

    // Same user-context fetch as /api/chat. Cached, so this is cheap.
    let userContext = null;
    try { userContext = await getUserContext(req.user); }
    catch (err) { console.warn('[chatbot] user-context failed:', err.message); }

    // SSE headers — flush right away so the client knows we're streaming.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx hint to disable buffering
    res.flushHeaders?.();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const sendDelta = (text) => sendEvent('delta', { text });

    // Chitchat short-circuit — single-shot, no streaming needed. Splice in
    // the user's first name for a warm greeting.
    const chit = matchChitchat(message, lang);
    if (chit) {
      const firstName = (req.user && req.user.firstName) || '';
      let personalised = chit.reply;
      if (firstName) {
        if (lang === 'ar') {
          personalised = personalised.replace(/^(\S+)/, `$1 يا ${firstName}`);
        } else {
          personalised = personalised.replace(/^([A-Za-z]+)([!,. ])/, `$1 ${firstName}$2`);
        }
      }
      await recordTurn(sessionId, session, message, personalised);
      sendDelta(personalised);
      sendEvent('meta', {
        sessionId,
        language: lang,
        citations: [],
        chitchat: chit.kind,
        fallback: false,
      });
      sendEvent('done', { ok: true });
      res.end();
      return;
    }

    const passages = getIndex().search(message, { topK: 16, lang });

    // OOS short-circuit — corpus has nothing on this topic AND we have no
    // student context to answer personal questions from. When userContext
    // is present we let the LLM try (might answer from the snapshot).
    if (passages.length === 0 && !userContext) {
      const refusal = oosRefusal(lang);
      await recordTurn(sessionId, session, message, refusal);
      sendDelta(refusal);
      sendEvent('meta', {
        sessionId,
        language: lang,
        citations: [],
        outOfScope: true,
        fallback: false,
      });
      sendEvent('done', { ok: true });
      res.end();
      return;
    }

    const messages = rag.buildMessages({
      question: message,
      passages,
      history: session.history,
      lang,
      userContext,
    });
    const citations = rag.buildCitations(passages);

    // Try to stream from Mistral. On failure, fall back to a single-shot
    // raw-passage refusal (matches /api/chat behaviour).
    let answer = '';
    let usedFallback = false;
    try {
      const mistralRes = await mistral.chatStream(messages, { temperature: 0.3 });
      const reader = mistralRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const event = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          for (const rawLine of event.split('\n')) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') break;
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                answer += delta;
                sendDelta(delta);
              }
            } catch {
              /* ignore malformed SSE line */
            }
          }
        }
      }
    } catch (err) {
      console.warn('[chatbot] stream mistral failed, falling back:', err.message);
      answer = rag.fallbackAnswer(passages, lang);
      usedFallback = true;
      sendDelta(answer);
    }

    // Plan 13 Phase 7 — citation enforcement on the streamed answer too.
    // The LLM might forget the `[N]` marker; append a footer pointing at the
    // top passage so the user always has a verifiable source.
    if (!usedFallback && !hasInlineCitation(answer) && !isRefusalAnswer(answer)) {
      const footer = appendCitationFooter('', passages, lang);
      if (footer) {
        sendDelta(footer);
        answer += footer;
      }
    }

    await recordTurn(sessionId, session, message, answer);

    sendEvent('meta', {
      sessionId,
      language: lang,
      citations,
      fallback: usedFallback,
    });
    sendEvent('done', { ok: true });
    res.end();

    // Fire-and-forget DB persist (same as /api/chat).
    persistToDb(req.user?.userId, sessionId, message, answer, lang, citations, 'stream');
  })
);

module.exports = router;
