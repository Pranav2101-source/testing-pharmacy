package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.CustomerLedgerEntryType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public interface CustomerLedgerEntryRepository extends JpaRepository<CustomerLedgerEntry, String> {

    /**
     * One customer's statement (khata), newest-first, for the UI.
     *
     * <p>Ordered by {@code seq} — never {@code entryAt}. Two entries posted by the
     * same bill share an entryAt to the millisecond, and ordering by it drops
     * through to the cuid id, which is alphabetical rather than chronological. See
     * {@link CustomerLedgerEntry#getSeq()}.
     */
    @Query("""
            SELECT e FROM CustomerLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND e.customerId = :customerId
            ORDER BY e.seq DESC
            """)
    Page<CustomerLedgerEntry> findStatement(@Param("pharmacyId") String pharmacyId,
                                            @Param("customerId") String customerId,
                                            Pageable pageable);

    /** Same rows in posting order — for a printed statement, which reads top-down. */
    @Query("""
            SELECT e FROM CustomerLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND e.customerId = :customerId
            ORDER BY e.seq ASC
            """)
    List<CustomerLedgerEntry> findStatementAscending(@Param("pharmacyId") String pharmacyId,
                                                      @Param("customerId") String customerId);

    /**
     * Ledger-derived balances for one customer: the authoritative values that
     * {@code Customer.creditUsed} / {@code Customer.advanceBalance} cache.
     *
     * <p>Returns a single row of [duesSum, advanceSum]. COALESCE so a customer with
     * no entries yet reads as zero rather than null.
     */
    @Query("""
            SELECT COALESCE(SUM(e.duesDelta), 0), COALESCE(SUM(e.advanceDelta), 0)
            FROM CustomerLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId AND e.customerId = :customerId
            """)
    List<Object[]> sumDeltas(@Param("pharmacyId") String pharmacyId,
                             @Param("customerId") String customerId);

    /**
     * Tenant-wide reconcile: every customer whose cached scalars disagree with the
     * ledger. Should always return nothing — it exists so that "should" is
     * checkable rather than assumed, and so a drift is found by a report instead of
     * by a customer disputing their balance.
     *
     * <p>Compares against the Customer row directly so a customer with cached
     * non-zero values but NO ledger entries is caught too (the case a plain
     * GROUP BY over this table would silently skip).
     */
    @Query("""
            SELECT c.id, c.name, c.creditUsed, COALESCE(l.duesSum, 0), c.advanceBalance, COALESCE(l.advanceSum, 0)
            FROM Customer c
            LEFT JOIN (
                SELECT e.customerId AS customerId,
                       SUM(e.duesDelta) AS duesSum,
                       SUM(e.advanceDelta) AS advanceSum
                FROM CustomerLedgerEntry e
                WHERE e.pharmacyId = :pharmacyId
                GROUP BY e.customerId
            ) l ON l.customerId = c.id
            WHERE c.pharmacyId = :pharmacyId
              AND c.deletedAt IS NULL
              AND (c.creditUsed <> COALESCE(l.duesSum, 0)
                   OR c.advanceBalance <> COALESCE(l.advanceSum, 0))
            """)
    List<Object[]> findDrift(@Param("pharmacyId") String pharmacyId);

    /** Guards the backfill: refuses to post a second OPENING for a customer that has one. */
    boolean existsByPharmacyIdAndCustomerIdAndType(String pharmacyId, String customerId,
                                                    CustomerLedgerEntryType type);

    /** Entries raised against one bill — used when a bill is cancelled or returned. */
    List<CustomerLedgerEntry> findByPharmacyIdAndInvoiceIdOrderBySeqAsc(String pharmacyId, String invoiceId);

    /**
     * Deposits taken and refunded in a window, per mode — money that physically
     * crossed the counter without any bill involved.
     *
     * <p>The day's drawer needs this. A customer handing over Rs.2000 as a deposit
     * puts Rs.2000 of real cash in the till against no invoice, so a closure built
     * only from invoices and their payments would report it as unexplained surplus —
     * the same class of error that made credit settlements invisible before
     * {@code InvoicePaymentRepository.sumByModeInRange} was widened to include them.
     *
     * <p>REFUND is subtracted rather than returned separately: handing an advance back
     * takes that money out of the same drawer, and a caller adding these to a mode
     * total wants the net movement, not two figures to reconcile itself.
     *
     * <p>Entries with no {@code paymentMode} are excluded by the GROUP BY, which is
     * deliberate and load-bearing: an advance restored because a bill was cancelled is
     * posted without a mode precisely because no money moved, and counting it would
     * make the drawer expect cash that was never taken.
     *
     * <p>Keyed on {@code entryAt} — when the money changed hands — matching how the
     * payment-side query keys on {@code paidAt}.
     */
    // EVERY enum here is compared as text, the type included — not just paymentMode.
    // A typed enum literal in JPQL makes Hibernate emit `'REFUND'::CustomerLedgerEntryType`
    // with the cast UNQUOTED, and Postgres folds an unquoted identifier to lower case:
    // `customerledgerentrytype`, which does not exist, because the Prisma-owned schema
    // names the type `"CustomerLedgerEntryType"`. Same rule as
    // InvoicePaymentRepository.sumByModeInRange and InvoiceRepository.
    @Query("""
            SELECT CAST(e.paymentMode AS string) AS mode,
                   COALESCE(SUM(CASE WHEN CAST(e.type AS string) = 'REFUND'
                                     THEN -e.amount ELSE e.amount END), 0) AS total,
                   COUNT(e.id) AS bills
            FROM CustomerLedgerEntry e
            WHERE e.pharmacyId = :pharmacyId
              AND e.entryAt >= :from AND e.entryAt <= :to
              AND e.paymentMode IS NOT NULL
              AND CAST(e.type AS string) IN ('ADVANCE', 'REFUND')
            GROUP BY e.paymentMode
            """)
    List<AdvanceMovementRow> sumAdvanceMovementsByModeInRange(@Param("pharmacyId") String pharmacyId,
                                                               @Param("from") Instant from,
                                                               @Param("to") Instant to);

    interface AdvanceMovementRow {
        String getMode();
        BigDecimal getTotal();
        long getBills();
    }

    /**
     * Total advance held across the tenant — a real liability, and the figure that
     * belongs on a balance sheet rather than being spread across customer rows.
     */
    @Query("""
            SELECT COALESCE(SUM(c.advanceBalance), 0) FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL AND c.advanceBalance > 0
            """)
    BigDecimal totalAdvanceHeld(@Param("pharmacyId") String pharmacyId);
}
