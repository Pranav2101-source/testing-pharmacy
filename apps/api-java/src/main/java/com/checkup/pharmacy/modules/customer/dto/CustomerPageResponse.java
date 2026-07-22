package com.checkup.pharmacy.modules.customer.dto;

import java.util.List;

public record CustomerPageResponse(
        List<CustomerResponse> items,
        long total,
        int page,
        int limit,
        int totalPages
) {
}
