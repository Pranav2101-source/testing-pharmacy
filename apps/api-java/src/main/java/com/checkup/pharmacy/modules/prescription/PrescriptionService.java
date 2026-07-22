package com.checkup.pharmacy.modules.prescription;

import com.checkup.pharmacy.common.enums.PrescriptionStatus;
import com.checkup.pharmacy.common.exception.ConflictException;
import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.exception.UnprocessableEntityException;
import com.checkup.pharmacy.common.sequence.DocumentNumberFormat;
import com.checkup.pharmacy.common.sequence.DocumentSequenceService;
import com.checkup.pharmacy.common.util.DateRange;
import com.checkup.pharmacy.modules.doctor.Doctor;
import com.checkup.pharmacy.modules.doctor.DoctorRepository;
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
import java.util.List;

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
    private final DocumentSequenceService sequenceService;

    public PrescriptionService(PrescriptionRepository prescriptionRepository, PrescriptionItemRepository itemRepository,
                               DoctorRepository doctorRepository, UploadRepository uploadRepository,
                               DocumentSequenceService sequenceService) {
        this.prescriptionRepository = prescriptionRepository;
        this.itemRepository = itemRepository;
        this.doctorRepository = doctorRepository;
        this.uploadRepository = uploadRepository;
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
                req.patientName(), req.patientAge(), req.patientPhone(), req.patientGender(), req.prescribedDate(),
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

        List<PrescriptionResponse> items = result.getContent().stream()
                .map(rx -> toResponse(rx, rx.getDoctor(), itemRepository.findByPrescriptionId(rx.getId())))
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

        rx.applyFields(doctor == null ? null : doctor.getId(), req.doctorName(), req.doctorRegNo(), req.patientName(),
                req.patientAge(), req.patientPhone(), req.patientGender(), req.prescribedDate(), req.validUntil(), req.notes());

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

    private PrescriptionResponse toResponse(Prescription rx, Doctor doctor, List<PrescriptionItem> items) {
        PrescriptionResponse.DoctorRef doctorRef = doctor == null ? null
                : new PrescriptionResponse.DoctorRef(doctor.getId(), doctor.getName(), doctor.getRegistrationNo());
        List<PrescriptionResponse.Item> itemResponses = items.stream()
                .map(i -> new PrescriptionResponse.Item(i.getId(), i.getMedicineName(), i.getMedicineId(), i.getSchedule(),
                        i.getQuantity(), i.getDispensedQty(), i.getDosage(), i.getDuration(), i.getNotes()))
                .toList();
        PrescriptionResponse.UploadRef uploadRef = rx.getUploadId() == null ? null
                : uploadRepository.findById(rx.getUploadId())
                        .map(u -> new PrescriptionResponse.UploadRef(u.getId(), u.getFileName(), u.getMimeType(), u.getFileUrl()))
                        .orElse(null);
        return new PrescriptionResponse(rx.getId(), rx.getPrescriptionNumber(), doctorRef, rx.getDoctorName(),
                rx.getDoctorRegNo(), rx.getDoctorPhone(), rx.getPatientName(), rx.getPatientAge(), rx.getPatientPhone(),
                rx.getPatientGender(), rx.getPrescribedDate(), rx.getValidUntil(), rx.getStatus().name(), rx.getNotes(),
                itemResponses, uploadRef, rx.getCreatedAt(), rx.getUpdatedAt());
    }
}
