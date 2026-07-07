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

// Per-pharmacy override of catalog values. null clears a field back to the
// catalog value; an override with nothing left should be DELETEd instead.
export const upsertOverrideSchema = z
  .object({
    gstRate: z
      .number()
      .refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18")
      .nullable()
      .optional(),
    defaultDiscountPct: z.number().min(0).max(100).nullable().optional(),
    notes:              z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.gstRate != null || v.defaultDiscountPct != null, {
    message: "Set gstRate and/or defaultDiscountPct — use DELETE to remove an override",
  });

// Narrow "set barcode only" mutation. A barcode (EAN/UPC) is a universal product
// identifier, so mapping it is safe for a pharmacy to do even though other
// catalog fields (name/gstRate/schedule) remain platform-admin-only. `null`
// clears the mapping.
export const setBarcodeSchema = z.object({
  barcode: z.string().trim().max(64).nullable().refine(
    (v) => v === null || v.length >= 3,
    "Barcode must be at least 3 characters",
  ),
});

export type SetBarcodeInput      = z.infer<typeof setBarcodeSchema>;
export type CreateMedicineInput  = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput  = z.infer<typeof updateMedicineSchema>;
export type ListMedicinesQuery   = z.infer<typeof listMedicinesQuerySchema>;
export type UpsertOverrideInput  = z.infer<typeof upsertOverrideSchema>;
