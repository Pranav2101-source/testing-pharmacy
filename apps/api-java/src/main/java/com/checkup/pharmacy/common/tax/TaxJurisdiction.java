package com.checkup.pharmacy.common.tax;

import java.util.Locale;

/**
 * The one place that decides whether a transaction crosses a state line.
 *
 * <p>WHY THIS EXISTS
 *
 * <p>Four separate places asked the same question — {@code BillingService} for a sale,
 * {@code PurchasesService} for a goods receipt, {@code SupplierReturnsService} for a debit
 * note, and the GSTR-3B misclassification check — and all four answered it with
 * {@code equalsIgnoreCase} on two free-text columns. {@link IndianState} was built precisely
 * to stop a tax decision resting on whether two people spelled a state the same way, but it
 * was only ever enforced when a SUPPLIER was created. The pharmacy's own state, and every
 * record written before that validation existed, are unconstrained text.
 *
 * <p>So {@code "Tamilnadu"} against {@code "Tamil Nadu"} charged IGST on a local purchase AND
 * then flagged that same receipt on the 3B sheet as misclassified — one typo, two wrong
 * answers that pointed at each other.
 *
 * <p>WHAT IT DOES NOT DO
 *
 * <p>It does not guess. An unrecognised, unmatched spelling is reported as intra-state, which
 * is the same fail-safe direction the callers already chose and documented: an unset pharmacy
 * state would otherwise make every local purchase look inter-state and move the whole
 * pharmacy's input credit into the wrong column. The 3B sheet flags what it believes is
 * misclassified rather than silently correcting it.
 */
public final class TaxJurisdiction {

    private TaxJurisdiction() {
    }

    /**
     * Whether a transaction between {@code pharmacyState} and {@code counterpartyState}
     * attracts IGST rather than CGST + SGST.
     *
     * <p>Returns false — intra-state — when either side is unknown. See the class javadoc for
     * why that is the safe direction rather than a cop-out.
     */
    public static boolean isInterstate(String pharmacyState, String counterpartyState) {
        if (isBlank(pharmacyState) || isBlank(counterpartyState)) {
            return false;
        }
        var mine = IndianState.fromName(pharmacyState);
        var theirs = IndianState.fromName(counterpartyState);
        if (mine.isPresent() && theirs.isPresent()) {
            return mine.get() != theirs.get();
        }
        // At least one side is not a state this system recognises — a legacy value, or a typo
        // nobody has corrected. Fall back to comparing canonical keys so two spellings of the
        // same unrecognised string still count as the same place, rather than declaring an
        // inter-state supply on the strength of a stray space.
        return !canonicalKey(pharmacyState).equals(canonicalKey(counterpartyState));
    }

    /**
     * The comparison key for a state name: lowercase, {@code &} spelled out, and every
     * separator removed.
     *
     * <p>Deliberately narrow. It closes the gap between {@code "Tamil Nadu"},
     * {@code "TamilNadu"} and {@code "tamil-nadu"} — different renderings of one name — and
     * between {@code "Jammu & Kashmir"} and {@code "Jammu and Kashmir"}. It does NOT accept
     * abbreviations: {@code "TN"} keys to {@code "tn"} and still fails to match, because
     * treating an abbreviation as equal is how two suppliers in the same state stop comparing
     * equal in the other direction.
     *
     * <p>Mirrored in SQL by {@code GRNItemRepository.misclassifiedInterstateGrns}. The two
     * must apply the same replacements or a receipt can be flagged by one and cleared by the
     * other; the order is irrelevant because the searches do not overlap.
     */
    public static String canonicalKey(String value) {
        if (value == null) {
            return "";
        }
        return value.toLowerCase(Locale.ROOT)
                .replace("&", "and")
                .replace(" ", "")
                .replace("-", "")
                .replace(".", "");
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
