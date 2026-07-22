package com.checkup.pharmacy.modules.platform.subscription.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;

/** Body for {@code PATCH /platform/subscriptions/{id}/plan}. amount overrides plan pricing when present. */
public record ChangePlanRequest(
        @NotBlank String planName,
        String billingCycle,
        @PositiveOrZero Double amount) {
}
