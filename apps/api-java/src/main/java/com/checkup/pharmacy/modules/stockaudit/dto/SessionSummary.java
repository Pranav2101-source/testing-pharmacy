package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;

/**
 * Lighter shape for list views — omits the (potentially large) item array. {@code _count.items}
 * is nested rather than a flat {@code totalItems} to match apps/web/src/pages/dashboard/
 * StockAuditPage.tsx, which reads {@code session._count.items} directly — see SessionResponse's
 * javadoc for why.
 */
public record SessionSummary(
        String id,
        String sessionNumber,
        String status,
        String notes,
        String createdBy,
        Instant startedAt,
        Instant completedAt,
        Instant approvedAt,
        SessionResponse.CountRef _count,
        int countedItems,
        int itemsWithVariance,
        Instant createdAt
) {
}
