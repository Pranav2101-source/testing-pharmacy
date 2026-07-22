package com.checkup.pharmacy.modules.location;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ShelfRepository extends JpaRepository<Shelf, String> {

    @Query("""
            SELECT s FROM Shelf s
            WHERE s.pharmacyId = :pharmacyId
              AND (:includeInactive = true OR s.isActive = true)
            """)
    Page<Shelf> list(@Param("pharmacyId") String pharmacyId,
                     @Param("includeInactive") boolean includeInactive,
                     Pageable pageable);

    Optional<Shelf> findByIdAndPharmacyId(String id, String pharmacyId);

    boolean existsByPharmacyIdAndCode(String pharmacyId, String code);

    boolean existsByPharmacyIdAndCodeAndIdNot(String pharmacyId, String code, String id);

    List<Shelf> findByRackIdInAndPharmacyId(List<String> rackIds, String pharmacyId);

    List<Shelf> findByRackIdAndPharmacyId(String rackId, String pharmacyId);
}
