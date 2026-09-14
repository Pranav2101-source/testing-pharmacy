package com.checkup.pharmacy.modules.customerledger.dto;

/**
 * Everything the counter needs after taking or returning a deposit: the numbered
 * entry to print as a voucher, and the balances it left behind.
 */
public record AdvanceReceiptResponse(
        CustomerLedgerEntryResponse entry,
        CustomerBalancesResponse balances
) {
}
