package com.checkup.pharmacy.modules.cashclosure.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record CashClosureResponse(
        String id,
        UserRef user,
        LocalDate closureDate,
        BigDecimal openingCash,
        BigDecimal cashSales,
        BigDecimal upiSales,
        BigDecimal cardSales,
        BigDecimal creditSales,
        BigDecimal walletSales,
        BigDecimal expectedCash,
        BigDecimal actualCash,
        BigDecimal variance,
        String notes,
        String status,
        Instant closedAt,
        Instant createdAt
) {
    public record UserRef(String id, String name) {
    }
}
