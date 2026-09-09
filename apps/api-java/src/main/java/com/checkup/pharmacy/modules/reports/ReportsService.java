package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.enums.ApprovalStatus;
import com.checkup.pharmacy.common.enums.GRNStatus;
import com.checkup.pharmacy.common.enums.ReturnDisposition;
import com.checkup.pharmacy.common.tax.TaxabilitySplitRow;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.billing.InvoiceItem;
import com.checkup.pharmacy.modules.billing.InvoiceItemRepository;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.billing.SalesReturnItemRepository;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.purchase.GRNItemRepository;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNoteRepository;
import com.checkup.pharmacy.modules.supplierreturn.SupplierReturnRepository;
import com.checkup.pharmacy.modules.reports.dto.CostAnalysisResponse;
import com.checkup.pharmacy.modules.reports.dto.CustomerInsightsResponse;
import com.checkup.pharmacy.modules.reports.dto.DailySalesResponse;
import com.checkup.pharmacy.modules.reports.dto.DeadStockResponse;
import com.checkup.pharmacy.modules.reports.dto.EodSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ExpiryItemResponse;
import com.checkup.pharmacy.modules.reports.dto.FastMovingResponse;
import com.checkup.pharmacy.modules.reports.dto.Gstr3bResponse;
import com.checkup.pharmacy.modules.reports.dto.GstSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.HsnSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.LapsedCustomersResponse;
import com.checkup.pharmacy.modules.reports.dto.MarginReportResponse;
import com.checkup.pharmacy.modules.reports.dto.PurchaseSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ScheduleHItemResponse;
import com.checkup.pharmacy.modules.reports.dto.ValuationResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import com.checkup.pharmacy.common.exception.BadRequestException;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only analytics over billing/inventory/purchase data. Pure reporting —
 * no writes, so every method is {@code @Transactional(readOnly = true)}, and each
 * carries a {@link #REPORT_QUERY_TIMEOUT_SECONDS}-second statement timeout: a report
 * is never on the critical path of a sale, so a pathological range should fail its
 * own request rather than hold one of a small pool of connections open indefinitely
 * while the till waits behind it.
 *
 * <p>Sales trend, cost-analysis, valuation and dead-stock aggregate in SQL. The
 * customer/margin/GST-compliance methods read an already date-filtered, row-capped
 * set and finish the last fold in Java where a hand-rolled JPQL GROUP BY across three
 * joined tables would be less legible for no measurable gain.
 */
@Service
public class ReportsService {

    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);
    private static final int TOP_ITEMS_LIMIT = 10;

    /**
     * Per-query timeout for every method here. Generous enough that a legitimate
     * whole-year compliance query on a busy pharmacy never trips it, tight enough that
     * a runaway range gives the connection back before the shop floor notices.
     */
    private static final int REPORT_QUERY_TIMEOUT_SECONDS = 25;

    /**
     * Safety bound on the Schedule register. Sized generously — a month of
     * controlled-drug sales at a busy pharmacy is well under this, so a legitimate
     * compliance query never trips it, while a runaway multi-year range cannot pull
     * the service over.
     */
    private static final int SCHEDULE_REGISTER_MAX_ROWS = 10_000;

    /** Schedules the register can be filtered to — the same set the UI offers. */
    private static final List<String> REGISTER_SCHEDULES = List.of("H", "H1", "X", "G");

    private static final java.time.format.DateTimeFormatter REPORT_DATE_FMT =
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")
                    .withZone(java.time.ZoneOffset.ofHoursMinutes(5, 30));

    /**
     * Rejects a backwards date range instead of quietly reporting nothing.
     *
     * <p>An inverted range matches no rows, so every report on this screen rendered as
     * a legitimate-looking nil result: zero sales, zero tax, an empty drug register.
     * BillingService has refused this for its own lists for exactly that reason; the
     * reports had no such check, and it matters more here — a GST summary showing zero
     * for a period is a number somebody files.
     */
    private static void validateRange(Instant from, Instant to) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new BadRequestException("The 'from' date (" + REPORT_DATE_FMT.format(from)
                    + ") is after the 'to' date (" + REPORT_DATE_FMT.format(to)
                    + ") — check the date range and try again.");
        }
    }

    /** Upper bound on the sales-trend range — see {@link #dailySalesSeries}. ~2 years. */
    private static final int MAX_TREND_DAYS = 731;

    /**
     * Upper bound on the month-bucketed trend. Five years of monthly bars is already far
     * past what the chart can render legibly; the bound exists so the zero-fill loop
     * below can never be asked to build an unbounded series.
     */
    private static final int MAX_TREND_MONTHS = 60;

    private final InvoiceRepository invoiceRepository;
    private final InvoiceItemRepository invoiceItemRepository;
    private final SalesReturnItemRepository salesReturnItemRepository;
    private final CustomerRepository customerRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository inventoryMovementRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final GRNItemRepository grnItemRepository;
    private final com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository purchaseOrderRepository;
    private final PharmacyRepository pharmacyRepository;
    private final SupplierReturnRepository supplierReturnRepository;
    private final com.checkup.pharmacy.modules.supplier.SupplierRepository supplierRepository;
    private final com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository;

    public ReportsService(InvoiceRepository invoiceRepository, InvoiceItemRepository invoiceItemRepository,
                          SalesReturnItemRepository salesReturnItemRepository,
                          CustomerRepository customerRepository,
                          InventoryRepository inventoryRepository,
                          InventoryMovementRepository inventoryMovementRepository,
                          GoodsReceiptNoteRepository grnRepository, GRNItemRepository grnItemRepository,
                          com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository purchaseOrderRepository,
                          PharmacyRepository pharmacyRepository,
                          SupplierReturnRepository supplierReturnRepository,
                          com.checkup.pharmacy.modules.supplier.SupplierRepository supplierRepository,
                          com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository overrideRepository) {
        this.supplierRepository = supplierRepository;
        this.pharmacyRepository = pharmacyRepository;
        this.supplierReturnRepository = supplierReturnRepository;
        this.invoiceRepository = invoiceRepository;
        this.invoiceItemRepository = invoiceItemRepository;
        this.salesReturnItemRepository = salesReturnItemRepository;
        this.customerRepository = customerRepository;
        this.inventoryRepository = inventoryRepository;
        this.inventoryMovementRepository = inventoryMovementRepository;
        this.grnRepository = grnRepository;
        this.grnItemRepository = grnItemRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.overrideRepository = overrideRepository;
    }

    // ── Sales ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public DailySalesResponse dailySales(String dateStr) {
        String pharmacyId = TenantContext.pharmacyId();
        LocalDate resolved = dateStr != null ? LocalDate.parse(dateStr) : LocalDate.now(IST);
        Instant from = resolved.atStartOfDay(IST).toInstant();
        Instant to = from.plus(Duration.ofDays(1)).minusMillis(1);

        long invoiceCount = invoiceRepository.countActiveInRange(pharmacyId, from, to);
        var agg = invoiceRepository.gstAggregate(pharmacyId, from, to);
        return new DailySalesResponse(resolved.toString(), invoiceCount, agg.getTotalAmount(), agg.getTotalGst());
    }

    /**
     * Sales totals per IST calendar day across a range — one query and one HTTP call for the
     * whole trend chart, replacing the client's day-by-day fan-out (7 requests for a week).
     * Days with no sales come back as explicit zero rows so the caller can plot a continuous
     * axis without having to reconcile gaps itself.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public List<DailySalesResponse> dailySalesSeries(String fromStr, String toStr) {
        return dailySalesSeries(fromStr, toStr, null);
    }

    /**
     * As above, bucketed by IST day or IST month.
     *
     * <p>{@code groupBy=month} exists because the chart's readable width and the query's
     * cheap width are different numbers. A week is seven bars and a month is thirty, both
     * fine; a quarter is ninety and a year is three hundred and sixty-five, in a control
     * sized for seven. Month bucketing turns "This Year" into twelve bars.
     *
     * <p>The {@code date} field of a month bucket is {@code YYYY-MM}, not {@code YYYY-MM-DD}
     * — deliberately not a fake first-of-month date, so a caller cannot mistake a bucket
     * for a day. Anything unrecognised falls back to day bucketing rather than failing:
     * the worst case is a busier chart, which is not worth a 400 to a report screen.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public List<DailySalesResponse> dailySalesSeries(String fromStr, String toStr, String groupByParam) {
        boolean byMonth = "month".equalsIgnoreCase(groupByParam);

        LocalDate today = LocalDate.now(IST);
        // A month-bucketed request with no range wants a year of months, not the seven
        // days that would collapse into a single bar.
        LocalDate defaultStart = byMonth ? today.minusMonths(11).withDayOfMonth(1) : today.minusDays(6);
        LocalDate start = fromStr != null ? LocalDate.parse(fromStr) : defaultStart;
        LocalDate end = toStr != null ? LocalDate.parse(toStr) : today;
        if (start.isAfter(end)) {
            throw new BadRequestException("The start date (" + start + ") is after the end date (" + end
                    + ") — check the range and try again.");
        }

        Instant from = start.atStartOfDay(IST).toInstant();
        Instant to = end.plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1);

        if (byMonth) {
            java.time.YearMonth firstMonth = java.time.YearMonth.from(start);
            java.time.YearMonth lastMonth = java.time.YearMonth.from(end);
            long months = java.time.temporal.ChronoUnit.MONTHS.between(firstMonth, lastMonth) + 1;
            if (months > MAX_TREND_MONTHS) {
                throw new BadRequestException("That range covers " + months
                        + " months — the sales trend supports up to " + MAX_TREND_MONTHS
                        + ". Narrow the range (for example one year at a time).");
            }
            Map<String, InvoiceRepository.DailySalesRow> byMonthKey = new LinkedHashMap<>();
            for (var row : invoiceRepository.monthlySalesSeries(TenantContext.pharmacyId(), from, to)) {
                byMonthKey.put(row.getDay(), row);
            }
            List<DailySalesResponse> series = new ArrayList<>();
            for (java.time.YearMonth m = firstMonth; !m.isAfter(lastMonth); m = m.plusMonths(1)) {
                series.add(toPoint(m.toString(), byMonthKey.get(m.toString())));
            }
            return series;
        }

        // Bound the fan-out: a multi-year range would build tens of thousands of zero rows.
        long span = java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1;
        if (span > MAX_TREND_DAYS) {
            throw new BadRequestException("That range covers " + span + " days — the sales trend supports up to "
                    + MAX_TREND_DAYS + " when grouped by day. Narrow the range, or group by month.");
        }

        Map<String, InvoiceRepository.DailySalesRow> byDay = new LinkedHashMap<>();
        for (var row : invoiceRepository.dailySalesSeries(TenantContext.pharmacyId(), from, to)) {
            byDay.put(row.getDay(), row);
        }

        List<DailySalesResponse> series = new ArrayList<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            series.add(toPoint(d.toString(), byDay.get(d.toString())));
        }
        return series;
    }

    /** A bucket with no sales is an explicit zero row, never a gap — the chart plots a continuous axis. */
    private static DailySalesResponse toPoint(String key, InvoiceRepository.DailySalesRow row) {
        return row == null
                ? new DailySalesResponse(key, 0, BigDecimal.ZERO, BigDecimal.ZERO)
                : new DailySalesResponse(key, row.getInvoiceCount(), round2(row.getRevenue()),
                        round2(row.getGstCollected()));
    }

    /**
     * The period's takings by payment channel. Non-cancelled invoices only, valued at the
     * billed total (what the customer paid), so the slices add up to the same headline the
     * sales trend shows.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public com.checkup.pharmacy.modules.reports.dto.PaymentMixResponse paymentMix(Instant from, Instant to) {
        validateRange(from, to);
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);
        var rows = invoiceRepository.paymentMixInRange(TenantContext.pharmacyId(), f, t);
        BigDecimal total = rows.stream().map(r -> nz(r.getTotal())).reduce(BigDecimal.ZERO, BigDecimal::add);
        long bills = rows.stream().mapToLong(InvoiceRepository.PaymentMixRow::getBills).sum();
        List<com.checkup.pharmacy.modules.reports.dto.PaymentMixResponse.Slice> slices = new ArrayList<>();
        for (var r : rows) {
            BigDecimal amount = round2(nz(r.getTotal()));
            slices.add(new com.checkup.pharmacy.modules.reports.dto.PaymentMixResponse.Slice(
                    r.getMode() != null ? r.getMode() : "OTHER", amount, r.getBills(),
                    round2(percentOf(amount, total))));
        }
        return new com.checkup.pharmacy.modules.reports.dto.PaymentMixResponse(round2(total), bills, slices);
    }

    /** Upper bound on the GST trend — five years of months, past what the chart can show anyway. */
    private static final int MAX_GST_TREND_MONTHS = 60;

    /**
     * Output tax per IST calendar month across a window (default: the last 12 months).
     * Zero-filled so the chart axis is continuous. See {@link #dailySalesSeries} for why the
     * IST month bucket needs both {@code AT TIME ZONE} halves.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public com.checkup.pharmacy.modules.reports.dto.GstTrendResponse gstTrend(Integer monthsParam) {
        int months = clamp(monthsParam, 12, 1, MAX_GST_TREND_MONTHS);
        LocalDate today = LocalDate.now(IST);
        java.time.YearMonth firstMonth = java.time.YearMonth.from(today).minusMonths(months - 1L);
        java.time.YearMonth lastMonth = java.time.YearMonth.from(today);
        Instant from = firstMonth.atDay(1).atStartOfDay(IST).toInstant();
        Instant to = lastMonth.atEndOfMonth().plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1);

        Map<String, InvoiceRepository.GstMonthRow> byMonth = new LinkedHashMap<>();
        for (var row : invoiceRepository.gstMonthlySeries(TenantContext.pharmacyId(), from, to)) {
            byMonth.put(row.getMonth(), row);
        }
        List<com.checkup.pharmacy.modules.reports.dto.GstTrendResponse.Month> series = new ArrayList<>();
        for (java.time.YearMonth m = firstMonth; !m.isAfter(lastMonth); m = m.plusMonths(1)) {
            var row = byMonth.get(m.toString());
            BigDecimal cgst = row != null ? round2(nz(row.getCgst())) : BigDecimal.ZERO.setScale(2);
            BigDecimal sgst = row != null ? round2(nz(row.getSgst())) : BigDecimal.ZERO.setScale(2);
            BigDecimal igst = row != null ? round2(nz(row.getIgst())) : BigDecimal.ZERO.setScale(2);
            BigDecimal taxable = row != null ? round2(nz(row.getTaxable())) : BigDecimal.ZERO.setScale(2);
            series.add(new com.checkup.pharmacy.modules.reports.dto.GstTrendResponse.Month(
                    m.toString(), taxable, cgst, sgst, igst, cgst.add(sgst).add(igst)));
        }
        return new com.checkup.pharmacy.modules.reports.dto.GstTrendResponse(series);
    }

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public GstSummaryResponse gstSummary(Instant from, Instant to) {
        validateRange(from, to);
        var agg = invoiceRepository.gstAggregate(TenantContext.pharmacyId(), DateRange.from(from), DateRange.to(to));
        // Every column the invoice identity needs, so the screen reconciles:
        // taxable + GST + charges + adjustment + round-off == net. See GstSummaryResponse.Sum.
        return new GstSummaryResponse(new GstSummaryResponse.Sum(agg.getSubtotal(), agg.getDiscountAmount(),
                agg.getTaxableAmount(), agg.getCgst(), agg.getSgst(), agg.getIgst(), agg.getTotalGst(),
                agg.getExtraCharges(), agg.getAdjustmentAmount(), agg.getRoundOff(),
                agg.getTotalAmount()),
                agg.getCnt());
    }

    /**
     * Gross margin on the period's sales — revenue net of GST and discounts, against the
     * actual batch cost recorded on every line at the moment it was billed.
     *
     * <p>Three deliberate choices, each of which changes the answer:
     *
     * <p><b>Returns are netted at the event, not at the original sale.</b> A refund raised
     * this month reduces this month, even when the bill it reverses is older. The
     * alternative — restating a closed period every time something comes back — would make
     * a figure the pharmacist already looked at change underneath them.
     *
     * <p><b>A write-off keeps its cost.</b> Restocked goods return to the shelf, so their
     * cost comes back out of COGS; written-off goods do not, so the pharmacy is out both
     * the refund and the stock. Netting the two together would hide the more expensive one.
     *
     * <p><b>Uncosted lines are declared, not absorbed.</b> Any line with no purchase rate
     * behind it reads as pure profit. Rather than quietly inflating the margin, the
     * response reports what share of revenue could actually be costed, so a number built
     * on partial data announces itself.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public MarginReportResponse marginReport(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 15, 1, 100);
        String pharmacyId = TenantContext.pharmacyId();
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);

        var totals = invoiceItemRepository.marginTotals(pharmacyId, f, t);
        var returns = salesReturnItemRepository.returnMarginTotals(pharmacyId, f, t, ReturnDisposition.RESTOCK);

        BigDecimal grossRevenue = nz(totals.getRevenueExGst());
        BigDecimal refund = nz(returns.getRefundExGst());
        BigDecimal restockedCost = nz(returns.getRestockedCost());
        BigDecimal writtenOffCost = nz(returns.getWrittenOffCost());

        BigDecimal netRevenue = grossRevenue.subtract(refund);
        // Only restocked cost comes back. Written-off cost stays charged — that is what
        // makes a write-off cost the pharmacy twice, and the point of separating them.
        BigDecimal netCogs = nz(totals.getCogs()).subtract(restockedCost);
        BigDecimal grossProfit = netRevenue.subtract(netCogs);

        BigDecimal revenueMissingCost = nz(totals.getRevenueMissingCost());
        BigDecimal costedRevenuePct = grossRevenue.signum() > 0
                ? grossRevenue.subtract(revenueMissingCost).divide(grossRevenue, 6, RoundingMode.HALF_UP)
                        .multiply(BigDecimal.valueOf(100))
                : BigDecimal.valueOf(100);

        var quality = new MarginReportResponse.DataQuality(round2(costedRevenuePct),
                nzLong(totals.getLinesMissingCost()), round2(revenueMissingCost), nzLong(totals.getLineCount()));

        // Null, not a zeroed record, when this pharmacy has never sold anything loose in the
        // period — the panel below only renders the bar when there is something to show.
        var looseTotals = invoiceItemRepository.looseSalesTotals(pharmacyId, f, t);
        MarginReportResponse.LooseSales looseSales = nzLong(looseTotals.getBillCount()) > 0
                ? new MarginReportResponse.LooseSales(round2(nz(looseTotals.getRevenueExGst())),
                        nzLong(looseTotals.getPiecesSold()), nzLong(looseTotals.getLineCount()),
                        nzLong(looseTotals.getBillCount()))
                : null;

        // Both lists are enriched from ONE batch lookup — two calls to
        // findByIdInWithMedicine would be two round trips for overlapping ids.
        var contributorRows = invoiceItemRepository.marginByInventory(pharmacyId, f, t, Limit.of(limit));
        var lossRows = invoiceItemRepository.lossMakingByInventory(pharmacyId, f, t, Limit.of(limit));
        List<String> ids = java.util.stream.Stream
                .concat(contributorRows.stream(), lossRows.stream())
                .map(InvoiceItemRepository.MarginGroupRow::getInventoryId)
                .distinct()
                .toList();
        Map<String, Inventory> byId = ids.isEmpty() ? Map.of()
                : inventoryRepository.findByIdInWithMedicine(pharmacyId, ids).stream()
                        .collect(java.util.stream.Collectors.toMap(Inventory::getId, i -> i));

        return new MarginReportResponse(round2(netRevenue), round2(netCogs),
                new MarginReportResponse.Returns(round2(refund), round2(restockedCost), round2(writtenOffCost),
                        returns.getUnitsReturned()),
                round2(grossProfit),
                round2(percentOf(grossProfit, netRevenue)),
                nzLong(totals.getUnitsSold()),
                looseSales,
                quality,
                toMarginItems(contributorRows, byId),
                toMarginItems(lossRows, byId));
    }

    private List<MarginReportResponse.Item> toMarginItems(List<InvoiceItemRepository.MarginGroupRow> rows,
                                                          Map<String, Inventory> byId) {
        List<MarginReportResponse.Item> items = new ArrayList<>();
        for (var row : rows) {
            Inventory inv = byId.get(row.getInventoryId());
            BigDecimal revenue = nz(row.getRevenueExGst());
            BigDecimal cogs = nz(row.getCogs());
            BigDecimal profit = revenue.subtract(cogs);
            // productX() falls back to the local medicine (see PharmacyMedicine) when this
            // batch was never linked to the global catalogue — inv.getMedicine() alone read
            // null for it even though the revenue/cost figures above resolve fine.
            MarginReportResponse.MedicineRef medicineRef = inv != null && inv.productName() != null
                    ? new MarginReportResponse.MedicineRef(inv.productId(), inv.productName(),
                            inv.productGenericName(), inv.productForm())
                    : null;
            items.add(new MarginReportResponse.Item(row.getInventoryId(), medicineRef,
                    row.getQty() != null ? row.getQty() : 0L,
                    round2(revenue), round2(cogs), round2(profit), round2(percentOf(profit, revenue)),
                    inv != null ? inv.getBatchNumber() : null));
        }
        return items;
    }

    /**
     * {@code part} as a percentage of {@code whole}, guarding the zero denominator.
     *
     * <p>Zero revenue with a real cost behind it reports -100%, not 0%: a line given away
     * entirely as free goods lost every rupee it cost, and 0% would read as "broke even".
     */
    private static BigDecimal percentOf(BigDecimal part, BigDecimal whole) {
        if (whole.signum() > 0) {
            return part.divide(whole, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100));
        }
        return part.signum() < 0 ? BigDecimal.valueOf(-100) : BigDecimal.ZERO;
    }

    // ── Customers ────────────────────────────────────────────────────────────

    /**
     * Who bought in the period, how many of them were new, and how much of it was anonymous.
     *
     * <p>New-versus-returning is decided on the customer's whole history, not on the range:
     * someone billed in July for the first time is new in July, someone billed in July who
     * also bought last year is not, and a range-local query cannot tell the two apart.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public CustomerInsightsResponse customerInsights(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 15, 1, 100);
        String pharmacyId = TenantContext.pharmacyId();
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);

        var totals = invoiceRepository.customerPeriodTotals(pharmacyId, f, t);
        long billed = nzLong(totals.getIdentifiedCustomers());
        long identifiedBills = nzLong(totals.getIdentifiedBills());
        long walkInBills = nzLong(totals.getWalkInBills());

        // Intersected with the period's customers rather than trusted on its own: the query
        // answers "first billed in this window", which for a future-dated range could name a
        // customer who has no bill inside it at all.
        long newCustomers = 0;
        if (billed > 0) {
            java.util.Set<String> firstTimers =
                    new java.util.HashSet<>(invoiceRepository.customerIdsFirstBilledInRange(pharmacyId, f, t));
            newCustomers = Math.min(firstTimers.size(), billed);
        }
        long returning = Math.max(billed - newCustomers, 0);

        long allBills = identifiedBills + walkInBills;
        BigDecimal walkInShare = allBills > 0
                ? percentOf(BigDecimal.valueOf(walkInBills), BigDecimal.valueOf(allBills))
                : BigDecimal.ZERO;
        BigDecimal repeatRate = billed > 0
                ? percentOf(BigDecimal.valueOf(returning), BigDecimal.valueOf(billed))
                : BigDecimal.ZERO;

        var rows = invoiceRepository.topCustomersInRange(pharmacyId, f, t, Limit.of(limit));
        Map<String, Customer> byId = customersFor(rows);
        List<CustomerInsightsResponse.Customer> top = new ArrayList<>();
        for (var row : rows) {
            Customer c = byId.get(row.getCustomerId());
            top.add(new CustomerInsightsResponse.Customer(row.getCustomerId(),
                    c != null ? c.getName() : "Unknown", c != null ? c.getPhone() : null,
                    row.getBills(), round2(row.getRevenue()), row.getLastVisit()));
        }

        return new CustomerInsightsResponse(billed, newCustomers, returning, round2(repeatRate),
                round2(totals.getIdentifiedRevenue()),
                new CustomerInsightsResponse.WalkIns(walkInBills, round2(walkInShare)), top);
    }

    /** Upper bound on the customer trend — the query is heavier than the GST one (two CTEs). */
    private static final int MAX_CUSTOMER_TREND_MONTHS = 36;

    /**
     * Identified customers billed per IST month over a trailing window (default 12 months),
     * split new vs returning on the customer's whole history. Zero-filled so the chart axis
     * is continuous.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public com.checkup.pharmacy.modules.reports.dto.CustomerTrendResponse customerTrend(Integer monthsParam) {
        int months = clamp(monthsParam, 12, 1, MAX_CUSTOMER_TREND_MONTHS);
        LocalDate today = LocalDate.now(IST);
        java.time.YearMonth firstMonth = java.time.YearMonth.from(today).minusMonths(months - 1L);
        java.time.YearMonth lastMonth = java.time.YearMonth.from(today);
        Instant from = firstMonth.atDay(1).atStartOfDay(IST).toInstant();
        Instant to = lastMonth.atEndOfMonth().plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1);

        Map<String, InvoiceRepository.CustomerMonthRow> byMonth = new LinkedHashMap<>();
        for (var row : invoiceRepository.customerMonthlySeries(TenantContext.pharmacyId(), from, to)) {
            byMonth.put(row.getMonth(), row);
        }
        List<com.checkup.pharmacy.modules.reports.dto.CustomerTrendResponse.Month> series = new ArrayList<>();
        for (java.time.YearMonth m = firstMonth; !m.isAfter(lastMonth); m = m.plusMonths(1)) {
            var row = byMonth.get(m.toString());
            long billed = row != null ? row.getBilled() : 0;
            long newCount = row != null ? row.getNewCount() : 0;
            series.add(new com.checkup.pharmacy.modules.reports.dto.CustomerTrendResponse.Month(
                    m.toString(), billed, newCount, Math.max(billed - newCount, 0)));
        }
        return new com.checkup.pharmacy.modules.reports.dto.CustomerTrendResponse(series);
    }

    /**
     * Regulars who have gone quiet, worth the most first.
     *
     * <p>Not date-ranged, deliberately — see {@code InvoiceRepository.lapsedCustomers}. The
     * two knobs are how long counts as gone and how many past visits count as a regular; both
     * are clamped rather than trusted, because this reads the customer's entire history and
     * an unbounded limit would hand back every name the pharmacy has ever billed.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public LapsedCustomersResponse lapsedCustomers(Integer inactiveDaysParam, Integer minVisitsParam,
                                                   Integer limitParam) {
        int inactiveDays = clamp(inactiveDaysParam, 90, 7, 730);
        int minVisits = clamp(minVisitsParam, 2, 1, 50);
        int limit = clamp(limitParam, 50, 1, 200);

        Instant inactiveSince = Instant.now().minus(Duration.ofDays(inactiveDays));
        var rows = invoiceRepository.lapsedCustomers(TenantContext.pharmacyId(), inactiveSince,
                minVisits, Limit.of(limit));
        Map<String, Customer> byId = customersFor(rows);

        Instant now = Instant.now();
        List<LapsedCustomersResponse.Item> items = new ArrayList<>();
        BigDecimal valueAtRisk = BigDecimal.ZERO;
        for (var row : rows) {
            Customer c = byId.get(row.getCustomerId());
            BigDecimal revenue = round2(row.getRevenue());
            valueAtRisk = valueAtRisk.add(revenue);
            long silentDays = row.getLastVisit() != null
                    ? Duration.between(row.getLastVisit(), now).toDays() : 0;
            items.add(new LapsedCustomersResponse.Item(row.getCustomerId(),
                    c != null ? c.getName() : "Unknown", c != null ? c.getPhone() : null,
                    row.getBills(), revenue, row.getLastVisit(), silentDays));
        }
        return new LapsedCustomersResponse(inactiveDays, minVisits, round2(valueAtRisk), items);
    }

    /**
     * Names and phone numbers for a page of grouped rows, in one tenant-scoped lookup.
     *
     * <p>Reads the CUSTOMER record rather than the name snapshotted onto each invoice. The
     * snapshot is right for reprinting an old bill; this is a call list, so it wants the
     * number that is current — and for the migrated history the customer record holds the
     * name reconciled across all of that patient's bills, while any single invoice may carry
     * a one-off misspelling.
     */
    private Map<String, Customer> customersFor(List<InvoiceRepository.CustomerActivityRow> rows) {
        if (rows.isEmpty()) {
            return Map.of();
        }
        List<String> ids = rows.stream().map(InvoiceRepository.CustomerActivityRow::getCustomerId).toList();
        return customerRepository.findByIdInAndPharmacyId(ids, TenantContext.pharmacyId()).stream()
                .collect(java.util.stream.Collectors.toMap(Customer::getId, c -> c));
    }

    // ── GSTR-3B ──────────────────────────────────────────────────────────────

    /** Bounded so one misconfigured pharmacy cannot return an unusable wall of GRN numbers. */
    private static final int MAX_FLAGGED_GRNS = 50;

    /**
     * The figures for a GSTR-3B, assembled from documents this system actually holds.
     *
     * <p>Deliberately a working sheet, not a return. Every table is either derived from real
     * invoices, credit notes and goods receipts, or reported as zero with the reason recorded
     * in {@code dataQuality} — because a tax summary that silently omits what it cannot see is
     * more dangerous than one that says so, the gaps being invisible once the numbers are on
     * the page.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public Gstr3bResponse gstr3b(Instant from, Instant to) {
        validateRange(from, to);
        String pharmacyId = TenantContext.pharmacyId();
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);

        Pharmacy pharmacy = pharmacyRepository.findById(pharmacyId).orElse(null);
        String state = pharmacy != null ? pharmacy.getState() : null;
        String gstin = pharmacy != null ? pharmacy.getGstin() : null;

        // 3.1 — outward, split taxable vs nil-rated on each LINE's rate, then netted against
        // the credit notes raised in the same period.
        var sales = splitByTaxability(invoiceItemRepository.outwardSuppliesByTaxability(pharmacyId, f, t));
        var credits = splitByTaxability(salesReturnItemRepository.creditNotesByTaxability(pharmacyId, f, t));

        // Netting can go below zero — a quiet month following a large refund, or a bill
        // returned weeks after it was raised. GSTR-3B has no way to express that: the portal
        // rejects a negative 3.1, and the correct treatment is to file nil and carry the
        // unabsorbed credit into the next period. So the figures are floored, and exactly what
        // was floored away is reported in dataQuality rather than quietly disappearing.
        Gstr3bResponse.TaxAmount netTaxable = subtract(sales.taxable(), credits.taxable());
        Gstr3bResponse.TaxAmount netNilRated = subtract(sales.exempt(), credits.exempt());

        Gstr3bResponse.TaxAmount taxableOutward = floorAmount(netTaxable);
        Gstr3bResponse.TaxAmount nilRated = floorAmount(netNilRated);
        Gstr3bResponse.TaxAmount carryForward = add(excessOf(netTaxable), excessOf(netNilRated));
        Gstr3bResponse.TaxAmount creditNotes = add(credits.taxable(), credits.exempt());

        // 3.2 — of the supplies in 3.1(a), those made inter-state, by the state supplied to.
        // Built from the same LINES as 3.1(a) and netted against the same credit notes, so
        // the subset relationship the portal validates holds by construction.
        var placesOfSupply = placesOfSupply(
                invoiceItemRepository.interstateSuppliesByPlaceOfSupply(pharmacyId, f, t),
                salesReturnItemRepository.interstateCreditNotesByPlaceOfSupply(pharmacyId, f, t));

        // 4 — credit on goods received, less credit reversed by debit notes.
        //
        // The debit notes land in 4(B)(2) "Others", not 4(B)(1). 4(B)(1) is for rules 38/42/43
        // and section 17(5) — permanent reversals where the credit was never yours. A purchase
        // return is not that: the credit was valid and is being unwound because the goods went
        // back. Putting the two in one row makes a later reclaim through 4(D)(1) unsupportable.
        //
        // 4(B)(1) is the section 17(5) reversal, derived from expired stock written off in the
        // period. Split into equal CGST and SGST halves because a pharmacy buys locally almost
        // without exception; the sheet declares that assumption rather than hiding it, since the
        // batch itself does not record which head its credit was originally claimed under.
        var purchases = splitByTaxability(grnItemRepository.inwardSuppliesByTaxability(pharmacyId, f, t));
        var reversal = supplierReturnRepository.itcReversedInRange(pharmacyId, f, t);
        Gstr3bResponse.TaxAmount reversedOther = new Gstr3bResponse.TaxAmount(BigDecimal.ZERO,
                round2(reversal.getIgst()), round2(reversal.getCgst()), round2(reversal.getSgst()));

        var writeOffs = inventoryMovementRepository.expiryWriteOffItc(pharmacyId, f, t);
        BigDecimal blockedItc = nz(writeOffs.getItc());
        BigDecimal blockedHalf = round2(blockedItc.divide(BigDecimal.valueOf(2), 10, RoundingMode.HALF_UP));
        // taxableValue stays ZERO. Table 4 has no taxable-value column — it is IGST/CGST/SGST
        // only — and 4(C) is computed by subtracting 4(B) from 4(A) field by field. Putting the
        // cost of the destroyed stock in that slot (it was briefly there, and it looked
        // informative) made 4(C) report a taxable value of MINUS the write-off cost: a figure
        // that is not wrong so much as meaningless, sitting in a column nothing should net.
        // The cost is reported in dataQuality.expiredStock and on the write-off response, which
        // is where an accountant reconciling the reversal actually looks for it.
        Gstr3bResponse.TaxAmount reversedSection17 = blockedItc.signum() == 0
                ? Gstr3bResponse.TaxAmount.zero()
                : new Gstr3bResponse.TaxAmount(BigDecimal.ZERO, BigDecimal.ZERO,
                        blockedHalf, blockedHalf);
        Gstr3bResponse.TaxAmount itc = purchases.taxable();

        var quality = buildDataQuality(pharmacyId, f, t, gstin, state, carryForward,
                placesOfSupply.unknownTaxableValue());

        return new Gstr3bResponse(
                REPORT_DATE_FMT.format(f) + " to " + REPORT_DATE_FMT.format(t),
                new Gstr3bResponse.Identity(pharmacy != null ? pharmacy.getName() : null, gstin, state),
                new Gstr3bResponse.OutwardSupplies(taxableOutward, Gstr3bResponse.TaxAmount.zero(), nilRated,
                        Gstr3bResponse.TaxAmount.zero(), Gstr3bResponse.TaxAmount.zero(), creditNotes),
                placesOfSupply.rows(),
                new Gstr3bResponse.InputTaxCredit(itc, reversedSection17, reversedOther,
                        subtract(subtract(itc, reversedSection17), reversedOther)),
                purchases.exempt(),
                quality);
    }

    private Gstr3bResponse.DataQuality buildDataQuality(String pharmacyId, Instant from, Instant to,
                                                        String gstin, String state,
                                                        Gstr3bResponse.TaxAmount carryForward,
                                                        BigDecimal interstateWithoutPlaceOfSupply) {
        List<String> notes = new ArrayList<>();
        notes.add("Table 3.1(b) zero-rated, 3.1(e) non-GST: this system records neither, so both read nil.");
        notes.add("Table 3.1(d) reverse charge: inward supplies liable to reverse charge (freight, "
                + "unregistered purchases) are not recorded and must be added by hand.");
        notes.add("Table 3.2 treats every customer as unregistered — no GSTIN is held for customers. "
                + "Move any supply to a registered buyer to the B2B section yourself.");
        notes.add("Table 4(B)(1) covers expired stock WRITTEN OFF in this period, split as CGST+SGST "
                + "because a pharmacy buys locally almost without exception. A batch does not record "
                + "which head its credit was claimed under, so move any inter-state purchase to IGST "
                + "by hand. Stock lost to shrinkage or damage is not included — only expiry is "
                + "recorded as a disposal.");
        notes.add("Table 4(D) is informational and left blank: 4(D)(1) reclaims need a record of what "
                + "was reversed under 4(B)(2) in an earlier period, and 4(D)(2) covers credit barred by "
                + "section 16(4) or place-of-supply rules. Neither is tracked.");
        notes.add("Table 6.1 payment of tax is a cash-versus-credit decision and is left to the filer.");
        notes.add("Input credit is dated by when a goods receipt was CONFIRMED, not by the supplier's "
                + "invoice date.");

        // Only meaningful once we know where the pharmacy is; without a state every purchase was
        // treated as local and the flag would fire on all of them for the wrong reason.
        // Canonicalised here so SQL only has to normalise the supplier side — and so this check
        // uses the SAME notion of "same state" that decided the tax it is auditing.
        List<String> flagged = (state == null || state.isBlank()) ? List.of()
                : grnItemRepository.misclassifiedInterstateGrns(pharmacyId, from, to,
                        com.checkup.pharmacy.common.tax.TaxJurisdiction.canonicalKey(state.trim()),
                        Limit.of(MAX_FLAGGED_GRNS));

        var coverage = supplierRepository.stateCoverage(pharmacyId);
        if (coverage.getWithoutState() > 0) {
            notes.add("Interstate purchase tax is decided by supplier state. Suppliers with no "
                    + "state recorded are treated as local, and the flagged-receipt check above "
                    + "cannot see them at all — fill in supplier states before relying on it.");
        }

        if (carryForward.taxableValue().signum() > 0) {
            notes.add("Credit notes exceeded supplies this period. GSTR-3B cannot be filed with a "
                    + "negative 3.1, so the excess above has been floored to nil — carry it into the "
                    + "next period's 3.1 instead of entering a negative figure.");
        }
        if (interstateWithoutPlaceOfSupply.signum() > 0) {
            notes.add("Some inter-state supplies have no place of supply recorded (no customer on the "
                    + "bill, or a customer with no state). They are shown as a separate unnamed row in "
                    + "3.2 — the portal needs a state against every one, so assign them before filing.");
        }

        var cancelled = invoiceRepository.cancelledAfterPeriod(pharmacyId, from, to);
        var lateCancellations = cancelled.getCnt() == 0
                ? Gstr3bResponse.LateCancellations.none()
                : new Gstr3bResponse.LateCancellations(cancelled.getCnt(),
                        round2(cancelled.getTaxableValue()), round2(cancelled.getTotalGst()));
        if (lateCancellations.count() > 0) {
            notes.add("Bills from this period have been cancelled since it ended. Their value is no "
                    + "longer included above, so if you have already filed this period these figures "
                    + "no longer match what you filed — reconcile before filing anything else.");
        }

        // Dated "as at the end of the period", not as at today: a batch that expired after this
        // period closed was still good stock while the period was open, and its credit was not
        // reversible then. Asking today's question of a closed month would overstate it.
        var expired = inventoryRepository.expiredStockOnBooks(pharmacyId, to);
        var expiredStock = expired.getBatches() == 0
                ? Gstr3bResponse.ExpiredStock.none()
                : new Gstr3bResponse.ExpiredStock(expired.getBatches(), nzLong(expired.getUnits()),
                        round2(expired.getCost()), round2(expired.getEmbeddedItc()));
        if (expiredStock.batches() > 0) {
            notes.add("Expired stock is still on the books, so its input credit has not been reversed yet. "
                    + "Section 17(5)(h) blocks credit on destroyed goods: write these batches off to move "
                    + "the amount into Table 4(B)(1) for the period you dispose of them.");
        }

        return new Gstr3bResponse.DataQuality(gstin == null || gstin.isBlank(),
                state == null || state.isBlank(), flagged,
                coverage.getWithoutState(), coverage.getTotal(),
                carryForward, lateCancellations, interstateWithoutPlaceOfSupply, expiredStock, notes);
    }

    /**
     * Table 3.2's rows, plus the one thing about them the filer has to be told.
     *
     * @param rows                 one per place of supply, a null state meaning "could not be
     *                             determined" and always sorted last
     * @param unknownTaxableValue  how much of 3.2 landed in that bucket, so a sheet that cannot
     *                             say where a supply went announces it instead of just showing
     *                             a blank row
     */
    private record PlacesOfSupply(List<Gstr3bResponse.PlaceOfSupply> rows, BigDecimal unknownTaxableValue) {
    }

    /**
     * Fold the outward and credit-note halves of Table 3.2 into one net set of rows.
     *
     * <p>Both sides come from line items filtered exactly as 3.1(a) is, so 3.2 is a genuine
     * subset of it rather than a differently-derived figure that happens to look similar. The
     * portal validates that relationship and rejects a return where 3.2 is larger.
     *
     * <p>Null, empty and whitespace-only states fold into ONE bucket keyed by the empty string
     * and reported with a null state. All three mean the same thing — nobody recorded where
     * this went — and splitting them across separate rows would present a data-entry artefact
     * as if it were geography.
     *
     * <p>Each bucket is floored at zero for the same reason 3.1(a) is: a state where the
     * period's credit notes exceed its sales cannot be filed as a negative, and the excess
     * belongs to the next period. See {@link #floor} — the amount floored away is reported
     * rather than silently dropped.
     */
    private static PlacesOfSupply placesOfSupply(List<? extends InvoiceItemRepository.PlaceOfSupplyRow> sales,
                                                 List<? extends InvoiceItemRepository.PlaceOfSupplyRow> credits) {
        Map<String, BigDecimal[]> byState = new LinkedHashMap<>();
        accumulatePlaces(byState, sales, false);
        accumulatePlaces(byState, credits, true);

        List<Gstr3bResponse.PlaceOfSupply> rows = new ArrayList<>();
        BigDecimal unknown = BigDecimal.ZERO;
        for (var entry : byState.entrySet()) {
            BigDecimal taxable = floor(entry.getValue()[0]);
            BigDecimal igst = floor(entry.getValue()[1]);
            // A state whose sales and refunds cancelled out exactly carries no information;
            // an empty row on a tax return is noise the filer has to think about and discard.
            if (taxable.signum() == 0 && igst.signum() == 0) {
                continue;
            }
            boolean known = !entry.getKey().isEmpty();
            if (!known) {
                unknown = taxable;
            }
            rows.add(new Gstr3bResponse.PlaceOfSupply(known ? entry.getKey() : null, round2(taxable), round2(igst)));
        }
        rows.sort(java.util.Comparator.comparing(Gstr3bResponse.PlaceOfSupply::state,
                java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())));
        return new PlacesOfSupply(rows, round2(unknown));
    }

    private static void accumulatePlaces(Map<String, BigDecimal[]> byState,
                                         List<? extends InvoiceItemRepository.PlaceOfSupplyRow> rows,
                                         boolean subtract) {
        for (var row : rows) {
            String raw = row.getPlaceOfSupply();
            String key = raw == null || raw.isBlank() ? "" : raw.trim();
            BigDecimal[] totals = byState.computeIfAbsent(key,
                    k -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO});
            BigDecimal taxable = nz(row.getTaxableValue());
            BigDecimal igst = nz(row.getIgst());
            totals[0] = subtract ? totals[0].subtract(taxable) : totals[0].add(taxable);
            totals[1] = subtract ? totals[1].subtract(igst) : totals[1].add(igst);
        }
    }

    /** The taxable and nil-rated halves of a two-row taxability split. */
    private record Taxability(Gstr3bResponse.TaxAmount taxable, Gstr3bResponse.TaxAmount exempt) {
    }

    /**
     * Fold a grouped taxable/exempt result into a fixed pair.
     *
     * <p>The query returns at most two rows and possibly none — a period with only nil-rated
     * sales has no taxable row at all. Reading them positionally would put nil-rated figures in
     * the taxable bucket for exactly that pharmacy, so each row is placed by its own flag and
     * anything absent stays zero.
     */
    private static Taxability splitByTaxability(List<? extends TaxabilitySplitRow> rows) {
        Gstr3bResponse.TaxAmount taxable = Gstr3bResponse.TaxAmount.zero();
        Gstr3bResponse.TaxAmount exempt = Gstr3bResponse.TaxAmount.zero();
        for (TaxabilitySplitRow r : rows) {
            var amount = new Gstr3bResponse.TaxAmount(round2(r.getTaxableValue()), round2(r.getIgst()),
                    round2(r.getCgst()), round2(r.getSgst()));
            if (Boolean.TRUE.equals(r.getTaxable())) {
                taxable = amount;
            } else {
                exempt = amount;
            }
        }
        return new Taxability(taxable, exempt);
    }

    /**
     * Zero, or the value if it is already positive.
     *
     * <p>GSTR-3B has no representation for a negative supply. When a period's credit notes
     * exceed its sales — a quiet month after a large bill came back, which is ordinary rather
     * than exotic — the return is filed nil and the unabsorbed credit is carried into the next
     * period. Flooring here is what makes the sheet transcribable; {@link #excessOf} is what
     * keeps it honest, by reporting the part that was floored away.
     */
    private static BigDecimal floor(BigDecimal value) {
        return nz(value).max(BigDecimal.ZERO);
    }

    /** How far below zero a value went, as a positive number. Zero when it did not. */
    private static BigDecimal excess(BigDecimal value) {
        return nz(value).min(BigDecimal.ZERO).abs();
    }

    private static Gstr3bResponse.TaxAmount floorAmount(Gstr3bResponse.TaxAmount a) {
        return new Gstr3bResponse.TaxAmount(floor(a.taxableValue()), floor(a.igst()),
                floor(a.cgst()), floor(a.sgst()));
    }

    /** The part of a netted figure that could not be filed this period, as positive amounts. */
    private static Gstr3bResponse.TaxAmount excessOf(Gstr3bResponse.TaxAmount a) {
        return new Gstr3bResponse.TaxAmount(excess(a.taxableValue()), excess(a.igst()),
                excess(a.cgst()), excess(a.sgst()));
    }

    private static Gstr3bResponse.TaxAmount add(Gstr3bResponse.TaxAmount a, Gstr3bResponse.TaxAmount b) {
        return new Gstr3bResponse.TaxAmount(a.taxableValue().add(b.taxableValue()), a.igst().add(b.igst()),
                a.cgst().add(b.cgst()), a.sgst().add(b.sgst()));
    }

    private static Gstr3bResponse.TaxAmount subtract(Gstr3bResponse.TaxAmount a, Gstr3bResponse.TaxAmount b) {
        return new Gstr3bResponse.TaxAmount(a.taxableValue().subtract(b.taxableValue()),
                a.igst().subtract(b.igst()), a.cgst().subtract(b.cgst()), a.sgst().subtract(b.sgst()));
    }

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public List<ExpiryItemResponse> expiryReport(Integer daysParam, Integer limitParam) {
        int days = clamp(daysParam, 90, 1, 365);
        int limit = clamp(limitParam, 500, 1, 1000);
        Instant threshold = Instant.now().plus(Duration.ofDays(days));
        // The limit goes to the DATABASE. It used to be applied here as
        // .stream().limit(n) over an unbounded query — which looks like a bound but
        // is not one: Postgres still returned every matching row, the driver
        // transferred them, Hibernate materialised them all, and Java then threw most
        // of them away. The endpoint already advertised a limit; now it actually has one.
        return inventoryRepository.findExpiryAlerts(TenantContext.pharmacyId(), threshold,
                        PageRequest.of(0, limit)).stream()
                // productName() falls back to the local medicine (see PharmacyMedicine) when
                // this batch was never linked to the global catalogue — i.getMedicine() alone
                // read null for it, so a local medicine nearing expiry showed up unlabeled.
                .map(i -> new ExpiryItemResponse(i.getId(), i.getQuantity(), i.getLooseUnits(), i.getExpiryDate(),
                        i.getBatchNumber(), i.getMrp(), new ExpiryItemResponse.MedicineRef(i.productName())))
                .toList();
    }

    // ── Purchases ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public PurchaseSummaryResponse purchaseSummary(Instant from, Instant to) {
        validateRange(from, to);
        String pharmacyId = TenantContext.pharmacyId();
        var grnAgg = grnRepository.sumConfirmedInRange(pharmacyId, DateRange.from(from), DateRange.to(to));
        long overduePayments = grnRepository.countOverdue(pharmacyId, Instant.now());
        long pendingApprovals = purchaseOrderRepository.countByPharmacyIdAndApprovalStatus(
                pharmacyId, ApprovalStatus.PENDING_APPROVAL);
        return new PurchaseSummaryResponse(
                grnRepository.countByPharmacyIdAndStatus(pharmacyId, GRNStatus.DRAFT),
                overduePayments,
                pendingApprovals,
                grnAgg.getTotal());
    }

    /**
     * Purchase cost analysis for a range — a top-N table of the biggest spends, plus period
     * grand totals.
     *
     * <p>Aggregated in SQL ({@code GROUP BY} medicine, {@code Limit} on the row set) rather
     * than by loading every confirmed GRN line into memory: this feeds a screen a pharmacist
     * can point at a whole year, and the old in-memory grouping was bounded only by how much
     * the pharmacy bought.
     *
     * <p>The summary totals come from a SEPARATE query over the whole period, not from summing
     * the table. The table is deliberately truncated to the top {@code limit} medicines; the
     * "total purchased" figure must still be every rupee, or it silently understates spend and
     * disagrees with the Purchase page's own total.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public CostAnalysisResponse costAnalysis(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 50, 1, 100);
        String pharmacyId = TenantContext.pharmacyId();
        Instant f = DateRange.from(from);
        Instant t = DateRange.to(to);

        var totals = grnItemRepository.costAnalysisTotals(pharmacyId, f, t);
        BigDecimal totalCost = round2(nz(totals.getTotalCost()));
        BigDecimal totalMRPValue = round2(nz(totals.getTotalMrpValue()));
        BigDecimal overallMargin = totalMRPValue.signum() > 0
                ? totalMRPValue.subtract(totalCost).divide(totalMRPValue, 6, RoundingMode.HALF_UP)
                        .multiply(BigDecimal.valueOf(100))
                : BigDecimal.ZERO;

        List<CostAnalysisResponse.Item> items = new ArrayList<>();
        for (var row : grnItemRepository.costAnalysisByMedicine(pharmacyId, f, t, Limit.of(limit))) {
            BigDecimal rowCost = nz(row.getTotalCost());
            BigDecimal rowMrpValue = nz(row.getTotalMrpValue());
            BigDecimal qtyDivisor = BigDecimal.valueOf(Math.max(row.getTotalQty(), 1));
            BigDecimal avgPurchaseRate = rowCost.divide(qtyDivisor, 4, RoundingMode.HALF_UP);
            BigDecimal avgMRP = rowMrpValue.divide(qtyDivisor, 4, RoundingMode.HALF_UP);
            BigDecimal marginPct = avgMRP.signum() > 0
                    ? avgMRP.subtract(avgPurchaseRate).divide(avgMRP, 6, RoundingMode.HALF_UP)
                            .multiply(BigDecimal.valueOf(100))
                    : BigDecimal.ZERO;
            items.add(new CostAnalysisResponse.Item(row.getMedicineId(), row.getMedicineName(),
                    (int) Math.min(row.getTotalQty(), Integer.MAX_VALUE),
                    round2(rowCost), round2(rowMrpValue), round2(avgPurchaseRate), round2(avgMRP),
                    round2(marginPct), (int) Math.min(row.getBatches(), Integer.MAX_VALUE)));
        }

        return new CostAnalysisResponse(
                new CostAnalysisResponse.Summary(totalCost, totalMRPValue, round2(overallMargin)), items);
    }

    // ── Compliance ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public List<ScheduleHItemResponse> scheduleRegister(Instant from, Instant to, String schedule) {
        validateRange(from, to);

        // An unrecognised schedule used to fall through as a filter that matches nothing,
        // and the register then rendered "no controlled medicine dispensing records" —
        // a definitive statement that nothing was dispensed, produced by a typo. On a
        // statutory register that is the one failure mode that must never be silent.
        List<String> schedules;
        if (schedule != null && !schedule.isBlank()) {
            String requested = schedule.trim().toUpperCase(java.util.Locale.ROOT);
            if (!REGISTER_SCHEDULES.contains(requested)) {
                throw new BadRequestException("\"" + schedule + "\" is not a drug schedule this register covers. "
                        + "Choose one of " + String.join(", ", REGISTER_SCHEDULES) + ", or leave it blank for all.");
            }
            schedules = List.of(requested);
        } else {
            schedules = REGISTER_SCHEDULES;
        }

        // Fetch one row beyond the cap so an over-large range is detectable.
        List<InvoiceItem> items = invoiceItemRepository.scheduleRegisterItems(
                TenantContext.pharmacyId(), DateRange.from(from), DateRange.to(to), schedules,
                PageRequest.of(0, SCHEDULE_REGISTER_MAX_ROWS + 1));

        // Refuse rather than truncate. This is a statutory register under the Drugs
        // and Cosmetics Rules — handing back a silently shortened one would be worse
        // than handing back nothing, because an inspector cannot tell it is short.
        // Asking for a narrower range costs the pharmacist one click and keeps the
        // request inside a bound the service can actually serve.
        if (items.size() > SCHEDULE_REGISTER_MAX_ROWS) {
            throw new BadRequestException(
                    "This date range contains more than " + SCHEDULE_REGISTER_MAX_ROWS
                    + " Schedule H/H1/X entries. Narrow the range (for example one month at a time) "
                    + "so the full register can be returned — a partial register would not be valid for compliance.");
        }

        return items.stream().map(this::toScheduleHItem).toList();
    }

    private ScheduleHItemResponse toScheduleHItem(InvoiceItem item) {
        var invoice = item.getInvoice();
        var inv = item.getInventory();
        ScheduleHItemResponse.CustomerRef customer = invoice.getCustomer() != null
                ? new ScheduleHItemResponse.CustomerRef(invoice.getCustomer().getName(), invoice.getCustomer().getPhone())
                : null;
        ScheduleHItemResponse.UserRef user = invoice.getUser() != null
                ? new ScheduleHItemResponse.UserRef(invoice.getUser().getName()) : null;
        // productX() falls back to the local medicine (see PharmacyMedicine) when this
        // batch was never linked to the global catalogue.
        ScheduleHItemResponse.MedicineRef medicineRef = inv != null && inv.productName() != null
                ? new ScheduleHItemResponse.MedicineRef(inv.productName(), inv.productGenericName(),
                        inv.productSchedule(), inv.productStrength(), inv.productForm())
                : null;
        return new ScheduleHItemResponse(item.getId(), item.getQuantity(),
                new ScheduleHItemResponse.InvoiceRef(invoice.getInvoiceNumber(), invoice.getCreatedAt(),
                        invoice.getPrescriptionId(), invoice.getDoctorName(), customer, user),
                new ScheduleHItemResponse.InventoryRef(medicineRef));
    }

    // ── GSTR-1 HSN summary ───────────────────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public HsnSummaryResponse hsnSummary(Instant from, Instant to) {
        validateRange(from, to);
        // Already one row per (HSN, rate) and already ordered — the query groups and
        // sorts in SQL. The hand-rolled accumulate-into-a-map that used to live here
        // was summing hundreds of thousands of line items in application memory to
        // produce the dozen rows below.
        List<HsnSummaryResponse.Row> hsnRows = invoiceItemRepository.hsnSummaryItems(
                        TenantContext.pharmacyId(), DateRange.from(from), DateRange.to(to)).stream()
                .map(r -> {
                    BigDecimal cgst = nz(r.getCgst());
                    BigDecimal sgst = nz(r.getSgst());
                    BigDecimal igst = nz(r.getIgst());
                    return new HsnSummaryResponse.Row(
                            // A line with no HSN still has to appear: GSTR-1 needs every
                            // rupee accounted for, and dropping it would make the summary
                            // silently disagree with the GST totals beside it.
                            r.getHsnCode() != null ? r.getHsnCode() : "UNCLASSIFIED",
                            r.getGstRate() != null ? r.getGstRate() : BigDecimal.ZERO,
                            // Loose lines are summed as fractional pack-equivalents; round the
                            // period total to a whole strip count for the return.
                            r.getQuantity() != null ? Math.round(r.getQuantity()) : 0L,
                            round2(nz(r.getTaxableAmount())), round2(cgst), round2(sgst), round2(igst),
                            round2(cgst.add(sgst).add(igst)), round2(nz(r.getAmount())));
                })
                .toList();
        return new HsnSummaryResponse(hsnRows);
    }

    // ── Movement analytics ───────────────────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public FastMovingResponse fastMoving(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 20, 1, 50);
        var grouped = invoiceItemRepository.fastMovingInRange(TenantContext.pharmacyId(), DateRange.from(from),
                DateRange.to(to), Limit.of(limit));
        return new FastMovingResponse(enrichMovementGroups(grouped));
    }

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public FastMovingResponse slowMoving(Instant from, Instant to, Integer limitParam, Integer minQtyParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 20, 1, 50);
        int minQty = minQtyParam != null ? Math.max(minQtyParam, 0) : 1;
        var grouped = invoiceItemRepository.slowMovingInRange(TenantContext.pharmacyId(), DateRange.from(from),
                DateRange.to(to), minQty, Limit.of(limit));
        return new FastMovingResponse(enrichMovementGroups(grouped));
    }

    private List<FastMovingResponse.Item> enrichMovementGroups(List<InvoiceItemRepository.MovementGroupRow> groups) {
        if (groups.isEmpty()) {
            return List.of();
        }
        List<String> ids = groups.stream().map(InvoiceItemRepository.MovementGroupRow::getInventoryId).toList();
        // Fetch-joined + tenant-scoped: reading inv.getMedicine() below would otherwise lazy-load
        // one medicine per row.
        Map<String, Inventory> byId = inventoryRepository
                .findByIdInWithMedicine(TenantContext.pharmacyId(), ids).stream()
                .collect(java.util.stream.Collectors.toMap(Inventory::getId, i -> i));
        List<FastMovingResponse.Item> items = new ArrayList<>();
        for (var g : groups) {
            Inventory inv = byId.get(g.getInventoryId());
            // productX() falls back to the local medicine (see PharmacyMedicine) when this
            // batch was never linked to the global catalogue — inv.getMedicine() alone would
            // read null for it even though the row itself resolves fine.
            FastMovingResponse.MedicineRef medicineRef = inv != null && inv.productName() != null
                    ? new FastMovingResponse.MedicineRef(inv.productId(), inv.productName(),
                            inv.productGenericName(), inv.productForm())
                    : null;
            items.add(new FastMovingResponse.Item(g.getInventoryId(), medicineRef, g.getQty(), round2(g.getRevenue())));
        }
        return items;
    }

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public DeadStockResponse deadStock(Integer daysParam) {
        return deadStock(daysParam, null);
    }

    /**
     * Batches with no sale since the threshold, biggest capital-at-risk first.
     *
     * <p>Candidate selection, the last-sale lookup, the loose-remainder valuation and the
     * ordering all run in SQL — see {@link InventoryRepository#deadStockCandidates}. Only the
     * worst {@code limit} rows are materialised. {@code totalCostAtRisk} is a separate
     * aggregate over every dead batch, so the headline stays true even though the list is
     * capped.
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public DeadStockResponse deadStock(Integer daysParam, Integer limitParam) {
        int days = clamp(daysParam, 90, 1, 3650);
        int limit = clamp(limitParam, 100, 1, 500);
        String pharmacyId = TenantContext.pharmacyId();
        Instant threshold = Instant.now().minus(Duration.ofDays(days));

        BigDecimal totalCostAtRisk = round2(nz(inventoryRepository.deadStockTotalAtRisk(pharmacyId, threshold)));

        List<DeadStockResponse.Item> items = new ArrayList<>();
        for (var r : inventoryRepository.deadStockCandidates(pharmacyId, threshold, PageRequest.of(0, limit))) {
            BigDecimal packEq = nz(r.getPackEq());
            BigDecimal costAtRisk = round2(packEq.multiply(nz(r.getPurchaseRate())));
            BigDecimal retailValue = round2(packEq.multiply(nz(r.getMrp())));
            DeadStockResponse.MedicineRef medicineRef = r.getMedName() != null
                    ? new DeadStockResponse.MedicineRef(r.getMedId(), r.getMedName(), r.getGenericName(),
                            r.getForm(), r.getCategory())
                    : null;
            items.add(new DeadStockResponse.Item(r.getId(), r.getBatchNumber(), r.getExpiryDate(),
                    r.getQuantity(), r.getLooseUnits(), costAtRisk, retailValue, r.getLastSale(), medicineRef));
        }
        return new DeadStockResponse(days, totalCostAtRisk, items);
    }

    /**
     * Stock valuation, grouped by medicine or by category.
     *
     * <p>The batch → medicine roll-up (with the loose-remainder pack-equivalent math) is done
     * in SQL — see {@link InventoryRepository#valuationByMedicine}. The service only folds
     * medicines into categories when asked, which is cheap: the row count coming back is
     * "distinct medicines in stock", not "batches on hand".
     */
    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public ValuationResponse inventoryValuation(String groupByParam) {
        String groupBy = "category".equals(groupByParam) ? "category" : "medicine";
        String pharmacyId = TenantContext.pharmacyId();
        var rows = inventoryRepository.valuationByMedicine(pharmacyId, Instant.now());

        record Agg(String medicineName, String category, BigDecimal costValue, BigDecimal retailValue, long totalQty) {
        }
        Map<String, Agg> grouped = new LinkedHashMap<>();
        for (var r : rows) {
            String name = r.getMedicineName() != null ? r.getMedicineName() : "Unknown";
            String category = r.getCategory();
            String key = "category".equals(groupBy)
                    ? (category != null && !category.isBlank() ? category : "Uncategorized")
                    : name;
            BigDecimal cost = nz(r.getCostValue());
            BigDecimal retail = nz(r.getRetailValue());
            Agg existing = grouped.get(key);
            if (existing == null) {
                grouped.put(key, new Agg(name, category, cost, retail, r.getTotalQty()));
            } else {
                grouped.put(key, new Agg(existing.medicineName(), existing.category(),
                        existing.costValue().add(cost), existing.retailValue().add(retail),
                        existing.totalQty() + r.getTotalQty()));
            }
        }

        List<ValuationResponse.Item> items = new ArrayList<>();
        for (var entry : grouped.entrySet()) {
            Agg a = entry.getValue();
            items.add(new ValuationResponse.Item(entry.getKey(), a.medicineName(), a.category(),
                    round2(a.costValue()), round2(a.retailValue()),
                    (int) Math.min(a.totalQty(), Integer.MAX_VALUE)));
        }
        items.sort((x, y) -> y.costValue().compareTo(x.costValue()));

        BigDecimal totalCostValue = round2(items.stream().map(ValuationResponse.Item::costValue)
                .reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalRetailValue = round2(items.stream().map(ValuationResponse.Item::retailValue)
                .reduce(BigDecimal.ZERO, BigDecimal::add));
        return new ValuationResponse(groupBy, totalCostValue, totalRetailValue, items);
    }

    // ── EOD summary (homepage widget) ───────────────────────────────────────

    @Transactional(readOnly = true, timeout = REPORT_QUERY_TIMEOUT_SECONDS)
    public EodSummaryResponse eodSummary() {
        String pharmacyId = TenantContext.pharmacyId();
        Instant todayStart = LocalDate.now(IST).atStartOfDay(IST).toInstant();

        var gstAgg = invoiceRepository.gstAggregate(pharmacyId, todayStart, Instant.now());
        var topGroups = invoiceItemRepository.topItemsSince(pharmacyId, todayStart, Limit.of(TOP_ITEMS_LIMIT));

        List<String> ids = topGroups.stream().map(InvoiceItemRepository.MovementGroupRow::getInventoryId).toList();
        Map<String, Inventory> byId = ids.isEmpty() ? Map.of()
                : inventoryRepository.findByIdInWithMedicine(pharmacyId, ids).stream()
                        .collect(java.util.stream.Collectors.toMap(Inventory::getId, i -> i));

        List<EodSummaryResponse.TopMedicine> topMedicines = new ArrayList<>();
        for (var g : topGroups) {
            Inventory inv = byId.get(g.getInventoryId());
            // productName() falls back to the local medicine when this batch was never
            // linked to the global catalogue — see PharmacyMedicine.
            String name = inv != null && inv.productName() != null ? inv.productName() : "Unknown";
            String genericName = inv != null ? inv.productGenericName() : null;
            topMedicines.add(new EodSummaryResponse.TopMedicine(name, genericName, g.getQty(), round2(g.getRevenue())));
        }

        long overdueGrnCount = grnRepository.countOverdue(pharmacyId, Instant.now());
        return new EodSummaryResponse(round2(gstAgg.getTotalGst()), topMedicines, overdueGrnCount);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────
    //
    // The loose-remainder pack-equivalent math (whole packs + looseUnits / effective
    // pack size) that valuation and dead-stock need now lives in SQL — see
    // InventoryRepository.valuationByMedicine and deadStockCandidates. The Java
    // packEquivalentQty / effectiveUnitsPerPackByMedicineId helpers that used to do it
    // per-batch here were removed with that move.

    private static int clamp(Integer value, int def, int min, int max) {
        int v = value != null ? value : def;
        return Math.min(Math.max(v, min), max);
    }

    private static BigDecimal nz(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    /** Aggregate projections come back boxed, and a SUM over no rows is null however it is COALESCEd. */
    private static long nzLong(Long v) {
        return v != null ? v : 0L;
    }

    private static BigDecimal round2(BigDecimal v) {
        return (v != null ? v : BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    }
}
