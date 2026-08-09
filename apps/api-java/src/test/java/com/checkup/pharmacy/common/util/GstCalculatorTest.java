package com.checkup.pharmacy.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

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
         * Documents a deliberate, legally-motivated inaccuracy rather than a defect.
         *
         * <p>GST requires CGST and SGST to be equal, and each is stored to 2dp. When
         * the total tax is an odd number of paise the half cannot be represented, so
         * the split rounds up on both sides and the invoice total lands a paisa above
         * the MRP. The alternative — an unequal 7.63/7.62 split — reconciles to the
         * rupee but is not a valid CGST/SGST pair.
         *
         * <p>If this test ever fails, someone has "fixed" the paisa and broken the
         * equal-split requirement. Read this comment before changing it.
         */
        @Test
        @DisplayName("intra-state may land one paisa above MRP, because CGST must equal SGST")
        void intraStateMayDifferByOnePaisaBecauseCgstMustEqualSgst() {
            var result = GstCalculator.calcGstFromMrp(bd("100"), 1, BigDecimal.ZERO, bd("18"), false);

            assertThat(result.cgst()).isEqualByComparingTo(bd("7.63"));
            assertThat(result.sgst()).isEqualByComparingTo(bd("7.63"));
            assertThat(result.amount()).isEqualByComparingTo(bd("100.01"));
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
            assertThat(billing.amount()).isEqualByComparingTo(bd("100.01"));
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
        @DisplayName("leaves the invoice adding up: taxable + GST == total")
        void invoiceReconciles() {
            var t = GstCalculator.calcInvoiceTotals(oneLine, false, new BigDecimal("10"));
            assertThat(t.taxableAmount().add(t.totalGst())).isEqualByComparingTo(t.totalAmount());
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

}
