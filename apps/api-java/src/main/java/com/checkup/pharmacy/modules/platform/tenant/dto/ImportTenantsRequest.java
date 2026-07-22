package com.checkup.pharmacy.modules.platform.tenant.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/** Body for {@code POST /platform/tenants/import} — a batch of tenant rows to provision. */
public record ImportTenantsRequest(@NotNull List<Row> rows) {

    public record Row(
            String name,
            String ownerName,
            String ownerEmail,
            String ownerPhone,
            String gstin,
            String drugLicense,
            String address,
            String city,
            String state,
            String pincode,
            String phone,
            String email,
            String planName) {
    }
}
