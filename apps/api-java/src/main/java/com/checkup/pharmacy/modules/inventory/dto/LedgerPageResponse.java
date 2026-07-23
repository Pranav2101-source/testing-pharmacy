package com.checkup.pharmacy.modules.inventory.dto;

import java.time.Instant;
import java.util.List;

/**
 * Stock-ledger page.
 *
 * <p>Each entry nests {@code inventory.medicine} and {@code user} rather than exposing a
 * flat {@code batchNumber}/{@code userId}: the ledger UI (LedgerTab.tsx) reads
 * {@code e.inventory.medicine.name}, {@code e.inventory.batchNumber} and {@code e.user.name}
 * directly. The Java rewrite originally returned the flat shape with only ids and no medicine
 * name at all, so every ledger row rendered "—" for Medicine/Batch/User — and because the page
 * field was {@code items} while the frontend read {@code movements}, the tab showed "No
 * movements yet" even when the ledger had entries.
 */
public record LedgerPageResponse(List<Entry> items, long total, int page, int limit) {

    public record Entry(
            String id,
            String inventoryId,
            String type,
            String direction,
            int quantity,
            int quantityBefore,
            int quantityAfter,
            String referenceType,
            String referenceId,
            String notes,
            InventoryRef inventory,
            UserRef user,
            Instant createdAt
    ) {
    }

    /** Null only if the movement's batch was hard-deleted (the FK makes that rare). */
    public record InventoryRef(String batchNumber, MedicineRef medicine) {
    }

    public record MedicineRef(String name, String genericName) {
    }

    public record UserRef(String id, String name) {
    }
}
