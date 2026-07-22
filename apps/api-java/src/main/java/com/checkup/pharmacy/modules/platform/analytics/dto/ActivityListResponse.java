package com.checkup.pharmacy.modules.platform.analytics.dto;

import java.util.List;

/** Response for {@code /platform/analytics/activity} — {@code {items, total}}. */
public record ActivityListResponse(List<AnalyticsDashboardResponse.ActivityItem> items, long total) {
}
