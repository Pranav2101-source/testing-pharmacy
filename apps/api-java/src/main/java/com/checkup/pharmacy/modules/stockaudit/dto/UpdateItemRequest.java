package com.checkup.pharmacy.modules.stockaudit.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * At least one of countedQty/countedLooseUnits/notes must be present — enforced in the
 * service, not here (all three are independently optional).
 *
 * @param countedLooseUnits the loose (cut-strip) remainder physically counted, in pieces —
 *                          left null when staff didn't count it separately, which must NOT
 *                          be read as "counted zero" (see StockAuditItem.recordCount)
 */
public record UpdateItemRequest(
        @Min(0) Integer countedQty,
        @Min(0) Integer countedLooseUnits,
        @Size(max = 500) String notes
) {
}
