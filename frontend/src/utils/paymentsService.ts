import { API_URLS } from '@shared/config';
import { apiFetch } from './api';

const API_BASE_URL = `${API_URLS.payments()}/api`;

// ============ UTILITY FUNCTIONS ============

/**
 * Calculate days until due
 */
export const daysUntilDue = (dueDate: string): number => {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

/**
 * Format currency
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    currencyDisplay: 'code'
  }).format(amount);
};

/**
 * Get status color class
 */
export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'paid':
    case 'completed':
      return 'bg-green-500/20 text-green-500 border-green-500/30';
    case 'pending':
    case 'partial':
      return 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30';
    case 'overdue':
    case 'failed':
      return 'bg-red-500/20 text-red-500 border-red-500/30';
    default:
      return 'bg-gray-500/20 text-gray-500 border-gray-500/30';
  }
};

/**
 * Format date
 */
export const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

// ============ TYPES ============

export type PaymentMethodType =
  | 'credit_card'
  | 'bank_transfer'
  | 'paypal'
  | 'apple_pay'
  | 'cash';

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  brand?: string | null;
  last4?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  expiryDate?: string | null;
  holderName?: string | null;
  nickname?: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface Invoice {
  id: string;
  odID: string;
  title: string;
  description: string;
  category: 'tuition' | 'fees' | 'deposit' | 'service' | 'other';
  amount: number;
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'pending' | 'overdue';
  dueDate: string;
  paidDate: string | null;
  semester: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  odID: string;
  invoiceId: string | null;
  type: 'payment' | 'refund' | 'financial_aid';
  method: string;
  amount: number;
  description: string;
  status: 'completed' | 'pending' | 'failed';
  cardLast4?: string;
  timestamp: string;
  receiptNumber: string | null;
}

export interface ServiceFee {
  id: string;
  name: string;
  fee: number;
  category: string;
  processingDays: number;
  variable?: boolean;
}

export interface AccountSummary {
  totalBilled: number;
  totalPaid: number;
  totalAid: number;
  outstandingBalance: number;
  overdueAmount: number;
  invoiceCount: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
}

export interface StudentAccount {
  odID: string;
  name: string;
  email: string;
  studentId: string;
  balance: number;
  totalPaid: number;
  financialAidApplied: number;
  paymentPlan: string;
}

export interface PaymentDashboard {
  account: StudentAccount | null;
  summary: AccountSummary;
  recentTransactions: Transaction[];
  upcomingInvoices: Invoice[];
  monthlyActivity: { month: string; amount: number }[];
  alerts: {
    hasOverdue: boolean;
    overdueAmount: number;
    paymentDueSoon: boolean;
  };
}

// ============ API FUNCTIONS ============

/**
 * Get account summary and payment methods
 */
export const getAccountSummary = async (odID: string): Promise<{
  account: StudentAccount;
  summary: AccountSummary;
  paymentMethods: PaymentMethod[];
} | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/account/${odID}`);
    if (!response.ok) throw new Error('Failed to fetch account');
    return await response.json();
  } catch (error) {
    console.error('Error fetching account:', error);
    return null;
  }
};

/**
 * Get all invoices for a student.
 *
 * Backend response shape: { data: Invoice[], total, limit, offset }.
 * We normalise it to { invoices, total } here so callers don't need to know
 * which key the server uses.
 */
export const getInvoices = async (
  odID: string,
  filters?: { status?: string; semester?: string }
): Promise<{ invoices: Invoice[]; total: number; totalAmount: number; totalBalance: number } | null> => {
  try {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.semester) params.append('semester', filters.semester);

    const url = `${API_BASE_URL}/payments/invoices/${odID}${params.toString() ? `?${params}` : ''}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch invoices');
    const json = await response.json();
    // Server returns `data` (canonical); accept legacy `invoices` too.
    const invoices: Invoice[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.invoices)
      ? json.invoices
      : [];
    const totalAmount = invoices.reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalBalance = invoices.reduce((s, i) => s + Number(i.balance || 0), 0);
    return {
      invoices,
      total: typeof json?.total === 'number' ? json.total : invoices.length,
      totalAmount,
      totalBalance,
    };
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return null;
  }
};

/**
 * Get single invoice with related transactions
 */
export const getInvoiceDetails = async (invoiceId: string): Promise<{
  invoice: Invoice;
  transactions: Transaction[];
} | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/invoice/${invoiceId}`);
    if (!response.ok) throw new Error('Failed to fetch invoice');
    return await response.json();
  } catch (error) {
    console.error('Error fetching invoice details:', error);
    return null;
  }
};

/**
 * Get transaction history
 */
export const getTransactions = async (
  odID: string,
  options?: { type?: string; limit?: number }
): Promise<{ transactions: Transaction[]; total: number } | null> => {
  try {
    const params = new URLSearchParams();
    if (options?.type) params.append('type', options.type);
    if (options?.limit) params.append('limit', options.limit.toString());

    const url = `${API_BASE_URL}/payments/transactions/${odID}${params.toString() ? `?${params}` : ''}`;
    const response = await apiFetch(url);
    if (!response.ok) throw new Error('Failed to fetch transactions');
    return await response.json();
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return null;
  }
};

/**
 * Get available service fees
 */
export const getServiceFees = async (): Promise<{
  services: ServiceFee[];
  categories: string[];
} | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/service-fees`);
    if (!response.ok) throw new Error('Failed to fetch service fees');
    return await response.json();
  } catch (error) {
    console.error('Error fetching service fees:', error);
    return null;
  }
};

