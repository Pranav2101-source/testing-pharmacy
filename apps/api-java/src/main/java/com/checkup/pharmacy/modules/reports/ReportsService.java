package com.checkup.pharmacy.modules.reports;

import com.checkup.pharmacy.common.enums.ApprovalStatus;
import com.checkup.pharmacy.common.enums.GRNStatus;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.billing.InvoiceItem;
import com.checkup.pharmacy.modules.billing.InvoiceItemRepository;
import com.checkup.pharmacy.modules.billing.InvoiceRepository;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.purchase.GRNItem;
import com.checkup.pharmacy.modules.purchase.GRNItemRepository;
import com.checkup.pharmacy.modules.purchase.GoodsReceiptNoteRepository;
import com.checkup.pharmacy.modules.reports.dto.CostAnalysisResponse;
import com.checkup.pharmacy.modules.reports.dto.DailySalesResponse;
import com.checkup.pharmacy.modules.reports.dto.DeadStockResponse;
import com.checkup.pharmacy.modules.reports.dto.EodSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.ExpiryItemResponse;
import com.checkup.pharmacy.modules.reports.dto.FastMovingResponse;
import com.checkup.pharmacy.modules.reports.dto.GstSummaryResponse;
import com.checkup.pharmacy.modules.reports.dto.HsnSummaryResponse;
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
 * no writes, so every method is {@code @Transactional(readOnly = true)}.
 * Grouping/margin math that Postgres could do in SQL is instead done in Java
 * for cost-analysis/valuation/dead-stock — these read a bounded, already
 * date-filtered row set (a pharmacy's GRN items or active stock, not the
 * whole table), so in-memory aggregation is simpler than hand-rolled JPQL
 * GROUP BY across three joined tables and costs nothing extra at this scale.
 */
