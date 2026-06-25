/**
 * Thin wrapper around the Mistral REST API.
 * Uses native fetch (Node 18+). No SDK dependency required.
 *
 * Env:
 *   MISTRAL_API_KEY     (required)
 *   MISTRAL_MODEL       (default: mistral-small-latest)
 *   MISTRAL_BASE_URL    (default: https://api.mistral.ai/v1)
 */

const BASE_URL = process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
// Default upgraded from mistral-small-latest → mistral-medium-latest for
// better synthesis of multi-clause regulation answers. Override via the
// MISTRAL_MODEL env var without touching code.
const DEFAULT_MODEL = process.env.MISTRAL_MODEL || 'mistral-medium-latest';
const TIMEOUT_MS = 180_000;

function getApiKey() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('MISTRAL_API_KEY is not set in environment');
  return key;
}

async function fetchWithTimeout(url, opts, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the Mistral chat completion endpoint with retry + backoff.
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [options]
 * @returns {Promise<string>} the assistant message content
 */
async function chat(messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.0,
    maxTokens = 2048,
    maxRetries = 2,
  } = options;

  const body = {
    model,
    messages,
    temperature,
    top_p: temperature === 0.0 ? 1.0 : 0.9,
    max_tokens: maxTokens,
  };

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const wait = 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, wait));
        lastErr = new Error('rate limited');
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Mistral API ${res.status}: ${text}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content || content.trim().length === 0) {
        throw new Error('empty response from Mistral');
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const wait = 2 ** attempt * 500;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr || new Error('Mistral chat failed');
}

/**
 * Streaming chat completion. Returns the underlying Response so the caller
 * can pipe / read the SSE stream directly.
 *
 * Mistral SSE format: each event is `data: {...}\n\n`, terminated by
 * `data: [DONE]\n\n`. The caller is responsible for parsing the delta tokens
 * out of each chunk.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [options]
 * @returns {Promise<Response>}
 */
async function chatStream(messages, options = {}) {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.3,
    maxTokens = 2048,
  } = options;

  const body = {
    model,
    messages,
    temperature,
    top_p: temperature === 0.0 ? 1.0 : 0.9,
    max_tokens: maxTokens,
    stream: true,
  };

  const res = await fetchWithTimeout(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral stream ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

/**
 * Liveness probe: tries to call the API with a trivial prompt.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  if (!process.env.MISTRAL_API_KEY) return false;
  try {
    await chat([{ role: 'user', content: 'ok' }], { maxTokens: 4, maxRetries: 0 });
    return true;
  } catch {
    return false;
  }
}

module.exports = { chat, chatStream, isAvailable, DEFAULT_MODEL };
