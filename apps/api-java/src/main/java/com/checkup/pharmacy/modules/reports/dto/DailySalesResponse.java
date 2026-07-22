package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;

public record DailySalesResponse(String date, long invoiceCount, BigDecimal revenue, BigDecimal gstCollected) {
}
