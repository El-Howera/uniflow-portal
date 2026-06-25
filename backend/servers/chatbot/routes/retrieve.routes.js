/**
 * POST /api/retrieve — debug-only corpus search.
 *
 * Returns the top-K passages BM25 ranks for a query, without calling
 * Mistral. Useful for retrieval-quality regression testing (the chatbot
 * test harness in backend/tests/chatbot/ uses this to verify the corpus
 * surfaces the expected passages for each fixture before checking the
 * LLM's behaviour on them).
 *
 * Auth required so the endpoint can't be used to scrape the corpus by
 * an unauthenticated caller — the fixtures and the live data are not
 * sensitive, but the rate-limit footprint should not be open.
 */
const express = require('express');
const { asyncHandler } = require('../../../lib/errors');
const { requireAuth } = require('../../../lib/auth');
const rag = require('../rag');
const { getIndex, isCorpusLoaded } = require('../lib/corpus');

const router = express.Router();

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!isCorpusLoaded()) {
      return res.status(503).json({ error: 'corpus not loaded' });
    }
    const query = req.body.query || req.body.message || '';
    const topK = Number(req.body.top_k) || 10;
    if (!query) return res.status(400).json({ error: 'query required' });

    const lang = rag.detectLanguage(query);
    const results = getIndex().search(query, { topK, lang });
    res.json({ success: true, results });
  })
);

module.exports = router;
