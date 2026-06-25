/**
 * UniFlow Chatbot — Mistral + BM25 RAG over FCDS regulations.
 * Port: 4008
 *
 * Endpoints:
 *   GET  /api/health                      — liveness + corpus state
 *   POST /api/retrieve                    — debug: corpus search only
 *   POST /api/chat                        — JSON answer (single-shot)
 *   POST /api/chat/stream                 — SSE streaming answer
 *   POST /api/chat/clear-cache            — drop session(s)
 *   GET  /api/chatbot/sessions/:userId    — recent conversation history
 *
 * Bootstrap-only. Route handlers live in routes/*.routes.js. Shared
 * helpers in lib/citation.js (citation footer enforcement), lib/corpus.js
 * (the BM25 index singleton), lib/session-store.js (Redis + in-memory
 * session cache). RAG / Mistral / chitchat / synonym modules sit at the
 * service root (already proper libs from earlier work).
 *
 * Plan 11 phase 2 — second service modularised after the notification
 * pilot. Pattern: index.js bootstraps the corpus then mounts routers;
 * routes import the corpus + session store directly from their sibling
 * lib modules (no factory wrapper).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env'), quiet: true });

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const prisma = require('../../lib/prisma');
const corsMiddleware = require('../../lib/cors');
const { securityHeaders } = require('../../lib/security');
const { errorHandler } = require('../../lib/errors');
const { tenantResolver } = require('../../lib/tenant-resolver');
const { isRedisEnabled } = require('../../lib/redis');

const mistral = require('./mistral');
const rag = require('./rag');
const { setIndex } = require('./lib/corpus');
const { startEvictionInterval } = require('./lib/session-store');

const healthRoutes = require('./routes/health.routes');
const retrieveRoutes = require('./routes/retrieve.routes');
const chatRoutes = require('./routes/chat.routes');
const sessionsRoutes = require('./routes/sessions.routes');

const PORT = Number(process.env.CHATBOT_PORT) || 4008;
const CORPUS_DIR = path.join(__dirname, '../../corpus');

const app = express();
app.use(securityHeaders());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(tenantResolver({ strict: false }));

// Start the in-memory session eviction sweep. Redis enforces its own TTL via
// EX, so this is only relevant when no REDIS_URL is configured. The interval
// is .unref()'d inside session-store so it never blocks process exit.
startEvictionInterval();

// Mount routers — one prefix per router so the URL → file mapping is
// readable at a glance.
app.use('/api/health', healthRoutes);
app.use('/api/retrieve', retrieveRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chatbot/sessions', sessionsRoutes);

app.use(errorHandler);

// Plan 21 Phase 2 — gate listen so supertest can require() in-process.
// In test mode (NODE_ENV=test) we still build the RAG index so endpoints work,
// but we don't bind the port; tests can use supertest(app) directly.
if (require.main === module) {
  (async () => {
    try {
      const index = await rag.buildIndex(CORPUS_DIR);
      setIndex(index);
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`[chatbot] ready on :${PORT} (model=${mistral.DEFAULT_MODEL}, docs=${index.docs.length})`);
        console.log('[chatbot] session store: ' + (isRedisEnabled() ? 'Redis (shared)' : 'in-memory (per-process)'));
        if (!process.env.MISTRAL_API_KEY) {
          console.warn('[chatbot] MISTRAL_API_KEY not set - answers will use fallback mode');
        }
      });
    } catch (err) {
      console.error('[chatbot] startup failed:', err);
      process.exit(1);
    }
  })();

  process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
  process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });
}

// When required by supertest, the caller must `await ensureChatbotReady()`
// before hitting /api/chat — the BM25 index loads asynchronously and the
// /api/health endpoint returns 503 until it's ready.
async function ensureChatbotReady() {
  const index = await rag.buildIndex(CORPUS_DIR);
  setIndex(index);
  return { docsCount: index.docs.length };
}

module.exports = { app, prisma, ensureChatbotReady };
