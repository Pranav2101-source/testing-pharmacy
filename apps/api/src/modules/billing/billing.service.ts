import type { FastifyInstance } from "fastify";
import { BillingRepo } from "./billing.repo.js";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";
import { generateInvoiceNumber } from "@pharmacy/utils";
import { defaultInvoiceSettings } from "@pharmacy/types";
import type { CreateInvoiceInput } from "./billing.schema.js";
import type { InvoiceLineItem } from "./billing.types.js";
import { INVOICE_SEQUENCE_KEY } from "./billing.constants.js";

export class BillingService {
  private repo: BillingRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new BillingRepo(app.prisma);
  }

  async createInvoice(tenantId: string, userId: string, input: CreateInvoiceInput) {
    // 1. Build line items with GST calculations
    const lineItems: InvoiceLineItem[] = [];

    for (const item of input.items) {
      const batch = await this.repo.getInventoryBatch(item.inventoryId, tenantId);
      if (!batch) throw { statusCode: 404, message: `Inventory item not found: ${item.inventoryId}` };
      if (batch.quantity < item.quantity) {
        throw { statusCode: 400, message: `Insufficient stock for ${batch.medicine.name}` };
      }

      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount, batch.medicine.gstRate);

      lineItems.push({
        inventoryId: item.inventoryId,
        medicineName: batch.medicine.name,
        hsnCode: batch.medicine.hsnCode,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        mrp: batch.mrp,
        quantity: item.quantity,
        discount: item.discount,
        gstRate: batch.medicine.gstRate,
        rate: batch.mrp * (1 - item.discount / 100),
        taxableAmount: gst.taxableAmount,
        cgst: gst.cgst,
        sgst: gst.sgst,
        amount: gst.totalAmount,
      });
    }

    // 2. Totals
    const totals = calcInvoiceTotals(
      input.items.map((item, i) => {
        const batch = lineItems[i]!;
        return { mrp: batch.mrp, quantity: item.quantity, discount: item.discount, gstRate: batch.gstRate };
      })
    );

    // 3. Invoice number (atomic Redis counter)
    const seq = await this.app.redis.incr(INVOICE_SEQUENCE_KEY(tenantId));
    const settings = await this.repo.getSettings(tenantId);
    const config = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;

    const invoiceNumber = generateInvoiceNumber(
      config.numbering.prefix,
      seq,
      config.numbering.financialYear
    );

    // 4. Persist invoice + decrement stock atomically
    const invoice = await this.repo.createInvoice({
      tenant: { connect: { id: tenantId } },
      user: { connect: { id: userId } },
      ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
      invoiceNumber,
      doctorName: input.doctorName,
      prescriptionId: input.prescriptionId,
      paymentMode: input.paymentMode,
      paymentStatus: input.paymentStatus,
      notes: input.notes,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxableAmount: totals.taxableAmount,
      cgst: totals.cgst,
      sgst: totals.sgst,
      totalGst: totals.totalGst,
      totalAmount: totals.totalAmount,
      items: {
        create: lineItems.map((li) => ({
          inventory: { connect: { id: li.inventoryId } },
          medicineName: li.medicineName,
          hsnCode: li.hsnCode,
          batchNumber: li.batchNumber,
          expiryDate: li.expiryDate,
          quantity: li.quantity,
          mrp: li.mrp,
          rate: li.rate,
          discount: li.discount,
          gstRate: li.gstRate,
          cgst: li.cgst,
          sgst: li.sgst,
          taxableAmount: li.taxableAmount,
          amount: li.amount,
        })),
      },
    });

    // 5. Decrement stock (fire and forget is risky — do it after invoice is saved)
    await Promise.all(
      input.items.map((item) =>
        this.repo.decrementStock(item.inventoryId, item.quantity)
      )
    );

    return invoice;
  }

  async getInvoice(id: string, tenantId: string) {
    const invoice = await this.repo.getInvoice(id, tenantId);
    if (!invoice) throw { statusCode: 404, message: "Invoice not found" };
    return invoice;
  }

  async listInvoices(tenantId: string, query: {
    page: number;
    limit: number;
    search?: string;
    from?: string;
    to?: string;
  }) {
    return this.repo.listInvoices(tenantId, {
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  async cancelInvoice(id: string, tenantId: string, reason: string) {
    const invoice = await this.repo.getInvoice(id, tenantId);
    if (!invoice) throw { statusCode: 404, message: "Invoice not found" };
    if (invoice.isCancelled) throw { statusCode: 400, message: "Invoice already cancelled" };

    const cancelled = await this.repo.cancelInvoice(id, tenantId, reason);

    // Restore stock for every line item
    await Promise.all(
      invoice.items.map((item) => this.repo.incrementStock(item.inventoryId, item.quantity))
    );

    return cancelled;
  }
}