/**
 * Process a payment
 */
/**
 * Creates a Stripe Checkout Session for the given invoice. The backend returns
 * `{ url, sessionId }` — the caller should immediately set
 * `window.location.href = url` to redirect the user to Stripe's hosted page.
 *
 * Replaces the legacy `makePayment()` function (POST /api/payments/pay), which
 * was removed alongside the manual visa/cash flow. Every UniFlow invoice is
 * now paid via Stripe.
 */
export const createStripeCheckoutSession = async (
  invoiceId: string,
): Promise<{ success: boolean; url?: string; sessionId?: string; error?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/stripe/checkout`, {
      method: 'POST',
      body: JSON.stringify({ invoiceId }),
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || data.message || 'Could not start checkout' };
    }
    return { success: true, url: data.url, sessionId: data.sessionId };
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    return { success: false, error: 'Could not reach payments server' };
  }
};

/**
 * Looks up a Stripe Checkout Session's status and the resulting Transaction
 * (if the webhook has already landed). The success page polls this once a
 * second or so until `transaction` is present.
 */
export const getStripeSessionStatus = async (
  sessionId: string,
): Promise<{
  success: boolean;
  status?: string;
  paymentStatus?: string;
  transaction?: Transaction | null;
  error?: string;
}> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/stripe/session/${encodeURIComponent(sessionId)}`);
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Could not look up payment' };
    }
    return {
      success: true,
      status: data.status,
      paymentStatus: data.paymentStatus,
      transaction: data.transaction,
    };
  } catch (error) {
    console.error('Error looking up Stripe session:', error);
    return { success: false, error: 'Could not reach payments server' };
  }
};

/**
 * Submit a service fee request
 */
export const submitServiceRequest = async (
  odID: string,
  serviceId: string,
  notes?: string,
  customAmount?: number
): Promise<{
  success: boolean;
  message: string;
  request?: Record<string, unknown>;
  invoice?: { id: string; amount: number; dueDate: string };
  error?: string;
}> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/service-request`, {
      method: 'POST',
      body: JSON.stringify({
        odID,
        serviceId,
        notes,
        customAmount
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, message: data.error || 'Request failed' };
    }

    return data;
  } catch (error) {
    console.error('Error submitting service request:', error);
    return { success: false, message: 'Failed to submit request. Please try again.' };
  }
};

/**
 * Get service requests for a student
 */
export const getServiceRequests = async (odID: string): Promise<{ requests: Record<string, unknown>[] } | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/service-requests/${odID}`);
    if (!response.ok) throw new Error('Failed to fetch service requests');
    return await response.json();
  } catch (error) {
    console.error('Error fetching service requests:', error);
    return null;
  }
};

/**
 * Get receipt details
 */
export const getReceipt = async (receiptNumber: string): Promise<{
  receipt: {
    number: string;
    date: string;
    amount: number;
    method: string;
    status: string;
  };
  payer: {
    name: string;
    studentId: string;
    email: string;
  } | null;
  invoice: {
    id: string;
    title: string;
    originalAmount: number;
  } | null;
  transaction: Transaction;
} | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/receipt/${receiptNumber}`);
    if (!response.ok) throw new Error('Receipt not found');
    return await response.json();
  } catch (error) {
    console.error('Error fetching receipt:', error);
    return null;
  }
};

/**
 * Get payment dashboard data
 */
export const getPaymentDashboard = async (odID: string): Promise<PaymentDashboard | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/dashboard/${odID}`);
    if (!response.ok) throw new Error('Failed to fetch dashboard');
    return await response.json();
  } catch (error) {
    console.error('Error fetching payment dashboard:', error);
    return null;
  }
};

/**
 * List a user's saved payment methods.
 */
export const getPaymentMethods = async (
  odID: string
): Promise<{ data: PaymentMethod[] } | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/methods/${odID}`);
    if (!response.ok) throw new Error('Failed to fetch methods');
    return await response.json();
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return null;
  }
};

/**
 * Add a payment method
 */
export const addPaymentMethod = async (
  odID: string,
  method: {
    type: PaymentMethodType;
    brand?: string;
    last4?: string;
    expiryMonth?: number;
    expiryYear?: number;
    holderName?: string;
    nickname?: string;
    isDefault?: boolean;
    setDefault?: boolean;
  }
): Promise<{ success: boolean; message?: string; data?: PaymentMethod; method?: PaymentMethod; error?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/methods/${odID}`, {
      method: 'POST',
      body: JSON.stringify(method)
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to add payment method' };
    }
    return { success: true, ...data };
  } catch (error) {
    console.error('Error adding payment method:', error);
    return { success: false, error: 'Failed to add payment method' };
  }
};

/**
 * Update a payment method (currently only for switching the default flag).
 */
export const setDefaultPaymentMethod = async (
  odID: string,
  methodId: string
): Promise<{ success: boolean; data?: PaymentMethod; error?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/methods/${odID}/${methodId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: true })
    });
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to update payment method' };
    }
    return { success: true, ...data };
  } catch (error) {
    console.error('Error updating payment method:', error);
    return { success: false, error: 'Failed to update payment method' };
  }
};

/**
 * Remove a payment method
 */
export const removePaymentMethod = async (
  odID: string,
  methodId: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/payments/methods/${odID}/${methodId}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error || 'Failed to remove payment method' };
    }
    return data;
  } catch (error) {
    console.error('Error removing payment method:', error);
    return { success: false, error: 'Failed to remove payment method' };
  }
};

