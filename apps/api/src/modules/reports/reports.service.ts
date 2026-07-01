import type { FastifyInstance } from "fastify";
import { ReportsRepo } from "./reports.repo.js";
import type { ReportPeriod } from "./reports.schema.js";

// IST-aware day boundary — server runs UTC, IST = UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** UTC instant of IST midnight for the given YYYY-MM-DD (or today's IST date). */
function istDayStart(dateStr?: string): { dateStr: string; from: Date; to: Date } {
  const resolved = dateStr ?? new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const [y, m, d] = resolved.split("-").map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);   // IST midnight in UTC
  const to   = new Date(from.getTime() + 86400_000 - 1);           // next IST midnight - 1ms
  return { dateStr: resolved, from, to };
}

const round2 = (n: number) => parseFloat(n.toFixed(2));

export class ReportsService {
  private repo: ReportsRepo;

  constructor(app: FastifyInstance) {
    this.repo = new ReportsRepo(app.prisma);
  }

  // ── Sales ──────────────────────────────────────────────────────────────────

  async dailySales(pharmacyId: string, date?: string) {
    const { dateStr, from, to } = istDayStart(date);

    const [invoiceCount, revenue] = await Promise.all([
      this.repo.invoiceCount(pharmacyId, from, to),
      this.repo.invoiceRevenueAggregate(pharmacyId, from, to),
    ]);

    return {
      date:         dateStr, // YYYY-MM-DD string, not a Date object
      invoiceCount,
      revenue:      Number(revenue._sum.totalAmount ?? 0),
      gstCollected: Number(revenue._sum.totalGst    ?? 0),
    };
  }

  async gstSummary(pharmacyId: string, period: ReportPeriod) {
    const result = await this.repo.gstAggregate(pharmacyId, period.from, period.to);
    // Aggregates bypass the Decimal→number result extension; normalize here so
    // the JSON response carries numbers (the frontend types these number|null).
    return {
      _count: result._count,
      _sum: {
        subtotal:       result._sum.subtotal       === null ? null : Number(result._sum.subtotal),
        discountAmount: result._sum.discountAmount === null ? null : Number(result._sum.discountAmount),
        taxableAmount:  result._sum.taxableAmount  === null ? null : Number(result._sum.taxableAmount),
        cgst:           result._sum.cgst           === null ? null : Number(result._sum.cgst),
        sgst:           result._sum.sgst           === null ? null : Number(result._sum.sgst),
        totalGst:       result._sum.totalGst       === null ? null : Number(result._sum.totalGst),
        totalAmount:    result._sum.totalAmount    === null ? null : Number(result._sum.totalAmount),
      },
    };
  }

  async expiryReport(pharmacyId: string, days: number, limit: number) {
    const threshold = new Date(Date.now() + days * 86400_000);
    return this.repo.expiryItems(pharmacyId, threshold, limit);
  }

  // ── Purchase analytics ─────────────────────────────────────────────────────

  async purchaseSummary(pharmacyId: string, period: ReportPeriod) {
    const { from, to, fromRaw, toRaw } = period;

    const [grnAgg, poByStatus, topSuppliers, topItems, overduePayments, pendingApprovals, pendingGRNs] = await Promise.all([
      this.repo.grnSpendAggregate(pharmacyId, from, to),
      this.repo.poCountsByStatus(pharmacyId, from, to),
      this.repo.topSuppliersBySpend(pharmacyId, from, to),
      this.repo.topPurchasedItems(pharmacyId, from, to),
      this.repo.overdueGrnCount(pharmacyId),
      this.repo.pendingApprovalCount(pharmacyId),
      this.repo.draftGrnCount(pharmacyId),
    ]);

    const supplierIds   = topSuppliers.map((s) => s.supplierId);
    const supplierNames = await this.repo.supplierNames(supplierIds);
    const supplierMap   = new Map(supplierNames.map((s) => [s.id, s.name]));

    return {
      period:          { from: fromRaw, to: toRaw },
      totalSpend:      Number(grnAgg._sum.totalAmount ?? 0),
      totalGstPaid:    Number(grnAgg._sum.totalGst    ?? 0),
      totalSubtotal:   Number(grnAgg._sum.subtotal    ?? 0),
      invoiceCount:    grnAgg._count,
      overduePayments,
      pendingApprovals,
      pendingGRNs,
      poByStatus,
      topSuppliers: topSuppliers.map((s) => ({
        supplierId:   s.supplierId,
        supplierName: supplierMap.get(s.supplierId) ?? "—",
        totalSpend:   Number(s._sum.totalAmount ?? 0),
      })),
      topItems: topItems.map((i) => ({
        medicineName: i.medicineName,
        totalQty:     Number(i.totalReceivedQty) + Number(i.totalFreeQty),
        totalSpend:   Number(i.totalAmount),
      })),
    };
  }

