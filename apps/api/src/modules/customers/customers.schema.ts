import { z } from "zod";

export const CUSTOMER_TYPES = ["WALK_IN", "REGISTERED", "CORPORATE", "CREDIT"] as const;

export const createCustomerSchema = z.object({
  name:            z.string().min(1, "Name required").max(200),
  phone:           z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number").optional(),
  email:           z.string().email("Invalid email").optional(),
  address:         z.string().max(500).optional(),
  dateOfBirth:     z.string().optional(),          // "YYYY-MM-DD" ISO date string
  gender:          z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  abhaNumber:      z.string().max(50).optional(),  // ABHA / Health ID / IPD / OPD
  cardNumber:      z.string().max(50).optional(),  // Pharmacy loyalty card
  customerType:    z.enum(CUSTOMER_TYPES).default("REGISTERED"),
  defaultDiscount: z.number().min(0).max(100).default(0),
  creditLimit:     z.number().min(0).default(0),
  notes:           z.string().max(1000).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersQuerySchema = z.object({
  page:         z.coerce.number().int().positive().default(1),
  limit:        z.coerce.number().int().positive().max(100).default(20),
  search:       z.string().optional(), // name, phone, email, abhaNumber, cardNumber
  customerType: z.enum(CUSTOMER_TYPES).optional(),
});

// Lightweight search for billing combobox — returns minimal fields, prioritises phone matches
export const searchCustomersQuerySchema = z.object({
  q:     z.string().min(1).max(100),
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type CreateCustomerInput  = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput  = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery   = z.infer<typeof listCustomersQuerySchema>;
export type SearchCustomersQuery = z.infer<typeof searchCustomersQuerySchema>;
