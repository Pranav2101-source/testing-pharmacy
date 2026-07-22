package com.checkup.pharmacy.modules.quotation.dto;

import java.util.List;

public record QuotationPageResponse(List<QuotationResponse> items, long total, int page, int limit) {
}
