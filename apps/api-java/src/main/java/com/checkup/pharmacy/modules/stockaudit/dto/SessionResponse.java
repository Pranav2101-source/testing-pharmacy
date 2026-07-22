package com.checkup.pharmacy.modules.stockaudit.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code _count.items} is nested (not a flat {@code totalItems}) to match the old Node backend's
 * response, which returned the raw Prisma row plus {@code include: { _count: { select: { items:
 * true } } }} — apps/web/src/pages/dashboard/StockAuditDetailPage.tsx reads {@code
 * session._count.items} directly and has no fallback for a missing/differently-shaped field.
 */
public record SessionResponse(
        String id,
        String sessionNumber,
        String status,
        String notes,
        Instant startedAt,
        Instant completedAt,
        Instant approvedAt,
        ApproverRef approver,
        CountRef _count,
        int countedItems,
        int itemsWithVariance,
        List<AuditItemResponse> items,
        Instant createdAt
) {
    public record ApproverRef(String id, String name) {
    }

    public record CountRef(int items) {
    }
}
