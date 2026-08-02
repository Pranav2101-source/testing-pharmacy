package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The parts of a pharmacy's stored invoice-settings JSON that the SERVER has to
 * honour, as opposed to the much larger set that only affects how the printed
 * page looks.
 *
 * <p>Everything else in {@code InvoiceSettingsConfig} — logos, colours, which
 * columns to show — is applied client-side when rendering the invoice, so the
 * backend never needs to read it. These two do not work that way:
 *
 * <ul>
 *   <li><b>numbering</b> decides the invoice number, which is written to the
 *       {@code invoices} row and is the document's legal identifier. A client
 *       cannot apply it after the fact.</li>
 *   <li><b>policy.returnWindowDays</b> decides whether a sales return is accepted
 *       at all, which is an authorisation decision and therefore must be made
 *       server-side.</li>
 * </ul>
 *
 * <p>Both were previously hardcoded here while the settings screen presented them
 * as configurable — the numbering section even rendered a live preview of a format
 * that no invoice would ever actually carry. This class is what makes the stored
 * settings real.
 *
 * <p>PARSING IS DELIBERATELY FORGIVING. The column is free-form JSON written by the
 * frontend; a malformed or partial document must degrade to the previous built-in
 * behaviour rather than block a sale. A till that cannot bill because a settings
 * blob is unreadable is a far worse failure than one that bills with the default
 * number format.
 */
record PharmacyInvoiceSettings(
        String prefix,
        boolean autoFinancialYear,
        String financialYear,
        String separator,
        int counterLength,
        Integer returnWindowDays,
        boolean hasCustomNumbering
) {

    /** Matches {@link DocumentNumberFormat#invoice(int)} — the format used before settings existed. */
    static final int DEFAULT_RETURN_WINDOW_DAYS = 30;

    private static final int MIN_COUNTER_LENGTH = 4;
    private static final int MAX_COUNTER_LENGTH = 8;

    /** The built-in behaviour: legacy number format, 30-day return window. */
    static PharmacyInvoiceSettings defaults() {
        return new PharmacyInvoiceSettings(null, true, null, null, 0, DEFAULT_RETURN_WINDOW_DAYS, false);
    }

    static PharmacyInvoiceSettings parse(String rawJson, ObjectMapper objectMapper) {
        if (rawJson == null || rawJson.isBlank()) {
            return defaults();
        }
        try {
            JsonNode root = objectMapper.readTree(rawJson);
            if (root == null || !root.isObject()) {
                return defaults();
            }

            JsonNode numbering = root.path("numbering");
            String prefix = text(numbering, "prefix");
            String separator = text(numbering, "separator");
            // Auto is the default and the normal case: the year is computed from the
            // current IST date and rolls over on 1 April by itself. Only an explicit
            // `false` switches to the manual override, so a config written before this
            // flag existed keeps auto behaviour rather than pinning to a stale year.
            boolean autoFinancialYear = !numbering.path("autoFinancialYear").isBoolean()
                    || numbering.get("autoFinancialYear").asBoolean();
            // Consulted only when the override is on. An empty string there means
            // "leave the year out of the number" — a distinct, deliberate choice.
            String financialYear = numbering.hasNonNull("financialYear")
                    ? numbering.get("financialYear").asText().trim()
                    : null;
            int counterLength = clampCounterLength(numbering.path("counterLength").asInt(0));

            // Custom numbering only kicks in when the pharmacy actually supplied a
            // prefix. Without one there is nothing meaningful to build a number from,
            // and silently renumbering every existing pharmacy's invoices because a
            // settings blob happened to contain an empty `numbering: {}` would be a
            // change nobody asked for.
            boolean hasCustomNumbering = prefix != null && !prefix.isBlank();

            Integer returnWindowDays = null;
            JsonNode policy = root.path("policy");
            if (policy.hasNonNull("returnWindowDays")) {
                int days = policy.get("returnWindowDays").asInt(DEFAULT_RETURN_WINDOW_DAYS);
                returnWindowDays = Math.max(0, days);
            }

            return new PharmacyInvoiceSettings(
                    prefix, autoFinancialYear, financialYear, separator, counterLength,
                    returnWindowDays == null ? DEFAULT_RETURN_WINDOW_DAYS : returnWindowDays,
                    hasCustomNumbering);
        } catch (Exception e) {
            return defaults();
        }
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? node.get(field).asText().trim() : null;
    }

    private static int clampCounterLength(int value) {
        if (value <= 0) {
            return 0;
        }
        return Math.min(MAX_COUNTER_LENGTH, Math.max(MIN_COUNTER_LENGTH, value));
    }

    /**
     * Builds the invoice number for a sequence value.
     *
     * <p>Mirrors the preview the settings screen shows, so what the pharmacy sees
     * while configuring is what lands on the bill. Falls back to
     * {@link DocumentNumberFormat#invoice(int)} whenever no prefix is configured.
     *
     * <p>The sequence itself still comes from {@code DocumentSequenceService} and is
     * untouched by this — so numbers stay unique and monotonic per pharmacy even if
     * the format is edited midway through a year.
     */
    String formatInvoiceNumber(int sequence) {
        if (!hasCustomNumbering) {
            return DocumentNumberFormat.invoice(sequence);
        }
        String sep = (separator == null || separator.isBlank()) ? "/" : separator;
        int width = counterLength > 0 ? counterLength : 6;
        String padded = String.format("%0" + width + "d", sequence);

        // Auto (the default) recomputes the year on every bill, so numbering rolls
        // over on 1 April without anyone touching a setting. The manual override
        // exists for migration, backdated invoices and testing — cases where the
        // number must carry a year other than today's. An override of "" omits the
        // year segment entirely.
        String year;
        if (autoFinancialYear || financialYear == null) {
            year = com.checkup.pharmacy.common.sequence.DocumentSequenceService.fyShort();
        } else {
            year = financialYear;
        }

        return year.isEmpty()
                ? prefix + sep + padded
                : prefix + sep + year + sep + padded;
    }

    /** {@code 0} means the pharmacy switched the time limit off entirely. */
    boolean isReturnWindowUnlimited() {
        return returnWindowDays != null && returnWindowDays == 0;
    }

    int returnWindowDaysOrDefault() {
        return returnWindowDays == null ? DEFAULT_RETURN_WINDOW_DAYS : returnWindowDays;
    }
}
