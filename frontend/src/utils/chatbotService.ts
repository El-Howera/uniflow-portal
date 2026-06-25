/**
 * UniFlow AI Chatbot Service
 * Connects frontend to the Mistral RAG chatbot API (port 4008).
 *
 * URL resolution: defers to the central API_URLS resolver in shared/config.ts
 * so the chatbot lives on the same single-origin scheme as everything else
 * (path prefix `/chatbot/` behind nginx in production, direct port in dev).
 * The legacy Python Flask service on :5000 is gone — no fallback URL.
 */

import { API_URLS } from '@shared/config';

const getApiBaseUrl = () => {
  // Build-time override (used by mobile builds pointing at a tunnel host).
  if (process.env.REACT_APP_CHATBOT_URL) {
    return process.env.REACT_APP_CHATBOT_URL.replace(/\/$/, '');
  }
  // Centralised resolver — picks the right base for browser, Capacitor, and
  // single-origin docker/Fly modes. Endpoints below all assume `/api/...`
  // suffix, so we append `/api` to whatever the resolver returns.
  return `${API_URLS.chatbot()}/api`;
};

export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  language?: 'ar' | 'en';
}

export interface ChatResponse {
  success: boolean;
  response?: string;
  language?: 'ar' | 'en';
  query?: string;
  error?: string;
  enhanced?: boolean;
  fallback?: boolean;
  citations?: Array<any>;
  session_id?: string;
}

export interface ChatbotHealth {
  status: string;
  chatbot: string;
  corpus_loaded: boolean;
  documents_count: number;
  llm_available?: boolean;
  model?: string;
}

// ── Session ID management ──────────────────────────────
let _sessionId: string | null = null;

const getSessionId = (): string => {
  if (!_sessionId) {
    // Try to restore from sessionStorage (survives tab refresh, not new tabs)
    _sessionId = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('chatbot_session_id')) || null;
    if (!_sessionId) {
      _sessionId = crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('chatbot_session_id', _sessionId);
      }
    }
  }
  return _sessionId;
};

/** Reset the session (starts a fresh conversation). */
export const resetChatSession = () => {
  _sessionId = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('chatbot_session_id');
  }
};

/**
 * Pull the human-readable response text out of whatever the chatbot endpoint
 * returns. Handles three shapes:
 *   - `response` is a string                     → use as-is
 *   - `response` is an object with `.text/.content` (Mistral SDK quirks)
 *   - everything else                            → return null (caller surfaces
 *                                                   a friendly error instead of
 *                                                   "[object Object]")
 *
 * Critically: we never `String(value)` a non-string here. That's what produced
 * the "[object Object]" the user kept seeing.
 */
function extractResponseText(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
  }
  return null;
}

/**
 * Send a message to the AI chatbot
 */
export const sendChatMessage = async (message: string): Promise<ChatResponse> => {
  // Single endpoint — the legacy Flask service on :5000 is gone. The fallback
  // attempt was producing mixed-content blocks on Fly (http://host:5000 on an
  // https page) and serving no purpose since the URL never resolved anywhere.
  const primaryUrl = `${getApiBaseUrl()}/chat`;

  const doPost = async (url: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150000); // 2.5 min timeout
    try {
      const authToken =
        typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null;
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ message, session_id: getSessionId() }),
        signal: controller.signal,
      });
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Normalise either a primary or a legacy response into our ChatResponse shape.
  const normalise = (data: unknown): ChatResponse => {
    if (!data || typeof data !== 'object') {
      return { success: false, error: 'Invalid response from chatbot' };
    }
    const obj = data as Record<string, unknown>;
    if (typeof obj.session_id === 'string') {
      _sessionId = obj.session_id;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('chatbot_session_id', obj.session_id);
      }
    }
    const text = extractResponseText(obj.response);
    if (text === null) {
      // Surface the API's own error message if there is one; otherwise a
      // friendly fallback. Never coerce an object via String(...).
      const errMsg =
        typeof obj.error === 'string'
          ? obj.error
          : 'The chatbot returned an unexpected response shape.';
      return { success: false, error: errMsg };
    }
    return {
      success: typeof obj.success === 'boolean' ? obj.success : true,
      response: text,
      language: (obj.language as 'en' | 'ar' | undefined) ?? undefined,
      query: (obj.query as string | undefined) ?? undefined,
      enhanced: (obj.enhanced as boolean | undefined) ?? undefined,
      fallback: (obj.fallback as boolean | undefined) ?? undefined,
      citations: (obj.citations as Array<unknown> | undefined) ?? undefined,
      session_id: (obj.session_id as string | undefined) ?? undefined,
    };
  };

  try {
    const data = await doPost(primaryUrl);
    return normalise(data);
  } catch (err) {
    console.error('Chatbot API error:', err);
    return {
      success: false,
      error: 'Failed to reach the chatbot server. Try again in a moment.',
    };
  }
};

