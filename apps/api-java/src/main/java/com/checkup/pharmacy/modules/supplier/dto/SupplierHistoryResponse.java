package com.checkup.pharmacy.modules.supplier.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Per-supplier purchase history — recent orders/receipts plus a lifetime spend summary. */
public record SupplierHistoryResponse(Orders orders, List<Grn> recentGRNs, Summary summary) {

    public record Orders(List<Order> items) {
    }

    public record Order(String id, String orderNumber, String status, BigDecimal totalAmount,
                        Instant orderedAt, @JsonProperty("_count") ItemCount count) {
    }

    public record ItemCount(long items) {
    }

    public record Grn(String id, String grnNumber, String status, BigDecimal totalAmount, Instant createdAt) {
    }

    public record Summary(long totalOrders, BigDecimal totalSpend) {
    }
}
