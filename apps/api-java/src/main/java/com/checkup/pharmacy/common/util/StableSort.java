package com.checkup.pharmacy.common.util;

import org.springframework.data.domain.Sort;

/**
 * Appends the primary key to a sort so that LIMIT/OFFSET pagination is deterministic.
 *
 * <p>Postgres gives no guaranteed order to rows that tie on every ORDER BY column, and
 * it is free to order them differently between two executions of the same query. Under
 * LIMIT/OFFSET paging that means a tied row can be served on two consecutive pages while
 * another is never served at all — and nothing in the response tells the reader it
 * happened. Totals stay right, so the bug hides behind a correct-looking row count.
 *
 * <p>Ties are not a rare edge case in this app. A migration import writes hundreds of rows
 * inside a single transaction, so they share {@code createdAt} to the microsecond; the
 * catalogue lists sort by a {@code name} that carries no uniqueness constraint. A real
 * 601-batch import reproduced it on the first try: one batch appeared on two pages, a
 * different batch appeared on none.
 *
 * <p>Ids are cuids, so appending one always yields a total order. It never changes the
 * caller's intended ordering — it only decides what was previously undefined.
 */
public final class StableSort {

    private StableSort() {
    }

    /** The caller's ordering, with the primary key appended as a final tiebreaker. */
    public static Sort of(Sort sort) {
        return sort.and(Sort.by(Sort.Order.asc("id")));
    }
}
