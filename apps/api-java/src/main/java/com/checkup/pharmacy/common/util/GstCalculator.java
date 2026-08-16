package com.checkup.pharmacy.common.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * GST line-item math. Purchase-side (PO/GRN/supplier returns) rates are
 * GST-exclusive — tax is added on top of the supplier's cost price. Billing-side
 * (invoices/sales returns) MRP is GST-inclusive by Indian retail convention — tax
 * is reverse-calculated out of the printed price. Never use one calculation for
 * the other's document type.
 */
public final class GstCalculator {

    private GstCalculator() {
    }

    public record PurchaseLineGst(BigDecimal lineTotal, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                   BigDecimal totalGst, BigDecimal amount) {
    }

    /** Intra-state purchase — CGST + SGST. Kept for callers with no supplier state to work from. */
    public static PurchaseLineGst calcPurchaseLineGst(BigDecimal rate, int quantity, BigDecimal discountPct, BigDecimal gstRate) {
        return calcPurchaseLineGst(rate, quantity, discountPct, gstRate, false);
    }

    /**
     * Purchase-side GST, split by where the supplier is.
     *
     * <p>WHY THE SPLIT EXISTS
     *
     * <p>This used to compute CGST + SGST unconditionally, with no inter-state branch and no
     * {@code igst} field to put the answer in. A pharmacy in Tamil Nadu buying from a
     * Maharashtra distributor pays IGST, and the whole amount was being booked as half CGST
     * and half SGST.
     *
     * <p>The invoice still added up, which is why it went unnoticed: the tax total was right
     * and only its classification was wrong. GSTR-3B is where that surfaces — Table 4(A)(5)
     * has separate IGST, CGST and SGST columns for input tax credit, so the credit was being
     * claimed under two heads that were never paid while the head that was paid showed
     * nothing. The sales side has always got this right (see
     * {@link #calcGstFromMrp(BigDecimal, int, BigDecimal, BigDecimal, boolean)}); only
     * purchases were missing it.
     *
     * @param rate        per-unit purchase rate
     * @param quantity    line quantity
     * @param discountPct percentage 0-100, pass ZERO for purchase orders with no discount
     * @param gstRate     percentage (0/5/12/18)
     * @param isInterstate supplier's state differs from the pharmacy's — charge IGST
     */
    public static PurchaseLineGst calcPurchaseLineGst(BigDecimal rate, int quantity, BigDecimal discountPct,
                                                      BigDecimal gstRate, boolean isInterstate) {
        BigDecimal gross = rate.multiply(BigDecimal.valueOf(quantity));
        BigDecimal discountFactor = BigDecimal.ONE.subtract(divide(discountPct, BigDecimal.valueOf(100)));
        BigDecimal lineTotal = round2(gross.multiply(discountFactor));

        if (isInterstate) {
            // Rounded ONCE, for the same reason as the sales side: IGST is a single levy with
            // no equal-halves constraint, so going via a half value would quantise it to even
            // paise and drift the line total by a paisa either way.
            BigDecimal igst = round2(divide(lineTotal.multiply(gstRate), BigDecimal.valueOf(100)));
            return new PurchaseLineGst(lineTotal, BigDecimal.ZERO, BigDecimal.ZERO, igst, igst,
                    round2(lineTotal.add(igst)));
        }

        BigDecimal halfGst = round2(divide(lineTotal.multiply(gstRate), BigDecimal.valueOf(200)));
        BigDecimal totalGst = halfGst.multiply(BigDecimal.valueOf(2));
        return new PurchaseLineGst(lineTotal, halfGst, halfGst, BigDecimal.ZERO, totalGst,
                round2(lineTotal.add(totalGst)));
    }

    /** One line item's MRP, quantity, discount %, and GST rate — the shared input shape for billing GST math. */
    public record MrpLineInput(BigDecimal mrp, int quantity, BigDecimal discountPct, BigDecimal gstRate) {
    }

    public record MrpGstBreakdown(BigDecimal taxableAmount, BigDecimal cgst, BigDecimal sgst,
                                   BigDecimal igst, BigDecimal totalGst, BigDecimal amount) {
    }

    public record InvoiceTotals(BigDecimal subtotal, BigDecimal discountAmount, BigDecimal taxableAmount,
                                 BigDecimal cgst, BigDecimal sgst, BigDecimal igst, BigDecimal totalGst,
                                 BigDecimal totalAmount) {
    }

    /**
     * Reverse-calculates GST out of a GST-inclusive MRP for one invoice/return
     * line. Intra-state splits evenly into CGST+SGST; inter-state charges the
     * full rate as IGST.
     */
    public static MrpGstBreakdown calcGstFromMrp(BigDecimal mrp, int quantity, BigDecimal discountPct,
                                                  BigDecimal gstRate, boolean isInterstate) {
        return calcGstFromMrp(mrp, quantity, discountPct, gstRate, isInterstate, BigDecimal.ZERO);
    }

