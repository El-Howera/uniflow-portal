/**
 * RegistrationContext tests.
 *
 * Covers:
 *  - fetchCourses: happy path (API returns courses) and network failure (fallback data)
 *  - registerForCourse: success and 409 conflict
 *  - dropCourse: success
 *
 * Mount sequence note:
 *   RegistrationProvider's useEffect calls fetchCourses() AND fetchRegistrations()
 *   concurrently.  fetchRegistrations short-circuits immediately (no fetch) when
 *   userId is empty (localStorage.currentUserEmail is not set), so only ONE fetch
 *   call hits the network on mount: fetchCourses.  Every test accounts for this.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { RegistrationProvider, useRegistration } from '../context/RegistrationContext';
import type { RegistrationContextType } from '../context/RegistrationContext';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('@shared/config', () => ({
  API_URLS: {
    registration: () => 'http://localhost:4002',
    userProfile: () => 'http://localhost:4007',
  },
}));

// framer-motion may be pulled in by transitive imports. Provide a no-op mock.
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

/**
 * Renders RegistrationProvider and exposes context via a stable plain-object ref.
 * React re-renders set `ctxRef.current` on every render pass, so callers always
 * read the latest context values.
 */
function renderWithContext(): { ctxRef: { current: RegistrationContextType | null } } {
  const ctxRef: { current: RegistrationContextType | null } = { current: null };

  const TestConsumer: React.FC = () => {
    const ctx = useRegistration();
    ctxRef.current = ctx;
    return null;
  };

  render(
    <RegistrationProvider>
      <TestConsumer />
    </RegistrationProvider>
  );

  return { ctxRef };
}

/** A minimal OK fetch response for GET /api/courses. */
function coursesOk(courses: object[] = []) {
  return {
    ok: true,
    json: async () => ({ courses }),
  };
}

/** A minimal OK fetch response for GET /api/registrations/:userId. */
function registrationsOk() {
  return {
    ok: true,
    json: async () => ({ registrations: [], totalCredits: 0 }),
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RegistrationContext — fetchCourses', () => {

  test('1. happy path — courses from API land in state and isApiConnected is true', async () => {
    const mockCourse = { code: 'CS101', title: 'Intro CS', credits: 3, department: 'CS', sections: [] };

    // Only fetchCourses fires on mount (no userId → fetchRegistrations short-circuits).
    global.fetch = jest.fn()
      .mockResolvedValueOnce(coursesOk([mockCourse]) as any)
      // Fallback for any extra call
      .mockResolvedValue(registrationsOk() as any);

    const { ctxRef } = renderWithContext();

    await waitFor(() => {
      expect(ctxRef.current!.isApiConnected).toBe(true);
    });

    expect(ctxRef.current!.courses).toHaveLength(1);
    expect(ctxRef.current!.courses[0].code).toBe('CS101');
    expect(ctxRef.current!.error).toBeNull();
  });

  test('2. network failure — error state is set, isApiConnected becomes false, fallback courses loaded', async () => {
    // fetchCourses rejects; isApiConnected initial value is false so we wait for
    // isLoading to settle (false after the catch block runs) instead.
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(registrationsOk() as any);

    const { ctxRef } = renderWithContext();

    // Wait until loading finishes — the catch block sets isLoading=false after
    // setting error and isApiConnected=false.
    await waitFor(() => {
      expect(ctxRef.current!.isLoading).toBe(false);
      // Also confirm the error was actually set (not just the initial idle state)
      expect(ctxRef.current!.error).not.toBeNull();
    });

    expect(ctxRef.current!.isApiConnected).toBe(false);
    // Fallback data always contains CS101
    const codes = ctxRef.current!.courses.map((c) => c.code);
    expect(codes).toContain('CS101');
  });

});

describe('RegistrationContext — registerForCourse', () => {

  test('3. success — registerForCourse returns { success: true }', async () => {
    // Mount: only fetchCourses fires (mock #1).
    // registerForCourse: POST → mock #2.
    // On success, fetchRegistrations is called → mock #3 (but short-circuits because userId='').
    // On success, fetchCourses is called → mock #3 (consumed here).
    global.fetch = jest.fn()
      // mount — fetchCourses
      .mockResolvedValueOnce(coursesOk() as any)
      // registerForCourse POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Registered' }),
      } as any)
      // post-success fetchCourses (fetchRegistrations short-circuits — no userId)
      .mockResolvedValueOnce(coursesOk() as any);

    const { ctxRef } = renderWithContext();

    // Wait for initial mount fetch to complete so the context functions are stable.
    await waitFor(() => expect(ctxRef.current!.isLoading).toBe(false));

    let result: { success: boolean } | undefined;

    await act(async () => {
      result = await ctxRef.current!.registerForCourse('CS101', 'sec1', null);
    });

    expect(result!.success).toBe(true);
  });

  test('4. conflict (409) — registerForCourse returns { success: false }', async () => {
    global.fetch = jest.fn()
      // mount — fetchCourses
      .mockResolvedValueOnce(coursesOk() as any)
      // registerForCourse POST → 409
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ success: false, message: 'Already registered for this section' }),
      } as any);

    const { ctxRef } = renderWithContext();

    await waitFor(() => expect(ctxRef.current!.isLoading).toBe(false));

    let result: { success: boolean } | undefined;

    await act(async () => {
      result = await ctxRef.current!.registerForCourse('CS101', 'sec1', null);
    });

    expect(result!.success).toBe(false);
  });

});

describe('RegistrationContext — dropCourse', () => {

  test('5. success — dropCourse returns { success: true }', async () => {
    global.fetch = jest.fn()
      // mount — fetchCourses
      .mockResolvedValueOnce(coursesOk() as any)
      // dropCourse POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Dropped' }),
      } as any)
      // post-success fetchCourses (fetchRegistrations short-circuits)
      .mockResolvedValueOnce(coursesOk() as any);

    const { ctxRef } = renderWithContext();

    await waitFor(() => expect(ctxRef.current!.isLoading).toBe(false));

    let result: { success: boolean } | undefined;

    await act(async () => {
      result = await ctxRef.current!.dropCourse('CS101');
    });

    expect(result!.success).toBe(true);
  });

});
