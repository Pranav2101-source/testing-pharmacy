package com.checkup.pharmacy.common.projection;

import java.math.BigDecimal;

/** Shared Spring Data projection for "total amount grouped by supplierId" queries (payments, GRN dues, ...). */
public interface SupplierAmountRow {
    String getSupplierId();
    BigDecimal getTotal();
}
