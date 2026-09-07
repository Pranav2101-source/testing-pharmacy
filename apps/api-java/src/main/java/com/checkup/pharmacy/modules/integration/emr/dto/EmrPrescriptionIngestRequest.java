package com.checkup.pharmacy.modules.integration.emr.dto;

import com.checkup.pharmacy.common.validation.IndianMobile;
import com.checkup.pharmacy.common.validation.ProfessionalName;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record EmrPrescriptionIngestRequest(
        @NotBlank @Size(max = 100) String externalTenantId,
        @NotBlank @Size(max = 100) String externalPrescriptionId,
        @Size(max = 100) String externalPrescriptionNumber,
        @NotBlank @ProfessionalName String doctorName,
        @Size(max = 50) String doctorRegNo,
        @IndianMobile String doctorPhone,
        @NotBlank @ProfessionalName String patientName,
        @Min(0) @Max(150) Integer patientAge,
        @IndianMobile String patientPhone,
        @Size(max = 30) String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        @Size(max = 500) String notes,
        @NotEmpty @Size(max = 100) @Valid List<Item> items
) {
    public record Item(
            @NotBlank @Size(max = 100) String externalItemId,
            @NotBlank @Size(max = 200) String medicineName,
            @Size(max = 100) String medicineId,
            @Size(max = 100) String strength,
            @Size(max = 20) String schedule,
            /**
             * Units prescribed, or 0 when the clinic states none ("as directed").
             *
             * <p>Zero is accepted rather than rejected because rejecting it fails the whole
             * prescription over one line's missing field, leaving a patient at the counter with
             * nothing — the same reasoning the compat surface already applied when it began
             * translating a missing quantity to 0 (see {@code ClinicIngestRequest.Item}). What
             * happens next is not a guess: the quantity is derived from the line's own dosing
             * pattern and duration where those establish it, and otherwise a pharmacist settles
             * it at the counter. Negative is still refused — it is not a statement about
             * anything.
             */
            @PositiveOrZero int quantity,
            @Size(max = 100) String dosage,
            @Size(max = 100) String duration,
            @Size(max = 200) String notes
    ) {
    }
}
