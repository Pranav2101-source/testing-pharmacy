import { z } from "zod";

export const CUSTOMER_TYPES = ["WALK_IN", "REGISTERED", "CORPORATE", "CREDIT"] as const;

export const createCustomerSchema = z.object({
  name:         z.string().min(1, "Name required").max(200),
  phone:        z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number").optional(),
  email:        z.string().email("Invalid email").optional(),
  address:      z.string().max(500).optional(),
  age:          z.number().int().min(0).max(150).optional(),
  gender:       z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  customerType: z.enum(CUSTOMER_TYPES).default("REGISTERED"),
  creditLimit:  z.number().min(0).default(0),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersQuerySchema = z.object({
  page:         z.coerce.number().int().positive().default(1),
  limit:        z.coerce.number().int().positive().max(100).default(20),
  search:       z.string().optional(), // name, phone, email
  customerType: z.enum(CUSTOMER_TYPES).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery  = z.infer<typeof listCustomersQuerySchema>;
