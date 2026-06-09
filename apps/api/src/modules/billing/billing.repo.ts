import type { PrismaClient, Prisma, PaymentMode, PaymentStatus, InvoiceStatus } from "@pharmacy/database";
import type { PendingMovement } from "./billing.types.js";
import { AppError } from "../../lib/AppError.js";

// ─── Shared include shapes ────────────────────────────────────────────────────

const INVOICE_INCLUDE = {
  items:    true,
  customer: { select: { id: true, name: true, phone: true, email: true } },
  user:     { select: { id: true, name: true } },
  payments: { orderBy: { paidAt: "asc" as const } },
  returns:  { select: { id: true, returnNumber: true, totalAmount: true, createdAt: true } },
} satisfies Prisma.InvoiceInclude;

const RETURN_INCLUDE = {
  items:    { include: { inventory: { select: { medicine: { select: { name: true } } } } } },
  customer: { select: { id: true, name: true, phone: true } },
  user:     { select: { id: true, name: true } },
  invoice:  { select: { id: true, invoiceNumber: true } },
} satisfies Prisma.SalesReturnInclude;

// ─────────────────────────────────────────────────────────────────────────────

export class BillingRepo {
  constructor(private db: PrismaClient) {}

  // ── Inventory helpers ────────────────────────────────────────────────────

  async getInventoryBatch(inventoryId: string, pharmacyId: string) {
    return this.db.inventory.findFirst({
      where:   { id: inventoryId, pharmacyId },
      include: { medicine: true },
    });
  }

  async getInventoryBatches(ids: string[], pharmacyId: string) {
    return this.db.inventory.findMany({
      where:   { id: { in: ids }, pharmacyId },
      include: { medicine: true },
    });
  }

  // ── Invoice settings ─────────────────────────────────────────────────────

  async getSettings(pharmacyId: string) {
    return this.db.invoiceSettings.findUnique({ where: { pharmacyId } });
  }

  // ── Create invoice (atomic) ───────────────────────────────────────────────
  //
  // Transaction order:
  //   0.   Idempotency check.
  //   0.5. Release stock reservations for this session.
  //   1.   Atomic stock decrement (qty >= needed, scoped by pharmacyId).
  //   2.   Create invoice + line items.
  //   3.   Write InventoryMovement rows.
  //   4.   Increment customer creditUsed — only for CREDIT payment mode + unsettled status.
  //   4.5. Audit entry for credit change.
  //   5.   Write invoice AuditLog.

  // Minimal invoice shape returned from the transaction — only scalar fields needed
  // inside the lock window. Relation data (items, payments, customer, user) is NOT
  // loaded here; callers that need it should do a separate findUnique outside the tx.
  private static readonly INVOICE_CREATE_SELECT = {
    id: true, invoiceNumber: true, createdAt: true,
    totalAmount: true, paymentMode: true,
  } satisfies Prisma.InvoiceSelect;

