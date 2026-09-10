package com.checkup.pharmacy.common.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Decides when a pile of pharmacists disagreeing with the dispensing engine amounts to
 * evidence that the catalogue is wrong.
 *
 * <h2>Why a quorum at all</h2>
 * A pharmacist overriding the engine's pack count is an ordinary event with ordinary
 * explanations: the patient asked for less, the shelf was short, the doctor was called, the
 * course was split. Any ONE override is far more likely to be one of those than a catalogue
 * error, so acting on a single signal would quarantine half the catalogue within a week and
 * teach everyone to ignore the state. What is NOT ordinary is several pharmacists, in
 * different shops, who have never spoken to each other, independently reaching for roughly the
 * same number of packs and roughly the same implied bottle size. Nothing but the physical
 * product explains that agreement.
 *
 * <h2>The three conditions</h2>
 * <ol>
 *   <li><b>Enough votes</b> ({@value #MIN_SIGNALS}) — one is anecdote, two is coincidence.</li>
 *   <li><b>From enough shops</b> ({@value #MIN_PHARMACIES}) — this is the condition that does
 *       the real work. Three overrides from one counter can easily be one pharmacist with one
 *       habit, or one patient collecting a course in instalments. Two independent sites cannot
 *       share a habit.</li>
 *   <li><b>Agreeing about the size</b> — the implied sizes must cluster, and the cluster must
 *       be somewhere other than where the catalogue says. Pharmacists who override for
 *       unrelated reasons scatter; pharmacists looking at the same bottle converge.</li>
 * </ol>
 *
 * <h2>What it deliberately does not do</h2>
 * It never proposes a value to write. {@link Verdict#impliedPackSize()} is a median of lower
 * bounds — 40&nbsp;ml handed over as one bottle implies "at least 40" when the bottle is really
 * 60 — so it is strong enough to prove a declared 5&nbsp;ml wrong and far too weak to replace
 * it. The caller's job is to quarantine and ask a human, and this class is shaped to make
 * auto-correction awkward rather than merely discouraged.
 *
 * <p>Pure and dependency-free, like {@link PackSizeGuard} and {@link DispensePlausibility}.
 */
public final class PackSizeQuorum {

    private PackSizeQuorum() {
    }

    /** One is anecdote, two is coincidence. */
    public static final int MIN_SIGNALS = 3;

    /**
     * The condition that actually distinguishes a catalogue error from a local habit. Three
     * overrides at one counter can be one pharmacist, one patient, or one week's short shelf;
     * two separate shops cannot share any of those.
     */
    public static final int MIN_PHARMACIES = 2;

    /**
     * How far two implied pack sizes may differ and still count as agreeing.
     *
     * <p>The same band {@link PackSizeGuard} already uses to decide whether a batch's MRP looks
     * like a different pack size, and reused on purpose: a system with two different opinions
     * about what "roughly the same pack" means will eventually act on both. Wide, because the
     * inputs are lower bounds derived from whatever volumes clinicians happened to prescribe —
     * a 100&nbsp;ml course filled with two bottles implies 50, a 40&nbsp;ml course filled with
     * one implies 40, and those are the same 60&nbsp;ml bottle seen twice.
     */
    private static final BigDecimal BAND_LOW = new BigDecimal("0.62");
    private static final BigDecimal BAND_HIGH = new BigDecimal("1.60");

    /**
     * One pharmacist's disagreement, reduced to the only two things the quorum reasons about.
     *
     * @param pharmacyId      whose counter it came from — identity is never used, only distinctness
     * @param impliedPackSize what one pack must hold for their count to have been right
     */
    public record Observation(String pharmacyId, int impliedPackSize) {
    }

    /**
     * @param reached         whether to quarantine
     * @param signalCount     agreeing signals (in-band only, not the raw pile)
     * @param pharmacyCount   distinct pharmacies among those
     * @param impliedPackSize the cluster's median — evidence for a human, NOT a value to write
     * @param summary         a sentence for the review task
     */
    public record Verdict(boolean reached, int signalCount, int pharmacyCount,
                          int impliedPackSize, String summary) {

        static Verdict notReached(String why) {
            return new Verdict(false, 0, 0, 0, why);
        }
    }

    /**
     * Weigh the open signals for one medicine against the pack size the catalogue currently
     * declares.
     *
     * @param observations every unresolved signal for the medicine
     * @param declaredPackSize the divisor those pharmacists were disagreeing with
     */
    public static Verdict evaluate(List<Observation> observations, int declaredPackSize) {
        if (observations == null || observations.size() < MIN_SIGNALS) {
            return Verdict.notReached("Not enough signals yet");
        }
        if (declaredPackSize <= 0) {
            // Nothing to dispute against. A medicine with no declared size is unclassified,
            // which Phase 2 already treats as its own state — quarantining it would be
            // labelling an absence as a contradiction.
            return Verdict.notReached("No declared pack size to dispute");
        }

        List<Integer> sizes = new ArrayList<>();
        for (Observation o : observations) {
            if (o != null && o.impliedPackSize() > 0) {
                sizes.add(o.impliedPackSize());
            }
        }
        if (sizes.size() < MIN_SIGNALS) {
            return Verdict.notReached("Not enough usable signals yet");
        }

        // Median, not mean: one pharmacist filling a whole course in a single unusual handover
        // drags a mean a long way and moves a median hardly at all. The cluster is what is
        // being measured, and an outlier is exactly what must not define it.
        int median = median(sizes);

        // Signals that actually agree with the cluster. The rest are the ordinary overrides —
        // short shelf, patient wanted less — and they neither count toward the quorum nor
        // against it; they are simply not evidence about the pack.
        List<Observation> agreeing = new ArrayList<>();
        Set<String> pharmacies = new HashSet<>();
        for (Observation o : observations) {
            if (o != null && o.impliedPackSize() > 0 && withinBand(o.impliedPackSize(), median)) {
                agreeing.add(o);
                pharmacies.add(o.pharmacyId());
            }
        }
        if (agreeing.size() < MIN_SIGNALS) {
            return Verdict.notReached("Signals disagree about the pack size");
        }
        if (pharmacies.size() < MIN_PHARMACIES) {
            // Deliberately after the agreement check, so the message names the real blocker:
            // "all from one pharmacy" is a different situation from "nobody agrees", and a
            // reviewer reading the log needs to know which.
            return Verdict.notReached("All agreeing signals come from one pharmacy");
        }

        // The cluster has to be somewhere OTHER than where the catalogue already says. Without
        // this, a medicine whose pack size is perfectly correct gets quarantined the moment
        // three pharmacists round a course differently — which is not disagreement with the
        // catalogue at all, just arithmetic.
        if (withinBand(median, declaredPackSize)) {
            return Verdict.notReached("Signals agree with the pack size already on record");
        }

        String direction = median > declaredPackSize ? "larger" : "smaller";
        return new Verdict(true, agreeing.size(), pharmacies.size(), median,
                agreeing.size() + " dispensing corrections from " + pharmacies.size() + " pharmacies "
                + "point at a pack of about " + median + ", " + direction + " than the "
                + declaredPackSize + " on record. Implied sizes are a lower bound taken from what "
                + "was actually handed over, so treat this as a reason to check a physical pack, "
                + "not as a measurement.");
    }

    /** True when {@code value} is within the tolerance band around {@code reference}. */
    private static boolean withinBand(int value, int reference) {
        if (reference <= 0) {
            return false;
        }
        BigDecimal ratio = BigDecimal.valueOf(value)
                .divide(BigDecimal.valueOf(reference), 4, RoundingMode.HALF_UP);
        return ratio.compareTo(BAND_LOW) >= 0 && ratio.compareTo(BAND_HIGH) <= 0;
    }

    private static int median(List<Integer> values) {
        List<Integer> sorted = new ArrayList<>(values);
        sorted.sort(Integer::compareTo);
        int n = sorted.size();
        if (n % 2 == 1) {
            return sorted.get(n / 2);
        }
        // Rounded down rather than up: every input is already a lower bound on the true pack
        // size, and rounding the summary of lower bounds upward would quietly manufacture
        // confidence the inputs do not carry.
        return (sorted.get(n / 2 - 1) + sorted.get(n / 2)) / 2;
    }
}
