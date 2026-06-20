import { z } from "zod";

export const createSessionSchema = z.object({
  sourceSoftware: z.string().max(100).optional(),
  notes:          z.string().max(500).optional(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const detectColumnsSchema = z.object({
  headers: z.array(z.string().max(100)).min(1).max(100),
});
export type DetectColumnsInput = z.infer<typeof detectColumnsSchema>;

export const saveColumnMappingsSchema = z.object({
  mappings: z.record(z.string(), z.string()),
});
export type SaveColumnMappingsInput = z.infer<typeof saveColumnMappingsSchema>;

export const confirmMedicineMappingsSchema = z.object({
  mappings: z.array(
    z.object({
      csvValue:   z.string().min(1),
      medicineId: z.string().min(1).optional(), // DB FK constraint enforces validity; cuid() rejects CUID v2
      isNew:      z.boolean(),
    }),
  ).min(1),
});
export type ConfirmMedicineMappingsInput = z.infer<typeof confirmMedicineMappingsSchema>;

export const previewInventorySchema = z.object({
  csvText:        z.string().min(1),
  columnMappings: z.record(z.string(), z.string()),
});
export type PreviewInventoryInput = z.infer<typeof previewInventorySchema>;

export const commitInventorySchema = z.object({
  csvText:        z.string().min(1),
  columnMappings: z.record(z.string(), z.string()),
});
export type CommitInventoryInput = z.infer<typeof commitInventorySchema>;

export const commitSuppliersSchema = z.object({
  csvText:        z.string().min(1),
  columnMappings: z.record(z.string(), z.string()),
});
export type CommitSuppliersInput = z.infer<typeof commitSuppliersSchema>;

export const commitCustomersSchema = z.object({
  csvText:        z.string().min(1),
  columnMappings: z.record(z.string(), z.string()),
});
export type CommitCustomersInput = z.infer<typeof commitCustomersSchema>;

export const commitDoctorsSchema = z.object({
  csvText:        z.string().min(1),
  columnMappings: z.record(z.string(), z.string()),
});
export type CommitDoctorsInput = z.infer<typeof commitDoctorsSchema>;