/**
 * Stream a chatbot response token-by-token via SSE.
 *
 * Yields delta strings as they arrive. After the last delta, yields a
 * final `{__meta: {...}}` sentinel containing session_id, citations,
 * fallback flag, etc. so the caller can render the citation footer.
 *
 * Plan 13 Phase 5.
 */
export interface ChatStreamMeta {
  sessionId?: string;
  language?: 'en' | 'ar';
  citations?: Array<unknown>;
  fallback?: boolean;
  chitchat?: string | null;
  outOfScope?: boolean;
}

export async function* streamChatMessage(
  message: string
): AsyncGenerator<string | { __meta: ChatStreamMeta }, void, void> {
  const url = `${getApiBaseUrl()}/chat/stream`;
  const authToken =
    typeof localStorage !== 'undefined' ? localStorage.getItem('authToken') : null;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ message, session_id: getSessionId() }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Stream failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Split on SSE event boundaries (blank line). Each event is a sequence of
    // `key: value` lines including `event:` and `data:`.
    let boundary;
    while ((boundary = buf.indexOf('\n\n')) !== -1) {
      const evtRaw = buf.slice(0, boundary);
      buf = buf.slice(boundary + 2);
      let evtName = 'message';
      let dataLine = '';
      for (const line of evtRaw.split('\n')) {
        if (line.startsWith('event:')) evtName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      if (!dataLine) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (evtName === 'delta' && parsed && typeof parsed === 'object') {
        const txt = (parsed as { text?: string }).text;
        if (typeof txt === 'string') yield txt;
      } else if (evtName === 'meta' && parsed && typeof parsed === 'object') {
        const meta = parsed as ChatStreamMeta;
        if (meta.sessionId) {
          _sessionId = meta.sessionId;
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('chatbot_session_id', meta.sessionId);
          }
        }
        yield { __meta: meta };
      } else if (evtName === 'done') {
        return;
      }
    }
  }
}

/**
 * Check if the chatbot server is healthy
 */
export const checkChatbotHealth = async (): Promise<ChatbotHealth | null> => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/health`, {
      method: 'GET',
      credentials: 'include',
    });

    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error('Chatbot health check failed:', error);
    return null;
  }
};

/**
 * Clear the chatbot's response cache
 */
export const clearChatbotCache = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/chat/clear-cache`, {
      method: 'POST',
      credentials: 'include',
    });
    return response.ok;
  } catch (error) {
    console.error('Failed to clear chatbot cache:', error);
    return false;
  }
};

/**
 * Generate a unique message ID
 */
export const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Create a user message object
 */
export const createUserMessage = (content: string): ChatMessage => ({
  id: generateMessageId(),
  content,
  role: 'user',
  timestamp: new Date(),
});

/**
 * Create an assistant message object
 */
export const createAssistantMessage = (content: string, language?: 'ar' | 'en'): ChatMessage => ({
  id: generateMessageId(),
  content,
  role: 'assistant',
  timestamp: new Date(),
  language,
});
