package com.checkup.pharmacy.modules.prescription.dto;

import java.time.Instant;
import java.util.List;

public record PrescriptionResponse(
        String id,
        String prescriptionNumber,
        DoctorRef doctor,
        String doctorName,
        String doctorRegNo,
        String doctorPhone,
        String patientName,
        Integer patientAge,
        String patientPhone,
        String patientGender,
        Instant prescribedDate,
        Instant validUntil,
        String status,
        String notes,
        List<Item> items,
        UploadRef upload,
        /** Null for a counter-written prescription; the clinic's tenant id otherwise. */
        String externalTenantId,
        /**
         * How many lines a pharmacist still has to deal with before this can be billed in
         * full — lines the EMR sent that the matcher could not link to the catalogue.
         *
         * <p>Sent on the list as well as on the record, because the entire point of it is to
         * be visible without opening anything.
         */
        int needsReview,
        /** Null unless this came from a clinic and a sale has queued a callback. */
        DispenseNotify dispenseNotify,
        Instant createdAt,
        Instant updatedAt
) {
    public record DoctorRef(String id, String name, String registrationNo) {
    }

    /**
     * @param dispensedMedicineName what was actually handed over, when it differs from what
     *                              was prescribed. Null is the normal case.
     */
    public record Item(String id, String medicineName, String medicineId, String schedule, int quantity,
                       int dispensedQty, String dosage, String duration, String notes,
                       String dispensedMedicineName, boolean substituted) {
    }

    public record UploadRef(String id, String fileName, String mimeType, String fileUrl) {
    }

    /**
     * The state of the report back to the clinic, in the terms a pharmacist reads it.
     *
     * @param canRetry true only when delivery has FAILED and nothing further is scheduled.
     *                 That is the single state a human can usefully act on: while a retry is
     *                 still scheduled the sweeper already has it in hand, and a button there
     *                 would invite someone to duplicate work that is happening anyway.
     *                 Deliberately computed on the server — a frontend deriving it from the
     *                 status alone is how "Failed" ends up looking actionable when it is
     *                 merely in progress.
     */
    public record DispenseNotify(String status, Instant notifiedAt, String error,
                                 int attempts, Instant nextAttemptAt, boolean canRetry) {
    }
}
