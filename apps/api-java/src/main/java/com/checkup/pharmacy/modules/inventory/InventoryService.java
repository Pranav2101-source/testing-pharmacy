package com.checkup.pharmacy.modules.inventory;

import com.checkup.pharmacy.common.concurrency.RetryOnConflict;
import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.enums.Role;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.inventory.dto.AddStockRequest;
import com.checkup.pharmacy.modules.inventory.dto.AddStockResponse;
import com.checkup.pharmacy.modules.inventory.dto.AlertsResponse;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallListResponse;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallRequest;
import com.checkup.pharmacy.modules.inventory.dto.BatchRecallResponse;
import com.checkup.pharmacy.modules.inventory.dto.CalibrateStockResponse;
import com.checkup.pharmacy.modules.inventory.dto.FrequentItemResponse;
import com.checkup.pharmacy.modules.inventory.dto.InventoryPageResponse;
import com.checkup.pharmacy.modules.inventory.dto.InventoryResponse;
import com.checkup.pharmacy.modules.inventory.dto.LedgerPageResponse;
import com.checkup.pharmacy.modules.inventory.dto.PatchInventoryRequest;
import com.checkup.pharmacy.modules.inventory.dto.ReservationItemResult;
import com.checkup.pharmacy.modules.inventory.dto.ReserveStockRequest;
import com.checkup.pharmacy.modules.location.Rack;
import com.checkup.pharmacy.modules.location.RackRepository;
import com.checkup.pharmacy.modules.location.Shelf;
import com.checkup.pharmacy.modules.location.ShelfRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Physical stock management, scoped to the caller's pharmacy. Every quantity
 * change writes an {@link InventoryMovement} row in the same transaction so the
 * ledger can never drift from the batches it explains.
 */
@Service
public class InventoryService {

    /**
     * Ceiling on rows returned by the alerts endpoint.
     *
     * <p>Both alert queries are sorted by urgency (soonest expiry, lowest stock), so
     * a truncated tail is always the least urgent end of the list. This is a screen a
     * human scans and acts on — nobody works through 5,000 rows — and the dashboard
     * counters come from separate COUNT queries, so the totals stay accurate even
     * when the list is capped.
     */
    private static final int MAX_ALERT_ROWS = 500;

    private static final int EXPIRY_WINDOW_DAYS = 90;
    private static final int EXPIRY_CRITICAL_DAYS = 30;
    private static final int EXPIRY_WARNING_DAYS = 60;

    // Waste-risk / reorder-insight sales lookback — kept short (vs. calibrateStock's 90-day
    // window) since these features answer "will TODAY's stock sell before it expires / before
    // the next delivery", which should track recent velocity, not a quarter-long average.
    private static final int ALERT_SALES_WINDOW_DAYS = 30;
    private static final int REORDER_COVER_DAYS = 30;
    private static final int REORDER_LEAD_TIME_DAYS = 7;

    private static final Set<Role> STOCK_WRITE_ROLES = Set.of(Role.OWNER, Role.MANAGER);

    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final StockReservationRepository reservationRepository;
    private final BatchRecallRepository batchRecallRepository;
    private final MedicineRepository medicineRepository;
    private final ShelfRepository shelfRepository;
    private final RackRepository rackRepository;
    private final UserRepository userRepository;
    private final long reservationTtlMinutes;

    public InventoryService(InventoryRepository inventoryRepository,
                            InventoryMovementRepository movementRepository,
                            StockReservationRepository reservationRepository,
                            BatchRecallRepository batchRecallRepository,
                            MedicineRepository medicineRepository,
                            ShelfRepository shelfRepository,
                            RackRepository rackRepository,
                            UserRepository userRepository,
                            @Value("${app.inventory.reservation-ttl-minutes:15}") long reservationTtlMinutes) {
        this.inventoryRepository = inventoryRepository;
        this.movementRepository = movementRepository;
        this.reservationRepository = reservationRepository;
        this.batchRecallRepository = batchRecallRepository;
        this.medicineRepository = medicineRepository;
        this.shelfRepository = shelfRepository;
        this.rackRepository = rackRepository;
        this.userRepository = userRepository;
        this.reservationTtlMinutes = reservationTtlMinutes;
    }

