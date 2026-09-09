package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * How the period's takings split across payment channels — cash vs UPI vs card.
 *
 * <p>An owner reads this for two things: how much of the day is cash that has to be
 * banked and reconciled against a drawer, and whether the shop is drifting toward
 * digital (which changes what a cash-flow gap looks like).
 */
public record PaymentMixResponse(BigDecimal total, long bills, List<Slice> slices) {

    public record Slice(String mode, BigDecimal amount, long bills, BigDecimal sharePct) {
    }
}
