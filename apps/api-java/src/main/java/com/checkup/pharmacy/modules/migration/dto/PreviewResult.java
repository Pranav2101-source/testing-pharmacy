package com.checkup.pharmacy.modules.migration.dto;

import java.util.List;
import java.util.Map;

public record PreviewResult(int totalRows, int validRows, int errorRows, List<RowIssue> issues,
                            List<String> headers, List<String> unmappedMedicines,
                            List<Map<String, Object>> sampleRows) {
}
