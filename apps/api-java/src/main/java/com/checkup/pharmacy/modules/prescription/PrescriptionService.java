package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.PackSizeConfidence;
import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.BaseUnits;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.common.util.DispensePlausibility;
import com.checkup.pharmacy.common.util.PackUnits;
import com.checkup.pharmacy.modules.doctor.Doctor;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.integration.emr.PrescriptionCancelledEvent;
import com.checkup.pharmacy.modules.inventory.Inventory;
import com.checkup.pharmacy.modules.inventory.InventoryRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverride;
import com.checkup.pharmacy.modules.medicine.PharmacyMedicineOverrideRepository;
import com.checkup.pharmacy.modules.prescription.dto.CreatePrescriptionRequest;
import com.checkup.pharmacy.modules.prescription.dto.NewPrescriptionCountResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionItemRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionPageResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionStockResponse;
import com.checkup.pharmacy.modules.prescription.dto.UpdatePrescriptionRequest;
import com.checkup.pharmacy.modules.upload.UploadRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Structured prescriptions, scoped to the caller's pharmacy — required before
 * dispensing Schedule H/H1/X medicines (see BillingService's controlled-
 * substance check, which validates status is ACTIVE or PARTIAL before letting
 * an invoice reference a prescriptionId).
 */
@Service
public class PrescriptionService {

    /**
     * Mirrors {@code MedicineService.LOW_STOCK_QTY}: the same absolute-units threshold, so a
     * pharmacist reads the same "low stock" colour here as on the billing alternatives drawer.
     * Duplicated rather than shared across the module boundary — same call as
     * {@code EmrIntegrationService} independently querying {@link InventoryRepository} for its
     * own stock preview rather than depending on the medicine module for it.
     */
    private static final int LOW_STOCK_QTY = 10;

    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository itemRepository;
    private final DoctorRepository doctorRepository;
    private final UploadRepository uploadRepository;
    private final MedicineRepository medicineRepository;
    private final PharmacyMedicineOverrideRepository overrideRepository;
    private final InventoryRepository inventoryRepository;
    private final DocumentSequenceService sequenceService;
    private final ApplicationEventPublisher eventPublisher;

