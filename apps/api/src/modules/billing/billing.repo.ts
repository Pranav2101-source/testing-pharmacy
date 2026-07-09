import type { Db, Prisma, PaymentMode, PaymentStatus, InvoiceStatus } from "@pharmacy/database";
import { withTenant } from "@pharmacy/database";
import type { PendingMovement } from "./billing.types.js";
import { AppError } from "../../lib/AppError.js";
import { nextSequenceValue } from "../../lib/sequences.js";

// ─── Shared include shapes ────────────────────────────────────────────────────

const INVOICE_INCLUDE = {
  items:        true,
  customer:     { select: { id: true, name: true, phone: true, email: true } },
  user:         { select: { id: true, name: true } },
  payments:     { orderBy: { paidAt: "asc" as const } },
  returns:      { select: { id: true, returnNumber: true, totalAmount: true, createdAt: true } },
  prescription: { select: { id: true, prescriptionNumber: true, doctorName: true, doctorRegNo: true, patientName: true, status: true } },
} satisfies Prisma.InvoiceInclude;

const RETURN_INCLUDE = {
  items:    { include: { inventory: { select: { medicine: { select: { name: true } } } } } },
  customer: { select: { id: true, name: true, phone: true } },
  user:     { select: { id: true, name: true } },
  invoice:  { select: { id: true, invoiceNumber: true } },
} satisfies Prisma.SalesReturnInclude;

// ─────────────────────────────────────────────────────────────────────────────

