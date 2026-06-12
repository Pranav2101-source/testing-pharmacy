import { z } from "zod";

const GST_RATES = [0, 5, 12, 18] as const;

// ── Purchase Order ──────────────────────────────────────────────────────────

export const poItemSchema = z.object({
  medicineId:   z.string().min(1),
  medicineName: z.string().min(1),
  batchNumber:  z.string().min(1).max(50),
  expiryDate:   z.string().datetime(),
  quantity:     z.number().int().positive(),
  purchaseRate: z.number().positive(),
  mrp:          z.number().positive(),
  gstRate:      z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18"),
}).refine((d) => d.mrp >= d.purchaseRate, {
  message: "MRP must be greater than or equal to purchase rate",
  path:    ["mrp"],
});

export const createPOSchema = z.object({
  supplierId:   z.string().min(1),
  invoiceNo:    z.string().optional(),
  notes:        z.string().max(1000).optional(),
  expectedDate: z.string().datetime().optional(),
  items:        z.array(poItemSchema).min(1),
});

export const updatePOSchema = z.object({
  invoiceNo:    z.string().optional(),
  notes:        z.string().max(1000).optional(),
  expectedDate: z.string().datetime().optional(),
  items:        z.array(poItemSchema).min(1).optional(),
});

export const listPOQuerySchema = z.object({
  page:           z.coerce.number().int().positive().default(1),
  limit:          z.coerce.number().int().positive().max(100).default(20),
  status:         z.enum(["DRAFT", "PENDING", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(),
  approvalStatus: z.enum(["NOT_REQUIRED", "PENDING_APPROVAL", "APPROVED", "REJECTED"]).optional(),
  supplierId:     z.string().optional(),
  from:           z.string().datetime({ offset: true }).optional(),
  to:             z.string().datetime({ offset: true }).optional(),
  search:         z.string().optional(),
});

export const approvePOSchema = z.object({
  approved:       z.boolean(),
  rejectionReason: z.string().max(500).optional(),
});

export const sharePOSchema = z.object({
  method:    z.enum(["EMAIL", "WHATSAPP"]),
  recipient: z.string().min(1), // email or phone
});

// ── GRN ────────────────────────────────────────────────────────────────────

export const grnItemSchema = z.object({
  medicineId:       z.string().min(1),
  medicineName:     z.string().min(1),
  batchNumber:      z.string().min(1).max(50),
  expiryDate:       z.string().datetime(),
  orderedQty:       z.number().int().nonnegative().optional(),
  receivedQty:      z.number().int().positive(),
  freeQty:          z.number().int().nonnegative().default(0),
  purchaseUnit:     z.enum(["BOX", "STRIP", "UNIT"]).default("UNIT"),
  conversionFactor: z.number().int().positive().default(1), // base units per purchase unit
  purchaseRate:     z.number().positive(),
  mrp:              z.number().positive(),
  discount:         z.number().min(0).max(100).default(0),
  gstRate:          z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18"),
}).refine((d) => d.mrp >= d.purchaseRate, {
  message: "MRP must be greater than or equal to purchase rate",
  path:    ["mrp"],
});

export const createGRNSchema = z.object({
  supplierId:          z.string().min(1),
  purchaseOrderId:     z.string().optional(),
  supplierInvoiceNo:   z.string().optional(),
  supplierInvoiceDate: z.string().datetime().optional(),
  notes:               z.string().max(1000).optional(),
  items:               z.array(grnItemSchema).min(1),
  // Set to true when the purchaser knowingly accepts near-expiry stock
  // (e.g. bought at a discount).  Without this flag the API rejects any
  // item expiring within NEAR_EXPIRY_DAYS to prevent accidental purchases.
  allowNearExpiry:     z.boolean().default(false),
});

export const updateGRNSchema = z.object({
  supplierInvoiceNo:   z.string().optional(),
  supplierInvoiceDate: z.string().datetime().optional(),
  notes:               z.string().max(1000).optional(),
  items:               z.array(grnItemSchema).min(1).optional(),
  allowNearExpiry:     z.boolean().default(false),
});

export const listGRNQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
  status:     z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]).optional(),
  supplierId: z.string().optional(),
  from:       z.string().datetime({ offset: true }).optional(),
  to:         z.string().datetime({ offset: true }).optional(),
  overdue:    z.coerce.boolean().optional(), // payment due date passed
});

// ── Auto Purchase Suggestions ────────────────────────────────────────────────

export const autoSuggestQuerySchema = z.object({
  daysThreshold: z.coerce.number().int().positive().default(30), // suggest if stock < X days of supply
  supplierId:    z.string().optional(),
});

// ── Reorder → PO draft ───────────────────────────────────────────────────────

export const fromReorderItemSchema = z.object({
  medicineId:   z.string().min(1),
  medicineName: z.string().min(1),
  quantity:     z.number().int().positive(),
  purchaseRate: z.number().positive(),
  mrp:          z.number().positive(),
  gstRate:      z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18"),
});

export const fromReorderSchema = z.object({
  supplierId: z.string().min(1),
  notes:      z.string().max(1000).optional(),
  items:      z.array(fromReorderItemSchema).min(1),
});

export type FromReorderInput     = z.infer<typeof fromReorderSchema>;
export type UpdateGRNInput       = z.infer<typeof updateGRNSchema>;
export type POItemInput          = z.infer<typeof poItemSchema>;
export type CreatePOInput        = z.infer<typeof createPOSchema>;
export type UpdatePOInput        = z.infer<typeof updatePOSchema>;
export type ListPOQuery          = z.infer<typeof listPOQuerySchema>;
export type ApprovePOInput       = z.infer<typeof approvePOSchema>;
export type SharePOInput         = z.infer<typeof sharePOSchema>;
export type GRNItemInput         = z.infer<typeof grnItemSchema>;
export type CreateGRNInput       = z.infer<typeof createGRNSchema>;
export type ListGRNQuery         = z.infer<typeof listGRNQuerySchema>;
export type AutoSuggestQuery     = z.infer<typeof autoSuggestQuerySchema>;
