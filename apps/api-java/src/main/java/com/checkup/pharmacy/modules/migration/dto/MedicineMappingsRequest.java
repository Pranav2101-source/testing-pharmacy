package com.checkup.pharmacy.modules.migration.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record MedicineMappingsRequest(@NotEmpty List<Entry> mappings) {

    public record Entry(String csvValue, String medicineId, boolean isNew) {
    }
}
