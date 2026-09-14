package com.checkup.pharmacy.modules.billing;

import org.springframework.data.domain.Limit;
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

    /** Rollback guard: how many bills name one of these customers. */
    long countByPharmacyIdAndCustomerIdIn(String pharmacyId, java.util.Collection<String> customerIds);

    /** Rollback guard: how many bills name one of these doctors. */
    long countByPharmacyIdAndDoctorIdIn(String pharmacyId, java.util.Collection<String> doctorIds);

    @Query("SELECT i FROM Invoice i LEFT JOIN FETCH i.customer LEFT JOIN FETCH i.doctor WHERE i.id = :id AND i.pharmacyId = :pharmacyId")
    Optional<Invoice> findByIdAndPharmacyId(@Param("id") String id, @Param("pharmacyId") String pharmacyId);

    Optional<Invoice> findByPharmacyIdAndIdempotencyKey(String pharmacyId, String idempotencyKey);

    List<Invoice> findByPharmacyIdAndPrescriptionIdOrderByCreatedAtAsc(String pharmacyId, String prescriptionId);

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

    /**
     * Money received, per mode, on bills that carry no tender rows of their own — every
     * bill raised before split tender existed.
     *
     * <p>The other half of {@code InvoicePaymentRepository.sumByModeInRange}: together
     * the two cover both eras of bill exactly once. This one reads the settlement off
     * the invoice's own columns because that is the only record such a bill has;
     * the newer one reads it off the tender rows, which is the only record a split bill
     * COULD have. A bill is in precisely one of the two sets, so nothing is counted twice
     * and nothing is missed — and no payment row has to be invented for the thousands of
     * invoices that predate the feature.
     *
     * <p>This replaced a pair of queries that reported what was SOLD by mode — the whole
     * of a bill's total, filed under the single mode it named. A bill settled two ways at
     * once has no such single mode, and booking its full value under the larger leg
     * inflated one figure by money it never received while the other lost the same amount.
     *
     * <p>CREDIT is absent by construction: an unpaid bill received no money, and what it
     * put on the customer's account is {@link #sumCreditPutOnAccountInRange}'s question.
     * Anything not fully PAID is skipped for the same reason.
     */
    @Query("""
            SELECT CAST(i.paymentMode AS string) AS mode, COALESCE(SUM(i.totalAmount), 0) AS total,
                   COUNT(i) AS bills
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND CAST(i.paymentStatus AS string) = 'PAID'
              AND CAST(i.paymentMode AS string) <> 'CREDIT'
              AND i.createdAt >= :from AND i.createdAt <= :to
              AND NOT EXISTS (SELECT 1 FROM InvoicePayment p
                               WHERE p.invoiceId = i.id AND p.paidAt <= i.createdAt)
            GROUP BY i.paymentMode
            """)
    List<ModeMixRow> sumUntenderedReceivedByModeInRange(@Param("pharmacyId") String pharmacyId,
                                                        @Param("from") Instant from, @Param("to") Instant to);

    interface ModeMixRow {
        String getMode();
        BigDecimal getTotal();
        long getBills();
    }

    /**
     * What the window's sales put on customers' accounts — debt created, not money taken.
     *
     * <p>Measured at the moment of sale and never afterwards, which is why this reads the
     * tenders stamped at checkout rather than {@code amountPaid}. The two agree until the
     * customer settles: a later payment raises {@code amountPaid}, and a figure derived
     * from it would quietly restate how much was sold on credit on a day that is long
     * past. "Sold on credit in March" must not shrink because someone paid in April.
     *
     * <p>A checkout tender is identifiable because it is written carrying the invoice's
     * own {@code createdAt} (see BillingService.createInvoice); anything a customer pays
     * later is strictly after it. The same test tells a cancellable bill from one with
     * money collected against it — see BillingService.doCancelInvoice.
     *
     * <p>Bills predating split tender have no checkout tenders at all, so the mode they
     * were filed under is the only record of the debt — the first arm, which reports the
     * whole bill exactly as the query this replaced did. A bill is read by at most one
     * arm, the same both-eras split as {@link #sumUntenderedReceivedByModeInRange}.
     *
     * <p>Both arms turn on CHECKOUT tenders specifically, never on "has any payment row".
     * A later settlement writes a row too, and keying off that would move a bill from one
     * era to the other the moment a customer paid — retroactively reclassifying an old
     * cash sale as a credit sale on a date already closed and reported.
     */
    @Query("""
            SELECT 'CREDIT' AS mode,
                   COALESCE(SUM(i.totalAmount - COALESCE(
                       (SELECT SUM(p.amount) FROM InvoicePayment p
                         WHERE p.invoiceId = i.id AND p.paidAt <= i.createdAt), 0)), 0) AS total,
                   COUNT(i) AS bills
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND i.createdAt >= :from AND i.createdAt <= :to
              AND (
                   (NOT EXISTS (SELECT 1 FROM InvoicePayment p2
                                 WHERE p2.invoiceId = i.id AND p2.paidAt <= i.createdAt)
                    AND CAST(i.paymentMode AS string) = 'CREDIT')
                   OR (EXISTS (SELECT 1 FROM InvoicePayment p3
                                WHERE p3.invoiceId = i.id AND p3.paidAt <= i.createdAt)
                       AND i.totalAmount > COALESCE(
                           (SELECT SUM(p4.amount) FROM InvoicePayment p4
                             WHERE p4.invoiceId = i.id AND p4.paidAt <= i.createdAt), 0))
              )
            """)
    ModeMixRow sumCreditPutOnAccountInRange(@Param("pharmacyId") String pharmacyId,
                                            @Param("from") Instant from, @Param("to") Instant to);

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

    /**
     * The period's invoice totals.
     *
     * <p>{@code extraCharges}, {@code adjustmentAmount} and {@code roundOff} are summed here
     * because the GST summary screen cannot reconcile without them. Every invoice satisfies
     * {@code taxableAmount + totalGst + extraCharges + adjustmentAmount + roundOff ==
     * totalAmount} — the three middle terms were simply never selected, so the summary showed
     * a taxable value and a tax total that did not add up to the net figure printed beneath
     * them, on the tab a GSTR-1 return is transcribed from.
     */
    @Query("""
            SELECT COALESCE(SUM(i.subtotal), 0) AS subtotal, COALESCE(SUM(i.discountAmount), 0) AS discountAmount,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableAmount, COALESCE(SUM(i.cgst), 0) AS cgst,
                   COALESCE(SUM(i.sgst), 0) AS sgst, COALESCE(SUM(i.igst), 0) AS igst,
                   COALESCE(SUM(i.totalGst), 0) AS totalGst,
                   COALESCE(SUM(i.extraCharges), 0) AS extraCharges,
                   COALESCE(SUM(i.adjustmentAmount), 0) AS adjustmentAmount,
                   COALESCE(SUM(i.roundOff), 0) AS roundOff,
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

    /**
     * The same series bucketed by IST calendar MONTH ({@code YYYY-MM}) instead of day.
     *
     * <p>Exists because the chart stops being readable long before the query stops being
     * cheap: a quarter is 90 bars and a year is 365, in a bar chart sized for seven. The
     * caller picks the bucket from the width of the range, so "This Year" draws twelve
     * bars rather than a picket fence.
     *
     * <p>Deliberately a separate method rather than an interpolated format string. The
     * pattern sits inside the SQL text, so building it from a parameter would mean
     * concatenating caller input into a query — and the only thing that would buy is one
     * saved method. See {@code dailySalesSeries} for why both {@code AT TIME ZONE} halves
     * are required; the same reasoning applies unchanged here, and getting it wrong shifts
     * a month boundary rather than a day one.
     */
    @Query(value = """
            SELECT to_char((i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date,
                           'YYYY-MM') AS day,
                   COUNT(*) AS invoiceCount,
                   COALESCE(SUM(i."totalAmount"), 0) AS revenue,
                   COALESCE(SUM(i."totalGst"), 0) AS gstCollected
            FROM invoices i
            WHERE i."pharmacyId" = :pharmacyId AND i."isCancelled" = false
              AND i."createdAt" >= :from AND i."createdAt" <= :to
            GROUP BY 1
            ORDER BY 1
            """, nativeQuery = true)
    List<DailySalesRow> monthlySalesSeries(@Param("pharmacyId") String pharmacyId,
                                           @Param("from") Instant from, @Param("to") Instant to);

    interface GstMonthRow {
        String getMonth();
        BigDecimal getTaxable();
        BigDecimal getCgst();
        BigDecimal getSgst();
        BigDecimal getIgst();
    }

    /**
     * Output-tax totals per IST calendar month — the "is my GST liability trending up"
     * chart on the compliance tab. Same {@code AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'}
     * month-bucket rule as {@link #monthlySalesSeries}: one half supplies the zone the naive
     * column lacks, the other does the +5:30 shift, and getting it wrong files a month's tax
     * under the wrong return. Months with no sales are simply absent; the caller zero-fills so
     * the chart keeps a continuous axis.
     */
    @Query(value = """
            SELECT to_char((i."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS month,
                   COALESCE(SUM(i."taxableAmount"), 0) AS taxable,
                   COALESCE(SUM(i.cgst), 0) AS cgst,
                   COALESCE(SUM(i.sgst), 0) AS sgst,
                   COALESCE(SUM(i.igst), 0) AS igst
            FROM invoices i
            WHERE i."pharmacyId" = :pharmacyId AND i."isCancelled" = false
              AND i."createdAt" >= :from AND i."createdAt" <= :to
            GROUP BY 1
            ORDER BY 1
            """, nativeQuery = true)
    List<GstMonthRow> gstMonthlySeries(@Param("pharmacyId") String pharmacyId,
                                       @Param("from") Instant from, @Param("to") Instant to);

    interface CustomerMonthRow {
        String getMonth();
        long getBilled();
        long getNewCount();
    }

    /**
     * Per IST month: how many distinct identified customers were billed, and how many of
     * them were being billed here for the FIRST time ever. "Returning" is the remainder —
     * the caller subtracts. New-vs-returning is decided on the customer's whole history
     * (the {@code firsts} CTE is unbounded by the window), which is the point: someone
     * whose first bill is in March is new in March and returning every month after, and a
     * window-local query cannot tell those apart.
     *
     * <p>Grouped by {@code customerId}, never phone — see the class notes above. Both IST
     * month buckets use the {@code AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'} pair for
     * the same reason {@link #monthlySalesSeries} does.
     */
    @Query(value = """
            WITH firsts AS (
                SELECT "customerId" AS cid, MIN("createdAt") AS first_bill
                FROM invoices
                WHERE "pharmacyId" = :pharmacyId AND "isCancelled" = false AND "customerId" IS NOT NULL
                GROUP BY "customerId"
            ),
            monthly AS (
                SELECT DISTINCT "customerId" AS cid,
                       to_char(("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM') AS ym
                FROM invoices
                WHERE "pharmacyId" = :pharmacyId AND "isCancelled" = false AND "customerId" IS NOT NULL
                  AND "createdAt" >= :from AND "createdAt" <= :to
            )
            SELECT monthly.ym AS month,
                   COUNT(*) AS billed,
                   COUNT(*) FILTER (
                       WHERE to_char((firsts.first_bill AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM')
                             = monthly.ym) AS newCount
            FROM monthly JOIN firsts ON firsts.cid = monthly.cid
            GROUP BY monthly.ym
            ORDER BY monthly.ym
            """, nativeQuery = true)
    List<CustomerMonthRow> customerMonthlySeries(@Param("pharmacyId") String pharmacyId,
                                                 @Param("from") Instant from, @Param("to") Instant to);

    // ── Customer analytics ─────────────────────────────────────────────────────
    //
    // Everything below groups by customerId, NEVER by customerPhone, and the reason is
    // not performance (though there is no index on customerPhone and there is one on
    // customerId). A phone number is not a person here: 196 of the numbers carried over
    // from the previous system are shared between family members — one of them is both
    // MOULESWARAN and RATHA — which is why that import keyed patients on their hospital
    // registration number instead. Grouping by phone would merge a family into a single
    // "customer" and put the wrong name on a call list.
    //
    // Bills with no customerId are walk-ins. They are excluded from every grouping here
    // and counted separately, so the caller can say how much of the period is unattributed
    // rather than quietly under-reporting it.

    interface CustomerActivityRow {
        String getCustomerId();
        long getBills();
        BigDecimal getRevenue();
        Instant getLastVisit();
    }

    @Query("""
            SELECT i.customerId AS customerId, COUNT(i) AS bills,
                   COALESCE(SUM(i.totalAmount), 0) AS revenue, MAX(i.createdAt) AS lastVisit
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND i.customerId IS NOT NULL
              AND i.createdAt >= :from AND i.createdAt <= :to
            GROUP BY i.customerId
            ORDER BY SUM(i.totalAmount) DESC
            """)
    List<CustomerActivityRow> topCustomersInRange(@Param("pharmacyId") String pharmacyId,
                                                  @Param("from") Instant from, @Param("to") Instant to, Limit limit);

    interface CustomerPeriodTotalsRow {
        Long getIdentifiedCustomers();
        Long getIdentifiedBills();
        Long getWalkInBills();
        BigDecimal getIdentifiedRevenue();
    }

    @Query("""
            SELECT COUNT(DISTINCT i.customerId) AS identifiedCustomers,
                   COALESCE(SUM(CASE WHEN i.customerId IS NOT NULL THEN 1 ELSE 0 END), 0) AS identifiedBills,
                   COALESCE(SUM(CASE WHEN i.customerId IS NULL THEN 1 ELSE 0 END), 0) AS walkInBills,
                   COALESCE(SUM(CASE WHEN i.customerId IS NOT NULL THEN i.totalAmount ELSE 0 END), 0) AS identifiedRevenue
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false
              AND i.createdAt >= :from AND i.createdAt <= :to
            """)
    CustomerPeriodTotalsRow customerPeriodTotals(@Param("pharmacyId") String pharmacyId,
                                                 @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Customers whose FIRST EVER bill falls inside the range — the new ones.
     *
     * <p>Scans the customer's whole history rather than the range, which is the entire
     * point: someone billed in July for the first time is new in July, and someone billed
     * in July who also bought last year is not. A range-local query cannot tell them apart
     * and would report every returning customer as new in their first month on the system.
     *
     * <p>Returns the ids rather than a count so the caller can size the list itself; the
     * result is bounded by how many customers are new in one period, not by the table.
     */
    @Query("""
            SELECT i.customerId
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND i.customerId IS NOT NULL
            GROUP BY i.customerId
            HAVING MIN(i.createdAt) >= :from AND MIN(i.createdAt) <= :to
            """)
    List<String> customerIdsFirstBilledInRange(@Param("pharmacyId") String pharmacyId,
                                               @Param("from") Instant from, @Param("to") Instant to);

    /**
     * Customers who bought repeatedly and have since gone quiet — the call list.
     *
     * <p>Deliberately NOT range-scoped. "Has not been in for ninety days" is a fact about
     * today, not about a reporting window, and scoping it to a period would produce the
     * nonsense of someone being lapsed in March and not in April.
     *
     * <p>{@code minVisits} is what separates a lapsed regular from a stranger who came once:
     * a single visit eighteen months ago is not a customer who left, and burying the real
     * ones under thousands of those would make the list unusable. Ordered by lifetime value,
     * so the most expensive silences are at the top.
     */
    @Query("""
            SELECT i.customerId AS customerId, COUNT(i) AS bills,
                   COALESCE(SUM(i.totalAmount), 0) AS revenue, MAX(i.createdAt) AS lastVisit
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId AND i.isCancelled = false AND i.customerId IS NOT NULL
            GROUP BY i.customerId
            HAVING MAX(i.createdAt) < :inactiveSince AND COUNT(i) >= :minVisits
            ORDER BY SUM(i.totalAmount) DESC
            """)
    List<CustomerActivityRow> lapsedCustomers(@Param("pharmacyId") String pharmacyId,
                                              @Param("inactiveSince") Instant inactiveSince,
                                              @Param("minVisits") long minVisits, Limit limit);

    interface LateCancellationRow {
        long getCnt();
        BigDecimal getTaxableValue();
        BigDecimal getTotalGst();
    }

    /**
     * Invoices that were live when a period ended and have been cancelled since.
     *
     * <p>Every compliance query filters {@code isCancelled = false}, and nothing bounds how old
     * an invoice may be when it is cancelled — a CASH bill records no InvoicePayment row, so the
     * "money already collected" guard on cancellation never fires for one. The consequence is
     * quiet: re-run last quarter's GSTR-3B after someone cancels a bill from it and the figures
     * come out lower than what was filed, with nothing on the sheet to say why.
     *
     * <p>Sales returns were deliberately designed to avoid exactly this — a credit note is dated
     * when it is issued, so a closed month cannot move. Cancellation is the hole in that
     * reasoning, and this query is what makes the hole visible instead of closing it: blocking
     * a late cancellation outright would break a legitimate workflow for a correction that is
     * usually harmless, while leaving it silent is what makes it dangerous.
     *
     * <p>{@code cancelledAt > :to} is the whole test. An invoice cancelled INSIDE its own period
     * is not interesting — it never counted towards anything anyone filed. Only one cancelled
     * after the period closed changes an answer that was already given. When {@code to} is in
     * the future (the ordinary "this month so far" case) this cannot match, which is correct.
     */
    @Query("""
            SELECT COUNT(i) AS cnt,
                   COALESCE(SUM(i.taxableAmount), 0) AS taxableValue,
                   COALESCE(SUM(i.totalGst), 0) AS totalGst
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId
              AND i.isCancelled = true
              AND i.createdAt >= :from AND i.createdAt <= :to
              AND i.cancelledAt IS NOT NULL AND i.cancelledAt > :to
            """)
    LateCancellationRow cancelledAfterPeriod(@Param("pharmacyId") String pharmacyId,
                                             @Param("from") Instant from, @Param("to") Instant to);

    // Table 3.2 (inter-state supplies by place of supply) used to live here, reading
    // invoice-level taxableAmount/igst. It moved to InvoiceItemRepository because 3.2 is
    // declared as a SUBSET of 3.1(a) and the portal validates that — deriving the two from
    // different granularities meant a mixed bill's nil-rated value inflated 3.2, credit notes
    // were never deducted from it, and interstate bills with no customer vanished from it
    // entirely. See InvoiceItemRepository.interstateSuppliesByPlaceOfSupply. Do not
    // reintroduce an invoice-level version alongside it.

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
        /** Interstate tax. Omitted originally, so an interstate sale showed CGST 0 + SGST 0
         *  against a non-zero total — figures that could not be reconciled or filed. */
        BigDecimal getIgst();
        BigDecimal getTotalGst();
        /** Flat additions to the bill (delivery and the like). Not a taxable supply — see the query. */
        BigDecimal getExtraCharges();
        /** Signed manual correction applied to the bill. */
        BigDecimal getAdjustmentAmount();
        /** Signed rounding to the nearest rupee, Indian retail convention. */
        BigDecimal getRoundOff();
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

    /**
     * Money still to be collected, across every uncancelled invoice.
     *
     * <p>Was {@code SUM(totalAmount) WHERE paymentStatus = 'PENDING'}, which was wrong
     * in both directions at once:
     * <ul>
     *   <li><b>Understated</b> — a PARTIAL invoice carries a real unpaid balance and was
     *       excluded entirely. Take one rupee against a Rs.5,000 bill and the whole
     *       Rs.5,000 dropped off the figure.</li>
     *   <li><b>Overstated</b> — it summed the full invoice value, ignoring goods that
     *       had since been returned.</li>
     * </ul>
     *
     * <p>Now the actual arithmetic: billed, less returned, less collected. Payments are
     * capped at the outstanding balance when they are recorded, so a line cannot go
     * negative and drag the total down.
     */
    @Query("""
            SELECT COALESCE(SUM(
                       i.totalAmount - i.returnedAmount
                       - COALESCE((SELECT SUM(p.amount) FROM InvoicePayment p WHERE p.invoiceId = i.id), 0)
                   ), 0)
            FROM Invoice i
            WHERE i.pharmacyId = :pharmacyId
              AND i.isCancelled = false
              AND CAST(i.paymentStatus AS string) IN ('PENDING', 'PARTIAL')
            """)
    BigDecimal sumPendingCredit(@Param("pharmacyId") String pharmacyId);

}
