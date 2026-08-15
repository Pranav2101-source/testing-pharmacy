package com.checkup.pharmacy.modules.supplier;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SupplierRepository extends JpaRepository<Supplier, String> {

    @Query("""
            SELECT s FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId
              AND (:search IS NULL OR LOWER(s.name) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:isActive IS NULL OR s.isActive = :isActive)
            """)
    Page<Supplier> search(@Param("pharmacyId") String pharmacyId,
                          @Param("search") String search,
                          @Param("isActive") Boolean isActive,
                          Pageable pageable);

    Optional<Supplier> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Locking load for any path that calls {@link Supplier#adjustLedgerBalance}.
     *
     * <p>That method is a read-modify-write on a running total, and THREE unrelated
     * flows call it: confirming a GRN (increases what is owed), recording a payment,
     * and confirming a supplier return (both decrease it). Each of those already locks
     * its own DOCUMENT, which stops the same document being applied twice — but two
     * DIFFERENT documents for the same supplier still raced. Both read the old
     * balance, both wrote, and one adjustment vanished.
     *
     * <p>The failure is silent and cumulative: no error, no log, just a supplier
     * balance that drifts away from the sum of its ledger entries. It is the figure
     * the pharmacy pays against, so the drift is money.
     *
     * <p>Pessimistic rather than optimistic because there is no {@code @Version}
     * column anywhere in this schema, and adding one is a Prisma migration. Callers
     * take this AFTER their document lock, so lock ordering stays document-then-
     * supplier everywhere and cannot cycle.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM Supplier s WHERE s.id = :id AND s.pharmacyId = :pharmacyId")
    Optional<Supplier> lockByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    List<Supplier> findByPharmacyId(String pharmacyId);

    /** Unpaginated, active-only — powers simple picker dropdowns (e.g. quotation creation). */
    @Query("SELECT s FROM Supplier s WHERE s.pharmacyId = :pharmacyId AND s.isActive = true ORDER BY s.name ASC")
    List<Supplier> findAllActiveByPharmacyId(@Param("pharmacyId") String pharmacyId);

    /**
     * Batched counterpart of {@link #findMatchingForImport} — every candidate the whole
     * import file could match, in ONE query. The migration commit looped over rows calling
     * the single-row version, so a 50,000-row supplier file issued 50,000 SELECTs; the
     * caller now loads once and matches in memory using the same name/gstin rule.
     */
    @Query("""
            SELECT s FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId
              AND (LOWER(s.name) IN :lowerNames OR (s.gstin IS NOT NULL AND s.gstin IN :gstins))
            """)
    List<Supplier> findMatchingForImportBatch(@Param("pharmacyId") String pharmacyId,
                                              @Param("lowerNames") Collection<String> lowerNames,
                                              @Param("gstins") Collection<String> gstins);

    /** Migration-import dedup: an existing supplier matches on EITHER name or gstin, not just one. */
    @Query("""
            SELECT s FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId
              AND (LOWER(s.name) = LOWER(:name) OR (:gstin IS NOT NULL AND s.gstin = :gstin))
            """)
    List<Supplier> findMatchingForImport(@Param("pharmacyId") String pharmacyId, @Param("name") String name,
                                         @Param("gstin") String gstin);

    interface StateCoverageRow {
        long getWithoutState();
        long getTotal();
    }

    /**
     * How many active suppliers have no state on file.
     *
     * <p>Inter-state purchase tax is decided by comparing the supplier's state with the
     * pharmacy's. A supplier with no state can only be treated as local, so every purchase
     * from it is booked CGST + SGST whatever the truth — and, worse, the GSTR-3B
     * misclassification check cannot flag it either, because it has nothing to compare.
     *
     * <p>The sheet reports this rather than staying quiet. "No problems found" and "cannot
     * tell for most of your suppliers" look identical on a tax return, and only one of them
     * is safe to act on.
     */
    /*
     * TRIM before the emptiness test. This read `s.state = ''`, while every other place that
     * asks the same question uses isBlank() — so a state of "  " counted as recorded here and
     * was then treated as a real, non-matching state by the misclassification check, which
     * flagged those receipts as inter-state. A whitespace state is a missing state, and all
     * three places now agree on that.
     */
    @Query("""
            SELECT COALESCE(SUM(CASE WHEN s.state IS NULL OR TRIM(s.state) = '' THEN 1 ELSE 0 END), 0) AS withoutState,
                   COUNT(s) AS total
            FROM Supplier s
            WHERE s.pharmacyId = :pharmacyId AND s.isActive = true
            """)
    StateCoverageRow stateCoverage(@Param("pharmacyId") String pharmacyId);
}
