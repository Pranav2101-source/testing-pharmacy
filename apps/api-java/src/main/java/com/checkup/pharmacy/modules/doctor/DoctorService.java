package com.checkup.pharmacy.modules.doctor;

import com.checkup.pharmacy.common.exception.NotFoundException;
import com.checkup.pharmacy.common.util.StableSort;
import com.checkup.pharmacy.modules.doctor.dto.DoctorListResponse;
import com.checkup.pharmacy.modules.doctor.dto.DoctorRequest;
import com.checkup.pharmacy.modules.doctor.dto.DoctorResponse;
import com.checkup.pharmacy.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Doctor (referrer) master, scoped to the caller's pharmacy. */
@Service
public class DoctorService {

    private final DoctorRepository doctorRepository;
    private final com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard;

    public DoctorService(DoctorRepository doctorRepository,
                         com.checkup.pharmacy.common.idempotency.DuplicateSubmitGuard duplicateSubmitGuard) {
        this.doctorRepository = doctorRepository;
        this.duplicateSubmitGuard = duplicateSubmitGuard;
    }

    @Transactional(readOnly = true)
    public DoctorListResponse list(String search, int page, int limit) {
        int safePage = Math.max(page, 1);
        int safeLimit = Math.min(Math.max(limit, 1), 100);
        PageRequest pageRequest = PageRequest.of(safePage - 1, safeLimit, StableSort.of(Sort.by("name").ascending()));

        Page<Doctor> result = doctorRepository.search(
                TenantContext.pharmacyId(), blankToNull(search), pageRequest);

        var items = result.getContent().stream().map(this::toResponse).toList();
        return DoctorListResponse.of(items, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional
    public DoctorResponse create(DoctorRequest req) {
        duplicateSubmitGuard.guard("doctor.create", req);
        Doctor doctor = Doctor.create(TenantContext.pharmacyId(), req.name().trim());
        doctor.applyFields(req.name().trim(), req.registrationNo(), req.specialty(), req.clinic(),
                req.phone(), req.email(), req.address());
        doctorRepository.save(doctor);
        return toResponse(doctor);
    }

    @Transactional
    public DoctorResponse update(String id, DoctorRequest req) {
        Doctor doctor = load(id);
        doctor.applyFields(req.name().trim(), req.registrationNo(), req.specialty(), req.clinic(),
                req.phone(), req.email(), req.address());
        return toResponse(doctor);
    }

    @Transactional
    public DoctorResponse deactivate(String id) {
        Doctor doctor = load(id);
        doctor.deactivate();
        return toResponse(doctor);
    }

    @Transactional
    public DoctorResponse reactivate(String id) {
        Doctor doctor = load(id);
        doctor.activate();
        return toResponse(doctor);
    }

    private Doctor load(String id) {
        return doctorRepository.findByIdAndPharmacyId(id, TenantContext.pharmacyId())
                .orElseThrow(() -> new NotFoundException("Doctor not found"));
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private DoctorResponse toResponse(Doctor d) {
        return new DoctorResponse(d.getId(), d.getPharmacyId(), d.getName(), d.getRegistrationNo(),
                d.getSpecialty(), d.getClinic(), d.getPhone(), d.getEmail(), d.getAddress(),
                d.isActive(), d.getCreatedAt());
    }
}
