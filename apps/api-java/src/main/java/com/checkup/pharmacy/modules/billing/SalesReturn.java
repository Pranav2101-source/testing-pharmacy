package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.customer.Customer;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.math.BigDecimal;

/** Maps the Prisma `SalesReturn` model (table "sales_returns") — a customer return against an invoice. */
@Entity
@Table(name = "sales_returns")
public class SalesReturn extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "invoiceId")
    private String invoiceId;

    @Column(name = "returnNumber")
    private String returnNumber;

    @Column(name = "reason")
    private String reason;

    @Column(name = "userId")
    private String userId;

    @Column(name = "customerId")
    private String customerId;

    @Column(name = "subtotal")
    private BigDecimal subtotal;

    @Column(name = "discountAmount")
    private BigDecimal discountAmount = BigDecimal.ZERO;

    @Column(name = "taxableAmount")
    private BigDecimal taxableAmount;

    @Column(name = "cgst")
    private BigDecimal cgst;

    @Column(name = "sgst")
    private BigDecimal sgst;

    @Column(name = "igst")
    private BigDecimal igst = BigDecimal.ZERO;

    @Column(name = "totalGst")
    private BigDecimal totalGst;

    @Column(name = "totalAmount")
    private BigDecimal totalAmount;

    @Column(name = "idempotencyKey")
    private String idempotencyKey;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customerId", insertable = false, updatable = false)
    private Customer customer;

    protected SalesReturn() {
        // Required by JPA.
    }

    public static SalesReturn create(String pharmacyId, String invoiceId, String returnNumber, String reason,
                                     String userId, String customerId, String idempotencyKey, BigDecimal subtotal,
                                     BigDecimal taxableAmount, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                     BigDecimal totalGst, BigDecimal totalAmount) {
        SalesReturn sr = new SalesReturn();
        sr.assignId(Cuid.generate());
        sr.pharmacyId = pharmacyId;
        sr.invoiceId = invoiceId;
        sr.returnNumber = returnNumber;
        sr.reason = reason;
        sr.userId = userId;
        sr.customerId = customerId;
        sr.idempotencyKey = idempotencyKey;
        sr.subtotal = subtotal;
        sr.discountAmount = BigDecimal.ZERO;
        sr.taxableAmount = taxableAmount;
        sr.cgst = cgst;
        sr.sgst = sgst;
        sr.igst = igst;
        sr.totalGst = totalGst;
        sr.totalAmount = totalAmount;
        return sr;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getInvoiceId() { return invoiceId; }

    public String getReturnNumber() { return returnNumber; }

    public String getReason() { return reason; }

    public String getUserId() { return userId; }

    public String getCustomerId() { return customerId; }

    public BigDecimal getSubtotal() { return subtotal; }

    public BigDecimal getDiscountAmount() { return discountAmount; }

    public BigDecimal getTaxableAmount() { return taxableAmount; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getIgst() { return igst; }

    public BigDecimal getTotalGst() { return totalGst; }

    public BigDecimal getTotalAmount() { return totalAmount; }

    public String getIdempotencyKey() { return idempotencyKey; }

    public Customer getCustomer() { return customer; }
}
