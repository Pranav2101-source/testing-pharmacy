package com.checkup.pharmacy.modules.billing;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface InvoiceRepository extends JpaRepository<Invoice, String> {

    long countByPharmacyId(String pharmacyId);

    @Query("SELECT i FROM Invoice i LEFT JOIN FETCH i.customer LEFT JOIN FETCH i.doctor WHERE i.id = :id AND i.pharmacyId = :pharmacyId")
    Optional<Invoice> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    Optional<Invoice> findByPharmacyIdAndIdempotencyKey(String pharmacyId, String idempotencyKey);

    /** Most recent non-cancelled invoice for a customer — powers "repeat last bill". */
    @Query("SELECT i FROM Invoice i WHERE i.pharmacyId = :pharmacyId AND i.customerId = :customerId " +
            "AND i.isCancelled = false ORDER BY i.createdAt DESC")
    List<Invoice> findRecentByCustomer(@Param("pharmacyId") String pharmacyId, @Param("customerId") String customerId, Pageable limit);

    /**
     * status/paymentMode/paymentStatus compared as text, search cast explicitly —
     * see InventoryRepository.search's javadoc for why both are necessary to
     * avoid Postgres's parameter-type-inference crash on a null bind value.
     * from/to are unconditional; the caller resolves absent bounds via
     * {@code common.util.DateRange} (same rationale, timestamp comparisons).
     */
    @Query("""
            SELECT i FROM Invoice i LEFT JOIN FETCH i.customer
            WHERE i.pharmacyId = :pharmacyId
              AND (:hasStatusFilter = true OR :includeCancelled = true OR i.isCancelled = false)
              AND (:status IS NULL OR CAST(i.status AS string) = :status)
              AND i.createdAt >= :from AND i.createdAt <= :to
              AND (:paymentMode IS NULL OR CAST(i.paymentMode AS string) = :paymentMode)
              AND (:paymentStatus IS NULL OR CAST(i.paymentStatus AS string) = :paymentStatus)
              AND (:userId IS NULL OR i.userId = :userId)
              AND (:customerId IS NULL OR i.customerId = :customerId)
              AND (:minAmount IS NULL OR i.totalAmount >= :minAmount)
              AND (:maxAmount IS NULL OR i.totalAmount <= :maxAmount)
              AND (:search IS NULL
                   OR LOWER(i.invoiceNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(i.customerName, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(i.customerPhone, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY i.createdAt DESC
            """)
    Page<Invoice> search(@Param("pharmacyId") String pharmacyId,
                         @Param("hasStatusFilter") boolean hasStatusFilter,
                         @Param("status") String status,
                         @Param("includeCancelled") boolean includeCancelled,
                         @Param("from") Instant from,
                         @Param("to") Instant to,
                         @Param("paymentMode") String paymentMode,
                         @Param("paymentStatus") String paymentStatus,
                         @Param("userId") String userId,
                         @Param("customerId") String customerId,
                         @Param("minAmount") BigDecimal minAmount,
                         @Param("maxAmount") BigDecimal maxAmount,
                         @Param("search") String search,
                         Pageable pageable);

    /** Non-cancelled sales total per payment mode within a date range — used by cash-closure's daily reconciliation. */
    @Query("""
            SELECT CAST(i.paymentMode AS string) AS paymentMode, COALESCE(SUM(i.totalAmount), 0) AS total
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND i.createdAt >= :from AND i.createdAt <= :to
            GROUP BY i.paymentMode
            """)
    List<PaymentModeTotalRow> sumByPaymentModeInRange(@Param("pharmacyId") String pharmacyId,
                                                       @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Cash taken over the counter: invoices raised in the window that were settled in
     * cash AT THE TILL.
     *
     * <p>Distinct from {@link #sumByPaymentModeInRange}, which reports what was SOLD
     * by payment mode regardless of whether the money arrived. The cash figure on a
     * closure is reconciled against a physical drawer, so it must count only cash
     * actually received.
     *
     * <p>The {@code PAID} filter is what keeps this from double-counting: a CASH
     * invoice left PENDING has no money in the drawer yet, and when it is settled
     * later an InvoicePayment row is written — which
     * {@code InvoicePaymentRepository.sumByModeInRange} picks up instead.
     */
    @Query("""
            SELECT COALESCE(SUM(i.totalAmount), 0) FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND CAST(i.paymentMode AS string) = 'CASH'
              AND CAST(i.paymentStatus AS string) = 'PAID'
              AND i.createdAt >= :from AND i.createdAt <= :to
            """)
    BigDecimal sumCashTakenAtTillInRange(@Param("pharmacyId") String pharmacyId,
                                         @Param("from") Instant from, @Param("to") Instant to);

    interface PaymentModeTotalRow {
        String getPaymentMode();
        BigDecimal getTotal();
    }

    @Query("SELECT i.customerId AS customerId, COUNT(i) AS total FROM Invoice i " +
            "WHERE i.pharmacyId = :pharmacyId AND i.customerId IN :customerIds GROUP BY i.customerId")
    List<CustomerInvoiceCountRow> countByCustomerIdIn(@Param("pharmacyId") String pharmacyId,
                                                       @Param("customerIds") List<String> customerIds);

    interface CustomerInvoiceCountRow {
        String getCustomerId();
        long getTotal();
    }

    /**
     * id + invoiceNumber for a set of invoices, in ONE query — the sales-returns list only shows
     * the originating bill's number, so loading each full Invoice entity per row was both an N+1
     * and needless work. Tenant-scoped so it can't reach another pharmacy's bill.
     */
    @Query("SELECT i.id AS id, i.invoiceNumber AS invoiceNumber FROM Invoice i "
            + "WHERE i.pharmacyId = :pharmacyId AND i.id IN :ids")
    List<InvoiceRefRow> findRefsByIdIn(@Param("pharmacyId") String pharmacyId, @Param("ids") List<String> ids);

    interface InvoiceRefRow {
        String getId();
        String getInvoiceNumber();
    }

    /**
     * Calendar auto-derived "credit due" events. Credit due date is modelled as
     * createdAt + 30 days (no dedicated due-date column), so the caller passes
     * an already-shifted [from - 30d, to - 30d] window to select invoices whose
     * derived due date falls inside the requested view range.
     */
    @Query("""
            SELECT i FROM Invoice i LEFT JOIN FETCH i.customer
            WHERE i.pharmacyId = :pharmacyId
              AND CAST(i.paymentStatus AS string) IN ('PENDING', 'PARTIAL')
              AND CAST(i.status AS string) = 'COMPLETED'
              AND i.createdAt >= :shiftedFrom AND i.createdAt <= :shiftedTo
            ORDER BY i.createdAt ASC
            """)
    List<Invoice> findPendingCreditInShiftedRange(@Param("pharmacyId") String pharmacyId,
                                                  @Param("shiftedFrom") Instant shiftedFrom,
                                                  @Param("shiftedTo") Instant shiftedTo);

    // ── Reporting ──────────────────────────────────────────────────────────────

    @Query("""
            SELECT COUNT(i) FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND i.createdAt >= :from AND i.createdAt <= :to
            """)
    long countActiveInRange(@Param("pharmacyId") String pharmacyId, @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COALESCE(SUM(i.subtotal), 0) AS subtotal, COALESCE(SUM(i.discountAmount), 0) AS discountAmount,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableAmount, COALESCE(SUM(i.cgst), 0) AS cgst,
                   COALESCE(SUM(i.sgst), 0) AS sgst, COALESCE(SUM(i.totalGst), 0) AS totalGst,
                   COALESCE(SUM(i.totalAmount), 0) AS totalAmount, COUNT(i) AS cnt
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND i.createdAt >= :from AND i.createdAt <= :to
            """)
    GstAggregateRow gstAggregate(@Param("pharmacyId") String pharmacyId, @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Per-day sales totals across a range, in ONE query — powers the Reports sales trend
     * chart, which previously issued one HTTP request (and two DB queries) PER DAY: seven
     * round trips to draw a seven-point line.
     *
     * <p>Native SQL because the grouping key is the IST calendar day, and only Postgres can
     * do the {@code AT TIME ZONE} conversion inside a GROUP BY — bucketing by raw UTC would
     * put an evening sale (after 18:30 UTC) on the following day's bar, which is exactly the
     * kind of quiet off-by-one a pharmacist reconciling a day's takings would notice and not
     * be able to explain. Days with no sales are simply absent; the caller fills the gaps so
     * the chart keeps a continuous axis.
     *
     * <p><b>{@code AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'} — both halves are required,
     * and one alone is worse than neither.</b> {@code createdAt} is {@code TIMESTAMP(3)}
     * WITHOUT time zone, holding UTC by convention rather than by type. On a naive column the
     * single-argument form does not mean "convert to IST": it means "this value IS IST, give
     * me the UTC instant", so it SUBTRACTS 5:30 from a value that needed 5:30 added — an
     * 11-hour error in the wrong direction. The first conversion supplies the zone the column
     * does not carry; the second does the intended shift.
     *
     * <p>What that cost: every sale before 11:00 IST was billed to the previous day's bar.
     * A morning's takings landed on yesterday, and the chart still totalled correctly across
     * the week, so it looked plausible from every angle except the one that mattered. It also
     * hid from the test suite — the test asserts "today's sale is counted", and until the
     * clock passes midnight IST the wrong answer and the right one are the same date.
     */
    @Query(value = """
            SELECT to_char((i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date,
                           'YYYY-MM-DD') AS day,
                   COUNT(*) AS invoiceCount,
                   COALESCE(SUM(i."totalAmount"), 0) AS revenue,
                   COALESCE(SUM(i."totalGst"), 0) AS gstCollected
            FROM invoices i
            WHERE i."pharmacyId" = :pharmacyId AND i."isCancelled" = false
              AND i."createdAt" >= :from AND i."createdAt" <= :to
            GROUP BY 1
            ORDER BY 1
            """, nativeQuery = true)
    List<DailySalesRow> dailySalesSeries(@Param("pharmacyId") String pharmacyId,
                                         @Param("from") Instant from, @Param("to") Instant to);

    interface DailySalesRow {
        String getDay();
        long getInvoiceCount();
        BigDecimal getRevenue();
        BigDecimal getGstCollected();
    }

    interface GstAggregateRow {
        BigDecimal getSubtotal();
        BigDecimal getDiscountAmount();
        BigDecimal getTaxableAmount();
        BigDecimal getCgst();
        BigDecimal getSgst();
        BigDecimal getTotalGst();
        BigDecimal getTotalAmount();
        long getCnt();
    }

    // ── Dashboard stats (homepage/sales KPIs) ──────────────────────────────────

    @Query("""
            SELECT COALESCE(SUM(i.totalAmount), 0) AS total, COUNT(i) AS cnt FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND i.createdAt >= :since
            """)
    SalesSinceRow sumAndCountSince(@Param("pharmacyId") String pharmacyId, @Param("since") Instant since);

    interface SalesSinceRow {
        BigDecimal getTotal();
        long getCnt();
    }

    @Query("SELECT COUNT(i) FROM Invoice i WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = true AND i.createdAt >= :since")
    long countCancelledSince(@Param("pharmacyId") String pharmacyId, @Param("since") Instant since);

    @Query("""
            SELECT COALESCE(SUM(i.totalAmount), 0) FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND CAST(i.paymentStatus AS string) = 'PENDING'
            """)
    BigDecimal sumPendingCredit(@Param("pharmacyId") String pharmacyId);

    @Query("""
            SELECT CAST(i.paymentMode AS string) AS mode, COALESCE(SUM(i.totalAmount), 0) AS total, COUNT(i) AS cnt
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND i.createdAt >= :since
            GROUP BY i.paymentMode
            """)
    List<PaymentModeBreakdownRow> paymentBreakdownSince(@Param("pharmacyId") String pharmacyId, @Param("since") Instant since);

    interface PaymentModeBreakdownRow {
        String getMode();
        BigDecimal getTotal();
        long getCnt();
    }
}
