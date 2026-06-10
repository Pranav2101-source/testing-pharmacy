import type { FastifyInstance } from "fastify";
import { PurchasesRepo } from "./purchases.repo.js";
import type {
  CreatePOInput, UpdatePOInput, ListPOQuery, ApprovePOInput, SharePOInput,
  CreateGRNInput, UpdateGRNInput, ListGRNQuery, AutoSuggestQuery,
} from "./purchases.schema.js";
import type { ImportedGRNRow } from "./purchases.import.js";
import { AppError } from "../../lib/AppError.js";
import {
  PO_SEQUENCE_KEY, generatePONumber,
  GRN_SEQUENCE_KEY, generateGRNNumber,
} from "../billing/billing.constants.js";

const NEAR_EXPIRY_DAYS = 90; // warn if any GRN item expires within 90 days

function calcLineGST(purchaseRate: number, quantity: number, gstRate: number) {
  const lineTotal = purchaseRate * quantity;
  const cgst      = (lineTotal * gstRate) / 100 / 2;
  const sgst      = cgst;
  return { lineTotal, cgst, sgst, amount: lineTotal + cgst + sgst };
}

function calcGRNLineAmount(purchaseRate: number, receivedQty: number, discount: number, gstRate: number) {
  const lineTotal  = purchaseRate * receivedQty;
  const discounted = lineTotal * (1 - discount / 100);
  const cgst       = (discounted * gstRate) / 100 / 2;
  const sgst       = cgst;
  return { lineTotal: discounted, cgst, sgst, amount: discounted + cgst + sgst };
}

export class PurchasesService {
  private repo: PurchasesRepo;

  constructor(private app: FastifyInstance) {
    this.repo = new PurchasesRepo(app.prisma);
  }

  // ── Purchase Orders ────────────────────────────────────────────────────────

  async createPO(pharmacyId: string, userId: string, userRole: string, input: CreatePOInput) {
    let subtotal = 0;
    let totalGst = 0;

    const items = input.items.map((item) => {
      const { lineTotal, cgst, sgst, amount } = calcLineGST(item.purchaseRate, item.quantity, item.gstRate);
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
        amount,
      };
    });

    // PHARMACIST-created POs need OWNER approval; OWNER auto-approves
    const approvalStatus = userRole === "OWNER" ? "NOT_REQUIRED" : "PENDING_APPROVAL";

    // Generate order number via Redis INCR (financial-year scoped) so concurrent
    // creates never collide — replacing the COUNT(*)-based approach that races.
    let seq: number;
    try {
      seq = await this.app.redis.incr(PO_SEQUENCE_KEY(pharmacyId));
    } catch {
      throw AppError.internal("We couldn't generate an order number right now. Please try again in a moment.");
    }
    const orderNumber = generatePONumber(seq);

