import { z } from "zod";

export const createCreditNoteSchema = z.object({
  supplierId:       z.string().min(1),
  supplierReturnId: z.string().optional(), // link to a supplier return
  amount:           z.number().positive(),
  notes:            z.string().max(500).optional(),
  issuedAt:         z.string().datetime().optional(),
});

export const updateCreditNoteStatusSchema = z.object({
  status: z.enum(["APPLIED", "CANCELLED"]),
  notes:  z.string().max(500).optional(),
});

export const listCreditNoteQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
  supplierId: z.string().optional(),
  status:     z.enum(["PENDING", "APPLIED", "CANCELLED"]).optional(),
  from:       z.string().datetime({ offset: true }).optional(),
  to:         z.string().datetime({ offset: true }).optional(),
});

export type CreateCreditNoteInput       = z.infer<typeof createCreditNoteSchema>;
export type UpdateCreditNoteStatusInput = z.infer<typeof updateCreditNoteStatusSchema>;
export type ListCreditNoteQuery         = z.infer<typeof listCreditNoteQuerySchema>;
