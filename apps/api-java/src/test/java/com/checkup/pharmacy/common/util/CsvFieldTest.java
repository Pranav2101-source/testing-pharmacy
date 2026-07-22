package com.checkup.pharmacy.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Three CSV exports (audit log, tenant list, analytics) each had their own
 * hand-rolled quote-escaper that stopped a comma or quote from corrupting the
 * file but did nothing about a value that IS a formula — CWE-1236. Pharmacy
 * name is the clearest attacker-reachable field: public signup only requires
 * {@code @NotBlank @Size(min = 2)}, so {@code =HYPERLINK(...)} passes
 * validation untouched and would previously have reached the CSV exactly as
 * given.
 */
class CsvFieldTest {

    @Test
    @DisplayName("an ordinary value is quoted, unchanged")
    void ordinaryValueIsQuoted() {
        assertThat(CsvField.escape("Acme Pharmacy")).isEqualTo("\"Acme Pharmacy\"");
    }

    @Test
    @DisplayName("null becomes an empty quoted field")
    void nullBecomesEmptyField() {
        assertThat(CsvField.escape(null)).isEqualTo("\"\"");
    }

    @Test
    @DisplayName("an internal quote is doubled, per CSV convention")
    void internalQuoteIsDoubled() {
        assertThat(CsvField.escape("Say \"hi\"")).isEqualTo("\"Say \"\"hi\"\"\"");
    }

    @ParameterizedTest(name = "a value starting with '{0}' is neutralized with a leading apostrophe")
    @ValueSource(strings = {"=", "+", "-", "@"})
    @DisplayName("formula-triggering leading characters are neutralized")
    void formulaTriggeringPrefixIsNeutralized(String prefix) {
        String malicious = prefix + "HYPERLINK(\"http://evil.example\",\"click\")";

        String escaped = CsvField.escape(malicious);

        assertThat(escaped)
                .as("a spreadsheet must read this cell as text, not evaluate it as a formula")
                .startsWith("\"'" + prefix);
    }

    @Test
    @DisplayName("a legitimate value that happens to start with a hyphen is still readable, just as text")
    void hyphenPrefixedValueStaysReadableAsText() {
        // A pharmacy could plausibly be named "-Star Medicals" or similar; the fix
        // must not corrupt legitimate data, only stop it being auto-evaluated.
        String escaped = CsvField.escape("-Star Medicals");

        assertThat(escaped).isEqualTo("\"'-Star Medicals\"");
    }

    @Test
    @DisplayName("a tab or carriage return prefix is also neutralized")
    void controlCharacterPrefixIsNeutralized() {
        assertThat(CsvField.escape("\t=1+1")).startsWith("\"'\t");
        assertThat(CsvField.escape("\r=1+1")).startsWith("\"'\r");
    }

    @Test
    @DisplayName("an empty string is quoted without throwing")
    void emptyStringIsHandled() {
        assertThat(CsvField.escape("")).isEqualTo("\"\"");
    }
}
