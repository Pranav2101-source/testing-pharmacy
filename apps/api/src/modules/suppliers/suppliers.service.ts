import type { FastifyInstance } from "fastify";
import { SuppliersRepo } from "./suppliers.repo.js";
import { InventoryRepo } from "../inventory/inventory.repo.js";
import type { CreateSupplierInput, UpdateSupplierInput, ListSuppliersQuery, CreatePurchaseOrderInput } from "./suppliers.schema.js";
import { AppError } from "../../lib/AppError.js";
import { TtlCache } from "../../lib/ttl-cache.js";

// 2-minute cache reduces repeated identical queries during purchase/GRN workflow.
const SUPPLIERS_CACHE_TTL_S = 120;
const suppliersCache = new TtlCache<string, unknown>();
const suppliersListKey = (pharmacyId: string, params: object) =>
  `${pharmacyId}:${JSON.stringify(params)}`;

export class SuppliersService {
  private repo:          SuppliersRepo;
  private inventoryRepo: InventoryRepo;
  private app:           FastifyInstance;

  constructor(app: FastifyInstance) {
    this.app           = app;
    this.repo          = new SuppliersRepo(app.prisma);
    this.inventoryRepo = new InventoryRepo(app.prisma);
  }

  private bustSuppliersCache(pharmacyId: string): void {
    suppliersCache.deleteByPrefix(`${pharmacyId}:`);
  }

  async createSupplier(pharmacyId: string, input: CreateSupplierInput) {
    const supplier = await this.repo.create(pharmacyId, input);
    this.bustSuppliersCache(pharmacyId);
    return supplier;
  }

  async updateSupplier(id: string, pharmacyId: string, input: UpdateSupplierInput) {
    const existing = await this.repo.getById(id, pharmacyId);
    if (!existing) throw AppError.notFound("Supplier not found");
    const supplier = await this.repo.update(id, pharmacyId, input);
    this.bustSuppliersCache(pharmacyId);
    return supplier;
  }

  async getById(id: string, pharmacyId: string) {
    const supplier = await this.repo.getById(id, pharmacyId);
    if (!supplier) throw AppError.notFound("Supplier not found");
    return supplier;
  }

  async list(pharmacyId: string, query: ListSuppliersQuery) {
    const params   = { page: query.page, limit: query.limit, search: query.search?.trim() || undefined };
    const cacheKey = suppliersListKey(pharmacyId, params);
    const cached   = suppliersCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = await this.repo.list(pharmacyId, params.page, params.limit, params.search);
    suppliersCache.set(cacheKey, result, SUPPLIERS_CACHE_TTL_S);
    return result;
  }

  async listAll(pharmacyId: string) {
    return this.repo.listAll(pharmacyId);
  }

  async getPurchaseHistory(id: string, pharmacyId: string, page: number, limit: number) {
    // Existence check + history fetch are independent queries — run in
    // parallel instead of sequentially (still distinguishes "supplier
    // doesn't exist" 404 from "supplier exists but has no orders").
    const [supplier, history] = await Promise.all([
      this.repo.getById(id, pharmacyId),
      this.repo.getPurchaseHistory(id, pharmacyId, page, limit),
    ]);
    if (!supplier) throw AppError.notFound("Supplier not found");
    return history;
  }

