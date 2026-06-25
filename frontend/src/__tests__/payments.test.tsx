/**
 * Payments page tests for the student Payments component.
 *
 * The component:
 *  - Calls getPaymentDashboard (GET /api/payments/dashboard/:odId) on mount
 *  - Calls getInvoices (GET /api/payments/invoices/:odId) on mount
 *  - Renders InvoiceCard entries for each invoice returned
 *  - Guards against null/missing invoices (Phase 3 crash fix)
 *  - Opens a PaymentModal on "Pay Now" click, which calls makePayment (POST /api/payments/pay)
 *
 * Network boundary: apiFetch in utils/api.ts wraps every call with credentials:'include'
 * and auth headers. All tests mock global.fetch at that boundary.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppProvider } from '../context/AppContext';
import StudentPayments from '../pages/student/Payments';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('@shared/config', () => ({
  API_URLS: {
    payments: () => 'http://localhost:4004',
    userProfile: () => 'http://localhost:4007',
    registration: () => 'http://localhost:4002',
    notification: () => 'http://localhost:4009',
  },
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

// jsPDF and jspdf-autotable are irrelevant to behavior tests
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    setFillColor: jest.fn(),
    rect: jest.fn(),
    setTextColor: jest.fn(),
    setFontSize: jest.fn(),
    setFont: jest.fn(),
    text: jest.fn(),
    setDrawColor: jest.fn(),
    line: jest.fn(),
    setLineDashPattern: jest.fn(),
    addPage: jest.fn(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    save: jest.fn(),
  }));
});

jest.mock('jspdf-autotable', () => jest.fn());

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Minimal dashboard response (summary fields required by AccountSummaryCard).
 */
function makeDashboardResponse() {
  return {
    ok: true,
    json: async () => ({
      account: { odID: 'OD-12345', name: 'Test Student', email: 'test@test.com', balance: 0, totalPaid: 0, financialAidApplied: 0, paymentPlan: 'none', studentId: 'S001' },
      summary: { totalBilled: 1000, totalPaid: 500, totalAid: 0, outstandingBalance: 500, overdueAmount: 0, invoiceCount: 1, paidInvoices: 0, pendingInvoices: 1, overdueInvoices: 0 },
      recentTransactions: [],
      upcomingInvoices: [],
      monthlyActivity: [],
      alerts: { hasOverdue: false, overdueAmount: 0, paymentDueSoon: false },
    }),
  };
}

/**
 * Minimal invoices response — one invoice with a non-zero balance so the "Pay Now" button appears.
 */
function makeInvoicesResponse(invoices: object[] = []) {
  return {
    ok: true,
    json: async () => ({ invoices, total: invoices.length, totalAmount: 1000, totalBalance: 500 }),
  };
}

const SAMPLE_INVOICE = {
  id: 'inv1',
  odID: 'OD-12345',
  title: 'Tuition Fee',
  description: 'Spring 2026 tuition',
  category: 'tuition' as const,
  amount: 1000,
  paid: 0,
  balance: 1000,
  status: 'pending' as const,
  dueDate: '2099-05-01', // far future so it's not overdue
  paidDate: null,
  semester: 'Spring 2026',
  createdAt: new Date().toISOString(),
};

function renderPayments() {
  return render(
    <MemoryRouter>
      <AppProvider>
        <StudentPayments />
      </AppProvider>
    </MemoryRouter>
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('authToken', 'test-token');
  localStorage.setItem('currentUserOdId', 'OD-12345');
  localStorage.setItem('currentUserId', 'user-id-123');
  localStorage.setItem('currentUserRole', 'student');
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StudentPayments page', () => {

  test('1. renders without crashing when API returns empty invoices', async () => {
    global.fetch = jest.fn()
      // dashboard fetch
      .mockResolvedValueOnce(makeDashboardResponse() as any)
      // invoices fetch (empty)
      .mockResolvedValueOnce(makeInvoicesResponse([]) as any)
      // any subsequent fetch (e.g. retry / refresh token attempt)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    renderPayments();

    // Component renders the page heading — wait for loading to settle
    await waitFor(() => {
      expect(screen.getByText(/my financials/i)).toBeInTheDocument();
    });
  });

  test('2. shows invoice title when API returns invoices', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(makeDashboardResponse() as any)
      .mockResolvedValueOnce(makeInvoicesResponse([SAMPLE_INVOICE]) as any)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    renderPayments();

    // Wait for the invoice title to appear
    await waitFor(() => {
      expect(screen.getByText('Tuition Fee')).toBeInTheDocument();
    });
  });

  test('3. handles null/missing invoices gracefully (no crash)', async () => {
    // No "invoices" key in the response — verifies the Array.isArray guard fix
    global.fetch = jest.fn()
      .mockResolvedValueOnce(makeDashboardResponse() as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account: { balance: 0 } }), // no invoices key
      } as any)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    // Should not throw
    renderPayments();

    await waitFor(() => {
      expect(screen.getByText(/my financials/i)).toBeInTheDocument();
    });
    // Zero invoice cards rendered — no crash
    expect(screen.queryByText('Pay Now')).not.toBeInTheDocument();
  });

  test('4. clicking Pay Now opens modal and confirm triggers a POST fetch', async () => {
    global.fetch = jest.fn()
      // dashboard fetch
      .mockResolvedValueOnce(makeDashboardResponse() as any)
      // invoices fetch (one payable invoice)
      .mockResolvedValueOnce(makeInvoicesResponse([SAMPLE_INVOICE]) as any)
      // makePayment POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: 'Payment processed' }),
      } as any)
      // post-success re-fetch (dashboard)
      .mockResolvedValueOnce(makeDashboardResponse() as any)
      // post-success re-fetch (invoices)
      .mockResolvedValueOnce(makeInvoicesResponse([]) as any)
      .mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    renderPayments();

    // Wait for invoice to render
    const payNowButton = await screen.findByRole('button', { name: /pay now/i });
    await userEvent.click(payNowButton);

    // Modal appears — find the "Pay" confirm button inside it.
    // Plan 8 switched the system currency from USD ($) to EGP, so the
    // button now reads "Pay Now — EGP 1,000.00". Match the currency-symbol
    // agnostic prefix instead of a literal "$".
    const confirmButton = await screen.findByRole('button', { name: /pay now\s+—\s+egp/i });
    await userEvent.click(confirmButton);

    // Verify a POST was made among all fetch calls
    await waitFor(() => {
      const allCalls = (global.fetch as jest.Mock).mock.calls;
      const postCall = allCalls.find(
        ([_url, opts]: [string, RequestInit]) => opts?.method === 'POST'
      );
      expect(postCall).toBeDefined();
    });
  });

});
