package com.checkup.pharmacy.modules.inventory.dto;

import java.time.Instant;
import java.util.List;

public record LedgerPageResponse(List<Entry> items, long total, int page, int limit) {

    public record Entry(
            String id,
            String inventoryId,
            String batchNumber,
            String type,
            String direction,
            int quantity,
            int quantityBefore,
            int quantityAfter,
            String referenceType,
            String referenceId,
            String notes,
            String userId,
            Instant createdAt
    ) {
    }
}
