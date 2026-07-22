package com.checkup.pharmacy.modules.platform.analytics.dto;

import java.util.List;

/** New-pharmacies drilldown ({@code /platform/analytics/new-pharmacies}). Matches the Node shape. */
public record NewPharmaciesResponse(Summary summary, Pagination pagination, List<Item> items) {

    public record Summary(long total, long active, long suspended, long archived) {
    }

    public record Pagination(int page, int limit, int totalPages, long total) {
    }

    public record Item(String id, String logoUrl, String name, String tenantCode, String ownerName,
                       String ownerEmail, Plan plan, String createdAt, String status) {
    }

    public record Plan(String name, String color) {
    }
}
