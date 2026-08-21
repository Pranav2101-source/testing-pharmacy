package com.checkup.pharmacy.modules.integration.emr.compat.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * A prescription as the clinic's client already sends it.
 *
 * <h2>Field names are a wire contract</h2>
 * These must match the clinic's serialised shape exactly. Renaming one to read better here
 * breaks ingestion with a 400 naming a field the other team cannot find in their code.
 *
 * <h2>Why the constraints here are looser than the native DTO's</h2>
 * The native {@code EmrPrescriptionIngestRequest} validates phone numbers as Indian mobiles
 * and names as professional names. Those are right for a form a person fills in; they are
 * wrong as a gate on a machine feed, because the consequence of failing them is different.
 * A prescription rejected because a doctor's phone was stored with a {@code +91-} prefix is
 * a patient standing at a counter while two engineering teams read logs — and the phone
 * number was never the point of the document.
 *
 * <p>So this layer is <b>strict about clinical content and forgiving about everything
 * else</b>: the medicines, quantities and identifiers are required and validated, while
 * cosmetic fields are sanitised on the way in and dropped if they cannot be made sense of.
 * What gets dropped is reported back, never silently discarded.
 *
 * @see ClinicIngestResponse
 */
public record ClinicIngestRequest(

        @NotBlank(message = "emrClinicId is required")
        @Size(max = 100, message = "emrClinicId is too long")
        String emrClinicId,

        @NotBlank(message = "emrPrescriptionId is required")
        @Size(max = 100, message = "emrPrescriptionId is too long")
        String emrPrescriptionId,

        @Size(max = 100) String prescriptionNumber,

        Instant prescribedDate,

        String notes,

        @Valid Patient patient,

        @Valid Doctor doctor,

        @NotEmpty(message = "A prescription must carry at least one medicine")
        @Size(max = 100, message = "A prescription may carry at most 100 medicines")
        @Valid List<Item> items
) {

    /** Only the name is required: it is what appears on the label the patient is handed. */
    public record Patient(
            String emrPatientId,
            @NotBlank(message = "Patient name is required") String name,
            Integer age,
            String phone,
            String gender,
            String abhaNumber
    ) {
    }

    /** Only the name is required: a dispensing record has to say who prescribed. */
    public record Doctor(
            String emrDoctorId,
            @NotBlank(message = "Doctor name is required") String name,
            String registrationNo,
            String phone,
            String specialty
    ) {
    }

    /**
     * One prescribed medicine.
     *
     * <p>{@code quantity} is a boxed Integer rather than an int deliberately. A clinic that
     * omits it — prescribing "as directed" — is a real case, and unboxing null would fail
     * the whole prescription with a NullPointerException rather than the one line it
     * concerns. Missing quantities are ingested as zero and counted in
     * {@link ClinicIngestResponse#unconfirmedQuantityCount} for a pharmacist to settle at
     * the counter, which is where that decision belongs anyway.
     */
    public record Item(
            @NotBlank(message = "emrItemId is required") @Size(max = 100) String emrItemId,
            @NotBlank(message = "medicineName is required") @Size(max = 200) String medicineName,
            String genericName,
            String strength,
            String dosageForm,
            String dosage,
            String frequency,
            String duration,
            Integer quantity,
            String route,
            String timing,
            String instructions
    ) {
    }
}
