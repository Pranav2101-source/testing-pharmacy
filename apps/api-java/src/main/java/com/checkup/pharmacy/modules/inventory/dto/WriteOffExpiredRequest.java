package com.checkup.pharmacy.modules.inventory.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Which expired batches to take off the books, and why.
 *
 * <p>BATCHES ARE NAMED EXPLICITLY, never selected by a filter. A "write off everything older
 * than X" endpoint is one bad parameter away from destroying live stock, and this operation
 * cannot be undone — the quantity is gone and the batch is marked EXPIRED for good. The caller
 * lists exactly what it means, the server re-checks every id, and anything that is not actually
 * expired is refused rather than skipped.
 *
 * @param inventoryIds the batches to write off. Bounded so one request cannot sweep a whole
 *                     pharmacy in a single transaction; a bigger disposal is several requests
 * @param reason       required, and it lands on the stock movement. This is the audit trail an
 *                     inspector reads and the justification for a tax reversal, so "why" cannot
 *                     be optional
 */
public record WriteOffExpiredRequest(
        @NotEmpty(message = "Select at least one expired batch to write off")
        @Size(max = 200, message = "Write off at most 200 batches at a time")
        List<@NotBlank String> inventoryIds,

        @NotBlank(message = "A reason is required — it becomes the audit record for this write-off")
        @Size(max = 500)
        String reason
) {
}
