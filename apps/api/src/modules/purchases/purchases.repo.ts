import type { PrismaClient, Prisma } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";

export class PurchasesRepo {
  constructor(private db: PrismaClient) {}

  // ── Purchase Orders ──────────────────────────────────────────────────────

  private async nextPONumber(pharmacyId: string, tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">): Promise<string> {
    const count = await tx.purchaseOrder.count({ where: { pharmacyId } });
    const year  = new Date().getFullYear();
    return `PO-${year}-${String(count + 1).padStart(5, "0")}`;
  }

  async createPO(pharmacyId: string, userId: string, data: {
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
    const po = await this.db.$transaction(async (tx) => {
      const orderNumber = await this.nextPONumber(pharmacyId, tx);

      const created = await tx.purchaseOrder.create({
        data: {
          pharmacyId,
          supplierId:     data.supplierId,
          orderNumber,
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
    return this.db.$transaction(async (tx) => {
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
            items: { create: data.items },
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
    return this.db.$transaction(async (tx) => {
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
    return this.db.$transaction(async (tx) => {
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
    return this.db.$transaction(async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, pharmacyId }, select: { status: true } });
      if (!existing) throw AppError.notFound("Purchase order not found");
      if (["RECEIVED", "CANCELLED"].includes(existing.status)) {
        throw AppError.unprocessable(`Cannot cancel a ${existing.status} purchase order`);
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

  private async nextGRNNumber(pharmacyId: string, tx: Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">): Promise<string> {
    const count = await tx.goodsReceiptNote.count({ where: { pharmacyId } });
    const year  = new Date().getFullYear();
    return `GRN-${year}-${String(count + 1).padStart(5, "0")}`;
  }

  async createGRN(pharmacyId: string, userId: string, data: {
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
    // Duplicate supplier invoice guard — checked before transaction to give a readable error
    if (data.supplierInvoiceNo) {
      const duplicate = await this.db.goodsReceiptNote.findFirst({
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
          `Supplier invoice "${data.supplierInvoiceNo}" is already recorded as GRN ${duplicate.grnNumber} (${duplicate.status}). ` +
          `Check for duplicate entry.`,
        );
      }
    }

    return this.db.$transaction(async (tx) => {
      const grnNumber = await this.nextGRNNumber(pharmacyId, tx);

      const grn = await tx.goodsReceiptNote.create({
        data: {
          pharmacyId,
          supplierId:          data.supplierId,
          purchaseOrderId:     data.purchaseOrderId,
          grnNumber,
          supplierInvoiceNo:   data.supplierInvoiceNo,
          supplierInvoiceDate: data.supplierInvoiceDate,
          notes:               data.notes,
          status:              "DRAFT",
          subtotal:            data.subtotal,
          totalGst:            data.totalGst,
          totalAmount:         data.totalAmount,
          items: {
            create: data.items,
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
    });
  }

  async confirmGRN(id: string, pharmacyId: string, userId: string) {
    return this.db.$transaction(
      async (tx) => {
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

        // Atomically update stock for each GRN item (FEFO-aware upsert)
        for (const item of grn.items) {
          const conversionFactor = item.conversionFactor ?? 1;
          const totalQty = (item.receivedQty + item.freeQty) * conversionFactor;

          const existing = await tx.inventory.findFirst({
            where:  { pharmacyId, medicineId: item.medicineId, batchNumber: item.batchNumber },
            select: { id: true, quantity: true },
          });

          let inventoryId: string;

          if (existing) {
            const quantityBefore = existing.quantity;
            const quantityAfter  = quantityBefore + totalQty;
            await tx.inventory.update({
              where: { id: existing.id },
              data:  { quantity: { increment: totalQty }, purchaseRate: item.purchaseRate, mrp: item.mrp, status: "ACTIVE" },
            });
            inventoryId = existing.id;

            await tx.inventoryMovement.create({
              data: {
                pharmacyId, userId,
                inventoryId:    existing.id,
                type:           "PURCHASE",
                direction:      "IN",
                quantity:       totalQty,
                quantityBefore,
                quantityAfter,
                referenceType:  "GRN",
                referenceId:    grn.id,
                notes:          `GRN ${grn.grnNumber}${item.freeQty > 0 ? ` (incl. ${item.freeQty} free)` : ""}`,
              },
            });
          } else {
            const created = await tx.inventory.create({
              data: {
                pharmacyId,
                medicineId:   item.medicineId,
                batchNumber:  item.batchNumber,
                expiryDate:   item.expiryDate,
                quantity:     totalQty,
                purchaseRate: item.purchaseRate,
                mrp:          item.mrp,
                minimumStock: 10,
                status:       "ACTIVE",
              },
            });
            inventoryId = created.id;

            await tx.inventoryMovement.create({
              data: {
                pharmacyId, userId,
                inventoryId:    created.id,
                type:           "PURCHASE",
                direction:      "IN",
                quantity:       totalQty,
                quantityBefore: 0,
                quantityAfter:  totalQty,
                referenceType:  "GRN",
                referenceId:    grn.id,
                notes:          `GRN ${grn.grnNumber} — new batch`,
              },
            });
          }

          await tx.gRNItem.update({ where: { id: item.id }, data: { inventoryId } });
        }

        // Mark GRN confirmed — set payment due date (#16)
        const confirmed = await tx.goodsReceiptNote.update({
          where: { id },
          data:  { status: "CONFIRMED", confirmedAt, paymentDueDate },
          include: {
            supplier: { select: { id: true, name: true } },
            items:    { include: { medicine: { select: { name: true } } } },
          },
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
      },
      { isolationLevel: "Serializable", timeout: 20_000 },
    );
  }

  async cancelGRN(id: string, pharmacyId: string, userId: string) {
    return this.db.$transaction(async (tx) => {
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

    // Step 2: Get sales in last 30 days per medicine
    const salesAgg = await this.db.invoiceItem.groupBy({
      by:    ["medicineName"],
      where: {
        invoice: { pharmacyId, isCancelled: false, createdAt: { gte: thirtyDaysAgo } },
      },
      _sum: { quantity: true },
    });

    // Build medicine sales map — keyed by medicineId via inventory join
    const inventoryItems = await this.db.inventory.findMany({
      where:   { pharmacyId, status: "ACTIVE" },
      select:  { medicineId: true, medicine: { select: { id: true, name: true } } },
      distinct: ["medicineId"],
    });

    const medicineNameToId = new Map<string, string>();
    for (const inv of inventoryItems) {
      if (inv.medicine?.name) medicineNameToId.set(inv.medicine.name, inv.medicineId);
    }

    const salesByMedicineId = new Map<string, number>();
    for (const sale of salesAgg) {
      const id = medicineNameToId.get(sale.medicineName);
      if (id) salesByMedicineId.set(id, (sale._sum.quantity ?? 0));
    }

    // Step 3: Compute suggestions
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

    return suggestions.sort((a, b) => a.daysOfStock - b.daysOfStock);
  }
}
