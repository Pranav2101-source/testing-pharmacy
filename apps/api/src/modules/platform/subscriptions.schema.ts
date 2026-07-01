import { z } from "zod";

// ── List Subscriptions ───────────────────────────────────────────────────────

export const listSubscriptionsQuerySchema = z.object({
  search: z.string().optional(),
  plan: z.string().optional(),
  status: z.enum(["ALL", "ACTIVE", "TRIAL", "PAUSED", "EXPIRED", "CANCELLED"]).optional().default("ALL"),
  billingCycle: z.enum(["ALL", "MONTHLY", "YEARLY", "QUARTERLY"]).optional().default("ALL"),
  renewalWindow: z.enum(["ALL", "7_DAYS", "30_DAYS", "90_DAYS", "OVERDUE"]).optional().default("ALL"),
  paymentStatus: z.enum(["ALL", "PAID", "PENDING", "OVERDUE"]).optional().default("ALL"),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  sortBy: z.enum(["name", "planName", "amount", "validUntil", "createdAt"]).optional().default("createdAt"),
  sortDesc: z.coerce.boolean().optional().default(true),
});

// ── Get Subscription ─────────────────────────────────────────────────────────

export const getSubscriptionParamsSchema = z.object({
  id: z.string(),
});

// ── Change Plan ──────────────────────────────────────────────────────────────

export const changePlanSchema = z.object({
  planName: z.enum(["Free", "Standard", "Professional", "Enterprise"]),
  billingCycle: z.enum(["MONTHLY", "YEARLY", "QUARTERLY"]).optional(),
  amount: z.number().min(0).optional(),
});

// ── Bulk Action ──────────────────────────────────────────────────────────────

export const bulkSubscriptionActionSchema = z.object({
  ids: z.array(z.string()).min(1, "Select at least one subscription"),
  action: z.enum([
    "UPGRADE", "DOWNGRADE", "RENEW", "PAUSE", "RESUME",
    "SUSPEND", "EXPORT", "EMAIL_REMINDER", "GENERATE_INVOICE", "ASSIGN_PLAN",
  ]),
  planName: z.enum(["Free", "Standard", "Professional", "Enterprise"]).optional(),
});

// ── Export ────────────────────────────────────────────────────────────────────

export const exportSubscriptionsQuerySchema = z.object({
  search: z.string().optional(),
  plan: z.string().optional(),
  status: z.enum(["ALL", "ACTIVE", "TRIAL", "PAUSED", "EXPIRED", "CANCELLED"]).optional().default("ALL"),
  scope: z.enum(["all", "filtered"]).optional().default("filtered"),
});
