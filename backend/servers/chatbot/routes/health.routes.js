/**
 * GET /api/health — liveness probe.
 *
 * Reports corpus load state, doc count, and whether MISTRAL_API_KEY is
 * configured (so the operator can tell at a glance whether the chatbot
 * will use the real LLM or fall back to raw passages).
 */
const express = require('express');
const { asyncHandler } = require('../../../lib/errors');
const mistral = require('../mistral');
const { getIndex, isCorpusLoaded } = require('../lib/corpus');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const index = getIndex();
    res.json({
      status: 'ok',
      corpus_loaded: isCorpusLoaded(),
      documents_count: index?.docs.length || 0,
      llm_available: !!process.env.MISTRAL_API_KEY,
      model: mistral.DEFAULT_MODEL,
    });
  })
);

module.exports = router;
