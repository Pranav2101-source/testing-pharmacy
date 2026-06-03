import { z } from "zod";

export const createBrandSchema = z.object({
  name:         z.string().min(1).max(100),
  manufacturer: z.string().optional(),
  country:      z.string().optional(),
});

export const updateBrandSchema = createBrandSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const listBrandsQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(50),
  search: z.string().optional(),
});

export type CreateBrandInput  = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput  = z.infer<typeof updateBrandSchema>;
export type ListBrandsQuery   = z.infer<typeof listBrandsQuerySchema>;
