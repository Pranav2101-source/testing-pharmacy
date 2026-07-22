package com.checkup.pharmacy.modules.prescription.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CreatePrescriptionRequest(
        String doctorId,
        @NotBlank @Size(max = 200) String doctorName,
        @Size(max = 50) String doctorRegNo,
        @Size(max = 20) String doctorPhone,
        @NotBlank @Size(max = 200) String patientName,
        Integer patientAge,
        @Size(max = 20) String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        @Size(max = 500) String notes,
        @NotEmpty @Valid List<PrescriptionItemRequest> items,
        String uploadId
) {
}
