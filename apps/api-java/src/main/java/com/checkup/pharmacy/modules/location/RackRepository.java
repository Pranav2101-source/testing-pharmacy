package com.checkup.pharmacy.modules.location;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface RackRepository extends JpaRepository<Rack, String> {

    @Query("""
            SELECT r FROM Rack r
            WHERE r.pharmacyId = :pharmacyId
              AND (:includeInactive = true OR r.isActive = true)
            """)
    Page<Rack> list(@Param("pharmacyId") String pharmacyId,
                    @Param("includeInactive") boolean includeInactive,
                    Pageable pageable);

    Optional<Rack> findByIdAndPharmacyId(String id, String pharmacyId);

    boolean existsByPharmacyIdAndCode(String pharmacyId, String code);

    boolean existsByPharmacyIdAndCodeAndIdNot(String pharmacyId, String code, String id);
}
