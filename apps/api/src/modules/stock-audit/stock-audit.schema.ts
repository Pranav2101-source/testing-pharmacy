import { z } from "zod"

export const createSessionSchema = z.object({
  notes: z.string().max(500).trim().optional(),
})

export const updateItemSchema = z
  .object({
    countedQty: z.number().int().min(0).optional(),
    notes:      z.string().max(500).trim().nullable().optional(),
  })
  .refine((d) => d.countedQty !== undefined || (d.notes !== undefined && d.notes !== null), {
    message: "At least one of countedQty or notes is required",
  })

export const completeSessionSchema = z.object({
  notes: z.string().max(500).trim().optional(),
})

export const approveSessionSchema = z.object({
  notes: z.string().max(500).trim().optional(),
})

export const batchUpdateItemsSchema = z.object({
  items: z.array(
    z.object({
      itemId:     z.string().min(1),
      countedQty: z.number().int().min(0),
    }),
  ).min(1).max(500),
})

export const listSessionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  status: z
    .enum(["DRAFT", "IN_PROGRESS", "COMPLETED", "APPROVED", "CANCELLED"])
    .optional(),
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>
export type BatchUpdateItemsInput = z.infer<typeof batchUpdateItemsSchema>
export type CompleteSessionInput = z.infer<typeof completeSessionSchema>
export type ApproveSessionInput = z.infer<typeof approveSessionSchema>
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>
