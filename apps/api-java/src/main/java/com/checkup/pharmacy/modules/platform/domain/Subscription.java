package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.SubscriptionStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.pharmacy.Pharmacy;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * A pharmacy's platform subscription (table "subscriptions"), 1:1 with a
 * {@link Pharmacy}. Managed only from the platform-admin module.
 *
 * Money-carrying fields ({@code amount}, {@code discount}, {@code creditBalance})
 * are {@code Double}/{@code double}, not {@link java.math.BigDecimal}: the Prisma
 * model declares them as {@code Float} (Postgres {@code double precision}), unlike
 * the invoice/billing tables which use {@code Decimal}. Mapping BigDecimal onto a
 * float8 column would risk a JDBC type mismatch during writes, so we mirror the
 * real column type. Values are whole-rupee plan prices, not per-line tax math.
 */
@Entity
@Table(name = "subscriptions")
public class Subscription extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "planName")
    private String planName = "Free";

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private SubscriptionStatus status = SubscriptionStatus.ACTIVE;

    @Column(name = "billingCycle")
    private String billingCycle = "MONTHLY";

    @Column(name = "amount")
    private Double amount;

    @Column(name = "autoRenew")
    private boolean autoRenew = true;

    @Column(name = "validUntil")
    private Instant validUntil;

    @Column(name = "trialEndsAt")
    private Instant trialEndsAt;

    @Column(name = "pausedAt")
    private Instant pausedAt;

    @Column(name = "cancelledAt")
    private Instant cancelledAt;

    @Column(name = "discount")
    private double discount = 0;

    @Column(name = "couponCode")
    private String couponCode;

    @Column(name = "creditBalance")
    private double creditBalance = 0;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pharmacyId", insertable = false, updatable = false)
    private Pharmacy pharmacy;

    protected Subscription() {
        // Required by JPA.
    }

    /** Creates a subscription for a pharmacy with the given plan + validity window. */
    public static Subscription create(String pharmacyId, String planName, SubscriptionStatus status,
                                      String billingCycle, Double amount, Instant validUntil) {
        Subscription s = new Subscription();
        s.assignId(Cuid.generate());
        s.pharmacyId = pharmacyId;
        s.planName = planName == null ? "Free" : planName;
        s.status = status == null ? SubscriptionStatus.ACTIVE : status;
        s.billingCycle = billingCycle == null ? "MONTHLY" : billingCycle;
        s.amount = amount;
        s.validUntil = validUntil;
        s.autoRenew = true;
        return s;
    }

    // ── Behaviour ─────────────────────────────────────────────────────────────

    public void changePlan(String planName, String billingCycle, Double amount) {
        this.planName = planName;
        if (billingCycle != null) {
            this.billingCycle = billingCycle;
        }
        this.amount = amount;
    }

    public void renew(Instant newValidUntil) {
        this.validUntil = newValidUntil;
        this.status = SubscriptionStatus.ACTIVE;
        this.pausedAt = null;
        this.cancelledAt = null;
    }

    public void pause() {
        this.status = SubscriptionStatus.PAUSED;
        this.pausedAt = Instant.now();
    }

    public void resume() {
        this.status = SubscriptionStatus.ACTIVE;
        this.pausedAt = null;
    }

    public void cancel() {
        this.status = SubscriptionStatus.CANCELLED;
        this.cancelledAt = Instant.now();
    }

    public void setStatus(SubscriptionStatus status) { this.status = status; }

    public void setAmount(Double amount) { this.amount = amount; }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getPharmacyId() { return pharmacyId; }

    public String getPlanName() { return planName; }

    public SubscriptionStatus getStatus() { return status; }

    public String getBillingCycle() { return billingCycle; }

    public Double getAmount() { return amount; }

    public boolean isAutoRenew() { return autoRenew; }

    public Instant getValidUntil() { return validUntil; }

    public Instant getTrialEndsAt() { return trialEndsAt; }

    public Instant getPausedAt() { return pausedAt; }

    public Instant getCancelledAt() { return cancelledAt; }

    public double getDiscount() { return discount; }

    public String getCouponCode() { return couponCode; }

    public double getCreditBalance() { return creditBalance; }

    public Pharmacy getPharmacy() { return pharmacy; }
}
