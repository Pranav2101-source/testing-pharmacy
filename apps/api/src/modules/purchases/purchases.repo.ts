import type { Db, Prisma } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";

export class PurchasesRepo {
  constructor(private db: Db) {}

  // ── Purchase Orders ──────────────────────────────────────────────────────

  async createPO(pharmacyId: string, userId: string, data: {
    orderNumber:   string;
    supplierId:    string;
    invoiceNo?:    string;
    notes?:        string;
    expectedDate?: Date;
    approvalStatus: string;
    items: {
      medicineId:   string;
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      quantity:     number;
      purchaseRate: number;
      mrp:          number;
      gstRate:      number;
      cgst:         number;
      sgst:         number;
      amount:       number;
    }[];
    subtotal:    number;
    totalGst:    number;
    totalAmount: number;
  }) {
    const po = await withTenant(this.db, pharmacyId, async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          pharmacyId,
          supplierId:     data.supplierId,
          orderNumber:    data.orderNumber,
          invoiceNo:      data.invoiceNo,
          notes:          data.notes,
          expectedDate:   data.expectedDate,
          status:         "DRAFT",
          approvalStatus: data.approvalStatus as any,
          subtotal:       data.subtotal,
          totalGst:       data.totalGst,
          totalAmount:    data.totalAmount,
          items: {
            create: data.items.map((item) => ({
              pharmacyId:   pharmacyId,
              medicineId:   item.medicineId,
              medicineName: item.medicineName,
              batchNumber:  item.batchNumber,
              expiryDate:   item.expiryDate,
              quantity:     item.quantity,
              purchaseRate: item.purchaseRate,
              mrp:          item.mrp,
              gstRate:      item.gstRate,
              cgst:         item.cgst,
              sgst:         item.sgst,
              amount:       item.amount,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items:    true,
        },
      });

      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId,
          action:   "CREATE",
          entity:   "PurchaseOrder",
          entityId: created.id,
          newData:  created as unknown as Prisma.InputJsonValue,
        },
      });

