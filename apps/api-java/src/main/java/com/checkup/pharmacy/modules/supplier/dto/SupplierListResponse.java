package com.checkup.pharmacy.modules.supplier.dto;

import java.util.List;

public record SupplierListResponse(List<SupplierResponse> items, long total, int page, int totalPages) {
}
