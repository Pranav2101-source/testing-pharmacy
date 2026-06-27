import type { Db, Prisma, QuotationStatus } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import { AppError } from "../../lib/AppError.js";

export class QuotationsRepo {
  constructor(private db: Db) {}

  async create(pharmacyId: string, userId: string, quotationNumber: string, data: {
    supplierId: string;
    validUntil?: Date;
    notes?:     string;
    items: {
      medicineId:   string;
      medicineName: string;
      quantity:     number;
      quotedRate?:  number;
      mrp?:         number;
      gstRate:      number;
      discount:     number;
      notes?:       string;
    }[];
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: data.supplierId, pharmacyId }, select: { id: true } });
      if (!supplier) throw AppError.notFound("Supplier not found");

      const quotation = await tx.quotation.create({
        data: {
          pharmacyId,
          supplierId:     data.supplierId,
          quotationNumber,
          status:         "DRAFT",
          validUntil:     data.validUntil,
          notes:          data.notes,
          createdBy:      userId,
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
        data: {
          pharmacyId, userId,
          action:   "CREATE",
          entity:   "Quotation",
          entityId: quotation.id,
          newData:  quotation as unknown as Prisma.InputJsonValue,
        },
      });

      return quotation;
    });
  }

  async update(id: string, pharmacyId: string, userId: string, data: {
    validUntil?: Date;
    notes?:      string;
    items?: {
      medicineId:   string;
      medicineName: string;
      quantity:     number;
      quotedRate?:  number;
      mrp?:         number;
      gstRate:      number;
      discount:     number;
      notes?:       string;
    }[];
  }) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.quotation.findFirst({ where: { id, pharmacyId }, select: { status: true } });
      if (!existing) throw AppError.notFound("Quotation not found");
      if (!["DRAFT", "SENT"].includes(existing.status)) {
        throw AppError.unprocessable("Only DRAFT or SENT quotations can be updated");
      }

      if (data.items) {
        await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      }

      const updated = await tx.quotation.update({
        where: { id },
        data: {
          validUntil: data.validUntil,
          notes:      data.notes,
          ...(data.items ? { items: { create: data.items.map((item) => ({ ...item, pharmacyId })) } } : {}),
        },
        include: {
          supplier: { select: { id: true, name: true } },
          items:    { include: { medicine: { select: { name: true } } } },
        },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "UPDATE", entity: "Quotation", entityId: id, newData: updated as unknown as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  async updateStatus(id: string, pharmacyId: string, userId: string, status: QuotationStatus) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const existing = await tx.quotation.findFirst({ where: { id, pharmacyId }, select: { status: true } });
      if (!existing) throw AppError.notFound("Quotation not found");

      const updated = await tx.quotation.update({
        where: { id },
        data:  { status },
        include: { supplier: { select: { id: true, name: true } }, items: true },
      });

      await tx.auditLog.create({
        data: { pharmacyId, userId, action: "STATUS_CHANGE", entity: "Quotation", entityId: id, newData: { status } as Prisma.InputJsonValue },
      });

      return updated;
    });
  }

  async getById(id: string, pharmacyId: string) {
    return this.db.quotation.findFirst({
      where:   { id, pharmacyId },
      include: {
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        items:    { include: { medicine: { select: { name: true, genericName: true, hsnCode: true } } } },
      },
    });
  }

  async list(pharmacyId: string, params: {
    page:        number;
    limit:       number;
    supplierId?: string;
    status?:     QuotationStatus;
    from?:       Date;
    to?:         Date;
  }) {
    const where: Prisma.QuotationWhereInput = {
      pharmacyId,
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.status     ? { status: params.status } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.quotation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          supplier: { select: { id: true, name: true } },
          _count:   { select: { items: true } },
        },
      }),
      this.db.quotation.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit };
  }

  // Convert a RECEIVED quotation into a DRAFT Purchase Order
  async convertToPO(id: string, pharmacyId: string, userId: string, orderNumber: string, notes?: string) {
    return withTenant(this.db, pharmacyId, async (tx) => {
      const quotation = await tx.quotation.findFirst({
        where:   { id, pharmacyId },
        include: { items: true, supplier: { select: { id: true, name: true } } },
      });
      if (!quotation) throw AppError.notFound("Quotation not found");
      if (quotation.status !== "RECEIVED") {
        throw AppError.unprocessable(
          `Only RECEIVED quotations can be converted to a purchase order (current status: ${quotation.status})`,
        );
      }

      const missingRates = quotation.items.filter((i) => i.quotedRate == null || i.quotedRate <= 0);
      if (missingRates.length > 0) {
        throw AppError.unprocessable(
          `${missingRates.length} item(s) have no quoted rate — update the quotation before converting.`,
        );
      }

      // orderNumber is pre-generated by the service via Redis INCR (race-safe).
      // The old COUNT(*) approach here raced with concurrent PO creates and produced
      // duplicate document numbers (or P2002 if the unique constraint fired first).

      // Batch + expiry are unknown at quotation stage; filled in during GRN receipt
      const placeholderExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      let subtotal  = 0;
      let totalGst  = 0;

      const poItems = quotation.items.map((item) => {
        const purchaseRate   = item.quotedRate!;
        const discountedRate = purchaseRate * (1 - item.discount / 100);
        const taxableAmt     = parseFloat((discountedRate * item.quantity).toFixed(2));
        const gstAmt         = parseFloat((taxableAmt * item.gstRate / 100).toFixed(2));
        const cgst           = parseFloat((gstAmt / 2).toFixed(2));
        const sgst           = parseFloat((gstAmt / 2).toFixed(2));
        const amount         = parseFloat((taxableAmt + gstAmt).toFixed(2));
        const mrp            = item.mrp ?? parseFloat((purchaseRate * 1.3).toFixed(2));

        subtotal += taxableAmt;
        totalGst += gstAmt;

        return {
          pharmacyId,
          medicineId:   item.medicineId,
          medicineName: item.medicineName,
          batchNumber:  "TBD",
          expiryDate:   placeholderExpiry,
          quantity:     item.quantity,
          purchaseRate,
          mrp,
          gstRate:      item.gstRate,
          cgst,
          sgst,
          amount,
        };
      });

      subtotal          = parseFloat(subtotal.toFixed(2));
      totalGst          = parseFloat(totalGst.toFixed(2));
      const totalAmount = parseFloat((subtotal + totalGst).toFixed(2));

      const po = await tx.purchaseOrder.create({
        data: {
          pharmacyId,
          supplierId:     quotation.supplierId,
          orderNumber,
          notes:          notes ?? `Converted from quotation ${quotation.quotationNumber}`,
          status:         "DRAFT",
          approvalStatus: "NOT_REQUIRED",
          subtotal,
          totalGst,
          totalAmount,
          items:          poItems as unknown as Prisma.InputJsonValue,
          itemCount:      poItems.length,
        },
        include: {
          supplier: { select: { id: true, name: true } },
        },
      });

      // Quotation status update and audit log are independent writes —
      // neither depends on the other's result, so run them together.
      await Promise.all([
        tx.quotation.update({ where: { id }, data: { status: "CONVERTED" } }),
        tx.auditLog.create({
          data: {
            pharmacyId, userId,
            action:   "CONVERT",
            entity:   "Quotation",
            entityId: id,
            newData: {
              status:          "CONVERTED",
              purchaseOrderId: po.id,
              orderNumber:     po.orderNumber,
            } as Prisma.InputJsonValue,
          },
        }),
      ]);

      return {
        quotation: { id: quotation.id, quotationNumber: quotation.quotationNumber, status: "CONVERTED" as const },
        po,
      };
    });
  }

  // Side-by-side comparison of multiple quotations for the same medicines
  async compare(pharmacyId: string, quotationIds: string[]) {
    const quotations = await this.db.quotation.findMany({
      where:   { id: { in: quotationIds }, pharmacyId },
      include: {
        supplier: { select: { id: true, name: true } },
        items:    { include: { medicine: { select: { name: true } } } },
      },
    });

    if (quotations.length !== quotationIds.length) {
      throw AppError.notFound("One or more quotations not found");
    }

    // Build comparison matrix: medicineId → { medicineName, quotes: [{ supplierId, supplierName, quotedRate, mrp, gstRate, discount, effectiveRate }] }
    const comparisonMap = new Map<string, {
      medicineId:   string;
      medicineName: string;
      quotes: {
        quotationId:  string;
        supplierId:   string;
        supplierName: string;
        quantity:     number;
        quotedRate?:  number | null;
        mrp?:         number | null;
        gstRate:      number;
        discount:     number;
        effectiveRate?: number; // quotedRate * (1 - discount/100)
      }[];
    }>();

    for (const q of quotations) {
      for (const item of q.items) {
        if (!comparisonMap.has(item.medicineId)) {
          comparisonMap.set(item.medicineId, {
            medicineId:   item.medicineId,
            medicineName: item.medicineName,
            quotes:       [],
          });
        }
        const effectiveRate = item.quotedRate != null
          ? parseFloat((item.quotedRate * (1 - item.discount / 100)).toFixed(2))
          : undefined;

        comparisonMap.get(item.medicineId)!.quotes.push({
          quotationId:  q.id,
          supplierId:   q.supplierId,
          supplierName: q.supplier.name,
          quantity:     item.quantity,
          quotedRate:   item.quotedRate,
          mrp:          item.mrp,
          gstRate:      item.gstRate,
          discount:     item.discount,
          effectiveRate,
        });
      }
    }

    // Mark best price per medicine
    const comparison = Array.from(comparisonMap.values()).map((entry) => {
      const withRates = entry.quotes.filter((q) => q.effectiveRate != null);
      const bestRate  = withRates.length > 0
        ? Math.min(...withRates.map((q) => q.effectiveRate!))
        : null;

      return {
        ...entry,
        bestRate,
        quotes: entry.quotes.map((q) => ({
          ...q,
          isBestPrice: q.effectiveRate != null && q.effectiveRate === bestRate,
        })),
      };
    });

    return { quotations: quotations.map((q) => ({ id: q.id, quotationNumber: q.quotationNumber, supplier: q.supplier })), comparison };
  }
}
