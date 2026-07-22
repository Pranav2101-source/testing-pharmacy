package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma `TenantStatus` enum. Names MUST match the Postgres
 * "TenantStatus" enum type exactly.
 */
public enum TenantStatus {
    ACTIVE,
    SUSPENDED,
    ARCHIVED,
    PENDING,
    TRIAL,
    EXPIRED
}
