package com.checkup.pharmacy.modules.inventory;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BatchRecallRepository extends JpaRepository<BatchRecall, String> {

    @Query("""
            SELECT r FROM BatchRecall r
            WHERE r.pharmacyId = :pharmacyId
              AND (:batchNumber IS NULL OR LOWER(r.batchNumber) LIKE LOWER(CONCAT('%', CAST(:batchNumber AS string), '%')))
            ORDER BY r.recalledAt DESC
            """)
    Page<BatchRecall> search(@Param("pharmacyId") String pharmacyId,
                             @Param("batchNumber") String batchNumber,
                             Pageable pageable);
}
