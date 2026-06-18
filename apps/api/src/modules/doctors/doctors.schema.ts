import { z } from "zod";

export const createDoctorSchema = z.object({
  name:           z.string().min(1).max(200),
  registrationNo: z.string().max(50).optional(),
  specialty:      z.string().max(100).optional(),
  clinic:         z.string().max(200).optional(),
  phone:          z.string().max(20).optional(),
  email:          z.string().email().max(200).optional().or(z.literal("")),
  address:        z.string().max(500).optional(),
});

export const updateDoctorSchema = createDoctorSchema.partial();

export const listDoctorsQuerySchema = z.object({
  search:   z.string().optional(),
  isActive: z.coerce.boolean().default(true),
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type ListDoctorsQuery  = z.infer<typeof listDoctorsQuerySchema>;
