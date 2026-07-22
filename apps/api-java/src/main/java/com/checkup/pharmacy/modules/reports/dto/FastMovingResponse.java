package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

public record FastMovingResponse(List<Item> items) {

    public record Item(String inventoryId, MedicineRef medicine, long qtySold, BigDecimal revenue) {
    }

    public record MedicineRef(String id, String name, String genericName, String form) {
    }
}
