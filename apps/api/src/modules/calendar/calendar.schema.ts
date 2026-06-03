import { z } from "zod";

export const EVENT_TYPES = [
  "EXPIRY_ALERT",
  "CREDIT_DUE",
  "PO_DELIVERY",
  "BILL_REMINDER",
  "STOCK_AUDIT",
  "LICENSE_RENEWAL",
  "CUSTOM",
] as const;

export type CalendarEventType = (typeof EVENT_TYPES)[number];

// ── Manual event creation ─────────────────────────────────────────────────────
export const CreateCalendarEventSchema = z.object({
  title:       z.string().min(1, "Title required").max(200),
  description: z.string().max(500).optional(),
  date:        z.string().datetime({ message: "Invalid date" }),
  endDate:     z.string().datetime().optional(),
  allDay:      z.boolean().default(true),
  type:        z.enum(EVENT_TYPES).default("CUSTOM"),
  color:       z.string().max(20).optional(),
  relatedId:   z.string().optional(),
  relatedType: z.string().optional(),
});

export const UpdateCalendarEventSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  date:        z.string().datetime().optional(),
  endDate:     z.string().datetime().optional(),
  allDay:      z.boolean().optional(),
  isDone:      z.boolean().optional(),
  color:       z.string().max(20).optional(),
});

export const CalendarQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to:   z.string().datetime().optional(),
});

export const EVENT_TYPE_LABELS: Record<string, string> = {
  EXPIRY_ALERT:    "Expiry Alert",
  CREDIT_DUE:      "Credit Due",
  PO_DELIVERY:     "PO Delivery",
  BILL_REMINDER:   "Bill Reminder",
  STOCK_AUDIT:     "Stock Audit",
  LICENSE_RENEWAL: "License Renewal",
  CUSTOM:          "Event",
};

export type CreateCalendarEventInput = z.infer<typeof CreateCalendarEventSchema>;
export type UpdateCalendarEventInput = z.infer<typeof UpdateCalendarEventSchema>;
export type CalendarQuery            = z.infer<typeof CalendarQuerySchema>;

// ── Unified DTO — returned for both manual and auto-derived events ─────────────
export type CalendarEventDTO = {
  id:           string;
  title:        string;
  description:  string | null;
  date:         string;           // ISO string
  endDate:      string | null;
  allDay:       boolean;
  type:         CalendarEventType;
  color:        string | null;
  relatedId:    string | null;
  relatedType:  string | null;
  isDone:       boolean;
  isAutomatic:  boolean;          // true = derived from inventory/invoice/PO
  createdAt:    string | null;
};
