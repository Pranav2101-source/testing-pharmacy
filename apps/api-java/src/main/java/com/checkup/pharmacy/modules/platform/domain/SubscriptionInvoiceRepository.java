package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.enums.InvoicePaymentStatus;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface SubscriptionInvoiceRepository extends JpaRepository<SubscriptionInvoice, String> {

    List<SubscriptionInvoice> findBySubscriptionIdOrderByCreatedAtDesc(String subscriptionId);

    @Query("SELECT i FROM SubscriptionInvoice i WHERE i.subscriptionId = :subscriptionId ORDER BY i.createdAt DESC")
    List<SubscriptionInvoice> findBySubscriptionId(@Param("subscriptionId") String subscriptionId, Limit limit);

    /** Newest-first invoices across a set of subscriptions — the list view reads each one's latest status. */
    List<SubscriptionInvoice> findBySubscriptionIdInOrderByCreatedAtDesc(Collection<String> subscriptionIds);

    long countByStatus(InvoicePaymentStatus status);

    @Query("SELECT COALESCE(SUM(i.total), 0) FROM SubscriptionInvoice i WHERE CAST(i.status AS string) = 'PAID' AND i.paidAt >= :from")
    double sumPaidTotalSince(@Param("from") Instant from);

    @Query("SELECT COALESCE(SUM(i.total), 0) FROM SubscriptionInvoice i WHERE CAST(i.status AS string) IN ('PENDING', 'OVERDUE')")
    double sumOutstanding();

    @Query("""
            SELECT COALESCE(SUM(i.total), 0) FROM SubscriptionInvoice i
            WHERE i.subscriptionId = :subscriptionId AND CAST(i.status AS string) IN ('PENDING', 'OVERDUE')
            """)
    double sumOutstandingForSubscription(@Param("subscriptionId") String subscriptionId);

    /** (total, paidAt) for PAID invoices since a cutoff — MRR trend chart. */
    @Query("SELECT i.total, i.paidAt FROM SubscriptionInvoice i WHERE CAST(i.status AS string) = 'PAID' AND i.paidAt >= :from")
    List<Object[]> findPaidTotalsSince(@Param("from") Instant from);
}
