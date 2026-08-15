package com.checkup.pharmacy.modules.reports.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Customers who bought regularly and have stopped — a call list, ordered by what the
 * silence is worth.
 *
 * <p>For a pharmacy these are mostly chronic patients on repeat medication who quietly
 * moved to another shop. Nothing else on this screen surfaces them: they do not appear in
 * sales (they made none), they are not overdue (they owe nothing), and the revenue chart
 * absorbs their absence into a number that merely looks slightly lower than last month.
 *
 * @param inactiveDays  how long a customer must have been silent to appear
 * @param minVisits     how many past bills qualify someone as a regular rather than a passer-by
 * @param valueAtRisk   the lifetime value of everyone on the list, added up
 */
public record LapsedCustomersResponse(int inactiveDays, int minVisits, BigDecimal valueAtRisk,
                                      List<Item> items) {

    /**
     * @param lifetimeRevenue everything they have ever spent, not just a period's worth —
     *                        the figure that decides whether the call is worth making
     * @param daysSinceLastVisit how long they have been gone, precomputed so the list can be
     *                        read without arithmetic
     */
    public record Item(String customerId, String name, String phone, long totalBills,
                       BigDecimal lifetimeRevenue, Instant lastVisit, long daysSinceLastVisit) {
    }
}
