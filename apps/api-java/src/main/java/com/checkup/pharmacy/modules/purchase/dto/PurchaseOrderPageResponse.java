package com.checkup.pharmacy.modules.purchase.dto;

import java.util.List;

public record PurchaseOrderPageResponse(List<PurchaseOrderResponse> items, long total, int page, int limit) {
}
