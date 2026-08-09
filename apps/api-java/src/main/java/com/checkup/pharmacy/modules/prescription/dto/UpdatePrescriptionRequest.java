package com.checkup.pharmacy.modules.prescription.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;
import com.checkup.pharmacy.common.validation.ProfessionalName;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** All fields optional (PATCH semantics) — a field left out means "leave unchanged". */
public record UpdatePrescriptionRequest(
        String doctorId,
        @ProfessionalName String doctorName,
        @Size(max = 50) String doctorRegNo,
        @ProfessionalName String patientName,
        Integer patientAge,
        @IndianMobile String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        @Size(max = 500) String notes,
        @Valid List<PrescriptionItemRequest> items
) {
}
