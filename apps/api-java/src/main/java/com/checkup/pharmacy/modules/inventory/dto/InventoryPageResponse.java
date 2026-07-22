package com.checkup.pharmacy.modules.inventory.dto;

import java.util.List;

public record InventoryPageResponse(
        List<InventoryResponse> items,
        long total,
        int page,
        int limit,
        AlertCounts alertCounts
) {
    public record AlertCounts(long expiry, long lowStock) {
    }
}
