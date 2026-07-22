package com.checkup.pharmacy.modules.purchase;

import java.math.BigDecimal;

/**
 * One draft line item on a {@link PurchaseOrder}, persisted as a JSON array in the
 * {@code items} column (not a child table — see the Prisma schema comment on
 * PurchaseOrder.items: no cross-row aggregation ever queries into this, so a
 * child table would only add a join for nothing). Batch/expiry are placeholders
 * until goods actually arrive via GRN.
 */
public record PurchaseOrderItemSnapshot(
        String medicineId,
        String medicineName,
        String batchNumber,
        String expiryDate,
        int quantity,
        BigDecimal purchaseRate,
        BigDecimal mrp,
        BigDecimal gstRate,
        BigDecimal cgst,
        BigDecimal sgst,
        BigDecimal amount
) {
}
