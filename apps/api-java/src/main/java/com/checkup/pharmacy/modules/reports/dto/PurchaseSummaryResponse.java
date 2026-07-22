package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;

/** Only the fields the Purchase page header badges actually read (usePurchaseSummary.ts). */
public record PurchaseSummaryResponse(long pendingGRNs, long overduePayments, long pendingApprovals,
                                      BigDecimal totalSpend) {
}
