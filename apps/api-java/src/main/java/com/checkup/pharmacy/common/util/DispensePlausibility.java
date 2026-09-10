package com.checkup.pharmacy.common.util;

import java.util.Locale;

/**
 * Sanity ceilings on how many sealed packs one course of a MEASURED (mL/g) medicine may
 * resolve to.
 *
 * <p>The mL&rarr;pack conversion is a division, and a division is only ever as trustworthy as
 * its divisor. When a catalogue's {@code unitsPerPack} is wrong the arithmetic downstream stays
 * perfectly correct and the answer is still absurd: a 40&nbsp;ml course of a topical solution
 * against a 5&nbsp;ml pack size resolves to <b>eight bottles</b>, and every screen agrees,
 * because every screen is dividing by the same wrong number. Nothing in the chain held a second
 * fact that could contradict the first.
 *
 * <p>This is that second fact, and it is deliberately the cheapest possible one: no database, no
 * history, no statistics &mdash; just what a pharmacist knows without looking anything up. A
 * course of a cream or a scalp lotion is one tube or bottle, occasionally two. A syrup runs to
 * three or four. Past that, the pack size is far more likely to be wrong than the prescription.
 *
 * <p>Pure and dependency-free, in the same spirit as {@link PackSizeGuard} and {@code
 * PrescriptionQuantityCalculator}: it takes the medicine's own fields and returns a
 * pharmacist-readable sentence or null, so it tests without a database and can be called from
 * both the ingest path and the read path without either needing a service.
 *
 * <h2>What this is not</h2>
 * A ceiling breach is <b>never</b> grounds to reject a write or fail a prescription. It is a
 * heuristic over physical plausibility, and a genuine 5&nbsp;ml ampoule dispensed eight times
 * for a real course has to stay billable. Callers escalate it to "hold this line for a human"
 * and no further &mdash; see {@code PrescriptionItem.resolveMeasuredEmrQuantity}, which drops
 * the line to {@code needsQuantityConfirmation()} so {@code ConfirmQuantityPanel} asks for a
 * pack count, exactly as it already does for a line with no pack size at all.
 */
public final class DispensePlausibility {

    private DispensePlausibility() {
    }

    /**
     * How a measured medicine is administered, which is what sets its plausible course size.
     * Resolved from the catalogue's free-text {@code form}, falling back to the base unit.
     */
    public enum MeasuredForm {
        /** Applied to the body — lotion, cream, ointment, gel, scalp solution, drops, spray. */
        TOPICAL,
        /** Swallowed — syrup, suspension, elixir, tonic, oral solution. */
        ORAL_LIQUID,
        /** Measured, but we cannot tell which. No ceiling is applied. */
        UNKNOWN
    }

    /**
     * A course of a topical is one pack, sometimes two (a second tube for a long or
     * large-area course). Three is already unusual enough to be worth a glance.
     */
    private static final int TOPICAL_CEILING = 2;

    /**
     * An oral liquid legitimately runs longer &mdash; a paediatric antibiotic syrup over ten
     * days is routinely three or four bottles. Set above the real ceiling on purpose: this
     * exists to catch order-of-magnitude errors, not to second-guess dosing.
     */
    private static final int ORAL_LIQUID_CEILING = 4;

    /**
     * Words that settle the route. ORAL is tested FIRST and wins outright, because "oral
     * solution" and "oral drops" both contain a topical word too &mdash; and reading a syrup as
     * a topical would apply the tighter ceiling and hold a perfectly ordinary course.
     */
    private static final String[] ORAL_WORDS = {
            "oral", "syrup", "suspension", "elixir", "tonic", "linctus", "sachet",
    };

    private static final String[] TOPICAL_WORDS = {
            "lotion", "cream", "ointment", "gel", "solution", "drop", "spray", "paste",
            "liniment", "shampoo", "serum", "balm", "scalp", "topical", "external",
    };

    /**
     * The administration route for a measured medicine.
     *
     * <p>{@code form} is free text a platform admin typed, so this reads it the same
     * forgiving way {@link BaseUnits#resolve} does. With no usable form, GM falls to
     * {@link MeasuredForm#TOPICAL} &mdash; creams, ointments and powders are what GM
     * describes and none of them are drunk &mdash; while a bare ML stays
     * {@link MeasuredForm#UNKNOWN}, because ML covers both a scalp solution and a
     * cough syrup and guessing wrong in that direction holds a legitimate line.
     */
    public static MeasuredForm classify(String form, String baseUnit) {
        String f = form == null ? "" : form.toLowerCase(Locale.ROOT);
        if (!f.isBlank()) {
            for (String w : ORAL_WORDS) {
                if (f.contains(w)) {
                    return MeasuredForm.ORAL_LIQUID;
                }
            }
            for (String w : TOPICAL_WORDS) {
                if (f.contains(w)) {
                    return MeasuredForm.TOPICAL;
                }
            }
        }
        String bu = BaseUnits.resolve(baseUnit, form);
        return "GM".equals(bu) ? MeasuredForm.TOPICAL : MeasuredForm.UNKNOWN;
    }

    /** The most sealed packs one course of this form may resolve to before a human should look. 0 = no ceiling. */
    public static int packCeiling(MeasuredForm form) {
        return switch (form) {
            case TOPICAL -> TOPICAL_CEILING;
            case ORAL_LIQUID -> ORAL_LIQUID_CEILING;
            case UNKNOWN -> 0;
        };
    }

    /**
     * A pharmacist-readable sentence when {@code packCount} sealed packs is an implausible
     * amount of this medicine for one course &mdash; null when it is fine, when the form
     * carries no ceiling, or when there is not enough on record to judge.
     *
     * <p>The sentence names the arithmetic that produced the number, because the pack size is
     * the thing most likely to be wrong and a pharmacist can only see that if we show it: the
     * divisor is right there in the message next to the answer it produced.
     *
     * @param medicineName   for the message
     * @param form           catalogue {@code Medicine.form} (free text), may be null
     * @param baseUnit       resolved base unit &mdash; only ML/GM lines are judged here
     * @param unit           catalogue {@code Medicine.unit} packaging word, may be null
     * @param packCount      sealed packs the conversion produced
     * @param clinicalVolume the mL/g the clinic actually prescribed
     * @param packSize       the mL/g per sealed pack the conversion divided by
     */
    public static String implausiblePackCount(String medicineName, String form, String baseUnit,
                                              String unit, int packCount, int clinicalVolume, int packSize) {
        if (!PackUnits.isMeasured(baseUnit) || packCount <= 0 || packSize <= 0) {
            return null;
        }
        int ceiling = packCeiling(classify(form, baseUnit));
        if (ceiling <= 0 || packCount <= ceiling) {
            return null;
        }
        String shortUnit = "GM".equalsIgnoreCase(baseUnit.trim()) ? "g" : "ml";
        String packWord = PackUnits.packUnitLabel(unit, baseUnit);
        return medicineName + ": " + clinicalVolume + " " + shortUnit + " would need "
                + packCount + " sealed " + PackUnits.plural(packWord, packCount)
                + " at the " + packSize + " " + shortUnit + " pack size on record. More than "
                + ceiling + " " + PackUnits.plural(packWord, ceiling) + " for one course is usually a "
                + "pack-size error in the catalogue, not a real prescription — check the "
                + packWord + " and enter how many to dispense.";
    }
}
