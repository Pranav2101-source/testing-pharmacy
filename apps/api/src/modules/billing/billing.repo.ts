import type { PrismaClient, Prisma } from "@pharmacy/database";

export class BillingRepo {
  constructor(private db: PrismaClient) {}

  async getInventoryBatch(inventoryId: string, tenantId: string) {
    return this.db.inventory.findFirst({
      where: { id: inventoryId, tenantId },
      include: { medicine: true },
    });
  }

  async createInvoice(data: Prisma.InvoiceCreateInput) {
    return this.db.invoice.create({
      data,
      include: {
        items: true,
        customer: true,
        user: { select: { name: true } },
      },
    });
  }

  async decrementStock(inventoryId: string, quantity: number) {
    return this.db.inventory.update({
      where: { id: inventoryId },
      data: { quantity: { decrement: quantity } },
    });
  }

  async incrementStock(inventoryId: string, quantity: number) {
    return this.db.inventory.update({
      where: { id: inventoryId },
      data: { quantity: { increment: quantity } },
    });
  }

  async getInvoice(id: string, tenantId: string) {
    return this.db.invoice.findFirst({
      where: { id, tenantId },
      include: {
        items: true,
        customer: true,
        user: { select: { name: true } },
      },
    });
  }

  async listInvoices(
    tenantId: string,
    params: { page: number; limit: number; search?: string; from?: Date; to?: Date }
  ) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      isCancelled: false,
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { invoiceNumber: { contains: params.search, mode: "insensitive" } },
              { customer: { name: { contains: params.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { customer: { select: { name: true, phone: true } } },
      }),
      this.db.invoice.count({ where }),
    ]);

    return { items, total };
  }

  async cancelInvoice(id: string, tenantId: string, reason: string) {
    return this.db.invoice.update({
      where: { id },
      data: {
        isCancelled: true,
        cancelledAt: new Date(),
        cancelReason: reason,
      },
    });
  }

  async getNextSequence(tenantId: string): Promise<number> {
    const result = await this.db.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval(pg_get_serial_sequence('invoices', 'id'))
    `;
    // Use Redis for sequence — handled in service
    return 1;
  }

  async getSettings(tenantId: string) {
    return this.db.invoiceSettings.findUnique({ where: { tenantId } });
  }
}
