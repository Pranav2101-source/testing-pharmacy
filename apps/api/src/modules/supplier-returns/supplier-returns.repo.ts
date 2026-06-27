import type { Db, Prisma } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class SupplierReturnsRepo {
  constructor(private db: Db) {}

  async create(pharmacyId: string, userId: string, data: {
    returnNumber:  string;
    supplierId:    string;
    debitNoteNo?:  string;
    notes?:        string;
    items: {
      inventoryId:   string;
      medicineId:    string;
      medicineName:  string;
      batchNumber:   string;
      expiryDate:    Date;
      quantity:      number;
      purchaseRate:  number;
      taxableAmount: number;
      gstRate:       number;
      cgst:          number;
      sgst:          number;
      igst:          number;
      amount:        number;
      reason:        string;
    }[];
    subtotal:      number;
    taxableAmount: number;
    cgst:          number;
    sgst:          number;
    igst:          number;
    totalGst:      number;
    totalAmount:   number;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const sr = await tx.supplierReturn.create({
        data: {
          pharmacyId,
          supplierId:    data.supplierId,
          returnNumber:  data.returnNumber,
          debitNoteNo:   data.debitNoteNo,
          notes:         data.notes,
          status:        "DRAFT",
          subtotal:      data.subtotal,
          taxableAmount: data.taxableAmount,
          cgst:          data.cgst,
          sgst:          data.sgst,
          igst:          data.igst,
          totalGst:      data.totalGst,
          totalAmount:   data.totalAmount,
          items:         data.items as unknown as Prisma.InputJsonValue,
          itemCount:     data.items.length,
        },
        include: {
          supplier: { select: { id: true, name: true } },
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
        const sr = await tx.supplierReturn.findFirst({ where: { id, pharmacyId } });
        if (!sr) throw AppError.notFound("Supplier return not found");
        if (sr.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT supplier returns can be confirmed");

        const items = sr.items as unknown as Array<{
          inventoryId: string; medicineId: string; medicineName: string; quantity: number; reason: string;
        }>;

        // Batch read every distinct inventory row once (replaces N sequential
        // findFirst calls). Validation + per-item running balances are then
        // computed locally, mirroring the original sequential read-check-
        // decrement loop's semantics (including duplicate inventoryIds across
        // line items) without the N round-trips.
        const inventoryIds = [...new Set(items.map((i) => i.inventoryId))];
        const inventoryRows = await tx.inventory.findMany({
          where:  { id: { in: inventoryIds }, pharmacyId },
          select: { id: true, quantity: true },
        });
        const runningQty = new Map(inventoryRows.map((inv) => [inv.id, inv.quantity]));

        const movements: { inventoryId: string; quantity: number; quantityBefore: number; quantityAfter: number; reason: string }[] = [];
        for (const item of items) {
          const quantityBefore = runningQty.get(item.inventoryId);
          if (quantityBefore === undefined) throw AppError.notFound(`Inventory ${item.inventoryId} not found`);
          if (quantityBefore < item.quantity) {
            throw AppError.unprocessable(
              `Cannot return ${item.quantity} of "${item.medicineName}": only ${quantityBefore} in stock`,
            );
          }
          const quantityAfter = quantityBefore - item.quantity;
          runningQty.set(item.inventoryId, quantityAfter);
          movements.push({ inventoryId: item.inventoryId, quantity: item.quantity, quantityBefore, quantityAfter, reason: item.reason });
        }

        // Bulk decrement via a single raw UPDATE (replaces N sequential
        // updates). Aggregated by inventoryId first so a batch repeated
        // across line items decrements once for its total.
        const totalByInventoryId = new Map<string, number>();
        for (const item of items) {
          totalByInventoryId.set(item.inventoryId, (totalByInventoryId.get(item.inventoryId) ?? 0) + item.quantity);
        }
        const decIds  = [...totalByInventoryId.keys()];
        const decQtys = [...totalByInventoryId.values()];
        await tx.$executeRaw`
          UPDATE inventory inv
          SET    quantity = inv.quantity - b.qty
          FROM   (
                   SELECT unnest(${decIds}::text[]) AS id,
                          unnest(${decQtys}::int[]) AS qty
                 ) AS b
          WHERE  inv.id           = b.id
            AND  inv."pharmacyId" = ${pharmacyId}::text
        `;

        // Bulk insert movements (replaces N sequential creates)
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            pharmacyId, userId,
            inventoryId:    m.inventoryId,
            type:           "ADJUSTMENT" as const,
            direction:      "OUT" as const,
            quantity:       m.quantity,
            quantityBefore: m.quantityBefore,
            quantityAfter:  m.quantityAfter,
            referenceType:  "SUPPLIER_RETURN" as const,
            referenceId:    sr.id,
            notes:          `Supplier return ${sr.returnNumber} — ${m.reason}`,
          })),
        });

        const confirmed = await tx.supplierReturn.update({
          where:   { id },
          data:    { status: "CONFIRMED" },
          include: { supplier: { select: { id: true, name: true } } },
        });

        // Ledger-balance decrement and audit log are independent writes —
        // neither depends on the other's result, so run them together.
        await Promise.all([
          tx.supplier.update({
            where: { id: sr.supplierId, pharmacyId },
            data:  { ledgerBalance: { decrement: sr.totalAmount } },
          }),
          tx.auditLog.create({
            data: { pharmacyId, userId, action: "CONFIRM", entity: "SupplierReturn", entityId: id, newData: { status: "CONFIRMED", returnNumber: sr.returnNumber } as Prisma.InputJsonValue },
          }),
        ]);

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
        supplier: { select: { id: true, name: true, phone: true, gstin: true } },
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

    const [rawItems, total] = await Promise.all([
      this.db.supplierReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
        },
      }),
      this.db.supplierReturn.count({ where }),
    ]);

    // itemCount is a plain denormalized column now (items moved off a child
    // table) — reshape back into the `_count.items` form callers expect.
    const items = rawItems.map((sr) => ({ ...sr, _count: { items: sr.itemCount } }));

    return { items, total, page: params.page, limit: params.limit };
  }
}