    /**
     * As above, with a bill-level discount folded into the line before tax is derived.
     *
     * <p>WHY THE BILL DISCOUNT BELONGS HERE AND NOT AFTER THE TAX
     *
     * <p>Section 15(3) of the CGST Act excludes a discount from the value of a supply
     * when it is given at or before the time of supply and is recorded in the invoice.
     * A bill-level discount is exactly that, so the taxable value — and therefore the
     * tax — is computed on what the customer actually pays.
     *
     * <p>Deducting it after the tax, as this used to, charged GST on money the pharmacy
     * never collected: the pharmacy remitted the difference out of its own margin, and
     * the invoice itself did not add up, because {@code taxableAmount + totalGst} was a
     * figure from before the discount while {@code totalAmount} was from after it.
     *
     * <p>Applied to the line rather than the header so the stored per-line figures stay
     * consistent with the invoice they belong to — the GSTR-1 HSN summary is built by
     * summing those lines, and it has to reconcile with the return it feeds.
     *
     * <p>Compounds with any line discount rather than adding to it: 10% off a line and
     * then 5% off the bill is 0.90 × 0.95, not 15%. That is what "5% off this bill"
     * means to the person reading it.
     */
    public static MrpGstBreakdown calcGstFromMrp(BigDecimal mrp, int quantity, BigDecimal discountPct,
                                                  BigDecimal gstRate, boolean isInterstate,
                                                  BigDecimal billDiscountPct) {
        BigDecimal lineTotal = mrp.multiply(BigDecimal.valueOf(quantity));
        BigDecimal discountAmount = divide(lineTotal.multiply(discountPct), BigDecimal.valueOf(100));
        BigDecimal afterDiscount = lineTotal.subtract(discountAmount).multiply(billDiscountFactor(billDiscountPct));
        BigDecimal divisor = BigDecimal.ONE.add(divide(gstRate, BigDecimal.valueOf(100)));
        BigDecimal taxableAmount = afterDiscount.divide(divisor, 10, RoundingMode.HALF_UP);
        BigDecimal totalGstUnrounded = afterDiscount.subtract(taxableAmount);

        BigDecimal roundedTaxable = round2(taxableAmount);

        if (isInterstate) {
            // Round the tax ONCE. IGST is a single levy, so there is no equal-halves
            // constraint to satisfy and no reason to go via a half value.
            //
            // Rounding a half and doubling it (as the intra-state branch must) would
            // quantise IGST to even paise only, pushing the billed total off the MRP
            // by a paisa in either direction — Rs.100 @ 18% became Rs.100.01, and
            // Rs.450 @ 5% became Rs.449.99. That error is invisible per line and does
            // not cancel out across an invoice, so it accumulates in GSTR-1.
            BigDecimal igst = round2(totalGstUnrounded);
            return new MrpGstBreakdown(roundedTaxable, BigDecimal.ZERO, BigDecimal.ZERO, igst, igst,
                    roundedTaxable.add(igst));
        }

        // Intra-state: CGST and SGST must be equal and each stored to 2dp, so the
        // half is what gets rounded and the total may legitimately land a paisa above
        // the MRP. See GstCalculatorTest#intraStateMayDifferByOnePaisaBecauseCgstMustEqualSgst.
        BigDecimal halfGst = round2(divide(totalGstUnrounded, BigDecimal.valueOf(2)));
        BigDecimal totalGst = halfGst.multiply(BigDecimal.valueOf(2));
        return new MrpGstBreakdown(roundedTaxable, halfGst, halfGst, BigDecimal.ZERO, totalGst,
                roundedTaxable.add(totalGst));
    }

