import { z } from "zod";

export const createCategorySchema = z.object({
  name:        z.string().min(1).max(100),
  code:        z.string().max(20).optional(),
  description: z.string().max(500).optional(),
  parentId:    z.string().optional(),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
