import { z } from "zod";

const PRESCRIPTION_STATUSES = ["ACTIVE", "PARTIAL", "DISPENSED", "EXPIRED", "CANCELLED"] as const;

export const createPrescriptionSchema = z.object({
  doctorId:      z.string().optional(),
  doctorName:    z.string().min(1).max(200),
  doctorRegNo:   z.string().max(50).optional(),
  doctorPhone:   z.string().max(20).optional(),
  patientName:   z.string().min(1).max(200),
  patientAge:    z.coerce.number().int().min(0).max(150).optional(),
  patientPhone:  z.string().max(20).optional(),
  patientGender: z.enum(["M", "F", "Other"]).optional(),
  uploadId:      z.string().optional(),
  prescribedDate: z.string().datetime({ offset: true }).optional(),
  validUntil:    z.string().datetime({ offset: true }).optional(),
  notes:         z.string().max(500).optional(),
  items: z.array(z.object({
    medicineName: z.string().min(1).max(200),
    medicineId:   z.string().optional(),
    schedule:     z.enum(["H", "H1", "X", "G", "OTC"]).optional(),
    quantity:     z.coerce.number().int().positive(),
    dosage:       z.string().max(100).optional(),
    duration:     z.string().max(100).optional(),
    notes:        z.string().max(200).optional(),
  })).min(1),
});

export const listPrescriptionsQuerySchema = z.object({
  page:      z.coerce.number().int().positive().default(1),
  limit:     z.coerce.number().int().positive().max(100).default(20),
  status:    z.enum(PRESCRIPTION_STATUSES).optional(),
  doctorId:  z.string().optional(),
  search:    z.string().max(100).optional(),
  from:      z.string().datetime({ offset: true }).optional(),
  to:        z.string().datetime({ offset: true }).optional(),
});

export const updatePrescriptionSchema = z.object({
  doctorId:       z.string().optional(),
  doctorName:     z.string().min(1).max(200).optional(),
  doctorRegNo:    z.string().max(50).optional(),
  patientName:    z.string().min(1).max(200).optional(),
  patientAge:     z.coerce.number().int().min(0).max(150).optional(),
  patientPhone:   z.string().max(20).optional(),
  patientGender:  z.enum(["M", "F", "Other"]).optional(),
  prescribedDate: z.string().datetime({ offset: true }).optional(),
  validUntil:     z.string().datetime({ offset: true }).optional(),
  notes:          z.string().max(500).optional(),
  items: z.array(z.object({
    medicineName: z.string().min(1).max(200),
    medicineId:   z.string().optional(),
    schedule:     z.enum(["H", "H1", "X", "G", "OTC"]).optional(),
    quantity:     z.coerce.number().int().positive(),
    dosage:       z.string().max(100).optional(),
    duration:     z.string().max(100).optional(),
    notes:        z.string().max(200).optional(),
  })).min(1).optional(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type UpdatePrescriptionInput = z.infer<typeof updatePrescriptionSchema>;
export type ListPrescriptionsQuery  = z.infer<typeof listPrescriptionsQuerySchema>;
