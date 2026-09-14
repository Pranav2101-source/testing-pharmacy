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
import com.checkup.pharmacy.modules.billing.dto.TenderRequest;
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
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
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
    /** Rounding slack when comparing two money figures that took different routes. */
    private static final BigDecimal PAISA = new BigDecimal("0.01");

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
    /** The only writer of dues/advance balances — see its own javadoc. */
    private final com.checkup.pharmacy.modules.customerledger.CustomerLedgerService customerLedgerService;
    private final PaymentMixReader paymentMixReader;

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
                          com.checkup.pharmacy.modules.customerledger.CustomerLedgerService customerLedgerService,
                          PaymentMixReader paymentMixReader,
                          ApplicationEventPublisher eventPublisher) {
        this.paymentMixReader = paymentMixReader;
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
        this.customerLedgerService = customerLedgerService;
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
        // Tender-aware, and the same source the day's cash closure reads — a bill settled
        // part in cash and part by UPI belongs to both figures, not to whichever leg
        // happened to be larger.
        var breakdown = paymentMixReader.mix(pharmacyId, todayStart,
                        todayStart.plus(1, java.time.temporal.ChronoUnit.DAYS).minusMillis(1))
                .entrySet().stream()
                .sorted((a, b) -> b.getValue().amount().compareTo(a.getValue().amount()))
                .map(e -> new com.checkup.pharmacy.modules.billing.dto.DashboardStatsResponse.PaymentBreakdown(
                        e.getKey().name(), round2(e.getValue().amount()), e.getValue().bills()))
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
        // A split bill answers this from its tenders: any CREDIT leg means part of this
        // sale goes on the account, whatever the other legs settle. The amounts are not
        // known yet — finalTotal is computed much further down — but the lock decision
        // only needs to know THAT credit is involved, not how much.
        boolean onCredit = req.hasTenders()
                ? req.tendersOrEmpty().stream().anyMatch(t -> PaymentMode.CREDIT.name().equalsIgnoreCase(blankToNull(t.paymentMode())))
                : paymentMode == PaymentMode.CREDIT && paymentStatus != PaymentStatus.PAID;
        // An ADVANCE leg draws down the deposit we hold, which is the same read-modify-write
        // on the same row. Taking the lock here rather than letting applyAdvance upgrade it
        // mid-transaction keeps every customer-balance write in this method ordered the same
        // way, which is what stops two tills billing one customer from deadlocking.
        boolean usesAdvance = req.hasTenders()
                && req.tendersOrEmpty().stream()
                        .anyMatch(t -> PaymentMode.ADVANCE.name().equalsIgnoreCase(blankToNull(t.paymentMode())));

        Customer customer = null;
        if (req.customerId() != null && !req.customerId().isBlank()) {
            customer = ((onCredit || usesAdvance)
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

        // Resolved here and not earlier because it is checked against finalTotal, which
        // only exists now. On a bill that states no tenders this yields the legacy plan:
        // the declared mode and status, unchanged, and nothing written to invoice_payments.
        TenderPlan tenderPlan = resolveTenders(req, finalTotal, paymentMode, paymentStatus, onCredit);
        paymentMode = tenderPlan.dominantMode();
        paymentStatus = tenderPlan.status();

        boolean isCreditSale = tenderPlan.creditAmount().compareTo(BigDecimal.ZERO) > 0;

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
            // Measured against the CREDIT leg, not the bill: on a Rs.1000 bill settled
            // Rs.600 in cash and Rs.400 on account, only Rs.400 is ever owed, and
            // charging the limit for the full Rs.1000 would refuse sales the customer
            // has the headroom for. On a wholly-unpaid bill the two are the same number.
            BigDecimal creditAmount = tenderPlan.creditAmount();
            BigDecimal limit = customer.getCreditLimit();
            BigDecimal projected = customer.getCreditUsed().add(creditAmount);

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
                        + ", required: Rs." + creditAmount);
            }
            // The actual debit happens below, once the invoice has an id to link to
            // — see the postSale() call after invoiceRepository.save(invoice). Not
            // here: customer.adjustCreditUsed(finalTotal) directly would move the
            // cached balance with no ledger entry behind it, the exact drift this
            // ledger exists to make impossible.
        }

        // Spending a deposit needs someone to have made one.
        BigDecimal advanceAmount = tenderPlan.advanceAmount();
        if (advanceAmount.compareTo(BigDecimal.ZERO) > 0) {
            if (customer == null) {
                throw new UnprocessableEntityException(
                        "Paying from an advance needs a customer — the deposit belongs to somebody. "
                        + "Select the customer, or pay another way.");
            }
            // The binding check is in CustomerLedgerService, which holds the row lock and
            // is the only place that can be raced. This one exists so the cashier is told
            // what is actually wrong, with the figure they need, instead of reading a
            // message written for the ledger's own invariants.
            if (advanceAmount.compareTo(customer.getAdvanceBalance()) > 0) {
                throw new UnprocessableEntityException(
                        "Only Rs." + customer.getAdvanceBalance().setScale(2, RoundingMode.HALF_UP)
                        + " is held in advance for " + customer.getName() + " — Rs."
                        + advanceAmount.setScale(2, RoundingMode.HALF_UP) + " cannot be drawn from it.");
            }
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

        // Posted after the invoice is saved, so the ledger entry can link to a real
        // invoiceId — see CustomerLedgerInvoiceLinkageIT for why doing this before
        // the save would be unsafe (the FK is not deferrable). customer is already
        // locked above by the limit check, so this re-lock is a same-transaction
        // no-op; see CustomerLedgerService's javadoc on why it locks unconditionally.
        //
        // The SALE posted here covers BOTH the credit leg and the advance leg, not
        // just the credit leg. applyAdvance's own contract is "the customer's credit
        // with us pays down what they owe us" — it moves dues down alongside advance,
        // on the assumption that a debt already exists to pay down. For an ADVANCE
        // leg with no CREDIT leg on the same bill (the ordinary case: a walk-in
        // customer paying entirely from a standing deposit), nothing else ever put
        // that debt on the khata — so without a SALE for the advance amount too,
        // applyAdvance tries to subtract from zero dues and CustomerLedgerService
        // refuses it outright. Posting the SALE for the combined amount and letting
        // applyAdvance immediately settle the advance-covered portion nets to exactly
        // creditAmount owed, the correct final figure, while leaving a real SALE +
        // ADVANCE_APPLIED pair on the statement instead of an invisible shortcut.
        BigDecimal duesCreatedByThisSale = tenderPlan.creditAmount().add(advanceAmount);
        if (duesCreatedByThisSale.compareTo(BigDecimal.ZERO) > 0) {
            customerLedgerService.postSale(pharmacyId, customer.getId(), invoice.getId(),
                    duesCreatedByThisSale, userId);
        }
        // Draws the deposit down. Posted after the SALE above so the khata reads in the
        // order the money moved; both entries share this transaction's entryAt to the
        // millisecond, which is precisely why CustomerLedgerEntry carries a seq.
        if (advanceAmount.compareTo(BigDecimal.ZERO) > 0) {
            customerLedgerService.applyAdvance(pharmacyId, customer.getId(), invoice.getId(),
                    advanceAmount, userId);
        }

        // Each settled leg is money that actually arrived, so each becomes a payment row.
        // A CREDIT leg is deliberately absent from this list: nothing moved, and writing
        // it here would report the pharmacy as having collected its own receivables.
        //
        // This is also the point the day's cash stops being derivable from the invoice
        // alone — see InvoiceRepository.sumUntenderedReceivedByModeInRange, which reads
        // only bills carrying no tender rows of their own, so the two sources can never
        // both claim the same rupee.
        for (ResolvedTender tender : tenderPlan.settled()) {
            invoicePaymentRepository.save(InvoicePayment.create(pharmacyId, invoice.getId(), tender.amount(),
                    tender.mode(), tender.reference(), null, invoice.getCreatedAt(), userId));
        }
        if (tenderPlan.paidAmount().compareTo(BigDecimal.ZERO) > 0) {
            invoice.adjustAmountPaid(tenderPlan.paidAmount());
        }

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
                    inv.getStatus().name(), inv.getTotalAmount(), inv.getAmountPaid(), inv.balanceDue(),
                    inv.isCancelled(),
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
        // Money collected AFTER the bill was raised — a customer settling their account —
        // still blocks a cancellation: that payment has its own life and reversing it by
        // voiding the bill would lose it.
        //
        // The tenders taken at the counter when the bill was raised do not block it, and
        // this distinction is new. Before split tender a bill recorded nothing at
        // checkout, so "has payments" and "was settled later" were the same question; now
        // every bill carries its own tenders and the old test would have refused to cancel
        // ANY bill — including the mis-punched one the cashier voids thirty seconds later,
        // which is the single most common correction on a till.
        //
        // Checkout tenders are the ones stamped with the invoice's own createdAt; see
        // createInvoice, and InvoiceRepository.sumCreditPutOnAccountInRange which leans on
        // the same invariant.
        BigDecimal totalCollected = payments.stream()
                .map(InvoicePayment::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal settledLater = totalCollected.subtract(collectedAtCheckout(invoice, payments));
        if (settledLater.compareTo(PAISA) > 0) {
            throw new ConflictException("Cannot cancel an invoice with Rs." + settledLater
                    + " collected against it. Raise a sales return to reverse the payment first.");
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

        // Mirrors createInvoice's own predicate — see Invoice.wasSoldOnAccount. A
        // PAID-at-creation CREDIT invoice never posted a SALE entry in the first place,
        // so there is nothing here to reverse.
        boolean wasCreditSale = invoice.wasSoldOnAccount(collectedAtCheckout(invoice, payments))
                && invoice.getTotalAmount().compareTo(BigDecimal.ZERO) > 0;
        if (wasCreditSale) {
            // balanceDue(), not getTotalAmount() directly — though the two guards
            // above (no cancel with payments collected, no cancel of a
            // returned/partially-returned invoice) make them equal today, since
            // both returnedAmount and amountPaid are guaranteed zero at this point.
            // Computing it this way keeps the reversal correct even if either guard
            // is ever relaxed, rather than silently reintroducing the bug this
            // ledger exists to prevent.
            //
            // Routed through the ledger (RETURN_CREDIT: the whole sale is voided,
            // the same dues-down shape as a 100% return) instead of a direct
            // customer.adjustCreditUsed() call — the old version moved the cached
            // balance with zero audit trail, so a cancelled Rs.1000 credit bill left
            // no record of why creditUsed dropped. No CustomerType.CREDIT filter,
            // matching addPayment's reasoning: the debt is real regardless of the
            // customer's current type label.
            BigDecimal reverseBy = invoice.balanceDue();
            if (reverseBy.signum() > 0) {
                customerLedgerService.postReturnCredit(pharmacyId, invoice.getCustomerId(), invoice.getId(),
                        null, reverseBy, userId);
            }
        }

        // Give back whatever this bill drew from the customer's deposit.
        //
        // Checkout tenders deliberately do not block a cancellation (see the guard
        // above), and an ADVANCE leg is a checkout tender — so without this, voiding a
        // mis-punched bill would keep the customer's money and leave them with neither
        // the goods nor the deposit. Every other leg needs no counterpart here: cash
        // handed back at the counter is not something the system can or should record
        // on their behalf.
        //
        // Posted with no payment mode on purpose. The money is moving between two of
        // our own records, not through the till, so it must not appear in the day's
        // drawer — see PaymentMixReader.advanceMovements, which counts only entries
        // that name the mode the money physically arrived in.
        BigDecimal advanceToRestore = payments.stream()
                .filter(p -> p.getPaymentMode() == PaymentMode.ADVANCE)
                .filter(p -> p.getPaidAt() != null && invoice.getCreatedAt() != null
                        && !p.getPaidAt().isAfter(invoice.getCreatedAt()))
                .map(InvoicePayment::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (advanceToRestore.signum() > 0 && invoice.getCustomerId() != null) {
            try {
                customerLedgerService.postAdvance(pharmacyId, invoice.getCustomerId(), advanceToRestore,
                        null, null, null,
                        "Advance returned — bill " + invoice.getInvoiceNumber() + " cancelled", null, userId);
            } catch (NotFoundException e) {
                // Reachable: spend a deposit down to zero on this bill, remove the
                // customer (permitted at a zero balance), then cancel the bill. Letting
                // the raw "Customer not found" through would blame the cancellation for
                // a missing record nobody was looking for. Refusing is right — the
                // money has to land somewhere — but the message has to say where.
                throw new ConflictException("This bill was settled with Rs." + advanceToRestore
                        + " from " + invoice.getCustomerName() + "'s deposit, and that customer has since been "
                        + "removed. Restore the customer first so the deposit can go back to them.");
            }
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

        // balanceDue() BEFORE applying the return — the dues this specific bill
        // still carried at the moment the goods came back.
        BigDecimal duesBefore = invoice.balanceDue();
        BigDecimal overpaymentBefore = overpayment(invoice.getTotalAmount(), invoice.getReturnedAmount(),
                invoice.getAmountPaid());
        invoice.applyReturn(totalAmount);
        BigDecimal duesAfter = invoice.balanceDue();
        BigDecimal overpaymentAfter = overpayment(invoice.getTotalAmount(), invoice.getReturnedAmount(),
                invoice.getAmountPaid());

        boolean wasCreditSale = invoice.wasSoldOnAccount(
                collectedAtCheckout(invoice, invoicePaymentRepository.findByInvoiceIdOrderByPaidAtAsc(invoiceId)))
                && totalAmount.compareTo(BigDecimal.ZERO) > 0;
        if (wasCreditSale) {
            // duesBefore - duesAfter, NOT totalAmount — this is the actual bug fix.
            //
            // The old code subtracted the full return value from dues every time.
            // Pay Rs.400 of a Rs.1000 credit bill (dues = Rs.600), then return
            // Rs.700 of goods: the old code cut dues by the full Rs.700, landing at
            // -Rs.100 — a customer who still genuinely owed Rs.600 was recorded as
            // Rs.100 IN CREDIT with us, and the receivables page would have shown
            // them as owing nothing while actually holding an unrecorded refund.
            //
            // balanceDue() already floors at zero and already accounts for
            // amountPaid, so duesBefore - duesAfter is exactly the portion of the
            // return that was still unpaid: min(totalAmount, whatever was owed).
            // With Rs.600 owed and Rs.700 returned, that is Rs.600 — dues go to
            // zero, which is correct. The other Rs.100 of returned value is not a
            // dues reduction at all; the customer paid Rs.400 for goods worth
            // Rs.300 they kept, and is owed Rs.100 back in cash or as an advance.
            //
            BigDecimal reduceBy = duesBefore.subtract(duesAfter);
            if (reduceBy.signum() > 0) {
                customerLedgerService.postReturnCredit(pharmacyId, invoice.getCustomerId(), invoice.getId(),
                        salesReturn.getId(), reduceBy, userId);
            }
        }

        // What the customer has now overpaid, credited to them as an advance.
        //
        // This is the case the dues fix above deliberately left open: pay Rs.400 of a
        // Rs.1000 bill, return Rs.700 of goods, and Rs.600 of that return clears the
        // dues — but the remaining Rs.100 is money the customer handed over for goods
        // they no longer have. Until now nothing recorded it, so it existed only as a
        // conversation at the counter.
        //
        // Credited rather than refunded in cash: the till cannot know whether they
        // want it back or want it kept, and an advance is the reversible choice — it
        // can be spent on the next bill or refunded later, and either way it is on the
        // khata. Paying it out automatically would move real money out of the drawer
        // on a decision nobody made.
        //
        // Computed as the CHANGE in overpayment, not the total, so a second partial
        // return credits only what it newly creates.
        if (invoice.getCustomerId() != null) {
            BigDecimal creditBack = overpaymentAfter.subtract(overpaymentBefore);
            if (creditBack.signum() > 0) {
                customerLedgerService.postAdvance(pharmacyId, invoice.getCustomerId(), creditBack,
                        null, null, null,
                        "Overpayment credited from return against bill " + invoice.getInvoiceNumber(),
                        null, userId);
            }
        }

        return toResponse(salesReturn, savedItems);
    }

    /**
     * What the customer has paid over and above what this bill still charges them.
     *
     * <p>Zero on every ordinary bill. It becomes positive only when goods come back on
     * a bill that was already settled, which is precisely when money the pharmacy is
     * holding stops belonging to it.
     */
    private static BigDecimal overpayment(BigDecimal totalAmount, BigDecimal returnedAmount,
                                          BigDecimal amountPaid) {
        return amountPaid.subtract(totalAmount.subtract(returnedAmount)).max(BigDecimal.ZERO);
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

        // Read BEFORE the status is recomputed below. The payment that finally clears a
        // bill turns it PAID, and asking afterwards would answer "not on account" for the
        // one payment that matters most — leaving the dues it just settled standing.
        boolean onAccount = invoice.wasSoldOnAccount(collectedAtCheckout(invoice, payments));

        // A settlement cannot predate the bill it settles. paidAt is client-supplied, and
        // a value at or before the invoice's own timestamp would disguise this payment as
        // one of the bill's checkout tenders — which is exactly the test that decides
        // whether the bill may still be cancelled. Backdate it and a bill holding real
        // cash becomes cancellable, taking that cash out of the day's closure with it.
        if (req.paidAt() != null && invoice.getCreatedAt() != null
                && !req.paidAt().isAfter(invoice.getCreatedAt())) {
            throw new UnprocessableEntityException(
                    "A payment cannot be dated before the bill it settles.");
        }

        PaymentMode mode = parsePaymentMode(req.paymentMode());
        // Settling a bill from a deposit is a transfer between two balances we already
        // hold, not money arriving — it belongs to the checkout tender path, which posts
        // the matching ADVANCE_APPLIED entry. Allowed here it would take the payment and
        // never draw the deposit down, so the customer would pay twice.
        if (mode == PaymentMode.ADVANCE) {
            throw new UnprocessableEntityException(
                    "An advance cannot be collected as a payment — it is money we already hold. "
                    + "Apply it when billing instead.");
        }
        InvoicePayment payment = InvoicePayment.create(pharmacyId, invoiceId, req.amount(), mode, blankToNull(req.reference()),
                req.notes(), req.paidAt(), userId);
        invoicePaymentRepository.save(payment);
        // Cache of SUM(InvoicePayment.amount) for this bill — see Invoice.amountPaid's
        // javadoc. Moved for every payment regardless of tender or credit status: it
        // answers "how much has actually been collected", which is not a
        // credit-specific question.
        invoice.adjustAmountPaid(req.amount());

        BigDecimal newTotalPaid = totalPaid.add(req.amount());
        PaymentStatus newStatus;
        if (newTotalPaid.compareTo(effectiveTotal.subtract(new BigDecimal("0.01"))) >= 0) {
            newStatus = PaymentStatus.PAID;
        } else if (newTotalPaid.compareTo(BigDecimal.ZERO) > 0) {
            newStatus = PaymentStatus.PARTIAL;
        } else {
            newStatus = PaymentStatus.PENDING;
        }
        invoice.setPaymentStatus(newStatus);

        // Every payment against a credit bill reduces dues by exactly what was
        // collected, not only the one that happens to reach PAID.
        //
        // The previous version gated this on `newStatus == PAID && oldStatus !=
        // PAID` and decremented the bill's FULL remaining total in one shot. Pay
        // Rs.400 of a Rs.1000 credit bill and creditUsed did not move at all — the
        // customer still showed Rs.1000 owed until the very last rupee arrived, and
        // the receivables page was wrong for the entire life of every partially
        // paid bill. Fixed by posting the payment's own amount, every time.
        //
        // No CustomerType.CREDIT filter here, unlike the old code: the debt is
        // real and tracked by the ledger regardless of the customer's CURRENT
        // type label. Silently skipping the decrement for a customer reclassified
        // after the sale would be a worse bug than the one being fixed — it would
        // leave a real payment permanently unrecorded against real dues.
        //
        // Asked of the invoice rather than of its paymentMode, which stopped being a
        // sufficient answer when a bill gained the ability to be settled several ways at
        // once: a Rs.1000 bill split Rs.600 cash and Rs.400 on account is filed under CASH
        // — its largest leg — yet it owes Rs.400, and the old test would have taken the
        // customer's Rs.400 without ever clearing it from what they owe.
        if (onAccount) {
            // Numbered, because this is a receipt the customer can be handed and later
            // quote back. Allocated inside this transaction, so a failed collection
            // returns its number instead of burning it.
            String receiptNumber = DocumentNumberFormat.customerReceipt(
                    sequenceService.next(pharmacyId, DocumentSequenceService.CUSTOMER_RECEIPT,
                            DocumentSequenceService.PERIOD_ALL));
            customerLedgerService.postPayment(pharmacyId, invoice.getCustomerId(), invoiceId, req.amount(),
                    mode, receiptNumber, req.reference(), req.notes(), req.paidAt(), userId);
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
        // Lines this sale CONTINUES rather than starts — see withdrawSplitFillSignals.
        List<String> continuedItemIds = new ArrayList<>();

        for (PrescriptionItem item : items) {
            // Read before recordDispensed moves it: what matters is whether an EARLIER sale
            // had already handed something over against this line.
            boolean continuesEarlierSale = item.getDispensedQty() > 0;
            Attribution attributed = attributedByItemId.get(item.getId());
            if (attributed != null) {
                item.recordDispensed(attributed.units());
                if (continuesEarlierSale) {
                    continuedItemIds.add(item.getId());
                } else {
                    capturePackSizeSignal(prescription, item, attributed.medicineId(), attributed.packs(), invoiceId);
                }
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
                if (continuesEarlierSale) {
                    continuedItemIds.add(item.getId());
                } else {
                    capturePackSizeSignal(prescription, item, item.getMedicineId(),
                            packsByMedicineId.getOrDefault(item.getMedicineId(), 0), invoiceId);
                }
            }
        }
        withdrawSplitFillSignals(prescription.getPharmacyId(), continuedItemIds);

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

    /**
     * Withdraws the signals an earlier sale left against lines this sale has just continued.
     *
     * <p>A short count at the till is ambiguous when it happens: "one bottle, not the two the
     * engine asked for" is what a wrong pack size looks like, and it is equally what a patient
     * collecting half a course today looks like. A second sale against the same line settles it —
     * the course was split, and the first sale's count says nothing about the pack. Left in
     * place, a split fill counted as a vote for a pack at least the whole course's volume (105 ml
     * against a correct 60 ml bottle), and two shops splitting ordinary courses could quarantine
     * a correct catalogue row. The continuing sale captures no signal of its own for the same
     * reason — its count is a remainder, not a course.
     *
     * <p>One batched read for every continued line on the bill. Never throws, like
     * {@link #capturePackSizeSignal}: the sale is the real work.
     */
    private void withdrawSplitFillSignals(String pharmacyId, List<String> continuedItemIds) {
        if (continuedItemIds.isEmpty()) {
            return;
        }
        try {
            Instant now = Instant.now();
            for (PackSizeSignal s : packSizeSignalRepository
                    .findByPharmacyIdAndPrescriptionItemIdInAndResolvedAtIsNull(pharmacyId, continuedItemIds)) {
                s.resolve("Course completed across more than one sale — a split fill, "
                        + "not a disagreement about the pack", now);
            }
        } catch (RuntimeException e) {
            log.warn("Could not withdraw split-fill pack-size signals for items {} — the sale is unaffected",
                    continuedItemIds, e);
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

    /**
     * What this bill collected at the counter when it was raised, as opposed to what has
     * been paid against it since.
     *
     * <p>Checkout tenders are written carrying the invoice's own {@code createdAt}; any
     * later settlement is strictly after it. Several decisions turn on telling the two
     * apart — whether the bill created dues, and whether it can still be cancelled — so
     * the test lives in one place rather than being re-derived at each of them.
     */
    private static BigDecimal collectedAtCheckout(Invoice invoice, List<InvoicePayment> payments) {
        Instant raisedAt = invoice.getCreatedAt();
        if (raisedAt == null) return BigDecimal.ZERO;
        return payments.stream()
                .filter(p -> p.getPaidAt() != null && !p.getPaidAt().isAfter(raisedAt))
                .map(InvoicePayment::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    /** What a cashier calls this payment method, for messages they have to act on. */
    private static String label(PaymentMode mode) {
        return switch (mode) {
            case CASH -> "cash";
            case UPI -> "UPI";
            case CARD -> "card";
            case CREDIT -> "on-account";
            case WALLET -> "wallet";
            case ADVANCE -> "advance";
        };
    }

    /** One validated leg of a bill's settlement. */
    private record ResolvedTender(PaymentMode mode, BigDecimal amount, String reference) {
    }

    /**
     * How a bill is settled, after validation — the single place that decides what the
     * invoice's own paymentMode/paymentStatus columns say.
     *
     * @param settled      legs that moved money, each becoming an {@code invoice_payments} row.
     *                     Empty for a bill that stated no tenders, which is what keeps every
     *                     pre-split-tender bill accounted for exactly as before.
     * @param dominantMode the largest leg, or the declared mode when none were stated. A label
     *                     for filters and badges, no longer an accounting input: the money is
     *                     described by {@code settled}, which a single enum cannot do.
     * @param creditAmount what goes on the customer's account — the dues this sale creates.
     * @param paidAmount   what was collected at the counter, the sum of {@code settled}.
     * @param advanceAmount what was drawn from the customer's deposit. Part of
     *                      {@code settled} and of {@code paidAmount} — the bill really is
     *                      paid by it — but singled out here because it is the one settled
     *                      leg where no money arrives today, so it must move the ledger and
     *                      must stay out of the day's drawer.
     */
    private record TenderPlan(List<ResolvedTender> settled, PaymentMode dominantMode,
                              PaymentStatus status, BigDecimal creditAmount, BigDecimal paidAmount,
                              BigDecimal advanceAmount) {
    }

    /**
     * Validates a bill's tender breakdown and derives what the invoice should record.
     *
     * <p>A bill that states no tenders keeps its declared mode and status verbatim and
     * writes no payment rows — the behaviour every bill had before split tender, and the
     * behaviour any client that predates it still gets.
     *
     * <p>When tenders ARE stated the status is DERIVED, never taken from the request.
     * Letting a caller name both independently is what allowed a bill to be marked PENDING
     * while its payment mode said CASH: the customer requirement, the credit-limit check
     * and the ledger posting were all keyed off the mode, so the debt was recorded against
     * nobody. Here a bill is unpaid exactly to the extent it carries a CREDIT leg.
     */
    private static TenderPlan resolveTenders(CreateInvoiceRequest req, BigDecimal finalTotal,
                                             PaymentMode declaredMode, PaymentStatus declaredStatus,
                                             boolean onCredit) {
        if (!req.hasTenders()) {
            BigDecimal credit = onCredit && finalTotal.compareTo(BigDecimal.ZERO) > 0 ? finalTotal : BigDecimal.ZERO;
            return new TenderPlan(List.of(), declaredMode, declaredStatus, credit, BigDecimal.ZERO, BigDecimal.ZERO);
        }
        if (finalTotal.compareTo(BigDecimal.ZERO) == 0) {
            throw new UnprocessableEntityException(
                    "This bill comes to Rs.0 — there is nothing to tender. Remove the payment split.");
        }

        List<ResolvedTender> settled = new ArrayList<>();
        Set<PaymentMode> seen = EnumSet.noneOf(PaymentMode.class);
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal credit = BigDecimal.ZERO;
        BigDecimal advance = BigDecimal.ZERO;
        PaymentMode dominant = null;
        BigDecimal dominantAmount = BigDecimal.ZERO;

        for (TenderRequest t : req.tendersOrEmpty()) {
            String rawMode = blankToNull(t.paymentMode());
            if (rawMode == null) {
                throw new UnprocessableEntityException(
                        "One of the payment splits does not say how it was paid. "
                        + "Give each split a payment method, or remove it.");
            }
            PaymentMode mode;
            try {
                mode = PaymentMode.valueOf(rawMode.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw new UnprocessableEntityException(
                        "\"" + rawMode + "\" is not a way this bill can be paid. "
                        + "Use Cash, UPI, Card, Credit, Wallet or Advance.");
            }
            if (t.amount() == null || t.amount().compareTo(BigDecimal.ZERO) <= 0) {
                throw new UnprocessableEntityException(
                        "The " + label(mode) + " split needs an amount greater than zero. "
                        + "Remove it if none of the bill was paid that way.");
            }
            // One leg per mode. Two separate CASH legs on one bill are the same rupees
            // counted twice as far as any report can tell, and they would make "the
            // largest leg" ambiguous for no gain the cashier asked for.
            if (!seen.add(mode)) {
                throw new UnprocessableEntityException(
                        "This bill has two " + label(mode) + " splits. Combine them into one.");
            }
            total = total.add(t.amount());
            if (mode == PaymentMode.CREDIT) {
                credit = t.amount();
            } else {
                // An ADVANCE leg settles the bill like any other — it becomes a payment
                // row and the bill is PAID to that extent — but it is tracked separately
                // too, because it is the one settled leg that moves a ledger balance
                // instead of a drawer.
                if (mode == PaymentMode.ADVANCE) {
                    advance = t.amount();
                }
                settled.add(new ResolvedTender(mode, t.amount(), blankToNull(t.reference())));
            }
            // First one wins a tie, so the order the cashier entered decides — stable,
            // and never a coin flip between two equal legs.
            if (t.amount().compareTo(dominantAmount) > 0) {
                dominantAmount = t.amount();
                dominant = mode;
            }
        }

        BigDecimal outstanding = finalTotal.subtract(total);
        if (outstanding.abs().compareTo(PAISA) > 0) {
            // Says which way it is out and by how much — "they add up to 900, the bill is
            // 1000" leaves the cashier to do the subtraction while a customer waits.
            throw new UnprocessableEntityException(outstanding.signum() > 0
                    ? "The payment splits are Rs." + outstanding.setScale(2, RoundingMode.HALF_UP)
                      + " short of the Rs." + finalTotal.setScale(2, RoundingMode.HALF_UP) + " bill."
                    : "The payment splits are Rs." + outstanding.negate().setScale(2, RoundingMode.HALF_UP)
                      + " more than the Rs." + finalTotal.setScale(2, RoundingMode.HALF_UP) + " bill.");
        }

        // The legs themselves, not finalTotal minus the credit leg. The two can differ by
        // the paisa of slack the sum check allows, and amountPaid is a cache of exactly
        // these payment rows — it has to equal what they add up to, not what it ought to.
        BigDecimal paid = settled.stream().map(ResolvedTender::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        PaymentStatus status;
        if (credit.compareTo(BigDecimal.ZERO) == 0) {
            status = PaymentStatus.PAID;
        } else if (paid.compareTo(BigDecimal.ZERO) > 0) {
            status = PaymentStatus.PARTIAL;
        } else {
            status = PaymentStatus.PENDING;
        }
        return new TenderPlan(List.copyOf(settled), dominant, status, credit, paid, advance);
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
                invoice.getReturnedAmount(), invoice.getAmountPaid(), invoice.balanceDue(),
                invoice.isInterstate(), invoice.getNotes(), invoice.isCancelled(),
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
