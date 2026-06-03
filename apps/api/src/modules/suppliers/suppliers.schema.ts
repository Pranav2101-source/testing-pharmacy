import { z } from "zod";
import { GST_RATES } from "../medicines/medicines.schema.js";

export const createSupplierSchema = z.object({
  name:         z.string().min(2).max(100),
  gstin:        z.string().optional(),
  dlNumber:     z.string().optional(),
  phone:        z.string().optional(),
  email:        z.string().email().optional(),
  address:      z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  creditLimit:  z.number().min(0).default(0),
  creditDays:   z.number().int().min(0).default(30),
  paymentTerms: z.string().max(200).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const listSuppliersQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
});

// Kept for backward compat with old suppliers/purchase-orders endpoint
export const createPurchaseOrderSchema = z.object({
  supplierId:  z.string().min(1),
  orderNumber: z.string().min(1),
  invoiceNo:   z.string().optional(),
  notes:       z.string().optional(),
  items: z.array(z.object({
    medicineId:   z.string().min(1),
    medicineName: z.string().min(1),
    batchNumber:  z.string().min(1),
    expiryDate:   z.string().datetime(),
    quantity:     z.number().int().positive(),
    purchaseRate: z.number().positive(),
    mrp:          z.number().positive(),
    gstRate:      z
      .number()
      .refine((v) => (GST_RATES as readonly number[]).includes(v), "GST rate must be 0, 5, 12, or 18"),
  })).min(1),
});

export type CreateSupplierInput      = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput      = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery       = z.infer<typeof listSuppliersQuerySchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
