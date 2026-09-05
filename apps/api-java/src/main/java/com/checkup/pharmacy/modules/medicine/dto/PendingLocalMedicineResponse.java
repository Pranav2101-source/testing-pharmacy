package com.checkup.pharmacy.modules.medicine.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One pharmacy-local medicine the background matcher could not confidently link —
 * only a fuzzy (similarity-score) candidate exists, so it needs a pharmacist to
 * confirm before it's ever linked. Never surfaced for {@code KEPT_LOCAL} (no
 * candidate at all) — there is nothing to review.
 */
public record PendingLocalMedicineResponse(
        String id,
        String name,
        String manufacturer,
        String genericName,
        String strength,
        String form,
        String hsnCode,
        BigDecimal gstRate,
        Instant createdAt,
        List<Suggestion> suggestions
) {
    public record Suggestion(String medicineId, String name, String genericName, String strength,
                             String form, double similarity) {
    }
}
