package com.checkup.pharmacy.modules.migration.dto;

import java.util.Map;

public record ColumnMappingsRequest(Map<String, String> mappings) {
}
