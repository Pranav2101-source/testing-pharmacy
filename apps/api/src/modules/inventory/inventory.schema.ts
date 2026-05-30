import { z } from "zod";

const addStockBaseSchema = z.object({
  medicineId:   z.string().min(1),
  batchNumber:  z.string().min(1),
  expiryDate:   z.string().datetime(),
  quantity:     z.number().int().positive(),
  purchaseRate: z.number().positive(),
  mrp:          z.number().positive(),
  location:     z.string().optional(),
  minimumStock: z.number().int().default(10),
});

export const addStockSchema = addStockBaseSchema.superRefine((data, ctx) => {
  // Guard: purchase rate above MRP is almost always a data-entry error
  if (data.purchaseRate > data.mrp) {
    ctx.addIssue({
      code:    z.ZodIssueCode.custom,
      message: `Purchase rate (${data.purchaseRate}) exceeds MRP (${data.mrp}) — verify before saving`,
      path:    ["purchaseRate"],
    });
  }
});

export const adjustStockSchema = z.object({
  delta:  z.number().int().refine((n) => n !== 0, "Delta must be non-zero"),
  reason: z.string().min(1, "Reason is required").max(500),
  type:   z.enum(["CORRECTION", "DAMAGE", "EXPIRY_WRITEOFF", "OPENING_BALANCE", "TRANSFER"])
           .default("CORRECTION"),
});

export const updateStockSchema = addStockBaseSchema.partial().omit({ medicineId: true });

export const reserveStockSchema = z.object({
  sessionId: z.string().uuid("sessionId must be a UUID"),
  items: z.array(z.object({
    inventoryId: z.string().min(1),
    quantity:    z.number().int().positive(),
  })).min(1),
});

export type AddStockInput    = z.infer<typeof addStockSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type ReserveStockInput = z.infer<typeof reserveStockSchema>;
