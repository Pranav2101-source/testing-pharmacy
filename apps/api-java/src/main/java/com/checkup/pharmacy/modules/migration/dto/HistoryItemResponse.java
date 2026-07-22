package com.checkup.pharmacy.modules.migration.dto;

import java.time.Instant;

public record HistoryItemResponse(String entityType, int successRows, Instant completedAt) {
}
