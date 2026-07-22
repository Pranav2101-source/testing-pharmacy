package com.checkup.pharmacy.modules.location.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** Matches the frontend's Shelf shape, including the nested rack summary and inventory count. */
public record ShelfResponse(
        String id,
        String code,
        int level,
        String description,
        boolean isActive,
        RackRef rack,
        @JsonProperty("_count") InventoryCount count
) {
    public record RackRef(String id, String code, String name) {
    }

    /**
     * {@code inventory} is hardcoded to 0 until the inventory module (C11) exists
     * — an honest placeholder, matching the pattern used for medicines/reindex
     * and customers/_count.invoices.
     */
    public record InventoryCount(long inventory) {
    }
}
