package com.checkup.pharmacy.modules.migration.dto;

/** One validation finding for a CSV row — {@code field} is null for row-level (not field-level) issues. */
public record RowIssue(int row, String field, String message, String severity) {

    public static RowIssue error(int row, String field, String message) {
        return new RowIssue(row, field, message, "error");
    }

    public static RowIssue warning(int row, String field, String message) {
        return new RowIssue(row, field, message, "warning");
    }
}
