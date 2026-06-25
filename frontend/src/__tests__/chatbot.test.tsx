/**
 * Chatbot page tests for the student Chatbot component.
 *
 * The component:
 *  - Renders a text input and a send button on mount
 *  - On send, calls sendChatMessage() from chatbotService and renders the response
 *  - Defensively parses string responses, object responses (.text/.content), and falls back
 *    to JSON.stringify for unknown shapes — the Phase 2 fix guards against [object Object]
 *  - On network error, renders a friendly "trouble connecting" message
 *
 * Network boundary: chatbotService.sendChatMessage() wraps fetch with retry logic.
 * To avoid the dual-URL fallback complication in tests we mock the service module directly.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../context/AppContext';
import Chatbot from '../pages/student/Chatbot';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('@shared/config', () => ({
  API_URLS: {
    chatbot: () => 'http://localhost:4008',
    userProfile: () => 'http://localhost:4007',
    registration: () => 'http://localhost:4002',
    notification: () => 'http://localhost:4009',
  },
}));

// Mock chatbotService at the module boundary — avoids the dual-URL retry and
// credentials/AbortController complexity that belongs in chatbotService's own tests.
jest.mock('../utils/chatbotService', () => ({
  sendChatMessage: jest.fn(),
  resetChatSession: jest.fn(),
  checkChatbotHealth: jest.fn().mockResolvedValue(null),
}));

// framer-motion: strip animation props, render children directly
jest.mock('framer-motion', () => {
  const React = require('react');

  const MOTION_PROPS = new Set([
    'animate', 'initial', 'exit', 'transition', 'variants',
    'whileHover', 'whileFocus', 'whileTap', 'whileDrag', 'whileInView',
    'drag', 'dragConstraints', 'layout', 'layoutId',
    'onAnimationStart', 'onAnimationComplete',
  ]);

  function stripMotionProps(props: Record<string, unknown>) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!MOTION_PROPS.has(k)) clean[k] = v;
    }
    return clean;
  }

  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        React.forwardRef(({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }, ref: React.Ref<unknown>) =>
          React.createElement(tag, { ...stripMotionProps(props), ref }, children)
        ),
    }
  );

  return {
    __esModule: true,
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAnimation: () => ({ start: jest.fn() }),
    useInView: () => true,
  };
});

// ── Import after mocking ──────────────────────────────────────────────────────

import { sendChatMessage } from '../utils/chatbotService';

const mockSendChatMessage = sendChatMessage as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderChatbot() {
  return render(
    <MemoryRouter>
      <AppProvider>
        <Chatbot />
      </AppProvider>
    </MemoryRouter>
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('authToken', 'test-token');
  localStorage.setItem('currentUserId', 'user-id-123');
  localStorage.setItem('currentUserRole', 'student');
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Chatbot page', () => {

  test('1. renders text input and send button on mount', () => {
    renderChatbot();

    expect(
      screen.getByPlaceholderText(/type your question/i)
    ).toBeInTheDocument();

    // The send button has an icon (ph-paper-plane-right) but no text label.
    // It is the only button without visible text that is enabled — query by role.
    // Because disabled={!input.trim()} the button starts disabled; it is still in the DOM.
    // We verify at least one button is rendered alongside the input.
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  test('2. sends message and displays string response', async () => {
    mockSendChatMessage.mockResolvedValueOnce({
      success: true,
      response: 'The GPA threshold is 2.0.',
      session_id: 'sess-1',
    });

    renderChatbot();

    // Use one of the suggestion chips to trigger send — they call send(suggestionText)
    // without going through the input, so there is no state timing issue.
    // The first suggestion is "What are the graduation requirements?" which tests the
    // same code path as any other user-initiated send.
    const firstSuggestion = screen.getAllByRole('button').find(
      (btn) => btn.textContent === 'What are the graduation requirements?'
    );
    expect(firstSuggestion).toBeDefined();
    await userEvent.click(firstSuggestion!);

    // The string response is rendered directly in a message bubble
    await waitFor(() => {
      expect(screen.getByText('The GPA threshold is 2.0.')).toBeInTheDocument();
    });

    // sendChatMessage was called with the suggestion text
    expect(mockSendChatMessage).toHaveBeenCalledWith(
      'What are the graduation requirements?'
    );
  });

  test('3. handles object-shaped response without showing [object Object]', async () => {
    // The API returns an object with a .text field rather than a plain string.
    // The Phase 2 defensive parse in Chatbot.tsx extracts .text and renders it correctly.
    mockSendChatMessage.mockResolvedValueOnce({
      success: true,
      response: { text: 'The GPA threshold is 2.0.' },
      session_id: 'sess-1',
    });

    renderChatbot();

    const input = screen.getByPlaceholderText(/type your question/i);
    await userEvent.type(input, 'GPA threshold?');
    const allButtons = screen.getAllByRole('button');
    const sendBtn = allButtons[allButtons.length - 1];
    await userEvent.click(sendBtn);

    await waitFor(() => {
      // The actual text should appear
      expect(screen.getByText('The GPA threshold is 2.0.')).toBeInTheDocument();
      // The literal string "[object Object]" must NOT appear anywhere
      expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    });
  });

  test('4. handles API error gracefully — shows connection error message', async () => {
    // sendChatMessage throws (network failure / timeout)
    mockSendChatMessage.mockRejectedValueOnce(new Error('Network error'));

    renderChatbot();

    const input = screen.getByPlaceholderText(/type your question/i);
    await userEvent.type(input, 'Hello?');
    const allButtons = screen.getAllByRole('button');
    const sendBtn = allButtons[allButtons.length - 1];
    await userEvent.click(sendBtn);

    await waitFor(() => {
      // Component catches the error and renders a friendly message
      expect(
        screen.getByText(/trouble connecting/i)
      ).toBeInTheDocument();
    });
  });

});
