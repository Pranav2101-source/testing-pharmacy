package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The bridge between what a pharmacy configures on the Invoice Settings screen and
 * what actually lands on a bill.
 *
 * <p>Two rules run through all of it: the number a pharmacy sees in the settings
 * preview must be the number their invoices carry, and a settings blob that is
 * missing, partial or corrupt must never stop a sale — it falls back to the
 * built-in format instead.
 */
class PharmacyInvoiceSettingsTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private PharmacyInvoiceSettings parse(String json) {
        return PharmacyInvoiceSettings.parse(json, objectMapper);
    }

    @Nested
    @DisplayName("falling back to the built-in format")
    class Fallback {

        @Test
        @DisplayName("no settings at all → the legacy INV/{fy}/{6-digit} format")
        void nullSettingsUseLegacyFormat() {
            String number = parse(null).formatInvoiceNumber(42);
            assertThat(number).isEqualTo("INV/" + DocumentSequenceService.fyShort() + "/000042");
        }

        @Test
        @DisplayName("blank settings behave the same")
        void blankSettingsUseLegacyFormat() {
            assertThat(parse("").formatInvoiceNumber(1)).startsWith("INV/");
            assertThat(parse("   ").formatInvoiceNumber(1)).startsWith("INV/");
        }

        @Test
        @DisplayName("corrupt JSON degrades instead of breaking billing")
        void corruptJsonFallsBack() {
            // A till that cannot issue a bill because a settings blob is unreadable is
            // a far worse failure than one that bills with the default format.
            assertThat(parse("{not valid json").formatInvoiceNumber(7)).startsWith("INV/");
        }

        @Test
        @DisplayName("valid JSON of the wrong shape degrades too")
        void wrongShapeFallsBack() {
            assertThat(parse("[1,2,3]").formatInvoiceNumber(7)).startsWith("INV/");
            assertThat(parse("\"a string\"").formatInvoiceNumber(7)).startsWith("INV/");
            assertThat(parse("null").formatInvoiceNumber(7)).startsWith("INV/");
        }

        @Test
        @DisplayName("settings with no numbering section keep the legacy format")
        void missingNumberingSectionFallsBack() {
            assertThat(parse("{\"theme\":\"classic\"}").formatInvoiceNumber(5)).startsWith("INV/");
        }

        @Test
        @DisplayName("an empty prefix is not a custom format — it would produce a number with no identity")
        void emptyPrefixFallsBack() {
            assertThat(parse("{\"numbering\":{\"prefix\":\"\",\"separator\":\"-\"}}")
                    .formatInvoiceNumber(5)).startsWith("INV/");
            assertThat(parse("{\"numbering\":{\"prefix\":\"   \"}}")
                    .formatInvoiceNumber(5)).startsWith("INV/");
        }
    }

    @Nested
    @DisplayName("honouring a configured format")
    class CustomFormat {

        @Test
        @DisplayName("reproduces exactly what the settings preview shows")
        void matchesSettingsPreview() {
            // The settings screen renders `${prefix}${sep}${fy}${sep}${padded}`.
            // This is the assertion that the preview stops being a lie.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,"
                    + "\"financialYear\":\"2025-26\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1)).isEqualTo("BILL-2025-26-0001");
        }

        @Test
        @DisplayName("applies the configured prefix")
        void appliesPrefix() {
            String json = "{\"numbering\":{\"prefix\":\"RX\",\"autoFinancialYear\":false,"
                    + "\"financialYear\":\"2025-26\",\"separator\":\"/\",\"counterLength\":6}}";
            assertThat(parse(json).formatInvoiceNumber(9)).isEqualTo("RX/2025-26/000009");
        }

        @Test
        @DisplayName("applies the configured counter length")
        void appliesCounterLength() {
            String base = "{\"numbering\":{\"prefix\":\"B\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":%d}}";
            assertThat(parse(String.format(base, 4)).formatInvoiceNumber(7)).isEqualTo("B-0007");
            assertThat(parse(String.format(base, 8)).formatInvoiceNumber(7)).isEqualTo("B-00000007");
        }

        @Test
        @DisplayName("an explicitly empty financial year omits the year segment")
        void emptyFinancialYearIsSkipped() {
            // The settings screen labels this field "Financial Year (empty = skip)",
            // so an empty string is a real choice, not a missing value.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\","
                    + "\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(12)).isEqualTo("BILL-0012");
        }

        @Test
        @DisplayName("an ABSENT financial year falls back to the server's current one")
        void absentFinancialYearUsesServerValue() {
            // Distinct from the empty-string case above: nothing was chosen, so the
            // server's own year is used rather than silently dropping it.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"separator\":\"/\",\"counterLength\":5}}";
            assertThat(parse(json).formatInvoiceNumber(3))
                    .isEqualTo("BILL/" + DocumentSequenceService.fyShort() + "/00003");
        }

        @Test
        @DisplayName("auto is the DEFAULT — the year is computed, not read from the config")
        void autoIsTheDefault() {
            // Explicitly auto, but with a stale literal year also present. Auto wins,
            // so numbering rolls over on 1 April without anyone editing a setting.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":true,"
                    + "\"financialYear\":\"2019-20\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1))
                    .isEqualTo("BILL-" + DocumentSequenceService.fyShort() + "-0001");
        }

        @Test
        @DisplayName("a config written before the flag existed keeps AUTO behaviour")
        void legacyConfigDefaultsToAuto() {
            // Backward compatibility: `autoFinancialYear` absent must not pin a stored
            // literal year forever, which would leave old configs stamping a stale FY
            // on every bill after the next 1 April.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"financialYear\":\"2019-20\","
                    + "\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1))
                    .isEqualTo("BILL-" + DocumentSequenceService.fyShort() + "-0001");
        }

        @Test
        @DisplayName("the manual override pins a literal year — for migration and backdating")
        void manualOverridePinsTheYear() {
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,"
                    + "\"financialYear\":\"2019-20\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1)).isEqualTo("BILL-2019-20-0001");
        }

        @Test
        @DisplayName("the override falls back to auto when it is switched on with no year set")
        void overrideWithoutYearFallsBackToAuto() {
            // Guards a half-configured state: toggle off, field never filled. Emitting
            // a number with a dangling separator would be worse than using the real year.
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,"
                    + "\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1))
                    .isEqualTo("BILL-" + DocumentSequenceService.fyShort() + "-0001");
        }

        @Test
        @DisplayName("a non-boolean autoFinancialYear is treated as auto, not as an override")
        void nonBooleanFlagDefaultsToAuto() {
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":\"yes\","
                    + "\"financialYear\":\"2019-20\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1))
                    .isEqualTo("BILL-" + DocumentSequenceService.fyShort() + "-0001");
        }

        @Test
        @DisplayName("defaults the separator to '/' when it is missing or blank")
        void separatorDefaults() {
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1)).isEqualTo("BILL/0001");
        }

        @Test
        @DisplayName("clamps counter length into the 4–8 range the UI enforces")
        void clampsCounterLength() {
            String base = "{\"numbering\":{\"prefix\":\"B\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":%d}}";
            // Below the floor → 4 digits.
            assertThat(parse(String.format(base, 1)).formatInvoiceNumber(7)).isEqualTo("B-0007");
            // Above the ceiling → 8 digits, not a 99-character number.
            assertThat(parse(String.format(base, 99)).formatInvoiceNumber(7)).isEqualTo("B-00000007");
        }

        @Test
        @DisplayName("a sequence wider than the counter length is not truncated")
        void sequenceIsNeverTruncated() {
            // Padding is a minimum width, never a cap. Truncating would collide two
            // different invoices onto one number, which the unique index would then
            // reject mid-sale.
            String json = "{\"numbering\":{\"prefix\":\"B\",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(123456)).isEqualTo("B-123456");
        }

        @Test
        @DisplayName("distinct sequences always produce distinct numbers")
        void numbersStayUnique() {
            String json = "{\"numbering\":{\"prefix\":\"BILL\",\"financialYear\":\"2025-26\","
                    + "\"separator\":\"-\",\"counterLength\":4}}";
            var settings = parse(json);
            assertThat(settings.formatInvoiceNumber(1)).isNotEqualTo(settings.formatInvoiceNumber(2));
        }

        @Test
        @DisplayName("trims stray whitespace around the prefix")
        void trimsPrefix() {
            String json = "{\"numbering\":{\"prefix\":\"  BILL  \",\"autoFinancialYear\":false,\"financialYear\":\"\",\"separator\":\"-\",\"counterLength\":4}}";
            assertThat(parse(json).formatInvoiceNumber(1)).isEqualTo("BILL-0001");
        }
    }

    @Nested
    @DisplayName("return window")
    class ReturnWindow {

        @Test
        @DisplayName("defaults to 30 days when nothing is configured")
        void defaultsTo30() {
            assertThat(parse(null).returnWindowDaysOrDefault()).isEqualTo(30);
            assertThat(parse("{}").returnWindowDaysOrDefault()).isEqualTo(30);
            assertThat(parse(null).isReturnWindowUnlimited()).isFalse();
        }

        @Test
        @DisplayName("honours a shorter configured window")
        void honoursShorterWindow() {
            var settings = parse("{\"policy\":{\"returnWindowDays\":15}}");
            assertThat(settings.returnWindowDaysOrDefault()).isEqualTo(15);
            assertThat(settings.isReturnWindowUnlimited()).isFalse();
        }

        @Test
        @DisplayName("honours a longer configured window")
        void honoursLongerWindow() {
            assertThat(parse("{\"policy\":{\"returnWindowDays\":90}}").returnWindowDaysOrDefault()).isEqualTo(90);
        }

        @Test
        @DisplayName("zero means the time limit is switched off, not 'reject everything'")
        void zeroDisablesTheLimit() {
            // The settings screen says "Set to 0 to disable the return time limit."
            // Reading 0 as a zero-day window would invert that into refusing every
            // return the day after purchase.
            var settings = parse("{\"policy\":{\"returnWindowDays\":0}}");
            assertThat(settings.isReturnWindowUnlimited()).isTrue();
        }

        @Test
        @DisplayName("a negative value is floored at zero rather than trusted")
        void negativeIsFloored() {
            assertThat(parse("{\"policy\":{\"returnWindowDays\":-5}}").isReturnWindowUnlimited()).isTrue();
        }

        @Test
        @DisplayName("a corrupt settings blob still yields the 30-day default")
        void corruptStillDefaults() {
            assertThat(parse("{not json").returnWindowDaysOrDefault()).isEqualTo(30);
        }
    }
}
