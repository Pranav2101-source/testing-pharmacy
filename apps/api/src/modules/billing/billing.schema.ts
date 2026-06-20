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
  items:            z.array(invoiceItemSchema).min(1, "At least one item required").max(500, "Cannot exceed 500 line items per invoice"),
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
  // Cursor-based pagination: pass the `nextCursor` from the previous page response.
  // When cursor is supplied, `page` is ignored and no COUNT query is issued.
  cursor:           z.string().optional(),
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
  cursor:    z.string().optional(),
  search:    z.string().optional(),
  from:      z.string().optional(),
  to:        z.string().optional(),
  invoiceId: z.string().optional(),
});

// ─── Invoice settings config ──────────────────────────────────────────────────
// Mirrors InvoiceSettingsConfig from @pharmacy/types. Defined here as a Zod
// schema so the PUT /billing/settings route can validate the body rather than
// accepting arbitrary JSON. Keep in sync with packages/types/src/invoice.ts.

const customFieldSchema = z.object({
  id:       z.string().min(1).max(50),
  label:    z.string().max(100),
  show:     z.boolean(),
  position: z.enum(["header", "footer"]),
});

export const invoiceSettingsConfigSchema = z.object({
  theme: z.enum(["classic", "modern", "minimal"]),
  paper: z.object({
    size: z.enum(["A4", "A5", "thermal80", "thermal58"]),
  }),
  branding: z.object({
    showLogo:             z.boolean(),
    logoUrl:              z.string().nullable(),
    logoPosition:         z.enum(["left", "center", "right"]),
    logoSize:             z.enum(["small", "medium", "large"]),
    primaryColor:         z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex colour"),
    pharmacyNameOverride: z.string().max(200),
    watermarkText:        z.string().max(100),
    pharmacyNameStyle:    z.enum(["normal", "bold", "italic"]),
  }),
  header: z.object({
    align:           z.enum(["left", "center", "right"]),
    showName:        z.boolean(),
    showAddress:     z.boolean(),
    showPhone:       z.boolean(),
    showEmail:       z.boolean(),
    showWebsite:     z.boolean(),
    showGstin:       z.boolean(),
    showDrugLicense: z.boolean(),
    showFssai:       z.boolean(),
    customText:      z.string().max(500),
  }),
  patient: z.object({
    showName:           z.boolean(),
    showMobile:         z.boolean(),
    showAddress:        z.boolean(),
    showUhid:           z.boolean(),
    showAbha:           z.boolean(),
    showDoctor:         z.boolean(),
    showPrescriptionNo: z.boolean(),
    showInvoiceDate:    z.boolean(),
    showCashier:        z.boolean(),
  }),
  columns: z.object({
    showHsn:      z.boolean(),
    showBatch:    z.boolean(),
    showExpiry:   z.boolean(),
    showFreeQty:  z.boolean(),
    showMrp:      z.boolean(),
    showRate:     z.boolean(),
    showDiscount: z.boolean(),
    showGstRate:  z.boolean(),
    showTaxable:  z.boolean(),
  }),
  totals: z.object({
    showSubtotal:     z.boolean(),
    showDiscount:     z.boolean(),
    showSavings:      z.boolean(),
    showTaxable:      z.boolean(),
    showCgst:         z.boolean(),
    showSgst:         z.boolean(),
    showIgst:         z.boolean(),
    showGstBreakdown: z.boolean(),
    showRoundOff:     z.boolean(),
    showPaymentMode:  z.boolean(),
    showAmountWords:  z.boolean(),
  }),
  footer: z.object({
    thankYouText:   z.string().max(200),
    terms:          z.string().max(1000),
    showSignature:  z.boolean(),
    signatureLabel: z.string().max(100),
    showQrCode:     z.boolean(),
    upiId:          z.string().max(100),
    contactInfo:    z.string().max(500),
  }),
  numbering: z.object({
    prefix:          z.string().max(20),
    financialYear:   z.string().max(10),
    separator:       z.string().max(3),
    counterLength:   z.number().int().min(4).max(8),
    // currentSequence is managed by the DocumentSequence table and should not
    // be changed via the settings UI, but we allow it through here so the
    // frontend can round-trip the full config without stripping the field.
    currentSequence: z.number().int().min(0),
  }),
  customFields: z.array(customFieldSchema).max(10),
  policy: z.object({
    returnWindowDays: z.number().int().min(0).max(365),
  }),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type CreateInvoiceInput        = z.infer<typeof createInvoiceSchema>;
export type InvoiceItemInput          = z.infer<typeof invoiceItemSchema>;
export type AddPaymentInput           = z.infer<typeof addPaymentSchema>;
export type CreateReturnInput         = z.infer<typeof createReturnSchema>;
export type ListInvoicesQuery         = z.infer<typeof listInvoicesQuerySchema>;
export type ListReturnsQuery          = z.infer<typeof listReturnsQuerySchema>;
export type InvoiceSettingsConfigInput = z.infer<typeof invoiceSettingsConfigSchema>;
