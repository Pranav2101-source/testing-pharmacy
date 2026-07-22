package com.checkup.pharmacy.modules.platform.subscription.dto;

import java.util.List;

/** Outcome of a bulk subscription action — count applied + per-id error messages. */
public record SubscriptionBulkResult(int affected, List<String> errors) {
}
