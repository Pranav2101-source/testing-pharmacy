package com.checkup.pharmacy.modules.medicine.dto;

import java.util.List;

public record BulkImportResponse(int added, int skipped, int failed, List<String> parseErrors) {
}
