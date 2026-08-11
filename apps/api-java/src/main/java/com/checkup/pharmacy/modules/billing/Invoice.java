package com.checkup.pharmacy.modules.billing;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.InvoiceStatus;
import com.checkup.pharmacy.common.enums.PaymentMode;
import com.checkup.pharmacy.common.enums.PaymentStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.customer.Customer;
import com.checkup.pharmacy.modules.doctor.Doctor;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Maps the Prisma `Invoice` model (table "invoices") — the POS sale record.
 * Customer/doctor name and registration number are snapshotted at billing time
 * ({@code customerName}, {@code doctorRegNo}, ...) so the invoice stays
 * self-contained even if the linked record is later edited or deleted.
 */
@Entity
@Table(name = "invoices")
public class Invoice extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "invoiceNumber")
    private String invoiceNumber;

    @Column(name = "customerId")
    private String customerId;

    @Column(name = "customerName")
    private String customerName;

    @Column(name = "customerPhone")
    private String customerPhone;

    @Column(name = "userId")
    private String userId;

    @Column(name = "doctorId")
    private String doctorId;

    @Column(name = "doctorName")
    private String doctorName;

    @Column(name = "doctorRegNo")
    private String doctorRegNo;

    @Column(name = "prescriptionId")
    private String prescriptionId;

    @Column(name = "paymentMode")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PaymentMode paymentMode = PaymentMode.CASH;

    @Column(name = "paymentStatus")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PaymentStatus paymentStatus = PaymentStatus.PAID;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private InvoiceStatus status = InvoiceStatus.COMPLETED;

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

    /**
     * Bill-level additions, stored so this invoice can be re-derived from its own row:
     * {@code taxableAmount + totalGst + extraCharges + adjustmentAmount + roundOff
     * == totalAmount}. Before these existed the difference was an unexplained lump that
     * nobody — pharmacist, auditor, or this codebase — could reproduce after the fact.
     */
    @Column(name = "extraCharges")
    private BigDecimal extraCharges = BigDecimal.ZERO;

    @Column(name = "adjustmentAmount")
    private BigDecimal adjustmentAmount = BigDecimal.ZERO;

    /** Signed: rupee rounding goes either way, and prints as its own invoice line. */
    @Column(name = "roundOff")
    private BigDecimal roundOff = BigDecimal.ZERO;

    @Column(name = "returnedAmount")
    private BigDecimal returnedAmount = BigDecimal.ZERO;

    @Column(name = "isInterstate")
    private boolean isInterstate;

    @Column(name = "notes")
    private String notes;

    @Column(name = "isCancelled")
    private boolean isCancelled;

    @Column(name = "cancelledAt")
    private Instant cancelledAt;

    @Column(name = "cancelReason")
    private String cancelReason;

    @Column(name = "idempotencyKey")
    private String idempotencyKey;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customerId", insertable = false, updatable = false)
    private Customer customer;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "doctorId", insertable = false, updatable = false)
    private Doctor doctor;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "userId", insertable = false, updatable = false)
    private com.checkup.pharmacy.modules.user.User user;

    protected Invoice() {
        // Required by JPA.
    }

    public static Invoice create(String pharmacyId, String invoiceNumber, String userId, String customerId,
                                 String customerName, String customerPhone, String doctorId, String doctorName,
                                 String doctorRegNo, String prescriptionId, PaymentMode paymentMode,
                                 PaymentStatus paymentStatus, boolean isInterstate, String notes,
                                 String idempotencyKey, BigDecimal subtotal, BigDecimal discountAmount,
                                 BigDecimal taxableAmount, BigDecimal cgst, BigDecimal sgst, BigDecimal igst,
                                 BigDecimal totalGst, BigDecimal totalAmount,
                                 BigDecimal extraCharges, BigDecimal adjustmentAmount, BigDecimal roundOff) {
        Invoice inv = new Invoice();
        inv.assignId(Cuid.generate());
        inv.pharmacyId = pharmacyId;
        inv.invoiceNumber = invoiceNumber;
        inv.userId = userId;
        inv.customerId = customerId;
        inv.customerName = customerName;
        inv.customerPhone = customerPhone;
        inv.doctorId = doctorId;
        inv.doctorName = doctorName;
        inv.doctorRegNo = doctorRegNo;
        inv.prescriptionId = prescriptionId;
        inv.paymentMode = paymentMode;
        inv.paymentStatus = paymentStatus;
        inv.status = InvoiceStatus.COMPLETED;
        inv.isInterstate = isInterstate;
        inv.notes = notes;
        inv.idempotencyKey = idempotencyKey;
        inv.subtotal = subtotal;
        inv.discountAmount = discountAmount;
        inv.taxableAmount = taxableAmount;
        inv.cgst = cgst;
        inv.sgst = sgst;
        inv.igst = igst;
        inv.totalGst = totalGst;
        inv.totalAmount = totalAmount;
        inv.extraCharges = extraCharges != null ? extraCharges : BigDecimal.ZERO;
        inv.adjustmentAmount = adjustmentAmount != null ? adjustmentAmount : BigDecimal.ZERO;
        inv.roundOff = roundOff != null ? roundOff : BigDecimal.ZERO;
        return inv;
    }

    public void cancel(String reason) {
        this.isCancelled = true;
        this.cancelledAt = Instant.now();
        this.cancelReason = reason;
        this.status = InvoiceStatus.CANCELLED;
    }

    public void applyReturn(BigDecimal returnAmount) {
        this.returnedAmount = this.returnedAmount.add(returnAmount);
        boolean isFullReturn = this.returnedAmount.compareTo(this.totalAmount.subtract(new BigDecimal("0.01"))) >= 0;
        this.status = isFullReturn ? InvoiceStatus.RETURNED : InvoiceStatus.PARTIALLY_RETURNED;
    }

    public void setPaymentStatus(PaymentStatus paymentStatus) {
        this.paymentStatus = paymentStatus;
    }

    public String getPharmacyId() { return pharmacyId; }

    public BigDecimal getExtraCharges() { return extraCharges; }

    public BigDecimal getAdjustmentAmount() { return adjustmentAmount; }

    public BigDecimal getRoundOff() { return roundOff; }

    public String getInvoiceNumber() { return invoiceNumber; }

    public String getCustomerId() { return customerId; }

    public String getCustomerName() { return customerName; }

    public String getCustomerPhone() { return customerPhone; }

    public String getUserId() { return userId; }

    public String getDoctorId() { return doctorId; }

    public String getDoctorName() { return doctorName; }

    public String getDoctorRegNo() { return doctorRegNo; }

    public String getPrescriptionId() { return prescriptionId; }

    public PaymentMode getPaymentMode() { return paymentMode; }

    public PaymentStatus getPaymentStatus() { return paymentStatus; }

    public InvoiceStatus getStatus() { return status; }

    public BigDecimal getSubtotal() { return subtotal; }

    public BigDecimal getDiscountAmount() { return discountAmount; }

    public BigDecimal getTaxableAmount() { return taxableAmount; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getIgst() { return igst; }

    public BigDecimal getTotalGst() { return totalGst; }

    public BigDecimal getTotalAmount() { return totalAmount; }

    public BigDecimal getReturnedAmount() { return returnedAmount; }

    public boolean isInterstate() { return isInterstate; }

    public String getNotes() { return notes; }

    public boolean isCancelled() { return isCancelled; }

    public Instant getCancelledAt() { return cancelledAt; }

    public String getCancelReason() { return cancelReason; }

    public String getIdempotencyKey() { return idempotencyKey; }

    public Customer getCustomer() { return customer; }

    public Doctor getDoctor() { return doctor; }

    public com.checkup.pharmacy.modules.user.User getUser() { return user; }
}
