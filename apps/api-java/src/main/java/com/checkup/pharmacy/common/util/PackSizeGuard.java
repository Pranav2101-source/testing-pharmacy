package com.checkup.pharmacy.common.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Keeps one medicine / SKU to one pack size.
 *
 * <p>Bottle size (the mL/g in one sealed pack) lives on the medicine as
 * {@code unitsPerPack}, not on the batch — so a shop that stocks a syrup in 50 ml,
 * 100 ml AND 200 ml must hold each as its own medicine, exactly as it already does
 * for a tablet's 10s vs 15s strip (see {@code docs/V2-PACK-VARIANTS.md} for the
 * proper multi-size model, deferred). Mixing sizes under one SKU silently mis-prices
 * every loose (per-mL) sale — a 200 ml bottle billed as 100 ml is a 2× overcharge.
 *
 * <p>These are cheap heuristics, used to <b>warn</b> at stock-in and to <b>reject</b>
 * a self-contradictory catalogue entry — never to block a legitimate receipt. All
 * pure, so they test without a database.
 */
public final class PackSizeGuard {

    private PackSizeGuard() {
    }

    /** A new batch's MRP this far below / above the medicine's existing stock reads as a different pack size. */
    private static final BigDecimal LOW = new BigDecimal("0.62");
    private static final BigDecimal HIGH = new BigDecimal("1.60");

    // "100ml", "100 ml", "1 x 100ml", "20 gm tube" — ml/g only, never mg/mcg (that is a strength).
    private static final Pattern MEASURED_SIZE = Pattern.compile(
            "(?:^|[x×*]\\s*)(\\d{1,6})\\s*(ml|millilitres?|milliliters?|g|gm|grams?)(?![a-z])",
            Pattern.CASE_INSENSITIVE);

    /** The mL/g named in a free-text pack size ("100 ml bottle" → 100), or null when it names no measured volume. */
    public static Integer parseMeasuredSize(String packSizeText) {
        if (packSizeText == null || packSizeText.isBlank()) {
            return null;
        }
        Matcher m = MEASURED_SIZE.matcher(packSizeText.trim());
        if (!m.find()) {
            return null;
        }
        int n = Integer.parseInt(m.group(1));
        return n >= 2 && n <= 100_000 ? n : null;
    }

    /**
     * A message when a catalogue entry contradicts itself — its pack-size text names one
     * volume but {@code unitsPerPack} says another — for a measured medicine. Null when
     * they agree, when either is absent, or when the medicine is not measured. Callers
     * treat a non-null result as a 400: a SKU that disagrees with itself is a data error,
     * not a workflow.
     */
    public static String contradictoryPackSize(String resolvedBaseUnit, String packSizeText, Integer unitsPerPack) {
        if (!PackUnits.isMeasured(resolvedBaseUnit) || unitsPerPack == null) {
            return null;
        }
        Integer fromText = parseMeasuredSize(packSizeText);
        if (fromText == null || fromText.equals(unitsPerPack)) {
            return null;
        }
        String u = "ML".equalsIgnoreCase(resolvedBaseUnit) ? "ml" : "g";
        return "Pack size says " + fromText + " " + u + " but units per pack is " + unitsPerPack
                + " — these must match. If this medicine comes in more than one size, add each size as its own "
                + "entry (its own MRP, barcode and stock).";
    }

    /**
     * A warning when {@code candidateMrp} looks like a different pack size from the
     * medicine's existing sellable stock — used at manual add-stock and GRN confirm, but
     * only for a measured medicine where it actually matters (loose selling on, or a
     * structured pack size on record). Null when there is nothing to compare against, or
     * the price is in line. Never blocks: a genuine price revision can trip this too, and
     * the pharmacist is the one who knows.
     *
     * @param existingSellableMrps MRPs of the medicine's current ACTIVE, in-date batches
     */
    public static String differentPackSizeWarning(String medicineName, String packWord,
                                                  BigDecimal candidateMrp, List<BigDecimal> existingSellableMrps) {
        if (candidateMrp == null || candidateMrp.signum() <= 0 || existingSellableMrps == null) {
            return null;
        }
        List<BigDecimal> priced = new ArrayList<>();
        for (BigDecimal m : existingSellableMrps) {
            if (m != null && m.signum() > 0) {
                priced.add(m);
            }
        }
        if (priced.isEmpty()) {
            return null;
        }
        BigDecimal median = median(priced);
        BigDecimal ratio = candidateMrp.divide(median, 4, RoundingMode.HALF_UP);
        if (ratio.compareTo(LOW) >= 0 && ratio.compareTo(HIGH) <= 0) {
            return null;
        }
        return "This batch's MRP (₹" + strip(candidateMrp) + ") is well outside \"" + medicineName
                + "\"'s current stock (around ₹" + strip(median) + "). If this is a different " + packWord
                + " size, receive it as its own medicine — mixing sizes here mis-prices every loose sale.";
    }

    private static BigDecimal median(List<BigDecimal> values) {
        List<BigDecimal> sorted = new ArrayList<>(values);
        sorted.sort(BigDecimal::compareTo);
        int n = sorted.size();
        if (n % 2 == 1) {
            return sorted.get(n / 2);
        }
        return sorted.get(n / 2 - 1).add(sorted.get(n / 2)).divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
    }

    private static String strip(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }
}
