import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../../middleware/auth.js";
import { resolvePharmacy } from "../../middleware/tenant.js";

const reportsRoutes: FastifyPluginAsync = async (app) => {
  const preHandler = [authenticate, resolvePharmacy];

  // ── Sales Reports ──────────────────────────────────────────────────────────

  // Daily sales summary
  app.get("/sales/daily", { preHandler }, async (req, reply) => {
    const { date } = req.query as Record<string, string>;
    // IST-aware day boundary — server runs UTC, IST = UTC+5:30
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const dateStr = date ?? new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
    const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
    const from = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);   // IST midnight in UTC
    const to   = new Date(from.getTime() + 86400_000 - 1);           // next IST midnight - 1ms

    const [invoices, totalRevenue] = await Promise.all([
      app.prisma.invoice.count({
        where: { pharmacyId: req.pharmacyId, createdAt: { gte: from, lte: to }, isCancelled: false },
      }),
      app.prisma.invoice.aggregate({
        where: { pharmacyId: req.pharmacyId, createdAt: { gte: from, lte: to }, isCancelled: false },
        _sum:  { totalAmount: true, totalGst: true },
      }),
    ]);

    return reply.send({
      success: true,
      data: {
        date:         dateStr,  // YYYY-MM-DD string, not a Date object
        invoiceCount: invoices,
        revenue:      totalRevenue._sum.totalAmount ?? 0,
        gstCollected: totalRevenue._sum.totalGst    ?? 0,
      },
    });
  });

  // GST report for a period
  app.get("/gst", { preHandler }, async (req, reply) => {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }

    const result = await app.prisma.invoice.aggregate({
      where: {
        pharmacyId:  req.pharmacyId,
        createdAt:   { gte: new Date(from), lte: new Date(to) },
        isCancelled: false,
      },
      _sum:   { subtotal: true, discountAmount: true, taxableAmount: true, cgst: true, sgst: true, totalGst: true, totalAmount: true },
      _count: true,
    });

    return reply.send({ success: true, data: result });
  });

  // Expiry report
  app.get("/expiry", { preHandler }, async (req, reply) => {
    const threshold = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const items = await app.prisma.inventory.findMany({
      where:   { pharmacyId: req.pharmacyId, expiryDate: { lte: threshold } },
      include: { medicine: { select: { name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    return reply.send({ success: true, data: items });
  });

  // ── Purchase Analytics (#22) ───────────────────────────────────────────────

  // Overall purchase summary for a period
  app.get("/purchases/summary", { preHandler }, async (req, reply) => {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }

    const dateFilter = { gte: new Date(from), lte: new Date(to) };

    const [grnAgg, poAgg, topSuppliers, topItems, overdueCount] = await Promise.all([
      // Total spend from confirmed GRNs
      app.prisma.goodsReceiptNote.aggregate({
        where: { pharmacyId: req.pharmacyId, status: "CONFIRMED", confirmedAt: dateFilter },
        _sum:  { totalAmount: true, totalGst: true, subtotal: true },
        _count: true,
      }),
      // PO counts by status
      app.prisma.purchaseOrder.groupBy({
        by:    ["status"],
        where: { pharmacyId: req.pharmacyId, orderedAt: dateFilter },
        _count: true,
      }),
      // Top 5 suppliers by spend
      app.prisma.goodsReceiptNote.groupBy({
        by:      ["supplierId"],
        where:   { pharmacyId: req.pharmacyId, status: "CONFIRMED", confirmedAt: dateFilter },
        _sum:    { totalAmount: true },
        orderBy: { _sum: { totalAmount: "desc" } },
        take:    5,
      }),
      // Top 10 purchased medicines by quantity
      app.prisma.gRNItem.groupBy({
        by:    ["medicineName"],
        where: { grn: { pharmacyId: req.pharmacyId, status: "CONFIRMED", confirmedAt: dateFilter } },
        _sum:  { receivedQty: true, freeQty: true, amount: true },
        orderBy: { _sum: { receivedQty: "desc" } },
        take:   10,
      }),
      // Overdue payments
      app.prisma.goodsReceiptNote.count({
        where: { pharmacyId: req.pharmacyId, status: "CONFIRMED", paymentDueDate: { lt: new Date() } },
      }),
    ]);

    // Enrich top suppliers with names
    const supplierIds = topSuppliers.map((s) => s.supplierId);
    const supplierNames = await app.prisma.supplier.findMany({
      where:  { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const supplierMap = new Map(supplierNames.map((s) => [s.id, s.name]));

    return reply.send({
      success: true,
      data: {
        period: { from, to },
        totalSpend:     grnAgg._sum.totalAmount ?? 0,
        totalGstPaid:   grnAgg._sum.totalGst    ?? 0,
        totalSubtotal:  grnAgg._sum.subtotal     ?? 0,
        invoiceCount:   grnAgg._count,
        overduePayments: overdueCount,
        poByStatus:     poAgg,
        topSuppliers:   topSuppliers.map((s) => ({
          supplierId:   s.supplierId,
          supplierName: supplierMap.get(s.supplierId) ?? "—",
          totalSpend:   s._sum.totalAmount ?? 0,
        })),
        topItems: topItems.map((i) => ({
          medicineName: i.medicineName,
          totalQty:     (i._sum.receivedQty ?? 0) + (i._sum.freeQty ?? 0),
          totalSpend:   i._sum.amount ?? 0,
        })),
      },
    });
  });

  // ── Purchase Cost Analysis (#28) ──────────────────────────────────────────
  // Shows purchase price vs MRP margin per medicine

  app.get("/purchases/cost-analysis", { preHandler }, async (req, reply) => {
    const { from, to, limit: limitStr } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }
    const limit = Math.min(parseInt(limitStr ?? "50"), 100);

    // Get GRN items in period
    const grnItems = await app.prisma.gRNItem.findMany({
      where: {
        grn: {
          pharmacyId:  req.pharmacyId,
          status:      "CONFIRMED",
          confirmedAt: { gte: new Date(from), lte: new Date(to) },
        },
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
      take:    1000, // aggregate in memory
    });

    // Group by medicineId
    const medicineMap = new Map<string, {
      medicineName:    string;
      totalQty:        number;
      totalCost:       number;
      totalMRPValue:   number;
      avgPurchaseRate: number;
      avgMRP:          number;
      marginPct:       number;
      batches:         number;
    }>();

    for (const item of grnItems) {
      const existing = medicineMap.get(item.medicineId);
      const qty = item.receivedQty + item.freeQty;
      if (existing) {
        existing.totalQty      += qty;
        existing.totalCost     += item.amount;
        existing.totalMRPValue += item.mrp * qty;
        existing.batches       += 1;
      } else {
        medicineMap.set(item.medicineId, {
          medicineName:    item.medicineName,
          totalQty:        qty,
          totalCost:       item.amount,
          totalMRPValue:   item.mrp * qty,
          avgPurchaseRate: item.purchaseRate,
          avgMRP:          item.mrp,
          marginPct:       0,
          batches:         1,
        });
      }
    }

    const analysis = Array.from(medicineMap.entries())
      .map(([medicineId, data]) => {
        const avgPurchaseRate = data.totalCost / Math.max(data.totalQty, 1);
        const avgMRP          = data.totalMRPValue / Math.max(data.totalQty, 1);
        const marginPct       = avgMRP > 0 ? ((avgMRP - avgPurchaseRate) / avgMRP) * 100 : 0;
        return {
          medicineId,
          medicineName:    data.medicineName,
          totalQty:        data.totalQty,
          totalCost:       parseFloat(data.totalCost.toFixed(2)),
          totalMRPValue:   parseFloat(data.totalMRPValue.toFixed(2)),
          avgPurchaseRate: parseFloat(avgPurchaseRate.toFixed(2)),
          avgMRP:          parseFloat(avgMRP.toFixed(2)),
          marginPct:       parseFloat(marginPct.toFixed(2)),
          batches:         data.batches,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);

    const totalCost     = analysis.reduce((s, i) => s + i.totalCost, 0);
    const totalMRPValue = analysis.reduce((s, i) => s + i.totalMRPValue, 0);
    const overallMargin = totalMRPValue > 0 ? ((totalMRPValue - totalCost) / totalMRPValue) * 100 : 0;

    return reply.send({
      success: true,
      data: {
        period:         { from, to },
        summary:        { totalCost, totalMRPValue, overallMarginPct: parseFloat(overallMargin.toFixed(2)) },
        items:          analysis,
      },
    });
  });

  // ── Schedule H Register (#30) ─────────────────────────────────────────────
  // Dispensing log for controlled/scheduled medicines (H, H1, X, G)

  app.get("/schedule-h", { preHandler }, async (req, reply) => {
    const { from, to, schedule } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }

    const scheduleFilter = schedule
      ? [schedule.toUpperCase()]
      : ["H", "H1", "X", "G"];

    const items = await app.prisma.invoiceItem.findMany({
      where: {
        invoice: {
          pharmacyId:  req.pharmacyId,
          isCancelled: false,
          createdAt:   { gte: new Date(from), lte: new Date(to) },
        },
        inventory: {
          medicine: { schedule: { in: scheduleFilter } },
        },
      },
      include: {
        invoice: {
          select: {
            id:             true,
            invoiceNumber:  true,
            createdAt:      true,
            prescriptionId: true,
            doctorName:     true,
            customer:       { select: { id: true, name: true, phone: true, age: true, gender: true } },
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

    return reply.send({ success: true, data: items });
  });

  // ── GST Report CSV Export (#31) ────────────────────────────────────────────

  app.get("/gst/export", { preHandler }, async (req, reply) => {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }

    const invoices = await app.prisma.invoice.findMany({
      where:   { pharmacyId: req.pharmacyId, isCancelled: false, createdAt: { gte: new Date(from), lte: new Date(to) } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });

    const header = "Invoice No,Date,HSN Code,Taxable Amount,CGST Rate,CGST,SGST Rate,SGST,Total GST,Invoice Total\n";
    const rows = invoices.flatMap((inv) =>
      inv.items.map((item) =>
        [
          inv.invoiceNumber,
          inv.createdAt.toISOString().slice(0, 10),
          item.hsnCode ?? "",
          item.taxableAmount.toFixed(2),
          (item.gstRate / 2).toFixed(1),
          item.cgst.toFixed(2),
          (item.gstRate / 2).toFixed(1),
          item.sgst.toFixed(2),
          (item.cgst + item.sgst).toFixed(2),
          item.amount.toFixed(2),
        ].join(","),
      ),
    );

    const csv = header + rows.join("\n");
    const filename = `gst-report-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv`;
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(csv);
  });

  // ── Fast-Moving & Slow-Moving Analysis (#32) ──────────────────────────────

  app.get("/analytics/fast-moving", { preHandler }, async (req, reply) => {
    const { from, to, limit: limitStr } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }
    const limit = Math.min(parseInt(limitStr ?? "20"), 50);

    const grouped = await app.prisma.invoiceItem.groupBy({
      by:    ["inventoryId"],
      where: {
        invoice: { pharmacyId: req.pharmacyId, isCancelled: false, createdAt: { gte: new Date(from), lte: new Date(to) } },
      },
      _sum:    { quantity: true, amount: true },
      orderBy: { _sum: { quantity: "desc" } },
      take:    limit,
    });

    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const inv = await app.prisma.inventory.findUnique({
          where:   { id: g.inventoryId },
          select:  { medicineId: true, medicine: { select: { id: true, name: true, genericName: true, form: true } } },
        });
        return {
          inventoryId:  g.inventoryId,
          medicine:     inv?.medicine,
          qtySold:      g._sum.quantity ?? 0,
          revenue:      parseFloat((g._sum.amount ?? 0).toFixed(2)),
        };
      }),
    );

    return reply.send({ success: true, data: { period: { from, to }, items: enriched } });
  });

  app.get("/analytics/slow-moving", { preHandler }, async (req, reply) => {
    const { from, to, limit: limitStr, minQty: minQtyStr } = req.query as Record<string, string>;
    if (!from || !to) {
      return reply.status(400).send({ success: false, error: "from and to required" });
    }
    const limit  = Math.min(parseInt(limitStr  ?? "20"), 50);
    const minQty = parseInt(minQtyStr ?? "1");

    const grouped = await app.prisma.invoiceItem.groupBy({
      by:    ["inventoryId"],
      where: {
        invoice: { pharmacyId: req.pharmacyId, isCancelled: false, createdAt: { gte: new Date(from), lte: new Date(to) } },
      },
      _sum:    { quantity: true, amount: true },
      having:  { quantity: { _sum: { gte: minQty } } },
      orderBy: { _sum: { quantity: "asc" } },
      take:    limit,
    });

    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const inv = await app.prisma.inventory.findUnique({
          where:  { id: g.inventoryId },
          select: { medicine: { select: { id: true, name: true, genericName: true, form: true } } },
        });
        return {
          inventoryId: g.inventoryId,
          medicine:    inv?.medicine,
          qtySold:     g._sum.quantity ?? 0,
          revenue:     parseFloat((g._sum.amount ?? 0).toFixed(2)),
        };
      }),
    );

    return reply.send({ success: true, data: { period: { from, to }, items: enriched } });
  });

  // ── Dead Stock Identification (#33) ───────────────────────────────────────

  app.get("/analytics/dead-stock", { preHandler }, async (req, reply) => {
    const { days: daysStr } = req.query as Record<string, string>;
    const days      = Math.max(1, parseInt(daysStr ?? "90"));
    const threshold = new Date(Date.now() - days * 86400_000);

    // Active inventory items that have had no SALE movement since threshold
    const activeItems = await app.prisma.inventory.findMany({
      where: { pharmacyId: req.pharmacyId, status: "ACTIVE", quantity: { gt: 0 } },
      include: {
        medicine: { select: { id: true, name: true, genericName: true, form: true, category: true } },
        inventoryMovements: {
          where:   { type: "SALE" },
          orderBy: { createdAt: "desc" },
          take:    1,
        },
      },
    });

    const deadStock = activeItems.filter((item) => {
      const lastSale = item.inventoryMovements[0];
      return !lastSale || lastSale.createdAt < threshold;
    }).map((item) => ({
      id:           item.id,
      batchNumber:  item.batchNumber,
      expiryDate:   item.expiryDate,
      quantity:     item.quantity,
      costAtRisk:   parseFloat((item.quantity * item.purchaseRate).toFixed(2)),
      retailValue:  parseFloat((item.quantity * item.mrp).toFixed(2)),
      lastSaleDate: item.inventoryMovements[0]?.createdAt ?? null,
      medicine:     item.medicine,
    }));

    const totalCostAtRisk = parseFloat(deadStock.reduce((s, i) => s + i.costAtRisk, 0).toFixed(2));

    return reply.send({
      success: true,
      data:    { thresholdDays: days, totalCostAtRisk, items: deadStock.sort((a, b) => b.costAtRisk - a.costAtRisk) },
    });
  });

  // ── Inventory Valuation Report (#34) ──────────────────────────────────────

  app.get("/inventory/valuation", { preHandler }, async (req, reply) => {
    const { groupBy = "medicine" } = req.query as Record<string, string>;

    const items = await app.prisma.inventory.findMany({
      where:   { pharmacyId: req.pharmacyId, status: "ACTIVE" },
      include: {
        medicine: { select: { id: true, name: true, genericName: true, category: true, form: true } },
      },
    });

    type ValEntry = { medicineName: string; category: string | null; costValue: number; retailValue: number; totalQty: number };
    const grouped = new Map<string, ValEntry>();

    for (const item of items) {
      const key = groupBy === "category"
        ? (item.medicine.category ?? "Uncategorized")
        : item.medicine.name;

      const existing = grouped.get(key);
      const cost     = item.quantity * item.purchaseRate;
      const retail   = item.quantity * item.mrp;

      if (existing) {
        existing.costValue   += cost;
        existing.retailValue += retail;
        existing.totalQty    += item.quantity;
      } else {
        grouped.set(key, {
          medicineName: item.medicine.name,
          category:     item.medicine.category,
          costValue:    cost,
          retailValue:  retail,
          totalQty:     item.quantity,
        });
      }
    }

    const rows = Array.from(grouped.entries()).map(([key, val]) => ({
      key,
      ...val,
      costValue:   parseFloat(val.costValue.toFixed(2)),
      retailValue: parseFloat(val.retailValue.toFixed(2)),
    })).sort((a, b) => b.costValue - a.costValue);

    const totalCostValue   = parseFloat(rows.reduce((s, r) => s + r.costValue,   0).toFixed(2));
    const totalRetailValue = parseFloat(rows.reduce((s, r) => s + r.retailValue, 0).toFixed(2));

    return reply.send({
      success: true,
      data:    { groupBy, totalCostValue, totalRetailValue, items: rows },
    });
  });
  // ── EOD Summary ──────────────────────────────────────────────────────────────
  // Supplies the homepage "Today's Summary" card with data that isn't already
  // returned by /billing/dashboard/stats — specifically top-5 medicines and the
  // total GST collected today (which stats deliberately omits).
  // Overdue GRN count is included here so the home page needs only two fetches.

  app.get("/eod/summary", { preHandler }, async (req, reply) => {
    // Mirror the IST-aware day boundary used in billing.repo getDashboardStats
    const IST_OFFSET_MS       = 5.5 * 60 * 60 * 1000;
    const istNow              = new Date(Date.now() + IST_OFFSET_MS);
    const istTodayMidnightUtc = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
    const todayStart          = new Date(istTodayMidnightUtc.getTime() - IST_OFFSET_MS);

    const invoiceWhere = {
      pharmacyId:  req.pharmacyId,
      isCancelled: false,
      createdAt:   { gte: todayStart },
    };

    const [gstAgg, topItemGroups, overdueGrns] = await Promise.all([
      app.prisma.invoice.aggregate({
        where: invoiceWhere,
        _sum:  { totalGst: true },
      }),
      // Group by inventoryId (InvoiceItem does not store medicineName directly)
      app.prisma.invoiceItem.groupBy({
        by:      ["inventoryId"],
        where:   { invoice: invoiceWhere },
        _sum:    { quantity: true, amount: true },
        orderBy: { _sum: { quantity: "desc" } },
        take:    5,
      }),
      app.prisma.goodsReceiptNote.count({
        where: {
          pharmacyId:     req.pharmacyId,
          status:         "CONFIRMED",
          paymentDueDate: { lt: new Date() },
        },
      }),
    ]);

    // Batch-enrich medicine names with a single IN query (avoids N+1)
    const inventoryIds = topItemGroups.map((g) => g.inventoryId);
    const inventories  = inventoryIds.length > 0
      ? await app.prisma.inventory.findMany({
          where:  { id: { in: inventoryIds } },
          select: { id: true, medicine: { select: { name: true, genericName: true } } },
        })
      : [];
    const invMap = new Map(inventories.map((i) => [i.id, i]));

    const topMedicines = topItemGroups.map((g) => ({
      medicineName: invMap.get(g.inventoryId)?.medicine.name          ?? "Unknown",
      genericName:  invMap.get(g.inventoryId)?.medicine.genericName   ?? null,
      qtySold:      g._sum.quantity ?? 0,
      revenue:      parseFloat((g._sum.amount ?? 0).toFixed(2)),
    }));

    return reply.send({
      success: true,
      data: {
        gstCollected:    parseFloat((gstAgg._sum.totalGst ?? 0).toFixed(2)),
        topMedicines,
        overdueGrnCount: overdueGrns,
      },
    });
  });

};

export default reportsRoutes;
