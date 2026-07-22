package com.checkup.pharmacy.modules.stockaudit.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Historical P&L view over every APPROVED audit session — gain/loss valued at each item's purchase rate. */
public record AuditReportResponse(List<Session> sessions, Totals totals) {

    public record Session(String id, String sessionNumber, Instant approvedAt, long totalItems,
                          long itemsWithVariance, BigDecimal gainValue, BigDecimal lossValue, BigDecimal netValue) {
    }

    public record Totals(BigDecimal gainValue, BigDecimal lossValue, BigDecimal netValue) {
    }
}
