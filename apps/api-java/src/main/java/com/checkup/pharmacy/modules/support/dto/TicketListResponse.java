package com.checkup.pharmacy.modules.support.dto;

import java.util.List;

public record TicketListResponse(List<TicketResponse> items, long total, int page, int limit, int totalPages) {
}