  async createInvoiceTransactional(params: {
    pharmacyId:            string;
    userId:                string;
    invoiceData:           Omit<Prisma.InvoiceCreateInput, "invoiceNumber">;
    generateInvoiceNumber: () => Promise<string>;
    stockDecrements:       { inventoryId: string; quantity: number; medicineName: string }[];
    idempotencyKey?:       string;
    customerId?:           string;
    totalAmount:           number;
    paymentStatus?:        string;
    paymentMode?:          string;
    auditMeta?:            { ipAddress?: string; userAgent?: string };
  }) {
    const txResult = await this.db.$transaction(async (tx) => {

      // Step 0 — idempotency (generator NOT called on duplicate → no sequence gap)
      if (params.idempotencyKey) {
        const existing = await tx.invoice.findUnique({
          where: {
            pharmacyId_idempotencyKey: {
              pharmacyId:     params.pharmacyId,
              idempotencyKey: params.idempotencyKey,
            },
          },
          select: BillingRepo.INVOICE_CREATE_SELECT,
        });
        if (existing) return { invoice: existing, isNew: false };
      }

      // Generate invoice number only after confirming this is a new request.
      const invoiceNumber = await params.generateInvoiceNumber();

      // Step 0.5 — release stock reservations (single raw SQL instead of N round-trips)
      if (params.idempotencyKey) {
        const reservations = await tx.stockReservation.findMany({
          where:  { pharmacyId: params.pharmacyId, sessionId: params.idempotencyKey },
          select: { inventoryId: true, quantity: true },
        });
        if (reservations.length > 0) {
          const resIds  = reservations.map((r) => r.inventoryId);
          const resQtys = reservations.map((r) => r.quantity);
          await Promise.all([
            tx.stockReservation.deleteMany({
              where: { pharmacyId: params.pharmacyId, sessionId: params.idempotencyKey },
            }),
            tx.$executeRaw`
              UPDATE inventory inv
              SET    "reservedQuantity" = GREATEST(0, inv."reservedQuantity" - b.qty)
              FROM   (SELECT unnest(${resIds}::text[]) AS id, unnest(${resQtys}::int[]) AS qty) AS b
              WHERE  inv.id           = b.id
                AND  inv."pharmacyId" = ${params.pharmacyId}::text
            `,
          ]);
        }
      }

      // Step 1 — atomic stock decrement (single CTE: N items → 1 round-trip).
      // UPDATE ... RETURNING gives us the post-update quantity atomically, so no
      // separate SELECT is needed. All decrements execute in one statement inside
      // the Serializable transaction, which also shortens the lock-hold window.
      type DecrRow = { id: string; qty_after: number; qty_dec: number };
      const inventoryIds = params.stockDecrements.map((i) => i.inventoryId);
      const quantities   = params.stockDecrements.map((i) => i.quantity);

      const decremented = await tx.$queryRaw<DecrRow[]>`
        WITH batch(id, qty) AS (
          SELECT unnest(${inventoryIds}::text[]), unnest(${quantities}::int[])
        ),
        upd AS (
          UPDATE inventory inv
          SET    quantity = inv.quantity - b.qty
          FROM   batch b
          WHERE  inv.id           = b.id
            AND  inv."pharmacyId" = ${params.pharmacyId}::text
            AND  inv.quantity    >= b.qty
          RETURNING inv.id, inv.quantity AS qty_after, b.qty AS qty_dec
        )
        SELECT * FROM upd
      `;

      // If fewer rows came back than expected, one or more items had insufficient stock.
      // Find the first offender and surface a precise error message.
      if (decremented.length !== params.stockDecrements.length) {
        const succeededIds = new Set(decremented.map((r) => r.id));
        const failed       = params.stockDecrements.find((i) => !succeededIds.has(i.inventoryId))!;
        const current      = await tx.inventory.findFirst({
          where:  { id: failed.inventoryId, pharmacyId: params.pharmacyId },
          select: { quantity: true },
        });
        throw current
          ? AppError.conflict(
              `Insufficient stock for "${failed.medicineName}": ${current.quantity} available, ${failed.quantity} requested`,
            )
          : AppError.notFound(`Inventory item not found: ${failed.inventoryId}`);
      }

      const movements: PendingMovement[] = decremented.map((row) => ({
        inventoryId:    row.id,
        quantity:       row.qty_dec,
        quantityBefore: row.qty_after + row.qty_dec,
        quantityAfter:  row.qty_after,
      }));

      // Step 2 — create invoice + line items (minimal select — no relation joins inside the tx)
      const invoice = await tx.invoice.create({
        data:   { ...params.invoiceData, invoiceNumber },
        select: BillingRepo.INVOICE_CREATE_SELECT,
      });

      // Step 3 — inventory movements
      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            pharmacyId:     params.pharmacyId,
            userId:         params.userId,
            inventoryId:    m.inventoryId,
            type:           "SALE" as const,
            direction:      "OUT" as const,
            quantity:       m.quantity,
            quantityBefore: m.quantityBefore,
            quantityAfter:  m.quantityAfter,
            referenceType:  "invoice",
            referenceId:    invoice.id,
          })),
        });
      }

      // Step 4 — increment creditUsed ONLY for CREDIT payment mode with outstanding balance.
      // Guarded by paymentMode so CASH/UPI partial payments never pollute creditUsed.
      const isCreditSale =
        params.customerId &&
        params.totalAmount > 0 &&
        params.paymentMode === "CREDIT" &&
        params.paymentStatus !== "PAID";

      if (isCreditSale) {
        await tx.customer.updateMany({
          where: { id: params.customerId!, pharmacyId: params.pharmacyId, customerType: "CREDIT" },
          data:  { creditUsed: { increment: params.totalAmount } },
        });

        // Step 4.5 — audit credit change
        await tx.auditLog.create({
          data: {
            pharmacyId: params.pharmacyId,
            userId:     params.userId,
            action:     "UPDATE",
            entity:     "CustomerCredit",
            entityId:   params.customerId!,
            newData: {
              change:        `+${params.totalAmount}`,
              reason:        "credit_sale",
              invoiceId:     invoice.id,
              invoiceNumber: invoice.invoiceNumber,
            },
            ipAddress: params.auditMeta?.ipAddress,
            userAgent: params.auditMeta?.userAgent?.slice(0, 500),
          },
        });
      }

      return { invoice, isNew: true };
    }, {
      isolationLevel: "Serializable",
      timeout: 10_000,
    }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        throw AppError.conflict(
          "Another transaction updated this stock simultaneously — please try again",
        );
      }
      throw err;
    });

    // Write invoice audit log OUTSIDE the Serializable transaction — reduces lock-hold
    // time. Non-critical: a write failure here does not roll back the committed invoice.
    if (txResult.isNew) {
      void this.db.auditLog.create({
        data: {
          pharmacyId: params.pharmacyId,
          userId:     params.userId,
          action:     "CREATE",
          entity:     "Invoice",
          entityId:   txResult.invoice.id,
          newData: {
            invoiceNumber: txResult.invoice.invoiceNumber,
            totalAmount:   txResult.invoice.totalAmount,
            itemCount:     params.stockDecrements.length,
            paymentMode:   txResult.invoice.paymentMode,
          },
          ipAddress: params.auditMeta?.ipAddress,
          userAgent: params.auditMeta?.userAgent?.slice(0, 500),
        },
      }).catch(() => { /* audit write failure must not fail the billing op */ });
    }

    return txResult.invoice;
  }

  // ── Cancel invoice (atomic) ───────────────────────────────────────────────

  async cancelInvoiceTransactional(params: {
    invoiceId:  string;
    pharmacyId: string;
    userId:     string;
    reason:     string;
    auditMeta?: { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, pharmacyId: params.pharmacyId },
        include: {
          items:    { select: { inventoryId: true, quantity: true } },
          payments: { select: { id: true, amount: true } },
        },
      });

      if (!invoice) throw AppError.notFound("Invoice not found");

      if (invoice.isCancelled || invoice.status === "CANCELLED") {
        throw AppError.conflict("Invoice is already cancelled");
      }
      if (invoice.status === "RETURNED" || invoice.status === "PARTIALLY_RETURNED") {
        throw AppError.conflict("Cannot cancel a returned invoice — raise a sales return instead");
      }

      // Block cancellation if payments have already been collected to prevent
      // untracked cash refunds. Owner must first raise a sales return or manually
      // record the refund before cancelling.
      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      if (totalPaid > 0.01) {
        throw AppError.conflict(
          `Cannot cancel an invoice with ₹${totalPaid.toFixed(2)} collected. ` +
          `Raise a sales return to reverse the payment first.`,
        );
      }

      const result = await tx.invoice.updateMany({
        where: { id: params.invoiceId, pharmacyId: params.pharmacyId, isCancelled: false },
        data:  {
          isCancelled:  true,
          cancelledAt:  new Date(),
          cancelReason: params.reason,
          status:       "CANCELLED",
        },
      });

      if (result.count === 0) throw AppError.conflict("Invoice is already cancelled");

      // Restore stock — single UPDATE…RETURNING replaces 2N round-trips
      const cancelIds  = invoice.items.map((i) => i.inventoryId);
      const cancelQtys = invoice.items.map((i) => i.quantity);
      type CancelRow = { id: string; qty_after: number; qty_inc: number };
      const cancelRows = await tx.$queryRaw<CancelRow[]>`
        WITH batch(id, qty) AS (
          SELECT unnest(${cancelIds}::text[]), unnest(${cancelQtys}::int[])
        ),
        upd AS (
          UPDATE inventory inv
          SET    quantity = inv.quantity + b.qty
          FROM   batch b
          WHERE  inv.id           = b.id
            AND  inv."pharmacyId" = ${params.pharmacyId}::text
          RETURNING inv.id, inv.quantity AS qty_after, b.qty AS qty_inc
        )
        SELECT * FROM upd
      `;
      const movements: PendingMovement[] = cancelRows.map((row) => ({
        inventoryId:    row.id,
        quantity:       row.qty_inc,
        quantityBefore: row.qty_after - row.qty_inc,
        quantityAfter:  row.qty_after,
      }));

      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            pharmacyId:     params.pharmacyId,
            userId:         params.userId,
            inventoryId:    m.inventoryId,
            type:           "ADJUSTMENT" as const,
            direction:      "IN" as const,
            quantity:       m.quantity,
            quantityBefore: m.quantityBefore,
            quantityAfter:  m.quantityAfter,
            referenceType:  "invoice_cancel",
            referenceId:    invoice.id,
            notes:          `Cancellation: ${params.reason}`,
          })),
        });
      }

      // Reverse credit balance only when it was incremented at creation.
      // createInvoiceTransactional guards with paymentStatus !== "PAID" — mirror
      // that exact condition here so immediately-settled CREDIT invoices (where
      // creditUsed was never incremented) don't drive the balance negative.
      const wasCreditSale =
        invoice.customerId &&
        invoice.paymentMode   === "CREDIT" &&
        invoice.paymentStatus !== "PAID"   &&
        invoice.totalAmount   >   0;

      if (wasCreditSale) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId!, pharmacyId: params.pharmacyId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: invoice.totalAmount } },
        });

        await tx.auditLog.create({
          data: {
            pharmacyId: params.pharmacyId,
            userId:     params.userId,
            action:     "UPDATE",
            entity:     "CustomerCredit",
            entityId:   invoice.customerId!,
            newData: {
              change:        `-${invoice.totalAmount}`,
              reason:        "invoice_cancelled",
              invoiceId:     invoice.id,
              invoiceNumber: invoice.invoiceNumber,
            },
            ipAddress: params.auditMeta?.ipAddress,
            userAgent: params.auditMeta?.userAgent?.slice(0, 500),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          pharmacyId: params.pharmacyId,
          userId:     params.userId,
          action:     "DELETE",
          entity:     "Invoice",
          entityId:   invoice.id,
          oldData:    { isCancelled: false, invoiceNumber: invoice.invoiceNumber },
          newData:    { isCancelled: true,  cancelReason:  params.reason },
          ipAddress:  params.auditMeta?.ipAddress,
          userAgent:  params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return tx.invoice.findFirst({ where: { id: params.invoiceId }, include: INVOICE_INCLUDE });
    }, {
      isolationLevel: "Serializable",
      timeout:        10_000,
    }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        throw AppError.conflict(
          "Another request modified this invoice simultaneously — please try again",
        );
      }
      throw err;
    });
  }

  // ── Sales return (atomic) ─────────────────────────────────────────────────

  async createReturnTransactional(params: {
    pharmacyId:           string;
    invoiceId:            string;
    userId:               string;
    generateReturnNumber: () => Promise<string>;
    reason:               string;
    idempotencyKey?:      string;
    returnWindowDays?:    number;
    returnItems: {
      invoiceItemId: string;
      quantity:      number;
      disposition?:  "RESTOCK" | "WRITEOFF";
    }[];
    auditMeta?: { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {

      // Idempotency (generator NOT called on duplicate → no sequence gap)
      if (params.idempotencyKey) {
        const existing = await tx.salesReturn.findFirst({
          where:   { pharmacyId: params.pharmacyId, idempotencyKey: params.idempotencyKey },
          include: RETURN_INCLUDE,
        });
        if (existing) return existing;
      }

      const returnNumber = await params.generateReturnNumber();

      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, pharmacyId: params.pharmacyId },
        include: { items: true, returns: { include: { items: true } } },
      });

      if (!invoice)                           throw AppError.notFound("Invoice not found");
      if (invoice.status === "CANCELLED")     throw AppError.conflict("Cannot return a cancelled invoice");
      if (invoice.status === "DRAFT")         throw AppError.conflict("Cannot return a draft invoice");
      if (invoice.status === "RETURNED")      throw AppError.conflict("Invoice is already fully returned");

      // Return window enforcement (0 = no limit)
      const windowDays = params.returnWindowDays ?? 30;
      if (windowDays > 0) {
        const invoiceAgeDays = Math.floor((Date.now() - invoice.createdAt.getTime()) / 86_400_000);
        if (invoiceAgeDays > windowDays) {
          throw AppError.unprocessable(
            `Return window expired. Invoice ${invoice.invoiceNumber} is ${invoiceAgeDays} day(s) old; ` +
            `returns are only accepted within ${windowDays} day(s) of purchase.`,
          );
        }
      }

      const alreadyReturnedMap = new Map<string, number>();
      for (const ret of invoice.returns) {
        for (const ri of ret.items) {
          if (ri.invoiceItemId) {
            alreadyReturnedMap.set(
              ri.invoiceItemId,
              (alreadyReturnedMap.get(ri.invoiceItemId) ?? 0) + ri.quantity,
            );
          }
        }
      }

      const returnLineItems: {
        invoiceItemId: string;
        inventoryId:   string;
        medicineName:  string;
        hsnCode:       string | null;
        batchNumber:   string;
        expiryDate:    Date;
        quantity:      number;
        mrp:           number;
        rate:          number;
        discount:      number;
        gstRate:       number;
        cgst:          number;
        sgst:          number;
        igst:          number;
        taxableAmount: number;
        amount:        number;
        disposition:   "RESTOCK" | "WRITEOFF";
      }[] = [];

      for (const ri of params.returnItems) {
        const originalItem = invoice.items.find((i) => i.id === ri.invoiceItemId);
        if (!originalItem) {
          throw AppError.badRequest(
            `Item ${ri.invoiceItemId} does not belong to invoice ${invoice.invoiceNumber}`,
          );
        }

        const alreadyReturned = alreadyReturnedMap.get(ri.invoiceItemId) ?? 0;
        const maxReturnable   = originalItem.quantity - alreadyReturned;

        if (ri.quantity <= 0)             throw AppError.badRequest("Return quantity must be positive");
        if (ri.quantity > maxReturnable) {
          throw AppError.unprocessable(
            `Cannot return ${ri.quantity} of "${originalItem.medicineName}": ` +
            `only ${maxReturnable} returnable (${alreadyReturned} already returned)`,
          );
        }

        const ratio        = ri.quantity / originalItem.quantity;
        const cgst         = parseFloat((originalItem.cgst         * ratio).toFixed(2));
        const sgst         = parseFloat((originalItem.sgst         * ratio).toFixed(2));
        const igst         = parseFloat((originalItem.igst         * ratio).toFixed(2));
        const taxableAmount = parseFloat((originalItem.taxableAmount * ratio).toFixed(2));
        const amount       = parseFloat((originalItem.amount       * ratio).toFixed(2));

        returnLineItems.push({
          invoiceItemId: ri.invoiceItemId,
          inventoryId:   originalItem.inventoryId,
          medicineName:  originalItem.medicineName,
          hsnCode:       originalItem.hsnCode,
          batchNumber:   originalItem.batchNumber,
          expiryDate:    originalItem.expiryDate,
          quantity:      ri.quantity,
          mrp:           originalItem.mrp,
          rate:          originalItem.rate,
          discount:      originalItem.discount,
          gstRate:       originalItem.gstRate,
          cgst,
          sgst,
          igst,
          taxableAmount,
          amount,
          disposition: (ri.disposition ?? "RESTOCK") as "RESTOCK" | "WRITEOFF",
        });
      }

      // Restore stock — RESTOCK adds back, WRITEOFF leaves inventory unchanged
      // Single UPDATE…RETURNING replaces 2N round-trips
      const restockItems = returnLineItems.filter((li) => li.disposition !== "WRITEOFF");
      const retIds  = restockItems.map((li) => li.inventoryId);
      const retQtys = restockItems.map((li) => li.quantity);
      type RetRow = { id: string; qty_after: number; qty_inc: number };
      const retRows = retIds.length > 0
        ? await tx.$queryRaw<RetRow[]>`
            WITH batch(id, qty) AS (
              SELECT unnest(${retIds}::text[]), unnest(${retQtys}::int[])
            ),
            upd AS (
              UPDATE inventory inv
              SET    quantity = inv.quantity + b.qty
              FROM   batch b
              WHERE  inv.id           = b.id
                AND  inv."pharmacyId" = ${params.pharmacyId}::text
              RETURNING inv.id, inv.quantity AS qty_after, b.qty AS qty_inc
            )
            SELECT * FROM upd
          `
        : [];
      const movements: PendingMovement[] = retRows.map((row) => ({
        inventoryId:    row.id,
        quantity:       row.qty_inc,
        quantityBefore: row.qty_after - row.qty_inc,
        quantityAfter:  row.qty_after,
      }));

      const totalAmount    = parseFloat(returnLineItems.reduce((s, i) => s + i.amount,        0).toFixed(2));
      const totalCgst      = parseFloat(returnLineItems.reduce((s, i) => s + i.cgst,          0).toFixed(2));
      const totalSgst      = parseFloat(returnLineItems.reduce((s, i) => s + i.sgst,          0).toFixed(2));
      const totalIgst      = parseFloat(returnLineItems.reduce((s, i) => s + i.igst,          0).toFixed(2));
      const totalTaxable   = parseFloat(returnLineItems.reduce((s, i) => s + i.taxableAmount, 0).toFixed(2));
      const subtotal       = parseFloat(returnLineItems.reduce((s, i) => s + i.mrp * i.quantity, 0).toFixed(2));

      const salesReturn = await tx.salesReturn.create({
        data: {
          pharmacyId:     params.pharmacyId,
          invoiceId:      params.invoiceId,
          returnNumber,
          reason:         params.reason,
          userId:         params.userId,
          customerId:     invoice.customerId ?? undefined,
          idempotencyKey: params.idempotencyKey,
          subtotal,
          discountAmount: 0,
          taxableAmount:  totalTaxable,
          cgst:           totalCgst,
          sgst:           totalSgst,
          igst:           totalIgst,
          totalGst:       parseFloat((totalCgst + totalSgst + totalIgst).toFixed(2)),
          totalAmount,
          items: {
            create: returnLineItems.map((li) => ({
              invoiceItemId: li.invoiceItemId,
              inventoryId:   li.inventoryId,
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
              igst:          li.igst,
              taxableAmount: li.taxableAmount,
              amount:        li.amount,
              disposition:   li.disposition,
            })),
          },
        },
        include: RETURN_INCLUDE,
      });

      const newReturnedAmount = parseFloat((invoice.returnedAmount + totalAmount).toFixed(2));
      const isFullReturn      = newReturnedAmount >= invoice.totalAmount - 0.01;

      await tx.invoice.update({
        where: { id: params.invoiceId },
        data:  {
          returnedAmount: newReturnedAmount,
          status:         isFullReturn ? "RETURNED" : "PARTIALLY_RETURNED",
        },
      });

      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            pharmacyId:     params.pharmacyId,
            userId:         params.userId,
            inventoryId:    m.inventoryId,
            type:           "RETURN" as const,
            direction:      "IN" as const,
            quantity:       m.quantity,
            quantityBefore: m.quantityBefore,
            quantityAfter:  m.quantityAfter,
            referenceType:  "sales_return",
            referenceId:    salesReturn.id,
          })),
        });
      }

      // Same paymentStatus guard as cancelInvoiceTransactional — only reverse
      // creditUsed when it was actually incremented at invoice creation.
      const wasCreditSale =
        invoice.customerId &&
        invoice.paymentMode   === "CREDIT" &&
        invoice.paymentStatus !== "PAID"   &&
        totalAmount           >   0;
      if (wasCreditSale) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId!, pharmacyId: params.pharmacyId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: totalAmount } },
        });

        await tx.auditLog.create({
          data: {
            pharmacyId: params.pharmacyId,
            userId:     params.userId,
            action:     "UPDATE",
            entity:     "CustomerCredit",
            entityId:   invoice.customerId!,
            newData: {
              change:       `-${totalAmount}`,
              reason:       "sales_return",
              returnId:     salesReturn.id,
              returnNumber,
            },
            ipAddress: params.auditMeta?.ipAddress,
            userAgent: params.auditMeta?.userAgent?.slice(0, 500),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          pharmacyId: params.pharmacyId,
          userId:     params.userId,
          action:     "CREATE",
          entity:     "SalesReturn",
          entityId:   salesReturn.id,
          newData: {
            returnNumber,
            invoiceNumber: invoice.invoiceNumber,
            totalAmount,
            itemCount:     returnLineItems.length,
          },
          ipAddress: params.auditMeta?.ipAddress,
          userAgent: params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return salesReturn;
    });
  }

  // ── Add payment entry ─────────────────────────────────────────────────────

  async addPaymentEntry(params: {
    pharmacyId:  string;
    invoiceId:   string;
    userId:      string;
    amount:      number;
    paymentMode: string;
    reference?:  string;
    notes?:      string;
    paidAt?:     Date;
    auditMeta?:  { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, pharmacyId: params.pharmacyId },
        include: { payments: true },
      });


      if (!invoice)            throw AppError.notFound("Invoice not found");
      if (invoice.isCancelled) throw AppError.conflict("Cannot add payment to a cancelled invoice");

      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = invoice.totalAmount - totalPaid;

      if (params.amount > remaining + 0.01) {
        throw AppError.unprocessable(
          `Payment of ₹${params.amount} exceeds outstanding balance of ₹${remaining.toFixed(2)}`,
        );
      }

      const payment = await tx.invoicePayment.create({
        data: {
          pharmacyId:  params.pharmacyId,
          invoiceId:   params.invoiceId,
          createdBy:   params.userId,
          amount:      params.amount,
          paymentMode: params.paymentMode as PaymentMode,
          reference:   params.reference,
          notes:       params.notes,
          paidAt:      params.paidAt ?? new Date(),
        },
      });

      const newTotalPaid = totalPaid + params.amount;
      let paymentStatus: "PAID" | "PARTIAL" | "PENDING" = "PENDING";
      if (newTotalPaid >= invoice.totalAmount - 0.01) paymentStatus = "PAID";
      else if (newTotalPaid > 0)                      paymentStatus = "PARTIAL";

      await tx.invoice.update({
        where: { id: params.invoiceId },
        data:  { paymentStatus: paymentStatus as PaymentStatus, paymentMode: params.paymentMode as PaymentMode },
      });

      // Reduce creditUsed ONLY when this payment settles a CREDIT invoice that
      // actually had creditUsed incremented at creation (paymentStatus !== "PAID"
      // at creation time). An already-PAID invoice (paymentStatus was set to "PAID"
      // at creation) never incremented creditUsed, so we must not decrement it here.
      const wasCreditSale =
        paymentStatus             === "PAID"   &&
        invoice.paymentStatus     !== "PAID"   &&
        invoice.customerId                     &&
        invoice.paymentMode       === "CREDIT";
      if (wasCreditSale) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId!, pharmacyId: params.pharmacyId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: invoice.totalAmount } },
        });

        await tx.auditLog.create({
          data: {
            pharmacyId: params.pharmacyId,
            userId:     params.userId,
            action:     "UPDATE",
            entity:     "CustomerCredit",
            entityId:   invoice.customerId!,
            newData: {
              change:        `-${invoice.totalAmount}`,
              reason:        "credit_settled",
              invoiceId:     invoice.id,
              invoiceNumber: invoice.invoiceNumber,
            },
            ipAddress: params.auditMeta?.ipAddress,
            userAgent: params.auditMeta?.userAgent?.slice(0, 500),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          pharmacyId: params.pharmacyId,
          userId:     params.userId,
          action:     "UPDATE",
          entity:     "Invoice",
          entityId:   invoice.id,
          newData:    { payment: { amount: params.amount, mode: params.paymentMode, paymentStatus } },
          ipAddress:  params.auditMeta?.ipAddress,
          userAgent:  params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return payment;
    }, {
      isolationLevel: "Serializable",
      timeout:        10_000,
    }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        throw AppError.conflict(
          "Another payment was recorded simultaneously — please try again",
        );
      }
      throw err;
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getInvoice(id: string, pharmacyId: string) {
    return this.db.invoice.findFirst({
      where:   { id, pharmacyId },
      include: INVOICE_INCLUDE,
    });
  }

  async listInvoices(
    pharmacyId: string,
    params: {
      page:              number;
      limit:             number;
      search?:           string;
      from?:             Date;
      to?:               Date;
      status?:           string;
      includeCancelled?: boolean;
      paymentMode?:      string;
      paymentStatus?:    string;
      userId?:           string;
      customerId?:       string;
      minAmount?:        number;
      maxAmount?:        number;
    },
  ) {
    const where: Prisma.InvoiceWhereInput = {
      pharmacyId,
      // status filter takes precedence over includeCancelled shorthand
      ...(params.status
        ? { status: params.status as InvoiceStatus }
        : params.includeCancelled
          ? {}
          : { isCancelled: false }),
      ...(params.from || params.to
        ? { createdAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to   ? { lte: params.to   } : {}),
          } }
        : {}),
      ...(params.paymentMode   ? { paymentMode:   params.paymentMode   as PaymentMode   } : {}),
      ...(params.paymentStatus ? { paymentStatus: params.paymentStatus as PaymentStatus } : {}),
      ...(params.userId     ? { userId:     params.userId }     : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.minAmount !== undefined || params.maxAmount !== undefined
        ? { totalAmount: {
            ...(params.minAmount !== undefined ? { gte: params.minAmount } : {}),
            ...(params.maxAmount !== undefined ? { lte: params.maxAmount } : {}),
          } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { invoiceNumber: { contains: params.search, mode: "insensitive" } },
              { customerName:  { contains: params.search, mode: "insensitive" } },
              { customerPhone: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          customer: { select: { name: true, phone: true } },
          user:     { select: { name: true } },
          _count:   { select: { items: true } },
        },
      }),
      this.db.invoice.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  // ── Returns ───────────────────────────────────────────────────────────────

  async getReturn(id: string, pharmacyId: string) {
    return this.db.salesReturn.findFirst({
      where:   { id, pharmacyId },
      include: RETURN_INCLUDE,
    });
  }

  async listReturns(
    pharmacyId: string,
    params: {
      page:       number;
      limit:      number;
      search?:    string;
      from?:      Date;
      to?:        Date;
      invoiceId?: string;
    },
  ) {
    const where: Prisma.SalesReturnWhereInput = {
      pharmacyId,
      ...(params.invoiceId ? { invoiceId: params.invoiceId } : {}),
      ...(params.from || params.to
        ? { createdAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to   ? { lte: params.to   } : {}),
          } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { returnNumber: { contains: params.search, mode: "insensitive" } },
              { invoice:  { invoiceNumber: { contains: params.search, mode: "insensitive" } } },
              { customer: { name: { contains: params.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.salesReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include: {
          invoice:  { select: { id: true, invoiceNumber: true } },
          customer: { select: { name: true, phone: true } },
          user:     { select: { name: true } },
          items:    { select: { quantity: true, amount: true } },
        },
      }),
      this.db.salesReturn.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  // ── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats(pharmacyId: string) {
    const now                 = new Date();
    const todayStart          = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart           = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart          = new Date(now.getFullYear(), now.getMonth(), 1);
    const nearExpiryThreshold = new Date(Date.now() + 90 * 86400000);

    const [
      todaySalesAgg,
      todayCancelledCount,
      weekInvoices,
      monthInvoices,
      todayReturns,
      pendingCredit,
      paymentBreakdown,
      lowStockCount,
      nearExpiryCount,
    ] = await Promise.all([
      // Today's sales — use aggregate instead of findMany to avoid loading rows into memory
      this.db.invoice.aggregate({
        where:  { pharmacyId, createdAt: { gte: todayStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Today's cancelled count
      this.db.invoice.count({
        where: { pharmacyId, createdAt: { gte: todayStart }, isCancelled: true },
      }),
      // Week invoices
      this.db.invoice.aggregate({
        where:  { pharmacyId, createdAt: { gte: weekStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Month invoices
      this.db.invoice.aggregate({
        where:  { pharmacyId, createdAt: { gte: monthStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Today's returns
      this.db.salesReturn.aggregate({
        where:  { pharmacyId, createdAt: { gte: todayStart } },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Pending credit
      this.db.invoice.aggregate({
        where:  { pharmacyId, paymentStatus: "PENDING", isCancelled: false },
        _sum:   { totalAmount: true },
      }),
      // Payment mode breakdown (today)
      this.db.invoice.groupBy({
        by:     ["paymentMode"],
        where:  { pharmacyId, createdAt: { gte: todayStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Low stock — raw SQL needed: compare quantity to per-row minimumStock column
      this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM inventory
        WHERE "pharmacyId" = ${pharmacyId}
          AND quantity > 0
          AND quantity <= "minimumStock"
      `,
      // Near expiry
      this.db.inventory.count({
        where: { pharmacyId, expiryDate: { lte: nearExpiryThreshold }, quantity: { gt: 0 } },
      }),
    ]);

    return {
      todaySales:      parseFloat((todaySalesAgg._sum.totalAmount ?? 0).toFixed(2)),
      todayCount:      todaySalesAgg._count.id,
      todayCancelled:  todayCancelledCount,
      todayReturns:    todayReturns._sum.totalAmount    ?? 0,
      weekSales:       weekInvoices._sum.totalAmount    ?? 0,
      weekCount:       weekInvoices._count.id,
      monthSales:      monthInvoices._sum.totalAmount   ?? 0,
      monthCount:      monthInvoices._count.id,
      pendingCredit:   pendingCredit._sum.totalAmount   ?? 0,
      paymentBreakdown: paymentBreakdown.map((p) => ({
        mode:  p.paymentMode,
        total: p._sum.totalAmount ?? 0,
        count: p._count.id,
      })),
      lowStockCount:  Number(lowStockCount[0]?.count ?? 0),
      nearExpiryCount,
    };
  }

  // ── FIFO / FEFO batch selection ───────────────────────────────────────────
  // Selects the earliest-expiring batch with sufficient stock (FEFO — First
  // Expired First Out), which is the industry standard for pharmacy.

  async getFifoBatch(medicineId: string, pharmacyId: string, quantity: number) {
    return this.db.inventory.findFirst({
      where: {
        medicineId,
        pharmacyId,
        quantity:   { gte: quantity },
        expiryDate: { gt: new Date() },
      },
      orderBy: { expiryDate: "asc" },
      include: { medicine: true },
    });
  }
}
