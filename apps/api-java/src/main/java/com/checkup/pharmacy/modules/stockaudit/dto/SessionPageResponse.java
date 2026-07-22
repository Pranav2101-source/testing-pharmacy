package com.checkup.pharmacy.modules.stockaudit.dto;

import java.util.List;

public record SessionPageResponse(List<SessionSummary> items, long total, int page, int limit) {
}
