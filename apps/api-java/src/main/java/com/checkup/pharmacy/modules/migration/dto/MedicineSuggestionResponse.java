package com.checkup.pharmacy.modules.migration.dto;

import java.util.List;

public record MedicineSuggestionResponse(String csvValue, List<Suggestion> suggestions, ExistingMapping existingMapping) {

    public record Suggestion(String medicineId, String name, String manufacturer, double confidence) {
    }

    public record ExistingMapping(String medicineId, boolean isNew) {
    }
}
