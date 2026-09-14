package com.checkup.pharmacy.modules.customerledger.dto;

import java.math.BigDecimal;

/**
 * What a customer owes and what we hold for them.
 *
 * <p>{@code dues} and {@code advance} are separate and both unsigned — a customer can
 * genuinely be in both at once (owing on an old bill while holding a deposit for a
 * standing order), and netting them would hide that from the counter.
 */
public record CustomerBalancesResponse(
        String customerId,
        String customerName,
        BigDecimal dues,
        BigDecimal advance,
        BigDecimal creditLimit,
        BigDecimal creditAvailable
) {
}
