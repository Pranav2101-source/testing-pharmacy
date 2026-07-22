package com.checkup.pharmacy.modules.migration.csv;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * CSV parsing and date normalization shared by every commit/preview path (sync only —
 * see {@code MigrationService} javadoc for why there's no separate background-worker
 * copy of this logic to drift out of sync with, unlike the old Node backend's original bug).
 */
@Component
public class MigrationCsvParser {

    public enum DateContext { EXPIRY, DOB, GENERIC }

    /** Parses raw CSV text into a header row + data rows. Empty/single-line input yields no rows. */
    public ParsedCsv parse(String csvText) {
        String normalised = csvText.replaceFirst("^﻿", "").replace("\r\n", "\n").replace("\r", "\n").trim();
        String[] lines = normalised.split("\n", -1);
        if (lines.length < 2) {
            return new ParsedCsv(List.of(), List.of());
        }

        String headerLine = lines[0];
        char delimiter = countChar(headerLine, '\t') > countChar(headerLine, ',') ? '\t' : ',';
        List<String> headers = splitLine(headerLine, delimiter);

        List<ParsedCsv.ParsedRow> rows = new ArrayList<>();
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.isBlank()) {
                continue;
            }
            List<String> fields = splitLine(line, delimiter);
            Map<String, String> raw = new LinkedHashMap<>();
            for (int h = 0; h < headers.size() && h < fields.size(); h++) {
                raw.put(headers.get(h), fields.get(h));
            }
            rows.add(new ParsedCsv.ParsedRow(i + 1, raw));
        }
        return new ParsedCsv(headers, rows);
    }

    /** Maps a row's raw (header -> value) fields to (canonicalField -> value), dropping unmapped/"(skip)" columns. */
    public Map<String, String> applyColumnMapping(ParsedCsv.ParsedRow row, Map<String, String> columnMappings) {
        Map<String, String> fields = new LinkedHashMap<>();
        for (var entry : row.raw().entrySet()) {
            String canonical = columnMappings.get(entry.getKey());
            if (canonical != null && !canonical.isBlank() && !"(skip)".equals(canonical)) {
                fields.put(canonical, entry.getValue().trim());
            }
        }
        return fields;
    }

    /** RFC4180-ish quoted-field splitter: {@code ""} inside quotes is a literal escaped quote. Trims every field. */
    private static List<String> splitLine(String line, char delimiter) {
        List<String> out = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        current.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            } else if (c == delimiter) {
                out.add(current.toString().trim());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        out.add(current.toString().trim());
        return out;
    }

    private static int countChar(String s, char c) {
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) {
                count++;
            }
        }
        return count;
    }

    /**
     * Coerces a raw CSV date string to an {@link Instant}, or {@code null} if it doesn't match
     * any accepted format. Accepted formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY,
     * DD-MM-YY, MM/YYYY, MM-YYYY, MM/YY, MM-YY (MM/YYYY-style resolves to the LAST day of that
     * month). context=DOB additionally rejects any date that resolves to the future (even a
     * fully-specified 4-digit year) and pivots a 2-digit year to the 1900s instead of the 2000s
     * if the 2000s candidate would be in the future.
     */
    public Instant normaliseDate(String raw, DateContext context) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String s = raw.trim();

        try {
            if (s.matches("\\d{4}-\\d{2}-\\d{2}")) {
                return finalize(LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC), context);
            }
            var full = java.util.regex.Pattern.compile("^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})$").matcher(s);
            if (full.matches()) {
                return finalizeDmy(Integer.parseInt(full.group(1)), Integer.parseInt(full.group(2)),
                        Integer.parseInt(full.group(3)), context);
            }
            var shortYear = java.util.regex.Pattern.compile("^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2})$").matcher(s);
            if (shortYear.matches()) {
                int yy = Integer.parseInt(shortYear.group(3));
                return finalizeDmy(Integer.parseInt(shortYear.group(1)), Integer.parseInt(shortYear.group(2)),
                        pivotYear(yy, context), context);
            }
            var monthYear = java.util.regex.Pattern.compile("^(\\d{1,2})[/-](\\d{4})$").matcher(s);
            if (monthYear.matches()) {
                return finalizeMonthEnd(Integer.parseInt(monthYear.group(1)), Integer.parseInt(monthYear.group(2)), context);
            }
            var monthShortYear = java.util.regex.Pattern.compile("^(\\d{1,2})[/-](\\d{2})$").matcher(s);
            if (monthShortYear.matches()) {
                int yy = Integer.parseInt(monthShortYear.group(2));
                return finalizeMonthEnd(Integer.parseInt(monthShortYear.group(1)), pivotYear(yy, context), context);
            }
        } catch (Exception ignored) {
            return null;
        }
        return null;
    }

    private static int pivotYear(int yy, DateContext context) {
        if (context == DateContext.DOB) {
            int candidate = 2000 + yy;
            return candidate > java.time.Year.now(ZoneOffset.UTC).getValue() ? 1900 + yy : candidate;
        }
        return 2000 + yy;
    }

    private static Instant finalizeDmy(int day, int month, int year, DateContext context) {
        try {
            LocalDate date = LocalDate.of(year, month, day);
            return finalize(date.atStartOfDay(ZoneOffset.UTC), context);
        } catch (Exception e) {
            return null; // overflow — e.g. month 13, day 32
        }
    }

    private static Instant finalizeMonthEnd(int month, int year, DateContext context) {
        try {
            LocalDate lastDay = LocalDate.of(year, month, 1).plusMonths(1).minusDays(1);
            return finalize(lastDay.atStartOfDay(ZoneOffset.UTC), context);
        } catch (Exception e) {
            return null;
        }
    }

    private static Instant finalize(ZonedDateTime zdt, DateContext context) {
        Instant instant = zdt.toInstant();
        if (context == DateContext.DOB && instant.isAfter(Instant.now())) {
            return null; // a birthdate can never be in the future
        }
        return instant;
    }
}
