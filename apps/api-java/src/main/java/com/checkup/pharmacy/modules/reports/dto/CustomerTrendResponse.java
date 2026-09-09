package com.checkup.pharmacy.modules.reports.dto;

import java.util.List;

/**
 * Identified customers billed per IST month, split new vs returning — the Customers tab's
 * "is the customer base growing" chart.
 *
 * <p>One row per month across the window, months with no identified sales included as
 * explicit zeros. New vs returning is judged on the customer's entire history, not the
 * window: someone's first-ever bill in March makes them new in March and returning in
 * every later month.
 */
public record CustomerTrendResponse(List<Month> months) {

    /**
     * @param billed    distinct identified customers with at least one bill this month
     * @param newCount   of those, the ones whose first-ever bill is in this month
     * @param returning  billed − newCount
     */
    public record Month(String month, long billed, long newCount, long returning) {
    }
}