export class BillingRepo {
  constructor(private db: Db) {}

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
      include: {
        medicine: true,
        shelf:    { select: { code: true, rack: { select: { code: true } } } },
      },
    });
  }

  /** Per-pharmacy GST/discount overrides for the medicines being billed. */
  async getMedicineOverrides(pharmacyId: string, medicineIds: string[]) {
    if (medicineIds.length === 0) return [];
    return this.db.pharmacyMedicineOverride.findMany({
      where: { pharmacyId, medicineId: { in: medicineIds } },
    });
  }

  // ── Invoice settings ─────────────────────────────────────────────────────

  async getSettings(pharmacyId: string) {
    // invoiceSettings is now a column on Pharmacy (was its own 1:1 table). Wrapped
    // in `{ settings }` to preserve the shape callers already destructure.
    const pharmacy = await this.db.pharmacy.findUnique({
      where:  { id: pharmacyId },
      select: { invoiceSettings: true },
    });
    if (!pharmacy) return null;
    return { settings: pharmacy.invoiceSettings };
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
    formatInvoiceNumber:   (seq: number) => string;
    stockDecrements:       { inventoryId: string; quantity: number; medicineName: string }[];
    idempotencyKey?:       string;
    customerId?:           string;
    totalAmount:           number;
    paymentStatus?:        string;
    paymentMode?:          string;
    auditMeta?:            { ipAddress?: string; userAgent?: string };
  }) {
    const txResult = await withTenant(this.db, params.pharmacyId, async (tx) => {

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

      // Draw the next invoice number only after confirming this is a new request.
      // The Postgres counter increments INSIDE this transaction, so a rollback
      // (stock conflict, credit limit) returns the number — numbering is gapless.
      const seq           = await nextSequenceValue(tx, params.pharmacyId, "INVOICE");
      const invoiceNumber = params.formatInvoiceNumber(seq);

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
      //
      // The availability floor is (quantity - reservedQuantity), not raw quantity:
      // stock reserved by OTHER billing sessions must not be sellable here. This
      // session's own reservations were already released in step 0.5, so they
      // never block its own checkout.
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
            AND  (inv.quantity - inv."reservedQuantity") >= b.qty
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
          select: { quantity: true, reservedQuantity: true },
        });
        if (!current) {
          throw AppError.notFound(`Inventory item not found: ${failed.inventoryId}`);
        }
        const available = Math.max(0, current.quantity - current.reservedQuantity);
        const reservedNote = current.reservedQuantity > 0
          ? ` (${current.reservedQuantity} reserved by another billing session)`
          : "";
        throw AppError.conflict(
          `Insufficient stock for "${failed.medicineName}": ${available} available${reservedNote}, ${failed.quantity} requested`,
        );
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
            referenceType:  "INVOICE",
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
        // Atomic check-and-increment in a single UPDATE so no two concurrent invoices
        // can both pass a pre-flight credit check and then both commit, silently
        // exceeding the customer's limit (TOCTOU race that existed when the service
        // called validateCreditLimit before entering this transaction).
        // The WHERE clause only matches when creditLimit is unlimited (≤ 0) OR when
        // the resulting creditUsed would remain within the limit (+0.01 for float tolerance).
        const updated = await tx.$queryRaw<{ creditUsed: number; creditLimit: number }[]>`
          UPDATE customers
          SET    "creditUsed" = "creditUsed" + ${params.totalAmount}
          WHERE  id             = ${params.customerId!}
            AND  "pharmacyId"   = ${params.pharmacyId}
            AND  "customerType" = 'CREDIT'
            AND  (
                   "creditLimit" <= 0
                   OR "creditUsed" + ${params.totalAmount} <= "creditLimit" + 0.01
                 )
          RETURNING "creditUsed", "creditLimit"
        `;

        if (updated.length === 0) {
          // No row matched — either the customer isn't a credit customer, or the
          // limit would be exceeded. Read the real record (no customerType filter)
          // to tell the two apart and give a message the counter can act on.
          const cust = await tx.customer.findFirst({
            where:  { id: params.customerId!, pharmacyId: params.pharmacyId },
            select: { name: true, customerType: true, creditLimit: true, creditUsed: true },
          });
          if (!cust || cust.customerType !== "CREDIT") {
            throw AppError.unprocessable(
              `${cust?.name ?? "This customer"} is not set up for credit. Change their customer type to "Credit" (and set a credit limit) to sell on credit.`,
            );
          }
          const available = cust.creditLimit - cust.creditUsed;
          throw AppError.unprocessable(
            `Credit limit exceeded for ${cust.name}. Available: ₹${available.toFixed(2)}, required: ₹${params.totalAmount.toFixed(2)}`,
          );
        }

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
    return withTenant(this.db, params.pharmacyId, async (tx) => {
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
            referenceType:  "INVOICE_CANCEL",
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
    formatReturnNumber:   (seq: number) => string;
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
    return withTenant(this.db, params.pharmacyId, async (tx) => {

      // Idempotency (generator NOT called on duplicate → no sequence gap)
      if (params.idempotencyKey) {
        const existing = await tx.salesReturn.findFirst({
          where:   { pharmacyId: params.pharmacyId, idempotencyKey: params.idempotencyKey },
          include: RETURN_INCLUDE,
        });
        if (existing) return existing;
      }

      // Counter increments inside this transaction — gapless on rollback.
      const returnSeq    = await nextSequenceValue(tx, params.pharmacyId, "SALES_RETURN");
      const returnNumber = params.formatReturnNumber(returnSeq);

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

      // Two maps — quantity for the "max returnable" guard, amount for the
      // exact-remainder rounding fix.  Tracking amounts here is what lets us
      // compute `originalAmount - sum(previousReturnAmounts)` on the last
      // return for a line item, rather than ratio × originalAmount.  Without
      // this, returning 10 units one-at-a-time from a ₹10.09 line leaves a
      // ₹0.09 residual that exceeds the 0.01 tolerance on isFullReturn.
      const alreadyReturnedMap    = new Map<string, number>(); // qty
      const alreadyReturnedAmtMap = new Map<string, number>(); // amount (₹)
      for (const ret of invoice.returns) {
        for (const ri of ret.items) {
          if (ri.invoiceItemId) {
            alreadyReturnedMap.set(
              ri.invoiceItemId,
              (alreadyReturnedMap.get(ri.invoiceItemId) ?? 0) + ri.quantity,
            );
            alreadyReturnedAmtMap.set(
              ri.invoiceItemId,
              (alreadyReturnedAmtMap.get(ri.invoiceItemId) ?? 0) + ri.amount,
            );
          } else {
            // invoiceItemId is null — the linked InvoiceItem was deleted (SetNull cascade) or
            // was never set. This return item is excluded from the "already returned" guard,
            // which means the qty / amount for its medicine line is under-counted.
            // Operators should investigate and manually reconcile if this appears in logs.
            console.warn(
              `[SalesReturn] invoiceItemId is null on SalesReturnItem ${ri.id} ` +
              `(returnId=${ret.id}, invoiceId=${invoice.id}). ` +
              "Over-return guard may be incomplete for this line item.",
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

        const alreadyReturnedQty = alreadyReturnedMap.get(ri.invoiceItemId)    ?? 0;
        const alreadyReturnedAmt = alreadyReturnedAmtMap.get(ri.invoiceItemId) ?? 0;
        const ratio              = ri.quantity / originalItem.quantity;

        // When this return completes the line item (all units now returned),
        // use the exact remaining amount instead of ratio × original.
        // Ratio-based rounding (e.g. 10 × ⌊₹10.09 / 10⌋ = ₹10.00 ≠ ₹10.09)
        // accumulates error across multi-step returns and can cause the final
        // returned total to fall outside the ±₹0.01 isFullReturn tolerance.
        const isLastBatch = (alreadyReturnedQty + ri.quantity) === originalItem.quantity;
        const amount       = isLastBatch
          ? parseFloat((originalItem.amount       - alreadyReturnedAmt).toFixed(2))
          : parseFloat((originalItem.amount       * ratio).toFixed(2));
        const cgst         = parseFloat((originalItem.cgst         * ratio).toFixed(2));
        const sgst         = parseFloat((originalItem.sgst         * ratio).toFixed(2));
        const igst         = parseFloat((originalItem.igst         * ratio).toFixed(2));
        const taxableAmount = parseFloat((originalItem.taxableAmount * ratio).toFixed(2));

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
              pharmacyId:    params.pharmacyId,
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
            referenceType:  "SALES_RETURN",
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
    }, {
      isolationLevel: "Serializable",
      timeout:        15_000,
    }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        throw AppError.conflict("Return was modified concurrently — please try again.");
      }
      throw err;
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
    return withTenant(this.db, params.pharmacyId, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, pharmacyId: params.pharmacyId },
        include: { payments: true },
      });


      if (!invoice)            throw AppError.notFound("Invoice not found");
      if (invoice.isCancelled) throw AppError.conflict("Cannot add payment to a cancelled invoice");
      if (invoice.status === "RETURNED")
        throw AppError.conflict("Invoice is fully returned — no payment is due");

      // Effective balance the customer actually owes is originalTotal minus whatever
      // was already returned.  Ignoring returnedAmount here would require the customer
      // to pay the full original amount even after a partial return.
      const totalPaid      = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
      const effectiveTotal = Number(invoice.totalAmount) - Number(invoice.returnedAmount);
      const remaining      = effectiveTotal - totalPaid;

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
      if (newTotalPaid >= effectiveTotal - 0.01) paymentStatus = "PAID";
      else if (newTotalPaid > 0)                 paymentStatus = "PARTIAL";

      // Only update paymentStatus — intentionally NOT touching paymentMode.
      // paymentMode records the agreed payment method set at invoice creation
      // (CASH, CREDIT, UPI, etc.). Overwriting it with the mode of each
      // subsequent payment would corrupt the original payment agreement and
      // break the wasCreditSale guards in cancel and return flows, leaving
      // creditUsed permanently inflated when a CREDIT invoice is settled via
      // a different payment mode (e.g. a UPI follow-up on a credit account).
      await tx.invoice.update({
        where: { id: params.invoiceId },
        data:  { paymentStatus: paymentStatus as PaymentStatus },
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
        // Decrement by effectiveTotal (originalAmount − returnedAmount), not by
        // the full originalAmount.  The return flow already decremented creditUsed
        // by returnedAmount, so decrementing by the full amount here would push
        // creditUsed negative and permanently inflate the customer's available credit.
        await tx.customer.updateMany({
          where: { id: invoice.customerId!, pharmacyId: params.pharmacyId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: Math.max(0, effectiveTotal) } },
        });

        await tx.auditLog.create({
          data: {
            pharmacyId: params.pharmacyId,
            userId:     params.userId,
            action:     "UPDATE",
            entity:     "CustomerCredit",
            entityId:   invoice.customerId!,
            newData: {
              change:        `-${effectiveTotal}`,
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
      cursor?:           string;
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

    const include = {
      customer: { select: { name: true, phone: true } },
      user:     { select: { name: true } },
      _count:   { select: { items: true } },
    } as const;

    // Cursor mode: skip the COUNT query entirely and use the id cursor to resume.
    // Prisma finds the cursor record inside the ordered result set and returns
    // the next `limit` records after it — O(log n) instead of O(n) for large tables.
    if (params.cursor) {
      const items = await this.db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        cursor:  { id: params.cursor },
        skip:    1,
        take:    params.limit,
        include,
      });
      const nextCursor = items.length === params.limit ? items[items.length - 1]?.id : undefined;
      return { items, nextCursor, page: params.page, limit: params.limit };
    }

    const [items, total] = await Promise.all([
      this.db.invoice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include,
      }),
      this.db.invoice.count({ where }),
    ]);

    const nextCursor = items.length === params.limit ? items[items.length - 1]?.id : undefined;
    return { items, total, nextCursor, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
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
      cursor?:    string;
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

    const include = {
      invoice:  { select: { id: true, invoiceNumber: true } },
      customer: { select: { name: true, phone: true } },
      user:     { select: { name: true } },
      items:    { select: { quantity: true, amount: true } },
    } as const;

    if (params.cursor) {
      const items = await this.db.salesReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        cursor:  { id: params.cursor },
        skip:    1,
        take:    params.limit,
        include,
      });
      const nextCursor = items.length === params.limit ? items[items.length - 1]?.id : undefined;
      return { items, nextCursor, page: params.page, limit: params.limit };
    }

    const [items, total] = await Promise.all([
      this.db.salesReturn.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (params.page - 1) * params.limit,
        take:    params.limit,
        include,
      }),
      this.db.salesReturn.count({ where }),
    ]);

    const nextCursor = items.length === params.limit ? items[items.length - 1]?.id : undefined;
    return { items, total, nextCursor, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  // ── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats(pharmacyId: string) {
    const now = new Date();

    // India Standard Time = UTC + 5:30.  Servers run UTC, so we must shift the
    // "day boundary" by +5h30m before truncating to midnight, then shift back to
    // get the correct UTC timestamp that corresponds to IST midnight.
    // Example: 2025-06-10 00:00 IST = 2025-06-09 18:30:00 UTC.
    // Using server-local Date(year, month, date) would give 2025-06-10 00:00 UTC,
    // which is 5:30 AM IST — leaving the first 5.5 hours of every Indian day
    // attributed to the previous day in stats.
    const IST_OFFSET_MS       = 5.5 * 60 * 60 * 1000;
    const istNow              = new Date(now.getTime() + IST_OFFSET_MS);
    const istTodayMidnightUtc = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
    const todayStart          = new Date(istTodayMidnightUtc.getTime() - IST_OFFSET_MS);
    const weekStart           = new Date(todayStart.getTime() - 7 * 86_400_000);
    const istMonthStartUtc    = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1));
    const monthStart          = new Date(istMonthStartUtc.getTime() - IST_OFFSET_MS);
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
      // Rolling 7-day window (not the current Mon–Sun calendar week)
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
      // Low stock — raw SQL needed: compare quantity to per-row minimumStock column.
      // ACTIVE only: quarantined/damaged/expired batches aren't restockable signals.
      this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM inventory
        WHERE "pharmacyId" = ${pharmacyId}
          AND status::text = 'ACTIVE'
          AND quantity > 0
          AND quantity <= "minimumStock"
      `,
      // Near expiry — ACTIVE and EXPIRED batches only (EXPIRED stays visible so the
      // count matches the expiry-alerts screen); QUARANTINE/DAMAGED are excluded
      // because they're already pulled from sale and handled via recall/adjustment.
      this.db.inventory.count({
        where: {
          pharmacyId,
          expiryDate: { lte: nearExpiryThreshold },
          quantity:   { gt: 0 },
          status:     { in: ["ACTIVE", "EXPIRED"] },
        },
      }),
    ]);

    return {
      todaySales:      parseFloat((todaySalesAgg._sum.totalAmount ?? 0).toFixed(2)),
      todayCount:      todaySalesAgg._count.id,
      todayCancelled:  todayCancelledCount,
      todayReturns:    Number(todayReturns._sum.totalAmount    ?? 0),
      last7DaysSales:  Number(weekInvoices._sum.totalAmount    ?? 0),
      last7DaysCount:  weekInvoices._count.id,
      monthSales:      Number(monthInvoices._sum.totalAmount   ?? 0),
      monthCount:      monthInvoices._count.id,
      pendingCredit:   Number(pendingCredit._sum.totalAmount   ?? 0),
      paymentBreakdown: paymentBreakdown.map((p) => ({
        mode:  p.paymentMode,
        total: Number(p._sum.totalAmount ?? 0),
        count: p._count.id,
      })),
      lowStockCount:  Number(lowStockCount[0]?.count ?? 0),
      nearExpiryCount,
    };
  }

  // ── FEFO batch selection ──────────────────────────────────────────────────
  // Selects the earliest-expiring batch with sufficient stock (FEFO — First
  // Expired First Out), which is the industry standard for pharmacy.
  // Previously named getFifoBatch, which was a misnomer: the query orders by
  // expiryDate ASC, not by receipt/purchase date (FIFO).

  async getFEFOBatch(medicineId: string, pharmacyId: string, quantity: number) {
    // Only ACTIVE batches are sellable — QUARANTINE/EXPIRED/DAMAGED (e.g. after a
    // batch recall) must never be suggested to the POS. Availability is
    // (quantity - reservedQuantity): stock reserved by other billing sessions is
    // not offerable. Prisma cannot compare two columns in a where clause, so we
    // scan the earliest-expiring candidates and pick the first with enough
    // unreserved stock (the candidate list is tiny — batches per medicine per
    // pharmacy are rarely more than a handful).
    const candidates = await this.db.inventory.findMany({
      where: {
        medicineId,
        pharmacyId,
        status:     "ACTIVE",
        quantity:   { gte: quantity },
        expiryDate: { gt: new Date() },
      },
      orderBy: { expiryDate: "asc" },
      include: { medicine: true },
      take:    25,
    });
    return candidates.find((b) => b.quantity - b.reservedQuantity >= quantity) ?? null;
  }

  // ── Repeat last bill ───────────────────────────────────────────────────────

  // The customer's most recent non-cancelled invoice, with the medicineId behind
  // each sold line (resolved through the batch that was sold, since InvoiceItem
  // stores inventoryId, not medicineId).
  async getLastInvoiceForCustomer(pharmacyId: string, customerId: string) {
    return this.db.invoice.findFirst({
      where:   { pharmacyId, customerId, isCancelled: false },
      orderBy: { createdAt: "desc" },
      select: {
        id:            true,
        invoiceNumber: true,
        createdAt:     true,
        items: {
          select: {
            quantity:     true,
            discount:     true,
            medicineName: true,
            inventory:    { select: { medicineId: true } },
          },
        },
      },
    });
  }

  // Current sellable batches for a set of medicines, earliest-expiry first, so
  // the service can re-pick a live batch for each — the originally-sold batch
  // may be depleted or expired by the time the bill is repeated.
  async getActiveBatchesForMedicines(pharmacyId: string, medicineIds: string[]) {
    if (medicineIds.length === 0) return [];
    return this.db.inventory.findMany({
      where: {
        pharmacyId,
        medicineId: { in: medicineIds },
        status:     "ACTIVE",
        expiryDate: { gt: new Date() },
      },
      orderBy: { expiryDate: "asc" },
      include: {
        medicine: { select: { id: true, name: true, gstRate: true, hsnCode: true, schedule: true, packSize: true, isActive: true } },
      },
    });
  }
}