@Service
public class ReportsService {

    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);
    private static final int TOP_ITEMS_LIMIT = 10;

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

    private final InvoiceRepository invoiceRepository;
    private final InvoiceItemRepository invoiceItemRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository inventoryMovementRepository;
    private final GoodsReceiptNoteRepository grnRepository;
    private final GRNItemRepository grnItemRepository;
    private final com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository purchaseOrderRepository;

    public ReportsService(InvoiceRepository invoiceRepository, InvoiceItemRepository invoiceItemRepository,
                          InventoryRepository inventoryRepository,
                          InventoryMovementRepository inventoryMovementRepository,
                          GoodsReceiptNoteRepository grnRepository, GRNItemRepository grnItemRepository,
                          com.checkup.pharmacy.modules.purchase.PurchaseOrderRepository purchaseOrderRepository) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceItemRepository = invoiceItemRepository;
        this.inventoryRepository = inventoryRepository;
        this.inventoryMovementRepository = inventoryMovementRepository;
        this.grnRepository = grnRepository;
        this.grnItemRepository = grnItemRepository;
        this.purchaseOrderRepository = purchaseOrderRepository;
    }

    // ── Sales ────────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
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
    @Transactional(readOnly = true)
    public List<DailySalesResponse> dailySalesSeries(String fromStr, String toStr) {
        LocalDate start = fromStr != null ? LocalDate.parse(fromStr) : LocalDate.now(IST).minusDays(6);
        LocalDate end = toStr != null ? LocalDate.parse(toStr) : LocalDate.now(IST);
        if (start.isAfter(end)) {
            throw new BadRequestException("The start date (" + start + ") is after the end date (" + end
                    + ") — check the range and try again.");
        }
        // Bound the fan-out: a multi-year range would build tens of thousands of zero rows.
        long span = java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1;
        if (span > MAX_TREND_DAYS) {
            throw new BadRequestException("That range covers " + span + " days — the sales trend supports up to "
                    + MAX_TREND_DAYS + ". Narrow the range (for example one month at a time).");
        }

        Instant from = start.atStartOfDay(IST).toInstant();
        Instant to = end.plusDays(1).atStartOfDay(IST).toInstant().minusMillis(1);

        Map<String, InvoiceRepository.DailySalesRow> byDay = new LinkedHashMap<>();
        for (var row : invoiceRepository.dailySalesSeries(TenantContext.pharmacyId(), from, to)) {
            byDay.put(row.getDay(), row);
        }

        List<DailySalesResponse> series = new ArrayList<>();
        for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
            String key = d.toString();
            var row = byDay.get(key);
            series.add(row == null
                    ? new DailySalesResponse(key, 0, BigDecimal.ZERO, BigDecimal.ZERO)
                    : new DailySalesResponse(key, row.getInvoiceCount(), round2(row.getRevenue()),
                            round2(row.getGstCollected())));
        }
        return series;
    }

    @Transactional(readOnly = true)
    public GstSummaryResponse gstSummary(Instant from, Instant to) {
        validateRange(from, to);
        var agg = invoiceRepository.gstAggregate(TenantContext.pharmacyId(), DateRange.from(from), DateRange.to(to));
        return new GstSummaryResponse(new GstSummaryResponse.Sum(agg.getSubtotal(), agg.getDiscountAmount(),
                agg.getTaxableAmount(), agg.getCgst(), agg.getSgst(), agg.getIgst(), agg.getTotalGst(),
                agg.getTotalAmount()),
                agg.getCnt());
    }

    @Transactional(readOnly = true)
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
                .map(i -> new ExpiryItemResponse(i.getId(), i.getQuantity(), i.getExpiryDate(), i.getBatchNumber(),
                        i.getMrp(), new ExpiryItemResponse.MedicineRef(
                                i.getMedicine() != null ? i.getMedicine().getName() : null)))
                .toList();
    }

    // ── Purchases ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
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

    @Transactional(readOnly = true)
    public CostAnalysisResponse costAnalysis(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 50, 1, 100);
        String pharmacyId = TenantContext.pharmacyId();
        List<String> grnIds = grnRepository.findConfirmedIdsInRange(pharmacyId, DateRange.from(from), DateRange.to(to));
        List<GRNItem> grnItems = grnIds.isEmpty() ? List.of() : grnItemRepository.findByGrnIdIn(grnIds);

        record Agg(String medicineName, int totalQty, BigDecimal totalCost, BigDecimal totalMRPValue, int batches) {
        }
        Map<String, Agg> byMedicine = new LinkedHashMap<>();
        for (GRNItem item : grnItems) {
            int qty = item.getReceivedQty() + item.getFreeQty();
            Agg existing = byMedicine.get(item.getMedicineId());
            if (existing == null) {
                byMedicine.put(item.getMedicineId(), new Agg(item.getMedicineName(), qty, item.getAmount(),
                        item.getMrp().multiply(BigDecimal.valueOf(qty)), 1));
            } else {
                byMedicine.put(item.getMedicineId(), new Agg(existing.medicineName(), existing.totalQty() + qty,
                        existing.totalCost().add(item.getAmount()),
                        existing.totalMRPValue().add(item.getMrp().multiply(BigDecimal.valueOf(qty))),
                        existing.batches() + 1));
            }
        }

        List<CostAnalysisResponse.Item> items = new ArrayList<>();
        for (var entry : byMedicine.entrySet()) {
            Agg a = entry.getValue();
            BigDecimal qtyDivisor = BigDecimal.valueOf(Math.max(a.totalQty(), 1));
            BigDecimal avgPurchaseRate = a.totalCost().divide(qtyDivisor, 4, RoundingMode.HALF_UP);
            BigDecimal avgMRP = a.totalMRPValue().divide(qtyDivisor, 4, RoundingMode.HALF_UP);
            BigDecimal marginPct = avgMRP.signum() > 0
                    ? avgMRP.subtract(avgPurchaseRate).divide(avgMRP, 6, RoundingMode.HALF_UP)
                            .multiply(BigDecimal.valueOf(100))
                    : BigDecimal.ZERO;
            items.add(new CostAnalysisResponse.Item(entry.getKey(), a.medicineName(), a.totalQty(),
                    round2(a.totalCost()), round2(a.totalMRPValue()), round2(avgPurchaseRate), round2(avgMRP),
                    round2(marginPct), a.batches()));
        }
        items.sort((x, y) -> y.totalCost().compareTo(x.totalCost()));
        List<CostAnalysisResponse.Item> limited = items.size() > limit ? items.subList(0, limit) : items;

        BigDecimal totalCost = limited.stream().map(CostAnalysisResponse.Item::totalCost).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal totalMRPValue = limited.stream().map(CostAnalysisResponse.Item::totalMRPValue).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal overallMargin = totalMRPValue.signum() > 0
                ? totalMRPValue.subtract(totalCost).divide(totalMRPValue, 6, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100))
                : BigDecimal.ZERO;

        return new CostAnalysisResponse(new CostAnalysisResponse.Summary(totalCost, totalMRPValue, round2(overallMargin)), limited);
    }

    // ── Compliance ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
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
        var medicine = item.getInventory() != null ? item.getInventory().getMedicine() : null;
        ScheduleHItemResponse.CustomerRef customer = invoice.getCustomer() != null
                ? new ScheduleHItemResponse.CustomerRef(invoice.getCustomer().getName(), invoice.getCustomer().getPhone())
                : null;
        ScheduleHItemResponse.UserRef user = invoice.getUser() != null
                ? new ScheduleHItemResponse.UserRef(invoice.getUser().getName()) : null;
        ScheduleHItemResponse.MedicineRef medicineRef = medicine != null
                ? new ScheduleHItemResponse.MedicineRef(medicine.getName(), medicine.getGenericName(),
                        medicine.getSchedule(), medicine.getStrength(), medicine.getForm())
                : null;
        return new ScheduleHItemResponse(item.getId(), item.getQuantity(),
                new ScheduleHItemResponse.InvoiceRef(invoice.getInvoiceNumber(), invoice.getCreatedAt(),
                        invoice.getPrescriptionId(), invoice.getDoctorName(), customer, user),
                new ScheduleHItemResponse.InventoryRef(medicineRef));
    }

    // ── GSTR-1 HSN summary ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
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
                            r.getQuantity() != null ? r.getQuantity() : 0L,
                            round2(nz(r.getTaxableAmount())), round2(cgst), round2(sgst), round2(igst),
                            round2(cgst.add(sgst).add(igst)), round2(nz(r.getAmount())));
                })
                .toList();
        return new HsnSummaryResponse(hsnRows);
    }

    // ── Movement analytics ───────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public FastMovingResponse fastMoving(Instant from, Instant to, Integer limitParam) {
        validateRange(from, to);
        int limit = clamp(limitParam, 20, 1, 50);
        var grouped = invoiceItemRepository.fastMovingInRange(TenantContext.pharmacyId(), DateRange.from(from),
                DateRange.to(to), Limit.of(limit));
        return new FastMovingResponse(enrichMovementGroups(grouped));
    }

    @Transactional(readOnly = true)
    public FastMovingResponse slowMoving(Instant from, Instant to, Integer limitParam, Integer minQtyParam) {
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
            FastMovingResponse.MedicineRef medicineRef = inv != null && inv.getMedicine() != null
                    ? new FastMovingResponse.MedicineRef(inv.getMedicine().getId(), inv.getMedicine().getName(),
                            inv.getMedicine().getGenericName(), inv.getMedicine().getForm())
                    : null;
            items.add(new FastMovingResponse.Item(g.getInventoryId(), medicineRef, g.getQty(), round2(g.getRevenue())));
        }
        return items;
    }

    @Transactional(readOnly = true)
    public DeadStockResponse deadStock(Integer daysParam) {
        int days = clamp(daysParam, 90, 1, 3650);
        String pharmacyId = TenantContext.pharmacyId();
        Instant threshold = Instant.now().minus(Duration.ofDays(days));

        List<Inventory> activeItems = inventoryRepository.findActiveInStockWithMedicine(pharmacyId);
        List<String> ids = activeItems.stream().map(Inventory::getId).toList();
        Map<String, Instant> lastSaleById = ids.isEmpty() ? Map.of()
                : inventoryMovementRepository.findLastSaleByInventoryIdIn(pharmacyId, ids).stream()
                        .collect(java.util.stream.Collectors.toMap(
                                InventoryMovementRepository.LastSaleRow::getInventoryId,
                                InventoryMovementRepository.LastSaleRow::getLastSale));

        List<DeadStockResponse.Item> items = new ArrayList<>();
        for (Inventory inv : activeItems) {
            Instant lastSale = lastSaleById.get(inv.getId());
            if (lastSale != null && !lastSale.isBefore(threshold)) {
                continue; // sold since the threshold — not dead stock
            }
            BigDecimal qty = BigDecimal.valueOf(inv.getQuantity());
            BigDecimal costAtRisk = round2(qty.multiply(inv.getPurchaseRate()));
            BigDecimal retailValue = round2(qty.multiply(inv.getMrp()));
            var m = inv.getMedicine();
            DeadStockResponse.MedicineRef medicineRef = m != null
                    ? new DeadStockResponse.MedicineRef(m.getId(), m.getName(), m.getGenericName(), m.getForm(), m.getCategory())
                    : null;
            items.add(new DeadStockResponse.Item(inv.getId(), inv.getBatchNumber(), inv.getExpiryDate(),
                    inv.getQuantity(), costAtRisk, retailValue, lastSale, medicineRef));
        }
        items.sort((a, b) -> b.costAtRisk().compareTo(a.costAtRisk()));

        BigDecimal totalCostAtRisk = round2(items.stream().map(DeadStockResponse.Item::costAtRisk)
                .reduce(BigDecimal.ZERO, BigDecimal::add));
        return new DeadStockResponse(days, totalCostAtRisk, items);
    }

    @Transactional(readOnly = true)
    public ValuationResponse inventoryValuation(String groupByParam) {
        String groupBy = "category".equals(groupByParam) ? "category" : "medicine";
        List<Inventory> items = inventoryRepository.findActiveWithMedicine(TenantContext.pharmacyId());

        record Agg(String medicineName, String category, BigDecimal costValue, BigDecimal retailValue, int totalQty) {
        }
        Map<String, Agg> grouped = new LinkedHashMap<>();
        for (Inventory inv : items) {
            var m = inv.getMedicine();
            String key = "category".equals(groupBy)
                    ? (m != null && m.getCategory() != null ? m.getCategory() : "Uncategorized")
                    : (m != null ? m.getName() : "Unknown");
            BigDecimal qty = BigDecimal.valueOf(inv.getQuantity());
            BigDecimal cost = qty.multiply(inv.getPurchaseRate());
            BigDecimal retail = qty.multiply(inv.getMrp());
            Agg existing = grouped.get(key);
            if (existing == null) {
                grouped.put(key, new Agg(m != null ? m.getName() : "Unknown", m != null ? m.getCategory() : null,
                        cost, retail, inv.getQuantity()));
            } else {
                grouped.put(key, new Agg(existing.medicineName(), existing.category(), existing.costValue().add(cost),
                        existing.retailValue().add(retail), existing.totalQty() + inv.getQuantity()));
            }
        }

        List<ValuationResponse.Item> rows = new ArrayList<>();
        for (var entry : grouped.entrySet()) {
            Agg a = entry.getValue();
            rows.add(new ValuationResponse.Item(entry.getKey(), a.medicineName(), a.category(), round2(a.costValue()),
                    round2(a.retailValue()), a.totalQty()));
        }
        rows.sort((x, y) -> y.costValue().compareTo(x.costValue()));

        BigDecimal totalCostValue = round2(rows.stream().map(ValuationResponse.Item::costValue).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalRetailValue = round2(rows.stream().map(ValuationResponse.Item::retailValue).reduce(BigDecimal.ZERO, BigDecimal::add));
        return new ValuationResponse(groupBy, totalCostValue, totalRetailValue, rows);
    }

    // ── EOD summary (homepage widget) ───────────────────────────────────────

    @Transactional(readOnly = true)
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
            String name = inv != null && inv.getMedicine() != null ? inv.getMedicine().getName() : "Unknown";
            String genericName = inv != null && inv.getMedicine() != null ? inv.getMedicine().getGenericName() : null;
            topMedicines.add(new EodSummaryResponse.TopMedicine(name, genericName, g.getQty(), round2(g.getRevenue())));
        }

        long overdueGrnCount = grnRepository.countOverdue(pharmacyId, Instant.now());
        return new EodSummaryResponse(round2(gstAgg.getTotalGst()), topMedicines, overdueGrnCount);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static int clamp(Integer value, int def, int min, int max) {
        int v = value != null ? value : def;
        return Math.min(Math.max(v, min), max);
    }

    private static BigDecimal nz(BigDecimal v) {
        return v != null ? v : BigDecimal.ZERO;
    }

    private static BigDecimal round2(BigDecimal v) {
        return (v != null ? v : BigDecimal.ZERO).setScale(2, RoundingMode.HALF_UP);
    }
}