    // ── Batch CRUD ───────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public InventoryPageResponse list(String search, String medicineId, boolean inStock, boolean lowStock,
                                      boolean nearExpiry, String status, int page, int limit) {
        String pharmacyId = TenantContext.pharmacyId();
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Pageable pageable = PageRequest.of(safePage - 1, safeLimit,
                Sort.by(Sort.Order.asc("expiryDate"), Sort.Order.desc("createdAt")));

        Instant nearExpiryThreshold = Instant.now().plus(EXPIRY_WINDOW_DAYS, ChronoUnit.DAYS);
        Page<Inventory> result = inventoryRepository.search(pharmacyId, blankToNull(search), blankToNull(medicineId),
                inStock, nearExpiry, nearExpiryThreshold, blankToNull(status), lowStock, pageable);

        List<InventoryResponse> items = enrich(result.getContent());
        var alertCounts = new InventoryPageResponse.AlertCounts(
                inventoryRepository.countExpiryAlerts(pharmacyId, nearExpiryThreshold),
                inventoryRepository.countLowStockAlerts(pharmacyId));

        return new InventoryPageResponse(items, result.getTotalElements(), safePage, result.getTotalPages(), alertCounts);
    }

    @Transactional(readOnly = true)
    public InventoryResponse getById(String id) {
        Inventory inv = load(id);
        return enrich(List.of(inv)).get(0);
    }

    @Transactional
    public AddStockResponse addStock(AddStockRequest req) {
        if (!STOCK_WRITE_ROLES.contains(TenantContext.currentUser().role())) {
            throw new ForbiddenException("Only owners and managers can add stock");
        }
        String pharmacyId = TenantContext.pharmacyId();
        medicineRepository.findById(req.medicineId()).orElseThrow(() -> new NotFoundException("Medicine not found"));
        validateShelf(req.shelfId());

        Inventory existing = inventoryRepository
                .findByPharmacyIdAndMedicineIdAndBatchNumber(pharmacyId, req.medicineId(), req.batchNumber())
                .orElse(null);
        int quantityBefore = existing == null ? 0 : existing.getQuantity();

        Inventory inv;
        boolean merged = existing != null;
        if (existing != null) {
            existing.mergeIncoming(req.quantity(), req.purchaseRate(), req.mrp(), req.expiryDate());
            applyPlacement(existing, req.shelfId(), req.location());
            inv = existing;
        } else {
            inv = Inventory.create(pharmacyId, req.medicineId(), req.batchNumber(), req.expiryDate(),
                    req.quantity(), req.purchaseRate(), req.mrp(), req.minimumStockOrDefault(), req.reorderLevelOrDefault());
            applyPlacement(inv, req.shelfId(), req.location());
            inventoryRepository.save(inv);
        }

        movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), TenantContext.userId(),
                MovementType.OPENING, MovementDirection.IN, req.quantity(), quantityBefore,
                quantityBefore + req.quantity(), "OPENING_BALANCE", null,
                merged ? "Manual stock entry (added to existing batch)" : "Manual stock entry (new batch)"));

        return new AddStockResponse(enrich(List.of(inv)).get(0), merged);
    }

    @Transactional
    public InventoryResponse patch(String id, PatchInventoryRequest req) {
        if (req.isEmpty()) {
            throw new BadRequestException("At least one field must be provided");
        }
        if ((req.adjust() != null || req.status() != null) && !STOCK_WRITE_ROLES.contains(TenantContext.currentUser().role())) {
            throw new ForbiddenException("Only owners and managers can adjust stock or change batch status");
        }
        if (req.status() != null && (req.statusReason() == null || req.statusReason().isBlank())) {
            throw new BadRequestException("statusReason is required when changing status");
        }

        Inventory inv = load(id);

        if (req.adjust() != null) {
            applyAdjustment(inv, req.adjust());
        }
        if (req.status() != null) {
            applyStatusChange(inv, req.status(), req.statusReason());
        }
        if (req.shelfId() != null || req.location() != null) {
            validateShelf(blankToNull(req.shelfId()));
            applyPlacement(inv, req.shelfId(), req.location());
        }

        return enrich(List.of(inv)).get(0);
    }

    private void applyAdjustment(Inventory inv, PatchInventoryRequest.Adjust adjust) {
        int delta = adjust.delta();
        if (delta == 0) {
            return; // no-op — nothing to record, and a quantity=0 movement would be misleading
        }
        int quantityBefore = inv.getQuantity();
        int newQty = quantityBefore + delta;
        if (newQty < 0) {
            throw new UnprocessableEntityException(
                    "Cannot reduce stock below zero. Current: " + quantityBefore + ", delta: " + delta);
        }
        inv.setQuantity(newQty);

        String referenceType = (adjust.type() == null || adjust.type().isBlank()) ? "CORRECTION" : adjust.type();
        movementRepository.save(InventoryMovement.record(inv.getPharmacyId(), inv.getId(), TenantContext.userId(),
                MovementType.ADJUSTMENT, delta > 0 ? MovementDirection.IN : MovementDirection.OUT,
                Math.abs(delta), quantityBefore, newQty, referenceType, null, adjust.reason()));
    }

    private void applyStatusChange(Inventory inv, String statusStr, String reason) {
        BatchStatus newStatus;
        try {
            newStatus = BatchStatus.valueOf(statusStr);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("status must be one of ACTIVE, QUARANTINE, DAMAGED");
        }
        if (newStatus == BatchStatus.EXPIRED) {
            throw new BadRequestException("EXPIRED is set automatically and cannot be assigned directly");
        }
        BatchStatus oldStatus = inv.getStatus();
        inv.setStatus(newStatus);

        movementRepository.save(InventoryMovement.record(inv.getPharmacyId(), inv.getId(), TenantContext.userId(),
                newStatus == BatchStatus.DAMAGED ? MovementType.DAMAGE : MovementType.ADJUSTMENT,
                MovementDirection.OUT, 0, inv.getQuantity(), inv.getQuantity(), "STATUS_CHANGE", null,
                oldStatus + "→" + newStatus + ": " + reason));
    }

    private void applyPlacement(Inventory inv, String shelfId, String location) {
        String s = blankToNull(shelfId);
        String l = blankToNull(location);
        if (s != null) {
            inv.setPlacement(s, null);
        } else if (l != null) {
            inv.setPlacement(null, l);
        } else {
            inv.setPlacement(null, null);
        }
    }

    private void validateShelf(String shelfId) {
        if (shelfId != null && !shelfRepository.findByIdAndPharmacyId(shelfId, TenantContext.pharmacyId()).isPresent()) {
            throw new NotFoundException("Shelf not found");
        }
    }

    // ── Stock Ledger ─────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public LedgerPageResponse getLedger(String inventoryId, String medicineId, String userId, String type,
                                        String direction, Instant from, Instant to, int page, int limit) {
        String pharmacyId = TenantContext.pharmacyId();
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<InventoryMovement> result = movementRepository.search(pharmacyId, blankToNull(inventoryId),
                blankToNull(medicineId), blankToNull(userId), blankToNull(type), blankToNull(direction),
                DateRange.from(from), DateRange.to(to), PageRequest.of(safePage - 1, safeLimit));

        List<InventoryMovement> movements = result.getContent();

        // Batch-resolve the two names the ledger row needs — medicine (via the fetch-joined
        // inventory's medicineId) and the acting user — in one query each, instead of a lazy
        // load per row. inventory itself is already fetch-joined by the search query.
        List<String> medicineIds = movements.stream()
                .map(m -> m.getInventory() == null ? null : m.getInventory().getMedicineId())
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, Medicine> medById = new HashMap<>();
        if (!medicineIds.isEmpty()) {
            for (Medicine m : medicineRepository.findAllById(medicineIds)) {
                medById.put(m.getId(), m);
            }
        }
        List<String> userIds = movements.stream().map(InventoryMovement::getUserId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, String> userNameById = new HashMap<>();
        if (!userIds.isEmpty()) {
            for (User u : userRepository.findByIdInAndPharmacyId(userIds, pharmacyId)) {
                userNameById.put(u.getId(), u.getName());
            }
        }

        List<LedgerPageResponse.Entry> entries = movements.stream()
                .map(m -> toLedgerEntry(m, medById, userNameById)).toList();
        return new LedgerPageResponse(entries, result.getTotalElements(), safePage, safeLimit);
    }

    private LedgerPageResponse.Entry toLedgerEntry(InventoryMovement m, Map<String, Medicine> medById,
                                                   Map<String, String> userNameById) {
        Inventory inv = m.getInventory();
        LedgerPageResponse.InventoryRef invRef = null;
        if (inv != null) {
            Medicine med = medById.get(inv.getMedicineId());
            LedgerPageResponse.MedicineRef medRef = med == null ? null
                    : new LedgerPageResponse.MedicineRef(med.getName(), med.getGenericName());
            invRef = new LedgerPageResponse.InventoryRef(inv.getBatchNumber(), medRef);
        }
        // Never null in practice (movements are always recorded by a user); fall back to "Unknown"
        // rather than send null, which the frontend renders as an empty entry-by cell.
        String userName = m.getUserId() == null ? null : userNameById.get(m.getUserId());
        LedgerPageResponse.UserRef userRef = m.getUserId() == null ? null
                : new LedgerPageResponse.UserRef(m.getUserId(), userName != null ? userName : "Unknown");

        return new LedgerPageResponse.Entry(m.getId(), m.getInventoryId(), m.getType().name(),
                m.getDirection().name(), m.getQuantity(), m.getQuantityBefore(), m.getQuantityAfter(),
                m.getReferenceType(), m.getReferenceId(), m.getNotes(), invRef, userRef, m.getCreatedAt());
    }

    // ── Alerts ───────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public AlertsResponse getAlerts(String type) {
        String pharmacyId = TenantContext.pharmacyId();
        boolean wantExpiry = type == null || type.equals("expiry");
        boolean wantLowStock = type == null || type.equals("lowStock");

        List<AlertsResponse.ExpiryAlert> expiry = wantExpiry ? buildExpiryAlerts(pharmacyId) : List.of();
        List<AlertsResponse.LowStockAlert> lowStock = wantLowStock ? buildLowStockAlerts(pharmacyId) : List.of();
        return new AlertsResponse(expiry, lowStock);
    }

    private List<AlertsResponse.ExpiryAlert> buildExpiryAlerts(String pharmacyId) {
        Instant now = Instant.now();
        Instant d30 = now.plus(EXPIRY_CRITICAL_DAYS, ChronoUnit.DAYS);
        Instant d60 = now.plus(EXPIRY_WARNING_DAYS, ChronoUnit.DAYS);
        Instant d90 = now.plus(EXPIRY_WINDOW_DAYS, ChronoUnit.DAYS);

        List<Inventory> rows = inventoryRepository.findExpiryAlerts(
                pharmacyId, d90, PageRequest.of(0, MAX_ALERT_ROWS));
        if (rows.isEmpty()) {
            return List.of();
        }

        // enrich() is a BATCH loader: it collects the distinct medicine/shelf/rack
        // ids across all rows and resolves them in three queries. Calling it as
        // enrich(List.of(i)) inside a map ran those three queries PER ROW — an N+1
        // that used the batching machinery to defeat itself. One call, then zip by
        // index (enrich preserves input order).
        List<InventoryResponse> enriched = enrich(rows);
        Map<String, Double> avgDailySalesByMedicine = avgDailySalesByMedicine(pharmacyId, rows);

        List<AlertsResponse.ExpiryAlert> alerts = new ArrayList<>(rows.size());
        for (int idx = 0; idx < rows.size(); idx++) {
            Inventory i = rows.get(idx);
            long daysToExpiry = ChronoUnit.DAYS.between(now, i.getExpiryDate());
            String tier = !i.getExpiryDate().isAfter(now) ? "EXPIRED"
                    : i.getExpiryDate().isBefore(d30) || i.getExpiryDate().equals(d30) ? "CRITICAL"
                    : i.getExpiryDate().isBefore(d60) || i.getExpiryDate().equals(d60) ? "WARNING"
                    : "NOTICE";

            Double avgDailySales = avgDailySalesByMedicine.get(i.getMedicineId());
            AlertsResponse.WasteRisk wasteRisk = computeWasteRisk(i.getQuantity(), daysToExpiry,
                    tier.equals("EXPIRED"), avgDailySales == null ? 0 : avgDailySales, avgDailySales != null,
                    i.getPurchaseRate());

            alerts.add(AlertsResponse.ExpiryAlert.of(enriched.get(idx), tier, (int) daysToExpiry, wasteRisk));
        }
        return alerts;
    }

    private List<AlertsResponse.LowStockAlert> buildLowStockAlerts(String pharmacyId) {
        List<Inventory> rows = inventoryRepository.findLowStockAlerts(
                pharmacyId, PageRequest.of(0, MAX_ALERT_ROWS));
        if (rows.isEmpty()) {
            return List.of();
        }

        List<InventoryResponse> enriched = enrich(rows); // batched — see buildExpiryAlerts
        Map<String, Double> avgDailySalesByMedicine = avgDailySalesByMedicine(pharmacyId, rows);

        List<AlertsResponse.LowStockAlert> alerts = new ArrayList<>(rows.size());
        for (int idx = 0; idx < rows.size(); idx++) {
            Inventory i = rows.get(idx);
            String tier = i.getQuantity() == 0 ? "OUT_OF_STOCK" : i.getQuantity() <= i.getReorderLevel() ? "REORDER" : "LOW";

            Double avgDailySales = avgDailySalesByMedicine.get(i.getMedicineId());
            AlertsResponse.ReorderInsight reorder = computeReorderInsight(avgDailySales == null ? 0 : avgDailySales,
                    avgDailySales != null, REORDER_COVER_DAYS, REORDER_LEAD_TIME_DAYS);

            alerts.add(AlertsResponse.LowStockAlert.of(enriched.get(idx), tier, reorder));
        }
        return alerts;
    }

    /**
     * Trailing-{@value ALERT_SALES_WINDOW_DAYS}-day avg daily sales per medicine, for the
     * distinct medicines referenced by {@code rows}. A medicine absent from the returned map had
     * zero qualifying SALE movements in the window — callers treat that as "no data" (NO_DATA /
     * hasData=false), not as a literal zero, since a genuinely slow-but-selling medicine and a
     * medicine nobody has ever billed should not read identically to the pharmacist.
     */
    private Map<String, Double> avgDailySalesByMedicine(String pharmacyId, List<Inventory> rows) {
        Instant to = Instant.now();
        Instant from = to.minus(ALERT_SALES_WINDOW_DAYS, ChronoUnit.DAYS);
        Map<String, Double> result = new HashMap<>();
        for (InventoryMovementRepository.MedicineSalesAggregateRow row
                : movementRepository.aggregateSalesByMedicine(pharmacyId, from, to)) {
            result.put(row.getMedicineId(), round1(row.getTotalQuantity() / (double) ALERT_SALES_WINDOW_DAYS));
        }
        return result;
    }

    /**
     * Ported from the old Node backend's {@code computeWasteRisk} (inventory.calc.ts) — an
     * expired batch is always HIGH risk regardless of sales data (it is already unsellable), a
     * medicine with no sales history in the window is NO_DATA rather than guessed at, and
     * otherwise risk tier is driven by the fraction of on-hand quantity that historical velocity
     * would not clear before expiry.
     */
    private static AlertsResponse.WasteRisk computeWasteRisk(int quantity, long daysToExpiry, boolean isExpired,
                                                              double avgDailySales, boolean hasData, BigDecimal purchaseRate) {
        if (isExpired) {
            int potentialLoss = purchaseRate.multiply(BigDecimal.valueOf(quantity))
                    .setScale(0, RoundingMode.HALF_UP).intValue();
            return new AlertsResponse.WasteRisk(round1(avgDailySales), 0, quantity, potentialLoss, "HIGH");
        }
        if (!hasData || avgDailySales == 0) {
            return new AlertsResponse.WasteRisk(0, 0, 0, 0, "NO_DATA");
        }

        long daysLeft = Math.max(0, daysToExpiry);
        int willSell = (int) Math.min(quantity, Math.floor(avgDailySales * daysLeft));
        int atRisk = quantity - willSell;
        double atRiskPct = quantity > 0 ? (double) atRisk / quantity : 0;
        String riskTier = atRisk == 0 ? "SAFE" : atRiskPct < 0.2 ? "LOW" : atRiskPct < 0.5 ? "MEDIUM" : "HIGH";
        int potentialLoss = purchaseRate.multiply(BigDecimal.valueOf(atRisk)).setScale(0, RoundingMode.HALF_UP).intValue();

        return new AlertsResponse.WasteRisk(round1(avgDailySales), willSell, atRisk, potentialLoss, riskTier);
    }

    /** Ported from the old Node backend's {@code computeReorderInsight} (inventory.calc.ts). */
    private static AlertsResponse.ReorderInsight computeReorderInsight(double avgDailySales, boolean hasData,
                                                                        int coverDays, int leadTimeDays) {
        int suggestedQty = hasData ? (int) Math.ceil(avgDailySales * (coverDays + leadTimeDays)) : 0;
        return new AlertsResponse.ReorderInsight(round1(avgDailySales), suggestedQty, coverDays, leadTimeDays, hasData);
    }

    private static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    // ── Stock Reservation ────────────────────────────────────────────────────
    // Serializable isolation so two concurrent billing sessions can't both read
    // "no conflict" for the same stock and both write a reservation, letting total
    // reserved quantity exceed actual quantity. A concurrent-write conflict here
    // surfaces to the caller as 409 instead of corrupting reservedQuantity.

    @RetryOnConflict
    @Transactional
    public List<ReservationItemResult> reserve(ReserveStockRequest req) {
        try {
            return doReserve(req);
        } catch (ConcurrencyFailureException e) {
            // Only reachable once RetryOnConflict has exhausted its attempts.
            throw new ConflictException("Stock updated concurrently — please refresh and try again");
        }
    }

    private List<ReservationItemResult> doReserve(ReserveStockRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Instant now = Instant.now();

        releaseExpiredReservations(pharmacyId, now);

        List<StockReservation> existing = reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, req.sessionId());
        Map<String, Integer> existingBySelf = new HashMap<>();
        for (StockReservation r : existing) {
            existingBySelf.merge(r.getInventoryId(), r.getQuantity(), Integer::sum);
        }

        // Lock the batches before reading reservedQuantity: the whole point of a
        // reservation is that no one else may take the same units between our read
        // and our write. The status filter stays in Java — it is a business rule
        // ("only ACTIVE batches are reservable"), not a tenancy check, and folding
        // it into the locking query would silently skip non-ACTIVE rows rather than
        // reporting them as unreservable below.
        List<String> ids = req.items().stream().map(ReserveStockRequest.Item::inventoryId).toList();
        // Same guard BillingService applies to invoice lines. Without it each duplicate
        // line is checked against availability independently — two lines of 60 both pass
        // against a 100-unit batch — and then both are applied. The unique index on
        // (pharmacyId, inventoryId, sessionId) does stop the second row reaching the
        // table, but only as a raw constraint violation, which surfaces to the
        // pharmacist as "This record conflicts with existing data". Reject it here
        // instead, while we can still say what is actually wrong.
        if (ids.stream().distinct().count() != ids.size()) {
            throw new BadRequestException("Duplicate inventory items in a single reservation are not allowed");
        }

        Map<String, Inventory> byId = new HashMap<>();
        for (Inventory inv : inventoryRepository.lockAllByIdInAndPharmacyId(ids, pharmacyId)) {
            if (inv.getStatus() == BatchStatus.ACTIVE) {
                byId.put(inv.getId(), inv);
            }
        }

        List<ReservationItemResult> results = new ArrayList<>();
        List<String> conflicts = new ArrayList<>();
        for (ReserveStockRequest.Item item : req.items()) {
            Inventory inv = byId.get(item.inventoryId());
            if (inv == null) {
                throw new NotFoundException("Inventory item not found or not active: " + item.inventoryId());
            }
            int thisSessionQty = existingBySelf.getOrDefault(item.inventoryId(), 0);
            int reservedByOthers = Math.max(0, inv.getReservedQuantity() - thisSessionQty);
            int available = inv.getQuantity() - reservedByOthers;
            results.add(new ReservationItemResult(item.inventoryId(), available));
            if (item.quantity() > available) {
                conflicts.add(item.inventoryId() + " (requested " + item.quantity() + ", available " + available + ")");
            }
        }
        if (!conflicts.isEmpty()) {
            throw new ConflictException("Insufficient unreserved stock: " + String.join(", ", conflicts));
        }

        // Release this session's old reservations, then create the new set.
        for (Map.Entry<String, Integer> e : existingBySelf.entrySet()) {
            Inventory inv = byId.get(e.getKey());
            // Scoped fallback: this branch handles a batch that is no longer ACTIVE
            // (so it is absent from byId) but still carries one of this session's
            // reservations. It performs a WRITE — reserve(-qty) — so an unscoped
            // findById here would let a stray reservation row decrement another
            // pharmacy's reserved count. Not reachable today, since the reservations
            // were themselves loaded tenant-scoped, but it is one refactor away and
            // costs nothing to close.
            if (inv == null) {
                inv = inventoryRepository.findByIdAndPharmacyId(e.getKey(), pharmacyId).orElse(null);
            }
            if (inv != null) inv.reserve(-e.getValue());
        }
        reservationRepository.deleteAll(existing);
        // Force the DELETEs to the database before the INSERTs below.
        //
        // Hibernate's action queue orders a flush as inserts-then-deletes regardless of
        // the order the calls were written in. So without this flush the new reservation
        // row is inserted while the old one is still present, and the unique index on
        // (pharmacyId, inventoryId, sessionId) rejects it. That made re-reserving the
        // same batch within one session — a pharmacist simply changing a quantity
        // mid-sale, which the release-then-recreate logic above exists to support —
        // fail with a constraint violation every time.
        reservationRepository.flush();

        Instant expiresAt = now.plus(reservationTtlMinutes, ChronoUnit.MINUTES);
        for (ReserveStockRequest.Item item : req.items()) {
            reservationRepository.save(StockReservation.create(pharmacyId, item.inventoryId(), req.sessionId(),
                    item.quantity(), expiresAt));
            byId.get(item.inventoryId()).reserve(item.quantity());
        }

        return results;
    }

    @Transactional
    public void release(String sessionId) {
        String pharmacyId = TenantContext.pharmacyId();
        List<StockReservation> existing = reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, sessionId);
        if (existing.isEmpty()) {
            return;
        }
        Map<String, Integer> totals = new HashMap<>();
        for (StockReservation r : existing) {
            totals.merge(r.getInventoryId(), r.getQuantity(), Integer::sum);
        }
        // Tenant-scoped: this WRITES (decrements reservedQuantity). doReserve already
        // refuses to trust that reservation rows can only ever name this tenant's
        // batches — see its scoped-fallback comment — and this path had the same
        // exposure without the same guard.
        for (Inventory inv : inventoryRepository.findByIdInAndPharmacyId(totals.keySet(), pharmacyId)) {
            inv.reserve(-totals.get(inv.getId()));
        }
        reservationRepository.deleteAll(existing);
    }

    /**
     * Releases reservations whose TTL has passed, for one pharmacy.
     *
     * <p>Exposed for {@link com.checkup.pharmacy.jobs.ReservationCleanupJob}. Until
     * that job existed this only ever ran as a side effect of the <i>next</i>
     * reservation request, so stock held by an abandoned billing session — a
     * customer who walked away, a tab left open at shift change — stayed
     * unsellable until some unrelated sale happened to touch the same pharmacy.
     * On a quiet evening that could be hours.
     *
     * @return how many reservation rows were released
     */
    @Transactional
    public int releaseExpiredReservationsFor(String pharmacyId) {
        return releaseExpiredReservations(pharmacyId, Instant.now());
    }

    private int releaseExpiredReservations(String pharmacyId, Instant now) {
        List<StockReservation> expired = reservationRepository.findByPharmacyIdAndExpiresAtBefore(pharmacyId, now);
        if (expired.isEmpty()) {
            return 0;
        }
        Map<String, Integer> totals = new HashMap<>();
        for (StockReservation r : expired) {
            totals.merge(r.getInventoryId(), r.getQuantity(), Integer::sum);
        }
        // Tenant-scoped AND locked: this decrements reservedQuantity, so an unscoped
        // findAllById could have written to another pharmacy's batch if a stray
        // reservation row ever pointed at one, and an unlocked read could lose the
        // decrement to a concurrent sale touching the same batch.
        for (Inventory inv : inventoryRepository.lockAllByIdInAndPharmacyId(totals.keySet(), pharmacyId)) {
            inv.reserve(-totals.get(inv.getId()));
        }
        reservationRepository.deleteAll(expired);
        return expired.size();
    }

    // ── FEFO (used by billing) ───────────────────────────────────────────────

    @Transactional(readOnly = true)
    public InventoryResponse getFefoBatch(String medicineId, int quantity) {
        int qty = Math.max(quantity, 1);
        List<Inventory> candidates = inventoryRepository.findFefoCandidates(
                TenantContext.pharmacyId(), medicineId, Instant.now(), qty, PageRequest.of(0, 1));
        return candidates.isEmpty() ? null : enrich(candidates).get(0);
    }

    // ── Sales-velocity features (calibrate-stock, frequent quick-add) ────────

    private static final int CALIBRATE_WINDOW_DAYS = 90;
    private static final int FREQUENT_WINDOW_DAYS = 30;
    private static final int MIN_STOCK_FLOOR = 5;
    private static final int FREQUENT_LIMIT = 10;

    /**
     * "Smart Stock Levels" — recomputes each medicine's minimum-stock threshold from its trailing
     * 90-day sales velocity ({@code avgDailySales × 7 × 1.5}, floored at {@link #MIN_STOCK_FLOOR}).
     * A medicine may have several ACTIVE batches; all of them are updated to the same new
     * threshold together, since "minimum stock" is a per-medicine reorder signal in practice, not
     * a per-batch one. Medicines with zero sales in the window are left untouched and counted as
     * {@code skipped} — there's no velocity to calibrate against.
     */
    @Transactional
    public CalibrateStockResponse calibrateStock(boolean dryRun) {
        String pharmacyId = TenantContext.pharmacyId();
        Instant to = Instant.now();
        Instant from = to.minus(CALIBRATE_WINDOW_DAYS, ChronoUnit.DAYS);

        Map<String, Long> qtyByMedicine = new HashMap<>();
        for (InventoryMovementRepository.MedicineSalesAggregateRow row
                : movementRepository.aggregateSalesByMedicine(pharmacyId, from, to)) {
            qtyByMedicine.put(row.getMedicineId(), row.getTotalQuantity());
        }

        Map<String, List<Inventory>> batchesByMedicine = new HashMap<>();
        for (Inventory inv : inventoryRepository.findByPharmacyIdAndStatus(pharmacyId, BatchStatus.ACTIVE)) {
            batchesByMedicine.computeIfAbsent(inv.getMedicineId(), k -> new ArrayList<>()).add(inv);
        }

        int updated = 0;
        int skipped = 0;
        List<CalibrateStockResponse.Change> changes = new ArrayList<>();

        for (Map.Entry<String, List<Inventory>> entry : batchesByMedicine.entrySet()) {
            List<Inventory> batches = entry.getValue();
            long totalQty = qtyByMedicine.getOrDefault(entry.getKey(), 0L);
            if (totalQty == 0) {
                skipped++;
                continue;
            }
            double avgDailySales = Math.round((totalQty / (double) CALIBRATE_WINDOW_DAYS) * 10) / 10.0;
            int newMin = Math.max(MIN_STOCK_FLOOR, (int) Math.ceil(avgDailySales * 7 * 1.5));
            int oldMin = batches.get(0).getMinimumStock();
            if (newMin == oldMin) {
                continue;
            }
            Medicine medicine = batches.get(0).getMedicine();
            changes.add(new CalibrateStockResponse.Change(entry.getKey(),
                    medicine == null ? "?" : medicine.getName(), oldMin, newMin, avgDailySales));
            if (!dryRun) {
                for (Inventory b : batches) {
                    b.setMinimumStock(newMin);
                }
            }
            updated++;
        }

        return new CalibrateStockResponse(batchesByMedicine.size(), updated, skipped, changes);
    }

    /**
     * "Quick Add" — the pharmacy's most-frequently-billed medicines over the trailing 30 days,
     * each resolved to its current best (FEFO) sellable batch. A medicine with no currently
     * available batch (fully sold out or all remaining stock expired/quarantined) is silently
     * dropped — there'd be nothing to add to the cart anyway.
     */
    @Transactional(readOnly = true)
    public List<FrequentItemResponse> frequentItems() {
        String pharmacyId = TenantContext.pharmacyId();
        Instant to = Instant.now();
        Instant from = to.minus(FREQUENT_WINDOW_DAYS, ChronoUnit.DAYS);

        List<InventoryMovementRepository.MedicineSalesAggregateRow> ranked =
                movementRepository.aggregateSalesByMedicine(pharmacyId, from, to);

        List<FrequentItemResponse> out = new ArrayList<>();
        for (InventoryMovementRepository.MedicineSalesAggregateRow row : ranked) {
            if (out.size() >= FREQUENT_LIMIT) {
                break;
            }
            List<Inventory> candidates = inventoryRepository.findFefoCandidates(
                    pharmacyId, row.getMedicineId(), to, 1, PageRequest.of(0, 1));
            if (candidates.isEmpty()) {
                continue;
            }
            Inventory batch = candidates.get(0);
            Medicine medicine = batch.getMedicine();
            if (medicine == null) {
                continue;
            }
            InventoryResponse.ShelfRef shelfRef = null;
            if (batch.getShelf() != null) {
                Rack rack = batch.getShelf().getRack();
                InventoryResponse.RackRef rackRef = rack == null ? null
                        : new InventoryResponse.RackRef(rack.getId(), rack.getCode(), rack.getName());
                shelfRef = new InventoryResponse.ShelfRef(batch.getShelf().getId(), batch.getShelf().getCode(), rackRef);
            }
            out.add(new FrequentItemResponse(batch.getId(), batch.getBatchNumber(), batch.getExpiryDate(),
                    batch.getMrp(), batch.getQuantity(), batch.getReservedQuantity(), batch.getLocation(), shelfRef,
                    row.getTransactionCount(),
                    new FrequentItemResponse.MedicineRef(medicine.getName(), medicine.getGenericName(),
                            medicine.getHsnCode(), medicine.getGstRate(), medicine.isActive(),
                            medicine.getSchedule(), medicine.getPackSize())));
        }
        return out;
    }

    // ── Batch Recall ─────────────────────────────────────────────────────────

    @Transactional
    public BatchRecallResponse batchRecall(BatchRecallRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        List<Inventory> affected = req.medicineId() == null || req.medicineId().isBlank()
                ? inventoryRepository.findByPharmacyIdAndBatchNumberAndStatus(pharmacyId, req.batchNumber(), BatchStatus.ACTIVE)
                : inventoryRepository.findByPharmacyIdAndMedicineIdAndBatchNumberAndStatus(
                        pharmacyId, req.medicineId(), req.batchNumber(), BatchStatus.ACTIVE);

        if (affected.isEmpty()) {
            throw new NotFoundException("No ACTIVE batches found matching the given batch number");
        }

        String[] affectedIds = affected.stream().map(Inventory::getId).toArray(String[]::new);
        BatchRecall recall = BatchRecall.create(pharmacyId, req.batchNumber(), blankToNull(req.medicineId()),
                req.reason(), TenantContext.userId(), affectedIds);
        batchRecallRepository.save(recall);

        for (Inventory inv : affected) {
            inv.setStatus(BatchStatus.QUARANTINE);
            movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), TenantContext.userId(),
                    MovementType.ADJUSTMENT, MovementDirection.OUT, 0, inv.getQuantity(), inv.getQuantity(),
                    "BATCH_RECALL", recall.getId(), req.reason()));
        }

        return new BatchRecallResponse(recall.getId(), affected.size());
    }

    @Transactional(readOnly = true)
    public BatchRecallListResponse listRecalledBatches(String batchNumber, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<BatchRecall> result = batchRecallRepository.search(TenantContext.pharmacyId(), blankToNull(batchNumber),
                PageRequest.of(safePage - 1, safeLimit));

        List<BatchRecallListResponse.Item> items = result.getContent().stream()
                .map(r -> new BatchRecallListResponse.Item(r.getId(), r.getBatchNumber(), r.getMedicineId(),
                        r.getReason(), r.getRecalledBy(), r.getRecalledAt(), r.getAffectedIds().length))
                .toList();
        return new BatchRecallListResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private Inventory load(String id) {
        return inventoryRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Inventory item not found"));
    }

    /** Batch-fetches medicine + shelf/rack refs for a page of results — avoids N+1 lazy-load queries. */
    private List<InventoryResponse> enrich(List<Inventory> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        List<String> medicineIds = rows.stream().map(Inventory::getMedicineId).distinct().toList();
        Map<String, Medicine> medicinesById = new HashMap<>();
        for (Medicine m : medicineRepository.findAllById(medicineIds)) {
            medicinesById.put(m.getId(), m);
        }

        List<String> shelfIds = rows.stream().map(Inventory::getShelfId).filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, Shelf> shelvesById = new HashMap<>();
        Map<String, Rack> racksById = new HashMap<>();
        if (!shelfIds.isEmpty()) {
            for (Shelf s : shelfRepository.findAllById(shelfIds)) {
                shelvesById.put(s.getId(), s);
            }
            List<String> rackIds = shelvesById.values().stream().map(Shelf::getRackId).distinct().toList();
            for (Rack r : rackRepository.findAllById(rackIds)) {
                racksById.put(r.getId(), r);
            }
        }

        List<InventoryResponse> out = new ArrayList<>(rows.size());
        for (Inventory inv : rows) {
            Medicine m = medicinesById.get(inv.getMedicineId());
            InventoryResponse.MedicineRef medRef = m == null ? null : new InventoryResponse.MedicineRef(
                    m.getId(), m.getName(), m.getGenericName(), m.getForm(), m.getStrength(), m.getUnit(),
                    m.isActive(), m.getGstRate(), m.getHsnCode());

            InventoryResponse.ShelfRef shelfRef = null;
            if (inv.getShelfId() != null) {
                Shelf s = shelvesById.get(inv.getShelfId());
                if (s != null) {
                    Rack r = racksById.get(s.getRackId());
                    InventoryResponse.RackRef rackRef = r == null ? null
                            : new InventoryResponse.RackRef(r.getId(), r.getCode(), r.getName());
                    shelfRef = new InventoryResponse.ShelfRef(s.getId(), s.getCode(), rackRef);
                }
            }

            out.add(new InventoryResponse(inv.getId(), medRef, inv.getBatchNumber(), inv.getExpiryDate(),
                    inv.getQuantity(), inv.getReservedQuantity(), inv.getQuantity() - inv.getReservedQuantity(),
                    inv.getPurchaseRate(), inv.getMrp(), inv.getLocation(), shelfRef, inv.getMinimumStock(),
                    inv.getReorderLevel(), inv.getStatus().name(), inv.getCreatedAt(), inv.getUpdatedAt()));
        }
        return out;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }
}
