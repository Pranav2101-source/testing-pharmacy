package com.checkup.pharmacy.modules.inventory;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface StockReservationRepository extends JpaRepository<StockReservation, String> {

    List<StockReservation> findByPharmacyIdAndSessionId(String pharmacyId, String sessionId);

    List<StockReservation> findByPharmacyIdAndExpiresAtBefore(String pharmacyId, Instant now);

    void deleteByPharmacyIdAndSessionId(String pharmacyId, String sessionId);

    List<StockReservation> findByPharmacyIdAndInventoryIdIn(String pharmacyId, List<String> inventoryIds);

    /**
     * Reservations on these batches that are still LIVE at {@code now}.
     *
     * <p>Exists because {@code Inventory.reservedQuantity} is a denormalised counter
     * that still includes holds whose TTL has passed — they are only subtracted when
     * something sweeps them, and the sweeper runs on a cron. Deciding whether a sale
     * may proceed from that counter therefore refuses sales against stock that is
     * already free, for as long as the gap between expiry and the next sweep.
     *
     * <p>Tenant-scoped, like every finder on an owned entity (the build guard enforces
     * it): this feeds an availability decision, and reading another pharmacy's holds
     * would block a sale here for a reservation made somewhere else entirely.
     */
    List<StockReservation> findByPharmacyIdAndInventoryIdInAndExpiresAtAfter(
            String pharmacyId, Collection<String> inventoryIds, Instant now);
}
