package com.checkup.pharmacy.modules.audit;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AuditLogRepository extends JpaRepository<AuditLog, String> {

    /**
     * module/severity/status compared as text — see PurchaseOrderRepository.search
     * for why a null-typed enum parameter breaks Postgres's type inference.
     * from/to are unconditional; the caller resolves absent bounds via
     * {@code common.util.DateRange}.
     */
    @Query("""
            SELECT a FROM AuditLog a LEFT JOIN FETCH a.user LEFT JOIN FETCH a.pharmacy
            WHERE (:module IS NULL OR CAST(a.module AS string) = :module)
              AND (:action IS NULL OR a.action = :action)
              AND (:severity IS NULL OR CAST(a.severity AS string) = :severity)
              AND (:status IS NULL OR CAST(a.status AS string) = :status)
              AND a.createdAt >= :from AND a.createdAt <= :to
              AND (:search IS NULL
                   OR LOWER(COALESCE(a.resourceName, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(a.entityId, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(a.userEmail, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(a.user.name, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(COALESCE(a.pharmacy.name, '')) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY a.createdAt DESC
            """)
    Page<AuditLog> search(@Param("search") String search, @Param("module") String module,
                          @Param("action") String action, @Param("severity") String severity,
                          @Param("status") String status, @Param("from") Instant from, @Param("to") Instant to,
                          Pageable pageable);

    /** Capped at 50,000 rows (Pageable) — CSV export is loaded into memory, not truly streamed. */
    @Query("""
            SELECT a FROM AuditLog a LEFT JOIN FETCH a.user LEFT JOIN FETCH a.pharmacy
            WHERE (:module IS NULL OR CAST(a.module AS string) = :module)
              AND (:action IS NULL OR a.action = :action)
              AND a.createdAt >= :from AND a.createdAt <= :to
            ORDER BY a.id ASC
            """)
    List<AuditLog> findForExport(@Param("module") String module, @Param("action") String action,
                                 @Param("from") Instant from, @Param("to") Instant to, Pageable pageable);

    @Query("SELECT a FROM AuditLog a LEFT JOIN FETCH a.user LEFT JOIN FETCH a.pharmacy WHERE a.id = :id")
    Optional<AuditLog> findByIdWithRelations(@Param("id") String id);

    /** Recent activity for one tenant (platform tenant drawer). */
    @Query("""
            SELECT a FROM AuditLog a LEFT JOIN FETCH a.user
            WHERE a.pharmacyId = :pharmacyId
            ORDER BY a.createdAt DESC
            """)
    List<AuditLog> findByPharmacyIdWithUser(@Param("pharmacyId") String pharmacyId,
                                            org.springframework.data.domain.Limit limit);

    @Query("""
            SELECT a FROM AuditLog a
            WHERE a.entity = :entity AND a.entityId = :entityId
            ORDER BY a.createdAt ASC
            """)
    List<AuditLog> timeline(@Param("entity") String entity, @Param("entityId") String entityId,
                            org.springframework.data.domain.Limit limit);

    @Query("""
            SELECT COUNT(a) FROM AuditLog a
            WHERE (:module IS NULL OR CAST(a.module AS string) = :module)
              AND (:action IS NULL OR a.action = :action)
              AND (:severity IS NULL OR CAST(a.severity AS string) = :severity)
              AND (:status IS NULL OR CAST(a.status AS string) = :status)
              AND a.createdAt >= :from AND a.createdAt <= :to
            """)
    long countTotal(@Param("module") String module, @Param("action") String action,
                    @Param("severity") String severity, @Param("status") String status,
                    @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COUNT(a) FROM AuditLog a
            WHERE CAST(a.status AS string) = 'FAILED'
              AND (:module IS NULL OR CAST(a.module AS string) = :module)
              AND a.createdAt >= :from AND a.createdAt <= :to
            """)
    long countFailed(@Param("module") String module, @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COUNT(a) FROM AuditLog a
            WHERE CAST(a.severity AS string) IN ('WARNING', 'ERROR', 'CRITICAL')
              AND (:module IS NULL OR CAST(a.module AS string) = :module)
              AND a.createdAt >= :from AND a.createdAt <= :to
            """)
    long countSecurityAlerts(@Param("module") String module, @Param("from") Instant from, @Param("to") Instant to);

    @Query("""
            SELECT COUNT(a) FROM AuditLog a
            WHERE LOWER(a.action) LIKE '%login%'
              AND (:module IS NULL OR CAST(a.module AS string) = :module)
              AND a.createdAt >= :from AND a.createdAt <= :to
            """)
    long countLoginEvents(@Param("module") String module, @Param("from") Instant from, @Param("to") Instant to);
}
