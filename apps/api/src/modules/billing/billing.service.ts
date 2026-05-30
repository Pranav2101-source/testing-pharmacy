import type { FastifyInstance } from "fastify";
import { BillingRepo } from "./billing.repo.js";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";
import { generateInvoiceNumber } from "@pharmacy/utils";
import { defaultInvoiceSettings } from "@pharmacy/types";
import type { CreateInvoiceInput, CreateReturnInput, AddPaymentInput, ListInvoicesQuery, ListReturnsQuery } from "./billing.schema.js";
import type { InvoiceLineItem } from "./billing.types.js";
import { INVOICE_SEQUENCE_KEY, RETURN_SEQUENCE_KEY } from "./billing.constants.js";

const MAX_PAGE_LIMIT = 100;

export class BillingService {
  private repo: BillingRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new BillingRepo(app.prisma);
  }

  // ── Create Invoice ────────────────────────────────────────────────────────

  async createInvoice(
    tenantId:       string,
    userId:         string,
    input:          CreateInvoiceInput,
    auditMeta?:     { ipAddress?: string; userAgent?: string }
  ) {
    // Guard: duplicate inventory IDs → would double-decrement stock
    const inventoryIds = input.items.map((i) => i.inventoryId);
    if (new Set(inventoryIds).size !== inventoryIds.length) {
      throw Object.assign(
        new Error("Duplicate inventory items in a single invoice are not allowed"),
        { statusCode: 400 }
      );
    }

    // Prefetch all batches in one query
    const batches  = await this.repo.getInventoryBatches(inventoryIds, tenantId);
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const now      = new Date();

    // Validate customer credit limit before doing any DB writes
    if (input.customerId && input.paymentMode === "CREDIT") {
      await this.validateCreditLimit(tenantId, input.customerId, input.items, batchMap);
    }

    const lineItems: InvoiceLineItem[] = [];

    for (const item of input.items) {
      if (item.quantity <= 0) {
        throw Object.assign(new Error("Item quantity must be a positive integer"), { statusCode: 400 });
      }

      const batch = batchMap.get(item.inventoryId);
      if (!batch) {
        throw Object.assign(new Error(`Inventory item not found: ${item.inventoryId}`), { statusCode: 404 });
      }

      if (!batch.medicine.isActive) {
        throw Object.assign(
          new Error(`Medicine "${batch.medicine.name}" is inactive and cannot be billed`),
          { statusCode: 422 }
        );
      }

      if (batch.expiryDate <= now) {
        const expiredOn = batch.expiryDate.toISOString().split("T")[0];
        throw Object.assign(
          new Error(`Batch "${batch.batchNumber}" of "${batch.medicine.name}" expired on ${expiredOn}`),
          { statusCode: 422 }
        );
      }

      if (batch.quantity < item.quantity) {
        throw Object.assign(
          new Error(
            `Insufficient stock for "${batch.medicine.name}": ${batch.quantity} available, ${item.quantity} requested`
          ),
          { statusCode: 409 }
        );
      }

      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount, batch.medicine.gstRate);

      lineItems.push({
        inventoryId:   item.inventoryId,
        medicineName:  batch.medicine.name,
        hsnCode:       batch.medicine.hsnCode,
        batchNumber:   batch.batchNumber,
        expiryDate:    batch.expiryDate,
        mrp:           batch.mrp,
        quantity:      item.quantity,
        discount:      item.discount,
        gstRate:       batch.medicine.gstRate,
        rate:          parseFloat((batch.mrp * (1 - item.discount / 100)).toFixed(2)),
        taxableAmount: gst.taxableAmount,
        cgst:          gst.cgst,
        sgst:          gst.sgst,
        amount:        gst.totalAmount,
      });
    }

    const totals = calcInvoiceTotals(
      lineItems.map((li) => ({ mrp: li.mrp, quantity: li.quantity, discount: li.discount, gstRate: li.gstRate }))
    );

    const seq           = await this.app.redis.incr(INVOICE_SEQUENCE_KEY(tenantId));
    const settings      = await this.repo.getSettings(tenantId);
    const config        = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;
    const invoiceNumber = generateInvoiceNumber(
      config.numbering.prefix,
      seq,
      config.numbering.financialYear
    );

    return this.repo.createInvoiceTransactional({
      tenantId,
      userId,
      idempotencyKey: input.idempotencyKey,
      customerId:     input.customerId,
      totalAmount:    totals.totalAmount,
      paymentStatus:  input.paymentStatus,
      invoiceData: {
        tenant:        { connect: { id: tenantId } },
        user:          { connect: { id: userId } },
        ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
        invoiceNumber,
        doctorName:    input.doctorName,
        prescriptionId: input.prescriptionId,
        paymentMode:   input.paymentMode,
        paymentStatus: input.paymentStatus,
        status:        "COMPLETED",
        notes:         input.notes,
        idempotencyKey: input.idempotencyKey,
        subtotal:      totals.subtotal,
        discountAmount: totals.discountAmount,
        taxableAmount:  totals.taxableAmount,
        cgst:           totals.cgst,
        sgst:           totals.sgst,
        totalGst:       totals.totalGst,
        totalAmount:    totals.totalAmount,
        items: {
          create: lineItems.map((li) => ({
            inventory:     { connect: { id: li.inventoryId } },
            medicineName:  li.medicineName,
            hsnCode:       li.hsnCode,
            batchNumber:   li.batchNumber,
            expiryDate:    li.expiryDate,
            quantity:      li.quantity,
            mrp:           li.mrp,
            rate:          li.rate,
            discount:      li.discount,
            gstRate:       li.gstRate,
            cgst:          li.cgst,
            sgst:          li.sgst,
            taxableAmount: li.taxableAmount,
            amount:        li.amount,
          })),
        },
      },
      stockDecrements: lineItems.map((li) => ({
        inventoryId:  li.inventoryId,
        quantity:     li.quantity,
        medicineName: li.medicineName,
      })),
      auditMeta,
    });
  }

  // ── Get Invoice ───────────────────────────────────────────────────────────

  async getInvoice(id: string, tenantId: string) {
    const invoice = await this.repo.getInvoice(id, tenantId);
    if (!invoice) {
      throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    }
    return invoice;
  }

  // ── List Invoices ─────────────────────────────────────────────────────────

  async listInvoices(tenantId: string, query: ListInvoicesQuery) {
    const page  = Math.max(1, query.page);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit));

    const { from, to } = this.parseDateRange(query.from, query.to);

    return this.repo.listInvoices(tenantId, {
      page,
      limit,
      search:           query.search?.trim() || undefined,
      from,
      to,
      includeCancelled: query.includeCancelled,
      paymentMode:      query.paymentMode,
      paymentStatus:    query.paymentStatus,
      userId:           query.userId,
      customerId:       query.customerId,
      minAmount:        query.minAmount,
      maxAmount:        query.maxAmount,
    });
  }

  // ── Cancel Invoice ────────────────────────────────────────────────────────

  async cancelInvoice(
    id:       string,
    tenantId: string,
    userId:   string,
    reason:   string,
    auditMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    return this.repo.cancelInvoiceTransactional({ invoiceId: id, tenantId, userId, reason, auditMeta });
  }

  // ── Create Sales Return ───────────────────────────────────────────────────

  async createReturn(
    invoiceId: string,
    tenantId:  string,
    userId:    string,
    input:     CreateReturnInput,
    auditMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    const seq          = await this.app.redis.incr(RETURN_SEQUENCE_KEY(tenantId));
    const settings     = await this.repo.getSettings(tenantId);
    const config       = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;
    const returnNumber = generateInvoiceNumber(
      (config.numbering.prefix ?? "INV") + "-RET",
      seq,
      config.numbering.financialYear
    );

    return this.repo.createReturnTransactional({
      tenantId,
      invoiceId,
      userId,
      returnNumber,
      reason:         input.reason,
      idempotencyKey: input.idempotencyKey,
      returnItems:    input.items,
      auditMeta,
    });
  }

  // ── Get Return ────────────────────────────────────────────────────────────

  async getReturn(id: string, tenantId: string) {
    const ret = await this.repo.getReturn(id, tenantId);
    if (!ret) {
      throw Object.assign(new Error("Return not found"), { statusCode: 404 });
    }
    return ret;
  }

  // ── List Returns ──────────────────────────────────────────────────────────

  async listReturns(tenantId: string, query: ListReturnsQuery) {
    const page  = Math.max(1, query.page);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit));

    const { from, to } = this.parseDateRange(query.from, query.to);

    return this.repo.listReturns(tenantId, {
      page,
      limit,
      search:    query.search?.trim() || undefined,
      from,
      to,
      invoiceId: query.invoiceId,
    });
  }

  // ── Add Payment ───────────────────────────────────────────────────────────

  async addPayment(
    invoiceId: string,
    tenantId:  string,
    userId:    string,
    input:     AddPaymentInput,
    auditMeta?: { ipAddress?: string; userAgent?: string }
  ) {
    return this.repo.addPaymentEntry({
      tenantId,
      invoiceId,
      userId,
      amount:      input.amount,
      paymentMode: input.paymentMode,
      reference:   input.reference,
      notes:       input.notes,
      paidAt:      input.paidAt ? new Date(input.paidAt) : undefined,
      auditMeta,
    });
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────

  async getDashboardStats(tenantId: string) {
    return this.repo.getDashboardStats(tenantId);
  }

  // ── FIFO Batch ────────────────────────────────────────────────────────────

  async getFifoBatch(medicineId: string, tenantId: string, quantity: number) {
    const batch = await this.repo.getFifoBatch(medicineId, tenantId, quantity);
    if (!batch) {
      throw Object.assign(
        new Error(`No stock available for medicine ${medicineId} with quantity ${quantity}`),
        { statusCode: 404 }
      );
    }
    return batch;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private parseDateRange(from?: string, to?: string) {
    let fromDate: Date | undefined;
    let toDate:   Date | undefined;

    if (from && from !== "") {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        throw Object.assign(new Error("Invalid 'from' date — expected ISO 8601"), { statusCode: 400 });
      }
    }
    if (to && to !== "") {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        throw Object.assign(new Error("Invalid 'to' date — expected ISO 8601"), { statusCode: 400 });
      }
    }
    if (fromDate && toDate && fromDate > toDate) {
      throw Object.assign(new Error("'from' date must not be after 'to' date"), { statusCode: 400 });
    }

    return { from: fromDate, to: toDate };
  }

  private async validateCreditLimit(
    tenantId:   string,
    customerId: string,
    items:      CreateInvoiceInput["items"],
    batchMap:   Map<string, { mrp: number; medicine: { gstRate: number } }>
  ) {
    const customer = await this.app.prisma.customer.findFirst({
      where:  { id: customerId, tenantId },
      select: { creditLimit: true, creditUsed: true, customerType: true },
    });

    if (!customer) return; // will 404 at DB level

    if (customer.customerType !== "CREDIT") return; // only CREDIT customers have limits

    if (customer.creditLimit <= 0) return; // unlimited credit

    const estimatedTotal = items.reduce((sum, item) => {
      const batch = batchMap.get(item.inventoryId);
      if (!batch) return sum;
      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount ?? 0, batch.medicine.gstRate);
      return sum + gst.totalAmount;
    }, 0);

    const available = customer.creditLimit - customer.creditUsed;
    if (estimatedTotal > available + 0.01) {
      throw Object.assign(
        new Error(
          `Credit limit exceeded. Available: ₹${available.toFixed(2)}, required: ₹${estimatedTotal.toFixed(2)}`
        ),
        { statusCode: 422 }
      );
    }
  }
}
