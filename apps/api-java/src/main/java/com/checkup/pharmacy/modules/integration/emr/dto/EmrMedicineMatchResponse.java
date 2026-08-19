package com.checkup.pharmacy.modules.integration.emr.dto;

import java.math.BigDecimal;
import java.util.List;

public record EmrMedicineMatchResponse(List<Item> items) {
    public record Item(
            String externalItemId,
            String matchStrategy,
            String medicineId,
            String name,
            String genericName,
            String strength,
            String form,
            String unit,
            int availableQuantity,
            BigDecimal approximatePrice
    ) {
    }
}
