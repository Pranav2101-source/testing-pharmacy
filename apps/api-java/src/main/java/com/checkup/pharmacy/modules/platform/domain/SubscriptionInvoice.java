package com.checkup.pharmacy.modules.platform.domain;

import com.checkup.pharmacy.common.domain.CreatedAtEntity;
import com.checkup.pharmacy.common.enums.InvoicePaymentStatus;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;

/**
 * A billing invoice raised for a subscription (table "subscription_invoices").
 * Append-only — {@link CreatedAtEntity} (the Prisma model has no `updatedAt`);
 * a status change (e.g. PAID) rewrites {@code status}/{@code paidAt} in place,
 * which is still a valid update against existing columns.
 *
 * Money fields are {@code Double}/{@code double} to mirror the Prisma {@code Float}
 * (Postgres {@code double precision}) columns — see {@link Subscription} for why.
 */
@Entity
@Table(name = "subscription_invoices")
public class SubscriptionInvoice extends CreatedAtEntity {

    @Column(name = "subscriptionId")
    private String subscriptionId;

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "invoiceNumber")
    private String invoiceNumber;

    @Column(name = "amount")
    private double amount;

    @Column(name = "tax")
    private double tax = 0;

    @Column(name = "discount")
    private double discount = 0;

    @Column(name = "total")
    private double total;

    @Column(name = "couponCode")
    private String couponCode;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private InvoicePaymentStatus status = InvoicePaymentStatus.PENDING;

    @Column(name = "dueDate")
    private Instant dueDate;

    @Column(name = "paidAt")
    private Instant paidAt;

    @Column(name = "gstinPharmacy")
    private String gstinPharmacy;

    @Column(name = "gstinPlatform")
    private String gstinPlatform;

    protected SubscriptionInvoice() {
        // Required by JPA.
    }

    public static SubscriptionInvoice create(String subscriptionId, String pharmacyId, String invoiceNumber,
                                             double amount, double tax, double discount, double total,
                                             Instant dueDate, String gstinPharmacy) {
        SubscriptionInvoice i = new SubscriptionInvoice();
        i.assignId(Cuid.generate());
        i.subscriptionId = subscriptionId;
        i.pharmacyId = pharmacyId;
        i.invoiceNumber = invoiceNumber;
        i.amount = amount;
        i.tax = tax;
        i.discount = discount;
        i.total = total;
        i.dueDate = dueDate;
        i.gstinPharmacy = gstinPharmacy;
        i.status = InvoicePaymentStatus.PENDING;
        return i;
    }

    public void markPaid() {
        this.status = InvoicePaymentStatus.PAID;
        this.paidAt = Instant.now();
    }

    public void setCouponCode(String couponCode) {
        this.couponCode = couponCode;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getSubscriptionId() { return subscriptionId; }

    public String getPharmacyId() { return pharmacyId; }

    public String getInvoiceNumber() { return invoiceNumber; }

    public double getAmount() { return amount; }

    public double getTax() { return tax; }

    public double getDiscount() { return discount; }

    public double getTotal() { return total; }

    public String getCouponCode() { return couponCode; }

    public InvoicePaymentStatus getStatus() { return status; }

    public Instant getDueDate() { return dueDate; }

    public Instant getPaidAt() { return paidAt; }

    public String getGstinPharmacy() { return gstinPharmacy; }

    public String getGstinPlatform() { return gstinPlatform; }
}
