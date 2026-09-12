package com.checkup.pharmacy.modules.customerledger;

import com.checkup.pharmacy.common.enums.CustomerLedgerEntryType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
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
     * Total advance held across the tenant — a real liability, and the figure that
     * belongs on a balance sheet rather than being spread across customer rows.
     */
    @Query("""
            SELECT COALESCE(SUM(c.advanceBalance), 0) FROM Customer c
            WHERE c.pharmacyId = :pharmacyId AND c.deletedAt IS NULL AND c.advanceBalance > 0
            """)
    BigDecimal totalAdvanceHeld(@Param("pharmacyId") String pharmacyId);
}
