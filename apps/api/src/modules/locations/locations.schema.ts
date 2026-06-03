import { z } from "zod"

export const createRackSchema = z.object({
  code: z.string().min(1).max(20).trim().toUpperCase(),
  name: z.string().min(1).max(100).trim(),
  aisle: z.string().max(50).trim().optional(),
})

export const updateRackSchema = createRackSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })

export const createShelfSchema = z.object({
  rackId: z.string().min(1),
  code: z.string().min(1).max(20).trim().toUpperCase(),
  level: z.coerce.number().int().positive(),
  description: z.string().max(200).trim().optional(),
})

export const updateShelfSchema = createShelfSchema
  .partial()
  .omit({ rackId: true })
  .extend({ isActive: z.boolean().optional() })

export const listRacksQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().trim().optional(),
  includeInactive: z.coerce.boolean().default(false),
})

export type CreateRackInput = z.infer<typeof createRackSchema>
export type UpdateRackInput = z.infer<typeof updateRackSchema>
export type CreateShelfInput = z.infer<typeof createShelfSchema>
export type UpdateShelfInput = z.infer<typeof updateShelfSchema>
export type ListRacksQuery = z.infer<typeof listRacksQuerySchema>
