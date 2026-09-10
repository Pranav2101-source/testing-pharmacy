package com.checkup.pharmacy.modules.billing;

import org.springframework.context.ApplicationEventPublisher;
import com.checkup.pharmacy.modules.integration.emr.PrescriptionDispensedEvent;
import com.checkup.pharmacy.common.concurrency.RetryOnConflict;
import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.InvoiceStatus;
import com.checkup.pharmacy.common.enums.MedicineMatchStatus;
import com.checkup.pharmacy.common.enums.MovementDirection;
import com.checkup.pharmacy.common.enums.MovementType;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.PaymentStatus;
import com.checkup.pharmacy.common.enums.ReturnDisposition;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.util.GstCalculator;
import com.checkup.pharmacy.modules.billing.dto.AddPaymentRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateInvoiceRequest;
import com.checkup.pharmacy.modules.billing.dto.CreateReturnRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoiceItemRequest;
import com.checkup.pharmacy.modules.billing.dto.InvoicePageResponse;
import com.checkup.pharmacy.modules.billing.dto.InvoiceResponse;
import com.checkup.pharmacy.modules.billing.dto.PaymentResponse;
import com.checkup.pharmacy.modules.billing.dto.RepeatCartResponse;
import com.checkup.pharmacy.modules.billing.dto.ReturnItemRequest;
import com.checkup.pharmacy.modules.billing.dto.SalesReturnPageResponse;
import com.checkup.pharmacy.modules.billing.dto.SalesReturnResponse;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.customer.CustomerRepository;
import com.checkup.pharmacy.modules.doctor.Doctor;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.inventory.EffectiveMedicine;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovement;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.inventory.StockReservation;
import com.checkup.pharmacy.modules.inventory.StockReservationRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PackSizeSignal;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicine;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import com.checkup.pharmacy.modules.pharmacy.PharmacyRepository;
import com.checkup.pharmacy.modules.prescription.Prescription;
import com.checkup.pharmacy.modules.prescription.PrescriptionItem;
import com.checkup.pharmacy.modules.prescription.PrescriptionItemRepository;
import com.checkup.pharmacy.modules.prescription.PrescriptionRepository;
import com.checkup.pharmacy.modules.user.User;
import com.checkup.pharmacy.modules.user.UserRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Point-of-sale billing: invoices, split payments, and sales returns, scoped to
 * the caller's pharmacy. {@code createInvoice}/{@code cancelInvoice}/
 * {@code createReturn}/{@code addPayment} all run under Serializable isolation
 * and retry as a 409 on conflict — the same pattern as
 * {@code InventoryService.reserve} and {@code StockAuditService.approveSession},
 * since every one of these mutates shared Inventory rows.
 *
 * Invoice numbering and the sales-return window now both read the pharmacy's
 * saved invoice settings (see {@link PharmacyInvoiceSettings}); they were
 * previously hardcoded to "INV/{fy}/{seq}" and 30 days while the settings screen
 * presented them as configurable. Print customisation is applied client-side
 * from the same stored config. Still deferred vs. the Node original: dashboard
 * stats, repeat-last-bill, and the async post-invoice notification queue.
 */
@Service
public class BillingService {

