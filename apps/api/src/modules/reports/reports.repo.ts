import type { Db } from "@pharmacy/database";

/**
 * Pure data access for the reports module. No business math here — aggregation
 * shaping, margins, CSV building etc. live in ReportsService.
 *
 * NOTE: Prisma aggregate()/groupBy() results bypass the $extends result
 * extension, so money fields come back as Decimal objects. Callers must wrap
 * them in Number() before putting them in a JSON response.
 */
export class ReportsRepo {
  constructor(private db: Db) {}

  // ── Sales ──────────────────────────────────────────────────────────────────

  invoiceCount(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.count({
      where: { pharmacyId, createdAt: { gte: from, lte: to }, isCancelled: false },
    });
  }

  invoiceRevenueAggregate(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.aggregate({
      where: { pharmacyId, createdAt: { gte: from, lte: to }, isCancelled: false },
      _sum:  { totalAmount: true, totalGst: true },
    });
  }

  gstAggregate(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.aggregate({
      where:  { pharmacyId, createdAt: { gte: from, lte: to }, isCancelled: false },
      _sum:   { subtotal: true, discountAmount: true, taxableAmount: true, cgst: true, sgst: true, totalGst: true, totalAmount: true },
      _count: true,
    });
  }

  expiryItems(pharmacyId: string, threshold: Date, limit: number) {
    return this.db.inventory.findMany({
      where: {
        pharmacyId,
        expiryDate: { lte: threshold },
        quantity:   { gt: 0 },
        // QUARANTINE/DAMAGED batches are already out of circulation via recall
        // or adjustment flows; listing them here would double-count the loss.
        status:     { in: ["ACTIVE", "EXPIRED"] },
      },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
      take:    limit,
    });
  }

  // ── Purchases ──────────────────────────────────────────────────────────────

  grnSpendAggregate(pharmacyId: string, from: Date, to: Date) {
    return this.db.goodsReceiptNote.aggregate({
      where:  { pharmacyId, status: "CONFIRMED", confirmedAt: { gte: from, lte: to } },
      _sum:   { totalAmount: true, totalGst: true, subtotal: true },
      _count: true,
    });
  }

  poCountsByStatus(pharmacyId: string, from: Date, to: Date) {
    return this.db.purchaseOrder.groupBy({
      by:     ["status"],
      where:  { pharmacyId, orderedAt: { gte: from, lte: to } },
      _count: true,
    });
  }

  topSuppliersBySpend(pharmacyId: string, from: Date, to: Date, take = 5) {
    return this.db.goodsReceiptNote.groupBy({
      by:      ["supplierId"],
      where:   { pharmacyId, status: "CONFIRMED", confirmedAt: { gte: from, lte: to } },
      _sum:    { totalAmount: true },
      orderBy: { _sum: { totalAmount: "desc" } },
      take,
    });
  }

  topPurchasedItems(pharmacyId: string, from: Date, to: Date, take = 10) {
    // Raw SQL to group by medicineId + JOIN medicines for the current name.
    // The Prisma groupBy("medicineName") approach bakes the name at receipt time;
    // if a medicine is later renamed the report shows the stale label.
    return this.db.$queryRaw<Array<{
      medicineId:       string;
      medicineName:     string;
      totalReceivedQty: bigint;
      totalFreeQty:     bigint;
      totalAmount:      unknown; // SUM(Decimal) → numeric, converted via Number() in service
    }>>`
      SELECT
        gi."medicineId",
        m.name                AS "medicineName",
        SUM(gi."receivedQty") AS "totalReceivedQty",
        SUM(gi."freeQty")     AS "totalFreeQty",
        SUM(gi.amount)        AS "totalAmount"
      FROM  grn_items           gi
      JOIN  goods_receipt_notes grn ON grn.id           = gi."grnId"
      JOIN  medicines           m   ON m.id             = gi."medicineId"
      WHERE grn."pharmacyId"   = ${pharmacyId}
        AND grn.status         = 'CONFIRMED'
        AND grn."confirmedAt" >= ${from}
        AND grn."confirmedAt" <= ${to}
      GROUP BY gi."medicineId", m.name
      ORDER BY SUM(gi."receivedQty") DESC
      LIMIT ${take}
    `;
  }

  overdueGrnCount(pharmacyId: string) {
    return this.db.goodsReceiptNote.count({
      where: { pharmacyId, status: "CONFIRMED", paymentDueDate: { lt: new Date() } },
    });
  }

  // Current-state counts (not date-ranged like the spend aggregates above) —
  // power the Purchase page header badges without a separate findMany+count
  // round-trip per badge.
  pendingApprovalCount(pharmacyId: string) {
    return this.db.purchaseOrder.count({
      where: { pharmacyId, approvalStatus: "PENDING_APPROVAL" },
    });
  }

  draftGrnCount(pharmacyId: string) {
    return this.db.goodsReceiptNote.count({
      where: { pharmacyId, status: "DRAFT" },
    });
  }

