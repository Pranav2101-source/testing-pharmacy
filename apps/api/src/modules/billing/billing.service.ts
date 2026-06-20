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
import { AppError } from "../../lib/AppError.js";
import { notifyOwners } from "../../lib/notifications.js";
import { enqueuePostInvoice } from "../../queues/queue.client.js";
import { TtlCache } from "../../lib/ttl-cache.js";

const MAX_PAGE_LIMIT = 100;

// Invoice settings change rarely (at most once per financial year). Cache for
// 5 minutes so each billing operation avoids a DB round-trip.
const SETTINGS_CACHE_TTL_S = 300;

// Dashboard stats: 30-second TTL; invalidated immediately on invoice writes
// so the UI refreshes after a sale without waiting for TTL expiry.
const STATS_CACHE_TTL_S = 30;

// Module-level singletons — one cache per concern, keyed by pharmacyId.
const settingsCache = new TtlCache<string, Awaited<ReturnType<BillingRepo["getSettings"]>>>();
const statsCache    = new TtlCache<string, DashboardStats>();

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
    const cached = settingsCache.get(pharmacyId);
    if (cached !== undefined) return cached;

    const settings = await this.repo.getSettings(pharmacyId);
    if (settings) settingsCache.set(pharmacyId, settings, SETTINGS_CACHE_TTL_S);
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

    // Credit limit is validated below, after all adjustments are applied to the total.
    // Validating here against raw item totals would incorrectly reject bills where
    // a bill discount brings the final amount within the customer's available credit.

    // ── IGST auto-detection ───────────────────────────────────────────────────
    // Fetch pharmacy + customer data in parallel. The customer select grabs all
    // fields needed downstream (IGST detection, customerName/Phone snapshot,
    // post-invoice queue payload) so this single query replaces what used to be
    // 3 separate customer fetches later in the flow.
    let isInterstate = input.isInterstate;

    const [pharmacyState, customerForIgst, medicineOverrides, doctorForSnapshot] = await Promise.all([
      this.app.prisma.pharmacy.findUnique({
        where:  { id: pharmacyId },
        select: { state: true, name: true },
      }),
      input.customerId
        ? this.app.prisma.customer.findFirst({
            // deletedAt: null — snapshot only from active record; soft-deleted customer
            // data is still used for the name/phone snapshot on the invoice but
            // should not drive IGST logic since the record may be stale.
            where:  { id: input.customerId, pharmacyId, deletedAt: null },
            select: { state: true, name: true, phone: true },
          })
        : Promise.resolve(null),
      // Per-pharmacy GST overrides — applied over the global catalog rate
      this.repo.getMedicineOverrides(pharmacyId, [...new Set(batches.map((b) => b.medicine.id))]),
      // Snapshot doctor registration number for regulatory invoices.
      input.doctorId
        ? this.app.prisma.doctor.findFirst({
            where:  { id: input.doctorId, pharmacyId },
            select: { registrationNo: true },
          })
        : Promise.resolve(null),
    ]);

    const overrideGstRate = new Map(
      medicineOverrides
        .filter((o) => o.gstRate !== null)
        .map((o) => [o.medicineId, o.gstRate as number]),
    );

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

    // Validate prescription exists, belongs to this pharmacy, and is usable
    if (input.prescriptionId) {
      const rx = await this.app.prisma.prescription.findFirst({
        where:  { id: input.prescriptionId, pharmacyId },
        select: { status: true },
      });
      if (!rx) throw AppError.notFound("Prescription not found");
      if (rx.status !== "ACTIVE" && rx.status !== "PARTIAL") {
        throw AppError.unprocessable(`Prescription is ${rx.status} and cannot be used for billing`);
      }
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

      const gstRate = overrideGstRate.get(batch.medicine.id) ?? batch.medicine.gstRate;
      const gst = calcGstFromMrp(batch.mrp, item.quantity, item.discount, gstRate, isInterstate);

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
        gstRate,
        rate:          parseFloat((batch.mrp * (1 - item.discount / 100)).toFixed(2)),
        taxableAmount: gst.taxableAmount,
        cgst:          gst.cgst,
        sgst:          gst.sgst,
        igst:          gst.igst,
        amount:        gst.totalAmount,
      });
    }

    const itemTotals = calcInvoiceTotals(
      lineItems.map((li) => ({ mrp: li.mrp, quantity: li.quantity, discount: li.discount, gstRate: li.gstRate })),
      isInterstate,
    );

    // ── Bill-level adjustments (applied post-tax; do not affect GST base) ────
    const billDiscountAmt = (input.billDiscountPct / 100) * itemTotals.totalAmount;
    // Clamp to 0 — a pharmacy invoice must never have a negative total.
    const preRound        = Math.max(
      0,
      itemTotals.totalAmount - billDiscountAmt + input.extraCharges + input.adjustmentAmount,
    );
    const roundOff   = Math.round(preRound) - preRound;
    const finalTotal = preRound + roundOff;

    const totals = {
      ...itemTotals,
      discountAmount: itemTotals.discountAmount + billDiscountAmt,
      totalAmount:    finalTotal,
    };

    // Credit limit is now enforced atomically inside createInvoiceTransactional (step 4)
    // via a conditional UPDATE that blocks when the limit would be exceeded. No pre-flight
    // check is needed here — a check here would recreate the TOCTOU race it was meant to prevent.

    const settings = await this.getSettings(pharmacyId);
    const config   = (settings?.settings as typeof defaultInvoiceSettings) ?? defaultInvoiceSettings;

    // The sequence is drawn from the document_sequences Postgres counter INSIDE
    // the repo transaction, after the idempotency check — duplicate submissions
    // never consume a number, and a rolled-back transaction returns its number
    // (gapless). The service only supplies the formatting.
    const formatInvoiceNumber = (seq: number) =>
      generateInvoiceNumber(
        config.numbering.prefix,
        seq,
        // financialYear is a string ("2025-26") in new configs, boolean in old ones
        !!config.numbering.financialYear,
        new Date(),
        config.numbering.separator  ?? "/",
        config.numbering.counterLength ?? 6,
      );

    const invoice = await this.repo.createInvoiceTransactional({
      pharmacyId,
      userId,
      idempotencyKey:        input.idempotencyKey,
      customerId:            input.customerId,
      totalAmount:           totals.totalAmount,
      paymentStatus:         input.paymentStatus,
      paymentMode:           input.paymentMode,
      formatInvoiceNumber,
      invoiceData: {
        pharmacy:      { connect: { id: pharmacyId } },
        user:          { connect: { id: userId } },
        ...(input.customerId ? { customer: { connect: { id: input.customerId } } } : {}),
        ...(input.doctorId   ? { doctor:   { connect: { id: input.doctorId   } } } : {}),
        // Snapshots — preserved even if the linked records change later
        customerName:   customerForIgst?.name  ?? null,
        customerPhone:  customerForIgst?.phone ?? null,
        doctorName:     input.doctorName,
        doctorRegNo:    doctorForSnapshot?.registrationNo ?? null,
        ...(input.prescriptionId ? { prescription: { connect: { id: input.prescriptionId } } } : {}),
        paymentMode:    input.paymentMode,
        paymentStatus:  input.paymentStatus,
        status:         "COMPLETED",
        notes:          [input.notes, input.deliveryNotes ? `[Delivery] ${input.deliveryNotes}` : ""].filter(Boolean).join("\n") || null,
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
            pharmacy:      { connect: { id: pharmacyId } },
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

    // Mark prescription as DISPENSED once the invoice is committed.
    if (input.prescriptionId) {
      await this.app.prisma.prescription.update({
        where: { id: input.prescriptionId },
        data:  { status: "DISPENSED" },
      }).catch((err: unknown) => {
        this.app.log.error({ err, prescriptionId: input.prescriptionId }, "Failed to mark prescription DISPENSED");
      });
    }

    // Fire-and-forget: enqueue post-invoice notifications (receipt, credit warning).
    // The invoice is already committed; pg-boss persists the job in Postgres and
    // retries on failure — no Redis required, no network hop delays the response.
    void enqueuePostInvoice({
      pharmacyId,
      invoiceId:     invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount:   totals.totalAmount,
      paymentMode:   input.paymentMode,
      customerId:    input.customerId ?? null,
    }).catch((err: unknown) => {
      this.app.log.error(err, "post-invoice enqueue failed");
    });

    // Evict dashboard stats so the next request reflects this sale immediately.
    statsCache.delete(pharmacyId);

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
      // Accept both plain dates (YYYY-MM-DD) and full ISO datetimes.
      // For plain dates, set `to` to end-of-day so invoices created on the
      // last selected day are included rather than cut off at midnight UTC.
      from: query.from ? new Date(query.from) : undefined,
      to:   query.to   ? (() => {
        const d = new Date(query.to!);
        // Only extend to end-of-day when the input is a plain date (no time component)
        if (!query.to!.includes("T")) { d.setUTCHours(23, 59, 59, 999); }
        return d;
      })() : undefined,
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
    statsCache.delete(pharmacyId);
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

    const formatReturnNumber = (seq: number) =>
      generateInvoiceNumber(
        (config.numbering.prefix ?? "INV") + "-RET",
        seq,
        !!config.numbering.financialYear,
        new Date(),
        config.numbering.separator  ?? "/",
        config.numbering.counterLength ?? 6,
      );

    return this.repo.createReturnTransactional({
      pharmacyId,
      invoiceId,
      userId,
      formatReturnNumber,
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
      from:      query.from ? new Date(query.from) : undefined,
      to:        query.to   ? (() => { const d = new Date(query.to!); if (!query.to!.includes("T")) d.setUTCHours(23, 59, 59, 999); return d; })() : undefined,
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

    statsCache.delete(pharmacyId);
    return payment;
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────

  async getDashboardStats(pharmacyId: string): Promise<DashboardStats> {
    const cached = statsCache.get(pharmacyId);
    if (cached !== undefined) return cached;

    const stats = await this.repo.getDashboardStats(pharmacyId);
    statsCache.set(pharmacyId, stats, STATS_CACHE_TTL_S);
    return stats;
  }

  // ── Invoice settings CRUD ─────────────────────────────────────────────────

  async getInvoiceSettings(pharmacyId: string) {
    const settings = await this.getSettings(pharmacyId);
    return settings?.settings ?? null;
  }

  async saveInvoiceSettings(
    pharmacyId: string,
    userId:     string,
    config:     Record<string, unknown>,
    auditMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    // Prisma's Json type requires an explicit cast from Record<string,unknown>
    const json = config as Parameters<typeof this.app.prisma.invoiceSettings.upsert>[0]["create"]["settings"];

    const result = await this.app.prisma.invoiceSettings.upsert({
      where:  { pharmacyId },
      update: { settings: json },
      create: { pharmacyId, settings: json },
    });

    await this.app.prisma.auditLog.create({
      data: {
        pharmacyId,
        userId,
        action:    "UPDATE",
        entity:    "InvoiceSettings",
        entityId:  pharmacyId,
        newData:   config as Parameters<typeof this.app.prisma.auditLog.create>[0]["data"]["newData"],
        ipAddress: auditMeta?.ipAddress,
        userAgent: auditMeta?.userAgent?.slice(0, 500),
      },
    });

    // Bust the settings cache so next billing op picks up the new config
    settingsCache.delete(pharmacyId);
    return result;
  }

  // ── Settings cache invalidation ───────────────────────────────────────────

  invalidateSettingsCache(pharmacyId: string): void {
    settingsCache.delete(pharmacyId);
  }

  // ── FEFO Batch ────────────────────────────────────────────────────────────

  async getFEFOBatch(medicineId: string, pharmacyId: string, quantity: number) {
    const batch = await this.repo.getFEFOBatch(medicineId, pharmacyId, quantity);
    if (!batch) {
      throw AppError.notFound(`No stock available for medicine ${medicineId} with quantity ${quantity}`);
    }
    return batch;
  }

}

