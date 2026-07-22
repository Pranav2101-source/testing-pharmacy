package com.checkup.pharmacy.modules.platform.tenant.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/** Body for {@code POST /platform/tenants/bulk}. action ∈ {SUSPEND, ACTIVATE, ARCHIVE}. */
public record BulkTenantActionRequest(
        @NotEmpty(message = "Select at least one tenant") List<String> ids,
        @NotNull String action) {
}
