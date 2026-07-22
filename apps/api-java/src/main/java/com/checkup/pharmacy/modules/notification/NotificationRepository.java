package com.checkup.pharmacy.modules.notification;

import com.checkup.pharmacy.common.enums.NotificationStatus;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface NotificationRepository extends JpaRepository<NotificationLog, String> {

    List<NotificationLog> findByPharmacyIdOrderByCreatedAtDesc(String pharmacyId, Limit limit);

    long countByPharmacyIdAndIsReadFalse(String pharmacyId);

    List<NotificationLog> findByPharmacyIdAndStatusOrderByCreatedAtDesc(
            String pharmacyId, NotificationStatus status, Limit limit);

    Optional<NotificationLog> findByIdAndPharmacyId(String id, String pharmacyId);

    @Modifying
    @Query("UPDATE NotificationLog n SET n.isRead = true WHERE n.pharmacyId = :pharmacyId AND n.isRead = false")
    void markAllRead(@Param("pharmacyId") String pharmacyId);
}
