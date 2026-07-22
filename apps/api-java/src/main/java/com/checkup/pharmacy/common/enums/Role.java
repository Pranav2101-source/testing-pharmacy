package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma `Role` enum. The names MUST match the values stored in the
 * Postgres "Role" enum type exactly.
 */
public enum Role {
    OWNER,
    MANAGER,
    PHARMACIST,
    CASHIER,
    SUPPORT_AGENT,
    PLATFORM_ADMIN
}
