import type { PrismaClient, Prisma } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class SupplierCreditNotesRepo {
  constructor(private db: PrismaClient) {}

  private async nextCNNumber(pharmacyId: string, tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">): Promise<string> {
    const count = await tx.supplierCreditNote.count({ where: { pharmacyId } });
    const year  = new Date().getFullYear();
    return `SCN-${year}-${String(count + 1).padStart(5, "0")}`;
  }

  async create(pharmacyId: string, userId: string, data: {
    supplierId:       string;
    supplierReturnId?: string;
    amount:           number;
    notes?:           string;
    issuedAt?:        Date;
  }) {
    return this.db.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: data.supplierId, pharmacyId }, select: { id: true } });
      if (!supplier) throw AppError.notFound("Supplier not found");

      if (data.supplierReturnId) {
        const ret = await tx.supplierReturn.findFirst({
          where:  { id: data.supplierReturnId, pharmacyId, supplierId: data.supplierId, status: "CONFIRMED" },
          select: { id: true },
        });
        if (!ret) throw AppError.notFound("Confirmed supplier return not found for this supplier");
      }

      const creditNoteNumber = await this.nextCNNumber(pharmacyId, tx);

      const cn = await tx.supplierCreditNote.create({
        data: {
          pharmacyId,
          supplierId:       data.supplierId,
          supplierReturnId: data.supplierReturnId,
          creditNoteNumber,
          amount:           data.amount,
          status:           "PENDING",
          notes:            data.notes,
          issuedAt:         data.issuedAt ?? new Date(),
          createdBy:        userId,
        },
        include: {
          supplier:       { select: { id: true, name: true } },
          supplierReturn: { select: { id: true, returnNumber: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          pharmacyId, userId,
          action:   "CREATE",
          entity:   "SupplierCreditNote",
          entityId: cn.id,
          newData:  cn as unknown as Prisma.InputJsonValue,
        },
      });

      return cn;
    });
  }

  async updateStatus(id: string, pharmacyId: string, userId: string, status: "APPLIED" | "CANCELLED", notes?: string) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.supplierCreditNote.findFirst({
        where:  { id, pharmacyId },
        select: { status: true, creditNoteNumber: true },
      });
      if (!existing) throw AppError.notFound("Credit note not found");
      if (existing.status !== "PENDING") {
        throw AppError.unprocessable(`Credit note is already ${existing.status}`);
      }

      const updated = await tx.supplierCreditNote.update({
        where: { id },
        data:  { status, notes: notes ?? undefined },
        include: {
          supplier:       { select: { id: true, name: true } },
          supplierReturn: { select: { id: true, returnNumber: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          pharmacyId, userId,
          action:   "STATUS_CHANGE",
          entity:   "SupplierCreditNote",
          entityId: id,
          newData:  { status } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.supplierCreditNote.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier:       { select: { id: true, name: true, phone: true } },
        supplierReturn: { select: { id: true, returnNumber: true, totalAmount: true } },
      },
    });
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    supplierId?: string;
    status?:     string;
    from?:       Date;
    to?:         Date;
  }) {
    const where: Prisma.SupplierCreditNoteWhereInput = {
      pharmacyId,
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.status     ? { status: params.status as any } : {}),
      ...(params.from || params.to
        ? { issuedAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.supplierCreditNote.findMany({
        where,
        orderBy: { issuedAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
        },
      }),
      this.db.supplierCreditNote.count({ where }),
    ]);

    // Compute supplier-level pending credit balance
    const pendingBalance = await this.db.supplierCreditNote.aggregate({
      where: { pharmacyId, status: "PENDING" },
      _sum:  { amount: true },
    });

    return { items, total, page: params.page, limit: params.limit, totalPendingCredit: pendingBalance._sum.amount ?? 0 };
  }
}
