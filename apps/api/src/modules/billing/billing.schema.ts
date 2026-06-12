import { z } from "zod";
import { randomUUID } from "node:crypto";
import { PAYMENT_MODES, PAYMENT_STATUSES, INVOICE_STATUSES } from "./billing.constants.js";

// ─── Invoice creation ─────────────────────────────────────────────────────────

export const invoiceItemSchema = z.object({
  inventoryId: z.string().min(1),
  quantity:    z.number().int().positive("Quantity must be a positive integer"),
  discount:    z.number().min(0).max(100).default(0),
});

export const createInvoiceSchema = z.object({
  customerId:       z.string().optional(),
  doctorId:         z.string().optional(),
  doctorName:       z.string().max(200).optional(),
  prescriptionId:   z.string().optional(),
  paymentMode:      z.enum(PAYMENT_MODES).default("CASH"),
  paymentStatus:    z.enum(PAYMENT_STATUSES).default("PAID"),
  isInterstate:     z.boolean().default(false),
  notes:            z.string().max(1000).optional(),
  deliveryNotes:    z.string().max(1000).optional(),
  // Bill-level adjustments applied on top of item discounts
  billDiscountPct:  z.number().min(0).max(100).default(0),
  extraCharges:     z.number().min(0).default(0),
  adjustmentAmount: z.number().default(0),  // can be negative (reduction)
  idempotencyKey:   z.string().uuid().default(() => randomUUID()),
  items:            z.array(invoiceItemSchema).min(1, "At least one item required"),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(1).max(500),
});

// ─── Payment entry (split payments) ──────────────────────────────────────────

export const addPaymentSchema = z.object({
  amount:      z.number().positive("Payment amount must be positive"),
  paymentMode: z.enum(PAYMENT_MODES),
  reference:   z.string().max(100).optional(),
  notes:       z.string().max(500).optional(),
  // Must include timezone offset so the server stores the correct UTC instant
  // e.g. "2024-04-01T14:30:00+05:30" for IST
  paidAt:      z.string().datetime({ offset: true }).optional(),
});

// ─── Sales Return ─────────────────────────────────────────────────────────────

export const returnItemSchema = z.object({
  invoiceItemId: z.string().min(1, "invoiceItemId required"),
  quantity:      z.number().int().positive("Return quantity must be positive"),
  // RESTOCK adds quantity back to inventory; WRITEOFF records the return but discards the item
  disposition:   z.enum(["RESTOCK", "WRITEOFF"]).default("RESTOCK"),
});

export const createReturnSchema = z.object({
  reason:         z.string().min(1, "Return reason required").max(500),
  items:          z.array(returnItemSchema).min(1, "At least one item required"),
  idempotencyKey: z.string().uuid().default(() => randomUUID()),
});

// ─── List filters ─────────────────────────────────────────────────────────────

export const listInvoicesQuerySchema = z.object({
  page:             z.coerce.number().int().positive().default(1),
  limit:            z.coerce.number().int().positive().max(100).default(20),
  search:           z.string().optional(),
  // Accept plain date (YYYY-MM-DD) from date pickers or full ISO datetime with offset
  from:             z.string().optional(),
  to:               z.string().optional(),
  status:           z.enum(INVOICE_STATUSES).optional(),
  includeCancelled: z.coerce.boolean().default(false),
  paymentMode:      z.enum(PAYMENT_MODES).optional(),
  paymentStatus:    z.enum(PAYMENT_STATUSES).optional(),
  userId:           z.string().optional(),
  customerId:       z.string().optional(),
  minAmount:        z.coerce.number().optional(),
  maxAmount:        z.coerce.number().optional(),
});

export const listReturnsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(100).default(20),
  search:    z.string().optional(),
  from:      z.string().optional(),
  to:        z.string().optional(),
  invoiceId: z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceItemInput   = z.infer<typeof invoiceItemSchema>;
export type AddPaymentInput    = z.infer<typeof addPaymentSchema>;
export type CreateReturnInput  = z.infer<typeof createReturnSchema>;
export type ListInvoicesQuery  = z.infer<typeof listInvoicesQuerySchema>;
export type ListReturnsQuery   = z.infer<typeof listReturnsQuerySchema>;
