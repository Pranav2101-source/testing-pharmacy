package com.checkup.pharmacy.modules.cashclosure.dto;

import java.util.List;

public record CashClosurePageResponse(List<CashClosureResponse> items, long total, int page, int limit, int pages) {
}
