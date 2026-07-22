package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma `InvoicePaymentStatus` enum (subscription-invoice payment
 * state). Names MUST match the Postgres "InvoicePaymentStatus" enum type exactly.
 */
public enum InvoicePaymentStatus {
    PAID,
    PENDING,
    OVERDUE,
    CANCELLED,
    REFUNDED
}
