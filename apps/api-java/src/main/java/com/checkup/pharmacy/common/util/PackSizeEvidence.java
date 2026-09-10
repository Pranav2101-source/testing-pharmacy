package com.checkup.pharmacy.common.util;

import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.enums.PackSizeSource;

/**
 * What is actually known about a pack size that is about to be written, and how much of it
 * corroborates the number.
 *
 * <p>The pack multiple is a divisor, and until now nothing ever asked where it came from. A
 * catalogue row said 5, so every screen divided by 5, and the 40&nbsp;ml course that produced
 * came out as eight bottles with no dissent anywhere in the system — because there was nothing
 * in the system capable of dissenting. This is the dissent: one pure function that looks at the
 * fields already on the record, decides whether any of them back the number up, and returns
 * that judgement in a form the row can carry.
 *
 * <p><b>It never blocks a sale.</b> {@link PackSizeConfidence#UNVERIFIED} is the ordinary
 * outcome for most of a real catalogue and means only "nobody has checked this" — billing uses
 * it exactly as before. The one outcome a caller may act on is {@link
 * PackSizeConfidence#DISPUTED}, which is not doubt but contradiction: some other field on the
 * same SKU is already claiming that number means something else.
 *
 * <p>Pure and dependency-free, in the same spirit as {@link PackSizeGuard} and {@link
 * DispensePlausibility} — it takes fields, returns a verdict, and touches no database, so the
 * write path and the read path can both consult it without either needing a service.
 *
 * @param confidence how far the number may be trusted, or null when there is no number
 * @param source     where it came from — supplied by the caller, since only the caller knows
 *                   which door the write came through
 * @param reason     a pharmacist-readable sentence explaining a non-VERIFIED verdict, for the
 *                   UI and for the 400 the service raises on DISPUTED. Null when there is
 *                   nothing to say.
 */
public record PackSizeEvidence(PackSizeConfidence confidence, PackSizeSource source, String reason) {

    /** True when the verdict is a contradiction rather than merely an absence of evidence. */
    public boolean isDisputed() {
        return confidence == PackSizeConfidence.DISPUTED;
    }

    /** True when something on the record actually backs the number up. */
    public boolean isVerified() {
        return confidence == PackSizeConfidence.VERIFIED;
    }

    /**
     * Assess a pack size against everything else the medicine's own record says.
     *
     * <p>The order below is the whole design, and it is contradiction-first on purpose. A
     * pharmacist ticking "I checked the pack" is strong evidence, but it is not stronger than
     * the carton disagreeing with itself: if the strength field and the pack-size field are
     * claiming the same number, the most likely explanation is that the person ticking was
     * looking at the strength. Letting a tick override that would make the tick the easiest way
     * to launder a bad datum into VERIFIED, which is the opposite of what it is for.
     *
     * @param medicineName     for the message
     * @param resolvedBaseUnit output of {@link BaseUnits#resolve} — only ML/GM rows can be
     *                         measured, and the 1&nbsp;ml/1&nbsp;g check below applies to those
     * @param strength         catalogue {@code Medicine.strength} free text, may be null
     * @param packSizeText     catalogue {@code Medicine.packSize} free text, may be null
     * @param unitsPerPack     the number being written; null means "not classified"
     * @param humanConfirmed   the caller carried an explicit "I checked a physical pack" tick
     * @param source           which door this write came through
     */
    public static PackSizeEvidence assess(String medicineName, String resolvedBaseUnit,
                                          String strength, String packSizeText, Integer unitsPerPack,
                                          boolean humanConfirmed, PackSizeSource source) {
        // No pack size on record. Not "unverified" — there is nothing to verify, and the
        // difference matters: an unclassified medicine is correctly refused for loose sale,
        // while an UNVERIFIED one sells normally.
        if (unitsPerPack == null) {
            return new PackSizeEvidence(null, null, null);
        }

        // ── Contradiction ────────────────────────────────────────────────────────────────
        String masquerade = PackSizeGuard.strengthMasqueradingAsPackSize(
                medicineName, strength, packSizeText, unitsPerPack);
        if (masquerade != null) {
            return new PackSizeEvidence(PackSizeConfidence.DISPUTED, source, masquerade);
        }
        if (PackUnits.isMeasured(resolvedBaseUnit) && unitsPerPack == 1) {
            // Also refused by a CHECK constraint on the table, which is the backstop for
            // writers that never reach this method. Caught here first so the pharmacist gets
            // this sentence instead of a constraint-violation stack trace.
            String shortUnit = "GM".equalsIgnoreCase(resolvedBaseUnit.trim()) ? "gram" : "millilitre";
            return new PackSizeEvidence(PackSizeConfidence.DISPUTED, source,
                    "\"" + medicineName + "\" is measured in " + shortUnit + "s, so a sealed pack of "
                    + "1 " + shortUnit + " is not a real pack — there is no 1 ml bottle of syrup and no "
                    + "1 g tube of cream. This is usually a strength or a placeholder left in the pack "
                    + "size field. Enter how much one sealed pack holds.");
        }

        // ── Corroboration ────────────────────────────────────────────────────────────────
        if (humanConfirmed) {
            return new PackSizeEvidence(PackSizeConfidence.VERIFIED, source, null);
        }
        // The medicine's own free-text pack size naming the same volume is a second,
        // independently-entered fact agreeing with the first. That is the only corroboration
        // available without asking somebody to go and look at a shelf.
        Integer fromText = PackSizeGuard.parseMeasuredSize(packSizeText);
        if (fromText != null && fromText.equals(unitsPerPack)) {
            return new PackSizeEvidence(PackSizeConfidence.VERIFIED, PackSizeSource.PACK_SIZE_TEXT,
                    "Corroborated by the pack size on record (\"" + packSizeText.trim() + "\").");
        }

        // ── Neither ──────────────────────────────────────────────────────────────────────
        return new PackSizeEvidence(PackSizeConfidence.UNVERIFIED, source,
                "Nobody has confirmed this pack size against a physical pack, and nothing else on "
                + "the record corroborates it. It is still used for billing — check it against a "
                + "pack when you next have one in your hand.");
    }
}