    public PrescriptionService(PrescriptionRepository prescriptionRepository, PrescriptionItemRepository itemRepository,
                               DoctorRepository doctorRepository, UploadRepository uploadRepository,
                               MedicineRepository medicineRepository,
                               PharmacyMedicineOverrideRepository overrideRepository,
                               InventoryRepository inventoryRepository,
                               DocumentSequenceService sequenceService,
                               ApplicationEventPublisher eventPublisher) {
        this.prescriptionRepository = prescriptionRepository;
        this.itemRepository = itemRepository;
        this.doctorRepository = doctorRepository;
        this.uploadRepository = uploadRepository;
        this.medicineRepository = medicineRepository;
        this.overrideRepository = overrideRepository;
        this.inventoryRepository = inventoryRepository;
        this.sequenceService = sequenceService;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public PrescriptionResponse create(CreatePrescriptionRequest req) {
        String pharmacyId = TenantContext.pharmacyId();
        Doctor doctor = null;
        if (req.doctorId() != null && !req.doctorId().isBlank()) {
            doctor = doctorRepository.findByIdAndPharmacyId(req.doctorId(), pharmacyId)
                    .filter(Doctor::isActive)
                    .orElseThrow(() -> new NotFoundException("Doctor not found or inactive"));
        }
        String uploadId = null;
        if (req.uploadId() != null && !req.uploadId().isBlank()) {
            uploadId = uploadRepository.findByIdAndPharmacyId(req.uploadId(), pharmacyId)
                    .orElseThrow(() -> new NotFoundException("Upload not found"))
                    .getId();
        }

        int seq = sequenceService.next(pharmacyId, DocumentSequenceService.PRESCRIPTION, DocumentSequenceService.PERIOD_ALL);
        Prescription rx = Prescription.create(pharmacyId, DocumentNumberFormat.prescription(seq),
                doctor == null ? null : doctor.getId(), req.doctorName(), req.doctorRegNo(), req.doctorPhone(),
                ValidationPatterns.normalizeName(req.patientName()), req.patientAge(),
                ValidationPatterns.normalizeMobile(req.patientPhone()), req.patientGender(), req.prescribedDate(),
                req.validUntil(), req.notes(), uploadId);
        prescriptionRepository.save(rx);

        List<PrescriptionItem> items = req.items().stream()
                .map(i -> PrescriptionItem.create(pharmacyId, rx.getId(), i.medicineName(), i.medicineId(), i.schedule(),
                        i.quantity(), i.dosage(), i.duration(), i.notes()))
                .toList();
        itemRepository.saveAll(items);

        return toResponse(rx, doctor, items);
    }

    @Transactional(readOnly = true)
    public PrescriptionResponse getById(String id) {
        Prescription rx = load(id);
        return toResponse(rx, rx.getDoctor(), itemRepository.findByPrescriptionId(id));
    }

    /**
     * Live stock for every catalogue-linked line on this prescription, for the triage
     * screen's stock-check step.
     *
     * <p>One batched {@link InventoryRepository} query for the whole prescription rather than
     * a FEFO lookup per line ({@link com.checkup.pharmacy.modules.prescription.PrescriptionItem}
     * lines are typically few, but this is a preview rendered on every triage open, not a
     * one-off conversion — see {@code prescriptionToCart.ts} on the frontend for why THAT path
     * stays sequential-per-line instead of reusing this). Unmatched lines (no medicineId yet)
     * are omitted — there is nothing to check stock for until a pharmacist links one.
     *
     * <p>{@code Inventory.quantity} and {@code reservedQuantity} are both PACK counts —
     * {@code quantity - reservedQuantity} alone is a pack-level number. A prescribed line's own
     * quantity (calculated or clinic-stated) is always a PIECE count, so this converts every
     * batch's unreserved packs to pieces via the medicine's {@code unitsPerPack} and adds its
     * loose remainder before summing, exactly as {@code MedicineService.StockSummary} already
     * does for the billing combobox — comparing a piece-based prescription quantity against a
     * raw pack count would misreport a fully-stocked medicine as "low" or "out of stock" for no
     * reason other than a unit mismatch.
     */
    @Transactional(readOnly = true)
    public PrescriptionStockResponse stockCheck(String id) {
        Prescription rx = load(id);
        List<PrescriptionItem> items = itemRepository.findByPrescriptionId(id);

        List<String> medicineIds = items.stream()
                .map(PrescriptionItem::getMedicineId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<String, List<Inventory>> batchesByMedicine = medicineIds.isEmpty()
                ? Map.of()
                : inventoryRepository.findActiveNonExpiredByMedicineIdIn(rx.getPharmacyId(), medicineIds, Instant.now())
                        .stream().collect(Collectors.groupingBy(Inventory::getMedicineId));
        // The pack multiple is per-pharmacy first, catalogue second — the shared catalogue is
        // platform-admin-owned, so an override row is the only way this pharmacy can have
        // classified its own pack size. Reading Medicine.unitsPerPack directly here reported
        // an overridden medicine's stock in PACKS while the billing cart reported the same
        // shelf in PIECES (1050 vs 10500 for a 10-per-pack strip).
        Map<String, PharmacyMedicineOverride> overridesByMedicineId = medicineIds.isEmpty()
                ? Map.of()
                : overrideRepository.findByIdPharmacyIdAndIdMedicineIdIn(rx.getPharmacyId(), medicineIds).stream()
                        .collect(Collectors.toMap(PharmacyMedicineOverride::getMedicineId, o -> o));
        Map<String, Medicine> medicinesById = medicineIds.isEmpty()
                ? Map.of()
                : medicineRepository.findAllById(medicineIds).stream()
                        .collect(Collectors.toMap(Medicine::getId, m -> m));

        List<PrescriptionStockResponse.Item> result = items.stream()
                .filter(i -> i.getMedicineId() != null)
                .map(i -> {
                    Medicine medicine = medicinesById.get(i.getMedicineId());
                    int unitsPerPack = PharmacyMedicineOverride.effectivePackMultiple(
                            overridesByMedicineId.get(i.getMedicineId()), medicine);
                    int available = batchesByMedicine.getOrDefault(i.getMedicineId(), List.of()).stream()
                            .mapToInt(b -> Math.max(0, b.getQuantity() - b.getReservedQuantity()) * unitsPerPack
                                    + b.getLooseUnits())
                            .sum();
                    String status = available == 0 ? "out_of_stock"
                            : available <= LOW_STOCK_QTY ? "low_stock" : "in_stock";
                    // Resolved server-side through the same BaseUnits the dispensing engine uses,
                    // so the triage screen and the billing cart never infer a different unit for
                    // the same medicine.
                    String baseUnit = medicine == null ? null
                            : BaseUnits.resolve(medicine.getBaseUnit(), medicine.getForm());
                    String unit = medicine == null ? null : medicine.getUnit();

                    // Project the mL→pack conversion the dispensing engine is ABOUT to perform,
                    // from today's catalogue rather than from what this line stored at ingest.
                    // The nullable form of the pack multiple, deliberately: NULL means nobody has
                    // classified this pack, which is not the same as 1 and must not be projected
                    // against. See PrescriptionStockResponse.Item for why this is computed live.
                    //
                    // A line a PHARMACIST has already settled by hand (confirmQuantity, on a line
                    // that had been held for no pack size on record) is excluded outright: it
                    // stores its confirmed PACK COUNT as quantity, not a base-unit volume, which
                    // is the one shape where quantity == roundedPackCount. Projecting against it
                    // anyway divides a bottle count by a bottle size and calls the answer ml — the
                    // reported case was "3 ml ÷ 50 ml/bottle → 1 bottle" beside a correct, already
                    // pharmacist-confirmed "3 bottles". Nothing to project: the pharmacist already
                    // gave the real answer, and no live catalogue read second-guesses it.
                    PharmacyMedicineOverride override = overridesByMedicineId.get(i.getMedicineId());
                    boolean pharmacistSettled = i.getClinicalUom() != null && i.getRoundedPackCount() != null
                            && i.getRoundedPackCount() == i.getQuantity();
                    Integer effectivePackSize = medicine == null || pharmacistSettled ? null
                            : PharmacyMedicineOverride.effectiveUnitsPerPack(override, medicine);
                    Integer projectedPackCount = null;
                    String packCountWarning = null;
                    int remaining = i.getQuantity() - i.getDispensedQty();
                    // The clinic's own clinical ask, not the rounded-up target this line was
                    // settled to — but only while nothing has been dispensed yet, which is
                    // exactly when "remaining" and "the whole clinical ask" are the same claim.
                    // Without this, an already-resolved line (quantity = roundedPackCount ×
                    // packSize, e.g. 200 ml for a 150 ml prescription rounded to two 100 ml
                    // bottles) showed the ROUNDED total as though the clinic had asked for it —
                    // "200 ml ÷ 100 ml/bottle" beside a "Prescribed: 150 ml" line one row up. The
                    // pack COUNT this produces is unchanged either way (quantity is an exact
                    // multiple of the pack size by construction), only the number shown here.
                    // Once dispensing has started, or with no clinical figure recorded (a line
                    // resolved before ever seeing this medicine classified, where quantity already
                    // IS the raw clinical figure), fall back to the base-unit remaining as before.
                    BigDecimal prescribedClinical = i.getPrescribedVolumeClinical();
                    int displayVolume = i.getDispensedQty() == 0 && prescribedClinical != null
                            ? prescribedClinical.intValue()
                            : remaining;
                    if (medicine != null && !pharmacistSettled && PackUnits.isMeasured(baseUnit)
                            && effectivePackSize != null && effectivePackSize > 0 && displayVolume > 0) {
                        projectedPackCount = (int) Math.ceil((double) displayVolume / effectivePackSize);
                        packCountWarning = DispensePlausibility.implausiblePackCount(
                                medicine.getName(), medicine.getForm(), baseUnit, unit,
                                projectedPackCount, displayVolume, effectivePackSize);
                    }
                    // Reported only for a MEASURED line. Every countable medicine in the catalogue
                    // is UNVERIFIED too, and it matters far less there: a wrong strip count is off
                    // by a few tablets and a pharmacist counting them notices, while a wrong bottle
                    // volume is off by a factor and nothing between here and the till disagrees.
                    // Sending it for tablets as well would put a chip on nearly every triage line
                    // and teach people to stop seeing it.
                    //
                    // The trust state of the number effectivePackSize above divides by — this
                    // pharmacy's own confirmation first — not the catalogue row's. Reporting the
                    // catalogue's meant a pharmacist who followed the chip and confirmed the bottle
                    // came back to the same chip, because their check lives on the override.
                    PackSizeConfidence confidence = medicine != null && PackUnits.isMeasured(baseUnit)
                            ? PharmacyMedicineOverride.effectivePackSizeConfidence(override, medicine)
                            : null;
                    String packSizeConfidence = confidence == null ? null : confidence.name();
                    return new PrescriptionStockResponse.Item(i.getId(), i.getMedicineId(), available, status,
                            baseUnit, unit, effectivePackSize, projectedPackCount, packCountWarning,
                            packSizeConfidence);
                })
                .toList();
        return new PrescriptionStockResponse(result);
    }

    @Transactional(readOnly = true)
    public PrescriptionPageResponse list(String status, String doctorId, String search, Instant from, Instant to,
                                         int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        Page<Prescription> result = prescriptionRepository.search(TenantContext.pharmacyId(), blankToNull(status),
                blankToNull(doctorId), DateRange.from(from), DateRange.to(to), blankToNull(search),
                PageRequest.of(safePage - 1, safeLimit));

        // Three batched lookups instead of three per row. This page was 1 + 3N queries:
        // the items, the upload, and a lazy doctor load for every prescription on it —
        // roughly 300 round trips at a 100-row page. The doctor is now fetch-joined by
        // the query above; the other two are collected here.
        List<Prescription> rows = result.getContent();
        List<String> prescriptionIds = rows.stream().map(Prescription::getId).toList();

        String pharmacyId = TenantContext.pharmacyId();
        Map<String, List<PrescriptionItem>> itemsByPrescriptionId = prescriptionIds.isEmpty()
                ? Map.of()
                : itemRepository.findByPharmacyIdAndPrescriptionIdIn(pharmacyId, prescriptionIds).stream()
                        .collect(Collectors.groupingBy(PrescriptionItem::getPrescriptionId));

        List<String> uploadIds = rows.stream()
                .map(Prescription::getUploadId).filter(Objects::nonNull).distinct().toList();
        Map<String, PrescriptionResponse.UploadRef> uploadsById = new HashMap<>();
        if (!uploadIds.isEmpty()) {
            uploadRepository.findByIdInAndPharmacyId(uploadIds, pharmacyId).forEach(u -> uploadsById.put(u.getId(),
                    new PrescriptionResponse.UploadRef(u.getId(), u.getFileName(), u.getMimeType(), u.getFileUrl())));
        }

        // One suggestion query for the WHOLE page, not one per prescription. Naively
        // computing this inside the per-row toResponse below would reproduce exactly the
        // N+1 the batched lookups above already exist to avoid — a 100-row page with
        // unmatched lines scattered across a dozen prescriptions would otherwise cost a
        // dozen trigram queries instead of one.
        Map<String, List<PrescriptionResponse.Suggestion>> suggestionsByItemId =
                suggestionsFor(itemsByPrescriptionId.values().stream().flatMap(List::stream).toList());

        List<PrescriptionResponse> items = rows.stream()
                .map(rx -> toResponse(rx, rx.getDoctor(),
                        itemsByPrescriptionId.getOrDefault(rx.getId(), List.of()),
                        rx.getUploadId() == null ? null : uploadsById.get(rx.getUploadId()),
                        suggestionsByItemId))
                .toList();
        return new PrescriptionPageResponse(items, result.getTotalElements(), safePage, safeLimit);
    }

    /** Nav badge: how many clinic-sourced prescriptions nobody at this pharmacy has opened yet. */
    @Transactional(readOnly = true)
    public NewPrescriptionCountResponse newCount() {
        long count = prescriptionRepository
                .countByPharmacyIdAndExternalEmrPrescriptionIdIsNotNullAndViewedAtIsNull(TenantContext.pharmacyId());
        return new NewPrescriptionCountResponse(count);
    }

    /**
     * Marks a prescription as opened, so it stops counting toward the nav badge.
     *
     * <p>A dedicated action rather than a side effect of {@link #getById}: the frontend
     * already has the row's data from the list it clicked on and never calls
     * {@code getById} to open it, and folding a write into a read-only getter would be a
     * surprising place to look for one. No-op on a counter-written prescription — nothing
     * ever counted one of those as unseen.
     */
    @Transactional
    public void markViewed(String id) {
        Prescription rx = load(id);
        if (!rx.isFromEmr()) {
            return;
        }
        rx.markViewed();
    }

    @Transactional
    public PrescriptionResponse update(String id, UpdatePrescriptionRequest req) {
        Prescription rx = load(id);
        if (rx.getStatus() == PrescriptionStatus.CANCELLED) {
            throw new ConflictException("Cannot update a cancelled prescription");
        }
        if (rx.getStatus() == PrescriptionStatus.DISPENSED) {
            throw new ConflictException("Cannot update a dispensed prescription");
        }

        Doctor doctor = rx.getDoctor();
        if (req.doctorId() != null && !req.doctorId().isBlank()) {
            doctor = doctorRepository.findByIdAndPharmacyId(req.doctorId(), rx.getPharmacyId())
                    .filter(Doctor::isActive)
                    .orElseThrow(() -> new NotFoundException("Doctor not found or inactive"));
        }

        // normalize* preserve null, which PATCH relies on to mean "leave unchanged".
        rx.applyFields(doctor == null ? null : doctor.getId(), req.doctorName(), req.doctorRegNo(),
                ValidationPatterns.normalizeName(req.patientName()), req.patientAge(),
                ValidationPatterns.normalizeMobile(req.patientPhone()), req.patientGender(),
                req.prescribedDate(), req.validUntil(), req.notes());

        List<PrescriptionItem> items;
        if (req.items() != null) {
            List<PrescriptionItem> existing = itemRepository.findByPrescriptionId(id);
            // The edit form resubmits the whole line list with no item ids (see BillHeader's
            // "Edit Prescription"), so there is no per-line match to preserve dispensedQty
            // across a delete/recreate. Once any line has been sold against, that recreate
            // would silently zero it back out — the prescription still reads PARTIAL/DISPENSED
            // but every counter agrees nothing was ever handed over. No FK stops this: billing
            // tracks dispensing purely on prescription_items, which this would just replace.
            if (existing.stream().anyMatch(i -> i.getDispensedQty() > 0)) {
                throw new ConflictException("Cannot change medicines on a prescription that has already been "
                        + "dispensed against — cancel and create a new one instead");
            }
            itemRepository.deleteByPrescriptionId(id);
            items = req.items().stream()
                    .map(i -> PrescriptionItem.create(rx.getPharmacyId(), id, i.medicineName(), i.medicineId(),
                            i.schedule(), i.quantity(), i.dosage(), i.duration(), i.notes()))
                    .toList();
            itemRepository.saveAll(items);
        } else {
            items = itemRepository.findByPrescriptionId(id);
        }

        return toResponse(rx, doctor, items);
    }

    /**
     * Cancels a prescription — from the counter, from an open draft ("discard"), or from a
     * clinic-sourced one. Only the last of those owes anyone else anything: withdrawing a
     * counter-written prescription, or a draft nobody outside this pharmacy ever saw, is
     * purely a local write, same as before this method knew about EMRs at all.
     *
     * <p>{@code markCancelNotifyPending} + the published event follow the exact pattern
     * billing uses to queue a dispense callback (see {@code BillingService}) — reset the
     * attempt budget, publish AFTER_COMMIT so a cancellation that then rolls back never
     * tells a clinic anything, and let {@link com.checkup.pharmacy.modules.integration.emr.EmrCancelCallbackListener}
     * do the actual delivery off this thread.
     */
    @Transactional
    public PrescriptionResponse cancel(String id) {
        Prescription rx = load(id);
        if (rx.getStatus() == PrescriptionStatus.DISPENSED) {
            throw new ConflictException("Cannot cancel a dispensed prescription");
        }
        if (rx.getStatus() == PrescriptionStatus.CANCELLED) {
            throw new ConflictException("Prescription is already cancelled");
        }
        boolean notifyClinic = rx.isFromEmr();
        rx.cancel();
        if (notifyClinic) {
            rx.markCancelNotifyPending();
            eventPublisher.publishEvent(new PrescriptionCancelledEvent(rx.getPharmacyId(), rx.getId(),
                    rx.getPrescriptionNumber(), rx.getExternalEmrTenantId(), rx.getExternalEmrPrescriptionId(),
                    Instant.now()));
        }
        return toResponse(rx, rx.getDoctor(), itemRepository.findByPrescriptionId(id));
    }

    /**
     * Brings this prescription's measured lines back in step with the catalogue, for the lines
     * where that is safe. Idempotent: a second call changes nothing.
     *
     * <p>A line is resolved to a pack target once, at ingest, and never again — see
     * {@code PrescriptionItem.resolveMeasuredEmrQuantity}, which refuses to second-guess a
     * settled quantity. The catalogue underneath it is not fixed, though: a medicine that was
     * unclassified when a prescription arrived can be given a base unit and a real pack volume
     * the next day, and every open line for it then carries a number whose MEANING has changed
     * without the number itself moving. The dispensing engine reads today's catalogue; the line
     * remembers a classification that no longer exists. Nothing reconciles the two.
     *
     * <p>Called when the triage screen opens, so a pharmacist sees the corrected conversion
     * rather than the stale one — and never as a side effect of a list render or a poll: this
     * writes, and {@code stockCheck} deliberately does not.
     *
     * <h2>Invariants</h2>
     * Rewriting somebody's prescription is only safe when nobody can have acted on it yet:
     * <ul>
     *   <li>the prescription is still <b>ACTIVE</b> — a PARTIAL one has a handover behind it,
     *       and DISPENSED / CANCELLED are finished records, not working documents;</li>
     *   <li>the line has <b>dispensedQty == 0</b>;</li>
     *   <li>the line is from the <b>EMR</b>, and its classification has <b>actually changed</b>
     *       — both enforced by {@code PrescriptionItem.reResolveMeasuredEmrQuantity}.</li>
     * </ul>
     *
     * @return the prescription as it now stands, re-resolved lines included
     */
    @Transactional
    public PrescriptionResponse reResolveStaleMeasuredLines(String id) {
        Prescription rx = load(id);
        List<PrescriptionItem> items = itemRepository.findByPrescriptionId(id);
        if (rx.getStatus() != PrescriptionStatus.ACTIVE) {
            return toResponse(rx, rx.getDoctor(), items);
        }

        List<String> medicineIds = items.stream()
                .map(PrescriptionItem::getMedicineId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (medicineIds.isEmpty()) {
            return toResponse(rx, rx.getDoctor(), items);
        }
        // Batched, like every other multi-line read on this service — one query for the
        // medicines and one for the overrides, never one per line.
        Map<String, Medicine> medicinesById = medicineRepository.findAllById(medicineIds).stream()
                .collect(Collectors.toMap(Medicine::getId, m -> m));
        Map<String, PharmacyMedicineOverride> overridesByMedicineId = overrideRepository
                .findByIdPharmacyIdAndIdMedicineIdIn(rx.getPharmacyId(), medicineIds).stream()
                .collect(Collectors.toMap(PharmacyMedicineOverride::getMedicineId, o -> o));

        List<PrescriptionItem> changed = new ArrayList<>();
        for (PrescriptionItem item : items) {
            Medicine medicine = item.getMedicineId() == null ? null : medicinesById.get(item.getMedicineId());
            if (medicine == null) {
                continue;
            }
            // The NULLABLE pack multiple: null means nobody has classified this pack, which is
            // not the same as 1 and must not be resolved against.
            Integer effectivePackSize = PharmacyMedicineOverride.effectiveUnitsPerPack(
                    overridesByMedicineId.get(item.getMedicineId()), medicine);
            if (item.reResolveMeasuredEmrQuantity(medicine, effectivePackSize)) {
                changed.add(item);
            }
        }
        if (!changed.isEmpty()) {
            itemRepository.saveAll(changed);
        }
        return toResponse(rx, rx.getDoctor(), items);
    }

    private Prescription load(String id) {
        return prescriptionRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Prescription not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /** Single-row path: resolves the upload itself, and batches its own suggestions. */
    private PrescriptionResponse toResponse(Prescription rx, Doctor doctor, List<PrescriptionItem> items) {
        PrescriptionResponse.UploadRef uploadRef = rx.getUploadId() == null ? null
                : uploadRepository.findById(rx.getUploadId())
                        .map(u -> new PrescriptionResponse.UploadRef(u.getId(), u.getFileName(), u.getMimeType(), u.getFileUrl()))
                        .orElse(null);
        return toResponse(rx, doctor, items, uploadRef, suggestionsFor(items));
    }

    /** List path: the caller has already resolved items, upload and suggestions in bulk. */
    private PrescriptionResponse toResponse(Prescription rx, Doctor doctor, List<PrescriptionItem> items,
                                            PrescriptionResponse.UploadRef uploadRef,
                                            Map<String, List<PrescriptionResponse.Suggestion>> suggestionsByItemId) {
        PrescriptionResponse.DoctorRef doctorRef = doctor == null ? null
                : new PrescriptionResponse.DoctorRef(doctor.getId(), doctor.getName(), doctor.getRegistrationNo());
        List<PrescriptionResponse.Item> itemResponses = items.stream()
                .map(i -> new PrescriptionResponse.Item(i.getId(), i.getMedicineName(), i.getMedicineId(), i.getSchedule(),
                        i.getQuantity(), i.getDispensedQty(), i.getDosage(), i.getDuration(), i.getNotes(),
                        i.getDispensedMedicineName(), i.isSubstituted(), i.isQuantityAutoCalculated(),
                        i.getQuantityCalculationNote(), i.getPrescribedVolumeClinical(), i.getClinicalUom(),
                        i.getRoundedPackCount(), suggestionsByItemId.getOrDefault(i.getId(), List.of())))
                .toList();

        // A line needs a human when the EMR's medicine name did not match the catalogue, OR
        // when the clinic sent no usable quantity (ingested as a zero placeholder rather than
        // rejected — see PrescriptionItem.needsQuantityConfirmation). Both only ever arise
        // from machine ingest, and both leave the line unable to be attributed to anything
        // sold until a pharmacist resolves it — one line can need both at once, and still
        // only counts once here.
        int needsReview = (int) items.stream()
                .filter(i -> i.getMedicineId() == null || i.needsQuantityConfirmation())
                .count();

        return new PrescriptionResponse(rx.getId(), rx.getPrescriptionNumber(), doctorRef, rx.getDoctorName(),
                rx.getDoctorRegNo(), rx.getDoctorPhone(), rx.getPatientName(), rx.getPatientAge(), rx.getPatientPhone(),
                rx.getPatientGender(), rx.getPrescribedDate(), rx.getValidUntil(), rx.getStatus().name(), rx.getNotes(),
                itemResponses, uploadRef, rx.getExternalEmrTenantId(), needsReview, dispenseNotify(rx), cancelNotify(rx),
                rx.getCreatedAt(), rx.getUpdatedAt());
    }

    /** Suggestions are shown only to a human, never applied automatically — see PrescriptionResponse.Suggestion. */
    private static final int SUGGESTIONS_PER_ITEM = 3;

    /**
     * Batched near-name candidates for every unmatched line in {@code items}, in one query
     * regardless of how many lines or how many distinct names they carry.
     *
     * <p>Keyed by item id rather than by name: two lines can share a name (a doctor
     * prescribing the same medicine twice, at different doses on different lines) and each
     * needs its own suggestions in the response, even though they share one query term.
     */
    private Map<String, List<PrescriptionResponse.Suggestion>> suggestionsFor(List<PrescriptionItem> items) {
        List<PrescriptionItem> unmatched = items.stream().filter(i -> i.getMedicineId() == null).toList();
        if (unmatched.isEmpty()) {
            return Map.of();
        }

        String[] terms = unmatched.stream()
                .map(i -> i.getMedicineName().trim().toLowerCase(Locale.ROOT))
                .distinct()
                .toArray(String[]::new);

        Map<String, List<PrescriptionResponse.Suggestion>> byTerm = medicineRepository
                .findSimilarByNames(terms, SUGGESTIONS_PER_ITEM).stream()
                .collect(Collectors.groupingBy(
                        row -> row.getTerm().toLowerCase(Locale.ROOT),
                        Collectors.mapping(row -> new PrescriptionResponse.Suggestion(row.getId(), row.getName(),
                                row.getGenericName(), row.getStrength(), row.getForm(), row.getSimilarity()),
                                Collectors.toList())));

        Map<String, List<PrescriptionResponse.Suggestion>> byItemId = new HashMap<>();
        for (PrescriptionItem item : unmatched) {
            byItemId.put(item.getId(),
                    byTerm.getOrDefault(item.getMedicineName().trim().toLowerCase(Locale.ROOT), List.of()));
        }
        return byItemId;
    }

    /**
     * The callback block, or null when there is nothing to report.
     *
     * <p>Keyed on the status having been set rather than on the prescription being from an
     * EMR: a clinic prescription nobody has billed against yet has nothing to say, and
     * showing "PENDING" against it would describe a delivery that was never owed.
     */
    private PrescriptionResponse.DispenseNotify dispenseNotify(Prescription rx) {
        String status = rx.getDispenseNotifyStatus();
        if (status == null) {
            return null;
        }
        // Retryable only when it has FAILED with nothing scheduled — i.e. the automatic
        // retries are finished. While an attempt is still pending the sweeper owns it.
        boolean canRetry = Prescription.NOTIFY_FAILED.equals(status)
                && rx.getDispenseNotifyNextAttemptAt() == null;
        return new PrescriptionResponse.DispenseNotify(status, rx.getDispenseNotifiedAt(),
                rx.getDispenseNotifyError(), rx.getDispenseNotifyAttempts(),
                rx.getDispenseNotifyNextAttemptAt(), canRetry);
    }

    /** The cancellation callback block, or null when nothing was ever owed. Mirrors {@link #dispenseNotify}. */
    private PrescriptionResponse.CancelNotify cancelNotify(Prescription rx) {
        String status = rx.getCancelNotifyStatus();
        if (status == null) {
            return null;
        }
        boolean canRetry = Prescription.NOTIFY_FAILED.equals(status)
                && rx.getCancelNotifyNextAttemptAt() == null;
        return new PrescriptionResponse.CancelNotify(status, rx.getCancelNotifiedAt(),
                rx.getCancelNotifyError(), rx.getCancelNotifyAttempts(),
                rx.getCancelNotifyNextAttemptAt(), canRetry);
    }

    /**
     * Links an unmatched line to a catalogue product.
     *
     * <p>Only lines the EMR sent can be unmatched, and only an unmatched line may be linked:
     * re-pointing a line that already resolved would rewrite what the doctor is recorded as
     * having ordered, which is not a correction a pharmacist gets to make from this screen.
     *
     * <p>Deliberately does not touch dispensedQty or the prescription's status. Linking says
     * "this is the product that was meant"; it does not assert anything was handed over.
     *
     * <p>If this line also still needs a quantity, linking is the moment its base unit first
     * becomes known — an unmatched line had no medicine to check it against during ingest, so
     * {@code needsQuantityConfirmation} was the only thing anyone could say about it. Now that a
     * medicine is attached, the same calculation ingest already runs for a matched line runs
     * here too (see {@link PrescriptionItem#calculateQuantityIfMissing}), so linking a Schedule-H
     * "Paracetamol 1-0-1 x 6 days" line does not ALSO require typing "12" into
     * {@code ConfirmQuantityPanel} right after — one pharmacist action resolves both gaps when
     * the dosage supports it, and leaves a specific note when it does not.
     *
     * <p>If the line instead already carries a clinic quantity and the linked medicine turns
     * out to be a measured (mL/g) product, that millilitre/gram figure is rounded up to whole
     * sealed packs when the pack size is known, or held for confirmation when it is not — same
     * reasoning as EMR ingest, see {@link PrescriptionItem#resolveMeasuredEmrQuantity}.
     */
    @Transactional
    public PrescriptionResponse linkItemToMedicine(String prescriptionId, String itemId, String medicineId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription rx = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Prescription not found"));

        PrescriptionItem item = itemRepository.findByPrescriptionId(prescriptionId).stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Prescription line not found"));

        if (item.getMedicineId() != null) {
            throw new BadRequestException("This line is already linked to a medicine");
        }
        // Scoped read: the id comes from a request body, so it is not trusted to be a
        // medicine this pharmacy can actually sell.
        Medicine medicine = medicineRepository.findById(medicineId)
                .orElseThrow(() -> new NotFoundException("Medicine not found"));

        item.linkMedicine(medicine.getId());
        item.calculateQuantityIfMissing(medicine);
        if (!item.needsQuantityConfirmation()) {
            Integer effectivePackSize = PharmacyMedicineOverride.effectiveUnitsPerPack(
                    overrideRepository.findByIdPharmacyIdAndIdMedicineId(pharmacyId, medicine.getId()).orElse(null),
                    medicine);
            item.resolveMeasuredEmrQuantity(medicine, effectivePackSize);
        }
        itemRepository.save(item);

        return getById(rx.getId());
    }

    /**
     * Settles the real quantity for a line the clinic sent with none — see
     * {@link PrescriptionItem#needsQuantityConfirmation()}. Only ever applies to a line
     * ingested with no usable quantity; a line that already has one cannot be re-quantified
     * from this screen, same restriction as {@link #linkItemToMedicine} on re-linking.
     */
    @Transactional
    public PrescriptionResponse confirmItemQuantity(String prescriptionId, String itemId, int quantity) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription rx = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Prescription not found"));

        PrescriptionItem item = itemRepository.findByPrescriptionId(prescriptionId).stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("Prescription line not found"));

        if (!item.needsQuantityConfirmation()) {
            throw new BadRequestException("This line's quantity is already confirmed");
        }
        // dispensedQty can only be nonzero here via an explicit-attribution sale (billing lets
        // a pharmacist attribute a sale to a specific line even before its quantity is
        // confirmed) — confirming below that would silently understate what was truthfully
        // recorded as handed over.
        if (quantity < item.getDispensedQty()) {
            throw new BadRequestException(
                    "Quantity cannot be less than the " + item.getDispensedQty() + " already dispensed against this line");
        }

        item.confirmQuantity(quantity);
        itemRepository.save(item);

        return getById(rx.getId());
    }

    /**
     * Queues another attempt at telling the clinic what was dispensed.
     *
     * <p>Offered only for a callback the automatic retries have given up on — the response's
     * {@code canRetry} says when. It queues rather than delivering inline, so the pharmacist's
     * click does not wait on someone else's server.
     */
    @Transactional
    public PrescriptionResponse retryDispenseNotify(String prescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription rx = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Prescription not found"));

        if (!rx.isFromEmr()) {
            throw new BadRequestException("This prescription did not come from a clinic");
        }
        if (rx.getDispenseNotifyStatus() == null) {
            throw new BadRequestException("Nothing has been dispensed against this prescription yet");
        }
        rx.requeueDispenseNotify();
        prescriptionRepository.save(rx);
        return getById(rx.getId());
    }

    /** Queues another attempt at telling the clinic a prescription was cancelled. Mirrors {@link #retryDispenseNotify}. */
    @Transactional
    public PrescriptionResponse retryCancelNotify(String prescriptionId) {
        String pharmacyId = TenantContext.pharmacyId();
        Prescription rx = prescriptionRepository.findByIdAndPharmacyId(prescriptionId, pharmacyId)
                .orElseThrow(() -> new NotFoundException("Prescription not found"));

        if (!rx.isFromEmr()) {
            throw new BadRequestException("This prescription did not come from a clinic");
        }
        if (rx.getCancelNotifyStatus() == null) {
            throw new BadRequestException("This prescription was never reported as cancelled to a clinic");
        }
        rx.requeueCancelNotify();
        prescriptionRepository.save(rx);
        return getById(rx.getId());
    }
}
