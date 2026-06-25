/**
 * payments/lib/account.js
 *
 * Shared helpers and Zod validation schemas for the payments service.
 *
 * Exports:
 *   generateReceiptNumber()           — RCP-YYYY-XXXXXX receipt ID generator
 *   paySchema                         — Zod schema for POST /api/payments/pay body
 *   serviceFeeCreateSchema            — Zod schema for POST /api/payments/service-fees
 *   serviceFeeUpdateSchema            — Zod schema for PUT /api/payments/service-fees/:id
 *   employeeUpsertSchema              — Zod schema for PUT /api/admin/users/:id/employee
 *   payrollRunCreateSchema            — Zod schema for POST /api/admin/payroll/runs
 *   deductionCreateSchema             — Zod schema for POST /api/admin/payroll/payslips/:id/deductions
 *   finAidCreateSchema                — Zod schema for POST /api/financial-aid
 *   finAidDecisionSchema              — Zod schema for PATCH /api/admin/financial-aid/:id
 *   finAidUpload                      — multer instance for financial-aid document uploads
 *   FIN_AID_UPLOAD_DIR                — resolved upload directory path
 */

'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const storage = require('../../../lib/storage');
const { z }  = require('zod');

// ── Receipt number ────────────────────────────────────────────────────────────

/**
 * Generates a short unique receipt reference such as RCP-2026-A3F7C1.
 * @returns {string}
 */
const generateReceiptNumber = () =>
  `RCP-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

// ── Shared money field (numeric or decimal string) ───────────────────────────

const moneyField = z.union([
  z.number().nonnegative(),
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format').transform(Number),
]);

// ── FeeCategory enum — must stay in sync with schema.prisma ──────────────────

const FEE_CATEGORIES = [
  'registration', 'document', 'lab', 'tuition', 'library',
  'housing', 'exam', 'sports', 'other',
];

// ── Invoice / payment schemas ─────────────────────────────────────────────────

const paySchema = z.object({
  invoiceId:       z.string().min(1, 'invoiceId required'),
  amount: z.union([
    z.number().positive('Amount must be positive'),
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount format').transform(Number),
  ]),
  method:          z.enum(['visa', 'applepay', 'cash', 'credit_card', 'bank_transfer', 'paypal']).optional(),
  paymentMethodId: z.string().optional(),
});

// ── Service fee schemas ───────────────────────────────────────────────────────

const serviceFeeCreateSchema = z.object({
  name:           z.string().min(1, 'name required').max(120),
  amount:         moneyField,
  category:       z.enum(FEE_CATEGORIES).default('other'),
  description:    z.string().max(500).optional().nullable(),
  processingDays: z.number().int().min(0).max(365).optional(),
  variable:       z.boolean().optional(),
});

const serviceFeeUpdateSchema = serviceFeeCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ── Payroll schemas ───────────────────────────────────────────────────────────

const employeeUpsertSchema = z.object({
  employmentType:  z.enum(['full_time', 'part_time', 'contract', 'hourly', 'intern']).optional(),
  hireDate:        z.string().datetime().optional().nullable(),
  terminationDate: z.string().datetime().optional().nullable(),
  position:        z.string().max(120).optional().nullable(),
  office:          z.string().max(120).optional().nullable(),
  payrollId:       z.string().max(60).optional().nullable(),
  contractType:    z.string().max(60).optional().nullable(),
  baseSalary: z.union([
    z.number().nonnegative(),
    z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number),
  ]).optional(),
  currency:        z.string().length(3).optional(),
  bankName:        z.string().max(120).optional().nullable(),
  bankAccount:     z.string().max(60).optional().nullable(),
  taxId:           z.string().max(60).optional().nullable(),
});

const payrollRunCreateSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM'),
  notes:  z.string().max(500).optional().nullable(),
});

const deductionCreateSchema = z.object({
  type: z.enum(['tax', 'insurance', 'loan', 'advance', 'custom']).default('custom'),
  amount: z.union([
    z.number().positive(),
    z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number),
  ]),
  description: z.string().max(200).optional().nullable(),
});

// ── Financial-aid schemas ─────────────────────────────────────────────────────

const moneyDecimal = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number),
]);

const finAidCreateSchema = z.object({
  requestedAmount: moneyDecimal,
  justification:   z.string().min(10).max(5000),
  applicantIncome: moneyDecimal.optional().nullable(),
  dependents:      z.number().int().min(0).max(50).optional().nullable(),
  supportingDocs:  z.array(z.object({
    name:      z.string(),
    url:       z.string(),
    sizeBytes: z.number().int().nonnegative(),
  })).optional().default([]),
});

const finAidDecisionSchema = z.object({
  action:        z.enum(['approve', 'reject']),
  awardedAmount: moneyDecimal.optional(),
  reviewNote:    z.string().max(2000).optional().nullable(),
});

// ── Financial-aid file upload ─────────────────────────────────────────────────
// Honours UPLOAD_ROOT (Fly volume at /app/uploads). Subfolder name matches
// the URL nginx serves via /uploads/financial-aid/<file>.

const FIN_AID_UPLOAD_DIR = process.env.UPLOAD_ROOT
  ? path.join(process.env.UPLOAD_ROOT, 'financial-aid')
  : path.join(__dirname, '..', 'uploads', 'financial-aid');
if (!fs.existsSync(FIN_AID_UPLOAD_DIR)) fs.mkdirSync(FIN_AID_UPLOAD_DIR, { recursive: true });

const FIN_AID_ALLOWED_TYPES =
  /(application\/pdf|image\/(jpeg|png|gif|webp)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword)/i;

const finAidUpload = storage.memoryUpload({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    if (FIN_AID_ALLOWED_TYPES.test(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type. Allowed: PDF, image, DOC/DOCX'), false);
  },
});

module.exports = {
  generateReceiptNumber,
  paySchema,
  serviceFeeCreateSchema,
  serviceFeeUpdateSchema,
  employeeUpsertSchema,
  payrollRunCreateSchema,
  deductionCreateSchema,
  finAidCreateSchema,
  finAidDecisionSchema,
  finAidUpload,
  FIN_AID_UPLOAD_DIR,
};