  supplierNames(ids: string[]) {
    return this.db.supplier.findMany({
      where:  { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  grnItemsInPeriod(pharmacyId: string, from: Date, to: Date, take = 1000) {
    return this.db.gRNItem.findMany({
      where: {
        grn: { pharmacyId, status: "CONFIRMED", confirmedAt: { gte: from, lte: to } },
      },
      select: {
        medicineName: true,
        medicineId:   true,
        purchaseRate: true,
        mrp:          true,
        receivedQty:  true,
        freeQty:      true,
        gstRate:      true,
        discount:     true,
        amount:       true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  // ── Compliance ─────────────────────────────────────────────────────────────

  scheduleRegisterItems(pharmacyId: string, from: Date, to: Date, schedules: string[]) {
    return this.db.invoiceItem.findMany({
      where: {
        invoice:   { pharmacyId, isCancelled: false, createdAt: { gte: from, lte: to } },
        inventory: { medicine: { schedule: { in: schedules } } },
      },
      include: {
        invoice: {
          select: {
            id:             true,
            invoiceNumber:  true,
            createdAt:      true,
            prescriptionId: true,
            doctorName:     true,
            customer:       { select: { id: true, name: true, phone: true, gender: true } },
            user:           { select: { id: true, name: true } },
          },
        },
        inventory: {
          select: {
            medicine: {
              select: { id: true, name: true, genericName: true, schedule: true, strength: true, form: true },
            },
          },
        },
      },
      orderBy: { invoice: { createdAt: "desc" } },
    });
  }

  invoicesWithItems(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoice.findMany({
      where:   { pharmacyId, isCancelled: false, createdAt: { gte: from, lte: to } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });
  }

  // ── Movement analytics ─────────────────────────────────────────────────────

  salesByInventory(
    pharmacyId: string,
    from: Date,
    to: Date,
    opts: { order: "asc" | "desc"; limit: number; minQty?: number },
  ) {
    return this.db.invoiceItem.groupBy({
      by:    ["inventoryId"],
      where: {
        invoice: { pharmacyId, isCancelled: false, createdAt: { gte: from, lte: to } },
      },
      _sum:    { quantity: true, amount: true },
      ...(opts.minQty !== undefined ? { having: { quantity: { _sum: { gte: opts.minQty } } } } : {}),
      orderBy: { _sum: { quantity: opts.order } },
      take:    opts.limit,
    });
  }

  inventoryMedicineByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.inventory.findMany({
      where:  { id: { in: ids } },
      select: {
        id:       true,
        medicine: { select: { id: true, name: true, genericName: true, form: true } },
      },
    });
  }

  activeStockWithLastSale(pharmacyId: string) {
    return this.db.inventory.findMany({
      where: { pharmacyId, status: "ACTIVE", quantity: { gt: 0 } },
      include: {
        medicine: { select: { id: true, name: true, genericName: true, form: true, category: true } },
        inventoryMovements: {
          where:   { type: "SALE" },
          orderBy: { createdAt: "desc" },
          take:    1,
        },
      },
    });
  }

  activeStockWithMedicine(pharmacyId: string) {
    return this.db.inventory.findMany({
      where:   { pharmacyId, status: "ACTIVE" },
      include: {
        medicine: { select: { id: true, name: true, genericName: true, category: true, form: true } },
      },
    });
  }

  // ── GSTR-1 HSN summary ────────────────────────────────────────────────────

  hsnSummaryItems(pharmacyId: string, from: Date, to: Date) {
    return this.db.invoiceItem.findMany({
      where: {
        invoice: { pharmacyId, isCancelled: false, createdAt: { gte: from, lte: to } },
      },
      select: {
        hsnCode:      true,
        gstRate:      true,
        taxableAmount: true,
        cgst:         true,
        sgst:         true,
        igst:         true,
        amount:       true,
        quantity:     true,
      },
    });
  }

  // ── EOD summary ────────────────────────────────────────────────────────────

  eodGstAggregate(pharmacyId: string, since: Date) {
    return this.db.invoice.aggregate({
      where: { pharmacyId, isCancelled: false, createdAt: { gte: since } },
      _sum:  { totalGst: true },
    });
  }

  eodTopItems(pharmacyId: string, since: Date, take = 5) {
    // Group by inventoryId (InvoiceItem does not store medicineName directly)
    return this.db.invoiceItem.groupBy({
      by:      ["inventoryId"],
      where:   { invoice: { pharmacyId, isCancelled: false, createdAt: { gte: since } } },
      _sum:    { quantity: true, amount: true },
      orderBy: { _sum: { quantity: "desc" } },
      take,
    });
  }

  inventoryNamesByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.inventory.findMany({
      where:  { id: { in: ids } },
      select: { id: true, medicine: { select: { name: true, genericName: true } } },
    });
  }
}
