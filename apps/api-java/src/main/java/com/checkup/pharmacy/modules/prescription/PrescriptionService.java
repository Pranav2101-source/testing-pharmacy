package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.exception.BadRequestException;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.validation.ValidationPatterns;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.doctor.Doctor;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
import com.checkup.pharmacy.modules.medicine.Medicine;
import com.checkup.pharmacy.modules.medicine.MedicineRepository;
import com.checkup.pharmacy.modules.prescription.dto.CreatePrescriptionRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionItemRequest;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionPageResponse;
import com.checkup.pharmacy.modules.prescription.dto.PrescriptionResponse;
import com.checkup.pharmacy.modules.prescription.dto.UpdatePrescriptionRequest;
import com.checkup.pharmacy.modules.upload.UploadRepository;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
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

    private final PrescriptionRepository prescriptionRepository;
    private final PrescriptionItemRepository itemRepository;
    private final DoctorRepository doctorRepository;
    private final UploadRepository uploadRepository;
    private final MedicineRepository medicineRepository;
    private final DocumentSequenceService sequenceService;

    public PrescriptionService(PrescriptionRepository prescriptionRepository, PrescriptionItemRepository itemRepository,
                               DoctorRepository doctorRepository, UploadRepository uploadRepository,
                               MedicineRepository medicineRepository,
                               DocumentSequenceService sequenceService) {
        this.prescriptionRepository = prescriptionRepository;
        this.itemRepository = itemRepository;
        this.doctorRepository = doctorRepository;
        this.uploadRepository = uploadRepository;
        this.medicineRepository = medicineRepository;
        this.sequenceService = sequenceService;
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

        List<PrescriptionResponse> items = rows.stream()
                .map(rx -> toResponse(rx, rx.getDoctor(),
                        itemsByPrescriptionId.getOrDefault(rx.getId(), List.of()),
                        rx.getUploadId() == null ? null : uploadsById.get(rx.getUploadId())))
                .toList();
        return new PrescriptionPageResponse(items, result.getTotalElements(), safePage, safeLimit);
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

    @Transactional
    public PrescriptionResponse cancel(String id) {
        Prescription rx = load(id);
        if (rx.getStatus() == PrescriptionStatus.DISPENSED) {
            throw new ConflictException("Cannot cancel a dispensed prescription");
        }
        if (rx.getStatus() == PrescriptionStatus.CANCELLED) {
            throw new ConflictException("Prescription is already cancelled");
        }
        rx.cancel();
        return toResponse(rx, rx.getDoctor(), itemRepository.findByPrescriptionId(id));
    }

    private Prescription load(String id) {
        return prescriptionRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Prescription not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /** Single-row path: resolves the upload itself. */
    private PrescriptionResponse toResponse(Prescription rx, Doctor doctor, List<PrescriptionItem> items) {
        PrescriptionResponse.UploadRef uploadRef = rx.getUploadId() == null ? null
                : uploadRepository.findById(rx.getUploadId())
                        .map(u -> new PrescriptionResponse.UploadRef(u.getId(), u.getFileName(), u.getMimeType(), u.getFileUrl()))
                        .orElse(null);
        return toResponse(rx, doctor, items, uploadRef);
    }

    /** List path: the caller has already resolved items and upload in bulk. */
    private PrescriptionResponse toResponse(Prescription rx, Doctor doctor, List<PrescriptionItem> items,
                                            PrescriptionResponse.UploadRef uploadRef) {
        PrescriptionResponse.DoctorRef doctorRef = doctor == null ? null
                : new PrescriptionResponse.DoctorRef(doctor.getId(), doctor.getName(), doctor.getRegistrationNo());
        List<PrescriptionResponse.Item> itemResponses = items.stream()
                .map(i -> new PrescriptionResponse.Item(i.getId(), i.getMedicineName(), i.getMedicineId(), i.getSchedule(),
                        i.getQuantity(), i.getDispensedQty(), i.getDosage(), i.getDuration(), i.getNotes(),
                        i.getDispensedMedicineName(), i.isSubstituted()))
                .toList();

        // A line needs a human when the EMR's medicine name did not match the catalogue.
        // It only ever arises from machine ingest — a pharmacist typing a prescription
        // resolves it by the act of typing it — and until it is resolved that line cannot
        // be attributed to anything sold, so the prescription can never close.
        int needsReview = (int) items.stream().filter(i -> i.getMedicineId() == null).count();

        return new PrescriptionResponse(rx.getId(), rx.getPrescriptionNumber(), doctorRef, rx.getDoctorName(),
                rx.getDoctorRegNo(), rx.getDoctorPhone(), rx.getPatientName(), rx.getPatientAge(), rx.getPatientPhone(),
                rx.getPatientGender(), rx.getPrescribedDate(), rx.getValidUntil(), rx.getStatus().name(), rx.getNotes(),
                itemResponses, uploadRef, rx.getExternalEmrTenantId(), needsReview, dispenseNotify(rx),
                rx.getCreatedAt(), rx.getUpdatedAt());
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

    /**
     * Links an unmatched line to a catalogue product.
     *
     * <p>Only lines the EMR sent can be unmatched, and only an unmatched line may be linked:
     * re-pointing a line that already resolved would rewrite what the doctor is recorded as
     * having ordered, which is not a correction a pharmacist gets to make from this screen.
     *
     * <p>Deliberately does not touch dispensedQty or the prescription's status. Linking says
     * "this is the product that was meant"; it does not assert anything was handed over.
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
}
