package com.checkup.pharmacy.common.sequence;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

/**
 * Postgres-backed, per-pharmacy document counters (invoice/PO/GRN/audit numbering).
 * Durable — unlike a Redis INCR counter, the value survives a restart or eviction,
 * so re-issued numbers never collide with a document's unique (pharmacyId, kind,
 * period) constraint after an outage.
 *
 * Joins the caller's transaction (default REQUIRED propagation): call this from
 * within an {@code @Transactional} service method and the increment commits or
 * rolls back with the surrounding write, keeping numbering gapless for documents
 * that need it (invoices). A failed create then returns its number instead of
 * burning it. Callers that can tolerate occasional gaps (PO, GRN, audits) are
 * unaffected either way.
 *
 * Concurrency: the {@code ON CONFLICT} upsert serializes on the counter row —
 * concurrent callers block briefly on the row lock rather than racing.
 */
@Service
public class DocumentSequenceService {

    /** Period value for counters that never reset by financial year (payments, credit notes). */
    public static final String PERIOD_ALL = "ALL";

    public static final String PURCHASE_ORDER = "PURCHASE_ORDER";
    public static final String GRN = "GRN";
    public static final String SUPPLIER_RETURN = "SUPPLIER_RETURN";
    public static final String STOCK_AUDIT = "STOCK_AUDIT";
    public static final String SUPPLIER_PAYMENT = "SUPPLIER_PAYMENT";
    public static final String SUPPLIER_CREDIT_NOTE = "SUPPLIER_CREDIT_NOTE";
    public static final String INVOICE = "INVOICE";
    public static final String SALES_RETURN = "SALES_RETURN";
    public static final String QUOTATION = "QUOTATION";
    public static final String PRESCRIPTION = "PRESCRIPTION";

    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);

    @PersistenceContext
    private EntityManager em;

    @Transactional
    public int next(String pharmacyId, String kind) {
        return next(pharmacyId, kind, financialYearPeriod());
    }

    @Transactional
    public int next(String pharmacyId, String kind, String period) {
        Object result = em.createNativeQuery("""
                        INSERT INTO document_sequences ("pharmacyId", "kind", "period", "value", "updatedAt")
                        VALUES (?1, ?2, ?3, 1, now())
                        ON CONFLICT ("pharmacyId", "kind", "period")
                        DO UPDATE SET "value" = document_sequences."value" + 1, "updatedAt" = now()
                        RETURNING "value"
                        """)
                .setParameter(1, pharmacyId)
                .setParameter(2, kind)
                .setParameter(3, period)
                .getSingleResult();
        return ((Number) result).intValue();
    }

    /** Indian financial-year period key, e.g. "2025-2026" — rolls over April 1 IST. */
    public static String financialYearPeriod() {
        ZonedDateTime now = Instant.now().atZone(IST);
        int year = now.getYear();
        return now.getMonthValue() >= 4
                ? year + "-" + (year + 1)
                : (year - 1) + "-" + year;
    }

    /** IST calendar-day period key, e.g. "20260715" — used by stock-audit numbering. */
    public static String istDayPeriod() {
        ZonedDateTime now = Instant.now().atZone(IST);
        return String.format("%04d%02d%02d", now.getYear(), now.getMonthValue(), now.getDayOfMonth());
    }

    /** Short financial-year label for document prefixes, e.g. "25-26". */
    public static String fyShort() {
        String[] parts = financialYearPeriod().split("-");
        return parts[0].substring(2) + "-" + parts[1].substring(2);
    }
}
