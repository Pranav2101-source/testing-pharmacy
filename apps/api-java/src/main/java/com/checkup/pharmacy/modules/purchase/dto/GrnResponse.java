package com.checkup.pharmacy.modules.purchase.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record GrnResponse(
        String id,
        String grnNumber,
        SupplierRef supplier,
        PurchaseOrderRef purchaseOrder,
        String supplierInvoiceNo,
        Instant supplierInvoiceDate,
        String status,
        String notes,
        BigDecimal subtotal,
        BigDecimal totalGst,
        BigDecimal totalAmount,
        Instant confirmedAt,
        Instant paymentDueDate,
        List<Item> items,
        // Number of line items. Always populated, so the list view can show a count
        // without the response having to ship every line (the list sends items empty
        // and only this count); on detail/create it equals items.size().
        int itemCount,
        String warning,
        Instant createdAt,
        String sourceUploadId,
        UserRef createdBy,
        UserRef confirmedBy
) {
    public record SupplierRef(String id, String name, String phone, Integer creditDays) {
    }

    public record PurchaseOrderRef(String id, String orderNumber) {
    }

    /** null when the acting user was never recorded (GRN predates this field) or has since been deleted. */
    public record UserRef(String id, String name) {
    }

    public record Item(String id, String medicineId, String localMedicineId, String medicineName, String batchNumber,
                       Instant expiryDate, Integer orderedQty, int receivedQty, int freeQty, String purchaseUnit,
                       int conversionFactor, BigDecimal purchaseRate, BigDecimal mrp, BigDecimal discount,
                       BigDecimal gstRate, BigDecimal cgst, BigDecimal sgst, BigDecimal amount) {
    }
}
