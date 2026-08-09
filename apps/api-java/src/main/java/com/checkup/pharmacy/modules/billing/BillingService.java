package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.concurrency.RetryOnConflict;
import com.checkup.pharmacy.common.enums.BatchStatus;
import com.checkup.pharmacy.common.enums.CustomerType;
import com.checkup.pharmacy.common.enums.InvoiceStatus;
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
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryMovement;
import com.checkup.pharmacy.modules.inventory.InventoryMovementRepository;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.inventory.StockReservation;
import com.checkup.pharmacy.modules.inventory.StockReservationRepository;
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
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository prescriptionItemRepository;
    private final UserRepository userRepository;
    private final DocumentSequenceService sequenceService;
    private final com.checkup.pharmacy.modules.audit.AuditService auditService;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    public BillingService(InvoiceRepository invoiceRepository, InvoiceItemRepository invoiceItemRepository,
                          InvoicePaymentRepository invoicePaymentRepository, SalesReturnRepository salesReturnRepository,
                          SalesReturnItemRepository salesReturnItemRepository, InventoryRepository inventoryRepository,
                          InventoryMovementRepository movementRepository, StockReservationRepository reservationRepository,
                          CustomerRepository customerRepository,
                          DoctorRepository doctorRepository, PharmacyRepository pharmacyRepository,
                          PharmacyMedicineOverrideRepository overrideRepository, PrescriptionRepository prescriptionRepository,
                          PrescriptionItemRepository prescriptionItemRepository,
                          UserRepository userRepository, DocumentSequenceService sequenceService,
                          com.checkup.pharmacy.modules.audit.AuditService auditService,
                          com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
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
        this.overrideRepository = overrideRepository;
        this.prescriptionRepository = prescriptionRepository;
        this.prescriptionItemRepository = prescriptionItemRepository;
        this.userRepository = userRepository;
        this.sequenceService = sequenceService;
        this.auditService = auditService;
        this.objectMapper = objectMapper;
    }

    // ── Dashboard stats + invoice settings ───────────────────────────────────

    private static final java.time.ZoneOffset IST = java.time.ZoneOffset.ofHoursMinutes(5, 30);

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

        boolean isInterstate = req.isInterstateOrDefault();
        if (pharmacy.getState() != null && !pharmacy.getState().isBlank()) {
            isInterstate = customer != null && customer.getState() != null && !customer.getState().isBlank()
                    && !customer.getState().equalsIgnoreCase(pharmacy.getState());
        }

        Doctor doctor = req.doctorId() != null && !req.doctorId().isBlank()
                ? doctorRepository.findByIdAndPharmacyId(req.doctorId(), pharmacyId).orElse(null)
                : null;

        // Schedule H/H1/X medicines require a prescription reference (Indian Drug Rules).
        List<String> controlled = new ArrayList<>();
        for (InvoiceItemRequest item : req.items()) {
            Inventory batch = batchMap.get(item.inventoryId());
            String schedule = batch.getMedicine() == null || batch.getMedicine().getSchedule() == null
                    ? null : batch.getMedicine().getSchedule().toUpperCase().trim();
            if (schedule != null && CONTROLLED_SCHEDULES.contains(schedule)) {
                controlled.add(batch.getMedicine().getName() + " (Schedule " + schedule + ")");
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
        Set<String> medicineIds = new HashSet<>();
        for (InvoiceItemRequest item : req.items()) {
            medicineIds.add(batchMap.get(item.inventoryId()).getMedicineId());
        }
        // Filtered in SQL, not in Java: this used to load every override the pharmacy
        // had ever set — thousands of rows on a customised catalogue — and discard all
        // but the few on this bill, on every single sale.
        Map<String, BigDecimal> gstOverrideByMedicineId = new HashMap<>();
        for (PharmacyMedicineOverride o : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(pharmacyId, medicineIds)) {
            if (o.getGstRate() != null) {
                gstOverrideByMedicineId.put(o.getMedicineId(), o.getGstRate());
            }
        }

        Instant now = Instant.now();
        record ResolvedLine(Inventory batch, InvoiceItemRequest req, BigDecimal gstRate, GstCalculator.MrpGstBreakdown gst,
                            BigDecimal rate, String location) {
        }
        List<ResolvedLine> lines = new ArrayList<>();
        List<GstCalculator.MrpLineInput> totalsInput = new ArrayList<>();

        for (InvoiceItemRequest item : req.items()) {
            Inventory batch = batchMap.get(item.inventoryId());
            if (batch.getMedicine() == null || !batch.getMedicine().isActive()) {
                throw new UnprocessableEntityException(
                        "Medicine \"" + (batch.getMedicine() == null ? "?" : batch.getMedicine().getName()) + "\" is inactive and cannot be billed");
            }
            if (batch.getStatus() != BatchStatus.ACTIVE) {
                throw new UnprocessableEntityException(
                        "Batch \"" + batch.getBatchNumber() + "\" of \"" + batch.getMedicine().getName() + "\" is " + batch.getStatus() + " and cannot be sold");
            }
            if (!batch.getExpiryDate().isAfter(now)) {
                throw new UnprocessableEntityException(
                        "Batch \"" + batch.getBatchNumber() + "\" of \"" + batch.getMedicine().getName() + "\" expired on " + batch.getExpiryDate());
            }

            BigDecimal gstRate = gstOverrideByMedicineId.getOrDefault(batch.getMedicineId(), batch.getMedicine().getGstRate());
            // The bill discount is folded into the LINE, so the stored per-line tax is
            // the tax actually charged — which is what the GSTR-1 HSN summary sums.
            GstCalculator.MrpGstBreakdown gst = GstCalculator.calcGstFromMrp(batch.getMrp(), item.quantity(),
                    item.discountOrZero(), gstRate, isInterstate, req.billDiscountPctOrZero());
            BigDecimal rate = GstCalculator.round2(batch.getMrp().multiply(
                    BigDecimal.ONE.subtract(item.discountOrZero().divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP))));
            String location = null; // shelf/rack location display is a Tier 2 inventory-list concern; not resolved here to avoid an extra join per line

            lines.add(new ResolvedLine(batch, item, gstRate, gst, rate, location));
            totalsInput.add(new GstCalculator.MrpLineInput(batch.getMrp(), item.quantity(), item.discountOrZero(), gstRate));
        }

        // The bill discount is already inside these totals — it reduced the taxable
        // value of every line — so it must NOT be subtracted again here. Deducting it
        // after the tax was the bug: GST was charged on the pre-discount value, the
        // pharmacy remitted tax on money it never took, and the invoice did not add up,
        // because taxable + GST came from before the discount and the total from after.
        GstCalculator.InvoiceTotals itemTotals =
                GstCalculator.calcInvoiceTotals(totalsInput, isInterstate, req.billDiscountPctOrZero());

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
        // Before, the gap between taxable+GST and the total was an unexplained lump —
        // the extra charges and the adjustment were never written down anywhere, so a
        // bill that used them could not be reconciled by anyone afterwards.
        BigDecimal roundOff = GstCalculator.round2(finalTotal.subtract(preRound));
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
                customer == null ? null : customer.getId(), customer == null ? null : customer.getName(),
                customer == null ? null : customer.getPhone(), doctor == null ? null : doctor.getId(),
                doctor == null ? req.doctorName() : doctor.getName(), doctor == null ? null : doctor.getRegistrationNo(),
                prescription == null ? null : prescription.getId(), paymentMode, paymentStatus, isInterstate,
                combinedNotes.isBlank() ? null : combinedNotes, req.idempotencyKey(), itemTotals.subtotal(),
                discountAmount, itemTotals.taxableAmount(), itemTotals.cgst(), itemTotals.sgst(), itemTotals.igst(),
                itemTotals.totalGst(), finalTotal,
                req.extraChargesOrZero(), req.adjustmentAmountOrZero(), roundOff);
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
            int quantityBefore = batch.getQuantity();
            // Only stock held by OTHER sessions reduces what this sale may take. Our
            // own hold is released a few lines below as part of this same transaction,
            // so counting it here would mean a till competing with itself.
            int ownReserved = ownReservedByInventoryId.getOrDefault(batch.getId(), 0);
            int reservedByOthers = Math.max(0, batch.getReservedQuantity() - ownReserved);
            int available = quantityBefore - reservedByOthers;
            if (dispensed > available) {
                String reservedNote = reservedByOthers > 0
                        ? " (" + reservedByOthers + " reserved by another billing session)" : "";
                String freeNote = freeQty > 0 ? " (" + quantity + " + " + freeQty + " free)" : "";
                throw new ConflictException("Insufficient stock for \"" + batch.getMedicine().getName() + "\": "
                        + Math.max(0, available) + " available" + reservedNote + ", " + dispensed + " requested" + freeNote);
            }
            batch.setQuantity(quantityBefore - dispensed);

            InvoiceItem item = InvoiceItem.create(pharmacyId, invoice.getId(), batch.getId(), batch.getMedicine().getName(),
                    batch.getMedicine().getHsnCode(), batch.getBatchNumber(), batch.getExpiryDate(), quantity, freeQty,
                    batch.getMrp(),
                    line.rate(), batch.getPurchaseRate(), line.req().discountOrZero(), line.gstRate(), line.gst().cgst(),
                    line.gst().sgst(), line.gst().igst(), line.gst().taxableAmount(), line.gst().amount(), line.location());
            invoiceItemRepository.save(item);
            savedItems.add(item);

            // Records the DISPENSED total, not the charged quantity — the ledger has to
            // reconcile against the batch decrement above, and a physical stock count
            // reflects goods handed over regardless of what was billed for them.
            movementRepository.save(InventoryMovement.record(pharmacyId, batch.getId(), userId, MovementType.SALE,
                    MovementDirection.OUT, dispensed, quantityBefore, quantityBefore - dispensed, "INVOICE", invoice.getId(),
                    freeQty > 0 ? quantity + " sold + " + freeQty + " free" : null));
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
            // Collapse the invoice to medicine -> units, which is the granularity a
            // prescription is written at. Two batches of the same medicine on one bill
            // are one dispensing event as far as the prescription is concerned.
            Map<String, Integer> dispensedByMedicineId = new HashMap<>();
            for (ResolvedLine line : lines) {
                dispensedByMedicineId.merge(line.batch().getMedicineId(), line.req().quantity(), Integer::sum);
            }
            recordDispensing(prescription, dispensedByMedicineId);
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

        // Ordered by (medicineId, expiryDate) — putIfAbsent therefore keeps the
        // earliest-expiring batch per medicine, which is what FEFO means.
        Map<String, Inventory> fefoByMedicineId = new HashMap<>();
        if (!medicineIdByBatchId.isEmpty()) {
            for (Inventory candidate : inventoryRepository.findFefoCandidatesForMedicines(
                    pharmacyId, new HashSet<>(medicineIdByBatchId.values()), now, 1)) {
                fefoByMedicineId.putIfAbsent(candidate.getMedicineId(), candidate);
            }
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
            int available = batch.getQuantity() - batch.getReservedQuantity();
            int requested = original.getQuantity();
            int quantity = Math.min(available, requested);
            var medicine = batch.getMedicine();
            items.add(new RepeatCartResponse.Item(batch.getId(), medicine.getName(), medicine.getHsnCode(),
                    medicine.getSchedule(), medicine.getPackSize(), batch.getLocation(), batch.getBatchNumber(),
                    batch.getExpiryDate(), batch.getMrp(), medicine.getGstRate(), original.getDiscount(),
                    quantity, available, requested, available < requested));
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
            int before = inv.getQuantity();
            inv.setQuantity(before + restored);
            movementRepository.save(InventoryMovement.record(pharmacyId, inv.getId(), userId, MovementType.ADJUSTMENT,
                    MovementDirection.IN, restored, before, before + restored, "INVOICE_CANCEL",
                    invoice.getId(), item.getFreeQty() > 0
                            ? "Cancellation: " + reason + " (" + item.getQuantity() + " sold + " + item.getFreeQty() + " free)"
                            : "Cancellation: " + reason));
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
            ReturnDisposition disposition = parseDisposition(ri.dispositionOrDefault());

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
    private void recordDispensing(Prescription prescription, Map<String, Integer> dispensedByMedicineId) {
        List<PrescriptionItem> items = prescriptionItemRepository.findByPrescriptionId(prescription.getId());

        for (PrescriptionItem item : items) {
            if (item.getMedicineId() == null) {
                continue;
            }
            Integer units = dispensedByMedicineId.get(item.getMedicineId());
            if (units != null) {
                item.recordDispensed(units);
            }
        }

        boolean everythingCollected = !items.isEmpty()
                && items.stream().allMatch(PrescriptionItem::isFullyDispensed);
        if (everythingCollected) {
            prescription.markDispensed();
        } else {
            prescription.markPartiallyDispensed();
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
                        i.getBatchNumber(), i.getExpiryDate(), i.getQuantity(), i.getFreeQty(),
                        i.getMrp(), i.getRate(), i.getPurchaseRate(),
                        i.getDiscount(), i.getGstRate(), i.getCgst(), i.getSgst(), i.getIgst(), i.getTaxableAmount(),
                        i.getAmount(), i.getLocation()))
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
                invoice.getCancelledAt(), invoice.getCancelReason(), itemResponses, paymentResponses, returnRefs,
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
