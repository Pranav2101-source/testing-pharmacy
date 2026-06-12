import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { SupportRepo } from "./support.repo.js";
import { AppError } from "../../lib/AppError.js";
import { inAppNotify } from "../../lib/notifications.js";
import { PLATFORM_PHARMACY_ID } from "../../config/constants.js";
import type {
  CreateTicketInput,
  UpdateStatusInput,
  AddMessageInput,
  ListTicketsQuery,
  CreateAgentInput,
  AssignTicketInput,
} from "./support.schema.js";

const SUPPORT_ROLES = ["SUPPORT_AGENT", "PLATFORM_ADMIN"] as const;

export class SupportService {
  private repo: SupportRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new SupportRepo(app.prisma);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories() {
    return this.repo.listCategories();
  }

  // ── Tickets ───────────────────────────────────────────────────────────────

  async createTicket(pharmacyId: string, raisedById: string, input: CreateTicketInput) {
    const ticketNumber = await this.repo.nextTicketNumber();

    // Round-robin assignment
    const agent = await this.repo.pickNextAgent();
    const assignedAgentId = agent?.id ?? undefined;
    const status = agent ? "ASSIGNED" : "OPEN";

    if (agent) await this.repo.markAgentAssigned(agent.id);

    const ticket = await this.repo.create({
      ticketNumber,
      pharmacyId,
      raisedById,
      categoryId:      input.categoryId,
      customTitle:     input.customTitle || undefined,
      assignedAgentId,
      status:          status as any,
      language:        input.language,
      description:     input.description,
      mobile:          input.mobile,
      altMobile:       input.altMobile || undefined,
    });

    // Notify support team
    await inAppNotify(this.app.prisma, PLATFORM_PHARMACY_ID, {
      subject: `New Ticket ${ticketNumber}`,
      message: `New support ticket raised: ${input.description.slice(0, 100)}`,
    });

    return ticket;
  }

  async listTickets(userId: string, role: string, query: ListTicketsQuery) {
    const params = {
      page:   Math.max(1, query.page),
      limit:  Math.min(50, query.limit),
      status: query.status,
      search: query.search?.trim() || undefined,
    };

    if (SUPPORT_ROLES.includes(role as any)) {
      return this.repo.listAll(params);
    }

    // Pharmacy user: only their pharmacy's tickets
    const user = await this.app.prisma.user.findUnique({
      where:  { id: userId },
      select: { pharmacyId: true },
    });
    if (!user) throw AppError.notFound("User not found");

    return this.repo.listForPharmacy(user.pharmacyId, params);
  }

  async getTicket(id: string, userId: string, role: string) {
    const ticket = await this.repo.getById(id);
    if (!ticket) throw AppError.notFound("Ticket not found");

    // Pharmacy users can only view their own pharmacy's tickets
    if (!SUPPORT_ROLES.includes(role as any)) {
      const user = await this.app.prisma.user.findUnique({
        where:  { id: userId },
        select: { pharmacyId: true },
      });
      if (!user || user.pharmacyId !== ticket.pharmacyId) {
        throw AppError.forbidden("Access denied");
      }
    }

    return ticket;
  }

  async updateStatus(ticketId: string, userId: string, role: string, input: UpdateStatusInput) {
    if (!SUPPORT_ROLES.includes(role as any)) {
      throw AppError.forbidden("Only support agents can update ticket status");
    }

    const ticket = await this.repo.getById(ticketId);
    if (!ticket) throw AppError.notFound("Ticket not found");

    const updated = await this.repo.updateStatus(ticketId, input.status as any);

    // Notify the pharmacy that raised this ticket
    await inAppNotify(this.app.prisma, ticket.pharmacyId, {
      subject: `Ticket ${ticket.ticketNumber} Updated`,
      message: `Your ticket status changed to: ${input.status.replace(/_/g, " ")}`,
    });

    return updated;
  }

