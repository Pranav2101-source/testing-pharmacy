package com.checkup.pharmacy.modules.inventory.dto;

/**
 * @param warning a non-blocking note when the batch just added looks like a
 *                different pack size from the medicine's existing stock (a wrong
 *                pack size mis-prices every loose sale). Null when nothing is off.
 */
public record AddStockResponse(InventoryResponse item, boolean merged, String warning) {

    public AddStockResponse(InventoryResponse item, boolean merged) {
        this(item, merged, null);
    }
}
