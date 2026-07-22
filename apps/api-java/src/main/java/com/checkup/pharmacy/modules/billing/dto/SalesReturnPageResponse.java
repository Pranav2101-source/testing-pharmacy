package com.checkup.pharmacy.modules.billing.dto;

import java.util.List;

public record SalesReturnPageResponse(List<SalesReturnResponse> items, long total, int page, int limit, int totalPages) {
}
