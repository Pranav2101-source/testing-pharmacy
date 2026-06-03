import type { FastifyInstance } from "fastify";
import { BillingRepo } from "./billing.repo.js";
import { calcGstFromMrp, calcInvoiceTotals } from "@pharmacy/utils";
import { generateInvoiceNumber } from "@pharmacy/utils";
import { defaultInvoiceSettings } from "@pharmacy/types";
import type {
  CreateInvoiceInput,
  CreateReturnInput,
  AddPaymentInput,
  ListInvoicesQuery,
  ListReturnsQuery,
} from "./billing.schema.js";
import type { InvoiceLineItem } from "./billing.types.js";
import { INVOICE_SEQUENCE_KEY, RETURN_SEQUENCE_KEY } from "./billing.constants.js";
import { AppError } from "../../lib/AppError.js";
import { notifyOwners, sendNotification } from "../../lib/notifications.js";

const MAX_PAGE_LIMIT = 100;

export class BillingService {
  private repo: BillingRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new BillingRepo(app.prisma);
  }

  // ── Create Invoice ────────────────────────────────────────────────────────

  async createInvoice(
    pharmacyId: string,
    userId:     string,
    input:      CreateInvoiceInput,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const inventoryIds = input.items.map((i) => i.inventoryId);
    if (new Set(inventoryIds).size !== inventoryIds.length) {
      throw AppError.badRequest("Duplicate inventory items in a single invoice are not allowed");
    }

    const batches  = await this.repo.getInventoryBatches(inventoryIds, pharmacyId);
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const now      = new Date();

    if (input.customerId && input.paymentMode === "CREDIT") {
      await this.validateCreditLimit(pharmacyId, input.customerId, input.items, batchMap);
    }

    // Schedule H / H1 / X medicines require a prescription reference (Indian Drug Rules)
    const CONTROLLED = new Set(["H", "H1", "X"]);
    const controlled: string[] = [];
    for (const item of input.items) {
      const batch    = batchMap.get(item.inventoryId);
      const schedule = batch?.medicine.schedule?.toUpperCase().trim();
      if (schedule && CONTROLLED.has(schedule)) {
        controlled.push(`${batch!.medicine.name} (Schedule ${schedule})`);
      }
    }
    if (controlled.length > 0 && !input.prescriptionId) {
      throw AppError.unprocessable(
        `Prescription required for controlled medicine(s): ${controlled.join(", ")}. ` +
        `Provide a valid prescriptionId to proceed.`,
      );
    }

    const lineItems: InvoiceLineItem[] = [];

    for (const item of input.items) {
      const batch = batchMap.get(item.inventoryId);
      if (!batch) throw AppError.notFound(`Inventory item not found: ${item.inventoryId}`);

      if (!batch.medicine.isActive) {
        throw AppError.unprocessable(`Medicine "${batch.medicine.name}" is inactive and cannot be billed`);
      }
      if ((batch as any).status && (batch as any).status !== "ACTIVE") {
        throw AppError.unprocessable(
          `Batch "${batch.batchNumber}" of "${batch.medicine.name}" is ${(batch as any).status} and cannot be sold`,
        );
      }
      if (batch.expiryDate <= now) {
        throw AppError.unprocessable(
          `Batch "${batch.batchNumber}" of "${batch.medicine.name}" expired on ${batch.expiryDate.toISOString().split("T")[0]}`,
        );
      }
      if (batch.quantity < item.quantity) {
        throw AppError.conflict(
          `Insufficient stock for "${batch.medicine.name}": ${batch.quantity} available, ${item.quantity} requested`,
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
        purchaseRate:  batch.purchaseRate,
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
      lineItems.map((li) => ({ mrp: li.mrp, quantity: li.quantity, discount: li.discount, gstRate: li.gstRate })),
    );

    const seq           = await this.app.redis.incr(INVOICE_SEQUENCE_KEY(pharmacyId));
    const settings      = await this.repo.getSettings(pharmacyId);
    const config        = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;
    const invoiceNumber = generateInvoiceNumber(
      config.numbering.prefix,
      seq,
      config.numbering.financialYear,
    );

    const invoice = await this.repo.createInvoiceTransactional({
      pharmacyId,
      userId,
      idempotencyKey: input.idempotencyKey,
      customerId:     input.customerId,
      totalAmount:    totals.totalAmount,
      paymentStatus:  input.paymentStatus,
      paymentMode:    input.paymentMode,
      invoiceData: {
        pharmacy:      { connect: { id: pharmacyId } },
        user:          { connect: { id: userId } },
        ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
        invoiceNumber,
        doctorName:     input.doctorName,
        prescriptionId: input.prescriptionId,
        paymentMode:    input.paymentMode,
        paymentStatus:  input.paymentStatus,
        status:         "COMPLETED",
        notes:          input.notes,
        idempotencyKey: input.idempotencyKey,
        subtotal:       totals.subtotal,
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
            purchaseRate:  li.purchaseRate,
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

    // ── Post-invoice notifications (fire-and-forget) ──────────────────────

    // 1. Invoice copy to customer (if they have an email on file)
    if (input.customerId) {
      const customer = await this.app.prisma.customer.findFirst({
        where:  { id: input.customerId, pharmacyId },
        select: { email: true, name: true },
      });
      if (customer?.email) {
        const pharmacy = await this.app.prisma.pharmacy.findUnique({
          where:  { id: pharmacyId },
          select: { name: true },
        });
        void sendNotification(this.app.prisma, {
          pharmacyId,
          recipient: customer.email,
          subject:   `Your bill from ${pharmacy?.name ?? "Pharmacy"} — ₹${totals.totalAmount.toFixed(2)}`,
          message:   `Invoice ${invoice.invoiceNumber} for ₹${totals.totalAmount.toFixed(2)}.\nPayment: ${input.paymentMode}.\nThank you for your purchase!`,
        });
      }
    }

    // 2. Credit limit warning to owner when usage crosses 80%
    if (input.customerId && input.paymentMode === "CREDIT") {
      const customer = await this.app.prisma.customer.findFirst({
        where:  { id: input.customerId, pharmacyId },
        select: { name: true, creditLimit: true, creditUsed: true },
      });
      if (customer !== null && customer.creditLimit > 0) {
        const usedPct = (customer.creditUsed / customer.creditLimit) * 100;
        if (usedPct >= 80) {
          void notifyOwners(this.app.prisma, pharmacyId, {
            subject: `⚠️ Credit limit warning — ${customer.name}`,
            message: `${customer.name} has used ₹${customer.creditUsed.toFixed(2)} of ₹${customer.creditLimit.toFixed(2)} (${usedPct.toFixed(0)}%). Invoice: ${invoice.invoiceNumber}.`,
          });
        }
      }
    }

    return invoice;
  }

  // ── Get Invoice ───────────────────────────────────────────────────────────

  async getInvoice(id: string, pharmacyId: string) {
    const invoice = await this.repo.getInvoice(id, pharmacyId);
    if (!invoice) throw AppError.notFound("Invoice not found");
    return invoice;
  }

  // ── List Invoices ─────────────────────────────────────────────────────────

  async listInvoices(pharmacyId: string, query: ListInvoicesQuery) {
    return this.repo.listInvoices(pharmacyId, {
      page:             Math.max(1, query.page),
      limit:            Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit)),
      search:           query.search?.trim() || undefined,
      // Dates arrive as ISO 8601 with timezone offset (validated by Zod),
      // so new Date() parses them correctly to UTC.
      from:             query.from  ? new Date(query.from)  : undefined,
      to:               query.to    ? new Date(query.to)    : undefined,
      status:           query.status,
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
    id:         string,
    pharmacyId: string,
    userId:     string,
    reason:     string,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    return this.repo.cancelInvoiceTransactional({ invoiceId: id, pharmacyId, userId, reason, auditMeta });
  }

  // ── Create Sales Return ───────────────────────────────────────────────────

  async createReturn(
    invoiceId:  string,
    pharmacyId: string,
    userId:     string,
    input:      CreateReturnInput,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const seq          = await this.app.redis.incr(RETURN_SEQUENCE_KEY(pharmacyId));
    const settings     = await this.repo.getSettings(pharmacyId);
    const config       = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;
    const returnNumber = generateInvoiceNumber(
      (config.numbering.prefix ?? "INV") + "-RET",
      seq,
      config.numbering.financialYear,
    );
    // policy.returnWindowDays: 0 = no limit; absent in older settings rows → fall back to default 30
    const returnWindowDays = config.policy?.returnWindowDays ?? defaultInvoiceSettings.policy!.returnWindowDays;

    return this.repo.createReturnTransactional({
      pharmacyId,
      invoiceId,
      userId,
      returnNumber,
      reason:            input.reason,
      idempotencyKey:    input.idempotencyKey,
      returnWindowDays,
      returnItems:       input.items.map((i) => ({ ...i, disposition: i.disposition as "RESTOCK" | "WRITEOFF" })),
      auditMeta,
    });
  }

  // ── Get Return ────────────────────────────────────────────────────────────

  async getReturn(id: string, pharmacyId: string) {
    const ret = await this.repo.getReturn(id, pharmacyId);
    if (!ret) throw AppError.notFound("Return not found");
    return ret;
  }

  // ── List Returns ──────────────────────────────────────────────────────────

  async listReturns(pharmacyId: string, query: ListReturnsQuery) {
    return this.repo.listReturns(pharmacyId, {
      page:      Math.max(1, query.page),
      limit:     Math.min(MAX_PAGE_LIMIT, Math.max(1, query.limit)),
      search:    query.search?.trim() || undefined,
      from:      query.from  ? new Date(query.from)  : undefined,
      to:        query.to    ? new Date(query.to)    : undefined,
      invoiceId: query.invoiceId,
    });
  }

  // ── Add Payment ───────────────────────────────────────────────────────────

  async addPayment(
    invoiceId:  string,
    pharmacyId: string,
    userId:     string,
    input:      AddPaymentInput,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const payment = await this.repo.addPaymentEntry({
      pharmacyId,
      invoiceId,
      userId,
      amount:      input.amount,
      paymentMode: input.paymentMode,
      reference:   input.reference,
      notes:       input.notes,
      paidAt:      input.paidAt ? new Date(input.paidAt) : undefined,
      auditMeta,
    });

    // Notify owner when a credit invoice is fully settled
    const invoice = await this.repo.getInvoice(invoiceId, pharmacyId);
    if (invoice?.paymentStatus === "PAID" && invoice.paymentMode === "CREDIT" && invoice.customerId) {
      void notifyOwners(this.app.prisma, pharmacyId, {
        subject: `✅ Credit settled — ${invoice.customer?.name ?? "Customer"}`,
        message: `Invoice ${invoice.invoiceNumber} (₹${invoice.totalAmount.toFixed(2)}) has been fully settled by ${invoice.customer?.name ?? "customer"}.`,
      });
    }

    return payment;
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────

  async getDashboardStats(pharmacyId: string) {
    return this.repo.getDashboardStats(pharmacyId);
  }

  // ── FIFO Batch ────────────────────────────────────────────────────────────

  async getFifoBatch(medicineId: string, pharmacyId: string, quantity: number) {
    const batch = await this.repo.getFifoBatch(medicineId, pharmacyId, quantity);
    if (!batch) {
      throw AppError.notFound(`No stock available for medicine ${medicineId} with quantity ${quantity}`);
    }
    return batch;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async validateCreditLimit(
    pharmacyId: string,
    customerId: string,
    items:      CreateInvoiceInput["items"],
    batchMap:   Map<string, { mrp: number; medicine: { gstRate: number } }>,
  ) {
    const customer = await this.app.prisma.customer.findFirst({
      where:  { id: customerId, pharmacyId },
      select: { creditLimit: true, creditUsed: true, customerType: true },
    });

    if (!customer)                          return;
    if (customer.customerType !== "CREDIT") return;
    if (customer.creditLimit <= 0)          return;

    const estimatedTotal = items.reduce((sum, item) => {
      const batch = batchMap.get(item.inventoryId);
      if (!batch) return sum;
      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount ?? 0, batch.medicine.gstRate);
      return sum + gst.totalAmount;
    }, 0);

    const available = customer.creditLimit - customer.creditUsed;
    if (estimatedTotal > available + 0.01) {
      throw AppError.unprocessable(
        `Credit limit exceeded. Available: ₹${available.toFixed(2)}, required: ₹${estimatedTotal.toFixed(2)}`,
      );
    }
  }
}
