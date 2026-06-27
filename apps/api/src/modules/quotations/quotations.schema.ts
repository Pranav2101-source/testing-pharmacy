import { z } from "zod";

const GST_RATES = [0, 5, 12, 18] as const;

export const quotationItemSchema = z.object({
  medicineId:   z.string().min(1, "Medicine is required"),
  medicineName: z.string().min(1),
  quantity:     z.number().int().positive(),
  quotedRate:   z.number().positive().optional(),
  mrp:          z.number().positive().optional(),
  gstRate:      z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), "GST must be 0, 5, 12, or 18").default(12),
  discount:     z.number().min(0).max(100).default(0),
  notes:        z.string().max(200).optional(),
});

export const createQuotationSchema = z.object({
  supplierId:  z.string().min(1),
  validUntil:  z.string().datetime().optional(),
  notes:       z.string().max(1000).optional(),
  items:       z.array(quotationItemSchema).min(1),
});

export const updateQuotationSchema = z.object({
  validUntil: z.string().datetime().optional(),
  notes:      z.string().max(1000).optional(),
  items:      z.array(quotationItemSchema).min(1).optional(),
});

export const listQuotationQuerySchema = z.object({
  page:       z.coerce.number().int().positive().default(1),
  limit:      z.coerce.number().int().positive().max(100).default(20),
  supplierId: z.string().optional(),
  status:     z.enum(["DRAFT", "SENT", "RECEIVED", "EXPIRED", "CONVERTED"]).optional(),
  from:       z.string().datetime({ offset: true }).optional(),
  to:         z.string().datetime({ offset: true }).optional(),
});

// Compare quotes: given a list of quotationIds, return a side-by-side comparison
export const compareQuotationsSchema = z.object({
  quotationIds: z.array(z.string().min(1)).min(2).max(10),
});

// Convert best-priced quotation to PO
export const convertToPOSchema = z.object({
  quotationId: z.string().min(1),
});

export type QuotationItemInput    = z.infer<typeof quotationItemSchema>;
export type CreateQuotationInput  = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput  = z.infer<typeof updateQuotationSchema>;
export type ListQuotationQuery    = z.infer<typeof listQuotationQuerySchema>;
export type CompareQuotationsInput = z.infer<typeof compareQuotationsSchema>;
export type ConvertToPOInput      = z.infer<typeof convertToPOSchema>;
