package com.checkup.pharmacy.modules.medicine.dto;

import java.util.List;

public record MedicinePageResponse(
        List<MedicineResponse> items,
        long total,
        int page,
        int totalPages
) {
}
