package com.checkup.pharmacy.modules.dispensing;

import com.checkup.pharmacy.common.enums.DispensingStrategy;
import com.checkup.pharmacy.modules.inventory.Inventory;

import java.time.Instant;
import java.util.Comparator;

/**
 * The one place batches of a single medicine get ordered for dispensing.
 *
 * <p>Both strategies operate only on batches that {@link DispensingService} has
 * already established are sellable (ACTIVE, in date, unreserved stock left) — this
 * decides nothing about eligibility, only the order among eligible batches.
 *
 * <p>Every comparator ends on {@code id} so the order is fully deterministic: two
 * batches received the same day with the same expiry still resolve in a stable,
 * reproducible sequence rather than however the database happened to return them.
 */
public final class BatchOrdering {

    private BatchOrdering() {
    }

    public static Comparator<Inventory> comparator(DispensingStrategy strategy) {
        return switch (strategy) {
            // FEFO: earliest valid expiry first, then oldest stock, then id.
            case LILA_FEFO -> Comparator
                    .comparing(BatchOrdering::expiry)
                    .thenComparing(BatchOrdering::created)
                    .thenComparing(Inventory::getId);
            // Newest received batch first, then latest expiry, then id.
            case LIFA -> Comparator
                    .comparing(BatchOrdering::created, Comparator.reverseOrder())
                    .thenComparing(BatchOrdering::expiry, Comparator.reverseOrder())
                    .thenComparing(Inventory::getId);
        };
    }

    private static Instant expiry(Inventory i) {
        return i.getExpiryDate() != null ? i.getExpiryDate() : Instant.MAX;
    }

    private static Instant created(Inventory i) {
        return i.getCreatedAt() != null ? i.getCreatedAt() : Instant.EPOCH;
    }
}
