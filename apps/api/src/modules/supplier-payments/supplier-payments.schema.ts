import { z } from "zod";

export const createPaymentSchema = z.object({
  supplierId:  z.string().min(1),
  grnId:       z.string().optional(), // link to specific GRN/invoice
  amount:      z.number().positive(),
  paymentMode: z.enum(["CASH", "UPI", "CARD", "CREDIT", "WALLET"]),
  reference:   z.string().max(100).optional(),
  notes:       z.string().max(500).optional(),
  paidAt:      z.string().datetime().optional(),
});

export const listPaymentQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  limit:       z.coerce.number().int().positive().max(100).default(20),
  supplierId:  z.string().optional(),
  grnId:       z.string().optional(),
  from:        z.string().datetime({ offset: true }).optional(),
  to:          z.string().datetime({ offset: true }).optional(),
});

export type CreatePaymentInput  = z.infer<typeof createPaymentSchema>;
export type ListPaymentQuery    = z.infer<typeof listPaymentQuerySchema>;
