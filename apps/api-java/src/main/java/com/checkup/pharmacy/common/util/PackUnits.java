package com.checkup.pharmacy.common.util;

import java.util.Locale;
import java.util.Map;

/**
 * How a medicine's quantity is labelled at the point of sale — the whole sealed
 * unit ("strip", "bottle", "tube") and the loose base unit ("tablet", "mL", "g").
 *
 * <p>Dispensing was built tablet-first: a quantity was strips or loose tablets,
 * and every pharmacist-facing message said "pack" / "strip". A syrup, a tonic, an
 * ointment or eye-drops do not fit that — the sale unit is a whole sealed bottle
 * or tube and "pack" is the wrong word. This resolves the packaging vocabulary so
 * {@code DispensingService} and {@code BillingService} can phrase a rounded-up or
 * refused liquid line correctly ("rounded up to 2 bottles") without either of them
 * special-casing dosage forms.
 *
 * <p>Mirrors {@code sale-unit.ts} in {@code @pharmacy/utils} — the two must agree,
 * because the same sale is labelled by the backend engine and by the web cart.
 * {@link BaseUnits#resolve} stays the single source for the base unit itself; this
 * only adds the packaging nouns on top.
 */
public final class PackUnits {

    private PackUnits() {
    }

    /** Known packaging words ({@code Medicine.unit}) → the singular noun shown for one whole sale unit. */
    private static final Map<String, String> PACK_WORD = Map.ofEntries(
            Map.entry("strip", "strip"),
            Map.entry("bottle", "bottle"),
            Map.entry("tube", "tube"),
            Map.entry("sachet", "sachet"),
            Map.entry("box", "box"),
            Map.entry("vial", "vial"),
            Map.entry("ampoule", "ampoule"),
            Map.entry("drops", "bottle"),
            Map.entry("spray", "unit"),
            Map.entry("piece", "unit"),
            Map.entry("jar", "jar"),
            Map.entry("packet", "packet"));

    /**
     * The singular noun for one whole sealed sale unit — {@code Medicine.unit} when
     * it is a packaging word we know, otherwise inferred from the base unit
     * (TABLET/CAPSULE → strip, ML → bottle, GM → tube, else "unit").
     */
    public static String packUnitLabel(String unit, String baseUnit) {
        String known = unit == null ? null : unit.trim().toLowerCase(Locale.ROOT);
        if (known != null && PACK_WORD.containsKey(known)) {
            return PACK_WORD.get(known);
        }
        // A free-text packaging value we don't recognise is still better than a
        // guess — as long as it is a word, not a size string like "100ml".
        if (known != null && known.matches("[a-z][a-z .\\-/]{1,18}")) {
            return known.replaceAll("s$", "");
        }
        String bu = BaseUnits.resolve(baseUnit, null);
        if (bu == null) {
            return "unit";
        }
        return switch (bu) {
            case "TABLET", "CAPSULE" -> "strip";
            case "ML" -> "bottle";
            case "GM" -> "tube";
            default -> "unit";
        };
    }

    /**
     * The plural loose-unit word for a pharmacist-facing sentence — "tablets",
     * "capsules", "ml", "g", "units". (Ported from {@code DispensingService.unitLabel}.)
     */
    public static String looseUnitLabel(String baseUnit) {
        if (baseUnit == null) {
            return "units";
        }
        return switch (baseUnit.trim().toUpperCase(Locale.ROOT)) {
            case "TABLET" -> "tablets";
            case "CAPSULE" -> "capsules";
            case "ML" -> "ml";
            case "GM" -> "g";
            default -> "units";
        };
    }

    /** "1 bottle" / "2 bottles" — pluralises a pack-unit noun for a count. Measured units ("ml", "g") never pluralise. */
    public static String plural(String label, long count) {
        if (count == 1 || "ml".equals(label) || "g".equals(label)) {
            return label;
        }
        return label + "s";
    }

    /**
     * True when the base unit is a measured volume/weight (ML, GM) rather than a
     * countable piece — such a line is never given a tablet-style "cut the strip"
     * prompt; a part-pack prescription simply rounds up to whole sealed packs.
     */
    public static boolean isMeasured(String baseUnit) {
        String bu = baseUnit == null ? null : baseUnit.trim().toUpperCase(Locale.ROOT);
        return "ML".equals(bu) || "GM".equals(bu);
    }
}
