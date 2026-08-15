package com.checkup.pharmacy.common.tax;

import java.math.BigDecimal;

/**
 * The shape shared by every "split this period into its taxable and nil-rated halves" query.
 *
 * <p>GSTR-3B asks the same question of three different document types — sales, credit notes and
 * goods receipts — and each answer is at most two rows: one for the lines that carried tax and
 * one for the lines that did not. This interface exists so a single fold can consume all three
 * rather than three near-identical copies drifting apart.
 *
 * <p>It lives in {@code common} rather than in the reports module because the projections that
 * extend it belong to billing and purchase; pointing those at a reports-owned type would invert
 * the dependency between a module and the thing that reads it.
 */
public interface TaxabilitySplitRow {

    /** true for lines that carried GST, false for nil-rated and exempt ones. */
    Boolean getTaxable();

    BigDecimal getTaxableValue();

    BigDecimal getIgst();

    BigDecimal getCgst();

    BigDecimal getSgst();
}
