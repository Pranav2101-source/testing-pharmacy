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

    public record PurchaseLineGst(BigDecimal lineTotal, BigDecimal cgst, BigDecimal sgst,
                                   BigDecimal totalGst, BigDecimal amount) {
    }

    /**
     * @param rate       per-unit purchase rate
     * @param quantity   line quantity
     * @param discountPct percentage 0-100, pass ZERO for purchase orders with no discount
     * @param gstRate    percentage (0/5/12/18)
     */
    public static PurchaseLineGst calcPurchaseLineGst(BigDecimal rate, int quantity, BigDecimal discountPct, BigDecimal gstRate) {
        BigDecimal gross = rate.multiply(BigDecimal.valueOf(quantity));
        BigDecimal discountFactor = BigDecimal.ONE.subtract(divide(discountPct, BigDecimal.valueOf(100)));
        BigDecimal lineTotal = round2(gross.multiply(discountFactor));
        BigDecimal halfGst = round2(divide(lineTotal.multiply(gstRate), BigDecimal.valueOf(200)));
        BigDecimal totalGst = halfGst.multiply(BigDecimal.valueOf(2));
        BigDecimal amount = round2(lineTotal.add(totalGst));
        return new PurchaseLineGst(lineTotal, halfGst, halfGst, totalGst, amount);
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
     * Invoice-level aggregate totals. Deliberately re-derives taxable/GST from
     * raw (mrp, quantity, discount, gstRate) per line and accumulates
     * <b>unrounded</b>, rounding only once at the end — summing already-rounded
     * per-line values (from {@link #calcGstFromMrp}) would compound rounding
     * error across many line items and drift from the true invoice total.
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
        // Accumulate the FULL tax, not the half. Halving is a presentation concern of
        // the intra-state split and is applied once at the end; folding it into the
        // accumulator imposed even-paise quantisation on inter-state invoices too.
        BigDecimal gstTotal = BigDecimal.ZERO;

        for (MrpLineInput item : items) {
            BigDecimal lineTotal = item.mrp().multiply(BigDecimal.valueOf(item.quantity()));
            BigDecimal lineDiscount = divide(lineTotal.multiply(item.discountPct()), BigDecimal.valueOf(100));
            BigDecimal afterLineDiscount = lineTotal.subtract(lineDiscount);
            BigDecimal afterDiscount = afterLineDiscount.multiply(billFactor);
            // What the bill discount took off THIS line, so the invoice's single
            // "Discount" figure covers both kinds.
            BigDecimal billDiscount = afterLineDiscount.subtract(afterDiscount);
            BigDecimal divisor = BigDecimal.ONE.add(divide(item.gstRate(), BigDecimal.valueOf(100)));
            BigDecimal taxable = afterDiscount.divide(divisor, 10, RoundingMode.HALF_UP);
            BigDecimal gst = afterDiscount.subtract(taxable);

            subtotal = subtotal.add(lineTotal);
            discountAmount = discountAmount.add(lineDiscount).add(billDiscount);
            taxableAmount = taxableAmount.add(taxable);
            gstTotal = gstTotal.add(gst);
        }

        BigDecimal roundedTaxable = round2(taxableAmount);

        if (isInterstate) {
            BigDecimal igst = round2(gstTotal);
            return new InvoiceTotals(round2(subtotal), round2(discountAmount), roundedTaxable,
                    BigDecimal.ZERO, BigDecimal.ZERO, igst, igst, roundedTaxable.add(igst));
        }
        BigDecimal roundedHalf = round2(divide(gstTotal, BigDecimal.valueOf(2)));
        BigDecimal totalGst = roundedHalf.multiply(BigDecimal.valueOf(2));
        return new InvoiceTotals(round2(subtotal), round2(discountAmount), roundedTaxable,
                roundedHalf, roundedHalf, BigDecimal.ZERO, totalGst, roundedTaxable.add(totalGst));
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
