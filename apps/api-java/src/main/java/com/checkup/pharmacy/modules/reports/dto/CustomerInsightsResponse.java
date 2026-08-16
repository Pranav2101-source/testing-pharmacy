package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Who is buying, who is new, and who has stopped coming.
 *
 * <p>The one report on this screen whose output is a list of people to ring rather than a
 * number to read. It is also the only sales analytic that works across the migrated
 * history, because it reads invoice HEADERS — the line items the previous system never
 * exported are what blank out every medicine-level panel, and none of them are needed here.
 *
 * @param customersBilled distinct identified customers who bought in the period
 * @param newCustomers    of those, the ones whose first ever bill falls in the period
 * @param returningCustomers the remainder — customers who had bought before
 * @param repeatRatePct   returning customers as a share of those billed
 * @param walkIns         bills with no customer attached, declared rather than absorbed
 * @param topCustomers    biggest spenders in the period
 */
public record CustomerInsightsResponse(long customersBilled, long newCustomers, long returningCustomers,
                                       BigDecimal repeatRatePct, BigDecimal identifiedRevenue,
                                       WalkIns walkIns, List<Customer> topCustomers) {

    /**
     * Bills raised with no customer record behind them.
     *
     * <p>Every figure above counts identified customers only, so a pharmacy where most sales
     * are anonymous would otherwise read as having almost no customers at all. Reporting the
     * share makes the denominator visible instead of leaving it to be inferred.
     *
     * @param sharePct walk-in bills as a percentage of all bills in the period
     */
    public record WalkIns(long bills, BigDecimal sharePct) {
    }

    /**
     * @param bills      bills in the window the list was built for
     * @param revenue    what they paid across those bills
     * @param lastVisit  their most recent bill in that window
     */
    public record Customer(String customerId, String name, String phone, long bills,
                           BigDecimal revenue, Instant lastVisit) {
    }
}
