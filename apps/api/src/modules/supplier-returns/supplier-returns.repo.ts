import type { Db, Prisma } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class SupplierReturnsRepo {
  constructor(private db: Db) {}

  async create(pharmacyId: string, userId: string, data: {
    returnNumber: string;
    supplierId:  string;
    debitNoteNo?: string;
    notes?:      string;
    items: {
      inventoryId:  string;
      medicineId:   string;
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      quantity:     number;
      purchaseRate: number;
      amount:       number;
      reason:       string;
    }[];
    totalAmount: number;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const sr = await tx.supplierReturn.create({
        data: {
          pharmacyId,
          supplierId:  data.supplierId,
          returnNumber: data.returnNumber,
          debitNoteNo: data.debitNoteNo,
          notes:       data.notes,
          status:      "DRAFT",
          totalAmount: data.totalAmount,
          items: {
            create: data.items.map((item) => ({
              pharmacy:     { connect: { id: pharmacyId } },
              inventory:    { connect: { id: item.inventoryId } },
              medicine:     { connect: { id: item.medicineId } },
              medicineName: item.medicineName,
              batchNumber:  item.batchNumber,
              expiryDate:   item.expiryDate,
              quantity:     item.quantity,
              purchaseRate: item.purchaseRate,
              amount:       item.amount,
              reason:       item.reason as any,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items:    { include: { medicine: { select: { name: true } } } },
        },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "CREATE", entity: "SupplierReturn", entityId: sr.id, newData: sr as unknown as Prisma.InputJsonValue },
      });

      return sr;
    });
  }

  async confirm(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
        const sr = await tx.supplierReturn.findFirst({
          where:   { id, pharmacyId },
          include: { items: true },
        });
        if (!sr) throw AppError.notFound("Supplier return not found");
        if (sr.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT supplier returns can be confirmed");

        for (const item of sr.items) {
          const inv = await tx.inventory.findFirst({
            where:  { id: item.inventoryId, pharmacyId },
            select: { quantity: true },
          });
          if (!inv) throw AppError.notFound(`Inventory ${item.inventoryId} not found`);
          if (inv.quantity < item.quantity) {
            throw AppError.unprocessable(
              `Cannot return ${item.quantity} of "${item.medicineName}": only ${inv.quantity} in stock`,
            );
          }

          const quantityBefore = inv.quantity;
          const quantityAfter  = quantityBefore - item.quantity;

          await tx.inventory.update({
            where: { id: item.inventoryId },
            data:  { quantity: { decrement: item.quantity } },
          });

          await tx.inventoryMovement.create({
            data: {
              pharmacyId, userId,
              inventoryId:    item.inventoryId,
              type:           "ADJUSTMENT",
              direction:      "OUT",
              quantity:       item.quantity,
              quantityBefore,
              quantityAfter,
              referenceType:  "SUPPLIER_RETURN",
              referenceId:    sr.id,
              notes:          `Supplier return ${sr.returnNumber} — ${item.reason}`,
            },
          });
        }

        const confirmed = await tx.supplierReturn.update({
          where:   { id },
          data:    { status: "CONFIRMED" },
          include: {
            supplier: { select: { id: true, name: true } },
            items:    { include: { medicine: { select: { name: true } } } },
          },
        });

        await tx.auditLog.create({
          data: { pharmacyId, userId, action: "CONFIRM", entity: "SupplierReturn", entityId: id, newData: { status: "CONFIRMED", returnNumber: sr.returnNumber } as Prisma.InputJsonValue },
        });

        return confirmed;
    }, { isolationLevel: "Serializable", timeout: 15_000 });
  }

  async cancel(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const sr = await tx.supplierReturn.findFirst({ where: { id, pharmacyId }, select: { status: true, returnNumber: true } });
      if (!sr) throw AppError.notFound("Supplier return not found");
      if (sr.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT supplier returns can be cancelled");

      const cancelled = await tx.supplierReturn.update({
        where:   { id },
        data:    { status: "CANCELLED" },
        include: { supplier: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "CANCEL", entity: "SupplierReturn", entityId: id, newData: { status: "CANCELLED" } as Prisma.InputJsonValue },
      });

      return cancelled;
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.supplierReturn.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        items:    { include: { medicine: { select: { name: true, genericName: true, hsnCode: true } } } },
      },
    });
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    status?:     string;
    supplierId?: string;
    from?:       Date;
    to?:         Date;
  }) {
    const where: Prisma.SupplierReturnWhereInput = {
      pharmacyId,
      ...(params.status     ? { status: params.status as any } : {}),
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.supplierReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          _count:   { select: { items: true } },
        },
      }),
      this.db.supplierReturn.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }
}
