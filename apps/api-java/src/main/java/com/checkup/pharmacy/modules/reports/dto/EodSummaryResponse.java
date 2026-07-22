package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

public record EodSummaryResponse(BigDecimal gstCollected, List<TopMedicine> topMedicines, long overdueGrnCount) {

    public record TopMedicine(String medicineName, String genericName, long qtySold, BigDecimal revenue) {
    }
}
