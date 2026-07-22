package com.checkup.pharmacy.modules.location.dto;

import java.util.List;

/** Matches the frontend's Rack shape; `shelves` carries only ids (for the frontend's shelf count). */
public record RackResponse(
        String id,
        String code,
        String name,
        String aisle,
        boolean isActive,
        List<ShelfIdRef> shelves
) {
    public record ShelfIdRef(String id) {
    }
}
