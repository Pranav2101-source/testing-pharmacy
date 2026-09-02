package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * A GSTR-3B <b>working sheet</b> — the figures to enter on the portal, not a filed return.
 *
 * <p>The distinction is the whole design. GSTR-3B is a self-declared summary that the taxpayer
 * signs; a pharmacy management system can supply the numbers it can see, and must be explicit
 * about the ones it cannot. So every table here is either derived from real documents or
 * reported as zero WITH a reason attached in {@link DataQuality} — never quietly omitted, and
 * never filled with a plausible-looking guess.
 *
 * <p>What it derives: outward supplies split taxable vs nil-rated (3.1a / 3.1c), net of credit
 * notes issued in the period; inter-state supplies to unregistered persons by place of supply
 * (3.2); input tax credit from confirmed goods receipts (4A5) less debit notes (4B); and
 * exempt inward supplies (table 5).
 *
 * <p>What it cannot: reverse-charge liability, exports, non-GST supplies, and the eligible /
 * ineligible split of ITC — none of which this system records. Table 6.1 (payment of tax) is
 * a cash-versus-credit utilisation decision that belongs to the person filing.
 */
public record Gstr3bResponse(String periodLabel, Identity identity,
                             OutwardSupplies outwardSupplies,
                             List<PlaceOfSupply> interstateToUnregistered,
                             InputTaxCredit inputTaxCredit,
                             TaxAmount exemptInward,
                             DataQuality dataQuality) {

    /** Who is filing. Straight off the pharmacy record, so a blank GSTIN is visible immediately. */
    public record Identity(String legalName, String gstin, String state) {
    }

    /** The four amounts every GSTR-3B row carries. */
    public record TaxAmount(BigDecimal taxableValue, BigDecimal igst, BigDecimal cgst, BigDecimal sgst) {
        public static TaxAmount zero() {
            return new TaxAmount(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }

    /**
     * Table 3.1. {@code taxableOutward} and {@code nilRatedExempt} are already net of the
     * credit notes reported alongside them — {@code creditNotes} is carried separately so the
     * accountant can see what was deducted rather than having to trust a smaller number.
     *
     * @param zeroRated     3.1(b) exports/SEZ — not recorded by this system
     * @param reverseCharge 3.1(d) inward supplies liable to reverse charge — not recorded
     * @param nonGst        3.1(e) non-GST outward supplies — not recorded
     */
    public record OutwardSupplies(TaxAmount taxableOutward, TaxAmount zeroRated, TaxAmount nilRatedExempt,
                                  TaxAmount reverseCharge, TaxAmount nonGst, TaxAmount creditNotes) {
    }

    /**
     * One row of table 3.2 — an inter-state supply, by the state it was supplied to.
     *
     * @param state the place of supply, or NULL when it could not be determined (no customer on
     *              the bill, or a customer with no state on file). Null rather than a made-up
     *              label so the caller can render it as the exception it is; the portal needs a
     *              real state against every row, and these are the ones to assign by hand.
     */
    public record PlaceOfSupply(String state, BigDecimal taxableValue, BigDecimal igst) {
    }

    /**
     * Table 4.
     *
     * <p>4(B) is split into its two statutory halves because the return has had two separate
     * rows for them since the July 2022 revamp, and they are not interchangeable: 4(B)(1) is
     * permanent (the credit was never yours), 4(B)(2) is provisional and reclaimable in a later
     * period through 4(D)(1). Reporting one combined figure meant the filer had to guess the
     * split, and guessing wrong makes a reclaim either impossible or unsupportable.
     *
     * @param allOtherItc      4(A)(5) — credit on confirmed goods receipts in the period
     * @param reversedSection17 4(B)(1) — reversal under rules 38/42/43 and section 17(5). This
     *                         system cannot derive it: see {@link DataQuality#expiredStock}
     * @param reversedOther    4(B)(2) — everything else. Here: debit notes raised on suppliers,
     *                         which reverse credit taken on goods that went back
     * @param netAvailable     4(C) — 4(A) less all of 4(B)
     */
    public record InputTaxCredit(TaxAmount allOtherItc, TaxAmount reversedSection17,
                                 TaxAmount reversedOther, TaxAmount netAvailable) {
    }

    /**
     * Everything the sheet knows it does not know.
     *
     * <p>A tax return assembled from partial data is more dangerous than no return at all,
     * because the gaps are invisible once the numbers are on the page. Each flag here names a
     * specific thing to check by hand before filing.
     *
     * @param gstinMissing        the pharmacy has no GSTIN on file — nothing can be filed without one
     * @param stateMissing        no state on the pharmacy, so inter-state cannot be determined AT ALL
     *                            and every supply has been treated as local
     * @param misclassifiedGrns   confirmed receipts from out-of-state suppliers carrying no IGST:
     *                            recorded before this system could tell the difference, and
     *                            deliberately not rewritten because they may sit behind a filed return
     * @param suppliersWithoutState suppliers with no state on file. Purchases from these are
     *                            assumed local, and {@code misclassifiedGrns} CANNOT see them —
     *                            so a low flag count means little while this number is high
     * @param suppliersTotal      active suppliers, for the denominator
     * @param carryForward        what netting pushed BELOW zero, as positive amounts. GSTR-3B
     *                            cannot express a negative supply, so a period whose credit
     *                            notes exceed its sales is filed nil and the remainder carried
     *                            into the next period. The figures above are floored; this is
     *                            what was floored away, reported rather than dropped, because a
     *                            silently-zeroed row and a genuinely nil one are indistinguishable
     *                            once they are on the page
     * @param lateCancellations   bills that were live when this period ended and have been
     *                            cancelled since. Their value is no longer in the figures above,
     *                            so if this period has already been filed, what was filed and
     *                            what this sheet now says are different numbers
     * @param interstateWithoutPlaceOfSupply
     *                            taxable value of inter-state supplies with no place of supply
     *                            on file — the unnamed row in 3.2. The portal requires a state
     *                            against every row, so this is a to-do, not a footnote
     * @param untrackedNotes      the tables this system cannot populate, each with why
     */
    public record DataQuality(boolean gstinMissing, boolean stateMissing,
                              List<String> misclassifiedGrns,
                              long suppliersWithoutState, long suppliersTotal,
                              TaxAmount carryForward,
                              LateCancellations lateCancellations,
                              BigDecimal interstateWithoutPlaceOfSupply,
                              ExpiredStock expiredStock,
                              List<String> untrackedNotes) {
    }

    /**
     * Expired stock still on the books, and the input tax credit sitting inside it.
     *
     * <p>This is what Table 4(B)(1) would be built from, if this figure had been derived rather
     * than reported as an exposure — it hasn't, because whether a given expired batch has
     * actually been disposed of (which sets {@code BatchStatus.EXPIRED} and writes an
     * {@code EXPIRY_REMOVAL} movement — {@code InventoryService}'s expiry write-off flow) is a
     * pharmacist decision this report cannot make for them. Every batch counted here has NOT
     * been through that flow, so Section 17(5)(h)'s credit reversal is still outstanding on it.
     *
     * <p>Reported as an exposure the filer must act on rather than folded into 4(B)(1) as if it
     * had been derived. The amount is an estimate at the medicine's current GST rate — see
     * {@code InventoryRepository.expiredStockOnBooks} for exactly what it does and does not know.
     *
     * @param batches      how many batches are past their expiry date with stock remaining
     * @param units        count of individual base units (sealed packs multiplied out by their
     *                     effective pack size, plus any loose remainder) — NOT a pack count, so
     *                     a batch that is only a cut-strip remainder still shows a real number.
     *                     {@code cost}/{@code embeddedItc} are unchanged for a pack-only batch.
     * @param cost         what they cost, at the batch's recorded purchase rate — a loose
     *                     remainder priced at its per-piece share of the same rate
     * @param embeddedItc  the credit claimed on them, which section 17(5)(h) says you cannot keep
     */
    public record ExpiredStock(long batches, long units, BigDecimal cost, BigDecimal embeddedItc) {
        public static ExpiredStock none() {
            return new ExpiredStock(0, 0, BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }

    /**
     * Bills from this period that were cancelled after it closed.
     *
     * <p>Zero is the ordinary case and the only reassuring one. A non-zero count means this
     * sheet no longer agrees with a return that may already have been filed from the same
     * period — which is recoverable if you know, and not if you do not.
     */
    public record LateCancellations(long count, BigDecimal taxableValue, BigDecimal totalGst) {
        public static LateCancellations none() {
            return new LateCancellations(0, BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }
}
