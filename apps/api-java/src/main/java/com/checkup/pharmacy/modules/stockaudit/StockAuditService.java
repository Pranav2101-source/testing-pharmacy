package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.concurrency.RetryOnConflict;
import com.checkup.pharmacy.common.enums.AuditSessionStatus;
import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.ForbiddenException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovement;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.stockaudit.dto.ApproveSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditItemResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditOverviewResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.AuditReportResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.BatchUpdateItemsRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CompleteSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.CreateSessionRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.SessionPageResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.SessionResponse;
import com.checkup.pharmacy.modules.stockaudit.dto.SessionSummary;
import com.checkup.pharmacy.modules.stockaudit.dto.UpdateItemRequest;
import com.checkup.pharmacy.modules.stockaudit.dto.VarianceSummaryResponse;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Physical stock-count sessions, scoped to the caller's pharmacy. A session
 * snapshots every ACTIVE batch's quantity at creation; approving it applies the
 * counted-vs-expected variance as ADJUSTMENT movements, setting each batch to
 * exactly what staff physically counted (not "live quantity + variance" — sales
 * that happen between the count and the approval must not corrupt the result).
 *
 */
@Service
public class StockAuditService {

    private final StockAuditSessionRepository sessionRepository;
    private final StockAuditItemRepository itemRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final UserRepository userRepository;
    private final MedicineRepository medicineRepository;
    private final DocumentSequenceService sequenceService;

    public StockAuditService(StockAuditSessionRepository sessionRepository, StockAuditItemRepository itemRepository,
                             InventoryRepository inventoryRepository, InventoryMovementRepository movementRepository,
                             UserRepository userRepository, MedicineRepository medicineRepository,
                             DocumentSequenceService sequenceService) {
        this.sessionRepository = sessionRepository;
        this.itemRepository = itemRepository;
        this.inventoryRepository = inventoryRepository;
        this.movementRepository = movementRepository;
        this.userRepository = userRepository;
        this.medicineRepository = medicineRepository;
        this.sequenceService = sequenceService;
    }

    @Transactional
    public SessionResponse createSession(CreateSessionRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        List<Inventory> activeInventory = inventoryRepository.findByPharmacyIdAndStatus(pharmacyId, BatchStatus.ACTIVE);
        if (activeInventory.isEmpty()) {
            throw new UnprocessableEntityException("No active inventory batches found. Add inventory before running a stock audit.");
        }

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.STOCK_AUDIT, DocumentSequenceService.istDayPeriod());
        StockAuditSession session = StockAuditSession.create(pharmacyId, DocumentNumberFormat.stockAudit(seq),
                TenantContext.userId(), req.notes());
        sessionRepository.save(session);

        List<StockAuditItem> items = activeInventory.stream()
                .map(inv -> StockAuditItem.create(pharmacyId, session.getId(), inv.getId(), inv.getQuantity()))
                .toList();
        itemRepository.saveAll(items);

