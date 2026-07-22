package com.checkup.pharmacy.modules.platform.subscription.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * Body for {@code POST /platform/subscriptions/bulk}. action ∈ {UPGRADE, DOWNGRADE,
 * RENEW, PAUSE, RESUME, SUSPEND, EXPORT, EMAIL_REMINDER, GENERATE_INVOICE, ASSIGN_PLAN}.
 */
public record BulkSubscriptionRequest(
        @NotEmpty(message = "Select at least one subscription") List<String> ids,
        @NotBlank String action,
        String planName) {
}
