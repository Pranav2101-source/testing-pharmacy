import { z } from "zod";

export const SUPPLIER_RETURN_REASONS = [
  "DAMAGED",
  "NEAR_EXPIRY",
  "EXPIRED",
  "WRONG_PRODUCT",
  "QUALITY_ISSUE",
  "SHORT_SUPPLY",
  "OTHER",
] as const;

export const srItemSchema = z.object({
  inventoryId:  z.string().min(1),
  medicineId:   z.string().min(1),
  medicineName: z.string().min(1),
  batchNumber:  z.string().min(1),
  expiryDate:   z.string().datetime(),
  quantity:     z.number().int().positive(),
  purchaseRate: z.number().positive(),
  reason:       z.enum(SUPPLIER_RETURN_REASONS).default("DAMAGED"),
});

export const createSRSchema = z.object({
  supplierId:  z.string().min(1),
  debitNoteNo: z.string().max(50).optional(),
  notes:       z.string().max(1000).optional(),
  items:       z.array(srItemSchema).min(1),
});

export const listSRQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
  status:     z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]).optional(),
  supplierId: z.string().optional(),
  from:       z.string().datetime({ offset: true }).optional(),
  to:         z.string().datetime({ offset: true }).optional(),
});

export type CreateSRInput  = z.infer<typeof createSRSchema>;
export type ListSRQuery    = z.infer<typeof listSRQuerySchema>;
