package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;
import java.util.List;

public record BulkImportRequest(List<Row> rows) {

    public record Row(
            String name,
            String genericName,
            String manufacturer,
            String composition,
            String category,
            String schedule,
            String hsnCode,
            BigDecimal gstRate,
            String form,
            String strength,
            String unit,
            String packSize
    ) {
    }
}