    // The 30-day default now lives on PharmacyInvoiceSettings, which is what
    // resolves it against the pharmacy's saved settings.
    private static final Set<String> CONTROLLED_SCHEDULES = Set.of("H", "H1", "X");
    private static final int MAX_PAGE_LIMIT = 100;

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BillingService.class);

    private final InvoiceRepository invoiceRepository;
    private final InvoiceItemRepository invoiceItemRepository;
    private final InvoicePaymentRepository invoicePaymentRepository;
    private final SalesReturnRepository salesReturnRepository;
    private final SalesReturnItemRepository salesReturnItemRepository;
    private final InventoryRepository inventoryRepository;
    private final InventoryMovementRepository movementRepository;
    private final StockReservationRepository reservationRepository;
    private final CustomerRepository customerRepository;
    private final DoctorRepository doctorRepository;
    private final PharmacyRepository pharmacyRepository;
    private final MedicineRepository medicineRepository;
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository prescriptionItemRepository;
    private final UserRepository userRepository;
    private final ApplicationEventPublisher eventPublisher;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.modules.audit.AuditService auditService;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private final com.checkup.pharmacy.modules.dispensing.DispensingService dispensingService;
    /** Records a pharmacist overruling the engine's pack count — see {@link #capturePackSizeSignal}. */
    private final com.checkup.pharmacy.modules.medicine.PackSizeSignalRepository packSizeSignalRepository;

    public BillingService(InvoiceRepository invoiceRepository, InvoiceItemRepository invoiceItemRepository,
                          InvoicePaymentRepository invoicePaymentRepository, SalesReturnRepository salesReturnRepository,
                          SalesReturnItemRepository salesReturnItemRepository, InventoryRepository inventoryRepository,
                          InventoryMovementRepository movementRepository, StockReservationRepository reservationRepository,
                          CustomerRepository customerRepository,
                          DoctorRepository doctorRepository, PharmacyRepository pharmacyRepository,
                          MedicineRepository medicineRepository,
                          PharmacyMedicineOverrideRepository overrideRepository, PrescriptionRepository prescriptionRepository,
                          PrescriptionItemRepository prescriptionItemRepository,
                          UserRepository userRepository, DocumentSequenceService sequenceService,
                          com.checkup.pharmacy.modules.audit.AuditService auditService,
                          com.fasterxml.jackson.databind.ObjectMapper objectMapper,
                          com.checkup.pharmacy.modules.dispensing.DispensingService dispensingService,
                          com.checkup.pharmacy.modules.medicine.PackSizeSignalRepository packSizeSignalRepository,
                          ApplicationEventPublisher eventPublisher) {
        this.invoiceRepository = invoiceRepository;
        this.invoiceItemRepository = invoiceItemRepository;
        this.invoicePaymentRepository = invoicePaymentRepository;
        this.salesReturnRepository = salesReturnRepository;
        this.salesReturnItemRepository = salesReturnItemRepository;
        this.inventoryRepository = inventoryRepository;
        this.movementRepository = movementRepository;
        this.reservationRepository = reservationRepository;
        this.customerRepository = customerRepository;
        this.doctorRepository = doctorRepository;
        this.pharmacyRepository = pharmacyRepository;
        this.medicineRepository = medicineRepository;
        this.overrideRepository = overrideRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.prescriptionItemRepository = prescriptionItemRepository;
        this.userRepository = userRepository;
        this.eventPublisher = eventPublisher;
        this.sequenceService = sequenceService;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
        this.dispensingService = dispensingService;
        this.packSizeSignalRepository = packSizeSignalRepository;
    }

    // ── Dashboard stats + invoice settings ───────────────────────────────────

    private static final java.time.ZoneOffset IST = java.time.ZoneOffset.ofHoursMinutes(5, 30);

    /**
     * Home / Sales dashboard stats — nine serial aggregate queries. Cached in-process for
     * {@code app.cache.dashboard-stats-ttl-seconds} (default 30s) per pharmacy: this is hit
     * on every home and sales screen load and by the reports Overview, so under load a busy
     * pharmacy's staff would otherwise fire the whole set many times a minute against a
     * small connection pool. The key is tenant-scoped (no-arg method + TenantAwareKeyGenerator).
     * A 30s-stale glanceable overview is acceptable — no figure here is filed or reconciled.
     */
    @org.springframework.cache.annotation.Cacheable(
            cacheNames = com.checkup.pharmacy.config.CacheConfig.DASHBOARD_STATS,
            cacheManager = "caffeineCacheManager")
    @Transactional(readOnly = true)
    public com.checkup.pharmacy.modules.billing.dto.DashboardStatsResponse getDashboardStats() {
        String pharmacyId = TenantContext.pharmacyId();
        java.time.LocalDate istToday = java.time.LocalDate.now(IST);
        java.time.Instant todayStart = istToday.atStartOfDay(IST).toInstant();
        java.time.Instant weekStart = todayStart.minus(java.time.Duration.ofDays(7));
        java.time.Instant monthStart = istToday.withDayOfMonth(1).atStartOfDay(IST).toInstant();
        java.time.Instant nearExpiryThreshold = java.time.Instant.now().plus(java.time.Duration.ofDays(90));

        var today = invoiceRepository.sumAndCountSince(pharmacyId, todayStart);
        var week = invoiceRepository.sumAndCountSince(pharmacyId, weekStart);
        var month = invoiceRepository.sumAndCountSince(pharmacyId, monthStart);
        long todayCancelled = invoiceRepository.countCancelledSince(pharmacyId, todayStart);
        java.math.BigDecimal todayReturns = salesReturnRepository.sumSince(pharmacyId, todayStart);
        java.math.BigDecimal pendingCredit = invoiceRepository.sumPendingCredit(pharmacyId);
        var breakdown = invoiceRepository.paymentBreakdownSince(pharmacyId, todayStart).stream()
                .map(r -> new com.checkup.pharmacy.modules.billing.dto.DashboardStatsResponse.PaymentBreakdown(
                        r.getMode(), r.getTotal(), r.getCnt()))
                .toList();
        long lowStock = inventoryRepository.countLowStockInStock(pharmacyId);
        long nearExpiry = inventoryRepository.countExpiryAlerts(pharmacyId, nearExpiryThreshold);

        return new com.checkup.pharmacy.modules.billing.dto.DashboardStatsResponse(
                round2(today.getTotal()), today.getCnt(), todayCancelled, round2(todayReturns),
                round2(week.getTotal()), week.getCnt(), round2(month.getTotal()), month.getCnt(),
                round2(pendingCredit), breakdown, lowStock, nearExpiry);
    }

    @Transactional(readOnly = true)
    public com.fasterxml.jackson.databind.JsonNode getInvoiceSettings() {
        Pharmacy p = pharmacyRepository.findById(TenantContext.pharmacyId())
                .orElseThrow(() -> new com.checkup.pharmacy.common.exception.NotFoundException("Pharmacy not found"));
        return parseJson(p.getInvoiceSettings());
    }

    @Transactional
    public com.fasterxml.jackson.databind.JsonNode saveInvoiceSettings(com.fasterxml.jackson.databind.JsonNode config) {
        String pharmacyId = TenantContext.pharmacyId();
        Pharmacy p = pharmacyRepository.findById(pharmacyId)
                .orElseThrow(() -> new com.checkup.pharmacy.common.exception.NotFoundException("Pharmacy not found"));

        // Must be a JSON OBJECT (or null to clear). Two reasons this is checked rather
        // than stored as-is:
        //
        //  1. The audit-log line below converts the body to a Map, and Jackson throws
        //     IllegalArgumentException on an array/string/number — which escaped as an
        //     opaque 500 rather than telling the caller what was wrong with their body.
        //  2. Anything that is not an object is meaningless as invoice settings. Storing
        //     it would "succeed", then make every subsequent read silently fall back to
        //     defaults — a setting that appears saved and does nothing.
        boolean clearing = config == null || config.isNull();
        if (!clearing && !config.isObject()) {
            throw new BadRequestException("Invoice settings must be a JSON object, received "
                    + config.getNodeType().toString().toLowerCase() + ".");
        }

        String json = clearing ? null : config.toString();
        p.setInvoiceSettings(json);

        java.util.Map<String, Object> newData = clearing ? null
                : objectMapper.convertValue(config, new com.fasterxml.jackson.core.type.TypeReference<>() { });
        auditService.log(com.checkup.pharmacy.modules.audit.AuditEntry
                .of(com.checkup.pharmacy.common.enums.AuditModule.SETTINGS, "UPDATE", "InvoiceSettings")
                .pharmacyId(pharmacyId).userId(TenantContext.userId()).entityId(pharmacyId).newData(newData));
        return parseJson(json);
    }

    // ── Billing-screen action preferences ────────────────────────────────────
    //
    // Which save actions exist on the bill screen, which are pinned to the Save
    // dropdown, and their order. Lived in browser localStorage until now, so it was
    // lost on a browser clear and did not follow staff to another till. Stored
    // pharmacy-wide alongside invoiceSettings — it is shop policy, not a personal
    // preference, and every till must show the same actions.

    @Transactional(readOnly = true)
    public com.fasterxml.jackson.databind.JsonNode getBillingPreferences() {
        Pharmacy p = pharmacyRepository.findById(TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Pharmacy not found"));
        return parseJson(p.getBillingPreferences());
    }

    @Transactional
    public com.fasterxml.jackson.databind.JsonNode saveBillingPreferences(
            com.fasterxml.jackson.databind.JsonNode config) {
        String pharmacyId = TenantContext.pharmacyId();
        Pharmacy p = pharmacyRepository.findById(pharmacyId)
                .orElseThrow(() -> new NotFoundException("Pharmacy not found"));

        // Same guard as saveInvoiceSettings: anything that is not a JSON object is
        // meaningless here and would "save" successfully while every later read fell
        // back to defaults — a setting that appears stored and does nothing.
        boolean clearing = config == null || config.isNull();
        if (!clearing && !config.isObject()) {
            throw new BadRequestException("Billing preferences must be a JSON object, received "
                    + config.getNodeType().toString().toLowerCase() + ".");
        }

        String json = clearing ? null : config.toString();
        p.setBillingPreferences(json);

        java.util.Map<String, Object> newData = clearing ? null
                : objectMapper.convertValue(config, new com.fasterxml.jackson.core.type.TypeReference<>() { });
        auditService.log(com.checkup.pharmacy.modules.audit.AuditEntry
                .of(com.checkup.pharmacy.common.enums.AuditModule.SETTINGS, "UPDATE", "BillingPreferences")
                .pharmacyId(pharmacyId).userId(TenantContext.userId()).entityId(pharmacyId).newData(newData));
        return parseJson(json);
    }

    private com.fasterxml.jackson.databind.JsonNode parseJson(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static java.math.BigDecimal round2(java.math.BigDecimal v) {
        return (v != null ? v : java.math.BigDecimal.ZERO).setScale(2, java.math.RoundingMode.HALF_UP);
    }

    // ── Create Invoice ───────────────────────────────────────────────────────

    /**
     * Runs at READ COMMITTED with explicit row locks on the batches being sold,
     * rather than under SERIALIZABLE.
     *
     * <p>SERIALIZABLE was correct but pessimal for the busiest endpoint in the
     * product. It made Postgres track the transaction's whole read set — pharmacy,
     * customer, doctor, prescription, GST overrides, every batch — and abort on any
     * apparent ordering conflict, including ones that had nothing to do with the
     * stock actually being decremented. Two counters selling the same fast-moving
     * medicine would both complete their work and one would be thrown away, which
     * is precisely the retry storm this endpoint could not afford at peak.
     *
     * <p>Locking the batch rows up front (see
     * {@code InventoryRepository#lockAllByIdInAndPharmacyId}) narrows the conflict
     * window to the rows whose quantity actually changes. The correctness property
     * that matters — no two invoices may decrement the same batch below zero — is
     * preserved by the lock: the second transaction blocks until the first commits,
     * then re-reads the post-decrement quantity and fails the availability check
     * honestly instead of overselling.
     *
     * <p>{@link RetryOnConflict} remains as a backstop for deadlocks and lock
     * timeouts, so a lost race becomes a transparent replay rather than a 409 the
     * pharmacist has to action mid-queue.
     */
    @RetryOnConflict
    @Transactional
    public InvoiceResponse createInvoice(CreateInvoiceRequest req) {
        try {
            return doCreateInvoice(req);
        } catch (ConcurrencyFailureException e) {
            // Only reachable once RetryOnConflict has exhausted its attempts.
            throw new ConflictException("Another transaction updated this stock simultaneously — please try again");
        }
    }

    private InvoiceResponse doCreateInvoice(CreateInvoiceRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        String userId = TenantContext.userId();

        List<String> inventoryIds = req.items().stream().map(InvoiceItemRequest::inventoryId).toList();
        if (new HashSet<>(inventoryIds).size() != inventoryIds.size()) {
            throw new BadRequestException("Duplicate inventory items in a single invoice are not allowed");
        }

        if (req.idempotencyKey() != null && !req.idempotencyKey().isBlank()) {
            var existing = invoiceRepository.findByPharmacyIdAndIdempotencyKey(pharmacyId, req.idempotencyKey());
            if (existing.isPresent()) {
                return toResponse(existing.get());
            }
        }

        // What this till is already holding. Read before the locks so the full set of
        // batches to lock is known up front — including any this session reserved and
        // then removed from the cart, which must still be released below.
        String sessionId = req.reservationSessionId();
        List<StockReservation> ownReservations = sessionId == null
                ? List.of()
                : reservationRepository.findByPharmacyIdAndSessionId(pharmacyId, sessionId);
        Map<String, Integer> ownReservedByInventoryId = new HashMap<>();
        for (StockReservation r : ownReservations) {
            ownReservedByInventoryId.merge(r.getInventoryId(), r.getQuantity(), Integer::sum);
        }

        // Take the write locks FIRST, before reading any quantity. Everything below
        // — availability checks, GST maths, the decrement — then operates on batch
        // rows no other transaction can move underneath us. Loading them unlocked
        // and locking later would reintroduce the read-then-write race this is
        // meant to close.
        //
        // The query filters by pharmacyId in SQL, so the previous in-Java tenant
        // check is no longer load-bearing: a batch belonging to another pharmacy
        // is simply not returned, and falls out as "not found" below.
        //
        // LinkedHashSet: the invoice's own batches plus any this session still has
        // reserved. lockAllByIdInAndPharmacyId orders by id, so lock acquisition
        // order stays deterministic and two tills cannot deadlock against each other.
        Set<String> idsToLock = new LinkedHashSet<>(inventoryIds);
        idsToLock.addAll(ownReservedByInventoryId.keySet());

        Map<String, Inventory> batchMap = new HashMap<>();
        for (Inventory inv : inventoryRepository.lockAllByIdInAndPharmacyId(idsToLock, pharmacyId)) {
            batchMap.put(inv.getId(), inv);
        }
        for (String id : inventoryIds) {
            if (!batchMap.containsKey(id)) {
                throw new NotFoundException("Inventory item not found: " + id);
            }
        }

        // The catalogue medicine each batch on this bill should actually be treated as: its
        // own direct link, or, for a batch received against a local medicine identity that has
        // since been confirmed LINKED to the catalogue (see PharmacyMedicine#confirmLink), the
        // linked medicine — see EffectiveMedicine. InventoryService.enrich() makes the exact
        // same resolution on the read side, so a batch the POS shows as loose-sellable/GST-
        // configured is also allowed to actually sell that way; a batch whose local identity is
        // still PENDING/SUGGESTED/KEPT_LOCAL (or LINKED to a since-deleted medicine) resolves to
        // null here, same as before this existed.
        //
        // batch.getMedicine()/getLocalMedicine() are each already loaded per batch (lazily,
        // within this transaction) by the lock query above, so the only NEW query this needs is
        // ONE batch fetch of the linked targets — not one per line, regardless of how many
        // lines reference a linked local medicine.
        Map<String, PharmacyMedicine> localMedicinesById = new HashMap<>();
        Set<String> linkedMedicineIds = new HashSet<>();
        for (Inventory batch : batchMap.values()) {
            if (batch.getMedicineId() != null) {
                continue;
            }
            PharmacyMedicine local = batch.getLocalMedicine();
            if (local == null) {
                continue;
            }
            localMedicinesById.put(local.getId(), local);
            if (local.getMatchStatus() == MedicineMatchStatus.LINKED && local.getLinkedMedicineId() != null) {
                linkedMedicineIds.add(local.getLinkedMedicineId());
            }
        }
        Map<String, Medicine> linkedMedicinesById = new HashMap<>();
        if (!linkedMedicineIds.isEmpty()) {
            for (Medicine m : medicineRepository.findAllById(linkedMedicineIds)) {
                linkedMedicinesById.put(m.getId(), m);
            }
        }
        Map<String, Medicine> effectiveMedicineByInventoryId = new HashMap<>();
        for (Inventory batch : batchMap.values()) {
            effectiveMedicineByInventoryId.put(batch.getId(), EffectiveMedicine.resolve(
                    batch.getMedicine(), batch.getLocalMedicineId(), localMedicinesById, linkedMedicinesById));
        }

        // Holds by OTHER sessions that are still live, counted from the reservation
        // rows rather than from Inventory.reservedQuantity.
        //
        // That counter is denormalised and still includes holds whose TTL has passed —
        // they are only subtracted when something sweeps them, and the sweeper is a
        // cron (every 5 min) while the TTL is 15. Reading the counter therefore refused
        // sales against stock that was already free for up to a sweep interval, and
        // blamed "another billing session" that had ended. Worse, a till that built a
        // cart, was interrupted past the TTL, then pressed Save was blocked by its OWN
        // dead hold: an expired row no longer matches this session's live set, so it
        // counted as somebody else's.
        //
        // Read AFTER the batch locks above, deliberately: reserve() takes the same row
        // locks before inserting, so while this transaction holds them no new hold can
        // be committed against these batches and this count cannot go stale under us.
        Instant liveAt = Instant.now();
        Map<String, Integer> liveOtherReserved = new HashMap<>();
        for (StockReservation r : reservationRepository
                .findByPharmacyIdAndInventoryIdInAndExpiresAtAfter(pharmacyId, idsToLock, liveAt)) {
            if (sessionId != null && sessionId.equals(r.getSessionId())) {
                continue; // our own hold — released below as part of this same sale
            }
            liveOtherReserved.merge(r.getInventoryId(), r.getQuantity(), Integer::sum);
        }

        Pharmacy pharmacy = pharmacyRepository.findById(pharmacyId).orElseThrow(() -> new NotFoundException("Pharmacy not found"));

        // Decided from the request, before the customer is read, because it determines
        // HOW the customer is read: a sale that will move the credit balance takes a
        // write lock on the row, an ordinary cash sale must not queue behind one.
        PaymentMode paymentMode = parsePaymentMode(req.paymentModeOrDefault());
        PaymentStatus paymentStatus = parsePaymentStatus(req.paymentStatusOrDefault());
        boolean onCredit = paymentMode == PaymentMode.CREDIT && paymentStatus != PaymentStatus.PAID;

        Customer customer = null;
        if (req.customerId() != null && !req.customerId().isBlank()) {
            customer = (onCredit
                    ? customerRepository.lockByIdAndPharmacyId(req.customerId(), pharmacyId)
                    : customerRepository.findByIdAndPharmacyIdAndDeletedAtIsNull(req.customerId(), pharmacyId))
                    .orElseThrow(() -> new NotFoundException("Customer not found"));
        }

        // Resolved through IndianState, not compared as raw text: "Tamilnadu" and "Tamil Nadu"
        // are one state, and equalsIgnoreCase charged IGST on a local sale when they differed.
        // The same call decides a goods receipt and a debit note, so a sale and a purchase can
        // never disagree about where this pharmacy is.
        //
        // The client's own flag is honoured ONLY while the pharmacy has no state on file —
        // there is nothing to compare against then, and refusing outright would block billing
        // on a setting the cashier cannot change. Once the state is set it is authoritative.
        boolean isInterstate = req.isInterstateOrDefault();
        if (pharmacy.getState() != null && !pharmacy.getState().isBlank()) {
            isInterstate = customer != null
                    && com.checkup.pharmacy.common.tax.TaxJurisdiction.isInterstate(
                            pharmacy.getState(), customer.getState());
        }

        Doctor doctor = req.doctorId() != null && !req.doctorId().isBlank()
                ? doctorRepository.findByIdAndPharmacyId(req.doctorId(), pharmacyId).orElse(null)
                : null;

        // Schedule H/H1/X medicines require a prescription reference (Indian Drug Rules).
        List<String> controlled = new ArrayList<>();
        for (InvoiceItemRequest item : req.items()) {
            Inventory batch = batchMap.get(item.inventoryId());
            Medicine eff = effectiveMedicineByInventoryId.get(batch.getId());
            String rawSchedule = eff != null ? eff.getSchedule() : batch.productSchedule();
            String schedule = rawSchedule == null ? null : rawSchedule.toUpperCase().trim();
            if (schedule != null && CONTROLLED_SCHEDULES.contains(schedule)) {
                controlled.add(batch.productName() + " (Schedule " + schedule + ")");
            }
        }
        if (!controlled.isEmpty() && (req.prescriptionId() == null || req.prescriptionId().isBlank())) {
            throw new UnprocessableEntityException(
                    "Prescription required for controlled medicine(s): " + String.join(", ", controlled)
                    + ". Provide a valid prescriptionId to proceed.");
        }

        Prescription prescription = null;
        if (req.prescriptionId() != null && !req.prescriptionId().isBlank()) {
            prescription = prescriptionRepository.findByIdAndPharmacyId(req.prescriptionId(), pharmacyId)
                    .orElseThrow(() -> new NotFoundException("Prescription not found"));
            if (prescription.getStatus() != com.checkup.pharmacy.common.enums.PrescriptionStatus.ACTIVE
                    && prescription.getStatus() != com.checkup.pharmacy.common.enums.PrescriptionStatus.PARTIAL) {
                throw new ConflictException("Prescription is " + prescription.getStatus() + " and cannot be used for billing");
            }
        }

        // Only the medicines actually being sold. batchMap can now also hold batches
        // this session merely had reserved, so the ids come from the invoice lines.
        // The EFFECTIVE medicine per line — a batch's own catalogue link, or a LINKED local
        // medicine's catalogue target — so this pharmacy's override on that catalogue medicine
        // is found below regardless of which batch id physically carries the stock.
        Set<String> medicineIds = new HashSet<>();
        for (InvoiceItemRequest item : req.items()) {
            Medicine eff = effectiveMedicineByInventoryId.get(item.inventoryId());
            if (eff != null) {
                medicineIds.add(eff.getId());
            }
        }
        // Filtered in SQL, not in Java: this used to load every override the pharmacy
        // had ever set — thousands of rows on a customised catalogue — and discard all
        // but the few on this bill, on every single sale.
        Map<String, BigDecimal> gstOverrideByMedicineId = new HashMap<>();
        Set<String> looseAllowedMedicineIds = new HashSet<>();
        Map<String, Integer> looseUppOverrideByMedicineId = new HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
            if (o.getGstRate() != null) {
                gstOverrideByMedicineId.put(o.getMedicineId(), o.getGstRate());
            }
            if (o.isAllowLooseSale()) {
                looseAllowedMedicineIds.add(o.getMedicineId());
            }
            if (o.getUnitsPerPack() != null) {
                looseUppOverrideByMedicineId.put(o.getMedicineId(), o.getUnitsPerPack());
            }
        }

        Instant now = Instant.now();
        // unitsPerPack: 1 for a pack line. loose: this line sells pieces, so gst/rate/
        // storedPurchaseRate are per-piece and the batch is decremented in pieces below.
        // The line's stored `mrp` is ALWAYS the printed pack MRP (a reprint of a loose
        // sale then shows the real strip MRP); the per-piece price charged is `rate`.
        // unitsPerPack is 1 for a pack line (the GST maths treats a pack line as one sellable
        // unit). effUnitsPerPack is the medicine's REAL pack multiple regardless of pack/loose
        // — needed to convert a whole-pack sale back into the base-unit (tablet / mL) count a
        // prescription line is measured in when recording what was dispensed against it.
        record ResolvedLine(Inventory batch, InvoiceItemRequest req, BigDecimal gstRate, GstCalculator.MrpGstBreakdown gst,
                            BigDecimal rate, BigDecimal storedPurchaseRate, int unitsPerPack, int effUnitsPerPack,
                            boolean loose, String location) {
            /** Base units (tablets / mL / g) this line hands over — pieces for a loose line, packs × pack size otherwise. */
            int dispensedBaseUnits() {
                return loose ? req.quantity() : req.quantity() * Math.max(1, effUnitsPerPack);
            }
        }
        List<ResolvedLine> lines = new ArrayList<>();
        List<GstCalculator.MrpLineInput> totalsInput = new ArrayList<>();

        for (InvoiceItemRequest item : req.items()) {
            Inventory batch = batchMap.get(item.inventoryId());
            // The medicine this batch's loose/GST/schedule/active-state rules actually come
            // from — see the resolution above. Falls back to the batch's own local-only
            // behaviour (effMedicineId null) exactly as before whenever there is no LINKED
            // catalogue target to defer to.
            Medicine eff = effectiveMedicineByInventoryId.get(batch.getId());
            String effMedicineId = eff != null ? eff.getId() : batch.getMedicineId();
            boolean effIsActive = eff != null ? eff.isActive() : batch.productIsActive();
            if (!effIsActive) {
                throw new UnprocessableEntityException(
                        "Medicine \"" + (batch.productName() == null ? "?" : batch.productName()) + "\" is inactive and cannot be billed");
            }
            if (batch.getStatus() != BatchStatus.ACTIVE) {
                throw new UnprocessableEntityException(
                        "Batch \"" + batch.getBatchNumber() + "\" of \"" + batch.productName() + "\" is " + batch.getStatus() + " and cannot be sold");
            }
            if (!batch.getExpiryDate().isAfter(now)) {
                throw new UnprocessableEntityException(
                        "Batch \"" + batch.getBatchNumber() + "\" of \"" + batch.productName() + "\" expired on " + batch.getExpiryDate());
            }

            // ── Loose (cut-strip) line: validate it is permitted, then price per piece ──
            boolean loose = item.isLoose();
            int unitsPerPack = 1;
            if (loose) {
                if (!looseAllowedMedicineIds.contains(effMedicineId)) {
                    throw new UnprocessableEntityException(
                            "Loose selling is not enabled for \"" + batch.productName() + "\" at this pharmacy. "
                            + "Turn it on in the medicine's POS settings, or sell it as a full pack.");
                }
                // Effective pack size: this pharmacy's override wins over the catalogue (its
                // own, or — for a batch resolved through a LINKED local medicine — the linked
                // catalogue medicine's). Null for a genuinely local/unmatched medicine — loose
                // selling isn't offered for one yet, so this throws below exactly as an
                // unclassified medicine would.
                Integer upp = looseUppOverrideByMedicineId.getOrDefault(
                        effMedicineId, eff != null ? eff.getUnitsPerPack() : batch.productUnitsPerPack());
                if (upp == null || upp <= 1) {
                    throw new UnprocessableEntityException(
                            "\"" + batch.productName() + "\" has no pack size on record, so it cannot be sold loose. "
                            + "Set how many units are in a pack in its POS settings, or sell it as a full pack.");
                }
                // Schedule X cannot be broken out of its original packaging (Drug Rules).
                String rawSchedule = eff != null ? eff.getSchedule() : batch.productSchedule();
                String schedule = rawSchedule == null ? "" : rawSchedule.trim().toUpperCase();
                if (schedule.equals("X")) {
                    throw new UnprocessableEntityException("\"" + batch.productName()
                            + "\" is a Schedule X medicine and must be sold in its original pack, not loose.");
                }
                // A whole number of packs asked for as loose would needlessly cut sealed
                // strips — but only refuse it when the pharmacist actually HAS that many
                // sealed packs to sell instead. If the open remainder covers it, or there
                // are not enough full packs on the batch, cutting is the only way to fill
                // the line and blocking it would be a dead end (the "sell it as a pack"
                // advice would then fail the pack availability check).
                int wanted = item.quantity() + item.freeQtyOrZero();
                int packsNeeded = wanted / upp;
                boolean wholeMultiple = wanted >= upp && wanted % upp == 0;
                if (wholeMultiple && !item.isForceLoose()
                        && batch.getLooseUnits() < wanted && batch.getQuantity() >= packsNeeded) {
                    throw new UnprocessableEntityException("That is " + packsNeeded + " full pack"
                            + (packsNeeded == 1 ? "" : "s") + " of \"" + batch.productName()
                            + "\" and there " + (batch.getQuantity() == 1 ? "is 1 sealed pack" : "are "
                            + batch.getQuantity() + " sealed packs") + " on this batch. "
                            + "Bill it as a pack sale so the strips stay sealed.");
                }
                // A loose price is derived from the pack MRP; without one there is nothing
                // to divide. Surface it as a clear 422 rather than letting perPieceMrp
                // throw an IllegalArgumentException that would surface as a 500.
                if (batch.getMrp() == null || batch.getMrp().signum() <= 0) {
                    throw new UnprocessableEntityException("\"" + batch.productName() + "\" (batch "
                            + batch.getBatchNumber() + ") has no MRP on record, so it cannot be priced for a "
                            + "loose sale. Set the batch MRP, or sell it as a full pack.");
                }
                unitsPerPack = upp;
            }

            BigDecimal gstRate = gstOverrideByMedicineId.getOrDefault(
                    effMedicineId, eff != null ? eff.getGstRate() : batch.productGstRate());
            // Per-piece MRP for a loose line: pack MRP / unitsPerPack at 2dp rounded DOWN —
            // the exact figure charged and printed, so the tax below reverse-calculates
            // from it and "qty x rate" reconciles with the line amount on the bill. The
            // pack MRP is used unchanged for a normal line.
            BigDecimal unitMrp = loose ? GstCalculator.perPieceMrp(batch.getMrp(), unitsPerPack) : batch.getMrp();

            // A cut strip may not cost more per tablet than its printed pro-rata MRP —
            // consumer-law / DPCO. perPieceMrp already rounds DOWN so unitMrp is at or
            // below pro-rata; this only trips on a bad discount that somehow went
            // negative, but it is cheap and worth stating.
            BigDecimal rate = GstCalculator.round2(unitMrp.multiply(
                    BigDecimal.ONE.subtract(item.discountOrZero().divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP))));
            if (loose && rate.compareTo(unitMrp) > 0) {
                throw new UnprocessableEntityException(
                        "Loose price for \"" + batch.productName() + "\" (Rs." + rate
                        + "/unit) exceeds the pro-rata MRP of Rs." + unitMrp + "/unit.");
            }

            // The bill discount is folded into the LINE, so the stored per-line tax is
            // the tax actually charged — which is what the GSTR-1 HSN summary sums.
            GstCalculator.MrpGstBreakdown gst = GstCalculator.calcGstFromMrp(unitMrp, item.quantity(),
                    item.discountOrZero(), gstRate, isInterstate, req.billDiscountPctOrZero());
            // Cost of goods must convert the same way the price does — a loose line's
            // `quantity` is pieces, so a cost per PACK stored against it would overstate COGS
            // by a factor of unitsPerPack (this was previously unconverted and wrong; see
            // packEquivalentQty in ReportsService for the read-side counterpart of the same
            // pack/piece distinction). Not GstCalculator.perPieceMrp — that throws on a zero
            // rate, and a batch with no recorded purchase rate is an existing, expected case
            // (see MarginReportResponse.DataQuality) that must stay costed at zero, not block
            // the sale outright.
            BigDecimal storedPurchaseRate = (loose && batch.getPurchaseRate() != null && batch.getPurchaseRate().signum() > 0)
                    ? batch.getPurchaseRate().divide(BigDecimal.valueOf(unitsPerPack), 10, RoundingMode.HALF_UP)
                    : batch.getPurchaseRate();
            String location = null; // shelf/rack location display is a Tier 2 inventory-list concern; not resolved here to avoid an extra join per line

            // The medicine's real pack multiple, whichever way this line sells. For a loose
            // line it is `unitsPerPack` (already validated > 1 above); for a pack line, resolve
            // the same COALESCE(override, catalogue) the loose path uses. Kept out of a ternary
            // on purpose — mixing `int unitsPerPack` with a nullable Integer there unboxes the
            // Integer branch and NPEs on an unclassified medicine.
            int effUnitsPerPack;
            if (loose) {
                effUnitsPerPack = unitsPerPack;
            } else {
                Integer effUppBox = looseUppOverrideByMedicineId.get(effMedicineId);
                if (effUppBox == null) {
                    effUppBox = eff != null ? eff.getUnitsPerPack() : batch.productUnitsPerPack();
                }
                effUnitsPerPack = effUppBox != null && effUppBox > 1 ? effUppBox : 1;
            }

            lines.add(new ResolvedLine(batch, item, gstRate, gst, rate, storedPurchaseRate, unitsPerPack,
                    effUnitsPerPack, loose, location));
            totalsInput.add(new GstCalculator.MrpLineInput(batch.getMrp(), item.quantity(), item.discountOrZero(),
                    gstRate, unitsPerPack, loose));
        }

        // The bill discount is already inside these totals — it reduced the taxable
        // value of every line — so it must NOT be subtracted again here. Deducting it
        // after the tax was the bug: GST was charged on the pre-discount value, the
        // pharmacy remitted tax on money it never took, and the invoice did not add up,
        // because taxable + GST came from before the discount and the total from after.
        GstCalculator.InvoiceTotals itemTotals =
                GstCalculator.calcInvoiceTotals(totalsInput, isInterstate, req.billDiscountPctOrZero());

        // The payable is the sum of the LINE totals the customer sees (itemTotals.totalAmount
        // is exactly that) plus bill-level charges — not (taxable + GST), which the equal
        // CGST/SGST split can leave a paisa short intra-state.
        BigDecimal preRound = itemTotals.totalAmount()
                .add(req.extraChargesOrZero()).add(req.adjustmentAmountOrZero());
        // Refuse, rather than silently clamp to zero.
        //
        // A negative subtotal is arithmetically impossible from valid input: it means
        // the discount and adjustments together exceed the goods being sold. Clamping
        // turned that nonsense into a plausible-looking zero-rupee invoice — issued,
        // numbered, and with the stock decremented off the shelf — which is the single
        // worst way to handle it, because nothing downstream ever flags it.
        //
        // Bounding billDiscountPct closed one route here; this closes the rest
        // (an outsized negative adjustmentAmount reaches the same place). Note ZERO
        // itself is still allowed: a 100%-discounted or free-of-charge bill is
        // legitimate, and only a genuinely NEGATIVE total is rejected.
        if (preRound.compareTo(BigDecimal.ZERO) < 0) {
            throw new UnprocessableEntityException(
                    "Discounts and adjustments exceed the value of this bill by Rs."
                    + preRound.negate().setScale(2, RoundingMode.HALF_UP)
                    + ". Check the bill discount, extra charges and adjustment amount.");
        }
        // Indian retail convention: round the final payable amount to the nearest rupee.
        BigDecimal finalTotal = preRound.setScale(0, RoundingMode.HALF_UP);
        // Signed, and STORED rather than left to be re-derived. With this the invoice
        // satisfies, from its own columns:
        //   taxableAmount + totalGst + extraCharges + adjustmentAmount + roundOff
        //     == totalAmount
        // It now carries two things: the rupee rounding, AND the sub-paisa the equal
        // CGST/SGST split cannot represent (which used to surface as a line total a paisa
        // off the MRP). Derived from the stored TAX columns, not `preRound`, so the identity
        // above holds against exactly the values written to the row.
        BigDecimal taxColumnsTotal = itemTotals.taxableAmount().add(itemTotals.totalGst())
                .add(req.extraChargesOrZero()).add(req.adjustmentAmountOrZero());
        BigDecimal roundOff = GstCalculator.round2(finalTotal.subtract(taxColumnsTotal));
        // Already covers line AND bill discounts — see calcInvoiceTotals.
        BigDecimal discountAmount = GstCalculator.round2(itemTotals.discountAmount());

        boolean isCreditSale = onCredit && finalTotal.compareTo(BigDecimal.ZERO) > 0;

        // A debt has to be owed by somebody.
        //
        // The guard used to be folded into isCreditSale as `customer != null`, so an
        // unpaid credit bill with no customer skipped every check below — no credit
        // type, no limit, no creditUsed — and was issued anyway. The stock left the
        // shelf and the money was owed by nobody: the receivables report is built from
        // customer.creditUsed, so the amount was invisible there, and there was no one
        // to chase for it.
        if (isCreditSale && customer == null) {
            throw new UnprocessableEntityException(
                    "A credit sale needs a customer to bill. Select or add the customer, "
                    + "or mark this bill as paid.");
        }
        if (isCreditSale) {
            if (customer.getCustomerType() != CustomerType.CREDIT) {
                throw new UnprocessableEntityException(
                        customer.getName() + " is not set up for credit. Change their customer type to \"Credit\" "
                        + "(and set a credit limit) to sell on credit.");
            }
            BigDecimal limit = customer.getCreditLimit();
            BigDecimal projected = customer.getCreditUsed().add(finalTotal);

            // A zero (or negative) limit means no credit has been authorised for this
            // customer — NOT unlimited credit.
            //
            // The previous check read `limit > 0 && projected > limit`, which skipped
            // enforcement entirely whenever the limit was unset. That made the default,
            // never-configured state the single most permissive setting available, on
            // the one control whose whole purpose is to cap exposure. Customers created
            // as CREDIT without anyone filling in a limit could be sold to without
            // bound, indefinitely.
            if (limit.compareTo(BigDecimal.ZERO) <= 0) {
                throw new UnprocessableEntityException(
                        "No credit limit is set for " + customer.getName()
                        + ". Set a credit limit on their customer record to sell on credit.");
            }
            if (projected.compareTo(limit.add(new BigDecimal("0.01"))) > 0) {
                // Clamped: a customer already over their limit would otherwise be
                // reported as having negative credit available, which reads as a bug.
                BigDecimal available = limit.subtract(customer.getCreditUsed()).max(BigDecimal.ZERO);
                throw new UnprocessableEntityException(
                        "Credit limit exceeded for " + customer.getName() + ". Available: Rs." + available
                        + ", required: Rs." + finalTotal);
            }
            customer.adjustCreditUsed(finalTotal);
        }

        // Number format comes from the pharmacy's saved invoice settings so the
        // preview on the settings screen matches the bill that gets issued. The
        // sequence itself is unchanged, so numbers stay unique and monotonic even if
        // the format is edited mid-year. Falls back to the built-in format when
        // nothing is configured — see PharmacyInvoiceSettings.
        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.INVOICE);
        String invoiceNumber = PharmacyInvoiceSettings
                .parse(pharmacy.getInvoiceSettings(), objectMapper)
                .formatInvoiceNumber(seq);

        String combinedNotes = (req.notes() == null ? "" : req.notes())
                + (req.deliveryNotes() != null && !req.deliveryNotes().isBlank() ? "\n[Delivery] " + req.deliveryNotes() : "");

        Invoice invoice = Invoice.create(pharmacyId, invoiceNumber, userId,
                customer == null ? null : customer.getId(), customer == null ? req.customerName() : customer.getName(),
                customer == null ? req.customerPhone() : customer.getPhone(), doctor == null ? null : doctor.getId(),
                doctor == null ? req.doctorName() : doctor.getName(), doctor == null ? null : doctor.getRegistrationNo(),
                prescription == null ? null : prescription.getId(), paymentMode, paymentStatus, isInterstate,
                combinedNotes.isBlank() ? null : combinedNotes, req.idempotencyKey(), itemTotals.subtotal(),
                discountAmount, itemTotals.taxableAmount(), itemTotals.cgst(), itemTotals.sgst(), itemTotals.igst(),
                itemTotals.totalGst(), finalTotal,
                req.extraChargesOrZero(), req.adjustmentAmountOrZero(), roundOff);
        // Snapshot the batch-selection strategy in force right now. A later change to
        // the pharmacy setting must never rewrite what this sale actually did — see
        // DispensingService. `pharmacy` was already loaded above, so this costs nothing.
        invoice.setDispensingStrategy(pharmacy.getDispensingStrategy());
        invoiceRepository.save(invoice);

        List<InvoiceItem> savedItems = new ArrayList<>();
        for (ResolvedLine line : lines) {
            Inventory batch = line.batch();
            int quantity = line.req().quantity();
            int freeQty = line.req().freeQtyOrZero();
            // Scheme goods are not charged but they DO leave the shelf, so both the
            // availability check and the decrement work on the total. Checking only
            // the paid quantity would let a 100+10 sale drive a 105-unit batch to -5.
            int dispensed = quantity + freeQty;
            // Only LIVE stock held by OTHER sessions reduces what this sale may take.
            // Our own hold is released a few lines below as part of this same
            // transaction, so counting it here would mean a till competing with itself.
            int reservedByOthers = liveOtherReserved.getOrDefault(batch.getId(), 0);

            // ledgerBefore/After are what the movement records: pack counts for a pack
            // line (unchanged), individual pieces for a loose line so the ledger still
            // reconciles against a physical count of (packs * unitsPerPack + loose).
            long ledgerBefore;
            long ledgerAfter;
            if (line.loose()) {
                int upp = line.unitsPerPack();
                // A hold by another till is a reservation row counted in PACKS; each such
                // pack is unavailable to this loose sale in full.
                long availablePieces = batch.availablePieces(upp) - (long) reservedByOthers * upp;
                if (dispensed > availablePieces) {
                    String reservedNote = reservedByOthers > 0
                            ? " (" + reservedByOthers + " pack(s) reserved by another open billing session)" : "";
                    String freeNote = freeQty > 0 ? " (" + quantity + " + " + freeQty + " free)" : "";
                    throw new ConflictException("Insufficient stock for \"" + batch.productName() + "\": "
                            + Math.max(0, availablePieces) + " piece(s) available" + reservedNote + ", " + dispensed + " requested" + freeNote);
                }
                ledgerBefore = batch.availablePieces(upp);
                batch.dispenseLoose(dispensed, upp);
                ledgerAfter = batch.availablePieces(upp);
            } else {
                int quantityBefore = batch.getQuantity();
                int available = quantityBefore - reservedByOthers;
                if (dispensed > available) {
                    // "open" is load-bearing: expired holds are excluded above, so if this
                    // number is non-zero another till really is holding the stock right now
                    // and waiting will clear it.
                    String reservedNote = reservedByOthers > 0
                            ? " (" + reservedByOthers + " reserved by another open billing session)" : "";
                    String freeNote = freeQty > 0 ? " (" + quantity + " + " + freeQty + " free)" : "";
                    throw new ConflictException("Insufficient stock for \"" + batch.productName() + "\": "
                            + Math.max(0, available) + " available" + reservedNote + ", " + dispensed + " requested" + freeNote);
                }
                batch.setQuantity(quantityBefore - dispensed);
                ledgerBefore = quantityBefore;
                ledgerAfter = quantityBefore - dispensed;
            }

            // Same effective medicine as the resolution loop above — a batch resolved through a
            // LINKED local medicine snapshots the CATALOGUE HSN/base-unit onto the invoice line,
            // not the pre-link local placeholder, matching the gstRate already resolved into
            // `line`.
            Medicine effForItem = effectiveMedicineByInventoryId.get(batch.getId());
            String hsnCode = effForItem != null ? effForItem.getHsnCode() : batch.productHsnCode();
            InvoiceItem item = InvoiceItem.create(pharmacyId, invoice.getId(), batch.getId(), batch.productName(),
                    hsnCode, batch.getBatchNumber(), batch.getExpiryDate(), quantity, freeQty,
                    batch.getMrp(),
                    line.rate(), line.storedPurchaseRate(), line.req().discountOrZero(), line.gstRate(), line.gst().cgst(),
                    line.gst().sgst(), line.gst().igst(), line.gst().taxableAmount(), line.gst().amount(), line.location())
                    .withBatchAutoSelected(line.req().batchAutoSelectedOrDefault());
            String looseBaseUnit = line.loose()
                    ? com.checkup.pharmacy.common.util.BaseUnits.resolve(
                            effForItem != null ? effForItem.getBaseUnit() : batch.productBaseUnit(),
                            effForItem != null ? effForItem.getForm() : batch.productForm())
                    : null;
            if (line.loose()) {
                item.asLooseSale(looseBaseUnit);
            }
            invoiceItemRepository.save(item);
            savedItems.add(item);

            // Records the DISPENSED total, not the charged quantity — the ledger has to
            // reconcile against the batch decrement above, and a physical stock count
            // reflects goods handed over regardless of what was billed for them.
            // A loose row's quantities are in pieces (see ledgerBefore/After); inBaseUnit
            // tags it so the ledger reads "8 tab", not a bare "8".
            String moveNote = line.loose()
                    ? (freeQty > 0 ? quantity + " sold + " + freeQty + " free, loose" : dispensed + " loose (cut strip)")
                    : (freeQty > 0 ? quantity + " sold + " + freeQty + " free" : null);
            movementRepository.save(InventoryMovement.record(pharmacyId, batch.getId(), userId, MovementType.SALE,
                    MovementDirection.OUT, dispensed, (int) ledgerBefore, (int) ledgerAfter, "INVOICE", invoice.getId(),
                    moveNote).inBaseUnit(looseBaseUnit));
        }

        // The sale is the end of this billing session, so its hold on the shelf goes
        // with it — including on batches that were reserved and later taken out of the
        // cart. Left behind, these rows kept stock flagged reserved against every other
        // till until the 15-minute TTL swept them, on every completed sale.
        //
        // Safe to mutate here: every one of these batches is in the lock set taken
        // above, so no concurrent sale or reservation can be reading the count.
        releaseOwnReservations(ownReservations, ownReservedByInventoryId, batchMap);

        if (prescription != null) {
            // Two ways a sold line reaches a prescribed line, in priority order.
            //
            // An EXPLICIT link, where the cashier said which prescribed line they were
            // filling. That is the only thing that can express a substitution: the sold
            // medicine differs from the prescribed one, so no amount of matching would ever
            // connect them.
            //
            // Otherwise by medicine, which is the granularity a prescription is written at.
            // Two batches of the same medicine on one bill are one dispensing event as far
            // as the prescription is concerned.
            // A prescribed line's quantity is a BASE-UNIT count (12 tablets, 200 ml) — never a
            // pack count. A whole-pack sale therefore has to be converted back to pieces before
            // it is recorded against the line, or a 12-tablet course filled by one strip of 15
            // records "1", never reaches isFullyDispensed(), and the prescription is stuck
            // PARTIAL forever (and the EMR callback never flips to DISPENSED). A loose line is
            // already in pieces. See ResolvedLine.dispensedBaseUnits().
            Map<String, Integer> dispensedByMedicineId = new HashMap<>();
            Map<String, Attribution> attributedByItemId = new HashMap<>();
            // Sealed packs, kept in parallel with the base-unit totals above. See Attribution:
            // this is what the pack-size feedback loop compares against the engine's own count,
            // and it must not be recovered by dividing by the pack size under suspicion.
            Map<String, Integer> packsByMedicineId = new HashMap<>();
            for (ResolvedLine line : lines) {
                String linkedItemId = line.req().prescriptionItemId();
                int dispensedBaseUnits = line.dispensedBaseUnits();
                int dispensedPacks = line.loose() ? 0 : line.req().quantity();
                if (linkedItemId != null && !linkedItemId.isBlank()) {
                    attributedByItemId.merge(linkedItemId,
                            new Attribution(dispensedBaseUnits, dispensedPacks, line.batch().getMedicineId(),
                                    line.batch().productName()),
                            Attribution::plus);
                } else {
                    dispensedByMedicineId.merge(line.batch().getMedicineId(), dispensedBaseUnits, Integer::sum);
                    packsByMedicineId.merge(line.batch().getMedicineId(), dispensedPacks, Integer::sum);
                }
            }
            List<PrescriptionItem> settled = recordDispensing(
                    prescription, dispensedByMedicineId, attributedByItemId, packsByMedicineId, invoice.getId());

            // Only a prescription that came from a clinic has anywhere to report back to.
            // Published rather than delivered: the listener runs AFTER_COMMIT on its own pool,
            // so a slow or unreachable EMR can never delay this sale or fail it.
            if (prescription.isFromEmr()) {
                prescription.markDispenseNotifyPending();
                eventPublisher.publishEvent(dispensedEvent(prescription, invoice, settled));
            }
        }

        return toResponse(invoice, customer, doctor, userRepository.findById(userId).orElse(null), savedItems, List.of(), List.of());
    }

    /**
     * Drops this billing session's stock reservations once its sale has committed.
     *
     * <p>Mirrors {@code InventoryService.release} but operates on batches this
     * transaction already holds write locks on, rather than re-reading them unlocked —
     * decrementing {@code reservedQuantity} is a read-modify-write like any other.
     *
     * <p>A reservation whose batch has since been deleted still has its row removed:
     * there is no count left to correct, and leaving it would keep the sweeper busy
     * with a row that can never be applied.
     */
    private void releaseOwnReservations(List<StockReservation> reservations,
                                        Map<String, Integer> reservedByInventoryId,
                                        Map<String, Inventory> lockedBatches) {
        if (reservations.isEmpty()) {
            return;
        }
        for (Map.Entry<String, Integer> e : reservedByInventoryId.entrySet()) {
            Inventory batch = lockedBatches.get(e.getKey());
            if (batch != null) {
                batch.reserve(-e.getValue());
            }
        }
        reservationRepository.deleteAll(reservations);
    }

    // ── Get / List ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public InvoiceResponse getInvoice(String id) {
        return toResponse(loadInvoice(id));
    }

    /** "Repeat last bill" — see {@link com.checkup.pharmacy.modules.billing.dto.RepeatCartResponse}'s javadoc. */
    @Transactional(readOnly = true)
    public RepeatCartResponse getRepeatCart(String customerId) {
        String pharmacyId = TenantContext.pharmacyId();
        List<Invoice> recent = invoiceRepository.findRecentByCustomer(pharmacyId, customerId, PageRequest.of(0, 1));
        if (recent.isEmpty()) {
            throw new NotFoundException("No previous bill found for this customer");
        }
        Invoice invoice = recent.get(0);
        List<InvoiceItem> originalItems = invoiceItemRepository.findByInvoiceId(invoice.getId());

        List<RepeatCartResponse.Item> items = new ArrayList<>();
        List<RepeatCartResponse.Unavailable> unavailable = new ArrayList<>();
        Instant now = Instant.now();

        // Two batched lookups instead of two per line. This loop used to run a findById
        // and a FEFO query for EVERY item on the previous bill — a 15-line repeat cost
        // 30 round trips before the cart appeared. Also closes a tenancy gap: the old
        // findById carried no pharmacyId predicate.
        Map<String, String> medicineIdByBatchId = new HashMap<>();
        for (Inventory inv : inventoryRepository.findByIdInAndPharmacyId(
                originalItems.stream().map(InvoiceItem::getInventoryId).distinct().toList(), pharmacyId)) {
            medicineIdByBatchId.put(inv.getId(), inv.getMedicineId());
        }

        // Which batch to repeat each line from is the dispensing engine's call — it
        // orders the candidates by the pharmacy's configured strategy (LILA/FEFO or
        // LIFA), so a repeat and a fresh manual sale of the same medicine agree.
        Map<String, Inventory> fefoByMedicineId = medicineIdByBatchId.isEmpty()
                ? new HashMap<>()
                : new HashMap<>(dispensingService.topBatchPerMedicine(
                        inventoryRepository.findSellableBatchesForMedicines(
                                pharmacyId, new HashSet<>(medicineIdByBatchId.values()), now)));
        // This pharmacy's loose opt-in / pack-size override, so a regular loose order
        // repeats as loose only while the pharmacy still sells that medicine that way.
        Map<String, PharmacyMedicineOverride> repeatOverrides = new HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(
                pharmacyId, new HashSet<>(medicineIdByBatchId.values()))) {
            repeatOverrides.put(o.getMedicineId(), o);
        }

        for (InvoiceItem original : originalItems) {
            String medicineId = medicineIdByBatchId.get(original.getInventoryId());
            if (medicineId == null) {
                unavailable.add(new RepeatCartResponse.Unavailable(original.getMedicineName(), "Medicine no longer in catalog"));
                continue;
            }
            Inventory batch = fefoByMedicineId.get(medicineId);
            if (batch == null) {
                unavailable.add(new RepeatCartResponse.Unavailable(original.getMedicineName(), "Out of stock"));
                continue;
            }
            var medicine = batch.getMedicine();

            if (original.isLooseSale()) {
                PharmacyMedicineOverride ov = repeatOverrides.get(medicineId);
                Integer effUpp = PharmacyMedicineOverride.effectiveUnitsPerPack(ov, medicine);
                boolean stillLoose = ov != null && ov.isAllowLooseSale() && effUpp != null && effUpp > 1;
                if (!stillLoose) {
                    unavailable.add(new RepeatCartResponse.Unavailable(original.getMedicineName(),
                            "Loose selling is off for this now — add it as a strip if needed"));
                    continue;
                }
                long availPieces = batch.availablePieces(effUpp) - (long) batch.getReservedQuantity() * effUpp;
                int requestedPieces = original.getQuantity();
                int qtyPieces = (int) Math.min(Math.max(0, availPieces), requestedPieces);
                if (qtyPieces <= 0) {
                    unavailable.add(new RepeatCartResponse.Unavailable(original.getMedicineName(), "Out of stock"));
                    continue;
                }
                // availableStock is the unreserved SEALED pack count (as for a pack line);
                // the client rebuilds the piece ceiling as packs*upp + looseUnits.
                int unreservedPacks = Math.max(0, batch.getQuantity() - batch.getReservedQuantity());
                items.add(new RepeatCartResponse.Item(batch.getId(), medicine.getName(), medicine.getHsnCode(),
                        medicine.getSchedule(), medicine.getPackSize(), batch.getLocation(), batch.getBatchNumber(),
                        batch.getExpiryDate(), batch.getMrp(), medicine.getGstRate(), original.getDiscount(),
                        qtyPieces, unreservedPacks, requestedPieces, qtyPieces < requestedPieces,
                        "LOOSE", effUpp,
                        com.checkup.pharmacy.common.util.BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm()),
                        true, batch.getLooseUnits()));
                continue;
            }

            int available = batch.getQuantity() - batch.getReservedQuantity();
            int requested = original.getQuantity();
            int quantity = Math.min(available, requested);
            // A PACK repeat line still offers the Strip / piece toggle if this pharmacy
            // sells the medicine loose — so a customer who wants a few loose this time is
            // one click away, not a remove-and-re-add.
            PharmacyMedicineOverride packOv = repeatOverrides.get(medicineId);
            Integer packEffUpp = PharmacyMedicineOverride.effectiveUnitsPerPack(packOv, medicine);
            boolean packAllowsLoose = packOv != null && packOv.isAllowLooseSale()
                    && packEffUpp != null && packEffUpp > 1
                    && !"X".equalsIgnoreCase(medicine.getSchedule() == null ? "" : medicine.getSchedule().trim());
            items.add(new RepeatCartResponse.Item(batch.getId(), medicine.getName(), medicine.getHsnCode(),
                    medicine.getSchedule(), medicine.getPackSize(), batch.getLocation(), batch.getBatchNumber(),
                    batch.getExpiryDate(), batch.getMrp(), medicine.getGstRate(), original.getDiscount(),
                    quantity, available, requested, available < requested,
                    "PACK", packAllowsLoose ? packEffUpp : null,
                    packAllowsLoose ? com.checkup.pharmacy.common.util.BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm()) : null,
                    packAllowsLoose, batch.getLooseUnits()));
        }

        return new RepeatCartResponse(invoice.getInvoiceNumber(), invoice.getCreatedAt(), items, unavailable);
    }

    @Transactional(readOnly = true)
    public InvoicePageResponse listInvoices(String search, Instant from, Instant to, String status,
                                            boolean includeCancelled, String paymentMode, String paymentStatus,
                                            String userId, String customerId, BigDecimal minAmount, BigDecimal maxAmount,
                                            int page, int limit) {
        validateDateRange(from, to);
        validateAmountRange(minAmount, maxAmount);
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT);
        boolean hasStatusFilter = status != null && !status.isBlank();
        Page<Invoice> result = invoiceRepository.search(TenantContext.pharmacyId(), hasStatusFilter, blankToNull(status),
                includeCancelled, DateRange.from(from), DateRange.to(to), blankToNull(paymentMode), blankToNull(paymentStatus),
                blankToNull(userId), blankToNull(customerId), minAmount, maxAmount, blankToNull(search),
                PageRequest.of(safePage - 1, safeLimit));

        List<String> invoiceIds = result.getContent().stream().map(Invoice::getId).toList();
        Map<String, String> userNames = new HashMap<>();
        for (User u : userRepository.findAllById(result.getContent().stream().map(Invoice::getUserId).distinct().toList())) {
            userNames.put(u.getId(), u.getName());
        }
        Map<String, Long> itemCounts = new HashMap<>();
        if (!invoiceIds.isEmpty()) {
            for (InvoiceItemRepository.InvoiceCountRow row : invoiceItemRepository.countByInvoiceIdIn(invoiceIds)) {
                itemCounts.put(row.getInvoiceId(), row.getCnt());
            }
        }

        List<InvoicePageResponse.Summary> items = result.getContent().stream().map(inv -> {
            // Null only for a bill with no customer identity at all — the frontend renders its
            // "—"/"Walk-in" fallback for that case, so don't fabricate an empty object here.
            boolean hasCustomer = inv.getCustomerName() != null || inv.getCustomerPhone() != null
                    || inv.getCustomerId() != null;
            InvoicePageResponse.CustomerRef customer = hasCustomer
                    ? new InvoicePageResponse.CustomerRef(inv.getCustomerName(), inv.getCustomerPhone())
                    : null;
            // The frontend reads inv.user.name unguarded; a hard-deleted staff row would otherwise
            // send null here and crash the row rather than just showing an unknown entry-by.
            String userName = userNames.get(inv.getUserId());
            InvoicePageResponse.UserRef user =
                    new InvoicePageResponse.UserRef(userName != null ? userName : "Unknown");
            return new InvoicePageResponse.Summary(inv.getId(), inv.getInvoiceNumber(), customer, user,
                    inv.getDoctorName(), inv.getPaymentMode().name(), inv.getPaymentStatus().name(),
                    inv.getStatus().name(), inv.getTotalAmount(), inv.isCancelled(),
                    new InvoicePageResponse.CountRef(itemCounts.getOrDefault(inv.getId(), 0L).intValue()),
                    inv.getCreatedAt());
        }).toList();

        return new InvoicePageResponse(items, result.getTotalElements(), safePage, safeLimit, result.getTotalPages());
    }

    // ── Cancel Invoice ────────────────────────────────────────────────────────

    // Kept at SERIALIZABLE: unlike createInvoice this is low-frequency and restores
    // stock across a whole invoice, so the broader guarantee is worth its cost.
    // RetryOnConflict turns the resulting serialization failures into replays
    // instead of a 409 — the storm was never the isolation level alone, it was the
    // isolation level with no retry behind it.
    @RetryOnConflict
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public InvoiceResponse cancelInvoice(String id, String reason) {
        try {
            return doCancelInvoice(id, reason);
        } catch (ConcurrencyFailureException e) {
            throw new ConflictException("Another request modified this invoice simultaneously — please try again");
        }
    }

    private InvoiceResponse doCancelInvoice(String id, String reason) {
        String pharmacyId = TenantContext.pharmacyId();
        String userId = TenantContext.userId();
        Invoice invoice = loadInvoice(id);
        List<InvoiceItem> items = invoiceItemRepository.findByInvoiceId(id);
        List<InvoicePayment> payments = invoicePaymentRepository.findByInvoiceIdOrderByPaidAtAsc(id);

        if (invoice.isCancelled() || invoice.getStatus() == InvoiceStatus.CANCELLED) {
            throw new ConflictException("Invoice is already cancelled");
        }
        if (invoice.getStatus() == InvoiceStatus.RETURNED || invoice.getStatus() == InvoiceStatus.PARTIALLY_RETURNED) {
            throw new ConflictException("Cannot cancel a returned invoice — raise a sales return instead");
        }
        BigDecimal totalPaid = payments.stream().map(InvoicePayment::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (totalPaid.compareTo(new BigDecimal("0.01")) > 0) {
            throw new ConflictException("Cannot cancel an invoice with Rs." + totalPaid
                    + " collected. Raise a sales return to reverse the payment first.");
        }

        invoice.cancel(reason);

        Map<String, Inventory> batchMap = new HashMap<>();
        // Tenant-scoped AND locked: this loop WRITES (restores sold quantity).
        //
        // Serializable isolation already makes a lost update here impossible — Postgres
        // refuses to let this transaction overwrite a row a concurrent transaction
        // changed after our snapshot, and RetryOnConflict replays it. But that safety
        // is a property of the isolation level, invisible at the call site, and it does
        // not survive someone lowering the isolation for performance the way
        // createInvoice's was. Taking the lock makes the guarantee local to the code
        // that depends on it, and matches every other quantity write in the system.
        for (Inventory inv : inventoryRepository.lockAllByIdInAndPharmacyId(
                items.stream().map(InvoiceItem::getInventoryId).distinct().toList(), pharmacyId)) {
            batchMap.put(inv.getId(), inv);
        }
        // Effective pack size per medicine (this pharmacy's override, else the
        // catalogue's) — the SAME resolution the sale used, so a loose line's
        // reversing movement records the same total-piece before/after the sale did
        // and the ledger still reconciles. Only loaded when a loose line is present.
        Map<String, Integer> cancelLooseUpp = new HashMap<>();
        if (items.stream().anyMatch(InvoiceItem::isLooseSale)) {
            List<String> medIds = batchMap.values().stream().map(Inventory::getMedicineId)
                    .filter(java.util.Objects::nonNull).distinct().toList();
            if (!medIds.isEmpty()) {
                for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medIds)) {
                    if (o.getUnitsPerPack() != null) {
                        cancelLooseUpp.put(o.getMedicineId(), o.getUnitsPerPack());
                    }
                }
            }
        }
        for (InvoiceItem item : items) {
            Inventory inv = batchMap.get(item.getInventoryId());
            if (inv == null) {
                continue; // batch was hard-deleted since the sale — nothing to restore
            }
            // Put back everything that left the shelf, scheme goods included.
            //
            // The sale decrements quantity + freeQty; restoring only the charged
            // quantity meant every cancelled 10+2 destroyed 2 units of real stock, with
            // a movement row that recorded the wrong figure — so the ledger reconciled
            // against itself and quietly stopped matching the shelf.
            int restored = item.getQuantity() + item.getFreeQty();
            String note = item.getFreeQty() > 0
                    ? "Cancellation: " + reason + " (" + item.getQuantity() + " sold + " + item.getFreeQty() + " free)"
                    : "Cancellation: " + reason;
            if (item.isLooseSale()) {
                // A loose line's quantity is pieces, and the strip it came from is
                // already cut — the pieces return LOOSE, not as a sealed pack. Adding
                // them to `quantity` (packs) would inflate the shelf by unitsPerPack
                // times over. The movement is recorded in pieces so the ledger still
                // reconciles against a physical count.
                Integer catUpp = inv.getMedicine() != null ? inv.getMedicine().getUnitsPerPack() : null;
                Integer upp = cancelLooseUpp.getOrDefault(inv.getMedicineId(), catUpp);
                int piecesUpp = upp != null && upp > 1 ? upp : Math.max(2, restored);
                long piecesBefore = inv.availablePieces(piecesUpp);
                inv.restockLoose(restored);
                // Prefer the unit snapshotted on the line at sale time; fall back to the medicine's.
                String looseBaseUnit = item.getBaseUnit() != null ? item.getBaseUnit()
                        : com.checkup.pharmacy.common.util.BaseUnits.resolve(
                                inv.getMedicine() != null ? inv.getMedicine().getBaseUnit() : null,
                                inv.getMedicine() != null ? inv.getMedicine().getForm() : null);
                movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), userId, MovementType.ADJUSTMENT,
                        MovementDirection.IN, restored, (int) piecesBefore, (int) (piecesBefore + restored),
                        "INVOICE_CANCEL", invoice.getId(), note + " [loose]").inBaseUnit(looseBaseUnit));
            } else {
                int before = inv.getQuantity();
                inv.setQuantity(before + restored);
                movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), userId, MovementType.ADJUSTMENT,
                        MovementDirection.IN, restored, before, before + restored, "INVOICE_CANCEL", invoice.getId(), note));
            }
        }

        boolean wasCreditSale = invoice.getCustomerId() != null && invoice.getPaymentMode() == PaymentMode.CREDIT
                && invoice.getPaymentStatus() != PaymentStatus.PAID && invoice.getTotalAmount().compareTo(BigDecimal.ZERO) > 0;
        if (wasCreditSale) {
            customerRepository.lockByIdAndPharmacyId(invoice.getCustomerId(), pharmacyId)
                    .filter(c -> c.getCustomerType() == CustomerType.CREDIT)
                    .ifPresent(c -> c.adjustCreditUsed(invoice.getTotalAmount().negate()));
        }

        return toResponse(invoice);
    }

    // ── Create Sales Return ─────────────────────────────────────────────────

    @RetryOnConflict
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public SalesReturnResponse createReturn(String invoiceId, CreateReturnRequest req) {
        try {
            return doCreateReturn(invoiceId, req);
        } catch (ConcurrencyFailureException e) {
            throw new ConflictException("Return was modified concurrently — please try again");
        }
    }

    private SalesReturnResponse doCreateReturn(String invoiceId, CreateReturnRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        String userId = TenantContext.userId();

        if (req.idempotencyKey() != null && !req.idempotencyKey().isBlank()) {
            var existing = salesReturnRepository.findByPharmacyIdAndIdempotencyKey(pharmacyId, req.idempotencyKey());
            if (existing.isPresent()) {
                return toResponse(existing.get(), salesReturnItemRepository.findByReturnId(existing.get().getId()));
            }
        }

        Invoice invoice = loadInvoice(invoiceId);
        if (invoice.getStatus() == InvoiceStatus.CANCELLED) throw new ConflictException("Cannot return a cancelled invoice");
        if (invoice.getStatus() == InvoiceStatus.RETURNED) throw new ConflictException("Invoice is already fully returned");

        // Window length comes from the pharmacy's saved settings, not a fixed 30 days.
        // A pharmacy that configured 15 (or switched the limit off with 0) was
        // previously still held to 30 — the setting saved and did nothing.
        PharmacyInvoiceSettings settings = PharmacyInvoiceSettings.parse(
                pharmacyRepository.findById(pharmacyId).map(Pharmacy::getInvoiceSettings).orElse(null),
                objectMapper);
        long ageDays = ChronoUnit.DAYS.between(invoice.getCreatedAt(), Instant.now());
        if (!settings.isReturnWindowUnlimited() && ageDays > settings.returnWindowDaysOrDefault()) {
            throw new UnprocessableEntityException("Return window expired. Invoice " + invoice.getInvoiceNumber() + " is "
                    + ageDays + " day(s) old; returns are only accepted within "
                    + settings.returnWindowDaysOrDefault() + " day(s) of purchase.");
        }

        List<InvoiceItem> invoiceItems = invoiceItemRepository.findByInvoiceId(invoiceId);
        Map<String, InvoiceItem> invoiceItemById = new HashMap<>();
        for (InvoiceItem item : invoiceItems) {
            invoiceItemById.put(item.getId(), item);
        }

        Map<String, Integer> alreadyReturnedQty = new HashMap<>();
        Map<String, BigDecimal> alreadyReturnedAmt = new HashMap<>();
        for (SalesReturnItem sri : salesReturnItemRepository.findByInvoiceId(invoiceId)) {
            if (sri.getInvoiceItemId() != null) {
                alreadyReturnedQty.merge(sri.getInvoiceItemId(), sri.getQuantity(), Integer::sum);
                alreadyReturnedAmt.merge(sri.getInvoiceItemId(), sri.getAmount(), BigDecimal::add);
            }
        }

        record ResolvedReturnLine(InvoiceItem original, int quantity, BigDecimal amount, BigDecimal cgst, BigDecimal sgst,
                                  BigDecimal igst, BigDecimal taxableAmount, ReturnDisposition disposition) {
        }
        List<ResolvedReturnLine> lines = new ArrayList<>();

        for (ReturnItemRequest ri : req.items()) {
            InvoiceItem original = invoiceItemById.get(ri.invoiceItemId());
            if (original == null) {
                throw new BadRequestException("Item " + ri.invoiceItemId() + " does not belong to invoice " + invoice.getInvoiceNumber());
            }
            int already = alreadyReturnedQty.getOrDefault(ri.invoiceItemId(), 0);
            int maxReturnable = original.getQuantity() - already;
            if (ri.quantity() > maxReturnable) {
                throw new UnprocessableEntityException("Cannot return " + ri.quantity() + " of \"" + original.getMedicineName()
                        + "\": only " + maxReturnable + " returnable (" + already + " already returned)");
            }

            BigDecimal alreadyAmt = alreadyReturnedAmt.getOrDefault(ri.invoiceItemId(), BigDecimal.ZERO);
            BigDecimal ratio = BigDecimal.valueOf(ri.quantity()).divide(BigDecimal.valueOf(original.getQuantity()), 10, RoundingMode.HALF_UP);
            boolean isLastBatch = (already + ri.quantity()) == original.getQuantity();
            BigDecimal amount = isLastBatch
                    ? GstCalculator.round2(original.getAmount().subtract(alreadyAmt))
                    : GstCalculator.round2(original.getAmount().multiply(ratio));
            BigDecimal cgst = GstCalculator.round2(original.getCgst().multiply(ratio));
            BigDecimal sgst = GstCalculator.round2(original.getSgst().multiply(ratio));
            BigDecimal igst = GstCalculator.round2(original.getIgst().multiply(ratio));
            BigDecimal taxableAmount = GstCalculator.round2(original.getTaxableAmount().multiply(ratio));
            // A loose (cut-strip) line is ALWAYS a write-off — the tablets were
            // separated from their foil and cannot be dispensed to anyone else. The
            // money and tax are still reversed here (the customer gets their refund);
            // only the stock is not put back. The caller's disposition is ignored.
            ReturnDisposition disposition = original.isLooseSale()
                    ? ReturnDisposition.WRITEOFF
                    : parseDisposition(ri.dispositionOrDefault());

            lines.add(new ResolvedReturnLine(original, ri.quantity(), amount, cgst, sgst, igst, taxableAmount, disposition));
        }

        Map<String, Inventory> batchMap = new HashMap<>();
        // Tenant-scoped and locked, for the same reason as the cancellation path above:
        // the loop below WRITES restocked quantity back onto these batches.
        for (Inventory inv : inventoryRepository.lockAllByIdInAndPharmacyId(
                lines.stream().map(l -> l.original().getInventoryId()).distinct().toList(), pharmacyId)) {
            batchMap.put(inv.getId(), inv);
        }
        for (ResolvedReturnLine line : lines) {
            if (line.disposition() == ReturnDisposition.WRITEOFF) continue;
            Inventory inv = batchMap.get(line.original().getInventoryId());
            if (inv == null) continue;
            int before = inv.getQuantity();
            inv.setQuantity(before + line.quantity());
        }

        BigDecimal totalAmount = GstCalculator.round2(lines.stream().map(ResolvedReturnLine::amount).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalCgst = GstCalculator.round2(lines.stream().map(ResolvedReturnLine::cgst).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalSgst = GstCalculator.round2(lines.stream().map(ResolvedReturnLine::sgst).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalIgst = GstCalculator.round2(lines.stream().map(ResolvedReturnLine::igst).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalTaxable = GstCalculator.round2(lines.stream().map(ResolvedReturnLine::taxableAmount).reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal subtotal = GstCalculator.round2(lines.stream()
                .map(l -> l.original().getMrp().multiply(BigDecimal.valueOf(l.quantity())))
                .reduce(BigDecimal.ZERO, BigDecimal::add));
        BigDecimal totalGst = totalCgst.add(totalSgst).add(totalIgst);

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.SALES_RETURN);
        String returnNumber = DocumentNumberFormat.salesReturn(seq);

        SalesReturn salesReturn = SalesReturn.create(pharmacyId, invoiceId, returnNumber, req.reason(), userId,
                invoice.getCustomerId(), req.idempotencyKey(), subtotal, totalTaxable, totalCgst, totalSgst, totalIgst,
                totalGst, totalAmount);
        salesReturnRepository.save(salesReturn);

        List<SalesReturnItem> savedItems = new ArrayList<>();
        for (ResolvedReturnLine line : lines) {
            InvoiceItem original = line.original();
            SalesReturnItem item = SalesReturnItem.create(pharmacyId, salesReturn.getId(), original.getId(),
                    original.getInventoryId(), original.getMedicineName(), original.getHsnCode(), original.getBatchNumber(),
                    original.getExpiryDate(), line.quantity(), original.getMrp(), original.getRate(), original.getDiscount(),
                    original.getGstRate(), line.cgst(), line.sgst(), line.igst(), line.taxableAmount(), line.amount(),
                    line.disposition());
            salesReturnItemRepository.save(item);
            savedItems.add(item);

            if (line.disposition() != ReturnDisposition.WRITEOFF) {
                Inventory inv = batchMap.get(original.getInventoryId());
                if (inv != null) {
                    int after = inv.getQuantity();
                    int before = after - line.quantity();
                    movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), userId, MovementType.RETURN,
                            MovementDirection.IN, line.quantity(), before, after, "SALES_RETURN", salesReturn.getId(), null));
                }
            }
        }

        invoice.applyReturn(totalAmount);

        boolean wasCreditSale = invoice.getCustomerId() != null && invoice.getPaymentMode() == PaymentMode.CREDIT
                && invoice.getPaymentStatus() != PaymentStatus.PAID && totalAmount.compareTo(BigDecimal.ZERO) > 0;
        if (wasCreditSale) {
            customerRepository.lockByIdAndPharmacyId(invoice.getCustomerId(), pharmacyId)
                    .filter(c -> c.getCustomerType() == CustomerType.CREDIT)
                    .ifPresent(c -> c.adjustCreditUsed(totalAmount.negate()));
        }

        return toResponse(salesReturn, savedItems);
    }

    @Transactional(readOnly = true)
    public SalesReturnResponse getReturn(String id) {
        SalesReturn sr = loadReturn(id);
        return toResponse(sr, salesReturnItemRepository.findByReturnId(id));
    }

    @Transactional(readOnly = true)
    public SalesReturnPageResponse listReturns(String search, Instant from, Instant to, String invoiceId, int page, int limit) {
        validateDateRange(from, to);
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT);
        Page<SalesReturn> result = salesReturnRepository.search(TenantContext.pharmacyId(), blankToNull(invoiceId),
                DateRange.from(from), DateRange.to(to), blankToNull(search), PageRequest.of(safePage - 1, safeLimit));

        String pharmacyId = TenantContext.pharmacyId();
        List<SalesReturn> returns = result.getContent();

        // Three batched lookups for the whole page, replacing three queries PER ROW (line items,
        // the originating invoice loaded in full just for its number, and the acting user).
        // customer is already fetch-joined by the search query.
        List<String> returnIds = returns.stream().map(SalesReturn::getId).toList();
        Map<String, Long> qtyByReturn = new HashMap<>();
        if (!returnIds.isEmpty()) {
            for (var row : salesReturnItemRepository.sumQuantityByReturnIdIn(pharmacyId, returnIds)) {
                qtyByReturn.put(row.getReturnId(), row.getTotalQuantity());
            }
        }
        List<String> invoiceIds = returns.stream().map(SalesReturn::getInvoiceId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, SalesReturnResponse.InvoiceRef> invoiceRefs = new HashMap<>();
        if (!invoiceIds.isEmpty()) {
            for (var row : invoiceRepository.findRefsByIdIn(pharmacyId, invoiceIds)) {
                invoiceRefs.put(row.getId(), new SalesReturnResponse.InvoiceRef(row.getId(), row.getInvoiceNumber()));
            }
        }
        List<String> userIds = returns.stream().map(SalesReturn::getUserId)
                .filter(java.util.Objects::nonNull).distinct().toList();
        Map<String, String> userNames = new HashMap<>();
        if (!userIds.isEmpty()) {
            for (User u : userRepository.findByIdInAndPharmacyId(userIds, pharmacyId)) {
                userNames.put(u.getId(), u.getName());
            }
        }

        List<SalesReturnResponse> items = returns.stream()
                .map(sr -> toReturnListResponse(sr, qtyByReturn.getOrDefault(sr.getId(), 0L).intValue(),
                        sr.getInvoiceId() == null ? null : invoiceRefs.get(sr.getInvoiceId()),
                        userNames.get(sr.getUserId())))
                .toList();
        return new SalesReturnPageResponse(items, result.getTotalElements(), safePage, safeLimit, result.getTotalPages());
    }

    // ── Add Payment ───────────────────────────────────────────────────────────

    @RetryOnConflict
    @Transactional(isolation = Isolation.SERIALIZABLE)
    public PaymentResponse addPayment(String invoiceId, AddPaymentRequest req) {
        try {
            return doAddPayment(invoiceId, req);
        } catch (ConcurrencyFailureException e) {
            throw new ConflictException("Another payment was recorded simultaneously — please try again");
        }
    }

    private PaymentResponse doAddPayment(String invoiceId, AddPaymentRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        String userId = TenantContext.userId();
        Invoice invoice = loadInvoice(invoiceId);

        if (invoice.isCancelled()) throw new ConflictException("Cannot add payment to a cancelled invoice");
        if (invoice.getStatus() == InvoiceStatus.RETURNED) throw new ConflictException("Invoice is fully returned — no payment is due");

        List<InvoicePayment> payments = invoicePaymentRepository.findByInvoiceIdOrderByPaidAtAsc(invoiceId);
        BigDecimal totalPaid = payments.stream().map(InvoicePayment::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal effectiveTotal = invoice.getTotalAmount().subtract(invoice.getReturnedAmount());
        BigDecimal remaining = effectiveTotal.subtract(totalPaid);

        if (req.amount().compareTo(remaining.add(new BigDecimal("0.01"))) > 0) {
            throw new UnprocessableEntityException("Payment of Rs." + req.amount() + " exceeds outstanding balance of Rs." + remaining);
        }

        PaymentMode mode = parsePaymentMode(req.paymentMode());
        InvoicePayment payment = InvoicePayment.create(pharmacyId, invoiceId, req.amount(), mode, blankToNull(req.reference()),
                req.notes(), req.paidAt(), userId);
        invoicePaymentRepository.save(payment);

        BigDecimal newTotalPaid = totalPaid.add(req.amount());
        PaymentStatus oldStatus = invoice.getPaymentStatus();
        PaymentStatus newStatus;
        if (newTotalPaid.compareTo(effectiveTotal.subtract(new BigDecimal("0.01"))) >= 0) {
            newStatus = PaymentStatus.PAID;
        } else if (newTotalPaid.compareTo(BigDecimal.ZERO) > 0) {
            newStatus = PaymentStatus.PARTIAL;
        } else {
            newStatus = PaymentStatus.PENDING;
        }
        invoice.setPaymentStatus(newStatus);

        boolean settlesCreditSale = newStatus == PaymentStatus.PAID && oldStatus != PaymentStatus.PAID
                && invoice.getCustomerId() != null && invoice.getPaymentMode() == PaymentMode.CREDIT;
        if (settlesCreditSale) {
            BigDecimal decrementBy = effectiveTotal.max(BigDecimal.ZERO);
            customerRepository.lockByIdAndPharmacyId(invoice.getCustomerId(), pharmacyId)
                    .filter(c -> c.getCustomerType() == CustomerType.CREDIT)
                    .ifPresent(c -> c.adjustCreditUsed(decrementBy.negate()));
        }

        return toResponse(payment);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Posts what this sale handed over against the prescription's lines, then settles
     * the prescription's status.
     *
     * <p>Replaces an unconditional {@code markDispensed()}, which closed a prescription
     * on the first sale against it. A patient collecting two of three prescribed
     * medicines today was refused the third on their next visit, because billing only
     * accepts an ACTIVE or PARTIAL prescription and the first sale had already made it
     * DISPENSED.
     *
     * <p>KNOWN LIMITATION — items with no medicineId
     * <p>A prescription line typed as free text (medicineId null, e.g. transcribed from
     * a paper script for a medicine not in the catalogue) cannot be matched to anything
     * sold, so it never accrues a dispensed quantity and holds the prescription at
     * PARTIAL indefinitely. That is the safe direction to fail: PARTIAL remains
     * billable, so the patient is never blocked — the prescription simply does not
     * auto-close and needs cancelling by hand once fulfilled.
     */

    /**
     * Builds the "what the patient collected" event for a clinic-sent prescription.
     *
     * <p>Quantities are the line's CUMULATIVE dispensed total, not this sale's contribution.
     * That is what makes the callback idempotent: redelivering sets the same numbers again
     * rather than adding to them, so every retry path can simply send it once more.
     */
    private PrescriptionDispensedEvent dispensedEvent(Prescription prescription, Invoice invoice,
                                                      List<PrescriptionItem> items) {
        boolean fullyDispensed = !items.isEmpty()
                && items.stream().allMatch(PrescriptionItem::isFullyDispensed);

        List<PrescriptionDispensedEvent.DispensedItem> payloadItems = items.stream()
                .map(i -> new PrescriptionDispensedEvent.DispensedItem(
                        i.getExternalEmrItemId(),
                        i.getMedicineName(),
                        i.getDispensedMedicineName() != null ? i.getDispensedMedicineName() : i.getMedicineName(),
                        i.getDispensedQty(),
                        i.getQuantity(),
                        i.isSubstituted()))
                .toList();

        return new PrescriptionDispensedEvent(
                prescription.getPharmacyId(),
                prescription.getId(),
                prescription.getPrescriptionNumber(),
                prescription.getExternalEmrTenantId(),
                prescription.getExternalEmrPrescriptionId(),
                invoice.getInvoiceNumber(),
                Instant.now(),
                fullyDispensed,
                payloadItems);
    }

    /**
     * What one sale contributed to a prescribed line, when the cashier named the line.
     *
     * <p>Carries the sold medicine as well as the count, because a substitution is only
     * knowable here: the line says what was ordered, this says what was handed over.
     */
    /**
     * @param units base-unit count handed over (what the prescription line accrues)
     * @param packs SEALED PACKS handed over — carried alongside {@code units} rather than
     *              re-derived from it, because deriving it means dividing by the very pack size
     *              the pack-size signal exists to question. A loose line contributes 0: pieces
     *              cut from a strip say nothing about how many sealed packs a course needed.
     */
    private record Attribution(int units, int packs, String medicineId, String medicineName) {
        Attribution plus(Attribution other) {
            return new Attribution(units + other.units, packs + other.packs,
                    other.medicineId, other.medicineName);
        }
    }

    /**
     * Posts what this sale handed over against the prescription's lines, then settles
     * the prescription's status.
     *
     * <p>Replaces an unconditional {@code markDispensed()}, which closed a prescription
     * on the first sale against it. A patient collecting two of three prescribed
     * medicines today was refused the third on their next visit, because billing only
     * accepts an ACTIVE or PARTIAL prescription and the first sale had already made it
     * DISPENSED.
     *
     * <p>An explicitly attributed line wins over medicine matching, and is the only path
     * that can record a substitution — see {@link Attribution}.
     *
     * <p>KNOWN LIMITATION — items with no medicineId
     * <p>A prescription line the EMR sent that the matcher could not resolve, or one typed
     * as free text, cannot be matched to anything sold and so never accrues a dispensed
     * quantity, holding the prescription at PARTIAL. That is the safe direction to fail:
     * PARTIAL remains billable, so the patient is never blocked. It is also why the
     * prescription screen surfaces those lines for a pharmacist to link.
     */
    private List<PrescriptionItem> recordDispensing(Prescription prescription,
                                                    Map<String, Integer> dispensedByMedicineId,
                                                    Map<String, Attribution> attributedByItemId,
                                                    Map<String, Integer> packsByMedicineId,
                                                    String invoiceId) {
        List<PrescriptionItem> items = prescriptionItemRepository.findByPrescriptionId(prescription.getId());

        for (PrescriptionItem item : items) {
            Attribution attributed = attributedByItemId.get(item.getId());
            if (attributed != null) {
                item.recordDispensed(attributed.units());
                capturePackSizeSignal(prescription, item, attributed.medicineId(), attributed.packs(), invoiceId);
                // Only when it genuinely differs. Recording a "substitution" for the product
                // that was prescribed would put a spurious swap in front of a clinician.
                if (!attributed.medicineId().equals(item.getMedicineId())) {
                    item.recordSubstitution(attributed.medicineId(), attributed.medicineName());
                }
                continue;
            }
            if (item.getMedicineId() == null) {
                continue;
            }
            Integer units = dispensedByMedicineId.get(item.getMedicineId());
            if (units != null) {
                item.recordDispensed(units);
                capturePackSizeSignal(prescription, item, item.getMedicineId(),
                        packsByMedicineId.getOrDefault(item.getMedicineId(), 0), invoiceId);
            }
        }

        boolean everythingCollected = !items.isEmpty()
                && items.stream().allMatch(PrescriptionItem::isFullyDispensed);
        if (everythingCollected) {
            prescription.markDispensed();
        } else {
            prescription.markPartiallyDispensed();
        }
        return items;
    }

    /**
     * Records the fact that a pharmacist overruled the dispensing engine about how many sealed
     * packs a measured course needed.
     *
     * <p>This is the only place in the system where an inference about a pack meets somebody
     * holding one. The engine's pack count comes from dividing a clinical volume by a catalogue
     * number nobody may ever have checked; the pharmacist's comes from the shelf. When the two
     * differ, the difference is the most informative thing available about what the pack really
     * holds — and until now it was discarded the instant the bill saved.
     *
     * <p><b>It asserts nothing.</b> One override is far more likely to be routine — patient
     * wanted less, shelf was short, course was split — than a catalogue error. A signal is a
     * vote, and only {@link com.checkup.pharmacy.common.util.PackSizeQuorum} treats a pile of
     * them from several pharmacies as evidence. See {@link PackSizeSignal}.
     *
     * <p>The engine's divisor is recovered as {@code quantity / roundedPackCount} rather than
     * read from today's catalogue, deliberately and for the same reason {@code
     * PrescriptionItem.isStaleAgainst} does it: those two numbers were written together at
     * ingest and are the only pair guaranteed to describe the conversion this line actually
     * received. Today's catalogue may have moved since.
     *
     * <p>Never throws. A telemetry row that cannot be derived, or a database that refuses it,
     * must not be the reason a sale fails — the bill is the real work and this is a note in the
     * margin of it.
     */
    private void capturePackSizeSignal(Prescription prescription, PrescriptionItem item,
                                       String dispensedMedicineId, int actualPackCount, String invoiceId) {
        try {
            Integer enginePackCount = item.getRoundedPackCount();
            java.math.BigDecimal clinicalVolume = item.getPrescribedVolumeClinical();
            // Only a MEASURED line resolved at ingest carries both, which is exactly the scope
            // that matters: a wrong strip count is off by a few tablets and a pharmacist
            // counting them notices, while a wrong bottle volume is off by a factor.
            if (enginePackCount == null || enginePackCount <= 0 || clinicalVolume == null) {
                return;
            }
            // A substituted line was filled with a DIFFERENT product, so the packs handed over
            // describe that product's pack, not this one's. Attributing them here would teach
            // the loop about the wrong medicine.
            if (dispensedMedicineId == null || !dispensedMedicineId.equals(item.getMedicineId())) {
                return;
            }
            int declaredPackSize = item.getQuantity() / enginePackCount;

            PackSizeSignal signal = PackSizeSignal.capture(
                    prescription.getPharmacyId(), item.getMedicineId(), invoiceId, item.getId(),
                    enginePackCount, actualPackCount, clinicalVolume, declaredPackSize);
            if (signal != null) {
                packSizeSignalRepository.save(signal);
                log.info("Pack-size signal: medicine {} engine={} packs, dispensed={} packs, "
                                + "declared={} per pack, implied>={}",
                        item.getMedicineId(), enginePackCount, actualPackCount, declaredPackSize,
                        signal.getImpliedPackSize());
            }
        } catch (RuntimeException e) {
            log.warn("Could not record a pack-size signal for prescription item {} — the sale is unaffected",
                    item.getId(), e);
        }
    }

    private Invoice loadInvoice(String id) {
        return invoiceRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Invoice not found"));
    }

    private SalesReturn loadReturn(String id) {
        return salesReturnRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Return not found"));
    }

    private static PaymentMode parsePaymentMode(String value) {
        try {
            return PaymentMode.valueOf(value);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("paymentMode must be one of CASH, UPI, CARD, CREDIT, WALLET");
        }
    }

    private static PaymentStatus parsePaymentStatus(String value) {
        try {
            return PaymentStatus.valueOf(value);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("paymentStatus must be one of PAID, PENDING, PARTIAL");
        }
    }

    private static ReturnDisposition parseDisposition(String value) {
        try {
            return ReturnDisposition.valueOf(value);
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("disposition must be RESTOCK or WRITEOFF");
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /**
     * A backwards range ({@code from} after {@code to}) is always a mistake — a mis-typed year in
     * the date picker, or the two fields filled in the wrong order. Left unchecked it matches no
     * rows and renders as an ordinary "No bills found" empty state, which reads as "this pharmacy
     * made no sales" rather than "your filter is inverted" — the user then goes looking for missing
     * data that was never missing. Fail loudly with the offending range instead.
     */
    private static void validateDateRange(Instant from, Instant to) {
        if (from != null && to != null && from.isAfter(to)) {
            throw new BadRequestException("The 'from' date (" + DATE_FMT.format(from) + ") is after the 'to' date ("
                    + DATE_FMT.format(to) + ") — check the date range and try again");
        }
    }

    /** Same reasoning as {@link #validateDateRange}: an inverted amount filter silently matches nothing. */
    private static void validateAmountRange(BigDecimal minAmount, BigDecimal maxAmount) {
        if (minAmount != null && maxAmount != null && minAmount.compareTo(maxAmount) > 0) {
            throw new BadRequestException("The minimum amount (" + minAmount.toPlainString()
                    + ") is greater than the maximum amount (" + maxAmount.toPlainString()
                    + ") — check the amount filter and try again");
        }
    }

    private static final java.time.format.DateTimeFormatter DATE_FMT =
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy").withZone(IST);

    // ── Response mapping ─────────────────────────────────────────────────────

    /** Full reload path (get/list) — relations were fetch-joined or are queried fresh, so entity relations are safe to read. */
    private InvoiceResponse toResponse(Invoice invoice) {
        User user = userRepository.findById(invoice.getUserId()).orElse(null);
        return toResponse(invoice, invoice.getCustomer(), invoice.getDoctor(), user, invoiceItemRepository.findByInvoiceId(invoice.getId()),
                invoicePaymentRepository.findByInvoiceIdOrderByPaidAtAsc(invoice.getId()),
                salesReturnRepository.findByInvoiceId(invoice.getId()));
    }

    /**
     * Explicit-reference overload used right after {@code createInvoice} persists a
     * brand-new Invoice: a just-persisted entity's lazy customer/doctor relations
     * read back null even if re-queried in the same transaction (Hibernate's
     * persistence-context identity map problem — see BACKLOG.md's Tier 2 notes),
     * so the caller passes the objects it already loaded instead of relying on
     * invoice.getCustomer()/getDoctor().
     */
    private InvoiceResponse toResponse(Invoice invoice, Customer customer, Doctor doctor, User user,
                                       List<InvoiceItem> items, List<InvoicePayment> payments, List<SalesReturn> returns) {
        InvoiceResponse.CustomerRef customerRef = customer == null ? null
                : new InvoiceResponse.CustomerRef(customer.getId(), customer.getName(), customer.getPhone(), customer.getEmail());
        InvoiceResponse.UserRef userRef = user == null ? null : new InvoiceResponse.UserRef(user.getId(), user.getName());
        InvoiceResponse.PrescriptionRef prescriptionRef = invoice.getPrescriptionId() == null ? null
                : prescriptionRepository.findByIdAndPharmacyId(invoice.getPrescriptionId(), invoice.getPharmacyId())
                        .map(rx -> new InvoiceResponse.PrescriptionRef(rx.getId(), rx.getPrescriptionNumber(),
                                rx.getDoctorName(), rx.getPatientName(), rx.getStatus().name()))
                        .orElse(null);

        List<InvoiceResponse.Item> itemResponses = items.stream()
                .map(i -> new InvoiceResponse.Item(i.getId(), i.getInventoryId(), i.getMedicineName(), i.getHsnCode(),
                        i.getBatchNumber(), i.getExpiryDate(), i.getQuantity(), i.getFreeQty(), i.getSaleUnit(),
                        i.getBaseUnit(), i.getMrp(), i.getRate(), i.getPurchaseRate(),
                        i.getDiscount(), i.getGstRate(), i.getCgst(), i.getSgst(), i.getIgst(), i.getTaxableAmount(),
                        i.getAmount(), i.getLocation(), i.isBatchAutoSelected()))
                .toList();
        List<PaymentResponse> paymentResponses = payments.stream().map(this::toResponse).toList();
        List<InvoiceResponse.ReturnRef> returnRefs = returns.stream()
                .map(r -> new InvoiceResponse.ReturnRef(r.getId(), r.getReturnNumber(), r.getTotalAmount(), r.getCreatedAt()))
                .toList();

        return new InvoiceResponse(invoice.getId(), invoice.getInvoiceNumber(), customerRef, invoice.getCustomerName(),
                invoice.getCustomerPhone(), userRef, invoice.getDoctorId(), invoice.getDoctorName(), invoice.getDoctorRegNo(),
                invoice.getPrescriptionId(), prescriptionRef, invoice.getPaymentMode().name(), invoice.getPaymentStatus().name(),
                invoice.getStatus().name(), invoice.getSubtotal(), invoice.getDiscountAmount(), invoice.getTaxableAmount(),
                invoice.getCgst(), invoice.getSgst(), invoice.getIgst(), invoice.getTotalGst(), invoice.getTotalAmount(),
                invoice.getExtraCharges(), invoice.getAdjustmentAmount(), invoice.getRoundOff(),
                invoice.getReturnedAmount(), invoice.isInterstate(), invoice.getNotes(), invoice.isCancelled(),
                invoice.getCancelledAt(), invoice.getCancelReason(),
                invoice.getDispensingStrategy() == null ? null : invoice.getDispensingStrategy().name(),
                itemResponses, paymentResponses, returnRefs,
                invoice.getCreatedAt(), invoice.getUpdatedAt());
    }

    private PaymentResponse toResponse(InvoicePayment p) {
        return new PaymentResponse(p.getId(), p.getAmount(), p.getPaymentMode().name(), p.getReference(), p.getNotes(), p.getPaidAt());
    }

    private SalesReturnResponse toResponse(SalesReturn sr, List<SalesReturnItem> items) {
        return toResponse(sr, sr.getCustomer(), items);
    }

    /** See the Invoice overload's javadoc — same rationale for a just-created SalesReturn. */
    private SalesReturnResponse toResponse(SalesReturn sr, Customer customer, List<SalesReturnItem> items) {
        Invoice invoice = invoiceRepository.findById(sr.getInvoiceId()).orElse(null);
        User user = userRepository.findById(sr.getUserId()).orElse(null);
        SalesReturnResponse.InvoiceRef invoiceRef = invoice == null ? null
                : new SalesReturnResponse.InvoiceRef(invoice.getId(), invoice.getInvoiceNumber());
        SalesReturnResponse.UserRef userRef = user == null ? null : new SalesReturnResponse.UserRef(user.getId(), user.getName());
        SalesReturnResponse.CustomerRef customerRef = customer == null ? null
                : new SalesReturnResponse.CustomerRef(customer.getId(), customer.getName(), customer.getPhone());

        List<SalesReturnResponse.Item> itemResponses = items.stream()
                .map(i -> new SalesReturnResponse.Item(i.getId(), i.getInvoiceItemId(), i.getInventoryId(), i.getMedicineName(),
                        i.getHsnCode(), i.getBatchNumber(), i.getExpiryDate(), i.getQuantity(), i.getMrp(), i.getRate(),
                        i.getDiscount(), i.getGstRate(), i.getCgst(), i.getSgst(), i.getIgst(), i.getTaxableAmount(),
                        i.getAmount(), i.getDisposition().name()))
                .toList();

        int totalQuantity = items.stream().mapToInt(SalesReturnItem::getQuantity).sum();
        return new SalesReturnResponse(sr.getId(), sr.getReturnNumber(), invoiceRef, sr.getReason(), userRef, customerRef,
                sr.getSubtotal(), sr.getDiscountAmount(), sr.getTaxableAmount(), sr.getCgst(), sr.getSgst(), sr.getIgst(),
                sr.getTotalGst(), sr.getTotalAmount(), itemResponses, totalQuantity, sr.getCreatedAt());
    }

    /**
     * List-row builder — the counterpart to the full {@link #toResponse} above, but without
     * loading or shipping line items. The units-returned figure, the originating invoice's
     * number and the acting user's name are all pre-resolved by the caller in one batched
     * query each, so a page of returns costs a fixed number of queries instead of three per row.
     * {@code customer} is the fetch-joined association from the list query — no lazy load.
     */
    private SalesReturnResponse toReturnListResponse(SalesReturn sr, int totalQuantity,
                                                     SalesReturnResponse.InvoiceRef invoiceRef, String userName) {
        Customer customer = sr.getCustomer();
        SalesReturnResponse.CustomerRef customerRef = customer == null ? null
                : new SalesReturnResponse.CustomerRef(customer.getId(), customer.getName(), customer.getPhone());
        // Never null in practice; "Unknown" beats an empty entry-by cell if the staff row is gone.
        SalesReturnResponse.UserRef userRef = sr.getUserId() == null ? null
                : new SalesReturnResponse.UserRef(sr.getUserId(), userName != null ? userName : "Unknown");

        return new SalesReturnResponse(sr.getId(), sr.getReturnNumber(), invoiceRef, sr.getReason(), userRef, customerRef,
                sr.getSubtotal(), sr.getDiscountAmount(), sr.getTaxableAmount(), sr.getCgst(), sr.getSgst(), sr.getIgst(),
                sr.getTotalGst(), sr.getTotalAmount(), List.of(), totalQuantity, sr.getCreatedAt());
    }
}