        // Enrich from the already-fetched activeInventory/medicine lookups rather
        // than item.getInventory(): a freshly-persisted entity's lazy `inventory`
        // relation is never populated, and re-querying within the SAME transaction
        // doesn't help either — Hibernate's persistence-context identity map
        // returns these same already-managed (association-still-null) instances
        // instead of re-resolving the association from the query's join. A fresh
        // request (e.g. the subsequent GET /stock-audit/:id) has an empty
        // persistence context and resolves the fetch join correctly.
        Map<String, Inventory> inventoryById = activeInventory.stream()
                .collect(java.util.stream.Collectors.toMap(Inventory::getId, inv -> inv));
        Map<String, Medicine> medicineById = new HashMap<>();
        for (Medicine m : medicineRepository.findAllById(
                activeInventory.stream().map(Inventory::getMedicineId).distinct().toList())) {
            medicineById.put(m.getId(), m);
        }
        return toResponse(session, items, inventoryById, medicineById);
    }

    @Transactional
    public SessionResponse startSession(String id) {
        StockAuditSession session = load(id);
        requireStatus(session, AuditSessionStatus.DRAFT, "start");
        session.start();
        return toResponse(session, itemRepository.findBySessionIdOrderByCreatedAtAsc(id));
    }

    @Transactional
    public AuditItemResponse updateItem(String sessionId, String itemId, UpdateItemRequest req) {
        if (req.countedQty() == null && (req.notes() == null)) {
            throw new BadRequestException("At least one of countedQty or notes is required");
        }
        StockAuditSession session = load(sessionId);
        if (session.getStatus() != AuditSessionStatus.IN_PROGRESS) {
            throw new ConflictException("Can only update items when session is IN_PROGRESS");
        }
        StockAuditItem item = itemRepository.findByIdAndSessionId(itemId, sessionId)
                .orElseThrow(() -> new NotFoundException("Audit item not found"));
        item.recordCount(req.countedQty(), req.notes());
        return toItemResponse(item);
    }

    @Transactional
    public List<AuditItemResponse> batchUpdateItems(String sessionId, BatchUpdateItemsRequest req) {
        StockAuditSession session = load(sessionId);
        if (session.getStatus() != AuditSessionStatus.IN_PROGRESS) {
            throw new ConflictException("Can only update items when session is IN_PROGRESS");
        }
        List<String> itemIds = req.items().stream().map(BatchUpdateItemsRequest.Item::itemId).toList();
        Map<String, StockAuditItem> byId = new HashMap<>();
        for (StockAuditItem item : itemRepository.findByIdInAndSessionId(itemIds, sessionId)) {
            byId.put(item.getId(), item);
        }
        List<String> missing = itemIds.stream().filter(id -> !byId.containsKey(id)).toList();
        if (!missing.isEmpty()) {
            throw new NotFoundException("Audit items not found: " + String.join(", ", missing));
        }
        for (BatchUpdateItemsRequest.Item update : req.items()) {
            byId.get(update.itemId()).recordCount(update.countedQty(), null);
        }
        return itemIds.stream().map(id -> toItemResponse(byId.get(id))).toList();
    }

    @Transactional
    public SessionResponse reopenSession(String id) {
        StockAuditSession session = load(id);
        requireStatus(session, AuditSessionStatus.COMPLETED, "reopen");
        session.reopen();
        return toResponse(session, itemRepository.findBySessionIdOrderByCreatedAtAsc(id));
    }

    @Transactional
    public SessionResponse completeSession(String id, CompleteSessionRequest req) {
        StockAuditSession session = load(id);
        requireStatus(session, AuditSessionStatus.IN_PROGRESS, "complete");
        long uncounted = itemRepository.countBySessionIdAndCountedQtyIsNull(id);
        if (uncounted > 0) {
            throw new UnprocessableEntityException(uncounted + " item(s) still uncounted. Count all items before completing.");
        }
        session.complete(req.notes());
        return toResponse(session, itemRepository.findBySessionIdOrderByCreatedAtAsc(id));
    }

    /**
     * Serializable isolation, same rationale as InventoryService.reserve: two
     * concurrent approvals (or an approval racing a sale) must not both act on
     * stale inventory quantities.
     */
    @RetryOnConflict
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public SessionResponse approveSession(String id, ApproveSessionRequest req) {
        try {
            return doApprove(id, req);
        } catch (ConcurrencyFailureException e) {
            throw new ConflictException("Concurrent modification — please retry");
        }
    }

    private SessionResponse doApprove(String id, ApproveSessionRequest req) {
        User approver = userRepository.findByIdAndPharmacyId(TenantContext.userId(), TenantContext.pharmacyId())
                .filter(User::isActive)
                .orElseThrow(() -> new ForbiddenException("Approver does not belong to this pharmacy"));

        StockAuditSession session = load(id);
        requireStatus(session, AuditSessionStatus.COMPLETED, "approve");

        List<StockAuditItem> variantItems = itemRepository.findVarianceItems(id);
        if (!variantItems.isEmpty()) {
            List<String> inventoryIds = variantItems.stream().map(StockAuditItem::getInventoryId).toList();
            Map<String, Inventory> byId = new HashMap<>();
            // Tenant-scoped: the loop below OVERWRITES quantity with the counted
            // figure, which is the most destructive write in the application — it
            // replaces stock outright rather than adjusting it. Fifth site of this
            // pattern; the ids are session-scoped so it was not exploitable, but a
            // write this absolute should not rest on that.
            for (Inventory inv : inventoryRepository.findByIdInAndPharmacyId(inventoryIds, session.getPharmacyId())) {
                byId.put(inv.getId(), inv);
            }
            String userId = approver.getId();
            for (StockAuditItem item : variantItems) {
                Inventory inv = byId.get(item.getInventoryId());
                if (inv == null || inv.getStatus() != BatchStatus.ACTIVE || item.getCountedQty() == null) {
                    continue;
                }
                int quantityBefore = inv.getQuantity();
                int quantityAfter = Math.max(0, item.getCountedQty());
                inv.setQuantity(quantityAfter);
                int variance = item.getVarianceQty();
                movementRepository.save(InventoryMovement.record(session.getPharmacyId(), inv.getId(), userId,
                        MovementType.ADJUSTMENT, variance > 0 ? MovementDirection.IN : MovementDirection.OUT,
                        Math.abs(variance), quantityBefore, quantityAfter, "STOCK_AUDIT", session.getId(),
                        "Stock audit " + session.getSessionNumber() + ": variance " + (variance > 0 ? "+" : "") + variance));
            }
        }

        session.approve(approver.getId());
        return toResponse(session, itemRepository.findBySessionIdOrderByCreatedAtAsc(id));
    }

    @Transactional
    public void cancelSession(String id) {
        StockAuditSession session = load(id);
        if (session.getStatus() != AuditSessionStatus.DRAFT && session.getStatus() != AuditSessionStatus.IN_PROGRESS) {
            throw new ConflictException("Cannot cancel a session in " + session.getStatus() + " status");
        }
        session.cancel();
    }

    @Transactional(readOnly = true)
    public SessionResponse getSession(String id) {
        StockAuditSession session = load(id);
        return toResponse(session, itemRepository.findBySessionIdOrderByCreatedAtAsc(id));
    }

    @Transactional(readOnly = true)
    public SessionPageResponse listSessions(String status, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        Page<StockAuditSession> result = sessionRepository.search(TenantContext.pharmacyId(), blankToNull(status),
                PageRequest.of(safePage - 1, safeLimit));

        List<StockAuditSession> sessions = result.getContent();
        List<String> sessionIds = sessions.stream().map(StockAuditSession::getId).toList();
        Map<String, Long> total = sessionIds.isEmpty() ? Map.of() : toMap(itemRepository.countTotalBySessionIds(sessionIds));
        Map<String, Long> counted = sessionIds.isEmpty() ? Map.of() : toMap(itemRepository.countCountedBySessionIds(sessionIds));
        Map<String, Long> variance = sessionIds.isEmpty() ? Map.of() : toMap(itemRepository.countVarianceBySessionIds(sessionIds));

        List<SessionSummary> summaries = sessions.stream().map(s -> new SessionSummary(
                s.getId(), s.getSessionNumber(), s.getStatus().name(), s.getNotes(), s.getCreatedBy(),
                s.getStartedAt(), s.getCompletedAt(), s.getApprovedAt(),
                new SessionResponse.CountRef(total.getOrDefault(s.getId(), 0L).intValue()),
                counted.getOrDefault(s.getId(), 0L).intValue(), variance.getOrDefault(s.getId(), 0L).intValue(),
                s.getCreatedAt())).toList();

        return new SessionPageResponse(summaries, result.getTotalElements(), safePage, safeLimit);
    }

    @Transactional(readOnly = true)
    public VarianceSummaryResponse getVarianceSummary(String id) {
        StockAuditSession session = load(id);
        List<StockAuditItem> variantItems = itemRepository.findVarianceItems(id);

        List<VarianceSummaryResponse.Adjustment> adjustments = variantItems.stream().map(item -> {
            Inventory inv = item.getInventory();
            String direction = item.getVarianceQty() > 0 ? "IN" : "OUT";
            int resultQty = Math.max(0, item.getCountedQty() == null ? 0 : item.getCountedQty());
            return new VarianceSummaryResponse.Adjustment(item.getInventoryId(),
                    inv == null || inv.getMedicine() == null ? null : inv.getMedicine().getName(),
                    inv == null ? null : inv.getBatchNumber(), inv == null ? null : inv.getExpiryDate(),
                    inv == null ? 0 : inv.getQuantity(), item.getExpectedQty(), item.getCountedQty(),
                    item.getVarianceQty(), direction, resultQty);
        }).toList();

        int totalIn = adjustments.stream().filter(a -> "IN".equals(a.direction())).mapToInt(a -> a.varianceQty() == null ? 0 : a.varianceQty()).sum();
        int totalOut = adjustments.stream().filter(a -> "OUT".equals(a.direction())).mapToInt(a -> a.varianceQty() == null ? 0 : Math.abs(a.varianceQty())).sum();

        return new VarianceSummaryResponse(id, session.getSessionNumber(), session.getStatus().name(),
                variantItems.size(), adjustments, new VarianceSummaryResponse.Summary(totalIn, totalOut, totalIn - totalOut));
    }

    /** Dashboard-home summary — whichever session needs the owner/manager's attention right now. */
    @Transactional(readOnly = true)
    public AuditOverviewResponse getOverview() {
        String pharmacyId = TenantContext.pharmacyId();

        StockAuditSession activeSession = sessionRepository
                .findByPharmacyIdAndStatusInOrderByCreatedAtDesc(pharmacyId,
                        List.of(AuditSessionStatus.DRAFT, AuditSessionStatus.IN_PROGRESS), PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        AuditOverviewResponse.Active active = null;
        if (activeSession != null) {
            long totalItems = itemRepository.countTotalBySessionIds(List.of(activeSession.getId())).stream()
                    .findFirst().map(StockAuditItemRepository.SessionCountRow::getCnt).orElse(0L);
            long countedItems = itemRepository.countCountedBySessionIds(List.of(activeSession.getId())).stream()
                    .findFirst().map(StockAuditItemRepository.SessionCountRow::getCnt).orElse(0L);
            active = new AuditOverviewResponse.Active(activeSession.getId(), activeSession.getSessionNumber(),
                    activeSession.getStatus().name(), totalItems, countedItems);
        }

        StockAuditSession completedSession = sessionRepository
                .findByPharmacyIdAndStatusInOrderByCreatedAtDesc(pharmacyId, List.of(AuditSessionStatus.COMPLETED), PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        AuditOverviewResponse.NeedsApproval needsApproval = completedSession == null ? null
                : new AuditOverviewResponse.NeedsApproval(completedSession.getId(), completedSession.getSessionNumber());

        StockAuditSession approvedSession = sessionRepository
                .findByPharmacyIdAndStatusOrderByApprovedAtDesc(pharmacyId, AuditSessionStatus.APPROVED, PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        AuditOverviewResponse.LastApproved lastApproved = null;
        Long daysSinceLastAudit = null;
        if (approvedSession != null) {
            lastApproved = new AuditOverviewResponse.LastApproved(approvedSession.getId(),
                    approvedSession.getSessionNumber(), approvedSession.getApprovedAt());
            daysSinceLastAudit = ChronoUnit.DAYS.between(approvedSession.getApprovedAt(), Instant.now());
        }

        return new AuditOverviewResponse(active, needsApproval, lastApproved, daysSinceLastAudit);
    }

    /** Historical P&L view over every APPROVED session — gain/loss valued at each item's purchase rate. */
    @Transactional(readOnly = true)
    public AuditReportResponse getReport() {
        String pharmacyId = TenantContext.pharmacyId();
        List<StockAuditSession> approved = sessionRepository
                .findByPharmacyIdAndStatusOrderByApprovedAtDesc(pharmacyId, AuditSessionStatus.APPROVED, Pageable.unpaged());
        if (approved.isEmpty()) {
            return new AuditReportResponse(List.of(), new AuditReportResponse.Totals(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO));
        }

        List<String> sessionIds = approved.stream().map(StockAuditSession::getId).toList();
        Map<String, Long> totalBySession = new HashMap<>();
        for (StockAuditItemRepository.SessionCountRow row : itemRepository.countTotalBySessionIds(sessionIds)) {
            totalBySession.put(row.getSessionId(), row.getCnt());
        }
        Map<String, Long> varianceBySession = new HashMap<>();
        for (StockAuditItemRepository.SessionCountRow row : itemRepository.countVarianceBySessionIds(sessionIds)) {
            varianceBySession.put(row.getSessionId(), row.getCnt());
        }
        Map<String, BigDecimal[]> valueBySession = new HashMap<>();
        for (StockAuditItemRepository.SessionValueRow row : itemRepository.sumVarianceValueBySessionIds(sessionIds)) {
            valueBySession.put(row.getSessionId(), new BigDecimal[]{row.getGainValue(), row.getLossValue()});
        }

        List<AuditReportResponse.Session> sessions = new ArrayList<>();
        BigDecimal totalGain = BigDecimal.ZERO;
        BigDecimal totalLoss = BigDecimal.ZERO;
        for (StockAuditSession s : approved) {
            BigDecimal[] values = valueBySession.getOrDefault(s.getId(), new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO});
            BigDecimal gain = values[0];
            BigDecimal loss = values[1];
            totalGain = totalGain.add(gain);
            totalLoss = totalLoss.add(loss);
            sessions.add(new AuditReportResponse.Session(s.getId(), s.getSessionNumber(), s.getApprovedAt(),
                    totalBySession.getOrDefault(s.getId(), 0L), varianceBySession.getOrDefault(s.getId(), 0L),
                    gain, loss, gain.subtract(loss)));
        }

        return new AuditReportResponse(sessions, new AuditReportResponse.Totals(totalGain, totalLoss, totalGain.subtract(totalLoss)));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private StockAuditSession load(String id) {
        return sessionRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Audit session not found"));
    }

    private void requireStatus(StockAuditSession session, AuditSessionStatus required, String action) {
        if (session.getStatus() != required) {
            throw new ConflictException("Cannot " + action + " a session in " + session.getStatus() + " status");
        }
    }

    private Map<String, Long> toMap(List<StockAuditItemRepository.SessionCountRow> rows) {
        Map<String, Long> map = new HashMap<>();
        for (StockAuditItemRepository.SessionCountRow r : rows) {
            map.put(r.getSessionId(), r.getCnt());
        }
        return map;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private SessionResponse toResponse(StockAuditSession session, List<StockAuditItem> items) {
        return toResponse(session, items, Map.of(), Map.of());
    }

    /**
     * inventoryById/medicineById exist only for createSession, whose items were
     * just persisted in this same transaction — see its call site for why
     * item.getInventory() can't be trusted there. Every other caller loads items
     * via a query (fetch-joining inventory+medicine) and passes empty maps,
     * falling back to the relation on the entity itself.
     */
    private SessionResponse toResponse(StockAuditSession session, List<StockAuditItem> items,
                                       Map<String, Inventory> inventoryById, Map<String, Medicine> medicineById) {
        long counted = items.stream().filter(i -> i.getCountedQty() != null).count();
        long variance = items.stream().filter(i -> i.getVarianceQty() != null && i.getVarianceQty() != 0).count();
        SessionResponse.ApproverRef approverRef = null;
        if (session.getApprovedBy() != null) {
            approverRef = userRepository.findById(session.getApprovedBy())
                    .map(u -> new SessionResponse.ApproverRef(u.getId(), u.getName())).orElse(null);
        }
        return new SessionResponse(session.getId(), session.getSessionNumber(), session.getStatus().name(),
                session.getNotes(), session.getStartedAt(), session.getCompletedAt(), session.getApprovedAt(),
                approverRef, new SessionResponse.CountRef(items.size()), (int) counted, (int) variance,
                items.stream().map(i -> toItemResponse(i, inventoryById, medicineById)).toList(), session.getCreatedAt());
    }

    private AuditItemResponse toItemResponse(StockAuditItem item) {
        return toItemResponse(item, Map.of(), Map.of());
    }

    private AuditItemResponse toItemResponse(StockAuditItem item, Map<String, Inventory> inventoryById,
                                             Map<String, Medicine> medicineById) {
        Inventory inv = item.getInventory() != null ? item.getInventory() : inventoryById.get(item.getInventoryId());
        AuditItemResponse.InventoryRef invRef = null;
        if (inv != null) {
            Medicine medicine = inv.getMedicine() != null ? inv.getMedicine() : medicineById.get(inv.getMedicineId());
            AuditItemResponse.MedicineRef medRef = medicine == null ? null
                    : new AuditItemResponse.MedicineRef(medicine.getId(), medicine.getName(),
                            medicine.getGenericName(), medicine.getForm(), medicine.getStrength());
            invRef = new AuditItemResponse.InventoryRef(inv.getId(), inv.getBatchNumber(), inv.getExpiryDate(),
                    inv.getQuantity(), inv.getMrp(), medRef);
        }
        return new AuditItemResponse(item.getId(), invRef, item.getExpectedQty(), item.getCountedQty(),
                item.getVarianceQty(), item.getNotes());
    }
}
