package com.checkup.pharmacy.modules.supplierreturn.dto;

import java.util.List;

public record SupplierReturnPageResponse(List<SupplierReturnResponse> items, long total, int page, int limit) {
}
