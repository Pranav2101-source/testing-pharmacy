import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(100),
  gstin: z.string().optional(),
  dlNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  orderNumber: z.string().min(1),
  invoiceNo: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    medicineId: z.string().min(1),
    medicineName: z.string().min(1),
    batchNumber: z.string().min(1),
    expiryDate: z.string().datetime(),
    quantity: z.number().int().positive(),
    purchaseRate: z.number().positive(),
    mrp: z.number().positive(),
    gstRate: z.number(),
  })).min(1),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