  // Vendor performance metrics (#23)
  async getPerformance(id: string, pharmacyId: string, from?: string, to?: string) {
    const db          = (this as any).repo["db"] as import("@pharmacy/database").Db;
    const dateFilter  = from && to
      ? { gte: new Date(from), lte: new Date(to) }
      : undefined;

    // Existence check runs alongside the aggregates instead of blocking them.
    const [supplier, poAgg, grnAgg, returnAgg, paymentAgg] = await Promise.all([
      this.repo.getById(id, pharmacyId),
      db.purchaseOrder.aggregate({
        where: { pharmacyId, supplierId: id, ...(dateFilter ? { orderedAt: dateFilter } : {}) },
        _count: true,
        _sum:   { totalAmount: true },
      }),
      db.goodsReceiptNote.findMany({
        where:  { pharmacyId, supplierId: id, status: "CONFIRMED", ...(dateFilter ? { confirmedAt: dateFilter } : {}) },
        select: { id: true, confirmedAt: true, totalAmount: true, paymentDueDate: true },
      }),
      db.supplierReturn.aggregate({
        where: { pharmacyId, supplierId: id, status: "CONFIRMED" },
        _count: true,
        _sum:   { totalAmount: true },
      }),
      db.supplierLedgerEntry.aggregate({
        where: { pharmacyId, supplierId: id, type: "PAYMENT" },
        _sum:  { amount: true },
      }),
    ]);
    if (!supplier) throw AppError.notFound("Supplier not found");

    const totalGRNs    = grnAgg.length;
    const totalSpend   = grnAgg.reduce((s, g) => s + g.totalAmount, 0);
    const totalPaid    = Number(paymentAgg._sum.amount ?? 0);
    const outstanding  = totalSpend - totalPaid;

    // Overdue GRNs = payment due date in the past
    const overdueGRNs  = grnAgg.filter((g) => g.paymentDueDate && g.paymentDueDate < new Date()).length;

    // On-time payment rate (simplified: paid amount / total spend)
    const paymentRate  = totalSpend > 0 ? Math.min((totalPaid / totalSpend) * 100, 100) : 0;

    // Return rate
    const returnRate   = totalGRNs > 0 ? ((returnAgg._count) / totalGRNs) * 100 : 0;

    return {
      supplier:       { id: supplier.id, name: (supplier as any).name },
      period:         from && to ? { from, to } : null,
      totalPOs:       poAgg._count,
      totalGRNs,
      totalSpend:     parseFloat(totalSpend.toFixed(2)),
      totalPaid:      parseFloat(totalPaid.toFixed(2)),
      outstanding:    parseFloat(outstanding.toFixed(2)),
      overdueGRNs,
      paymentRate:    parseFloat(paymentRate.toFixed(1)),
      totalReturns:   returnAgg._count,
      returnValue:    parseFloat((returnAgg._sum.totalAmount ?? 0).toFixed(2)),
      returnRate:     parseFloat(returnRate.toFixed(1)),
    };
  }

  // ── Backward-compat ───────────────────────────────────────────────────────

  async listPurchaseOrders(pharmacyId: string, page: number, limit: number, status?: string) {
    return this.repo.listPurchaseOrders(pharmacyId, page, limit, status);
  }

  async receivePurchaseOrder(pharmacyId: string, input: CreatePurchaseOrderInput) {
    let subtotal = 0;
    let totalGst = 0;

    const processedItems = input.items.map((item) => {
      const lineTotal = item.purchaseRate * item.quantity;
      const cgst      = (lineTotal * item.gstRate) / 100 / 2;
      const sgst      = cgst;
      subtotal += lineTotal;
      totalGst += cgst + sgst;
      return {
        medicineId:   item.medicineId,
        medicineName: item.medicineName,
        batchNumber:  item.batchNumber,
        expiryDate:   new Date(item.expiryDate),
        quantity:     item.quantity,
        purchaseRate: item.purchaseRate,
        mrp:          item.mrp,
        gstRate:      item.gstRate,
        cgst,
        sgst,
        amount: lineTotal + cgst + sgst,
      };
    });

    const order = await this.repo.createPurchaseOrder(pharmacyId, {
      supplierId:   input.supplierId,
      orderNumber:  input.orderNumber,
      invoiceNo:    input.invoiceNo,
      notes:        input.notes,
      subtotal,
      totalGst,
      totalAmount:  subtotal + totalGst,
      items:        processedItems,
    });

    await Promise.all(
      input.items.map((item) =>
        this.inventoryRepo.upsertBatch(pharmacyId, {
          medicineId:   item.medicineId,
          batchNumber:  item.batchNumber,
          expiryDate:   new Date(item.expiryDate),
          quantity:     item.quantity,
          purchaseRate: item.purchaseRate,
          mrp:          item.mrp,
          minimumStock: 10,
        }),
      ),
    );

    return order;
  }
}
