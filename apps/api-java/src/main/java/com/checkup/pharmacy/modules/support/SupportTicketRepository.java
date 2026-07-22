package com.checkup.pharmacy.modules.support;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface SupportTicketRepository extends JpaRepository<SupportTicket, String> {

    @Query("""
            SELECT t FROM SupportTicket t
            LEFT JOIN FETCH t.category LEFT JOIN FETCH t.raisedBy LEFT JOIN FETCH t.pharmacy
            LEFT JOIN FETCH t.assignedAgent aa LEFT JOIN FETCH aa.user
            WHERE t.id = :id
            """)
    Optional<SupportTicket> findByIdWithRelations(@Param("id") String id);

    /**
     * Unified list query for all three callers (pharmacy user / support agent viewing
     * their own queue / platform admin viewing everything) — pharmacyId/assignedAgentId/
     * raisedById/status are each optional; the caller supplies whichever filters its
     * role allows. status compared as text — see PurchaseOrderRepository.search for why
     * a null-typed enum parameter breaks Postgres's type inference.
     */
    @Query("""
            SELECT t FROM SupportTicket t
            LEFT JOIN FETCH t.category LEFT JOIN FETCH t.raisedBy LEFT JOIN FETCH t.pharmacy
            LEFT JOIN FETCH t.assignedAgent aa LEFT JOIN FETCH aa.user
            WHERE (:pharmacyId IS NULL OR t.pharmacyId = :pharmacyId)
              AND (:assignedAgentId IS NULL OR t.assignedAgentId = :assignedAgentId)
              AND (:raisedById IS NULL OR t.raisedById = :raisedById)
              AND (:status IS NULL OR CAST(t.status AS string) = :status)
              AND (:search IS NULL
                   OR LOWER(t.ticketNumber) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(t.description) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%'))
                   OR LOWER(t.mobile) LIKE LOWER(CONCAT('%', CAST(:search AS string), '%')))
            ORDER BY t.createdAt DESC
            """)
    Page<SupportTicket> search(@Param("pharmacyId") String pharmacyId,
                               @Param("assignedAgentId") String assignedAgentId,
                               @Param("raisedById") String raisedById,
                               @Param("status") String status,
                               @Param("search") String search,
                               Pageable pageable);

    long countByStatusIn(java.util.Collection<com.checkup.pharmacy.common.enums.TicketStatus> statuses);

    long countByStatus(com.checkup.pharmacy.common.enums.TicketStatus status);

    long countByStatusInAndPriority(java.util.Collection<com.checkup.pharmacy.common.enums.TicketStatus> statuses,
                                    com.checkup.pharmacy.common.enums.TicketPriority priority);

    java.util.List<SupportTicket> findTop3ByOrderByCreatedAtDesc();

    long countByPharmacyId(String pharmacyId);
}
