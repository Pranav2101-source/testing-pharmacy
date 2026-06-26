import { z } from "zod";

export const TICKET_STATUSES = [
  "OPEN", "ASSIGNED", "IN_PROGRESS", "PENDING_USER", "RESOLVED", "CLOSED",
] as const;

export const TICKET_LANGUAGES = ["HINDI", "ENGLISH"] as const;

export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const TICKET_SLAS = ["SLA_4H", "SLA_8H", "SLA_24H", "SLA_48H", "SLA_72H", "SLA_3D"] as const;

// ── Ticket creation (pharmacy user & admin) ──────────────────────────────────

export const createTicketSchema = z.object({
  categoryId:  z.string().min(1, "Category required"),
  customTitle: z.string().max(200).optional(),
  language:    z.enum(TICKET_LANGUAGES).default("ENGLISH"),
  priority:    z.enum(TICKET_PRIORITIES).default("MEDIUM"),
  sla:         z.enum(TICKET_SLAS).optional(),
  dueDate:     z.string().datetime().optional(),
  pharmacyId:  z.string().uuid().optional(),
  assignmentType: z.enum(["UNASSIGNED", "ROUND_ROBIN", "MANUAL"]).optional(),
  agentId:     z.string().uuid().optional().nullable(),
  description: z.string().min(10, "Description must be at least 10 characters").max(2000),
  mobile:      z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number").optional().or(z.literal("")),
  altMobile:   z.string().regex(/^[6-9]\d{9}$/).optional().or(z.literal("")),
});

// ── Status update (agent / admin) ─────────────────────────────────────────────

export const updateStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});

// ── Add message ───────────────────────────────────────────────────────────────

export const addMessageSchema = z.object({
  message: z.string().min(1, "Message required").max(5000),
});

// ── List tickets query ────────────────────────────────────────────────────────

export const listTicketsQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  limit:       z.coerce.number().int().positive().max(50).default(20),
  status:      z.enum(TICKET_STATUSES).optional(),
  search:      z.string().max(100).optional(),
  raisedById:  z.string().optional(),
});

// ── Create agent (platform admin) ─────────────────────────────────────────────

export const createAgentSchema = z.object({
  name:     z.string().min(1).max(200),
  email:    z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ── Assign ticket to agent (platform admin) ───────────────────────────────────

export const assignTicketSchema = z.object({
  agentId: z.string().nullable(),
});

export type CreateTicketInput  = z.infer<typeof createTicketSchema>;
export type UpdateStatusInput  = z.infer<typeof updateStatusSchema>;
export type AddMessageInput    = z.infer<typeof addMessageSchema>;
export type ListTicketsQuery   = z.infer<typeof listTicketsQuerySchema>;
export type CreateAgentInput   = z.infer<typeof createAgentSchema>;
export type AssignTicketInput  = z.infer<typeof assignTicketSchema>;
