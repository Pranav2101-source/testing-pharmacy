import type { Db, Prisma, TicketStatus } from "@pharmacy/database";

export class SupportRepo {
  constructor(private db: Db) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories() {
    return this.db.ticketCategory.findMany({
      where:   { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  // ── Ticket number ─────────────────────────────────────────────────────────

  async nextTicketNumber(): Promise<string> {
    const count = await this.db.supportTicket.count();
    return `TKT-${String(count + 1).padStart(5, "0")}`;
  }

  // ── Round-robin agent selection ───────────────────────────────────────────
  // Returns the active agent who was assigned least recently.

  async pickNextAgent() {
    return this.db.supportAgent.findFirst({
      where:   { isActive: true },
      orderBy: [{ lastAssignedAt: { sort: "asc", nulls: "first" } }],
      include: { user: { select: { id: true, pharmacyId: true } } },
    });
  }

  async markAgentAssigned(agentId: string) {
    return this.db.supportAgent.update({
      where: { id: agentId },
      data:  { lastAssignedAt: new Date() },
    });
  }

  // ── Tickets ───────────────────────────────────────────────────────────────

  async create(data: {
    ticketNumber:    string;
    pharmacyId:      string;
    raisedById:      string;
    categoryId:      string;
    customTitle?:    string;
    assignedAgentId?: string;
    status:          TicketStatus;
    language:        "HINDI" | "ENGLISH";
    description:     string;
    mobile:          string;
    altMobile?:      string;
  }) {
    return this.db.supportTicket.create({
      data,
      include: ticketIncludes,
    });
  }

  async listForPharmacy(pharmacyId: string, params: {
    page:         number;
    limit:        number;
    status?:      TicketStatus;
    search?:      string;
    raisedById?:  string;
  }) {
    const where = buildWhere({ pharmacyId, ...params });
    return paginate(this.db, where, params);
  }

  async listAll(params: {
    page:        number;
    limit:       number;
    status?:     TicketStatus;
    search?:     string;
    raisedById?: string;
  }) {
    const where = buildWhere(params);
    return paginate(this.db, where, params);
  }

  async listForAgent(agentId: string, params: {
    page:    number;
    limit:   number;
    status?: TicketStatus;
    search?: string;
  }) {
    const where = buildWhere({ assignedAgentId: agentId, ...params });
    return paginate(this.db, where, params);
  }

  async getById(id: string) {
    return this.db.supportTicket.findUnique({
      where:   { id },
      include: {
        ...ticketIncludes,
        attachments: true,
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            sender:      { select: { id: true, name: true, role: true } },
            attachments: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: TicketStatus) {
    return this.db.supportTicket.update({
      where: { id },
      data:  {
        status,
        ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
      },
    });
  }

  async addMessage(ticketId: string, pharmacyId: string, senderId: string, message: string) {
    return this.db.ticketMessage.create({
      data:    { ticketId, pharmacyId, senderId, message },
      include: {
        sender:      { select: { id: true, name: true, role: true } },
        attachments: true,
      },
    });
  }

  async addAttachment(data: {
    ticketId:   string;
    pharmacyId: string;
    messageId?: string;
    fileName:   string;
    fileUrl:    string;
    fileSize:   number;
    mimeType:   string;
    fileType:   "IMAGE" | "VIDEO" | "DOCUMENT";
  }) {
    return this.db.ticketAttachment.create({ data });
  }

  // ── Agents ────────────────────────────────────────────────────────────────

  async listAgents() {
    return this.db.supportAgent.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
        _count: { select: { tickets: true } },
      },
    });
  }

  async getAgentByUserId(userId: string) {
    return this.db.supportAgent.findUnique({ where: { userId } });
  }

  async createAgentUser(data: {
    name:         string;
    email:        string;
    passwordHash: string;
    pharmacyId:   string;
  }) {
    return this.db.user.create({
      data: { ...data, role: "SUPPORT_AGENT" },
    });
  }

  async createAgent(userId: string) {
    return this.db.supportAgent.create({
      data:    { userId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  async toggleAgent(agentId: string, isActive: boolean) {
    return this.db.supportAgent.update({
      where: { id: agentId },
      data:  { isActive },
    });
  }

  async assign(ticketId: string, agentId: string | null) {
    return this.db.supportTicket.update({
      where: { id: ticketId },
      data:  {
        assignedAgentId: agentId,
        status:          agentId ? "ASSIGNED" : "OPEN",
      },
      include: ticketIncludes,
    });
  }

  // ── Stats (admin dashboard) ───────────────────────────────────────────────

  async stats() {
    const [total, open, inProgress, resolved] = await Promise.all([
      this.db.supportTicket.count(),
      this.db.supportTicket.count({ where: { status: { in: ["OPEN", "ASSIGNED"] } } }),
      this.db.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
      this.db.supportTicket.count({ where: { status: "RESOLVED" } }),
    ]);
    return { total, open, inProgress, resolved };
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const ticketIncludes = {
  category:      { select: { id: true, name: true } },
  raisedBy:      { select: { id: true, name: true, role: true, email: true, phone: true } },
  assignedAgent: { include: { user: { select: { id: true, name: true } } } },
  pharmacy:      { select: { id: true, name: true, phone: true, email: true, address: true, city: true, state: true, gstin: true, drugLicense: true } },
} satisfies Prisma.SupportTicketInclude;

function buildWhere(params: {
  pharmacyId?:      string;
  assignedAgentId?: string;
  raisedById?:      string;
  status?:          TicketStatus;
  search?:          string;
}): Prisma.SupportTicketWhereInput {
  return {
    ...(params.pharmacyId      ? { pharmacyId: params.pharmacyId }           : {}),
    ...(params.assignedAgentId ? { assignedAgentId: params.assignedAgentId } : {}),
    ...(params.raisedById      ? { raisedById:      params.raisedById }      : {}),
    ...(params.status          ? { status: params.status }                   : {}),
    ...(params.search
      ? {
          OR: [
            { ticketNumber: { contains: params.search, mode: "insensitive" } },
            { description:  { contains: params.search, mode: "insensitive" } },
            { mobile:       { contains: params.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

async function paginate(
  db:     Db,
  where:  Prisma.SupportTicketWhereInput,
  params: { page: number; limit: number },
) {
  const [items, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (params.page - 1) * params.limit,
      take:    params.limit,
      include: ticketIncludes,
    }),
    db.supportTicket.count({ where }),
  ]);
  return {
    items,
    total,
    page:       params.page,
    limit:      params.limit,
    totalPages: Math.ceil(total / params.limit),
  };
}
