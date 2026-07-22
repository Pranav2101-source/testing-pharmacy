package com.checkup.pharmacy.modules.quotation.dto;

import com.checkup.pharmacy.modules.purchase.dto.PurchaseOrderResponse;

public record ConvertToPoResponse(String quotationId, String quotationNumber, String quotationStatus,
                                  PurchaseOrderResponse purchaseOrder) {
}
