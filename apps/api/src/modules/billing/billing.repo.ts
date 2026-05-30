import type { PrismaClient, Prisma } from "@pharmacy/database";
import type { PendingMovement } from "./billing.types.js";

// ─── Shared include shapes ────────────────────────────────────────────────────

const INVOICE_INCLUDE = {
  items:    true,
  customer: { select: { id: true, name: true, phone: true } },
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

  async getInventoryBatch(inventoryId: string, tenantId: string) {
    return this.db.inventory.findFirst({
      where: { id: inventoryId, tenantId },
      include: { medicine: true },
    });
  }

  async getInventoryBatches(ids: string[], tenantId: string) {
    return this.db.inventory.findMany({
      where: { id: { in: ids }, tenantId },
      include: { medicine: true },
    });
  }

  // ── Invoice settings ─────────────────────────────────────────────────────

  async getSettings(tenantId: string) {
    return this.db.invoiceSettings.findUnique({ where: { tenantId } });
  }

  // ── Create invoice (atomic) ───────────────────────────────────────────────
  //
  // Transaction order:
  //   1. Check idempotency key — if already exists, return existing invoice.
  //   2. For each line item: conditional UPDATE (qty >= needed) → throw on failure.
  //   3. Collect before/after quantities for movement records.
  //   4. Create invoice + items.
  //   5. Write InventoryMovement rows (one per item).
  //   6. If customer is CREDIT type, increment creditUsed.
  //   7. Write AuditLog.

  async createInvoiceTransactional(params: {
    tenantId:       string;
    userId:         string;
    invoiceData:    Prisma.InvoiceCreateInput;
    stockDecrements: { inventoryId: string; quantity: number; medicineName: string }[];
    idempotencyKey?: string;
    customerId?:     string;
    totalAmount:     number;
    paymentStatus?:  string;
    auditMeta?:      { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {

      // Step 0 — idempotency: return existing invoice if this key was already used
      if (params.idempotencyKey) {
        const existing = await tx.invoice.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId:       params.tenantId,
              idempotencyKey: params.idempotencyKey,
            },
          },
          include: INVOICE_INCLUDE,
        });
        if (existing) return existing;
      }

      // Step 0.5 — release stock reservations for this billing session.
      // Runs inside the Serializable transaction so it rolls back on failure,
      // keeping reservations intact if the stock decrement below fails.
      if (params.idempotencyKey) {
        const reservations = await tx.stockReservation.findMany({
          where:  { tenantId: params.tenantId, sessionId: params.idempotencyKey },
          select: { inventoryId: true, quantity: true },
        });
        if (reservations.length > 0) {
          await tx.stockReservation.deleteMany({
            where: { tenantId: params.tenantId, sessionId: params.idempotencyKey },
          });
          for (const r of reservations) {
            await tx.inventory.update({
              where: { id: r.inventoryId },
              data:  { reservedQuantity: { decrement: r.quantity } },
            });
          }
        }
      }

      // Step 1 — atomic stock decrement + collect movement data
      const movements: PendingMovement[] = [];

      for (const item of params.stockDecrements) {
        const result = await tx.inventory.updateMany({
          where: {
            id:       item.inventoryId,
            tenantId: params.tenantId,
            quantity: { gte: item.quantity },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        if (result.count === 0) {
          const current = await tx.inventory.findFirst({
            where:  { id: item.inventoryId, tenantId: params.tenantId },
            select: { quantity: true },
          });
          const available = current?.quantity ?? 0;
          throw Object.assign(
            new Error(
              current
                ? `Insufficient stock for "${item.medicineName}": ${available} available, ${item.quantity} requested`
                : `Inventory item not found: ${item.inventoryId}`
            ),
            { statusCode: current ? 409 : 404 }
          );
        }

        // Read current (post-decrement) qty to record movement
        const after = await tx.inventory.findFirst({
          where:  { id: item.inventoryId },
          select: { quantity: true },
        });
        const quantityAfter  = after!.quantity;
        const quantityBefore = quantityAfter + item.quantity;

        movements.push({ inventoryId: item.inventoryId, quantity: item.quantity, quantityBefore, quantityAfter });
      }

      // Step 2 — create invoice + line items
      const invoice = await tx.invoice.create({
        data:    params.invoiceData,
        include: INVOICE_INCLUDE,
      });

      // Step 3 — inventory movements
      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            tenantId:      params.tenantId,
            userId:        params.userId,
            inventoryId:   m.inventoryId,
            type:          "SALE" as const,
            direction:     "OUT" as const,
            quantity:      m.quantity,
            quantityBefore: m.quantityBefore,
            quantityAfter:  m.quantityAfter,
            referenceType:  "invoice",
            referenceId:    invoice.id,
          })),
        });
      }

      // Step 4 — update customer credit balance for CREDIT sales.
      // Only increment when payment is not already settled (PAID) — otherwise
      // creditUsed would be permanently inflated with no corresponding decrement.
      if (params.customerId && params.totalAmount > 0 && params.paymentStatus !== "PAID") {
        await tx.customer.updateMany({
          where: { id: params.customerId, tenantId: params.tenantId, customerType: "CREDIT" },
          data:  { creditUsed: { increment: params.totalAmount } },
        });
      }

      // Step 5 — audit log
      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId:   params.userId,
          action:   "CREATE",
          entity:   "Invoice",
          entityId: invoice.id,
          newData: {
            invoiceNumber: invoice.invoiceNumber,
            totalAmount:   invoice.totalAmount,
            itemCount:     invoice.items.length,
            paymentMode:   invoice.paymentMode,
          },
          ipAddress: params.auditMeta?.ipAddress,
          userAgent: params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return invoice;
    }, {
      isolationLevel: "Serializable",
      timeout: 15_000,
    }).catch((err: { code?: string }) => {
      if (err.code === "P2034") {
        throw Object.assign(
          new Error("Another transaction updated this stock simultaneously — please try again"),
          { statusCode: 409 }
        );
      }
      throw err;
    });
  }

  // ── Cancel invoice (atomic) ───────────────────────────────────────────────

  async cancelInvoiceTransactional(params: {
    invoiceId: string;
    tenantId:  string;
    userId:    string;
    reason:    string;
    auditMeta?: { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, tenantId: params.tenantId },
        include: { items: { select: { inventoryId: true, quantity: true } } },
      });

      if (!invoice) {
        throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      }

      if (invoice.isCancelled || invoice.status === "CANCELLED") {
        throw Object.assign(new Error("Invoice is already cancelled"), { statusCode: 409 });
      }

      if (invoice.status === "RETURNED" || invoice.status === "PARTIALLY_RETURNED") {
        throw Object.assign(new Error("Cannot cancel a returned invoice"), { statusCode: 409 });
      }

      // Atomic cancel — prevents double-cancel races
      const result = await tx.invoice.updateMany({
        where: { id: params.invoiceId, tenantId: params.tenantId, isCancelled: false },
        data:  {
          isCancelled:  true,
          cancelledAt:  new Date(),
          cancelReason: params.reason,
          status:       "CANCELLED",
        },
      });

      if (result.count === 0) {
        throw Object.assign(new Error("Invoice is already cancelled"), { statusCode: 409 });
      }

      // Restore stock + write movements
      const movements: PendingMovement[] = [];
      for (const item of invoice.items) {
        await tx.inventory.update({
          where: { id: item.inventoryId },
          data:  { quantity: { increment: item.quantity } },
        });
        const after = await tx.inventory.findFirst({
          where:  { id: item.inventoryId },
          select: { quantity: true },
        });
        const quantityAfter  = after!.quantity;
        const quantityBefore = quantityAfter - item.quantity;
        movements.push({ inventoryId: item.inventoryId, quantity: item.quantity, quantityBefore, quantityAfter });
      }

      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            tenantId:       params.tenantId,
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

      // Reverse credit balance if it was a credit sale
      if (invoice.customerId && invoice.totalAmount > 0) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId, tenantId: params.tenantId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: invoice.totalAmount } },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId:   params.userId,
          action:   "DELETE",
          entity:   "Invoice",
          entityId: invoice.id,
          oldData:  { isCancelled: false, invoiceNumber: invoice.invoiceNumber },
          newData:  { isCancelled: true,  cancelReason:  params.reason },
          ipAddress: params.auditMeta?.ipAddress,
          userAgent: params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return tx.invoice.findFirst({ where: { id: params.invoiceId }, include: INVOICE_INCLUDE });
    });
  }

  // ── Sales return (atomic) ─────────────────────────────────────────────────
  //
  // Transaction order:
  //   1. Lock + fetch invoice and all existing returns for it.
  //   2. Validate: invoice must be COMPLETED or PARTIALLY_RETURNED.
  //   3. Validate each return item: qty <= original qty - already returned qty.
  //   4. Restore stock for returned items.
  //   5. Write InventoryMovement rows.
  //   6. Create SalesReturn + SalesReturnItem rows.
  //   7. Update Invoice.returnedAmount and status.
  //   8. Reverse customer creditUsed proportionally.
  //   9. Audit log.

  async createReturnTransactional(params: {
    tenantId:       string;
    invoiceId:      string;
    userId:         string;
    returnNumber:   string;
    reason:         string;
    idempotencyKey?: string;
    returnItems: {
      invoiceItemId: string;
      quantity:      number;
    }[];
    auditMeta?: { ipAddress?: string; userAgent?: string };
  }) {
    return this.db.$transaction(async (tx) => {

      // Step 0 — idempotency: return existing return if this key was already processed
      if (params.idempotencyKey) {
        const existing = await tx.salesReturn.findFirst({
          where:   { tenantId: params.tenantId, idempotencyKey: params.idempotencyKey },
          include: RETURN_INCLUDE,
        });
        if (existing) return existing;
      }

      // Step 1 — fetch invoice with items and existing returns
      const invoice = await tx.invoice.findFirst({
        where:   { id: params.invoiceId, tenantId: params.tenantId },
        include: {
          items:   true,
          returns: { include: { items: true } },
        },
      });

      if (!invoice) {
        throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      }

      if (invoice.status === "CANCELLED") {
        throw Object.assign(new Error("Cannot return a cancelled invoice"), { statusCode: 409 });
      }
      if (invoice.status === "DRAFT") {
        throw Object.assign(new Error("Cannot return a draft invoice"), { statusCode: 409 });
      }
      if (invoice.status === "RETURNED") {
        throw Object.assign(new Error("Invoice is already fully returned"), { statusCode: 409 });
      }

      // Build map: invoiceItemId → sum of already-returned quantities
      const alreadyReturnedMap = new Map<string, number>();
      for (const ret of invoice.returns) {
        for (const ri of ret.items) {
          if (ri.invoiceItemId) {
            alreadyReturnedMap.set(ri.invoiceItemId, (alreadyReturnedMap.get(ri.invoiceItemId) ?? 0) + ri.quantity);
          }
        }
      }

      // Step 2 — validate each return item
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
        taxableAmount: number;
        amount:        number;
      }[] = [];

      for (const ri of params.returnItems) {
        const originalItem = invoice.items.find((i) => i.id === ri.invoiceItemId);
        if (!originalItem) {
          throw Object.assign(
            new Error(`Item ${ri.invoiceItemId} does not belong to invoice ${invoice.invoiceNumber}`),
            { statusCode: 400 }
          );
        }

        const alreadyReturned  = alreadyReturnedMap.get(ri.invoiceItemId) ?? 0;
        const maxReturnable    = originalItem.quantity - alreadyReturned;

        if (ri.quantity <= 0) {
          throw Object.assign(new Error(`Return quantity must be positive`), { statusCode: 400 });
        }
        if (ri.quantity > maxReturnable) {
          throw Object.assign(
            new Error(
              `Cannot return ${ri.quantity} of "${originalItem.medicineName}": only ${maxReturnable} returnable (${alreadyReturned} already returned)`
            ),
            { statusCode: 422 }
          );
        }

        // Scale financials proportionally to return quantity
        const ratio        = ri.quantity / originalItem.quantity;
        const cgst         = parseFloat((originalItem.cgst         * ratio).toFixed(2));
        const sgst         = parseFloat((originalItem.sgst         * ratio).toFixed(2));
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
          taxableAmount,
          amount,
        });
      }

      // Step 3 — restore stock + write movements
      const movements: PendingMovement[] = [];
      for (const li of returnLineItems) {
        await tx.inventory.update({
          where: { id: li.inventoryId },
          data:  { quantity: { increment: li.quantity } },
        });
        const after = await tx.inventory.findFirst({
          where:  { id: li.inventoryId },
          select: { quantity: true },
        });
        const quantityAfter  = after!.quantity;
        const quantityBefore = quantityAfter - li.quantity;
        movements.push({ inventoryId: li.inventoryId, quantity: li.quantity, quantityBefore, quantityAfter });
      }

      // Step 4 — aggregate return totals
      const totalAmount     = parseFloat(returnLineItems.reduce((s, i) => s + i.amount, 0).toFixed(2));
      const totalCgst       = parseFloat(returnLineItems.reduce((s, i) => s + i.cgst, 0).toFixed(2));
      const totalSgst       = parseFloat(returnLineItems.reduce((s, i) => s + i.sgst, 0).toFixed(2));
      const totalTaxable    = parseFloat(returnLineItems.reduce((s, i) => s + i.taxableAmount, 0).toFixed(2));
      const totalDiscount   = 0; // discounts are baked into the rate already
      const subtotal        = parseFloat(returnLineItems.reduce((s, i) => s + i.mrp * i.quantity, 0).toFixed(2));

      // Step 5 — create SalesReturn
      const salesReturn = await tx.salesReturn.create({
        data: {
          tenantId:       params.tenantId,
          invoiceId:      params.invoiceId,
          returnNumber:   params.returnNumber,
          reason:         params.reason,
          userId:         params.userId,
          customerId:     invoice.customerId ?? undefined,
          idempotencyKey: params.idempotencyKey,
          subtotal,
          discountAmount: totalDiscount,
          taxableAmount:  totalTaxable,
          cgst:           totalCgst,
          sgst:           totalSgst,
          totalGst:       parseFloat((totalCgst + totalSgst).toFixed(2)),
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
              taxableAmount: li.taxableAmount,
              amount:        li.amount,
            })),
          },
        },
        include: RETURN_INCLUDE,
      });

      // Step 6 — update Invoice returnedAmount + status
      const newReturnedAmount = parseFloat((invoice.returnedAmount + totalAmount).toFixed(2));
      const isFullReturn      = newReturnedAmount >= invoice.totalAmount - 0.01; // tolerance for float rounding
      const newStatus         = isFullReturn ? "RETURNED" : "PARTIALLY_RETURNED";

      await tx.invoice.update({
        where: { id: params.invoiceId },
        data:  { returnedAmount: newReturnedAmount, status: newStatus },
      });

      // Step 7 — inventory movements
      if (movements.length > 0) {
        await tx.inventoryMovement.createMany({
          data: movements.map((m) => ({
            tenantId:       params.tenantId,
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

      // Step 8 — reverse credit balance
      if (invoice.customerId && totalAmount > 0) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId, tenantId: params.tenantId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: totalAmount } },
        });
      }

      // Step 9 — audit log
      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId:   params.userId,
          action:   "CREATE",
          entity:   "SalesReturn",
          entityId: salesReturn.id,
          newData: {
            returnNumber:   params.returnNumber,
            invoiceNumber:  invoice.invoiceNumber,
            totalAmount,
            itemCount:      returnLineItems.length,
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
    tenantId:    string;
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
        where:   { id: params.invoiceId, tenantId: params.tenantId },
        include: { payments: true },
      });

      if (!invoice) {
        throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      }
      if (invoice.isCancelled) {
        throw Object.assign(new Error("Cannot add payment to a cancelled invoice"), { statusCode: 409 });
      }

      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      const remaining = invoice.totalAmount - totalPaid;

      if (params.amount > remaining + 0.01) {
        throw Object.assign(
          new Error(`Payment of ₹${params.amount} exceeds outstanding balance of ₹${remaining.toFixed(2)}`),
          { statusCode: 422 }
        );
      }

      const payment = await tx.invoicePayment.create({
        data: {
          tenantId:    params.tenantId,
          invoiceId:   params.invoiceId,
          createdBy:   params.userId,
          amount:      params.amount,
          paymentMode: params.paymentMode as never,
          reference:   params.reference,
          notes:       params.notes,
          paidAt:      params.paidAt ?? new Date(),
        },
      });

      // Recompute payment status
      const newTotalPaid = totalPaid + params.amount;
      let paymentStatus: "PAID" | "PARTIAL" | "PENDING" = "PENDING";
      if (newTotalPaid >= invoice.totalAmount - 0.01)   paymentStatus = "PAID";
      else if (newTotalPaid > 0)                        paymentStatus = "PARTIAL";

      await tx.invoice.update({
        where: { id: params.invoiceId },
        data:  { paymentStatus, paymentMode: params.paymentMode as never },
      });

      // If fully paid, reduce credit balance
      if (paymentStatus === "PAID" && invoice.customerId) {
        await tx.customer.updateMany({
          where: { id: invoice.customerId, tenantId: params.tenantId, customerType: "CREDIT" },
          data:  { creditUsed: { decrement: invoice.totalAmount } },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: params.tenantId,
          userId:   params.userId,
          action:   "UPDATE",
          entity:   "Invoice",
          entityId: invoice.id,
          newData:  { payment: { amount: params.amount, mode: params.paymentMode, paymentStatus } },
          ipAddress: params.auditMeta?.ipAddress,
          userAgent: params.auditMeta?.userAgent?.slice(0, 500),
        },
      });

      return payment;
    });
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getInvoice(id: string, tenantId: string) {
    return this.db.invoice.findFirst({
      where:   { id, tenantId },
      include: INVOICE_INCLUDE,
    });
  }

  async listInvoices(
    tenantId: string,
    params: {
      page:             number;
      limit:            number;
      search?:          string;
      from?:            Date;
      to?:              Date;
      includeCancelled?: boolean;
      paymentMode?:     string;
      paymentStatus?:   string;
      userId?:          string;
      customerId?:      string;
      minAmount?:       number;
      maxAmount?:       number;
    }
  ) {
    const where: Prisma.InvoiceWhereInput = {
      tenantId,
      ...(params.includeCancelled ? {} : { isCancelled: false }),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
      ...(params.paymentMode   ? { paymentMode:   params.paymentMode   as never } : {}),
      ...(params.paymentStatus ? { paymentStatus: params.paymentStatus as never } : {}),
      ...(params.userId    ? { userId:    params.userId }    : {}),
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.minAmount !== undefined || params.maxAmount !== undefined
        ? { totalAmount: { ...(params.minAmount !== undefined ? { gte: params.minAmount } : {}), ...(params.maxAmount !== undefined ? { lte: params.maxAmount } : {}) } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { invoiceNumber: { contains: params.search, mode: "insensitive" } },
              { customer: { name:  { contains: params.search, mode: "insensitive" } } },
              { customer: { phone: { contains: params.search, mode: "insensitive" } } },
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
          returns:  { select: { id: true, totalAmount: true } },
        },
      }),
      this.db.invoice.count({ where }),
    ]);

    return { items, total, page: params.page, limit: params.limit, totalPages: Math.ceil(total / params.limit) };
  }

  // ── Returns ───────────────────────────────────────────────────────────────

  async getReturn(id: string, tenantId: string) {
    return this.db.salesReturn.findFirst({
      where:   { id, tenantId },
      include: RETURN_INCLUDE,
    });
  }

  async listReturns(
    tenantId: string,
    params: {
      page:       number;
      limit:      number;
      search?:    string;
      from?:      Date;
      to?:        Date;
      invoiceId?: string;
    }
  ) {
    const where: Prisma.SalesReturnWhereInput = {
      tenantId,
      ...(params.invoiceId ? { invoiceId: params.invoiceId } : {}),
      ...(params.from || params.to
        ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
        : {}),
      ...(params.search
        ? {
            OR: [
              { returnNumber: { contains: params.search, mode: "insensitive" } },
              { invoice: { invoiceNumber: { contains: params.search, mode: "insensitive" } } },
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

  async getDashboardStats(tenantId: string) {
    const now   = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart  = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nearExpiryThreshold = new Date(Date.now() + 90 * 86400000);

    const [
      todayInvoices,
      weekInvoices,
      monthInvoices,
      todayReturns,
      pendingCredit,
      paymentBreakdown,
      lowStockCount,
      nearExpiryCount,
    ] = await Promise.all([
      // Today's invoices
      this.db.invoice.findMany({
        where:  { tenantId, createdAt: { gte: todayStart }, isCancelled: false },
        select: { totalAmount: true, status: true },
      }),
      // Week invoices
      this.db.invoice.aggregate({
        where:   { tenantId, createdAt: { gte: weekStart }, isCancelled: false },
        _sum:    { totalAmount: true },
        _count:  { id: true },
      }),
      // Month invoices
      this.db.invoice.aggregate({
        where:   { tenantId, createdAt: { gte: monthStart }, isCancelled: false },
        _sum:    { totalAmount: true },
        _count:  { id: true },
      }),
      // Today's returns
      this.db.salesReturn.aggregate({
        where:  { tenantId, createdAt: { gte: todayStart } },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Pending credit
      this.db.invoice.aggregate({
        where:  { tenantId, paymentStatus: "PENDING", isCancelled: false },
        _sum:   { totalAmount: true },
      }),
      // Payment mode breakdown (today)
      this.db.invoice.groupBy({
        by:     ["paymentMode"],
        where:  { tenantId, createdAt: { gte: todayStart }, isCancelled: false },
        _sum:   { totalAmount: true },
        _count: { id: true },
      }),
      // Low stock
      this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM inventory
        WHERE "tenantId" = ${tenantId}
          AND quantity > 0
          AND quantity <= "minimumStock"
      `,
      // Near expiry
      this.db.inventory.count({
        where: { tenantId, expiryDate: { lte: nearExpiryThreshold }, quantity: { gt: 0 } },
      }),
    ]);

    const todaySales     = todayInvoices.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + i.totalAmount, 0);
    const todayCancelled = todayInvoices.filter((i) => i.status === "CANCELLED").length;

    return {
      todaySales:      parseFloat(todaySales.toFixed(2)),
      todayCount:      todayInvoices.filter((i) => i.status !== "CANCELLED").length,
      todayCancelled,
      todayReturns:    todayReturns._sum.totalAmount ?? 0,
      weekSales:       weekInvoices._sum.totalAmount  ?? 0,
      weekCount:       weekInvoices._count.id,
      monthSales:      monthInvoices._sum.totalAmount ?? 0,
      monthCount:      monthInvoices._count.id,
      pendingCredit:   pendingCredit._sum.totalAmount ?? 0,
      paymentBreakdown: paymentBreakdown.map((p) => ({
        mode:  p.paymentMode,
        total: p._sum.totalAmount ?? 0,
        count: p._count.id,
      })),
      lowStockCount:   Number(lowStockCount[0]?.count ?? 0),
      nearExpiryCount,
    };
  }

  // ── FIFO batch selection ──────────────────────────────────────────────────

  async getFifoBatch(medicineId: string, tenantId: string, quantity: number) {
    const now = new Date();
    // FIFO = earliest non-expired batch with sufficient stock
    const batch = await this.db.inventory.findFirst({
      where: {
        medicineId,
        tenantId,
        quantity:   { gte: quantity },
        expiryDate: { gt: now },
      },
      orderBy: { expiryDate: "asc" }, // earliest expiry first
      include: { medicine: true },
    });
    return batch;
  }
}
