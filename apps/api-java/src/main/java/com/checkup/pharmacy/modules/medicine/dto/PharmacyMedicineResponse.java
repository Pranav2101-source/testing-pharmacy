package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;

public record PharmacyMedicineResponse(
        String id,
        String name,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String unit,
        String hsnCode,
        BigDecimal gstRate,
        String schedule,
        String matchStatus,
        String linkedMedicineId
) {
}
