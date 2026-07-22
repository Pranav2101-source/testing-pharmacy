package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma `SubscriptionStatus` enum. Names MUST match the Postgres
 * "SubscriptionStatus" enum type exactly.
 */
public enum SubscriptionStatus {
    ACTIVE,
    TRIAL,
    PAUSED,
    EXPIRED,
    CANCELLED
}
