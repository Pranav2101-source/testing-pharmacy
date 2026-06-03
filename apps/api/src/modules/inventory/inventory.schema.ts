import { z } from "zod";

const BATCH_STATUSES = ["ACTIVE", "QUARANTINE", "EXPIRED", "DAMAGED"] as const;

export const ADJUSTMENT_REASONS = [
  "CORRECTION",
  "DAMAGE",
  "EXPIRY_WRITEOFF",
  "OPENING_BALANCE",
  "TRANSFER",
  "THEFT",
  "BREAKAGE",
  "STOCK_COUNT",
  "OTHER",
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

const addStockBaseSchema = z.object({
  medicineId:   z.string().min(1),
  batchNumber:  z.string().min(1).max(50),
  expiryDate:   z.string().datetime(),
  quantity:     z.number().int().positive(),
  purchaseRate: z.number().positive(),
  mrp:          z.number().positive(),
  location:     z.string().max(100).optional(),
  shelfId:      z.string().optional(),
  minimumStock: z.number().int().min(0).default(10),
  reorderLevel: z.number().int().min(0).default(5),
});

export const addStockSchema = addStockBaseSchema.superRefine((data, ctx) => {
  if (data.purchaseRate > data.mrp) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      message: `Purchase rate (${data.purchaseRate}) exceeds MRP (${data.mrp}) — verify before saving`,
      path:    ["purchaseRate"],
    });
  }
});

export const updateStockSchema = addStockBaseSchema.partial().omit({ medicineId: true });

export const adjustStockSchema = z.object({
  delta:  z.number().int().refine((n) => n !== 0, "Delta must be non-zero"),
  reason: z.string().min(1, "Reason is required").max(500),
  type:   z.enum(ADJUSTMENT_REASONS).default("CORRECTION"),
});

export const updateBatchStatusSchema = z.object({
  status: z.enum(BATCH_STATUSES),
  reason: z.string().min(1).max(500),
});

export const reserveStockSchema = z.object({
  sessionId: z.string().uuid("sessionId must be a UUID"),
  items: z.array(z.object({
    inventoryId: z.string().min(1),
    quantity:    z.number().int().positive(),
  })).min(1),
});

export const listInventoryQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
  search:     z.string().optional(),
  medicineId: z.string().optional(),
  inStock:    z.coerce.boolean().optional(),
  lowStock:   z.coerce.boolean().optional(),
  nearExpiry: z.coerce.boolean().optional(),
  status:     z.enum(BATCH_STATUSES).optional(),
});

export const listLedgerQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  limit:       z.coerce.number().int().positive().max(100).default(50),
  inventoryId: z.string().optional(),
  medicineId:  z.string().optional(),
  type:        z.enum(["SALE", "RETURN", "PURCHASE", "ADJUSTMENT", "OPENING", "DAMAGE", "EXPIRY_REMOVAL"]).optional(),
  direction:   z.enum(["IN", "OUT"]).optional(),
  from:        z.string().datetime({ offset: true }).optional(),
  to:          z.string().datetime({ offset: true }).optional(),
});

export const batchRecallSchema = z.object({
  batchNumber: z.string().min(1).max(50),
  medicineId:  z.string().optional(),
  reason:      z.string().min(1).max(500),
});

export const listBatchRecallQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  limit:       z.coerce.number().int().positive().max(100).default(20),
  batchNumber: z.string().optional(),
});

export type AddStockInput          = z.infer<typeof addStockSchema>;
export type UpdateStockInput       = z.infer<typeof updateStockSchema>;
export type AdjustStockInput       = z.infer<typeof adjustStockSchema>;
export type UpdateBatchStatusInput = z.infer<typeof updateBatchStatusSchema>;
export type ReserveStockInput      = z.infer<typeof reserveStockSchema>;
export type ListInventoryQuery     = z.infer<typeof listInventoryQuerySchema>;
export type ListLedgerQuery        = z.infer<typeof listLedgerQuerySchema>;
export type BatchRecallInput       = z.infer<typeof batchRecallSchema>;
export type ListBatchRecallQuery   = z.infer<typeof listBatchRecallQuerySchema>;
