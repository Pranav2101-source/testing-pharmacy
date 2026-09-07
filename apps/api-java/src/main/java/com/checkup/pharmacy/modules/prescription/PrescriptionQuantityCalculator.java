package com.checkup.pharmacy.modules.prescription;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Works out how many units a course actually needs, from the dosing pattern and duration a
 * clinic sent — for the lines where a clinic sent no quantity at all.
 *
 * <p>Pure and dependency-free, in the same spirit as {@link
 * com.checkup.pharmacy.modules.medicine.MedicineMatcher}: callers resolve the medicine and pass
 * in its base unit, so this can be reasoned about and tested without a database.
 *
 * <h2>What it will answer for</h2>
 * A structured dosing pattern ({@code 1-0-1}) times a duration in days ({@code 6 days}), for a
 * medicine dispensed in units a person can count — TABLET, CAPSULE, EACH. {@code 1-0-1 × 6 days}
 * is 12 tablets, and that is the whole calculation.
 *
 * <h2>What it deliberately refuses to answer for</h2>
 * Everything else, because the cost of a confident wrong number here is a patient handed the
 * wrong amount of a drug. Every refusal comes back as a {@link Result#reason()} rather than a
 * bare empty — see {@link Reason} for the full list and why each one is not calculated:
 * <ul>
 *   <li><b>ML/GM medicines.</b> "10ml twice daily for 5 days" is 100ml, but a bottle is not a
 *       unit of 1ml and nothing in the catalogue records how many ml are in the bottle on the
 *       shelf. There is no honest way to turn that into a sellable quantity here.</li>
 *   <li><b>Fractional doses</b> ({@code 1/2-0-1/2}, {@code ½}). A half-tablet course needs a
 *       decision about rounding that belongs to a human.</li>
 *   <li><b>Non-daily schedules</b> — "alternate days", "SOS", "PRN", "weekly", "stat". The
 *       pattern still parses, but multiplying it by a day count would silently overstate the
 *       course, so a qualifier like this disqualifies the whole line.</li>
 *   <li><b>Anything ambiguous</b>: two dosing patterns in one string, a duration with a range
 *       ("3 to 5 days"), a duration in months (28, 30 or 31 days is a real difference over a
 *       long course).</li>
 * </ul>
 */
public final class PrescriptionQuantityCalculator {

    private PrescriptionQuantityCalculator() {
    }

    /**
     * Why {@link #calculate} did not produce a quantity — always paired with a short,
     * pharmacist-readable {@link Result#reason()} rather than shown as this name. Exists so a
     * caller (or a future one) can group/log/test on the category without parsing the sentence.
     */
    public enum Reason {
        /** No medicine was resolved for this line, so there is no base unit to check. */
        MEDICINE_UNKNOWN,
        /** The medicine's base unit is not one a dosing pattern counts in (ML, GM, or unset). */
        NOT_COUNTABLE_UNIT,
        /** The dosage field was empty. */
        DOSAGE_MISSING,
        /** The duration field was empty. */
        DURATION_MISSING,
        /** "SOS", "PRN", "alternate days", "weekly", etc. — not a daily schedule. */
        NON_DAILY_SCHEDULE,
        /** No recognizable {@code 1-0-1}-style pattern in the dosage text. */
        DOSAGE_PATTERN_UNRECOGNIZED,
        /** More than one dosing pattern in the text (a taper), or every slot was zero. */
        DOSAGE_PATTERN_AMBIGUOUS,
        /** No usable number of days in the duration text. */
        DURATION_UNRECOGNIZED,
        /** More than one number in the duration text (a range, or a compound duration). */
        DURATION_AMBIGUOUS,
        /** The resulting course is outside a plausible range — a likely data or unit error. */
        RESULT_IMPLAUSIBLE,
    }

    /**
     * The outcome of one calculation attempt: either a quantity, or a reason it was refused —
     * never both, and always one of the two.
     *
     * @param quantity the units this course needs; meaningless when {@link #reason()} is non-null
     * @param reason   null on success; otherwise a stable category plus a message naming exactly
     *                 what about THIS line's text stopped the calculation, meant to be shown to
     *                 the pharmacist as-is
     */
    public record Result(int quantity, Reason reason, String message) {

        public boolean isCalculated() {
            return reason == null;
        }

        static Result of(int quantity) {
            return new Result(quantity, null, null);
        }

        static Result refused(Reason reason, String message) {
            return new Result(0, reason, message);
        }
    }

    /**
     * Units a person counts out one at a time. A prescription's dosing pattern is a count of
     * these per slot, which is exactly why the calculation only holds for them.
     */
    private static final Set<String> COUNTABLE_BASE_UNITS = Set.of("TABLET", "CAPSULE", "EACH");

    /**
     * A dosing pattern: two or more slots of digits joined by dashes — {@code 1-0-1},
     * {@code 1-1-1}, {@code 2-0-2}, {@code 1-1-1-1}.
     *
     * <p>The boundaries exclude letters, dots, slashes and commas on either side, which is what
     * keeps this from finding a pattern inside something that is not one. In {@code 10ml-0-10ml}
     * the inner {@code 0-10} is rejected because a letter follows it; in {@code 1/2-0-1/2} the
     * inner {@code 2-0-1} is rejected because a slash precedes it. Both then fall through to the
     * pharmacist, which is the right answer for a liquid dose and for a half-tablet course.
     *
     * <p>The slot count is deliberately UNBOUNDED here rather than capped at 4 in the regex
     * itself: capping it in the pattern would make a genuine 5-slot string ({@code 1-1-1-1-1})
     * match its first 4 slots and silently drop the rest — the "boundary" check would see a
     * trailing dash-digit, not a letter, and wave it through. Matching the whole chain and then
     * rejecting an implausible slot count in code (see {@link #dosesPerDay}) means an over-long
     * pattern is refused outright instead of quietly truncated.
     */
    private static final Pattern DOSING_PATTERN =
            Pattern.compile("(?<![\\w./,-])\\d{1,2}(?:\\s*-\\s*\\d{1,2})+(?![\\w./,-])");

    /** Any number in the duration text. More than one means a range, which is not a duration. */
    private static final Pattern NUMBER = Pattern.compile("\\d{1,4}");

    /**
     * Words that mean "not every day", on either field. The dosing pattern next to one of these
     * still parses cleanly and would still multiply cleanly — that is exactly the danger.
     */
    private static final Pattern NON_DAILY_QUALIFIER = Pattern.compile(
            "\\b(?:sos|prn|stat|alt|alternate|alternate\\s+day|alternate\\s+days|every\\s+other|"
                    + "weekly|fortnightly|monthly|once\\s+a\\s+week|twice\\s+a\\s+week|as\\s+needed|"
                    + "as\\s+required|as\\s+directed|when\\s+required)\\b",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern WEEKS = Pattern.compile("\\b(?:week|weeks|wk|wks)\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern MONTHS = Pattern.compile("\\b(?:month|months|mon|mth|mths)\\b", Pattern.CASE_INSENSITIVE);

    /**
     * Unicode dash variants a copy-pasted prescription can carry (en dash, em dash, minus sign,
     * a stray non-breaking hyphen) — normalized to a plain hyphen before matching, since a
     * clinic's word processor autocorrecting "1-0-1" to "1–0–1" should not be the difference
     * between an automatic quantity and a manual one.
     */
    private static final Pattern DASH_VARIANTS = Pattern.compile("[‐‑‒–—−]");

    /** Slots above this in a dosing pattern (2–4 is every real regimen this product supports). */
    private static final int MAX_SLOTS = 4;
    /** One slot of a dosing pattern. Above this the string is not a dose count any more. */
    private static final int MAX_UNITS_PER_SLOT = 20;
    /** Long enough for a chronic-therapy repeat, short enough that a typo cannot become a year's stock. */
    private static final int MAX_DAYS = 180;
    /** A course this large is a wholesale order, not a prescription — a human should look at it. */
    private static final int MAX_TOTAL_UNITS = 1000;

    /**
     * The units this course needs, or a specific reason it could not be established with
     * certainty — see {@link Result}. A refusal is a normal, expected answer, not an error: it
     * means "a pharmacist decides this one", and the message is written for that pharmacist to
     * read, not for a log file.
     *
     * @param dosage   the clinic's dosage text, e.g. {@code "1-0-1"} or {@code "Tab 1-0-1 after food"}
     * @param duration the clinic's duration text, e.g. {@code "6 days"}, {@code "2 weeks"}, {@code "5"}
     * @param baseUnit the medicine's resolved base unit — see {@link
     *                 com.checkup.pharmacy.common.util.BaseUnits#resolve}
     */
    public static Result calculate(String dosage, String duration, String baseUnit) {
        if (!isCountable(baseUnit)) {
            // "Not recorded" and "genuinely measured" are different situations with different
            // fixes — one is a catalogue gap, the other is inherent to the medicine — so they
            // get different sentences rather than one message papering over both.
            String message = baseUnit == null || baseUnit.isBlank()
                    ? "This medicine's dispensing unit isn't recorded in the catalogue, so a quantity can't be "
                            + "calculated automatically — enter it manually."
                    : "This medicine is measured in " + unitLabel(baseUnit)
                            + ", not counted as whole units — enter the quantity to dispense manually.";
            return Result.refused(Reason.NOT_COUNTABLE_UNIT, message);
        }
        if (isBlank(dosage)) {
            return Result.refused(Reason.DOSAGE_MISSING,
                    "The clinic sent no dosage for this line, so a quantity can't be calculated.");
        }
        if (isBlank(duration)) {
            return Result.refused(Reason.DURATION_MISSING,
                    "The clinic sent no duration for this line, so a quantity can't be calculated.");
        }
        // Checked across both fields: "1-0-1" with "10 days (alternate days)" is as wrong as
        // "1-0-1 SOS" with "10 days", and which field carries the qualifier is the clinic's
        // formatting choice, not a meaningful distinction.
        if (NON_DAILY_QUALIFIER.matcher(dosage).find() || NON_DAILY_QUALIFIER.matcher(duration).find()) {
            return Result.refused(Reason.NON_DAILY_SCHEDULE,
                    "\"" + dosage + "\" / \"" + duration + "\" is not a plain daily schedule (e.g. SOS, PRN, "
                            + "or alternate-day) — confirm the total quantity manually.");
        }

        Result perDay = dosesPerDay(dosage);
        if (!perDay.isCalculated()) {
            return perDay;
        }
        Result days = durationInDays(duration);
        if (!days.isCalculated()) {
            return days;
        }

        int total = perDay.quantity() * days.quantity();
        if (total <= 0 || total > MAX_TOTAL_UNITS) {
            return Result.refused(Reason.RESULT_IMPLAUSIBLE,
                    "\"" + dosage + "\" for \"" + duration + "\" works out to " + total
                            + " units, which looks like a data or unit issue — confirm the quantity manually.");
        }
        return Result.of(total);
    }

    /** True for the units a dosing pattern can be counted in — see {@link #COUNTABLE_BASE_UNITS}. */
    public static boolean isCountable(String baseUnit) {
        return baseUnit != null && COUNTABLE_BASE_UNITS.contains(baseUnit.trim().toUpperCase(Locale.ROOT));
    }

    private static String unitLabel(String baseUnit) {
        if (baseUnit == null || baseUnit.isBlank()) {
            return "an unrecorded unit";
        }
        return switch (baseUnit.trim().toUpperCase(Locale.ROOT)) {
            case "ML" -> "millilitres";
            case "GM" -> "grams";
            default -> baseUnit.trim().toLowerCase(Locale.ROOT);
        };
    }

    /**
     * Units per day from a dosing pattern — the sum of its slots, so {@code 1-0-1} is 2 and
     * {@code 2-0-2} is 4.
     *
     * <p>Exactly one pattern must be present. Two of them ({@code "1-0-1 then 1-0-0"}) is a
     * tapering course, whose total is not either pattern times the duration.
     */
    private static Result dosesPerDay(String dosage) {
        String normalized = DASH_VARIANTS.matcher(dosage).replaceAll("-");
        Matcher matcher = DOSING_PATTERN.matcher(normalized);
        if (!matcher.find()) {
            return Result.refused(Reason.DOSAGE_PATTERN_UNRECOGNIZED,
                    "Couldn't find a dosing pattern like \"1-0-1\" in \"" + dosage + "\" — confirm the quantity manually.");
        }
        String pattern = matcher.group();
        if (matcher.find()) {
            return Result.refused(Reason.DOSAGE_PATTERN_AMBIGUOUS,
                    "\"" + dosage + "\" carries more than one dosing pattern (looks like a tapering or changing "
                            + "dose) — confirm the quantity manually.");
        }

        String[] slots = pattern.split("\\s*-\\s*");
        if (slots.length > MAX_SLOTS) {
            return Result.refused(Reason.DOSAGE_PATTERN_AMBIGUOUS,
                    "\"" + pattern + "\" has more dose slots than a normal daily schedule — confirm the quantity manually.");
        }

        int perDay = 0;
        for (String slot : slots) {
            int units = Integer.parseInt(slot.trim());
            if (units > MAX_UNITS_PER_SLOT) {
                return Result.refused(Reason.DOSAGE_PATTERN_AMBIGUOUS,
                        "\"" + pattern + "\" includes a single dose of " + units
                                + " units, which is too large to trust automatically — confirm the quantity manually.");
            }
            perDay += units;
        }
        // "0-0-0" parses perfectly and means nothing is taken. Not a course.
        if (perDay <= 0) {
            return Result.refused(Reason.DOSAGE_PATTERN_AMBIGUOUS,
                    "\"" + pattern + "\" adds up to zero units a day — confirm the quantity manually.");
        }
        return Result.of(perDay);
    }

    /**
     * The course length in days.
     *
     * <p>Days and weeks only. A bare number is read as days — that is what a duration field
     * with "5" in it means everywhere this product runs, and refusing it would push the most
     * common shorthand there is back onto the pharmacist for no safety gain. Months are refused
     * on purpose: 28, 30 and 31 days are three different amounts of medicine.
     */
    private static Result durationInDays(String duration) {
        Matcher numbers = NUMBER.matcher(duration);
        if (!numbers.find()) {
            return Result.refused(Reason.DURATION_UNRECOGNIZED,
                    "Couldn't find a number of days in \"" + duration + "\" — confirm the quantity manually.");
        }
        String first = numbers.group();
        if (numbers.find()) {
            // "3 to 5 days", "1 week 2 days" — a range or a compound, neither of which is one number.
            return Result.refused(Reason.DURATION_AMBIGUOUS,
                    "\"" + duration + "\" names more than one number (a range, or a compound duration) — "
                            + "confirm the quantity manually.");
        }
        if (MONTHS.matcher(duration).find()) {
            return Result.refused(Reason.DURATION_AMBIGUOUS,
                    "\"" + duration + "\" is in months, which isn't an exact number of days — confirm the "
                            + "quantity manually.");
        }

        int value = Integer.parseInt(first);
        int days = WEEKS.matcher(duration).find() ? value * 7 : value;
        if (days <= 0 || days > MAX_DAYS) {
            return Result.refused(Reason.DURATION_UNRECOGNIZED,
                    "\"" + duration + "\" is not a plausible course length — confirm the quantity manually.");
        }
        return Result.of(days);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
