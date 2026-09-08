package com.checkup.pharmacy.modules.dispensing.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * "Given these medicines and how many pieces of each I need, which batches do I
 * dispense from and how?" — the request for {@code POST /api/v1/dispensing/plan}.
 *
 * <p>Quantities are always PIECE counts ("12 tablets"), never packs — the engine
 * decides pack vs. loose vs. round-up.
 */
public record DispensingPlanRequest(
        @NotEmpty(message = "at least one line is required")
        @Size(max = 100, message = "a dispensing plan is capped at 100 lines per request")
        @Valid List<Line> lines
) {
    public record Line(
            /** Catalogue medicine id — set this OR {@code localMedicineId}, not both. */
            String medicineId,
            /** This pharmacy's own not-yet-catalogued medicine (see PharmacyMedicine). */
            String localMedicineId,
            @Positive(message = "requiredPieces must be greater than zero")
            int requiredPieces,
            /** H / H1 / X — only X changes behaviour (blocks loose). Optional. */
            String schedule
    ) {
    }
}