      return created;
    });

    // Notify owners when PO needs approval (fire-and-forget, outside transaction)
    if (data.approvalStatus === "PENDING_APPROVAL") {
      const creator = await this.db.user.findUnique({ where: { id: userId }, select: { name: true } });
      void notifyOwners(this.db, pharmacyId, {
        subject: `🛒 Purchase Order needs approval — ${po.orderNumber}`,
        message: `${creator?.name ?? "A pharmacist"} raised ${po.orderNumber} for ₹${po.totalAmount.toFixed(2)} from ${po.supplier.name}. Please review and approve.`,
      });
    }

    return po;
  }

  async updatePO(id: string, pharmacyId: string, userId: string, data: {
    invoiceNo?:    string;
    notes?:        string;
    expectedDate?: Date;
    items?: {
      medicineId:   string;
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      quantity:     number;
      purchaseRate: number;
      mrp:          number;
      gstRate:      number;
      cgst:         number;
      sgst:         number;
      amount:       number;
    }[];
    subtotal?:    number;
    totalGst?:    number;
    totalAmount?: number;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, pharmacyId }, select: { status: true } });
      if (!existing) throw AppError.notFound("Purchase order not found");
      if (existing.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT purchase orders can be edited");

      if (data.items) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          invoiceNo:    data.invoiceNo,
          notes:        data.notes,
          expectedDate: data.expectedDate,
          subtotal:     data.subtotal,
          totalGst:     data.totalGst,
          totalAmount:  data.totalAmount,
          ...(data.items ? {
            items: { create: data.items.map((item) => ({ ...item, pharmacyId })) },
          } : {}),
        },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "UPDATE", entity: "PurchaseOrder", entityId: id, newData: updated as unknown as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  async approvePO(id: string, pharmacyId: string, userId: string, approved: boolean, rejectionReason?: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where:  { id, pharmacyId },
        select: { status: true, approvalStatus: true },
      });
      if (!existing) throw AppError.notFound("Purchase order not found");
      if (existing.approvalStatus !== "PENDING_APPROVAL") {
        throw AppError.unprocessable("This purchase order is not pending approval");
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          approvalStatus:  approved ? "APPROVED" : "REJECTED",
          approvedBy:      userId,
          approvedAt:      new Date(),
          rejectionReason: !approved ? rejectionReason : null,
        },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });

      await tx.auditLog.create({
        data: {
          pharmacyId, userId,
          action:   approved ? "APPROVE" : "REJECT",
          entity:   "PurchaseOrder",
          entityId: id,
          newData:  { approvalStatus: updated.approvalStatus, rejectionReason } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  async sendPO(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where:  { id, pharmacyId },
        select: { status: true, approvalStatus: true },
      });
      if (!existing) throw AppError.notFound("Purchase order not found");
      if (existing.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT purchase orders can be sent");
      if (existing.approvalStatus === "PENDING_APPROVAL") {
        throw AppError.unprocessable("Purchase order is awaiting approval before it can be sent");
      }
      if (existing.approvalStatus === "REJECTED") {
        throw AppError.unprocessable("Purchase order has been rejected and cannot be sent");
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data:  { status: "PENDING" },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "STATUS_CHANGE", entity: "PurchaseOrder", entityId: id, newData: { status: "PENDING" } as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  async cancelPO(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where:  { id, pharmacyId },
        select: { status: true, grns: { select: { status: true } } },
      });
      if (!existing) throw AppError.notFound("Purchase order not found");
      if (existing.status === "RECEIVED") {
        throw AppError.unprocessable("This order has already been fully received and cannot be cancelled.");
      }
      if (existing.status === "CANCELLED") {
        throw AppError.unprocessable("This order is already cancelled.");
      }
      const hasConfirmedGRN = existing.grns.some((g) => g.status === "CONFIRMED");
      if (hasConfirmedGRN) {
        throw AppError.unprocessable(
          "This order cannot be cancelled because stock has already been received against it. Please cancel the GRN first, then try again.",
        );
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data:  { status: "CANCELLED" },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "CANCEL", entity: "PurchaseOrder", entityId: id, newData: { status: "CANCELLED" } as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  async getPOById(id: string, pharmacyId: string) {
    return this.db.purchaseOrder.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        items:    true,
        grns:     { select: { id: true, grnNumber: true, status: true, createdAt: true, totalAmount: true } },
      },
    });
  }

  async listPOs(pharmacyId: string, params: {
    page:            number;
    limit:           number;
    status?:         string;
    approvalStatus?: string;
    supplierId?:     string;
    from?:           Date;
    to?:             Date;
    search?:         string;
  }) {
    const where: Prisma.PurchaseOrderWhereInput = {
      pharmacyId,
      ...(params.status         ? { status: params.status as any }         : {}),
      ...(params.approvalStatus ? { approvalStatus: params.approvalStatus as any } : {}),
      ...(params.supplierId     ? { supplierId: params.supplierId }         : {}),
      ...(params.from || params.to
        ? { orderedAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { orderNumber: { contains: params.search, mode: "insensitive" } },
              { supplier:    { name: { contains: params.search, mode: "insensitive" } } },
              { invoiceNo:   { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.purchaseOrder.findMany({
        where,
        orderBy: { orderedAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          _count:   { select: { items: true, grns: true } },
        },
      }),
      this.db.purchaseOrder.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  // ── GRN ──────────────────────────────────────────────────────────────────

  async createGRN(pharmacyId: string, userId: string, data: {
    grnNumber:            string;
    supplierId:           string;
    purchaseOrderId?:     string;
    supplierInvoiceNo?:   string;
    supplierInvoiceDate?: Date;
    notes?:               string;
    items: {
      medicineId:   string;
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      orderedQty?:  number;
      receivedQty:  number;
      freeQty:      number;
      purchaseRate: number;
      mrp:          number;
      discount:     number;
      gstRate:      number;
      cgst:         number;
      sgst:         number;
      amount:       number;
    }[];
    subtotal:    number;
    totalGst:    number;
    totalAmount: number;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      // Duplicate supplier invoice guard moved INSIDE the Serializable transaction.
      // Two concurrent creates with the same supplierInvoiceNo previously both passed
      // the pre-transaction check (TOCTOU) and produced duplicate GRN records.
      if (data.supplierInvoiceNo) {
        const duplicate = await tx.goodsReceiptNote.findFirst({
          where: {
            pharmacyId,
            supplierId:        data.supplierId,
            supplierInvoiceNo: data.supplierInvoiceNo,
            status:            { not: "CANCELLED" },
          },
          select: { grnNumber: true, status: true },
        });
        if (duplicate) {
          throw AppError.conflict(
            `Supplier invoice "${data.supplierInvoiceNo}" is already saved as GRN ${duplicate.grnNumber}. You may be adding the same delivery twice.`,
          );
        }
      }

      const grn = await tx.goodsReceiptNote.create({
        data: {
          pharmacyId,
          supplierId:          data.supplierId,
          purchaseOrderId:     data.purchaseOrderId,
          grnNumber:           data.grnNumber,
          supplierInvoiceNo:   data.supplierInvoiceNo,
          supplierInvoiceDate: data.supplierInvoiceDate,
          notes:               data.notes,
          status:              "DRAFT",
          subtotal:            data.subtotal,
          totalGst:            data.totalGst,
          totalAmount:         data.totalAmount,
          items: {
            create: data.items.map((item) => ({ ...item, pharmacyId })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items:    { include: { medicine: { select: { name: true } } } },
        },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "CREATE", entity: "GRN", entityId: grn.id, newData: grn as unknown as Prisma.InputJsonValue },
      });

      return grn;
    }, { isolationLevel: "Serializable" });
  }

  async updateGRN(id: string, pharmacyId: string, userId: string, data: {
    supplierInvoiceNo?:   string;
    supplierInvoiceDate?: Date;
    notes?:               string;
    items?: {
      medicineId:   string;
      medicineName: string;
      batchNumber:  string;
      expiryDate:   Date;
      orderedQty?:  number;
      receivedQty:  number;
      freeQty:      number;
      purchaseRate: number;
      mrp:          number;
      discount:     number;
      gstRate:      number;
      cgst:         number;
      sgst:         number;
      amount:       number;
    }[];
    subtotal?:    number;
    totalGst?:    number;
    totalAmount?: number;
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.goodsReceiptNote.findFirst({
        where:  { id, pharmacyId },
        select: { status: true, supplierId: true },
      });
      if (!existing) throw AppError.notFound("This GRN could not be found. It may have already been deleted.");
      if (existing.status !== "DRAFT") throw AppError.unprocessable("Only GRNs that have not been confirmed yet can be edited.");

      if (data.supplierInvoiceNo) {
        const duplicate = await tx.goodsReceiptNote.findFirst({
          where: {
            pharmacyId,
            supplierId:        existing.supplierId,
            supplierInvoiceNo: data.supplierInvoiceNo,
            status:            { not: "CANCELLED" },
            NOT:               { id },
          },
          select: { grnNumber: true },
        });
        if (duplicate) {
          throw AppError.conflict(
            `Supplier invoice "${data.supplierInvoiceNo}" is already recorded as GRN ${duplicate.grnNumber}.`,
          );
        }
      }

      if (data.items) {
        await tx.gRNItem.deleteMany({ where: { grnId: id } });
      }

      const updated = await tx.goodsReceiptNote.update({
        where: { id },
        data: {
          supplierInvoiceNo:   data.supplierInvoiceNo,
          supplierInvoiceDate: data.supplierInvoiceDate,
          notes:               data.notes,
          subtotal:            data.subtotal,
          totalGst:            data.totalGst,
          totalAmount:         data.totalAmount,
          ...(data.items ? { items: { create: data.items.map((item) => ({ ...item, pharmacyId })) } } : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items:    { include: { medicine: { select: { name: true } } } },
        },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "UPDATE", entity: "GRN", entityId: id, newData: updated as unknown as Prisma.InputJsonValue },
      });

      return updated;
    }, { isolationLevel: "Serializable" });
  }

  async confirmGRN(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
        const grn = await tx.goodsReceiptNote.findFirst({
          where:   { id, pharmacyId },
          include: {
            items:    true,
            supplier: { select: { creditDays: true } },
          },
        });
        if (!grn) throw AppError.notFound("GRN not found");
        if (grn.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT GRNs can be confirmed");

        const confirmedAt    = new Date();
        const paymentDueDate = new Date(confirmedAt);
        paymentDueDate.setDate(paymentDueDate.getDate() + grn.supplier.creditDays);

        // ── Batch stock update — replaces the original N×4 sequential awaits ──
        // Old approach: for each of N items → findFirst + update/create + createMovement + updateGRNItem
        // New approach: 1 bulk read, 1 raw bulk UPDATE, 1 createMany for new batches, 1 createMany for movements,
        //               1 raw bulk UPDATE for GRN items. Reduces lock-hold time from N×4 round-trips to ~6.

        // Step A: compute total quantities per item
        const itemQtys = grn.items.map((item) => ({
          item,
          totalQty: (item.receivedQty + item.freeQty) * (item.conversionFactor ?? 1),
        }));

        // Step B: read all existing inventory in one query
        const existingInventory = await tx.inventory.findMany({
          where: {
            pharmacyId,
            OR: itemQtys.map(({ item }) => ({ medicineId: item.medicineId, batchNumber: item.batchNumber })),
          },
          select: { id: true, medicineId: true, batchNumber: true, quantity: true },
        });
        const existingMap = new Map(existingInventory.map((e) => [`${e.medicineId}::${e.batchNumber}`, e]));

        type ToUpdate = { item: typeof grn.items[number]; totalQty: number; existing: { id: string; quantity: number } };
        type ToCreate = { item: typeof grn.items[number]; totalQty: number; inventoryId?: string };
        const toUpdate: ToUpdate[] = [];
        const toCreate: ToCreate[] = [];

        for (const { item, totalQty } of itemQtys) {
          const existing = existingMap.get(`${item.medicineId}::${item.batchNumber}`);
          if (existing) toUpdate.push({ item, totalQty, existing });
          else          toCreate.push({ item, totalQty });
        }

        // Step C: bulk UPDATE existing inventory via a single CTE (no N round-trips)
        if (toUpdate.length > 0) {
          const ids   = toUpdate.map((r) => r.existing.id);
          const qtys  = toUpdate.map((r) => r.totalQty);
          const rates = toUpdate.map((r) => r.item.purchaseRate);
          const mrps  = toUpdate.map((r) => r.item.mrp);
          await tx.$executeRaw`
            UPDATE inventory inv
            SET    quantity      = inv.quantity + b.qty,
                   "purchaseRate" = b.rate,
                   mrp           = b.mrp,
                   status        = 'ACTIVE'
            FROM   (
                     SELECT unnest(${ids}::text[])    AS id,
                            unnest(${qtys}::int[])    AS qty,
                            unnest(${rates}::float[]) AS rate,
                            unnest(${mrps}::float[])  AS mrp
                   ) AS b
            WHERE  inv.id           = b.id
              AND  inv."pharmacyId" = ${pharmacyId}::text
          `;
        }

        // Step D: createMany for brand-new batches, then re-read their IDs
        if (toCreate.length > 0) {
          await tx.inventory.createMany({
            data: toCreate.map(({ item, totalQty }) => ({
              pharmacyId,
              medicineId:   item.medicineId,
              batchNumber:  item.batchNumber,
              expiryDate:   item.expiryDate,
              quantity:     totalQty,
              purchaseRate: item.purchaseRate,
              mrp:          item.mrp,
              minimumStock: 10,
              status:       "ACTIVE" as const,
            })),
          });
          const created = await tx.inventory.findMany({
            where: {
              pharmacyId,
              OR: toCreate.map(({ item }) => ({ medicineId: item.medicineId, batchNumber: item.batchNumber })),
            },
            select: { id: true, medicineId: true, batchNumber: true },
          });
          const createdMap = new Map(created.map((e) => [`${e.medicineId}::${e.batchNumber}`, e.id]));
          for (const r of toCreate) {
            r.inventoryId = createdMap.get(`${r.item.medicineId}::${r.item.batchNumber}`)!;
          }
        }

        // Step E: createMany for all inventory movements
        await tx.inventoryMovement.createMany({
          data: [
            ...toUpdate.map(({ item, totalQty, existing }) => ({
              pharmacyId, userId,
              inventoryId:    existing.id,
              type:           "PURCHASE" as const,
              direction:      "IN" as const,
              quantity:       totalQty,
              quantityBefore: existing.quantity,
              quantityAfter:  existing.quantity + totalQty,
              referenceType:  "GRN",
              referenceId:    grn.id,
              notes:          `GRN ${grn.grnNumber}${item.freeQty > 0 ? ` (incl. ${item.freeQty} free)` : ""}`,
            })),
            ...toCreate.map(({ item, totalQty, inventoryId }) => ({
              pharmacyId, userId,
              inventoryId:    inventoryId!,
              type:           "PURCHASE" as const,
              direction:      "IN" as const,
              quantity:       totalQty,
              quantityBefore: 0,
              quantityAfter:  totalQty,
              referenceType:  "GRN",
              referenceId:    grn.id,
              notes:          `GRN ${grn.grnNumber} — new batch`,
            })),
          ],
        });

        // Step F: bulk UPDATE grnItems with resolved inventoryId via a single raw statement
        const allPairs = [
          ...toUpdate.map(({ item, existing }) => ({ grnItemId: item.id, inventoryId: existing.id })),
          ...toCreate.map(({ item, inventoryId }) => ({ grnItemId: item.id, inventoryId: inventoryId! })),
        ];
        if (allPairs.length > 0) {
          const grnItemIds   = allPairs.map((p) => p.grnItemId);
          const inventoryIds = allPairs.map((p) => p.inventoryId);
          await tx.$executeRaw`
            UPDATE grn_items gi
            SET    "inventoryId" = b."invId"
            FROM   (
                     SELECT unnest(${grnItemIds}::text[])   AS id,
                            unnest(${inventoryIds}::text[]) AS "invId"
                   ) AS b
            WHERE  gi.id = b.id
          `;
        }

        // Mark GRN confirmed — set payment due date.
        const confirmed = await tx.goodsReceiptNote.update({
          where: { id },
          data:  { status: "CONFIRMED", confirmedAt, paymentDueDate },
          include: {
            supplier: { select: { id: true, name: true } },
            items:    { include: { medicine: { select: { name: true } } } },
          },
        });

        // Increment supplier ledger balance by the GRN total.
        // Keeps Supplier.ledgerBalance current so balance reads are O(1).
        await tx.supplier.update({
          where: { id: grn.supplierId, pharmacyId },
          data:  { ledgerBalance: { increment: grn.totalAmount } },
        });

        // Update linked PO status
        if (grn.purchaseOrderId) {
          const po = await tx.purchaseOrder.findUnique({
            where:   { id: grn.purchaseOrderId },
            include: { grns: { select: { status: true } } },
          });
          if (po && po.status !== "CANCELLED") {
            const allGrns        = po.grns;
            const confirmedCount = allGrns.filter((g) => g.status === "CONFIRMED").length;
            const newStatus      = confirmedCount >= allGrns.length ? "RECEIVED" : "PARTIAL";
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data:  { status: newStatus, receivedAt: newStatus === "RECEIVED" ? new Date() : undefined },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            pharmacyId, userId,
            action:   "CONFIRM",
            entity:   "GRN",
            entityId: id,
            newData:  { status: "CONFIRMED", grnNumber: grn.grnNumber, paymentDueDate } as Prisma.InputJsonValue,
          },
        });

        return confirmed;
    }, { isolationLevel: "Serializable", timeout: 20_000 });
  }

  async cancelGRN(id: string, pharmacyId: string, userId: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const grn = await tx.goodsReceiptNote.findFirst({ where: { id, pharmacyId }, select: { status: true, grnNumber: true } });
      if (!grn) throw AppError.notFound("GRN not found");
      if (grn.status !== "DRAFT") throw AppError.unprocessable("Only DRAFT GRNs can be cancelled");

      const cancelled = await tx.goodsReceiptNote.update({
        where: { id },
        data:  { status: "CANCELLED" },
        include: { supplier: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "CANCEL", entity: "GRN", entityId: id, newData: { status: "CANCELLED" } as Prisma.InputJsonValue },
      });

      return cancelled;
    });
  }

  async getGRNById(id: string, pharmacyId: string) {
    return this.db.goodsReceiptNote.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier:      { select: { id: true, name: true, phone: true, creditDays: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
        items: {
          include: { medicine: { select: { name: true, genericName: true, hsnCode: true } } },
        },
      },
    });
  }

  async listGRNs(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    status?:     string;
    supplierId?: string;
    from?:       Date;
    to?:         Date;
    overdue?:    boolean;
  }) {
    const where: Prisma.GoodsReceiptNoteWhereInput = {
      pharmacyId,
      ...(params.status     ? { status: params.status as any } : {}),
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.overdue    ? { paymentDueDate: { lt: new Date() }, status: "CONFIRMED" } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.goodsReceiptNote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier:      { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, orderNumber: true } },
          _count:        { select: { items: true } },
        },
      }),
      this.db.goodsReceiptNote.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  // ── Auto Purchase Suggestions (#3) ─────────────────────────────────────────
  // Finds medicines where current stock covers fewer than `daysThreshold` days
  // of average daily sales, and suggests a reorder quantity.

  async getAutoSuggestions(pharmacyId: string, daysThreshold: number, supplierId?: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Step 1: Get total stock per medicine
    const stockAgg = await this.db.inventory.groupBy({
      by:     ["medicineId"],
      where:  { pharmacyId, status: "ACTIVE" },
      _sum:   { quantity: true },
      _min:   { minimumStock: true },
    });

    // Step 2: Get sales in last 30 days grouped by medicineId via the inventory FK.
    // Previously grouped by `medicineName` (a snapshot string), which broke whenever
    // a medicine was renamed — the old snapshot name wouldn't match the current master
    // name, so sales for that medicine were silently dropped and it never appeared in
    // suggestions.  Joining through inventory gives us the stable FK.
    const salesAgg = await this.db.$queryRaw<{ medicineId: string; totalQty: number }[]>`
      SELECT inv."medicineId", COALESCE(SUM(ii.quantity), 0)::int AS "totalQty"
      FROM   invoice_items ii
      JOIN   inventory     inv ON inv.id      = ii."inventoryId"
      JOIN   invoices      i   ON i.id        = ii."invoiceId"
      WHERE  i."pharmacyId"  = ${pharmacyId}
        AND  i."isCancelled" = false
        AND  i."createdAt"  >= ${thirtyDaysAgo}
      GROUP  BY inv."medicineId"
    `;

    // Build medicine sales map keyed by medicineId
    const salesByMedicineId = new Map<string, number>(
      salesAgg.map((r) => [r.medicineId, r.totalQty]),
    );

    // Step 3: Fetch medicine names for the suggestion output
    const inventoryItems = await this.db.inventory.findMany({
      where:    { pharmacyId, status: "ACTIVE" },
      select:   { medicineId: true, medicine: { select: { name: true } } },
      distinct: ["medicineId"],
    });

    // Step 4: Compute suggestions
    const suggestions: {
      medicineId:        string;
      medicineName:      string;
      currentStock:      number;
      avgDailySales:     number;
      daysOfStock:       number;
      suggestedQuantity: number;
      minimumStock:      number;
    }[] = [];

    for (const stock of stockAgg) {
      const currentStock  = stock._sum.quantity ?? 0;
      const totalSales30d = salesByMedicineId.get(stock.medicineId) ?? 0;
      const avgDailySales = totalSales30d / 30;
      const daysOfStock   = avgDailySales > 0 ? currentStock / avgDailySales : 999;
      const minimumStock  = stock._min.minimumStock ?? 10;

      if (daysOfStock < daysThreshold || currentStock <= minimumStock) {
        // Suggest enough for 2× the threshold, minimum 1 box (assumed 10 units)
        const targetQty       = Math.ceil(avgDailySales * daysThreshold * 2);
        const suggestedQty    = Math.max(targetQty - currentStock, minimumStock, 10);

        // Get medicine name
        const inv = inventoryItems.find((i) => i.medicineId === stock.medicineId);
        if (!inv) continue;

        suggestions.push({
          medicineId:        stock.medicineId,
          medicineName:      inv.medicine?.name ?? "",
          currentStock,
          avgDailySales:     parseFloat(avgDailySales.toFixed(2)),
          daysOfStock:       parseFloat(daysOfStock.toFixed(1)),
          suggestedQuantity: suggestedQty,
          minimumStock,
        });
      }
    }

    // If supplierId filter: enrich with last known supplier via GRN items
    if (supplierId) {
      const medicineIds = suggestions.map((s) => s.medicineId);
      const lastGRNs    = await this.db.gRNItem.findMany({
        where: {
          medicineId: { in: medicineIds },
          grn:        { pharmacyId, supplierId, status: "CONFIRMED" },
        },
        distinct: ["medicineId"],
        orderBy:  { createdAt: "desc" },
        select:   { medicineId: true },
      });
      const supplierMedicines = new Set(lastGRNs.map((g) => g.medicineId));
      return suggestions.filter((s) => supplierMedicines.has(s.medicineId));
    }

    // Enrich with last known pricing from GRN items
    const medicineIds = suggestions.map((s) => s.medicineId);
    if (medicineIds.length > 0) {
      const lastPrices = await this.db.gRNItem.findMany({
        where:    { medicineId: { in: medicineIds }, grn: { pharmacyId, status: "CONFIRMED" } },
        distinct: ["medicineId"],
        orderBy:  { createdAt: "desc" },
        select:   { medicineId: true, purchaseRate: true, mrp: true, gstRate: true },
      });
      const priceMap = new Map(lastPrices.map((p) => [p.medicineId, p]));
      for (const s of suggestions) {
        const p = priceMap.get(s.medicineId);
        (s as any).lastPurchaseRate = p ? Number(p.purchaseRate) : 0;
        (s as any).lastMrp          = p ? Number(p.mrp)          : 0;
        (s as any).lastGstRate      = p ? Number(p.gstRate)       : 12;
      }
    }

    return suggestions.sort((a, b) => a.daysOfStock - b.daysOfStock);
  }
}
