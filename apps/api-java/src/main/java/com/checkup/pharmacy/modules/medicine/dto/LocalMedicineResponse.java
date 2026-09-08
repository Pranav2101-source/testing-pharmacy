package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One pharmacy-local medicine, any status — the full directory view (unlike
 * {@link PendingLocalMedicineResponse}, which only ever lists {@code SUGGESTED} rows
 * awaiting review). Lets a pharmacist browse everything a GRN has ever received
 * outside the global catalogue, including a {@code KEPT_LOCAL} row the matcher found
 * no candidate for at all, and manually search-and-link or unlink any of them.
 */
public record LocalMedicineResponse(
        String id,
        String name,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String hsnCode,
        BigDecimal gstRate,
        String matchStatus,
        String linkedMedicineId,
        /** Populated only when {@code matchStatus} is {@code LINKED} and the target still exists. */
        String linkedMedicineName,
        /**
         * True when the live catalogue has more than one medicine tied on this row's exact
         * name (or generic+strength+form) — a duplicate in the catalogue itself, not merely
         * a plausible fuzzy guess. Computed fresh on every read, not persisted: it reflects
         * the catalogue as it stands right now, and a since-resolved catalogue duplicate stops
         * showing it without anyone having to touch this row.
         */
        boolean ambiguous,
        Instant createdAt,
        List<PendingLocalMedicineResponse.Suggestion> suggestions
) {
}
