package com.checkup.pharmacy.modules.platform.domain;

import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SubscriptionAuditLogRepository extends JpaRepository<SubscriptionAuditLog, String> {

    @Query("SELECT a FROM SubscriptionAuditLog a WHERE a.subscriptionId = :subscriptionId ORDER BY a.createdAt DESC")
    List<SubscriptionAuditLog> findBySubscriptionId(@Param("subscriptionId") String subscriptionId, Limit limit);
}
