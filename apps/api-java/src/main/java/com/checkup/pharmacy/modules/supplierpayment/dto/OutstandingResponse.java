package com.checkup.pharmacy.modules.supplierpayment.dto;

import java.math.BigDecimal;
import java.util.List;

public record OutstandingResponse(List<SupplierDue> suppliers, BigDecimal totalOutstanding,
                                  BigDecimal totalOverdue, int count) {

    public record SupplierDue(String id, String name, String phone, int creditDays, BigDecimal totalPurchased,
                              BigDecimal totalPaid, BigDecimal outstanding, BigDecimal overdueAmount) {
    }
}
