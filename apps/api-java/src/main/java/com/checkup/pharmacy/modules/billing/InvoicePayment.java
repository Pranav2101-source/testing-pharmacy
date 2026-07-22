package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.domain.IdOnlyEntity;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.util.Cuid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/** Maps the Prisma `InvoicePayment` model (table "invoice_payments") — split-payment support. */
@Entity
@Table(name = "invoice_payments")
public class InvoicePayment extends IdOnlyEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "invoiceId")
    private String invoiceId;

    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "paymentMode")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PaymentMode paymentMode;

    @Column(name = "reference")
    private String reference;

    @Column(name = "notes")
    private String notes;

    @Column(name = "paidAt")
    private Instant paidAt;

    @Column(name = "createdBy")
    private String createdBy;

    protected InvoicePayment() {
        // Required by JPA.
    }

    public static InvoicePayment create(String pharmacyId, String invoiceId, BigDecimal amount,
                                        PaymentMode paymentMode, String reference, String notes,
                                        Instant paidAt, String createdBy) {
        InvoicePayment p = new InvoicePayment();
        p.assignId(Cuid.generate());
        p.pharmacyId = pharmacyId;
        p.invoiceId = invoiceId;
        p.amount = amount;
        p.paymentMode = paymentMode;
        p.reference = reference;
        p.notes = notes;
        p.paidAt = paidAt != null ? paidAt : Instant.now();
        p.createdBy = createdBy;
        return p;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getInvoiceId() { return invoiceId; }

    public BigDecimal getAmount() { return amount; }

    public PaymentMode getPaymentMode() { return paymentMode; }

    public String getReference() { return reference; }

    public String getNotes() { return notes; }

    public Instant getPaidAt() { return paidAt; }

    public String getCreatedBy() { return createdBy; }
}
