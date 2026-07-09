import { z } from "zod";

export const listTenantsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED", "PENDING", "TRIAL", "EXPIRED"]).optional().default("ALL"),
  plan: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  sortBy: z.enum(["name", "createdAt", "doctors", "patients"]).optional().default("createdAt"),
  sortDesc: z.coerce.boolean().optional().default(true),
});

export const getTenantParamsSchema = z.object({
  id: z.string(),
});

// ── Create Tenant ────────────────────────────────────────────────────────────

export const createTenantSchema = z.object({
  // Pharmacy Info
  name: z.string().min(2, "Pharmacy name is required"),
  gstin: z.string().optional(),
  drugLicense: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid pharmacy email").optional(),

  // Owner Info
  ownerName: z.string().min(2, "Owner name is required"),
  ownerEmail: z.string().email("Invalid owner email"),
  ownerPhone: z.string().optional(),

  // Subscription
  planName: z.enum(["Free", "Standard", "Professional"]).default("Free"),

  // Settings
  doctorLimit: z.coerce.number().min(0).default(5),
  staffLimit: z.coerce.number().min(0).default(5),
  patientLimit: z.coerce.number().min(0).default(500),
  storageLimit: z.coerce.number().min(0).default(1024),
  enableBilling: z.boolean().default(true),
  enableInventory: z.boolean().default(true),
  enableEmr: z.boolean().default(false),
  enableCrm: z.boolean().default(false),
  enableWhatsapp: z.boolean().default(false),
  enableSms: z.boolean().default(false),
  enableApiAccess: z.boolean().default(false),
  enableOnlineBooking: z.boolean().default(false),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

// ── Update Tenant Status ─────────────────────────────────────────────────────

export const updateTenantStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED", "TRIAL", "EXPIRED"]),
});

// ── Bulk Action ──────────────────────────────────────────────────────────────

export const bulkActionSchema = z.object({
  ids: z.array(z.string()).min(1, "Select at least one tenant"),
  action: z.enum(["SUSPEND", "ACTIVATE", "ARCHIVE"]),
});

// ── Import ───────────────────────────────────────────────────────────────────

export const importRowSchema = z.object({
  name: z.string().min(1),
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPhone: z.string().optional(),
  gstin: z.string().optional(),
  drugLicense: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  planName: z.enum(["Free", "Standard", "Professional"]).optional().default("Free"),
});

export const importTenantsSchema = z.object({
  rows: z.array(importRowSchema),
});

// ── Export ────────────────────────────────────────────────────────────────────

export const exportTenantsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED", "PENDING", "TRIAL", "EXPIRED"]).optional().default("ALL"),
  plan: z.string().optional(),
  state: z.string().optional(),
  scope: z.enum(["all", "filtered"]).optional().default("filtered"),
  ids: z.string().optional(),
});
