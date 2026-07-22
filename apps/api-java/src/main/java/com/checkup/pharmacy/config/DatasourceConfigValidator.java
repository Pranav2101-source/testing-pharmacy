package com.checkup.pharmacy.config;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.regex.Pattern;

/**
 * Refuses to start when the JDBC URL points at a <strong>transaction-mode</strong> connection
 * pooler (Supabase/Supavisor/PgBouncer on the conventional port 6543) without
 * {@code prepareThreshold=0}.
 *
 * <p><strong>Why this exists.</strong> In transaction mode the pooler multiplexes many clients
 * over a small set of real backend connections, handing a different backend to each transaction.
 * pgjdbc, by default, promotes a statement to a server-side prepared statement after a few
 * executions ({@code prepareThreshold=5}) — but that statement lives on whichever backend
 * happened to serve it. The next transaction lands on a *different* backend and the driver
 * references a statement that isn't there, producing
 * {@code prepared statement "S_1" already exists} / {@code ... does not exist}.
 * {@code prepareThreshold=0} tells pgjdbc to never use server-side prepared statements, which
 * is the supported way to run pgjdbc behind a transaction pooler.
 *
 * <p><strong>Why fail fast rather than warn.</strong> This misconfiguration is invisible at
 * boot and on light traffic — the app starts cleanly, serves fine, and only starts erroring
 * once real concurrency spreads transactions across pooled backends. That's the worst possible
 * time to discover it (a production cutover). Failing at startup turns a subtle, load-dependent
 * production incident into an obvious, immediate, one-line fix.
 *
 * <p>The check is deliberately narrow so it cannot false-positive on local/dev setups: it only
 * triggers on the transaction-pooler port. A direct connection (5432) or a local Postgres is
 * untouched. The escape hatch is simply to add the parameter — it is harmless on a direct
 * connection too (it only forgoes server-side statement caching).
 */
@Component
public class DatasourceConfigValidator {

    private static final Logger log = LoggerFactory.getLogger(DatasourceConfigValidator.class);

    /** Supabase/Supavisor convention: 6543 = transaction mode, 5432 = session mode / direct. */
    private static final String TXN_POOLER_PORT = ":6543";

    /** Matches an explicit prepareThreshold=0 query parameter. */
    private static final Pattern PREPARE_THRESHOLD_ZERO =
            Pattern.compile("[?&]prepareThreshold=0(?:&|$)");

    private final String url;

    public DatasourceConfigValidator(@Value("${spring.datasource.url:}") String url) {
        this.url = url;
    }

    @PostConstruct
    void validate() {
        if (url == null || url.isBlank()) {
            return; // nothing configured (e.g. a slice test) — not this class's problem
        }
        if (!url.contains(TXN_POOLER_PORT)) {
            return; // direct connection or local Postgres — server-side prepares are fine
        }
        if (PREPARE_THRESHOLD_ZERO.matcher(url).find()) {
            log.info("Datasource targets the transaction-mode pooler (6543) with prepareThreshold=0 — correct.");
            return;
        }
        throw new IllegalStateException("""
                Invalid JDBC_DATABASE_URL: it targets the transaction-mode connection pooler \
                (port 6543) but does not set prepareThreshold=0.

                Under transaction pooling each transaction may land on a different backend \
                connection, so pgjdbc's server-side prepared statements break intermittently \
                under load with: prepared statement "S_1" already exists.

                Fix: append &prepareThreshold=0 to JDBC_DATABASE_URL, e.g.
                  jdbc:postgresql://<host>.pooler.supabase.com:6543/postgres?sslmode=require&prepareThreshold=0

                (Or connect to the direct/session port 5432 instead, if you specifically want \
                session-mode pooling.)""");
    }
}