    /**
     * Invoice-level aggregate totals: the sum of the invoice's own lines, exactly.
     *
     * <p>WHY THIS SUMS ROUNDED LINES RATHER THAN ACCUMULATING RAW
     *
     * <p>This used to accumulate taxable value and tax <b>unrounded</b> and round once at the
     * end, on the reasoning that summing already-rounded per-line values compounds rounding
     * error. That reasoning is sound in isolation and wrong for a tax invoice, because it
     * guarantees the one thing an invoice may not do: the header stopped equalling the sum of
     * the lines printed underneath it.
     *
     * <p>The two are not interchangeable views of the same number — they are read by different
     * things, and both are filed. The GST summary reads the invoice header; the GSTR-1 HSN
     * summary (Table 12) sums the stored LINES. A three-line bill at mixed slabs reported a
     * taxable value of 269.27 in one place and 269.28 in the other, and nobody could say which
     * was right because both were, under their own rule. Anyone adding up a printed invoice
     * hits the same discrepancy.
     *
     * <p>What was traded away is bounded and small: half a paisa per line, in a figure that is
     * itself a sum of 2dp values. What was bought is that the invoice, the GST summary and the
     * HSN summary agree by construction rather than by coincidence — which is what makes the
     * return reconcile.
     *
     * <p>{@code subtotal} and {@code discountAmount} are still accumulated raw and rounded
     * once, because neither is split across the line/header boundary: no report sums them
     * per line, so there is nothing for them to disagree with.
     */
    public static InvoiceTotals calcInvoiceTotals(List<MrpLineInput> items, boolean isInterstate) {
        return calcInvoiceTotals(items, isInterstate, BigDecimal.ZERO);
    }

    /**
     * As above, with a bill-level discount applied to every line before tax is derived.
     *
     * <p>See {@link #calcGstFromMrp(BigDecimal, int, BigDecimal, BigDecimal, boolean, BigDecimal)}
     * for why the discount reduces the taxable value rather than being deducted from
     * the total afterwards. {@code discountAmount} reports line and bill discounts
     * together, which is the single "Discount" figure a customer expects to read.
     */
    public static InvoiceTotals calcInvoiceTotals(List<MrpLineInput> items, boolean isInterstate,
                                                   BigDecimal billDiscountPct) {
        BigDecimal billFactor = billDiscountFactor(billDiscountPct);
        BigDecimal subtotal = BigDecimal.ZERO;
        BigDecimal discountAmount = BigDecimal.ZERO;
        BigDecimal taxableAmount = BigDecimal.ZERO;
        BigDecimal cgst = BigDecimal.ZERO;
        BigDecimal sgst = BigDecimal.ZERO;
        BigDecimal igst = BigDecimal.ZERO;

        for (MrpLineInput item : items) {
            // The SAME call the caller makes per line when it builds the stored line items,
            // so the header cannot drift from them. Anything else here — however carefully
            // reasoned — reintroduces the two-sources-of-truth problem this method had.
            MrpGstBreakdown line = calcGstFromMrp(item.mrp(), item.quantity(), item.discountPct(),
                    item.gstRate(), isInterstate, billDiscountPct);

            BigDecimal lineTotal = item.mrp().multiply(BigDecimal.valueOf(item.quantity()));
            BigDecimal lineDiscount = divide(lineTotal.multiply(item.discountPct()), BigDecimal.valueOf(100));
            BigDecimal afterLineDiscount = lineTotal.subtract(lineDiscount);
            // What the bill discount took off THIS line, so the invoice's single
            // "Discount" figure covers both kinds.
            BigDecimal billDiscount = afterLineDiscount.subtract(afterLineDiscount.multiply(billFactor));

            subtotal = subtotal.add(lineTotal);
            discountAmount = discountAmount.add(lineDiscount).add(billDiscount);
            taxableAmount = taxableAmount.add(line.taxableAmount());
            cgst = cgst.add(line.cgst());
            sgst = sgst.add(line.sgst());
            igst = igst.add(line.igst());
        }

        // Already a sum of 2dp values — round2 here only normalises the scale.
        BigDecimal roundedTaxable = round2(taxableAmount);
        // CGST and SGST stay equal because every line's pair is equal, so summing preserves
        // it. That invariant used to be enforced at the end by halving the total; it now
        // holds line by line, which is where GST actually requires it.
        BigDecimal totalGst = cgst.add(sgst).add(igst);

        return new InvoiceTotals(round2(subtotal), round2(discountAmount), roundedTaxable,
                round2(cgst), round2(sgst), round2(igst), round2(totalGst),
                roundedTaxable.add(totalGst));
    }

    /**
     * The multiplier a bill-level discount applies to each line, e.g. 5% -> 0.95.
     *
     * <p>Null and out-of-range values collapse to "no discount" rather than throwing:
     * this is arithmetic on a document that is already being issued, and the request
     * DTO bounds the percentage to 0-100 before it ever reaches here.
     */
    private static BigDecimal billDiscountFactor(BigDecimal billDiscountPct) {
        if (billDiscountPct == null || billDiscountPct.signum() <= 0) {
            return BigDecimal.ONE;
        }
        BigDecimal capped = billDiscountPct.min(BigDecimal.valueOf(100));
        return BigDecimal.ONE.subtract(divide(capped, BigDecimal.valueOf(100)));
    }

    public static BigDecimal round2(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal divide(BigDecimal numerator, BigDecimal denominator) {
        return numerator.divide(denominator, 10, RoundingMode.HALF_UP);
    }
}