    return this.repo.createPO(pharmacyId, userId, {
      orderNumber,
      supplierId:    input.supplierId,
      invoiceNo:     input.invoiceNo,
      notes:         input.notes,
      expectedDate:  input.expectedDate ? new Date(input.expectedDate) : undefined,
      approvalStatus,
      items,
      subtotal,
      totalGst,
      totalAmount: subtotal + totalGst,
    });
  }

  async updatePO(id: string, pharmacyId: string, userId: string, input: UpdatePOInput) {
    let subtotal: number | undefined;
    let totalGst: number | undefined;

    const items = input.items?.map((item) => {
      const { lineTotal, cgst, sgst, amount } = calcLineGST(item.purchaseRate, item.quantity, item.gstRate);
      subtotal = (subtotal ?? 0) + lineTotal;
      totalGst = (totalGst ?? 0) + cgst + sgst;
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
        amount,
      };
    });

    return this.repo.updatePO(id, pharmacyId, userId, {
      invoiceNo:    input.invoiceNo,
      notes:        input.notes,
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : undefined,
      items,
      subtotal,
      totalGst,
      totalAmount: subtotal !== undefined && totalGst !== undefined ? subtotal + totalGst : undefined,
    });
  }

  async approvePO(id: string, pharmacyId: string, userId: string, input: ApprovePOInput) {
    return this.repo.approvePO(id, pharmacyId, userId, input.approved, input.rejectionReason);
  }

  async sendPO(id: string, pharmacyId: string, userId: string) {
    return this.repo.sendPO(id, pharmacyId, userId);
  }

  async cancelPO(id: string, pharmacyId: string, userId: string) {
    return this.repo.cancelPO(id, pharmacyId, userId);
  }

  async getPOById(id: string, pharmacyId: string) {
    const po = await this.repo.getPOById(id, pharmacyId);
    if (!po) throw AppError.notFound("Purchase order not found");
    return po;
  }

  async listPOs(pharmacyId: string, query: ListPOQuery) {
    return this.repo.listPOs(pharmacyId, {
      page:           query.page,
      limit:          query.limit,
      status:         query.status,
      approvalStatus: query.approvalStatus,
      supplierId:     query.supplierId,
      from:           query.from ? new Date(query.from) : undefined,
      to:             query.to   ? new Date(query.to)   : undefined,
      search:         query.search,
    });
  }

  // ── PO Sharing (#26) ───────────────────────────────────────────────────────

  async sharePO(id: string, pharmacyId: string, input: SharePOInput) {
    const po = await this.repo.getPOById(id, pharmacyId);
    if (!po) throw AppError.notFound("Purchase order not found");

    const message =
      `Purchase Order: ${po.orderNumber}\n` +
      `Items: ${(po.items as any[]).length}\n` +
      `Total: ₹${po.totalAmount.toFixed(2)}\n` +
      `Please confirm availability and delivery date.`;

    await this.app.prisma.notificationLog.create({
      data: {
        pharmacyId,
        type:      input.method === "EMAIL" ? "EMAIL" : "WHATSAPP",
        recipient: input.recipient,
        subject:   `Purchase Order ${po.orderNumber}`,
        message,
        status:    "PENDING",
      },
    });

    return { sent: true, orderNumber: po.orderNumber, method: input.method };
  }

  // ── GRN ───────────────────────────────────────────────────────────────────

  async createGRN(pharmacyId: string, userId: string, input: CreateGRNInput) {
    // #20 Duplicate invoice detection — check supplierInvoiceNo uniqueness per supplier
    if (input.supplierInvoiceNo) {
      const duplicate = await this.app.prisma.goodsReceiptNote.findFirst({
        where: {
          pharmacyId,
          supplierId:       input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          status:           { not: "CANCELLED" },
        },
        select: { grnNumber: true },
      });
      if (duplicate) {
        throw AppError.unprocessable(
          `Supplier invoice ${input.supplierInvoiceNo} is already saved as GRN ${duplicate.grnNumber}. You may be adding the same delivery twice.`
        );
      }
    }

    // Warn if supplier invoice number is missing — without it, duplicate GRNs for the
    // same delivery cannot be detected. The warning is returned in the response so the
    // frontend can surface it, but it does not block creation.
    const missingInvoiceWarning = !input.supplierInvoiceNo
      ? "No supplier invoice number was entered. Without it, we can't detect if this delivery is accidentally added twice."
      : null;

    // #21 Near-expiry purchase validation — reject items expiring within 90 days
    // unless the caller has explicitly acknowledged the risk via allowNearExpiry.
    // Pharmacies occasionally buy near-expiry stock at a discount; the flag lets
    // them bypass the guard while still making the risk visible in the UI.
    if (!input.allowNearExpiry) {
      const nearExpiryThreshold = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const nearExpiryItems = input.items.filter((item) => new Date(item.expiryDate) <= nearExpiryThreshold);
      if (nearExpiryItems.length > 0) {
        const names = nearExpiryItems.map((i) => i.medicineName).join(", ");
        throw AppError.unprocessable(
          `The following items expire within ${NEAR_EXPIRY_DAYS} days: ${names}. ` +
          `If you still want to add them (e.g. bought at a discount), tick "Allow near-expiry stock" and try again.`,
        );
      }
    }

    let subtotal = 0;
    let totalGst = 0;

    const items = input.items.map((item) => {
      const { lineTotal, cgst, sgst, amount } = calcGRNLineAmount(item.purchaseRate, item.receivedQty, item.discount, item.gstRate);
      subtotal += lineTotal;
      totalGst += cgst + sgst;
      return {
        medicineId:   item.medicineId,
        medicineName: item.medicineName,
        batchNumber:  item.batchNumber,
        expiryDate:   new Date(item.expiryDate),
        orderedQty:   item.orderedQty,
        receivedQty:  item.receivedQty,
        freeQty:      item.freeQty,
        purchaseRate: item.purchaseRate,
        mrp:          item.mrp,
        discount:     item.discount,
        gstRate:      item.gstRate,
        cgst,
        sgst,
        amount,
      };
    });

    // Generate GRN number via Redis INCR — same race-safe pattern as invoices.
    let grnSeq: number;
    try {
      grnSeq = await this.app.redis.incr(GRN_SEQUENCE_KEY(pharmacyId));
    } catch {
      throw AppError.internal("We couldn't generate a GRN number right now. Please try again in a moment.");
    }
    const grnNumber = generateGRNNumber(grnSeq);

    const grn = await this.repo.createGRN(pharmacyId, userId, {
      grnNumber,
      supplierId:          input.supplierId,
      purchaseOrderId:     input.purchaseOrderId,
      supplierInvoiceNo:   input.supplierInvoiceNo,
      supplierInvoiceDate: input.supplierInvoiceDate ? new Date(input.supplierInvoiceDate) : undefined,
      notes:               input.notes,
      items,
      subtotal,
      totalGst,
      totalAmount: subtotal + totalGst,
    });

    return { ...grn, warning: missingInvoiceWarning };
  }

  async updateGRN(id: string, pharmacyId: string, userId: string, input: UpdateGRNInput) {
    if (!input.allowNearExpiry && input.items) {
      const nearExpiryThreshold = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      const nearExpiryItems = input.items.filter((item) => new Date(item.expiryDate) <= nearExpiryThreshold);
      if (nearExpiryItems.length > 0) {
        const names = nearExpiryItems.map((i) => i.medicineName).join(", ");
        throw AppError.unprocessable(
          `The following items expire within ${NEAR_EXPIRY_DAYS} days: ${names}. ` +
          `If you still want to add them (e.g. bought at a discount), tick "Allow near-expiry stock" and try again.`,
        );
      }
    }

    let subtotal: number | undefined;
    let totalGst: number | undefined;

    const items = input.items?.map((item) => {
      const { lineTotal, cgst, sgst, amount } = calcGRNLineAmount(item.purchaseRate, item.receivedQty, item.discount, item.gstRate);
      subtotal = (subtotal ?? 0) + lineTotal;
      totalGst = (totalGst ?? 0) + cgst + sgst;
      return {
        medicineId:   item.medicineId,
        medicineName: item.medicineName,
        batchNumber:  item.batchNumber,
        expiryDate:   new Date(item.expiryDate),
        orderedQty:   item.orderedQty,
        receivedQty:  item.receivedQty,
        freeQty:      item.freeQty,
        purchaseRate: item.purchaseRate,
        mrp:          item.mrp,
        discount:     item.discount,
        gstRate:      item.gstRate,
        cgst,
        sgst,
        amount,
      };
    });

    return this.repo.updateGRN(id, pharmacyId, userId, {
      supplierInvoiceNo:   input.supplierInvoiceNo,
      supplierInvoiceDate: input.supplierInvoiceDate ? new Date(input.supplierInvoiceDate) : undefined,
      notes:               input.notes,
      items,
      subtotal,
      totalGst,
      totalAmount: subtotal !== undefined && totalGst !== undefined ? subtotal + totalGst : undefined,
    });
  }

  async confirmGRN(id: string, pharmacyId: string, userId: string) {
    return this.repo.confirmGRN(id, pharmacyId, userId);
  }

  async cancelGRN(id: string, pharmacyId: string, userId: string) {
    return this.repo.cancelGRN(id, pharmacyId, userId);
  }

  async getGRNById(id: string, pharmacyId: string) {
    const grn = await this.repo.getGRNById(id, pharmacyId);
    if (!grn) throw AppError.notFound("GRN not found");
    return grn;
  }

  async listGRNs(pharmacyId: string, query: ListGRNQuery) {
    return this.repo.listGRNs(pharmacyId, {
      page:       query.page,
      limit:      query.limit,
      status:     query.status,
      supplierId: query.supplierId,
      from:       query.from ? new Date(query.from) : undefined,
      to:         query.to   ? new Date(query.to)   : undefined,
      overdue:    query.overdue,
    });
  }

  // ── Auto Purchase Suggestions (#3) ─────────────────────────────────────────

  async getAutoSuggestions(pharmacyId: string, query: AutoSuggestQuery) {
    return this.repo.getAutoSuggestions(pharmacyId, query.daysThreshold, query.supplierId);
  }

  // ── Bulk CSV Import (#29) ──────────────────────────────────────────────────
  // Resolves medicineName → medicineId via DB lookup, then creates a DRAFT GRN.

  async importGRNFromCSV(pharmacyId: string, userId: string, supplierId: string, rows: ImportedGRNRow[], allowNearExpiry = false) {
    // Resolve medicineIds by name — case-insensitive
    const names    = [...new Set(rows.map((r) => r.medicineName))];
    const medicines = await this.app.prisma.medicine.findMany({
      where:  { name: { in: names, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    const nameToId = new Map(medicines.map((m) => [m.name.toLowerCase(), m.id]));
    const unmatched = names.filter((n) => !nameToId.has(n.toLowerCase()));
    if (unmatched.length > 0) {
      throw AppError.unprocessable(`Medicines not found in catalog: ${unmatched.join(", ")}`);
    }

    // Group by supplierInvoiceNo — one GRN per invoice
    const groups = new Map<string, ImportedGRNRow[]>();
    for (const row of rows) {
      const key = row.supplierInvoiceNo ?? "__default__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const created = [];
    for (const [invoiceNo, groupRows] of groups) {
      const input: CreateGRNInput = {
        supplierId,
        supplierInvoiceNo: invoiceNo !== "__default__" ? invoiceNo : undefined,
        allowNearExpiry,
        items: groupRows.map((r) => ({
          medicineId:       nameToId.get(r.medicineName.toLowerCase())!,
          medicineName:     r.medicineName,
          batchNumber:      r.batchNumber,
          expiryDate:       r.expiryDate,
          receivedQty:      r.receivedQty,
          freeQty:          r.freeQty,
          purchaseUnit:     "UNIT" as const,
          conversionFactor: 1,
          purchaseRate:     r.purchaseRate,
          mrp:              r.mrp,
          discount:         r.discount,
          gstRate:          r.gstRate,
        })),
      };
      const grn = await this.createGRN(pharmacyId, userId, input);
      created.push({ grnId: grn.id, grnNumber: grn.grnNumber, itemCount: groupRows.length });
    }

    return { grnsCreated: created.length, grns: created };
  }
}
