package com.checkup.pharmacy.modules.migration.csv;

import java.util.List;

public record ParsedCsv(List<String> headers, List<ParsedRow> rows) {

    /** {@code rowNumber} matches the row's original 1-based line number in the file (header = line 1). */
    public record ParsedRow(int rowNumber, java.util.Map<String, String> raw) {
    }
}