  async addMessage(ticketId: string, senderId: string, role: string, input: AddMessageInput) {
    const ticket = await this.repo.getById(ticketId);
    if (!ticket) throw AppError.notFound("Ticket not found");

    // Pharmacy users can only message on their own tickets
    if (!SUPPORT_ROLES.includes(role as any)) {
      const user = await this.app.prisma.user.findUnique({
        where:  { id: senderId },
        select: { pharmacyId: true },
      });
      if (!user || user.pharmacyId !== ticket.pharmacyId) {
        throw AppError.forbidden("Access denied");
      }
    }

    const message = await this.repo.addMessage(ticketId, senderId, input.message);

    // Notify the other party
    if (SUPPORT_ROLES.includes(role as any)) {
      // Agent replied — notify pharmacy
      await inAppNotify(this.app.prisma, ticket.pharmacyId, {
        subject: `Reply on Ticket ${ticket.ticketNumber}`,
        message: `Support team replied to your ticket.`,
      });
    } else {
      // Pharmacy user replied — notify support team
      await inAppNotify(this.app.prisma, PLATFORM_PHARMACY_ID, {
        subject: `User replied on ${ticket.ticketNumber}`,
        message: `User replied: ${input.message.slice(0, 100)}`,
      });
    }

    // Auto-advance ticket status based on who replied
    if (SUPPORT_ROLES.includes(role as any)) {
      // Support staff replied — move any non-active-work state to IN_PROGRESS
      if (ticket.status === "OPEN" || ticket.status === "ASSIGNED" || ticket.status === "PENDING_USER") {
        await this.repo.updateStatus(ticketId, "IN_PROGRESS");
      }
    } else {
      // Pharmacy user replied — if we were waiting on them, resume IN_PROGRESS
      if (ticket.status === "PENDING_USER") {
        await this.repo.updateStatus(ticketId, "IN_PROGRESS");
      }
    }

    return message;
  }

  async addAttachment(
    ticketId: string,
    userId:   string,
    role:     string,
    data: {
      fileName: string;
      fileUrl:  string;
      fileSize: number;
      mimeType: string;
      fileType: "IMAGE" | "VIDEO" | "DOCUMENT";
      messageId?: string;
    },
  ) {
    const ticket = await this.repo.getById(ticketId);
    if (!ticket) throw AppError.notFound("Ticket not found");

    if (!SUPPORT_ROLES.includes(role as any)) {
      const user = await this.app.prisma.user.findUnique({
        where:  { id: userId },
        select: { pharmacyId: true },
      });
      if (!user || user.pharmacyId !== ticket.pharmacyId) {
        throw AppError.forbidden("Access denied");
      }
    }

    return this.repo.addAttachment({ ticketId, ...data });
  }

  /**
   * Resolve a stored attachment by its on-disk filename and verify the
   * requesting user may access it: support staff see everything; pharmacy
   * users only attachments belonging to their own pharmacy's tickets.
   * Serving files by filename alone would let any authenticated user from any
   * pharmacy fetch another tenant's screenshots/recordings (potential PHI).
   */
  async getAttachmentForUser(storedFilename: string, userId: string, role: string) {
    const attachment = await this.app.prisma.ticketAttachment.findFirst({
      where:   { fileUrl: `/api/support/attachments/${storedFilename}` },
      include: { ticket: { select: { pharmacyId: true } } },
    });
    if (!attachment) throw AppError.notFound("Attachment not found");

    if (!SUPPORT_ROLES.includes(role as any)) {
      const user = await this.app.prisma.user.findUnique({
        where:  { id: userId },
        select: { pharmacyId: true },
      });
      if (!user || user.pharmacyId !== attachment.ticket.pharmacyId) {
        throw AppError.forbidden("Access denied");
      }
    }

    return attachment;
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  async listAgents() {
    return this.repo.listAgents();
  }

  async createAgent(input: CreateAgentInput) {
    const existing = await this.app.prisma.user.findFirst({
      where: { email: input.email },
    });
    if (existing) throw AppError.conflict("A user with this email already exists");

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user  = await this.repo.createAgentUser({
      name:       input.name,
      email:      input.email,
      passwordHash,
      pharmacyId: PLATFORM_PHARMACY_ID,
    });

    const agent = await this.repo.createAgent(user.id);
    return agent;
  }

  async assignTicket(ticketId: string, role: string, input: AssignTicketInput) {
    if (!SUPPORT_ROLES.includes(role as any)) throw AppError.forbidden("Not allowed");

    const ticket = await this.repo.getById(ticketId);
    if (!ticket) throw AppError.notFound("Ticket not found");

    if (input.agentId) {
      const agent = await this.app.prisma.supportAgent.findUnique({ where: { id: input.agentId } });
      if (!agent || !agent.isActive) throw AppError.badRequest("Agent not found or inactive");
      await this.repo.markAgentAssigned(input.agentId);
    }

    const updated = await this.repo.assign(ticketId, input.agentId);

    await inAppNotify(this.app.prisma, ticket.pharmacyId, {
      subject: `Ticket ${ticket.ticketNumber} ${input.agentId ? "Assigned" : "Unassigned"}`,
      message: input.agentId
        ? "Your ticket has been assigned to our support team."
        : "Your ticket is awaiting assignment.",
    });

    return updated;
  }

  async toggleAgent(agentId: string, isActive: boolean) {
    const agent = await this.app.prisma.supportAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw AppError.notFound("Agent not found");
    return this.repo.toggleAgent(agentId, isActive);
  }

  async stats() {
    return this.repo.stats();
  }
}
