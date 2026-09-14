package com.checkup.pharmacy.common.enums;

/** Mirrors the Prisma `PaymentMode` enum. */
public enum PaymentMode {
    CASH,
    UPI,
    CARD,
    CREDIT,
    WALLET,
    /** Settled from a deposit the customer paid earlier — no money moves at the till now. */
    ADVANCE
}
