package com.checkup.pharmacy.common.util;

import java.util.Locale;

/**
 * The base unit a medicine is dispensed in when sold loose — TABLET, CAPSULE, ML,
 * GM or EACH. Stored on the catalogue where a platform admin has set it; derived
 * from the free-text {@code form} otherwise, so the POS and the receipt never fall
 * back to a bare "loose".
 */
public final class BaseUnits {

    private BaseUnits() {
    }

    /** The stored base unit, or one inferred from {@code form}. Null only when both are absent. */
    public static String resolve(String baseUnit, String form) {
        if (baseUnit != null && !baseUnit.isBlank()) {
            return baseUnit.trim().toUpperCase(Locale.ROOT);
        }
        if (form == null || form.isBlank()) {
            return null;
        }
        String f = form.toLowerCase(Locale.ROOT);
        if (f.contains("tab")) return "TABLET";
        if (f.contains("cap")) return "CAPSULE";
        if (f.contains("syrup") || f.contains("solution") || f.contains("suspension")
                || f.contains("drop") || f.contains("liquid") || f.contains("elixir") || f.contains("oral")) return "ML";
        if (f.contains("cream") || f.contains("ointment") || f.contains("gel")
                || f.contains("powder") || f.contains("paste")) return "GM";
        return "EACH";
    }
}
