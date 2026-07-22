package com.checkup.pharmacy.modules.supplierpayment.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record SupplierBalanceResponse(
        SupplierRef supplier,
        BigDecimal totalPurchased,
        BigDecimal totalPaid,
        BigDecimal outstanding,
        BigDecimal overdueAmount,
        List<OverdueGrn> overdueGrns,
        BigDecimal creditLimit,
        int creditDays
) {
    public record SupplierRef(String id, String name, BigDecimal creditLimit, int creditDays) {
    }

    public record OverdueGrn(String id, String grnNumber, BigDecimal totalAmount, Instant paymentDueDate, String supplierInvoiceNo) {
    }
}
