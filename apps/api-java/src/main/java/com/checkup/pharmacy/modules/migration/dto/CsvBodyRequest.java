package com.checkup.pharmacy.modules.migration.dto;

import java.util.Map;

/** Shared body shape for every endpoint that carries raw CSV text + the confirmed column mappings. */
public record CsvBodyRequest(String csvText, Map<String, String> columnMappings) {
}
