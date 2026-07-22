package com.checkup.pharmacy.modules.inventory;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface StockReservationRepository extends JpaRepository<StockReservation, String> {

    List<StockReservation> findByPharmacyIdAndSessionId(String pharmacyId, String sessionId);

    List<StockReservation> findByPharmacyIdAndExpiresAtBefore(String pharmacyId, Instant now);

    void deleteByPharmacyIdAndSessionId(String pharmacyId, String sessionId);

    List<StockReservation> findByPharmacyIdAndInventoryIdIn(String pharmacyId, List<String> inventoryIds);
}
