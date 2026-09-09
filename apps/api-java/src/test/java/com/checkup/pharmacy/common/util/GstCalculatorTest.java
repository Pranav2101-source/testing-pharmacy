package com.checkup.pharmacy.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Money math. Tested first and hardest because every other billing assertion is
 * downstream of it, and because a rounding defect here is silent: it produces a
 * plausible number on every invoice and only surfaces as a GST return that will not
 * reconcile months later.
 */
class GstCalculatorTest {

    private static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }

    @Nested
    @DisplayName("calcGstFromMrp — reverse-calculating tax out of a GST-inclusive MRP")
    class FromMrp {

        @Test
        @DisplayName("intra-state splits the tax evenly into CGST and SGST, with no IGST")
        void intraStateSplitsEvenly() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), false);

            assertThat(result.cgst()).isEqualByComparingTo(result.sgst());
            assertThat(result.igst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.taxableAmount()).isEqualByComparingTo(bd("84.75"));
        }

        @Test
        @DisplayName("inter-state charges the whole rate as IGST, with no CGST or SGST")
        void interStateChargesIgstOnly() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), true);

            assertThat(result.cgst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.sgst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.igst()).isEqualByComparingTo(result.totalGst());
        }

        /**
         * The invariant that makes a reverse-calculated invoice defensible: tax
         * extracted out of an inclusive price, added back to the taxable base, must
         * return the price the customer was quoted.
         *
         * <p>Asserted for INTER-state only. Intra-state cannot satisfy it in general
         * — see {@link #intraStateMayDifferByOnePaisaBecauseCgstMustEqualSgst()}.
         */
        @Test
        @DisplayName("inter-state: taxable + IGST returns exactly the original MRP")
        void interStateAmountReconcilesToMrp() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), true);

            assertThat(result.taxableAmount().add(result.igst()))
                    .as("a Rs.100 inter-state item must bill at exactly Rs.100")
                    .isEqualByComparingTo(bd("100.00"));
            assertThat(result.amount()).isEqualByComparingTo(bd("100.00"));
        }

        /**
         * Documents a deliberate, legally-motivated inaccuracy rather than a defect — and
         * WHERE it is now parked.
         *
         * <p>GST requires CGST and SGST to be equal, and each is stored to 2dp. When the
         * total tax is an odd number of paise the half cannot be represented, so the split
         * rounds both sides the same way and (taxable + CGST + SGST) lands a paisa off the
         * price. The alternative — an unequal 7.63/7.62 split — reconciles exactly but is
         * not a valid CGST/SGST pair.
         *
         * <p>The line TOTAL now stays on the customer-facing price ({@code amount == 100.00}
         * = MRP x qty): it is the gross, not a sum of the rounded tax parts. The unavoidable
         * paisa therefore shows up as (taxable + CGST + SGST) summing to 100.01 in the tax
         * breakdown — harmless on a B2C retail invoice, and far less confusing than the old
         * behaviour where a clean Rs.90 x 2 line printed as 179.99 and every such bill
         * carried a phantom round-off.
         *
         * <p>If this test fails because someone made (taxable + tax) sum exactly to
         * {@code amount} again, check they did not either (a) push the line total back off
         * the MRP, or (b) break the equal CGST/SGST split. Read this comment first.
         */
        @Test
        @DisplayName("intra-state: the line total is the price paid; the odd paisa lands in the tax split instead")
        void intraStateTaxSplitMayNotSumExactlyToTheLineTotal() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), false);

            assertThat(result.cgst()).isEqualByComparingTo(bd("7.63"));
            assertThat(result.sgst()).isEqualByComparingTo(bd("7.63"));
            assertThat(result.amount())
                    .as("the line total is what the customer pays — exactly the MRP")
                    .isEqualByComparingTo(bd("100.00"));
            assertThat(result.taxableAmount().add(result.cgst()).add(result.sgst()))
                    .as("the equal split leaves the breakdown a paisa over — the documented tradeoff")
                    .isEqualByComparingTo(bd("100.01"));
        }

        @Test
        @DisplayName("the line discount is applied before tax is extracted, not after")
        void discountAppliedBeforeTax() {
            // 10 units x Rs.50 = Rs.500, less 10% = Rs.450 inclusive of 5% GST.
            var result = GstCalculator.calcGstFromMrp(bd("50"), 10, bd("10"), bd("5"), true);

            // 450 / 1.05 = 428.5714... -> 428.57
            assertThat(result.taxableAmount()).isEqualByComparingTo(bd("428.57"));
            assertThat(result.taxableAmount().add(result.igst())).isEqualByComparingTo(bd("450.00"));
        }

        @Test
        @DisplayName("a clean Rs.90 x 2 line totals exactly Rs.180.00, not Rs.179.99")
        void cleanLineTotalsExactlyToTheMrp() {
            // The live-review case: MRP 90, qty 2, 12% GST inclusive.
            var result = GstCalculator.calcGstFromMrp(bd("90"), 2, BigDecimal.ZERO, bd("12"), false);

            assertThat(result.amount()).isEqualByComparingTo(bd("180.00"));
            assertThat(result.cgst()).isEqualByComparingTo(result.sgst());
            assertThat(result.taxableAmount().add(result.totalGst()))
                    .as("the odd tax paisa lands in the breakdown, a paisa under the line total")
                    .isEqualByComparingTo(bd("179.99"));
        }

        @Test
        @DisplayName("a zero GST rate leaves the whole amount taxable and charges no tax")
        void zeroGstRate() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 2, BigDecimal.ZERO, BigDecimal.ZERO, false);

            assertThat(result.taxableAmount()).isEqualByComparingTo(bd("200.00"));
            assertThat(result.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.amount()).isEqualByComparingTo(bd("200.00"));
        }

        @Test
        @DisplayName("a 100% discount produces a zero-value line rather than a negative one")
        void fullDiscountProducesZeroLine() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, bd("100"), bd("18"), false);

            assertThat(result.taxableAmount()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.amount()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @ParameterizedTest(name = "{0}% GST on an inter-state line still reconciles to MRP")
        @CsvSource({"0", "5", "12", "18", "28"})
        @DisplayName("every GST slab in use reconciles exactly, inter-state")
        void allSlabsReconcileInterstate(String gstRate) {
            // 1000 x 3 = 3000, less 7.5% = 2775.00 exactly.
            //
            // The discounted amount is deliberately whole paise. Exact reconciliation
            // is only a meaningful requirement when the target is representable in
            // paise at all — see subPaisaDiscountCannotReconcileExactly() for what
            // happens when it is not.
            var result = GstCalculator.calcGstFromMrp(bd("1000"), 3, bd("7.5"), bd(gstRate), true);

            assertThat(result.taxableAmount().add(result.igst()))
                    .isEqualByComparingTo(bd("2775.00"));
        }

        /**
         * Not a defect, and worth pinning so nobody "fixes" it into one.
         *
         * <p>A discount can produce a price with sub-paisa precision (999.99 x 3 less
         * 7.5% = 2774.97225). The taxable base and the tax are each rounded to 2dp
         * independently, and when both round the same way the line total can sit a
         * paisa off the unrepresentable exact figure. Forcing an exact match would
         * mean deriving the tax as a plug (billed minus taxable) instead of from the
         * GST rate, which trades a paisa of line-total drift for a tax figure that no
         * longer equals rate x base — the worse of the two for a GST return.
         */
        @Test
        @DisplayName("a sub-paisa discount lands within one paisa, and cannot do better")
        void subPaisaDiscountCannotReconcileExactly() {
            var result = GstCalculator.calcGstFromMrp(bd("999.99"), 3, bd("7.5"), bd("28"), true);

            assertThat(result.taxableAmount().add(result.igst()))
                    .isCloseTo(bd("2774.97225"), org.assertj.core.data.Offset.offset(bd("0.01")));
        }
    }

    @Nested
    @DisplayName("calcInvoiceTotals — multi-line aggregation")
    class InvoiceTotals {

        /**
         * The invariant a tax invoice must satisfy, and the one the old implementation could
         * not: the header IS the sum of the lines.
         *
         * <p>Totals used to be accumulated unrounded and rounded once at the end, to avoid
         * compounding per-line rounding. Defensible in isolation, and wrong here — the GST
         * summary reads the invoice header while the GSTR-1 HSN summary sums the stored
         * LINES, and both get filed. A three-line bill at mixed slabs reported 269.27 in one
         * place and 269.28 in the other, with no way to say which was right.
         *
         * <p>Asserted line by line rather than on a single total, because a sum can agree by
         * two errors cancelling.
         */
        @Test
        @DisplayName("the header equals the sum of the lines, exactly, per tax head")
        void headerEqualsSumOfLines() {
            List<GstCalculator.MrpLineInput> lines = List.of(
                    new GstCalculator.MrpLineInput(bd("33.33"), 3, bd("7.5"), bd("5")),
                    new GstCalculator.MrpLineInput(bd("249.90"), 2, BigDecimal.ZERO, bd("12")),
                    new GstCalculator.MrpLineInput(bd("17.77"), 7, bd("2.5"), bd("18")),
                    new GstCalculator.MrpLineInput(bd("99.99"), 1, BigDecimal.ZERO, BigDecimal.ZERO));

            for (boolean interstate : new boolean[] {true, false}) {
                for (String billDiscount : new String[] {"0", "7.5"}) {
                    var totals = GstCalculator.calcInvoiceTotals(lines, interstate, bd(billDiscount));

                    BigDecimal taxable = BigDecimal.ZERO;
                    BigDecimal cgst = BigDecimal.ZERO;
                    BigDecimal sgst = BigDecimal.ZERO;
                    BigDecimal igst = BigDecimal.ZERO;
                    for (var line : lines) {
                        var l = GstCalculator.calcGstFromMrp(line.mrp(), line.quantity(), line.discountPct(),
                                line.gstRate(), interstate, bd(billDiscount));
                        taxable = taxable.add(l.taxableAmount());
                        cgst = cgst.add(l.cgst());
                        sgst = sgst.add(l.sgst());
                        igst = igst.add(l.igst());
                    }

                    String where = "interstate=" + interstate + " billDiscount=" + billDiscount;
                    assertThat(totals.taxableAmount()).as("taxable, " + where).isEqualByComparingTo(taxable);
                    assertThat(totals.cgst()).as("cgst, " + where).isEqualByComparingTo(cgst);
                    assertThat(totals.sgst()).as("sgst, " + where).isEqualByComparingTo(sgst);
                    assertThat(totals.igst()).as("igst, " + where).isEqualByComparingTo(igst);
                    assertThat(totals.totalGst()).as("totalGst, " + where)
                            .isEqualByComparingTo(cgst.add(sgst).add(igst));
                    // The header total is the sum of the LINE totals printed under it — the
                    // customer-facing prices, added up — not (taxable + tax), which the equal
                    // CGST/SGST split can leave a paisa off intra-state.
                    BigDecimal paid = BigDecimal.ZERO;
                    for (var line : lines) {
                        paid = paid.add(GstCalculator.calcGstFromMrp(line.mrp(), line.quantity(),
                                line.discountPct(), line.gstRate(), interstate, bd(billDiscount)).amount());
                    }
                    assertThat(totals.totalAmount()).as("total, " + where)
                            .isEqualByComparingTo(paid.setScale(2, java.math.RoundingMode.HALF_UP));
                }
            }
        }

        @Test
        @DisplayName("accumulates unrounded, so many small lines do not compound rounding drift")
        void doesNotCompoundRoundingDrift() {
            // 20 lines each carrying a value that rounds badly on its own. Summing
            // per-line rounded results would drift; accumulating raw should not.
            List<GstCalculator.MrpLineInput> lines = java.util.Collections.nCopies(
                    20, new GstCalculator.MrpLineInput(bd("33.33"), 1, BigDecimal.ZERO, bd("18")));

            var totals = GstCalculator.calcInvoiceTotals(lines, true);

            // 33.33 x 20 = 666.60 inclusive; every paisa must be accounted for.
            assertThat(totals.subtotal()).isEqualByComparingTo(bd("666.60"));
            assertThat(totals.taxableAmount().add(totals.igst()))
                    .as("aggregate taxable + IGST must reconcile to the inclusive subtotal")
                    .isEqualByComparingTo(bd("666.60"));
        }

        @Test
        @DisplayName("mixed GST slabs on one invoice are aggregated per slab, not averaged")
        void mixedSlabs() {
            var totals = GstCalculator.calcInvoiceTotals(List.of(
                    new GstCalculator.MrpLineInput(bd("100"), 1, BigDecimal.ZERO, bd("5")),
                    new GstCalculator.MrpLineInput(bd("100"), 1, BigDecimal.ZERO, bd("12")),
                    new GstCalculator.MrpLineInput(bd("100"), 1, BigDecimal.ZERO, bd("18"))
            ), true);

            assertThat(totals.subtotal()).isEqualByComparingTo(bd("300.00"));
            assertThat(totals.taxableAmount().add(totals.igst())).isEqualByComparingTo(bd("300.00"));
        }

        @Test
        @DisplayName("an empty invoice totals to zero rather than throwing")
        void emptyInvoice() {
            var totals = GstCalculator.calcInvoiceTotals(List.of(), false);

            assertThat(totals.subtotal()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(totals.totalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("intra-state aggregate keeps CGST and SGST equal")
        void intraStateAggregateStaysBalanced() {
            var totals = GstCalculator.calcInvoiceTotals(List.of(
                    new GstCalculator.MrpLineInput(bd("77.77"), 3, bd("5"), bd("12")),
                    new GstCalculator.MrpLineInput(bd("12.50"), 7, BigDecimal.ZERO, bd("5"))
            ), false);

            assertThat(totals.cgst()).isEqualByComparingTo(totals.sgst());
            assertThat(totals.igst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(totals.totalGst()).isEqualByComparingTo(totals.cgst().add(totals.sgst()));
        }
    }

    @Nested
    @DisplayName("calcPurchaseLineGst — supplier side, where rates are GST-exclusive")
    class PurchaseSide {

        @Test
        @DisplayName("adds tax on top of cost rather than extracting it from the price")
        void addsTaxOnTop() {
            var result = GstCalculator.calcPurchaseLineGst(bd("100"), 10, BigDecimal.ZERO, bd("18"));

            assertThat(result.lineTotal()).isEqualByComparingTo(bd("1000.00"));
            assertThat(result.totalGst()).isEqualByComparingTo(bd("180.00"));
            assertThat(result.amount()).isEqualByComparingTo(bd("1180.00"));
        }

        /**
         * Guards the warning in {@link GstCalculator}'s javadoc. If someone ever routes
         * purchases through the billing calculation, purchase tax silently halves —
         * this pins the two apart with a case where the difference is unmistakable.
         */
        @Test
        @DisplayName("purchase-side tax is NOT the billing-side reverse calculation")
        void purchaseIsNotTheSameAsBilling() {
            var purchase = GstCalculator.calcPurchaseLineGst(bd("100"), 1, BigDecimal.ZERO, bd("18"));
            var billing = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), false);

            assertThat(purchase.amount()).isEqualByComparingTo(bd("118.00"));
            assertThat(billing.amount()).isEqualByComparingTo(bd("100.00"));
        }

        @Test
        @DisplayName("an out-of-state supplier is charged IGST, not CGST + SGST")
        void interstatePurchaseChargesIgst() {
            // The defect this pins: purchases had no inter-state branch at all, so a pharmacy
            // buying across a state line booked the whole tax as half CGST and half SGST. The
            // GRN still added up — only the tax head was wrong — and GSTR-3B Table 4(A)(5)
            // claims input credit under heads that were never paid.
            var result = GstCalculator.calcPurchaseLineGst(bd("100"), 10, BigDecimal.ZERO, bd("18"), true);

            assertThat(result.igst()).isEqualByComparingTo(bd("180.00"));
            assertThat(result.cgst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.sgst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.totalGst()).isEqualByComparingTo(bd("180.00"));
            assertThat(result.amount()).isEqualByComparingTo(bd("1180.00"));
        }

        @Test
        @DisplayName("a local supplier is still CGST + SGST, and the default stays local")
        void intrastatePurchaseSplitsEvenly() {
            var explicit = GstCalculator.calcPurchaseLineGst(bd("100"), 10, BigDecimal.ZERO, bd("18"), false);
            var byDefault = GstCalculator.calcPurchaseLineGst(bd("100"), 10, BigDecimal.ZERO, bd("18"));

            assertThat(explicit.cgst()).isEqualByComparingTo(bd("90.00"));
            assertThat(explicit.sgst()).isEqualByComparingTo(bd("90.00"));
            assertThat(explicit.igst()).isEqualByComparingTo(BigDecimal.ZERO);
            // The four-argument overload must keep behaving exactly as it did, or every caller
            // that has no supplier state to work from silently changes tax head.
            assertThat(byDefault.cgst()).isEqualByComparingTo(explicit.cgst());
            assertThat(byDefault.sgst()).isEqualByComparingTo(explicit.sgst());
            assertThat(byDefault.igst()).isEqualByComparingTo(BigDecimal.ZERO);
        }

        @Test
        @DisplayName("the head changes and the total moves by at most a paisa")
        void headChangesAndTotalBarelyMoves() {
            // Why the defect survived: to anyone looking at a GRN the amount payable is the
            // same. It is not bit-identical though, and the difference is deliberate — the
            // intra-state branch must round a HALF and double it, because CGST has to equal
            // SGST to the paisa, while IGST is a single levy rounded once. 249.38 at 12%
            // gives 14.96 x 2 = 29.92 one way and 29.93 the other.
            var local = GstCalculator.calcPurchaseLineGst(bd("37.50"), 7, bd("5"), bd("12"), false);
            var distant = GstCalculator.calcPurchaseLineGst(bd("37.50"), 7, bd("5"), bd("12"), true);

            assertThat(distant.lineTotal()).isEqualByComparingTo(local.lineTotal());
            assertThat(distant.igst()).isEqualByComparingTo(bd("29.93"));
            assertThat(local.cgst().add(local.sgst())).isEqualByComparingTo(bd("29.92"));
            assertThat(distant.totalGst().subtract(local.totalGst()).abs())
                    .as("the two roundings may differ by a paisa, never more")
                    .isLessThanOrEqualTo(bd("0.01"));
        }

        @Test
        @DisplayName("IGST is rounded once, so the line total never drifts by a paisa")
        void igstRoundsOnce() {
            // Rounding a half and doubling it quantises to even paise. The intra-state branch
            // has to accept that (CGST must equal SGST); the inter-state one must not, because
            // there is no halving constraint to satisfy.
            var result = GstCalculator.calcPurchaseLineGst(bd("33.33"), 3, BigDecimal.ZERO, bd("5"), true);

            assertThat(result.lineTotal()).isEqualByComparingTo(bd("99.99"));
            assertThat(result.igst()).isEqualByComparingTo(bd("5.00"));
            assertThat(result.lineTotal().add(result.igst())).isEqualByComparingTo(result.amount());
        }

        @Test
        @DisplayName("supplier discount reduces the taxable base before tax is added")
        void discountReducesTaxableBase() {
            var result = GstCalculator.calcPurchaseLineGst(bd("200"), 5, bd("10"), bd("12"));

            // 200 x 5 = 1000, less 10% = 900, +12% = 1008
            assertThat(result.lineTotal()).isEqualByComparingTo(bd("900.00"));
            assertThat(result.amount()).isEqualByComparingTo(bd("1008.00"));
        }
    }

    @Nested
    class Rounding {

        @ParameterizedTest(name = "round2({0}) = {1}")
        @CsvSource({"1.005, 1.01", "1.004, 1.00", "2.675, 2.68", "0.005, 0.01", "-1.005, -1.01"})
        @DisplayName("rounds half away from zero, not banker's rounding")
        void roundsHalfUp(String input, String expected) {
            assertThat(GstCalculator.round2(bd(input))).isEqualByComparingTo(bd(expected));
        }
    }
    @Nested
    @DisplayName("bill-level discount (s.15(3) CGST Act)")
    class BillDiscount {

        private final List<GstCalculator.MrpLineInput> oneLine =
                List.of(new GstCalculator.MrpLineInput(new BigDecimal("1000"), 1, BigDecimal.ZERO, new BigDecimal("12")));

        @Test
        @DisplayName("reduces the taxable value and the tax, not just the total")
        void reducesTaxableValue() {
            var full = GstCalculator.calcInvoiceTotals(oneLine, false);
            var discounted = GstCalculator.calcInvoiceTotals(oneLine, false, new BigDecimal("10"));

            // Deducting the discount after the tax left these identical, so the pharmacy
            // remitted GST on Rs.100 it never collected.
            assertThat(discounted.taxableAmount()).isLessThan(full.taxableAmount());
            assertThat(discounted.totalGst()).isLessThan(full.totalGst());
        }

        @Test
        @DisplayName("the invoice total is the discounted price the customer pays")
        void invoiceTotalIsThePricePaid() {
            // 1000 less 10% = 900.00, GST-inclusive.
            var t = GstCalculator.calcInvoiceTotals(oneLine, false, new BigDecimal("10"));
            assertThat(t.totalAmount()).isEqualByComparingTo(new BigDecimal("900.00"));
            // taxable + tax lands within a paisa of it — the equal CGST/SGST split, see
            // FromMrp#intraStateTaxSplitMayNotSumExactlyToTheLineTotal.
            assertThat(t.taxableAmount().add(t.totalGst()))
                    .isCloseTo(new BigDecimal("900.00"), org.assertj.core.data.Offset.offset(new BigDecimal("0.01")));
        }

        @Test
        @DisplayName("the line and the invoice agree on the same discount")
        void lineMatchesInvoice() {
            // The HSN summary sums the stored LINES; the GST summary reads the header.
            // If these drifted, the two compliance reports would contradict each other.
            var line = GstCalculator.calcGstFromMrp(new BigDecimal("1000"), 1, BigDecimal.ZERO,
                    new BigDecimal("12"), false, new BigDecimal("10"));
            var invoice = GstCalculator.calcInvoiceTotals(oneLine, false, new BigDecimal("10"));

            assertThat(line.taxableAmount()).isEqualByComparingTo(invoice.taxableAmount());
            assertThat(line.totalGst()).isEqualByComparingTo(invoice.totalGst());
        }

        @Test
        @DisplayName("compounds with a line discount rather than adding to it")
        void compoundsWithLineDiscount() {
            var withBoth = GstCalculator.calcInvoiceTotals(
                    List.of(new GstCalculator.MrpLineInput(new BigDecimal("1000"), 1, new BigDecimal("10"), new BigDecimal("12"))),
                    false, new BigDecimal("5"));
            var addedTogether = GstCalculator.calcInvoiceTotals(
                    List.of(new GstCalculator.MrpLineInput(new BigDecimal("1000"), 1, new BigDecimal("15"), new BigDecimal("12"))),
                    false, BigDecimal.ZERO);

            // 0.90 x 0.95 = 0.855, not 1 - 0.15. "5% off this bill" means off what is left.
            assertThat(withBoth.totalAmount()).isGreaterThan(addedTogether.totalAmount());
            assertThat(withBoth.discountAmount()).isEqualByComparingTo(new BigDecimal("145.00"));
        }

        @Test
        @DisplayName("zero and absent are the same calculation")
        void zeroMatchesAbsent() {
            assertThat(GstCalculator.calcInvoiceTotals(oneLine, false, BigDecimal.ZERO))
                    .isEqualTo(GstCalculator.calcInvoiceTotals(oneLine, false));
        }

        @Test
        @DisplayName("a null percentage is treated as no discount, never as an error")
        void nullIsNoDiscount() {
            assertThat(GstCalculator.calcInvoiceTotals(oneLine, false, null))
                    .isEqualTo(GstCalculator.calcInvoiceTotals(oneLine, false));
        }

        @Test
        @DisplayName("100% zeroes the tax as well as the total")
        void hundredPercentZeroesTax() {
            var t = GstCalculator.calcInvoiceTotals(oneLine, false, new BigDecimal("100"));
            assertThat(t.totalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(t.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(t.taxableAmount()).isEqualByComparingTo(BigDecimal.ZERO);
        }
    }

    @Nested
    @DisplayName("loose (cut-strip) dispensing — per-piece price out of a pack MRP")
    class Loose {

        @Test
        @DisplayName("perPieceMrp is 2dp, rounded DOWN — the exact figure charged and printed")
        void perPieceMrpIsTwoDpRoundedDown() {
            // 33.50 / 15 = 2.2333... -> 2.23. The per-piece price is what the customer is
            // charged and what prints on the bill, so tax is reverse-calculated from THIS
            // figure and "qty x rate" reconciles with the line amount.
            assertThat(GstCalculator.perPieceMrp(bd("33.50"), 15)).isEqualByComparingTo(bd("2.23"));
            // Rounds DOWN, never up: 137 / 15 = 9.1333 -> 9.13, and 9.13 x 15 = 136.95 <= 137,
            // so a cut tablet can never cost more per unit than its pro-rata printed MRP.
            assertThat(GstCalculator.perPieceMrp(bd("137.00"), 15)).isEqualByComparingTo(bd("9.13"));
            assertThat(GstCalculator.perPieceMrp(bd("137.00"), 15).multiply(bd("15")))
                    .isLessThanOrEqualTo(bd("137.00"));
            // Clean divisions are unchanged.
            assertThat(GstCalculator.perPieceMrp(bd("45.00"), 15)).isEqualByComparingTo(bd("3.00"));
            assertThat(GstCalculator.perPieceMrp(bd("90.00"), 10)).isEqualByComparingTo(bd("9.00"));
        }

        @Test
        @DisplayName("perPieceMrp refuses a missing MRP or an unset pack multiple, with a readable message")
        void perPieceMrpRejectsBadInput() {
            assertThatThrownBy(() -> GstCalculator.perPieceMrp(null, 10))
                    .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("no MRP");
            assertThatThrownBy(() -> GstCalculator.perPieceMrp(BigDecimal.ZERO, 10))
                    .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("no MRP");
            assertThatThrownBy(() -> GstCalculator.perPieceMrp(bd("10"), 1))
                    .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("units-per-pack");
        }

        @Test
        @DisplayName("selling a whole pack loose, piece by piece, equals selling it as one pack")
        void looseWholePackEqualsPackSale() {
            // A strip of 10 at MRP 90, 12% GST. 10 loose pieces must tax identically to 1 pack.
            var asPack = GstCalculator.calcGstFromMrp(bd("90"), 1, BigDecimal.ZERO, bd("12"), false);
            var asLoose = GstCalculator.calcLooseGstFromMrp(bd("90"), 10, 10, BigDecimal.ZERO, bd("12"),
                    false, BigDecimal.ZERO);

            assertThat(asLoose.taxableAmount()).isEqualByComparingTo(asPack.taxableAmount());
            assertThat(asLoose.cgst()).isEqualByComparingTo(asPack.cgst());
            assertThat(asLoose.sgst()).isEqualByComparingTo(asPack.sgst());
            assertThat(asLoose.amount()).isEqualByComparingTo(asPack.amount());
        }

        @Test
        @DisplayName("a partial cut-strip is MRP-inclusive on the pieces actually sold")
        void partialCutStrip() {
            // 8 tablets from a strip of 15 @ MRP 45, 5% GST, intra-state.
            // per-piece MRP = 3.00 exactly; line = 24.00 inclusive; taxable = 24 / 1.05.
            var loose = GstCalculator.calcLooseGstFromMrp(bd("45"), 15, 8, BigDecimal.ZERO, bd("5"),
                    false, BigDecimal.ZERO);

            assertThat(loose.taxableAmount().add(loose.totalGst())).isEqualByComparingTo(bd("24.00"));
            assertThat(loose.cgst()).isEqualByComparingTo(loose.sgst());
        }

        @Test
        @DisplayName("MrpLineInput.effectiveUnitMrp: pack line unchanged, loose line divided")
        void effectiveUnitMrpResolves() {
            var pack = new GstCalculator.MrpLineInput(bd("90"), 2, BigDecimal.ZERO, bd("12"));
            var loose = new GstCalculator.MrpLineInput(bd("90"), 5, BigDecimal.ZERO, bd("12"), 10, true);

            assertThat(pack.effectiveUnitMrp()).isEqualByComparingTo(bd("90"));
            assertThat(loose.effectiveUnitMrp()).isEqualByComparingTo(bd("9"));
        }

        @Test
        @DisplayName("calcInvoiceTotals: header still equals the sum of the lines with a loose line in the mix")
        void invoiceTotalsWithLooseLine() {
            List<GstCalculator.MrpLineInput> lines = List.of(
                    new GstCalculator.MrpLineInput(bd("120.00"), 1, BigDecimal.ZERO, bd("12")),         // pack
                    new GstCalculator.MrpLineInput(bd("45.00"), 8, BigDecimal.ZERO, bd("5"), 15, true), // 8 loose
                    new GstCalculator.MrpLineInput(bd("30.00"), 2, bd("10"), bd("18")));                // pack, discounted

            for (boolean interstate : new boolean[] {true, false}) {
                var totals = GstCalculator.calcInvoiceTotals(lines, interstate);

                BigDecimal taxable = BigDecimal.ZERO;
                BigDecimal gst = BigDecimal.ZERO;
                for (var line : lines) {
                    var l = GstCalculator.calcGstFromMrp(line.effectiveUnitMrp(), line.quantity(),
                            line.discountPct(), line.gstRate(), interstate, BigDecimal.ZERO);
                    taxable = taxable.add(l.taxableAmount());
                    gst = gst.add(l.totalGst());
                }
                assertThat(totals.taxableAmount()).as("taxable, interstate=" + interstate)
                        .isEqualByComparingTo(taxable);
                assertThat(totals.totalGst()).as("gst, interstate=" + interstate).isEqualByComparingTo(gst);
                assertThat(totals.taxableAmount().add(totals.totalGst()))
                        .isEqualByComparingTo(totals.totalAmount());
            }
        }
    }

}
