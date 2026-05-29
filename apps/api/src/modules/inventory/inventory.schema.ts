import { z } from "zod";

export const addStockSchema = z.object({
  medicineId: z.string().min(1),
  batchNumber: z.string().min(1),
  expiryDate: z.string().datetime(),
  quantity: z.number().int().positive(),
  purchaseRate: z.number().positive(),
  mrp: z.number().positive(),
  location: z.string().optional(),
  minimumStock: z.number().int().default(10),
});

export const updateStockSchema = addStockSchema.partial().omit({ medicineId: true });

export type AddStockInput = z.infer<typeof addStockSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
