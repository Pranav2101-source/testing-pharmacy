package com.checkup.pharmacy.modules.prescription.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** All fields optional (PATCH semantics) — a field left out means "leave unchanged". */
public record UpdatePrescriptionRequest(
        String doctorId,
        @Size(max = 200) String doctorName,
        @Size(max = 50) String doctorRegNo,
        @Size(max = 200) String patientName,
        Integer patientAge,
        @Size(max = 20) String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        @Size(max = 500) String notes,
        @Valid List<PrescriptionItemRequest> items
) {
}
