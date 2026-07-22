package com.checkup.pharmacy.modules.platform.tenant.dto;

import jakarta.validation.constraints.NotBlank;

/** Body for {@code PATCH /platform/tenants/{id}/status}. Allowed: ACTIVE, SUSPENDED, ARCHIVED, TRIAL, EXPIRED. */
public record UpdateTenantStatusRequest(@NotBlank String status) {
}
