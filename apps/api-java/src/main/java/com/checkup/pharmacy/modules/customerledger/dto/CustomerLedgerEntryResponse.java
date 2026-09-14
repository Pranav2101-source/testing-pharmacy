package com.checkup.pharmacy.modules.customerledger.dto;

import com.checkup.pharmacy.modules.customerledger.CustomerLedgerEntry;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One line of a customer's khata.
 *
 * <p>Carries both deltas and both running balances rather than a single signed
 * figure: a statement has two columns that move independently (what they owe us,
 * what we hold for them) and an ADVANCE_APPLIED line moves both at once.
 */
public record CustomerLedgerEntryResponse(
        String id,
        Long seq,
        String type,
        String entryNumber,
        BigDecimal amount,
        BigDecimal duesDelta,
        BigDecimal advanceDelta,
        BigDecimal duesBalanceAfter,
        BigDecimal advanceBalanceAfter,
        String invoiceId,
        String salesReturnId,
        String paymentMode,
        String reference,
        String notes,
        Instant entryAt,
        Instant createdAt
) {

    public static CustomerLedgerEntryResponse from(CustomerLedgerEntry e) {
        return new CustomerLedgerEntryResponse(
                e.getId(),
                e.getSeq(),
                e.getType().name(),
                e.getEntryNumber(),
                e.getAmount(),
                e.getDuesDelta(),
                e.getAdvanceDelta(),
                e.getDuesBalanceAfter(),
                e.getAdvanceBalanceAfter(),
                e.getInvoiceId(),
                e.getSalesReturnId(),
                e.getPaymentMode() == null ? null : e.getPaymentMode().name(),
                e.getReference(),
                e.getNotes(),
                e.getEntryAt(),
                e.getCreatedAt());
    }
}
