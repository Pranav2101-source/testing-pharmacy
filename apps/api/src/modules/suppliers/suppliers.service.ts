import type { FastifyInstance } from "fastify";
import { SuppliersRepo } from "./suppliers.repo.js";
import { InventoryRepo } from "../inventory/inventory.repo.js";
import { calcGstFromMrp } from "@pharmacy/utils";
import type { CreateSupplierInput, CreatePurchaseOrderInput } from "./suppliers.schema.js";

export class SuppliersService {
  private repo: SuppliersRepo;
  private inventoryRepo: InventoryRepo;

  constructor(app: FastifyInstance) {
    this.repo = new SuppliersRepo(app.prisma);
    this.inventoryRepo = new InventoryRepo(app.prisma);
  }

  async createSupplier(tenantId: string, input: CreateSupplierInput) {
    return this.repo.create(tenantId, input);
  }

  async list(tenantId: string, page: number, limit: number) {
    return this.repo.list(tenantId, page, limit);
  }

  async listPurchaseOrders(tenantId: string, page: number, limit: number, status?: string) {
    return this.repo.listPurchaseOrders(tenantId, page, limit, status);
  }

  async receivePurchaseOrder(tenantId: string, input: CreatePurchaseOrderInput) {
    let subtotal = 0;
    let totalGst = 0;

    const processedItems = input.items.map((item) => {
      const lineTotal = item.purchaseRate * item.quantity;
      const gst = calcGstFromMrp(item.mrp, item.quantity, 0, item.gstRate);
      // For purchases, use purchaseRate as base (not MRP)
      const cgst = (lineTotal * item.gstRate) / 100 / 2;
      const sgst = cgst;
      subtotal += lineTotal;
      totalGst += cgst + sgst;
      return {
        medicineName: item.medicineName,
        batchNumber: item.batchNumber,
        expiryDate: new Date(item.expiryDate),
        quantity: item.quantity,
        purchaseRate: item.purchaseRate,
        mrp: item.mrp,
        gstRate: item.gstRate,
        cgst,
        sgst,
        amount: lineTotal + cgst + sgst,
      };
    });

    const order = await this.repo.createPurchaseOrder(tenantId, {
      supplierId: input.supplierId,
      orderNumber: input.orderNumber,
      invoiceNo: input.invoiceNo,
      notes: input.notes,
      subtotal,
      totalGst,
      totalAmount: subtotal + totalGst,
      items: processedItems,
    });

    // Auto-add to inventory
    await Promise.all(
      input.items.map((item) =>
        this.inventoryRepo.upsertBatch(tenantId, {
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          expiryDate: new Date(item.expiryDate),
          quantity: item.quantity,
          purchaseRate: item.purchaseRate,
          mrp: item.mrp,
          minimumStock: 10,
        })
      )
    );

    return order;
  }
}
