package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

public record ValuationResponse(String groupBy, BigDecimal totalCostValue, BigDecimal totalRetailValue,
                                List<Item> items) {

    public record Item(String key, String medicineName, String category, BigDecimal costValue,
                       BigDecimal retailValue, int totalQty) {
    }
}
