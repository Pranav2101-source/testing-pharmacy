package com.checkup.pharmacy.common.util;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Resolves an optional (nullable) date-range bound to a real sentinel value
 * before it reaches a JPQL query. Binding a genuinely null {@link Instant} (or
 * {@link LocalDate}) into a ">="/"<=" comparison against a timestamp/date column
 * leaves Postgres unable to infer the parameter's type ("could not determine
 * data type of parameter" / "cannot cast type bytea to timestamp") — even
 * wrapping it in an explicit JPQL CAST doesn't reliably fix it, and neither does
 * an "IS NULL OR" guard (Postgres must type-check every branch of the prepared
 * statement up front, before it knows the parameter is null at runtime).
 * Substituting a wide-but-real sentinel bound sidesteps the ambiguity entirely:
 * the parameter is always a concrete, unambiguously-typed value.
 */
public final class DateRange {

    public static final Instant MIN = Instant.parse("1970-01-01T00:00:00Z");
    public static final Instant MAX = Instant.parse("9999-12-31T23:59:59Z");

    public static final LocalDate DATE_MIN = LocalDate.of(1970, 1, 1);
    public static final LocalDate DATE_MAX = LocalDate.of(9999, 12, 31);

    private DateRange() {
    }

    public static Instant from(Instant from) {
        return from != null ? from : MIN;
    }

    public static Instant to(Instant to) {
        return to != null ? to : MAX;
    }

    public static LocalDate from(LocalDate from) {
        return from != null ? from : DATE_MIN;
    }

    public static LocalDate to(LocalDate to) {
        return to != null ? to : DATE_MAX;
    }
}
