import { z } from "zod";

export const createCashClosureSchema = z.object({
  closureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  openingCash: z.number().min(0).default(0),
  actualCash:  z.number().min(0).default(0),
  notes:       z.string().max(1000).optional(),
});

export const updateCashClosureSchema = z.object({
  openingCash: z.number().min(0).optional(),
  actualCash:  z.number().min(0).optional(),
  notes:       z.string().max(1000).optional(),
});

export const closeCashClosureSchema = z.object({
  actualCash: z.number().min(0),
  notes:      z.string().max(1000).optional(),
});

export const listCashClosureQuerySchema = z.object({
  from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["DRAFT", "CLOSED", "DISPUTED"]).optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(30),
});

export type CreateCashClosureInput = z.infer<typeof createCashClosureSchema>;
export type UpdateCashClosureInput = z.infer<typeof updateCashClosureSchema>;
export type CloseCashClosureInput  = z.infer<typeof closeCashClosureSchema>;
export type ListCashClosureQuery   = z.infer<typeof listCashClosureQuerySchema>;
