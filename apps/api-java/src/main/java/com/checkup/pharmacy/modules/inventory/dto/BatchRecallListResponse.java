package com.checkup.pharmacy.modules.inventory.dto;

import java.time.Instant;
import java.util.List;

public record BatchRecallListResponse(List<Item> items, long total, int page, int limit) {

    public record Item(String id, String batchNumber, String medicineId, String reason,
                       String recalledBy, Instant recalledAt, int affectedCount) {
    }
}
