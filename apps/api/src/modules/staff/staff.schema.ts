import { z } from "zod";

export const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^[6-9]\d{9}$/).optional(),
  password: z.string().min(8),
  role: z.enum(["OWNER", "PHARMACIST"]).default("PHARMACIST"),
});

export const updateStaffSchema = createStaffSchema.omit({ password: true, email: true }).partial();

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
