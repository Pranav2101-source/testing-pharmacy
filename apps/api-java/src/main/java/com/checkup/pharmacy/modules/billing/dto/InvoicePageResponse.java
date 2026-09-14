package com.checkup.pharmacy.modules.billing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Invoice list rows.
 *
 * <p>{@code customer}, {@code user} and {@code _count} are NESTED objects rather than
 * flat {@code customerName}/{@code userName}/{@code itemCount} fields, to match the old
 * Node backend's response (a raw Prisma row plus {@code include: { customer: true, user:
 * { select: { name } }, _count: { select: { items } } }}). Both consumers still read the
 * nested shape and were never updated: {@code SalesPage.tsx} reads {@code inv.user.name}
 * and {@code inv._count.items} with no optional chaining — a flat shape crashed the whole
 * Bills table with "Cannot read properties of undefined" as soon as a single bill existed —
 * and {@code HomePage.tsx} reads {@code bill.customer?.name} / {@code bill._count?.items},
 * which degraded silently to "Walk-in" and 0 items for every recent bill.
 */
public record InvoicePageResponse(List<Summary> items, long total, int page, int limit, int totalPages) {

    /**
     * Lighter list-row shape — omits line items/payments, which the detail endpoint provides.
     *
     * <p>{@code amountPaid} and {@code balanceDue} ARE here despite that, because both are
     * scalars already on the invoice row: no join, no extra query, no N+1. Without them a
     * screen listing someone's unpaid bills can only show what each bill was worth, not what
     * is still owed on it — so a part-paid bill reads as wholly unpaid and any collection
     * offered against it is one the server is bound to refuse. The payment ROWS remain a
     * detail-endpoint concern; these two figures are not.
     */
    public record Summary(String id, String invoiceNumber, CustomerRef customer, UserRef user,
                          String doctorName, String paymentMode, String paymentStatus, String status,
                          BigDecimal totalAmount, BigDecimal amountPaid, BigDecimal balanceDue,
                          boolean isCancelled, CountRef _count, Instant createdAt) {
    }

    /**
     * Built from the invoice's denormalized {@code customerName}/{@code customerPhone} (which are
     * what actually printed on the bill) rather than the linked {@code Customer} row, so a walk-in
     * whose name was typed at the counter without creating a customer record still shows that name.
     * Null only when the bill genuinely carries no customer identity at all — which is exactly when
     * the frontend's {@code ?? "—"} / {@code ?? "Walk-in"} fallbacks are the right thing to show.
     */
    public record CustomerRef(String name, String phone) {
    }

    /** Never null — see BillingService.listInvoices; a hard-deleted staff row falls back to "Unknown". */
    public record UserRef(String name) {
    }

    public record CountRef(int items) {
    }
}
