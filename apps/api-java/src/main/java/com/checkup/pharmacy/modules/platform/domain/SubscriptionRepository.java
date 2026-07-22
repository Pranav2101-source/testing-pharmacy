package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SubscriptionRepository extends JpaRepository<Subscription, String> {

    Optional<Subscription> findByPharmacyId(String pharmacyId);

    List<Subscription> findByPharmacyIdIn(java.util.Collection<String> pharmacyIds);

    @Query("SELECT s FROM Subscription s LEFT JOIN FETCH s.pharmacy WHERE s.id = :id")
    Optional<Subscription> findByIdWithPharmacy(@Param("id") String id);

    long countByStatus(SubscriptionStatus status);

    /**
     * Active subscriptions with auto-renew switched on.
     *
     * <p>Added to replace a hardcoded {@code 85} that the analytics dashboard was
     * rendering as "Auto-renew %". The column has existed on {@code subscriptions}
     * all along ({@code autoRenew Boolean @default(true)}); nothing had ever queried
     * it, so the console displayed an invented figure that looked entirely credible.
     */
    long countByStatusAndAutoRenewTrue(SubscriptionStatus status);

    long countByStatusAndValidUntilBetween(SubscriptionStatus status, Instant from, Instant to);

    long countByValidUntilBetween(Instant from, Instant to);

    long countByStatusAndUpdatedAtGreaterThanEqual(SubscriptionStatus status, Instant since);

    /** (amount, billingCycle) for ACTIVE subscriptions — dashboard MRR. */
    @Query("SELECT s.amount, s.billingCycle FROM Subscription s WHERE CAST(s.status AS string) = 'ACTIVE'")
    List<Object[]> findActiveAmountsAndCycles();

    /** (amount, billingCycle) for ACTIVE+TRIAL subscriptions — subscription-stats MRR. */
    @Query("SELECT s.amount, s.billingCycle FROM Subscription s WHERE CAST(s.status AS string) IN ('ACTIVE', 'TRIAL')")
    List<Object[]> findActiveTrialAmountsAndCycles();

    /** (planName, count) over ACTIVE+TRIAL — plan-distribution chart. */
    @Query("""
            SELECT s.planName, COUNT(s) FROM Subscription s
            WHERE CAST(s.status AS string) IN ('ACTIVE', 'TRIAL')
            GROUP BY s.planName
            """)
    List<Object[]> planDistribution();

    /** (status, count) over all subscriptions — status-distribution chart. */
    @Query("SELECT CAST(s.status AS string), COUNT(s) FROM Subscription s GROUP BY s.status")
    List<Object[]> statusDistribution();
}
