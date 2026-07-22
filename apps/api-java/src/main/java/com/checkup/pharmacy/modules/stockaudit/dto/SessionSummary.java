package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;

/** Lighter shape for list views — omits the (potentially large) item array. */
public record SessionSummary(
        String id,
        String sessionNumber,
        String status,
        Instant startedAt,
        Instant completedAt,
        Instant approvedAt,
        int totalItems,
        int countedItems,
        int itemsWithVariance,
        Instant createdAt
) {
}
