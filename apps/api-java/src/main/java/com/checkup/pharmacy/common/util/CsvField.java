package com.checkup.pharmacy.common.util;

/**
 * Escapes one value for inclusion in a CSV export.
 *
 * <p>Three platform-admin CSV exports (audit log, tenant list, analytics) each
 * carried their own copy of this logic, and none of the three neutralized
 * formula injection (CWE-1236): a value is quoted and internal quotes are
 * doubled, which stops a comma or quote in the data from corrupting the file,
 * but does nothing about a value that itself IS a formula. Every one of these
 * exports embeds at least one attacker-reachable field — pharmacy name is the
 * clearest, since public signup only requires {@code @NotBlank @Size(min = 2)}
 * with no character restriction. A pharmacy registered as, say,
 * {@code =HYPERLINK("http://evil.example","click")} passes that validation
 * untouched, and the three existing helpers would write it to the CSV exactly
 * as given. Excel/Sheets/LibreOffice evaluate a cell starting with
 * {@code = + - @} (or a tab/CR) as a formula by default in many
 * configurations — turning a low-privilege tenant signup into code execution
 * on whichever platform admin later opens the export.
 *
 * <p>Mitigation (OWASP's standard one for this class): a value beginning with
 * one of those characters gets a leading apostrophe before quoting, which every
 * common spreadsheet application treats as "this cell is text" and displays
 * literally, without altering how the value reads to anyone consuming the CSV
 * as data rather than opening it in a spreadsheet.
 */
public final class CsvField {

    private CsvField() {
    }

    public static String escape(String value) {
        if (value == null) {
            return "\"\"";
        }
        String v = value;
        char first = v.isEmpty() ? '\0' : v.charAt(0);
        if (first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r') {
            v = "'" + v;
        }
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }
}
