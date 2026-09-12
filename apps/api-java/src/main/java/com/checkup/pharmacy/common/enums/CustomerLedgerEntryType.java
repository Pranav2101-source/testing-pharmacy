package com.checkup.pharmacy.common.enums;

/**
 * Mirrors the Prisma `CustomerLedgerEntryType` enum.
 *
 * <p>The sign each type applies to the dues and advance balances is NOT encoded
 * here — it lives in exactly one place, the {@code postX} factories on
 * {@code CustomerLedgerService}, so no caller ever hand-computes a delta.
 */
public enum CustomerLedgerEntryType {
    /** Backfill baseline: the customer's dues as they stood before the ledger existed. */
    OPENING,
    /** The credit (unpaid) portion of a bill — dues up. */
    SALE,
    /** Money collected against dues — dues down. */
    PAYMENT,
    /** Deposit taken with no bill against it yet — advance up. */
    ADVANCE,
    /** Advance consumed by a bill — advance down AND dues down. */
    ADVANCE_APPLIED,
    /** Sales return against a bill that is not fully paid — dues down. */
    RETURN_CREDIT,
    /** Advance handed back to the customer in cash — advance down. */
    REFUND,
    /** Bad debt written off by the owner — dues down, with no money received. */
    WRITE_OFF
}
