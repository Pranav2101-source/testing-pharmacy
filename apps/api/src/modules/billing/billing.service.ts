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
import type { InvoiceLineItem, DashboardStats } from "./billing.types.js";
import { INVOICE_SEQUENCE_KEY, RETURN_SEQUENCE_KEY } from "./billing.constants.js";
import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";
import { postInvoiceQueue } from "../../queues/queue.client.js";

const MAX_PAGE_LIMIT = 100;

// Invoice settings change rarely (at most once per financial year). Cache in
// Redis for 5 minutes so each billing operation doesn't need a DB round-trip.
const SETTINGS_CACHE_TTL_S = 300;
const settingsCacheKey = (pharmacyId: string) => `billing:settings:${pharmacyId}`;

// Dashboard stats are eventually-consistent by nature — a 30-second-old revenue
// figure is acceptable. Cache in Redis; invalidate explicitly on invoice writes
// so the UI refreshes immediately after a sale without waiting for TTL expiry.
const STATS_CACHE_TTL_S = 30;
const statsCacheKey = (pharmacyId: string) => `dashboard:stats:${pharmacyId}`;

export class BillingService {
  private repo: BillingRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new BillingRepo(app.prisma);
  }

  // ── Cached settings fetch ─────────────────────────────────────────────────
  // Returns the parsed settings object, falling through to DB on cache miss.
  // A settings change in the UI should call invalidateSettingsCache to ensure
  // the next billing op sees the updated config within 5 minutes at most.

  private async getSettings(pharmacyId: string): ReturnType<BillingRepo["getSettings"]> {
    const key    = settingsCacheKey(pharmacyId);
    const cached = await this.app.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as Awaited<ReturnType<BillingRepo["getSettings"]>>;
      } catch {
        // Corrupt cache entry — fall through to DB
      }
    }

    const settings = await this.repo.getSettings(pharmacyId);
    if (settings) {
      await this.app.redis.set(key, JSON.stringify(settings), "EX", SETTINGS_CACHE_TTL_S);
    }
    return settings;
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

    // ── IGST auto-detection ───────────────────────────────────────────────────
    // Fetch pharmacy + customer data in parallel. The customer select grabs all
    // fields needed downstream (IGST detection, customerName/Phone snapshot,
    // post-invoice queue payload) so this single query replaces what used to be
    // 3 separate customer fetches later in the flow.
    let isInterstate = input.isInterstate;

    const [pharmacyState, customerForIgst] = await Promise.all([
      this.app.prisma.pharmacy.findUnique({
        where:  { id: pharmacyId },
        select: { state: true, name: true },
      }),
      input.customerId
        ? this.app.prisma.customer.findFirst({
            where:  { id: input.customerId, pharmacyId },
            select: { state: true, name: true, phone: true },
          })
        : Promise.resolve(null),
    ]);

    if (pharmacyState?.state) {
      if (customerForIgst?.state) {
        // Both states known — auto-determine; state codes are case-insensitive ("MH" === "mh")
        isInterstate = customerForIgst.state.toUpperCase() !== pharmacyState.state.toUpperCase();
      } else {
        // Walk-in or customer state not on file → treat as intra-state
        isInterstate = false;
      }
    }
    // Pharmacy state not configured → honour the manual toggle from the frontend

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
      if (batch.status && batch.status !== "ACTIVE") {
        throw AppError.unprocessable(
          `Batch "${batch.batchNumber}" of "${batch.medicine.name}" is ${batch.status} and cannot be sold`,
        );
      }
      if (batch.expiryDate <= now) {
        throw AppError.unprocessable(
          `Batch "${batch.batchNumber}" of "${batch.medicine.name}" expired on ${batch.expiryDate.toISOString().split("T")[0]}`,
        );
      }
      // Quantity is NOT checked here. The authoritative check is inside
      // createInvoiceTransactional at Serializable isolation, where it reads
      // the current quantity atomically. A pre-flight check here would use
      // stale data (ignoring reservedQuantity from other sessions) and produce
      // misleading error messages under concurrent billing.

      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount, batch.medicine.gstRate, isInterstate);

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
        igst:          gst.igst,
        amount:        gst.totalAmount,
      });
    }

    const totals = calcInvoiceTotals(
      lineItems.map((li) => ({ mrp: li.mrp, quantity: li.quantity, discount: li.discount, gstRate: li.gstRate })),
      isInterstate,
    );

    const settings = await this.getSettings(pharmacyId);
    const config   = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;

    // Generator is called inside the transaction, AFTER the idempotency check.
    // This prevents duplicate requests from advancing the Redis sequence counter
    // and eliminates gaps caused by transactions that roll back before inserting.
    const makeInvoiceNumber = async () => {
      const seq = await this.app.redis.incr(INVOICE_SEQUENCE_KEY(pharmacyId));
      return generateInvoiceNumber(
        config.numbering.prefix,
        seq,
        config.numbering.financialYear,
      );
    };

    const invoice = await this.repo.createInvoiceTransactional({
      pharmacyId,
      userId,
      idempotencyKey:        input.idempotencyKey,
      customerId:            input.customerId,
      totalAmount:           totals.totalAmount,
      paymentStatus:         input.paymentStatus,
      paymentMode:           input.paymentMode,
      generateInvoiceNumber: makeInvoiceNumber,
      invoiceData: {
        pharmacy:      { connect: { id: pharmacyId } },
        user:          { connect: { id: userId } },
        ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
        // Snapshot — preserved even if the customer record changes later
        customerName:   customerForIgst?.name  ?? null,
        customerPhone:  customerForIgst?.phone ?? null,
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
        igst:           totals.igst,
        totalGst:       totals.totalGst,
        totalAmount:    totals.totalAmount,
        isInterstate,
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
            igst:          li.igst,
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

    // ── Post-invoice side-effects ─────────────────────────────────────────────

    // Enqueue notifications (receipt + credit warning) in BullMQ.
    // The worker runs asynchronously so the billing response is not blocked by
    // SMTP latency, and BullMQ retries on SMTP failure (unlike fire-and-forget).
    await postInvoiceQueue.add(
      "post-invoice",
      {
        pharmacyId,
        invoiceId:     invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount:   totals.totalAmount,
        paymentMode:   input.paymentMode,
        customerId:    input.customerId ?? null,
      },
      {
        attempts:         3,
        backoff:          { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 20 },
        removeOnFail:     { count: 5 },
      },
    );

    // Invalidate the dashboard stats cache so the next load reflects this sale.
    void this.app.redis.del(statsCacheKey(pharmacyId));

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
    const result = await this.repo.cancelInvoiceTransactional({ invoiceId: id, pharmacyId, userId, reason, auditMeta });
    void this.app.redis.del(statsCacheKey(pharmacyId));
    return result;
  }

  // ── Create Sales Return ───────────────────────────────────────────────────

  async createReturn(
    invoiceId:  string,
    pharmacyId: string,
    userId:     string,
    input:      CreateReturnInput,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const settings     = await this.repo.getSettings(pharmacyId);
    const config       = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;
    const returnWindowDays = config.policy?.returnWindowDays ?? defaultInvoiceSettings.policy!.returnWindowDays;

    const makeReturnNumber = async () => {
      const seq = await this.app.redis.incr(RETURN_SEQUENCE_KEY(pharmacyId));
      return generateInvoiceNumber(
        (config.numbering.prefix ?? "INV") + "-RET",
        seq,
        config.numbering.financialYear,
      );
    };

    return this.repo.createReturnTransactional({
      pharmacyId,
      invoiceId,
      userId,
      generateReturnNumber: makeReturnNumber,
      reason:               input.reason,
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
        subject: `Credit settled — ${invoice.customer?.name ?? "Customer"}`,
        message: `Invoice ${invoice.invoiceNumber} (₹${invoice.totalAmount.toFixed(2)}) has been fully settled by ${invoice.customer?.name ?? "customer"}.`,
      });
    }

    void this.app.redis.del(statsCacheKey(pharmacyId));
    return payment;
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────

  async getDashboardStats(pharmacyId: string): Promise<DashboardStats> {
    const key    = statsCacheKey(pharmacyId);
    const cached = await this.app.redis.get(key);
    if (cached) {
      try { return JSON.parse(cached) as DashboardStats; } catch { /* corrupt — fall through */ }
    }
    const stats = await this.repo.getDashboardStats(pharmacyId);
    await this.app.redis.set(key, JSON.stringify(stats), "EX", STATS_CACHE_TTL_S);
    return stats;
  }

  // ── Settings cache invalidation ───────────────────────────────────────────
  // Call this from the invoice-settings update route so the next billing op
  // picks up the new config immediately instead of waiting for TTL expiry.

  async invalidateSettingsCache(pharmacyId: string) {
    await this.app.redis.del(settingsCacheKey(pharmacyId));
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
