package com.checkup.pharmacy.modules.customerledger.dto;

import java.util.List;

/**
 * A page of a customer's khata, newest first, with their current balances attached.
 *
 * <p>The balances travel with the page so the screen showing the statement never has
 * to make a second call to say what the customer owes right now — and so the two can
 * never be rendered a refresh apart from each other.
 */
public record CustomerStatementResponse(
        List<CustomerLedgerEntryResponse> items,
        long total,
        int page,
        int limit,
        int totalPages,
        CustomerBalancesResponse balances
) {
}
