/**
 * ProtectedRoute and role-based routing tests.
 *
 * ProtectedRoute is defined inside App.tsx (not exported), so we test its
 * logic by reading AppContext directly: if `isAuthenticated` is false the
 * route redirects to /login; if true, children are rendered.
 *
 * AppContext sets `isAuthenticated = !!localStorage.getItem('currentUserRole')`
 * on initial mount — no re-read after that. Each test mounts a fresh provider.
 */

import React, { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from '../context/AppContext';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('@shared/config', () => ({
  API_URLS: {
    userProfile: () => 'http://localhost:4007',
    registration: () => 'http://localhost:4002',
    notification: () => 'http://localhost:4009',
  },
}));

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

// ── Local ProtectedRoute (mirrors App.tsx implementation exactly) ─────────────

/**
 * Re-implement ProtectedRoute locally so we can import AppProvider and
 * AppContext without pulling in the full App.tsx tree (which would try to
 * import every page component and its transitive deps including gsap, Aurora,
 * etc.).  The implementation is one line — identical to App.tsx line ~200.
 */
const ProtectedRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAppContext();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Render a MemoryRouter + AppProvider + ProtectedRoute setup.
 *
 * `initialPath` is where the test starts (default `/protected`).
 * The `/login` route renders a sentinel so we can confirm a redirect happened.
 */
function renderProtected(
  children: ReactNode = <div>secret</div>,
  initialPath = '/protected'
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppProvider>
        <Routes>
          <Route
            path="/protected"
            element={<ProtectedRoute>{children}</ProtectedRoute>}
          />
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </AppProvider>
    </MemoryRouter>
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProtectedRoute', () => {

  test('1. unauthenticated — redirects to /login and does not render children', () => {
    // localStorage is clear — no currentUserRole → isAuthenticated = false
    renderProtected();

    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  test('2. authenticated — renders children when currentUserRole is set', () => {
    localStorage.setItem('currentUserRole', 'student');

    renderProtected();

    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  test('3. unauthenticated fresh mount (no role) — redirects regardless of prior test', () => {
    // Explicit: start with no role (already cleared by beforeEach)
    // This guards against test-ordering assumptions.
    expect(localStorage.getItem('currentUserRole')).toBeNull();

    renderProtected(<div>protected content</div>);

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  test('4. each supported role passes through ProtectedRoute', () => {
    const roles = ['student', 'professor', 'ta', 'sa', 'admin'] as const;

    for (const role of roles) {
      localStorage.setItem('currentUserRole', role);

      const { unmount } = renderProtected(<div>{role}-dashboard</div>);

      expect(screen.getByText(`${role}-dashboard`)).toBeInTheDocument();
      expect(screen.queryByText('login page')).not.toBeInTheDocument();

      unmount();
      localStorage.clear();
    }
  });

});
