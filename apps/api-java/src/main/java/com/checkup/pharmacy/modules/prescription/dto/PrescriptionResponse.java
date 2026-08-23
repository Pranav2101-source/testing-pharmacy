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
        /** Null unless this came from a clinic and a pharmacist has cancelled it. */
        CancelNotify cancelNotify,
        Instant createdAt,
        Instant updatedAt
) {
    public record DoctorRef(String id, String name, String registrationNo) {
    }

    /**
     * @param dispensedMedicineName what was actually handed over, when it differs from what
     *                              was prescribed. Null is the normal case.
     * @param suggestions near-name catalogue candidates for a line the matcher could not
     *                    link, closest first. Always empty when medicineId is already set —
     *                    a matched line has nothing left to suggest. Never auto-applied: see
     *                    {@link Suggestion}.
     */
    public record Item(String id, String medicineName, String medicineId, String schedule, int quantity,
                       int dispensedQty, String dosage, String duration, String notes,
                       String dispensedMedicineName, boolean substituted, List<Suggestion> suggestions) {
    }

    /**
     * One candidate a pharmacist can link with a click, instead of typing the search box
     * themselves — never a medicine the system attaches on its own.
     *
     * <p>Suggestion, not a match: the ingest matcher already had its chance at an exact
     * name/generic+strength/form match and passed on this line. What is offered here comes
     * from trigram similarity — genuinely useful (a misspelling, a missing dosage-form
     * suffix) but not the same certainty as an exact match, and a wrong click here is a
     * dispensing error. The pharmacist stays the one who decides; this only saves them
     * typing the name that is already right there in front of them.
     */
    public record Suggestion(String medicineId, String name, String genericName, String strength,
                             String form, double similarity) {
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

    /** The state of the cancellation report back to the clinic. Mirrors {@link DispenseNotify}. */
    public record CancelNotify(String status, Instant notifiedAt, String error,
                               int attempts, Instant nextAttemptAt, boolean canRetry) {
    }
}
