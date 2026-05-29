import { z } from "zod";
import { PAYMENT_MODES, PAYMENT_STATUSES } from "./billing.constants.js";

export const invoiceItemSchema = z.object({
  inventoryId: z.string().min(1),
  quantity: z.number().int().positive(),
  discount: z.number().min(0).max(100).default(0),
});

export const createInvoiceSchema = z.object({
  customerId: z.string().optional(),
  doctorName: z.string().optional(),
  prescriptionId: z.string().optional(),
  paymentMode: z.enum(PAYMENT_MODES).default("CASH"),
  paymentStatus: z.enum(PAYMENT_STATUSES).default("PAID"),
  notes: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(1),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
