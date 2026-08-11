package com.checkup.pharmacy.modules.prescription.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.PersonName;
import com.checkup.pharmacy.common.validation.ProfessionalName;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CreatePrescriptionRequest(
        String doctorId,
        // @ProfessionalName, not @PersonName: pharmacists routinely type qualifications
        // and specialities into this field ("Dr. Sharma (Ortho)"), so the brackets and
        // commas pass while digits — the actual defect — do not.
        @NotBlank(message = "Doctor name is required") @ProfessionalName String doctorName,
        @Size(max = 50) String doctorRegNo,
        @IndianMobile String doctorPhone,
        // @ProfessionalName, not @PersonName: a patient name here is transcribed off a
        // paper script, and "Ram Kumar (S/O Shyam)" is how a counter distinguishes two
        // patients with the same name. The wider rule still blocks what QA reported —
        // digits — while not rejecting an annotation the pharmacist meant to write.
        @NotBlank(message = "Patient name is required") @ProfessionalName String patientName,
        Integer patientAge,
        @IndianMobile String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        @Size(max = 500) String notes,
        @NotEmpty @Valid List<PrescriptionItemRequest> items,
        String uploadId
) {
}
