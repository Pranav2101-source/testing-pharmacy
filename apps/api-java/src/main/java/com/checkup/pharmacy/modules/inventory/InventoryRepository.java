package com.checkup.pharmacy.modules.inventory;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface InventoryRepository extends JpaRepository<Inventory, String> {

    Optional<Inventory> findByIdAndPharmacyId(String id, String pharmacyId);

    /**
     * Loads the given batches and holds a write lock on each for the rest of the
     * transaction (Postgres {@code SELECT ... FOR UPDATE}).
     *
     * <p>This is the alternative to running the whole sale under SERIALIZABLE.
     * Serializable isolation asks Postgres to detect, after the fact, that two
     * transactions could not have been ordered — which under load means both
     * counters do all their work and one is then told to throw it away. Taking
     * the row locks up front makes the second counter wait a few milliseconds for
     * the specific batches it needs, then proceed. Contention is narrowed from
     * "the entire transaction's read set" to "these batch rows".
     *
     * <p><b>ORDER BY id is load-bearing, not cosmetic.</b> Two invoices touching
     * the same two batches in opposite orders deadlock. Acquiring locks in a
     * single globally consistent order (ascending id) means one waits instead.
     * Postgres does not contractually guarantee lock order matches ORDER BY under
     * every plan, so {@link com.checkup.pharmacy.common.concurrency.RetryOnConflict}
     * still backstops the residual case rather than relying on ordering alone.
     *
     * <p>Deliberately no {@code JOIN FETCH}: Postgres rejects {@code FOR UPDATE}
     * applied to the nullable side of an outer join. Callers touch
     * {@code getMedicine()} inside the same transaction, so it resolves lazily.
     *
     * <p>pharmacyId is a parameter rather than being derived inside the query so
     * this cannot become another un-scoped lookup — see TenantIsolationGuardTest.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT i FROM Inventory i WHERE i.id IN :ids AND i.pharmacyId = :pharmacyId ORDER BY i.id")
    List<Inventory> lockAllByIdInAndPharmacyId(@Param("ids") java.util.Collection<String> ids,
                                               @Param("pharmacyId") String pharmacyId);

    /**
     * Tenant-scoped bulk lookup by id, WITHOUT taking write locks.
     *
     * <p>For paths that mutate batches already established as belonging to the caller
     * — restoring stock on an invoice cancellation or sales return, releasing a
     * session's reservations — where the plain {@code findAllById} they previously
     * used carried no pharmacyId predicate at all.
     *
     * <p>Use {@link #lockAllByIdInAndPharmacyId} instead when the read-then-write race
     * matters (selling, reserving). This one is for writes whose input ids were
     * themselves loaded tenant-scoped, and exists so tenancy does not depend on that
     * remaining true after some future refactor.
     */
    List<Inventory> findByIdInAndPharmacyId(java.util.Collection<String> ids, String pharmacyId);

    Optional<Inventory> findByPharmacyIdAndMedicineIdAndBatchNumber(String pharmacyId, String medicineId, String batchNumber);

    /** Merge-on-repeat-receipt lookup for a batch received against a {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine} instead of the global catalog. */
    Optional<Inventory> findByPharmacyIdAndLocalMedicineIdAndBatchNumber(String pharmacyId, String localMedicineId, String batchNumber);

    List<Inventory> findByPharmacyIdAndMedicineIdIn(String pharmacyId, java.util.Collection<String> medicineIds);

    /**
     * Which of these catalogue medicines any pharmacy still holds stock for.
     *
     * <p>Deliberately NOT tenant-scoped: the question is whether some OTHER pharmacy
     * is using a global catalogue entry before a migration rollback deactivates it.
     * Scoping this to the caller would defeat its entire purpose.
     */
    @Query("SELECT DISTINCT i.medicineId FROM Inventory i WHERE i.medicineId IN :medicineIds")
    List<String> findMedicineIdsInUse(@Param("medicineIds") java.util.Collection<String> medicineIds);

    List<Inventory> findByPharmacyIdAndStatus(String pharmacyId, com.checkup.pharmacy.common.enums.BatchStatus status);

    /**
     * Distinct names this pharmacy has carried, for the paired clinic's prescribing
     * autocomplete. Inventory — not the shared medicine catalogue — defines "in this pharmacy";
     * zero/expired batches remain discoverable so the caller can honestly show Not available.
     *
     * <p>Includes local medicines (see PharmacyMedicine): a batch received on a GRN before it
     * was in the global catalogue is real stock this pharmacy can dispense, and a prescriber
     * searching for it by name should find it the same as any catalogue medicine — the implicit
     * {@code i.medicine.name}/{@code isActive} path this used to use compiled to an INNER join,
     * which silently excluded every such batch. A local medicine has no deactivate flow (always
     * "active"), matching {@code Inventory.productIsActive()}.
     */
    @Query("""
            SELECT DISTINCT COALESCE(m.name, lm.name) FROM Inventory i
            LEFT JOIN i.medicine m
            LEFT JOIN i.localMedicine lm
            WHERE i.pharmacyId = :pharmacyId AND (m.isActive = true OR lm IS NOT NULL)
              AND (:search IS NULL
                   OR LOWER(COALESCE(m.name, lm.name)) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(m.genericName, lm.genericName)) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY COALESCE(m.name, lm.name) ASC
            """)
    List<String> searchMedicineNames(@Param("pharmacyId") String pharmacyId,
                                     @Param("search") String search,
                                     Pageable pageable);

    /**
     * status is compared as text — binding a null value typed as the Postgres
     * custom enum fails with "could not determine data type of parameter"
     * (SQLState 42P18); casting both sides to text sidesteps it (see
     * CustomerRepository for the same fix).
     *
     * search is explicitly cast to string too: a null :search bound into three
     * OR'd LOWER(CONCAT('%', :search, '%')) branches leaves Postgres unable to
     * resolve the parameter's type from context (it infers bytea and then
     * "function lower(bytea) does not exist") — the same class of bug as the
     * enum one, just a different error shape. The CAST forces text unconditionally.
     *
     * LEFT JOINs to medicine AND localMedicine — deliberately, not the implicit
     * {@code i.medicine.name} path this used to use. A batch received for a
     * medicine not yet in the global catalogue has {@code medicine} null (see
     * PharmacyMedicine); implicit path navigation compiles to an INNER join,
     * which silently dropped every such batch from this query — the one the
     * billing batch picker and the Inventory Batches tab both call. COALESCE
     * reads whichever side is actually populated. medicineId filtering is left
     * scoped to the global catalogue on purpose: a caller asking for a specific
     * catalogue medicine's batches has no equivalent local id to also match.
     */
    @Query("""
            SELECT i FROM Inventory i
            LEFT JOIN i.medicine m
            LEFT JOIN i.localMedicine lm
            WHERE i.pharmacyId = :pharmacyId
              AND (:search IS NULL
                   OR LOWER(COALESCE(m.name, lm.name)) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(m.genericName, lm.genericName)) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(i.batchNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
              AND (:medicineId IS NULL OR i.medicineId = :medicineId)
              AND (:inStock = false OR i.quantity > 0 OR i.looseUnits > 0)
              AND (:nearExpiry = false OR i.expiryDate <= :nearExpiryThreshold)
              AND (:status IS NULL OR CAST(i.status AS string) = :status)
              AND (:lowStock = false OR (i.quantity > 0 AND i.quantity <= i.minimumStock))
              AND (:hasLoose = false OR i.looseUnits > 0)
            """)
    Page<Inventory> search(@Param("pharmacyId") String pharmacyId,
                           @Param("search") String search,
                           @Param("medicineId") String medicineId,
                           @Param("inStock") boolean inStock,
                           @Param("nearExpiry") boolean nearExpiry,
                           @Param("nearExpiryThreshold") Instant nearExpiryThreshold,
                           @Param("status") String status,
                           @Param("lowStock") boolean lowStock,
                           @Param("hasLoose") boolean hasLoose,
                           Pageable pageable);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.expiryDate <= :threshold
              AND (i.quantity > 0 OR i.looseUnits > 0)
              AND CAST(i.status AS string) IN ('ACTIVE', 'EXPIRED')
            """)
    long countExpiryAlerts(@Param("pharmacyId") String pharmacyId, @Param("threshold") Instant threshold);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.quantity <= i.minimumStock
            """)
    long countLowStockAlerts(@Param("pharmacyId") String pharmacyId);

    /**
     * Dashboard low-stock count — ACTIVE, in-stock (quantity &gt; 0, or nothing but a loose
     * remainder left), at/below minimum (matches the old Node stat, extended for loose stock).
     *
     * <p>Only the "has anything at all" gate is broadened here — the threshold comparison
     * itself ({@code quantity <= minimumStock}) is untouched, since {@code minimumStock} is
     * still denominated in packs and reinterpreting THAT is Track B's bigger, deferred piece.
     * A batch down to nothing but an opened strip's remainder (quantity 0, looseUnits &gt; 0)
     * used to fall through this count entirely — neither "low" nor "out" — because the old
     * gate only looked at packs.
     */
    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND (i.quantity > 0 OR i.looseUnits > 0) AND i.quantity <= i.minimumStock
            """)
    long countLowStockInStock(@Param("pharmacyId") String pharmacyId);

    /**
     * Batches at or near expiry, soonest first.
     *
     * <p>Takes a {@link org.springframework.data.domain.Pageable} so the bound is
     * applied in SQL. It previously returned every matching row and callers trimmed
     * the result in Java — {@code ReportsService} even accepted a {@code limit}
     * parameter and then applied it with {@code .stream().limit(n)}, which reads
     * like a bound but is not one: the database still returned, transferred, and
     * materialised every row before Java discarded most of them.
     *
     * <p>Truncating here is safe precisely because of the ORDER BY: the rows that
     * survive the cut are the ones expiring soonest, which are the ones that matter.
     * A tail that is cut off is stock with the most time left.
     */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine LEFT JOIN FETCH i.localMedicine
            WHERE i.pharmacyId = :pharmacyId AND i.expiryDate <= :threshold
              AND (i.quantity > 0 OR i.looseUnits > 0)
              AND CAST(i.status AS string) IN ('ACTIVE', 'EXPIRED')
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findExpiryAlerts(@Param("pharmacyId") String pharmacyId,
                                     @Param("threshold") Instant threshold,
                                     org.springframework.data.domain.Pageable pageable);

    /** Bounded in SQL, lowest stock first — see {@link #findExpiryAlerts} for why. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.quantity <= i.minimumStock
            ORDER BY i.quantity ASC
            """)
    List<Inventory> findLowStockAlerts(@Param("pharmacyId") String pharmacyId,
                                       org.springframework.data.domain.Pageable pageable);

    /** FEFO — first-expiry-first-out. Only a batch with enough unreserved stock is eligible. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.medicineId = :medicineId
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity) >= :quantity
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findFefoCandidates(@Param("pharmacyId") String pharmacyId,
                                       @Param("medicineId") String medicineId,
                                       @Param("now") Instant now,
                                       @Param("quantity") int quantity,
                                       org.springframework.data.domain.Pageable limit);

    /**
     * FEFO candidates for SEVERAL medicines at once, earliest expiry first.
     *
     * <p>The caller takes the first row it sees per medicineId, which the ordering
     * makes equivalent to running {@link #findFefoCandidates} once per medicine — but
     * in one round trip. "Repeat last bill" was doing the per-medicine version inside
     * a loop, so a 15-line bill cost 15 of these plus 15 batch lookups.
     *
     * <p>Not paginated: a LIMIT here would cut across medicines, so one fast-moving
     * item with many batches could starve every other line of the bill. The ACTIVE +
     * unexpired + has-stock filters keep the row count to live batches.
     */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.medicineId IN :medicineIds
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity) >= :quantity
            ORDER BY i.medicineId ASC, i.expiryDate ASC
            """)
    List<Inventory> findFefoCandidatesForMedicines(@Param("pharmacyId") String pharmacyId,
                                                   @Param("medicineIds") java.util.Collection<String> medicineIds,
                                                   @Param("now") Instant now,
                                                   @Param("quantity") int quantity);

    // ── Dispensing engine ────────────────────────────────────────────────────
    // Sellable = ACTIVE (excludes QUARANTINE/recalled, DAMAGED, EXPIRED), in date,
    // and something left to sell (unreserved sealed packs OR a loose remainder).
    // Deliberately UNORDERED: DispensingService applies the pharmacy's strategy
    // (see BatchOrdering) in Java so FEFO and LIFA share one query.

    /**
     * Every sellable batch for one catalogue medicine — including batches received
     * against a local identity that has since been confirmed LINKED to it (see
     * {@link com.checkup.pharmacy.modules.medicine.PharmacyMedicine} /
     * {@code EffectiveMedicine}), so the dispensing plan sees the same stock the
     * billing search does.
     */
    @Query("""
            SELECT i FROM Inventory i
            LEFT JOIN i.localMedicine lm
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity > 0 OR i.looseUnits > 0)
              AND (i.medicineId = :medicineId
                   OR (lm.linkedMedicineId = :medicineId AND CAST(lm.matchStatus AS string) = 'LINKED'))
            """)
    List<Inventory> findSellableBatchesForEffectiveMedicine(@Param("pharmacyId") String pharmacyId,
                                                            @Param("medicineId") String medicineId,
                                                            @Param("now") Instant now);

    /**
     * {@link #findSellableBatchesForEffectiveMedicine} for SEVERAL catalogue medicines
     * at once — one round trip for a whole prescription's plan. {@code localMedicine}
     * is fetch-joined so the caller can group a LINKED-local batch by its catalogue
     * target ({@code i.localMedicine.linkedMedicineId}) without an extra query per row.
     */
    @Query("""
            SELECT i FROM Inventory i
            LEFT JOIN FETCH i.localMedicine lm
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity > 0 OR i.looseUnits > 0)
              AND (i.medicineId IN :medicineIds
                   OR (lm.linkedMedicineId IN :medicineIds AND CAST(lm.matchStatus AS string) = 'LINKED'))
            """)
    List<Inventory> findSellableBatchesForEffectiveMedicines(@Param("pharmacyId") String pharmacyId,
                                                             @Param("medicineIds") java.util.Collection<String> medicineIds,
                                                             @Param("now") Instant now);

    /** Every sellable batch for one of this pharmacy's own local medicines. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId
              AND i.localMedicineId = :localMedicineId
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity > 0 OR i.looseUnits > 0)
            """)
    List<Inventory> findSellableBatchesForLocalMedicine(@Param("pharmacyId") String pharmacyId,
                                                        @Param("localMedicineId") String localMedicineId,
                                                        @Param("now") Instant now);

    /**
     * Sellable batches for several catalogue medicines at once — one round trip for
     * Quick Add and Repeat Last Bill. Matches on {@code medicineId} directly (both
     * callers already work from resolved catalogue ids).
     */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId
              AND i.medicineId IN :medicineIds
              AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate > :now
              AND (i.quantity - i.reservedQuantity > 0 OR i.looseUnits > 0)
            """)
    List<Inventory> findSellableBatchesForMedicines(@Param("pharmacyId") String pharmacyId,
                                                    @Param("medicineIds") java.util.Collection<String> medicineIds,
                                                    @Param("now") Instant now);

    List<Inventory> findByPharmacyIdAndBatchNumberAndStatus(String pharmacyId, String batchNumber,
                                                            com.checkup.pharmacy.common.enums.BatchStatus status);

    List<Inventory> findByPharmacyIdAndMedicineIdAndBatchNumberAndStatus(
            String pharmacyId, String medicineId, String batchNumber, com.checkup.pharmacy.common.enums.BatchStatus status);

    /** Calendar auto-derived "expiry alert" events for a date-range view. */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate >= :from AND i.expiryDate <= :to
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findExpiringBatchesInRange(@Param("pharmacyId") String pharmacyId,
                                               @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COUNT(i) FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND i.expiryDate >= :from AND i.expiryDate <= :to
            """)
    long countExpiringBatchesInRange(@Param("pharmacyId") String pharmacyId,
                                     @Param("from") Instant from, @Param("to") Instant to);

    /** All active stock — powers inventory valuation (grouped by medicine or category in the service). */
    @Query("SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'")
    List<Inventory> findActiveWithMedicine(@Param("pharmacyId") String pharmacyId);

    /**
     * Batches by id WITH their medicine, tenant-scoped — for report rows that already know the
     * ids they need (fast/slow-moving, EOD top sellers, margin report). Replaces
     * {@code findAllById}, which left {@code medicine} lazy and so fired one extra query per row
     * while the caller built its medicine refs, and carried no pharmacyId predicate.
     *
     * <p>Fetches {@code localMedicine} too, for the same reason — a caller reading
     * {@code inv.productName()} on a batch that was never linked to the global catalogue (see
     * PharmacyMedicine) would otherwise lazy-load one local medicine per such row.
     */
    @Query("SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine LEFT JOIN FETCH i.localMedicine "
            + "WHERE i.pharmacyId = :pharmacyId AND i.id IN :ids")
    List<Inventory> findByIdInWithMedicine(@Param("pharmacyId") String pharmacyId,
                                           @Param("ids") java.util.Collection<String> ids);

    /**
     * Active, in-stock batches — candidates for the dead-stock report (last-sale lookup
     * happens separately). "In stock" includes a batch down to nothing but an opened
     * strip's loose remainder — it is still real, sellable, at-risk stock.
     */
    @Query("""
            SELECT i FROM Inventory i LEFT JOIN FETCH i.medicine
            WHERE i.pharmacyId = :pharmacyId AND CAST(i.status AS string) = 'ACTIVE'
              AND (i.quantity > 0 OR i.looseUnits > 0)
            """)
    List<Inventory> findActiveInStockWithMedicine(@Param("pharmacyId") String pharmacyId);

    /** Live (ACTIVE, non-expired) batches for a set of medicines — powers the billing alternatives drawer's stock column. */
    @Query("""
            SELECT i FROM Inventory i
            WHERE i.pharmacyId = :pharmacyId AND i.medicineId IN :medicineIds
              AND CAST(i.status AS string) = 'ACTIVE' AND i.expiryDate > :now
            ORDER BY i.expiryDate ASC
            """)
    List<Inventory> findActiveNonExpiredByMedicineIdIn(@Param("pharmacyId") String pharmacyId,
                                                       @Param("medicineIds") java.util.Collection<String> medicineIds,
                                                       @Param("now") java.time.Instant now);

    interface ExpiredStockRow {
        long getBatches();
        Long getUnits();
        java.math.BigDecimal getCost();
        java.math.BigDecimal getEmbeddedItc();
    }

    /**
     * Expired stock still sitting on the books, and the input tax credit embedded in it.
     *
     * <p>WHY THIS IS A GST FIGURE AND NOT JUST AN INVENTORY ONE
     *
     * <p>Section 17(5)(h) of the CGST Act blocks input tax credit on goods "lost, stolen,
     * destroyed, written off or disposed of by way of gift or free samples". Expired medicine
     * is destroyed by definition — so the credit claimed when it was bought has to be reversed
     * in the period it is written off, under Table 4(B)(1).
     *
     * <p>This reports what is STILL on the books, unwritten-off — {@code InventoryService}'s
     * expiry write-off flow (which sets {@code BatchStatus.EXPIRED} and records an
     * {@code EXPIRY_REMOVAL} movement) is what moves a batch out of this figure, and a pharmacy
     * that never runs it will see this grow every period.
     *
     * <p>A batch's loose remainder is included and priced at its per-piece share of the same
     * purchase rate the sealed packs are valued at — cut tablets from an expired strip are
     * still real, still-unreversed input credit, and (per the pharmacy's own override where one
     * is set, else the catalogue's units-per-pack) the same effective pack size everything else
     * in this app resolves it as. {@code units} is a count of individual base units (sealed
     * packs multiplied out by their effective pack size, plus any loose remainder) — deliberately
     * NOT packs, so a batch that is nothing but a cut-strip remainder still shows a real number
     * here rather than rounding to zero. For a medicine that has never been sold loose it equals
     * the plain pack count times the pack size; {@code cost} and {@code embeddedItc} are
     * unchanged from the pack-only figures in that case.
     *
     * <p>The ITC is an ESTIMATE and the sheet says so: it applies the medicine's CURRENT GST
     * rate to the batch's recorded purchase rate. It does not know which tax head the credit
     * was originally claimed under (a batch can merge receipts from more than one supplier), and
     * a pharmacy-level GST override is not considered. It is the right order of magnitude and
     * the right list of batches — the exact split belongs to whoever signs the return.
     *
     * <p>{@code Medicine} is LEFT-joined, not INNER: a local medicine (not yet in the global
     * catalogue, see PharmacyMedicine) has {@code i.medicineId} null, and an INNER join silently
     * dropped its expired, unwritten-off batch from this figure entirely instead of just pricing
     * it without a per-pharmacy override — exactly the ITC-reversal exposure this query exists to
     * surface. {@code PharmacyMedicine} is LEFT-joined for its gstRate as the fallback when
     * {@code Medicine} is absent; a local medicine has no override or unitsPerPack concept, so
     * {@code COALESCE(o.unitsPerPack, m.unitsPerPack, 1)} already resolves correctly to 1 for it.
     */
    @Query("""
            SELECT COUNT(i) AS batches,
                   COALESCE(SUM(i.quantity * COALESCE(o.unitsPerPack, m.unitsPerPack, 1) + i.looseUnits), 0) AS units,
                   COALESCE(SUM(i.purchaseRate * i.quantity
                       + (i.purchaseRate * i.looseUnits) / COALESCE(o.unitsPerPack, m.unitsPerPack, 1)), 0) AS cost,
                   COALESCE(SUM((i.purchaseRate * i.quantity
                       + (i.purchaseRate * i.looseUnits) / COALESCE(o.unitsPerPack, m.unitsPerPack, 1))
                       * COALESCE(m.gstRate, lm.gstRate, 0) / 100), 0) AS embeddedItc
            FROM Inventory i
            LEFT JOIN Medicine m ON m.id = i.medicineId
            LEFT JOIN PharmacyMedicine lm ON lm.id = i.localMedicineId
            LEFT JOIN PharmacyMedicineOverride o ON o.id.pharmacyId = i.pharmacyId AND o.id.medicineId = i.medicineId
            WHERE i.pharmacyId = :pharmacyId
              AND (i.quantity > 0 OR i.looseUnits > 0)
              AND i.expiryDate < :asOf
            """)
    ExpiredStockRow expiredStockOnBooks(@Param("pharmacyId") String pharmacyId,
                                        @Param("asOf") java.time.Instant asOf);

    /** One row per medicine/local-medicine id that has live, sellable stock — see {@link #findStockForEffectiveMedicineIds}. */
    interface StockAggregateRow {
        String getEffectiveId();
        Integer getAvailableQuantity();
        Integer getLooseUnitsOnHand();
        java.math.BigDecimal getPrice();
    }

    /**
     * Batched stock summary for the billing search dropdown — powers "in-stock first"
     * ranking plus the quantity/price shown per result. One query for the whole page
     * of search results, not one per medicine (same batching discipline as {@link
     * #findFefoCandidatesForMedicines}).
     *
     * <p>{@code effectiveIds} is catalogue {@code Medicine} ids. A batch counts toward
     * one of those ids either directly ({@code medicineId}) or, via {@code
     * EffectiveMedicine}'s own rule, through a {@code LINKED} local medicine whose
     * {@code linkedMedicineId} points at it — a pharmacist who searches the catalogue
     * name should see stock a GRN happened to receive under the not-yet-matched local
     * identity before it was linked. {@code PENDING}/{@code SUGGESTED}/{@code
     * KEPT_LOCAL} local medicines are deliberately excluded here; their own stock is
     * {@link #findStockForLocalMedicineIds} instead.
     *
     * <p>{@code price} is the MRP of the earliest-expiring in-stock batch (the one FEFO
     * will actually sell next) via {@code array_agg(... ORDER BY "expiryDate")[1]} — a
     * plain aggregate can't express "the value from the row with the smallest other
     * column" so this is native SQL, same as {@link
     * com.checkup.pharmacy.modules.medicine.MedicineRepository#fuzzySearch}.
     *
     * <p>A batch counts only while it has unreserved stock — {@code quantity -
     * reservedQuantity > 0} (whole packs) {@code OR looseUnits > 0} — reserved stock is
     * already committed to another cart (see {@code StockReservation}) and showing it
     * as available here would let two pharmacists both believe they can sell the same
     * last strip. A medicine with no such row is simply out of stock at this pharmacy;
     * the caller treats a missing map entry as zero.
     */
    @Query(value = """
            SELECT COALESCE(i."medicineId", pm."linkedMedicineId") AS effectiveId,
                   SUM(GREATEST(i.quantity - i."reservedQuantity", 0))::int AS availableQuantity,
                   SUM(i."looseUnits")::int AS looseUnitsOnHand,
                   (array_agg(i.mrp ORDER BY i."expiryDate" ASC))[1] AS price
            FROM inventory i
            LEFT JOIN pharmacy_medicines pm
              ON pm.id = i."localMedicineId" AND pm."matchStatus" = 'LINKED'
            WHERE i."pharmacyId" = :pharmacyId
              AND i.status = 'ACTIVE'
              AND i."expiryDate" > :now
              AND (i.quantity - i."reservedQuantity" > 0 OR i."looseUnits" > 0)
              AND COALESCE(i."medicineId", pm."linkedMedicineId") IN (:effectiveIds)
            GROUP BY COALESCE(i."medicineId", pm."linkedMedicineId")
            """, nativeQuery = true)
    List<StockAggregateRow> findStockForEffectiveMedicineIds(@Param("pharmacyId") String pharmacyId,
                                                              @Param("effectiveIds") java.util.Collection<String> effectiveIds,
                                                              @Param("now") java.time.Instant now);

    /**
     * Same shape as {@link #findStockForEffectiveMedicineIds}, for a pharmacy's own
     * not-yet-catalogued local medicines (see {@code PharmacyMedicine}) — keyed by
     * their own id, not routed through any catalogue link, since a result row here is
     * by construction never {@code LINKED} (see {@code MedicineService#quickSearch}).
     */
    @Query(value = """
            SELECT i."localMedicineId" AS effectiveId,
                   SUM(GREATEST(i.quantity - i."reservedQuantity", 0))::int AS availableQuantity,
                   SUM(i."looseUnits")::int AS looseUnitsOnHand,
                   (array_agg(i.mrp ORDER BY i."expiryDate" ASC))[1] AS price
            FROM inventory i
            WHERE i."pharmacyId" = :pharmacyId
              AND i.status = 'ACTIVE'
              AND i."expiryDate" > :now
              AND (i.quantity - i."reservedQuantity" > 0 OR i."looseUnits" > 0)
              AND i."localMedicineId" IN (:localMedicineIds)
            GROUP BY i."localMedicineId"
            """, nativeQuery = true)
    List<StockAggregateRow> findStockForLocalMedicineIds(@Param("pharmacyId") String pharmacyId,
                                                          @Param("localMedicineIds") java.util.Collection<String> localMedicineIds,
                                                          @Param("now") java.time.Instant now);
}
