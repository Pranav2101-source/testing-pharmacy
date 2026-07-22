package com.checkup.pharmacy.modules.stockaudit;

import com.checkup.pharmacy.common.enums.AuditSessionStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockAuditSessionRepository extends JpaRepository<StockAuditSession, String> {

    Optional<StockAuditSession> findByIdAndPharmacyId(String id, String pharmacyId);

    /** Most recent session(s) in any of the given statuses — powers the dashboard-home "needs attention" card. */
    List<StockAuditSession> findByPharmacyIdAndStatusInOrderByCreatedAtDesc(
            String pharmacyId, Collection<AuditSessionStatus> statuses, Pageable pageable);

    /** APPROVED sessions ordered by when they were actually approved (not created) — powers both the
     *  dashboard's "last approved" card (limit 1) and the full audit-history report (unpaged). */
    List<StockAuditSession> findByPharmacyIdAndStatusOrderByApprovedAtDesc(
            String pharmacyId, AuditSessionStatus status, Pageable pageable);

    /** status compared as text — see InventoryRepository.search for the null-enum-parameter rationale. */
    @Query("""
            SELECT s FROM StockAuditSession s
            WHERE s.pharmacyId = :pharmacyId
              AND (:status IS NULL OR CAST(s.status AS string) = :status)
            ORDER BY s.createdAt DESC
            """)
    Page<StockAuditSession> search(@Param("pharmacyId") String pharmacyId, @Param("status") String status, Pageable pageable);
}
