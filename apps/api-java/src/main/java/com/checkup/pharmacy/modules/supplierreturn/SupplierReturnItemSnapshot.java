package com.checkup.pharmacy.modules.supplierreturn;

import java.math.BigDecimal;

/**
 * One line item on a {@link SupplierReturn} debit note, persisted as a JSON array
 * (same rationale as PurchaseOrder.items — no cross-row aggregation ever queries
 * into this). {@code inventoryId} is re-validated against live Inventory at
 * confirm time regardless of this snapshot.
 */
public record SupplierReturnItemSnapshot(
        String inventoryId,
        String medicineId,
        String medicineName,
        String batchNumber,
        String expiryDate,
        int quantity,
        BigDecimal purchaseRate,
        BigDecimal taxableAmount,
        BigDecimal gstRate,
        BigDecimal cgst,
        BigDecimal sgst,
        BigDecimal igst,
        BigDecimal amount,
        String reason
) {
}
