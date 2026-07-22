package com.checkup.pharmacy.modules.supplierpayment.dto;

import java.util.List;

public record PaymentPageResponse(List<PaymentResponse> items, long total, int page, int limit) {
}
