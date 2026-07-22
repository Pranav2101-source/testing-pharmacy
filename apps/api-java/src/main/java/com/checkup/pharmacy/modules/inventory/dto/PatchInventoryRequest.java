package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

/**
 * Merged PATCH /:id body — one endpoint handles stock adjustment, batch-status
 * change, and shelf/location placement. Each operation is optional but at least
 * one must be present; the service enforces that (and the OWNER/MANAGER role gate
 * for adjust/status) since Bean Validation can't express "at least one of N
 * optional fields" cleanly across nested + sibling fields together.
 */
public record PatchInventoryRequest(
        @Valid Adjust adjust,
        String status,
        @Size(max = 500) String statusReason,
        String shelfId,
        @Size(max = 100) String location
) {
    public record Adjust(
            @jakarta.validation.constraints.NotNull Integer delta,
            @jakarta.validation.constraints.NotBlank @Size(max = 500) String reason,
            String type
    ) {
    }

    public boolean isEmpty() {
        return adjust == null && status == null && shelfId == null && location == null;
    }
}