  /** Purchase price vs MRP margin per medicine, aggregated in memory. */
  async costAnalysis(pharmacyId: string, period: ReportPeriod, limit: number) {
    const grnItems = await this.repo.grnItemsInPeriod(pharmacyId, period.from, period.to);

    const medicineMap = new Map<string, {
      medicineName:  string;
      totalQty:      number;
      totalCost:     number;
      totalMRPValue: number;
      batches:       number;
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
          medicineName:  item.medicineName,
          totalQty:      qty,
          totalCost:     item.amount,
          totalMRPValue: item.mrp * qty,
          batches:       1,
        });
      }
    }

    const items = Array.from(medicineMap.entries())
      .map(([medicineId, data]) => {
        const avgPurchaseRate = data.totalCost / Math.max(data.totalQty, 1);
        const avgMRP          = data.totalMRPValue / Math.max(data.totalQty, 1);
        const marginPct       = avgMRP > 0 ? ((avgMRP - avgPurchaseRate) / avgMRP) * 100 : 0;
        return {
          medicineId,
          medicineName:    data.medicineName,
          totalQty:        data.totalQty,
          totalCost:       round2(data.totalCost),
          totalMRPValue:   round2(data.totalMRPValue),
          avgPurchaseRate: round2(avgPurchaseRate),
          avgMRP:          round2(avgMRP),
          marginPct:       round2(marginPct),
          batches:         data.batches,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);

    const totalCost     = items.reduce((s, i) => s + i.totalCost, 0);
    const totalMRPValue = items.reduce((s, i) => s + i.totalMRPValue, 0);
    const overallMargin = totalMRPValue > 0 ? ((totalMRPValue - totalCost) / totalMRPValue) * 100 : 0;

    return {
      period:  { from: period.fromRaw, to: period.toRaw },
      summary: { totalCost, totalMRPValue, overallMarginPct: round2(overallMargin) },
      items,
    };
  }

  // ── Compliance ─────────────────────────────────────────────────────────────

  /** Dispensing log for controlled/scheduled medicines (H, H1, X, G). */
  async scheduleRegister(pharmacyId: string, period: ReportPeriod, schedule?: string) {
    const schedules = schedule ? [schedule.toUpperCase()] : ["H", "H1", "X", "G"];
    return this.repo.scheduleRegisterItems(pharmacyId, period.from, period.to, schedules);
  }

  async gstExportCsv(pharmacyId: string, period: ReportPeriod) {
    const invoices = await this.repo.invoicesWithItems(pharmacyId, period.from, period.to);

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

    return {
      csv:      header + rows.join("\n"),
      filename: `gst-report-${period.fromRaw.slice(0, 10)}-to-${period.toRaw.slice(0, 10)}.csv`,
    };
  }

  // ── GSTR-1 HSN summary ────────────────────────────────────────────────────

  async hsnSummary(pharmacyId: string, period: ReportPeriod) {
    const items = await this.repo.hsnSummaryItems(pharmacyId, period.from, period.to);

    // Group by HSN + GST rate combination
    const map = new Map<string, {
      hsnCode:       string;
      gstRate:       number;
      totalQty:      number;
      taxableAmount: number;
      cgst:          number;
      sgst:          number;
      igst:          number;
      totalGst:      number;
      totalAmount:   number;
    }>();

    for (const item of items) {
      const hsn = item.hsnCode ?? "UNCLASSIFIED";
      const rate = Number(item.gstRate);
      const key  = `${hsn}__${rate}`;
      const existing = map.get(key);
      const row = {
        taxableAmount: Number(item.taxableAmount),
        cgst:          Number(item.cgst),
        sgst:          Number(item.sgst),
        igst:          Number(item.igst),
        totalGst:      Number(item.cgst) + Number(item.sgst) + Number(item.igst),
        totalAmount:   Number(item.amount),
        qty:           item.quantity,
      };
      if (existing) {
        existing.totalQty      += row.qty;
        existing.taxableAmount += row.taxableAmount;
        existing.cgst          += row.cgst;
        existing.sgst          += row.sgst;
        existing.igst          += row.igst;
        existing.totalGst      += row.totalGst;
        existing.totalAmount   += row.totalAmount;
      } else {
        map.set(key, {
          hsnCode:       hsn,
          gstRate:       rate,
          totalQty:      row.qty,
          taxableAmount: row.taxableAmount,
          cgst:          row.cgst,
          sgst:          row.sgst,
          igst:          row.igst,
          totalGst:      row.totalGst,
          totalAmount:   row.totalAmount,
        });
      }
    }

    const rows = Array.from(map.values()).map((r) => ({
      ...r,
      taxableAmount: round2(r.taxableAmount),
      cgst:          round2(r.cgst),
      sgst:          round2(r.sgst),
      igst:          round2(r.igst),
      totalGst:      round2(r.totalGst),
      totalAmount:   round2(r.totalAmount),
    })).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.gstRate - b.gstRate);

    return { period: { from: period.fromRaw, to: period.toRaw }, rows };
  }

  async hsnSummaryCsv(pharmacyId: string, period: ReportPeriod) {
    const { rows } = await this.hsnSummary(pharmacyId, period);
    const header = "HSN Code,GST Rate (%),Total Qty,Taxable Amount,CGST,SGST,IGST,Total GST,Total Amount\n";
    const body   = rows.map((r) =>
      [r.hsnCode, r.gstRate, r.totalQty, r.taxableAmount, r.cgst, r.sgst, r.igst, r.totalGst, r.totalAmount].join(",")
    ).join("\n");
    return {
      csv:      header + body,
      filename: `gstr1-hsn-${period.fromRaw.slice(0, 10)}-to-${period.toRaw.slice(0, 10)}.csv`,
    };
  }

  // ── Movement analytics ─────────────────────────────────────────────────────

  private async enrichMovementGroups(
    groups: Array<{ inventoryId: string; _sum: { quantity: number | null; amount: unknown } }>,
  ) {
    // Single IN query for all medicine names (the old code did one findUnique
    // per group — up to 50 round-trips).
    const inventories = await this.repo.inventoryMedicineByIds(groups.map((g) => g.inventoryId));
    const invMap = new Map(inventories.map((i) => [i.id, i.medicine]));

    return groups.map((g) => ({
      inventoryId: g.inventoryId,
      medicine:    invMap.get(g.inventoryId),
      qtySold:     g._sum.quantity ?? 0,
      revenue:     round2(Number(g._sum.amount ?? 0)),
    }));
  }

  async fastMoving(pharmacyId: string, period: ReportPeriod, limit: number) {
    const grouped = await this.repo.salesByInventory(pharmacyId, period.from, period.to, {
      order: "desc",
      limit,
    });
    return {
      period: { from: period.fromRaw, to: period.toRaw },
      items:  await this.enrichMovementGroups(grouped),
    };
  }

  async slowMoving(pharmacyId: string, period: ReportPeriod, limit: number, minQty: number) {
    const grouped = await this.repo.salesByInventory(pharmacyId, period.from, period.to, {
      order: "asc",
      limit,
      minQty,
    });
    return {
      period: { from: period.fromRaw, to: period.toRaw },
      items:  await this.enrichMovementGroups(grouped),
    };
  }

  async deadStock(pharmacyId: string, days: number) {
    const threshold   = new Date(Date.now() - days * 86400_000);
    const activeItems = await this.repo.activeStockWithLastSale(pharmacyId);

    const items = activeItems
      .filter((item) => {
        const lastSale = item.inventoryMovements[0];
        return !lastSale || lastSale.createdAt < threshold;
      })
      .map((item) => ({
        id:           item.id,
        batchNumber:  item.batchNumber,
        expiryDate:   item.expiryDate,
        quantity:     item.quantity,
        costAtRisk:   round2(item.quantity * item.purchaseRate),
        retailValue:  round2(item.quantity * item.mrp),
        lastSaleDate: item.inventoryMovements[0]?.createdAt ?? null,
        medicine:     item.medicine,
      }))
      .sort((a, b) => b.costAtRisk - a.costAtRisk);

    const totalCostAtRisk = round2(items.reduce((s, i) => s + i.costAtRisk, 0));

    return { thresholdDays: days, totalCostAtRisk, items };
  }

  async inventoryValuation(pharmacyId: string, groupBy: "medicine" | "category") {
    const items = await this.repo.activeStockWithMedicine(pharmacyId);

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

    const rows = Array.from(grouped.entries())
      .map(([key, val]) => ({
        key,
        ...val,
        costValue:   round2(val.costValue),
        retailValue: round2(val.retailValue),
      }))
      .sort((a, b) => b.costValue - a.costValue);

    const totalCostValue   = round2(rows.reduce((s, r) => s + r.costValue,   0));
    const totalRetailValue = round2(rows.reduce((s, r) => s + r.retailValue, 0));

    return { groupBy, totalCostValue, totalRetailValue, items: rows };
  }

  // ── EOD summary ────────────────────────────────────────────────────────────
  // Supplies the homepage "Today's Summary" card with data that isn't already
  // returned by /billing/dashboard/stats — specifically top-5 medicines and the
  // total GST collected today (which stats deliberately omits). Overdue GRN
  // count is included so the home page needs only two fetches.

  async eodSummary(pharmacyId: string) {
    const { from: todayStart } = istDayStart();

    const [gstAgg, topItemGroups, overdueGrnCount] = await Promise.all([
      this.repo.eodGstAggregate(pharmacyId, todayStart),
      this.repo.eodTopItems(pharmacyId, todayStart),
      this.repo.overdueGrnCount(pharmacyId),
    ]);

    const inventories = await this.repo.inventoryNamesByIds(topItemGroups.map((g) => g.inventoryId));
    const invMap = new Map(inventories.map((i) => [i.id, i]));

    const topMedicines = topItemGroups.map((g) => ({
      medicineName: invMap.get(g.inventoryId)?.medicine.name        ?? "Unknown",
      genericName:  invMap.get(g.inventoryId)?.medicine.genericName ?? null,
      qtySold:      g._sum.quantity ?? 0,
      revenue:      round2(Number(g._sum.amount ?? 0)),
    }));

    return {
      gstCollected: round2(Number(gstAgg._sum.totalGst ?? 0)),
      topMedicines,
      overdueGrnCount,
    };
  }
}
