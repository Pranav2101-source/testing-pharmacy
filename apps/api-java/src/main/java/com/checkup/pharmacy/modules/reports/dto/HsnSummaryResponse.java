package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

public record HsnSummaryResponse(List<Row> rows) {

    public record Row(String hsnCode, BigDecimal gstRate, long totalQty, BigDecimal taxableAmount, BigDecimal cgst,
                      BigDecimal sgst, BigDecimal igst, BigDecimal totalGst, BigDecimal totalAmount) {
    }
}
