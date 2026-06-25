/**
 * Auth flow tests for AuthPage.
 *
 * The AuthPage component:
 *  - Renders a login form (email + password inputs, "Sign In" button)
 *  - On successful login, writes auth data to localStorage and calls onLogin(role)
 *  - On failed login, shows an error message in the DOM
 *  - Does NOT call useNavigate itself — navigation is delegated to the onLogin prop
 *
 * API response shape: { token: string, user: { role, email, firstName, lastName, id, odId } }
 */

// React is referenced inside the jest.mock('framer-motion') factory below.
// TS doesn't track usage inside jest.mock factories (they're hoisted), so the
// import looks unused to noUnusedLocals — the void below keeps the import live.
import React from 'react';
void React;
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthPage } from '../pages/AuthPage';
import { AppProvider } from '../context/AppContext';
import { BrandProvider } from '../context/BrandContext';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('@shared/config', () => ({
  API_URLS: {
    userProfile: () => 'http://localhost:4007',
  },
}));

// framer-motion animations are irrelevant to behavior; render children directly.
// Filter motion-specific props so they don't leak onto DOM elements as attributes.
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
        React.forwardRef(({ children, ...props }: any, ref: any) =>
          React.createElement(tag, { ...stripMotionProps(props), ref }, children)
        ),
    }
  );

  return {
    __esModule: true,
    motion,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    useAnimation: () => ({ start: jest.fn() }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAuthPage(onLogin = jest.fn()) {
  return render(
    <MemoryRouter>
      <AppProvider>
        <BrandProvider>
          <AuthPage onLogin={onLogin} />
        </BrandProvider>
      </AppProvider>
    </MemoryRouter>
  );
}

function makeSuccessResponse(role: string) {
  return {
    ok: true,
    json: async () => ({
      token: 'test-jwt',
      user: {
        role,
        email: `${role}@test.com`,
        firstName: 'Ali',
        lastName: 'Test',
        id: 'u1',
        odId: 'OD001',
      },
    }),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthPage — login form', () => {
  test('1. renders email input, password input, and Sign In button', () => {
    renderAuthPage();

    // The label text is uppercase via CSS but the DOM text is mixed-case
    expect(screen.getByPlaceholderText(/university\.edu/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('2. submitting with empty fields calls fetch but shows server error (no client validation short-circuit)', async () => {
    // The component has no client-side empty-field guard — it calls fetch.
    // We simulate the backend rejecting empty credentials.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Email and password are required' }),
    }) as jest.Mock;

    renderAuthPage();

    // Click submit without filling any fields
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      // AppProvider may fire mount-time fetches (settings/brand); assert the
      // login URL was hit at least once rather than total call count.
      const calls = (global.fetch as jest.Mock).mock.calls.map((c) => c[0]);
      expect(calls.some((url: string) => /\/api\/auth\/login/.test(url))).toBe(true);
      expect(
        screen.getByText(/email and password are required/i)
      ).toBeInTheDocument();
    });
  });

  test('3a. successful student login stores authToken in localStorage', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeSuccessResponse('student')) as jest.Mock;

    renderAuthPage();

    await userEvent.type(
      screen.getByPlaceholderText(/university\.edu/i),
      'student@test.com'
    );
    await userEvent.type(
      screen.getByPlaceholderText(/^password$/i),
      'secret123'
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(localStorage.getItem('authToken')).toBe('test-jwt');
    });
  });

  test('3b. successful student login stores currentUserRole in localStorage', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeSuccessResponse('student')) as jest.Mock;

    renderAuthPage();

    await userEvent.type(
      screen.getByPlaceholderText(/university\.edu/i),
      'student@test.com'
    );
    await userEvent.type(
      screen.getByPlaceholderText(/^password$/i),
      'secret123'
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(localStorage.getItem('currentUserRole')).toBe('student');
    });
  });

  test('4a. student login calls onLogin with role "student"', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeSuccessResponse('student')) as jest.Mock;

    const onLogin = jest.fn();
    renderAuthPage(onLogin);

    await userEvent.type(
      screen.getByPlaceholderText(/university\.edu/i),
      'student@test.com'
    );
    await userEvent.type(
      screen.getByPlaceholderText(/^password$/i),
      'secret123'
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('student');
    });
  });

  test('4b. professor login calls onLogin with role "professor"', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeSuccessResponse('professor')) as jest.Mock;

    const onLogin = jest.fn();
    renderAuthPage(onLogin);

    await userEvent.type(
      screen.getByPlaceholderText(/university\.edu/i),
      'prof@test.com'
    );
    await userEvent.type(
      screen.getByPlaceholderText(/^password$/i),
      'secret123'
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('professor');
    });
  });

  test('5. failed login (401) shows error message from server', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    }) as jest.Mock;

    renderAuthPage();

    await userEvent.type(
      screen.getByPlaceholderText(/university\.edu/i),
      'bad@test.com'
    );
    await userEvent.type(
      screen.getByPlaceholderText(/^password$/i),
      'wrongpass'
    );
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });
});
