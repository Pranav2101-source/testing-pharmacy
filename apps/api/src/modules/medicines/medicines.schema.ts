import { z } from "zod";

export const MEDICINE_FORMS     = ["tablet", "capsule", "syrup", "injection", "cream", "drops", "sachet", "gel", "powder", "inhaler", "suspension", "lotion", "ointment", "patch", "spray"] as const;
export const MEDICINE_SCHEDULES = ["OTC", "H", "H1", "X", "G"] as const;
export const GST_RATES          = [0, 5, 12, 18] as const;

export const createMedicineSchema = z.object({
  name:         z.string().min(1).max(200),
  genericName:  z.string().max(200).optional(),
  manufacturer: z.string().max(200).optional(),
  composition:  z.string().max(500).optional(),
  category:     z.string().max(100).optional(),
  schedule:     z.enum(MEDICINE_SCHEDULES).optional(),
  hsnCode:      z.string().regex(/^\d{8}$/, "HSN code must be 8 digits").optional(),
  gstRate:      z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18").default(12),
  form:         z.enum(MEDICINE_FORMS).optional(),
  strength:     z.string().max(100).optional(),
  unit:         z.string().max(50).optional(),
  packSize:     z.string().max(100).optional(),
});

export const updateMedicineSchema = createMedicineSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const listMedicinesQuerySchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
  search:   z.string().optional(),
  category: z.string().optional(),
  schedule: z.enum(MEDICINE_SCHEDULES).optional(),
  form:     z.enum(MEDICINE_FORMS).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
export type ListMedicinesQuery  = z.infer<typeof listMedicinesQuerySchema>;
