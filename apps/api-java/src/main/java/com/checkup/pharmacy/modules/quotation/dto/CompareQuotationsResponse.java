package com.checkup.pharmacy.modules.quotation.dto;

import java.math.BigDecimal;
import java.util.List;

public record CompareQuotationsResponse(List<QuotationRef> quotations, List<MedicineComparison> comparison) {

    public record QuotationRef(String id, String quotationNumber, SupplierRef supplier) {
    }

    public record SupplierRef(String id, String name) {
    }

    public record MedicineComparison(String medicineId, String medicineName, BigDecimal bestRate, List<Quote> quotes) {
    }

    public record Quote(String quotationId, String supplierId, String supplierName, int quantity,
                        BigDecimal quotedRate, BigDecimal mrp, BigDecimal gstRate, BigDecimal discount,
                        BigDecimal effectiveRate, boolean isBestPrice) {
    }
}
