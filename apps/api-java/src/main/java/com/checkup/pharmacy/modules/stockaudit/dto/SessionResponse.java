package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;
import java.util.List;

public record SessionResponse(
        String id,
        String sessionNumber,
        String status,
        String notes,
        Instant startedAt,
        Instant completedAt,
        Instant approvedAt,
        ApproverRef approver,
        int totalItems,
        int countedItems,
        int itemsWithVariance,
        List<AuditItemResponse> items,
        Instant createdAt
) {
    public record ApproverRef(String id, String name) {
    }
}
