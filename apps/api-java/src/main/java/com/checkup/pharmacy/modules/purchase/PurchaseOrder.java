package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.ApprovalStatus;
import com.checkup.pharmacy.common.enums.PurchaseStatus;
import com.checkup.pharmacy.common.util.Cuid;
import com.checkup.pharmacy.modules.supplier.Supplier;
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
import java.util.List;

/**
 * Maps the Prisma `PurchaseOrder` model (table "purchase_orders") — tenant-scoped.
 * Line items are a denormalized JSON snapshot (see {@link PurchaseOrderItemSnapshot}),
 * not a child table: batch/expiry are placeholders until GRN, and nothing ever
 * aggregates across PO line items at the SQL level.
 */
@Entity
@Table(name = "purchase_orders")
public class PurchaseOrder extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "supplierId")
    private String supplierId;

    @Column(name = "orderNumber")
    private String orderNumber;

    @Column(name = "invoiceNo")
    private String invoiceNo;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private PurchaseStatus status = PurchaseStatus.DRAFT;

    @Column(name = "approvalStatus")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private ApprovalStatus approvalStatus = ApprovalStatus.NOT_REQUIRED;

    @Column(name = "approvedBy")
    private String approvedBy;

    @Column(name = "approvedAt")
    private Instant approvedAt;

    @Column(name = "rejectionReason")
    private String rejectionReason;

    @Column(name = "subtotal")
    private BigDecimal subtotal = BigDecimal.ZERO;

    @Column(name = "totalGst")
    private BigDecimal totalGst = BigDecimal.ZERO;

    @Column(name = "totalAmount")
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(name = "notes")
    private String notes;

    @Column(name = "expectedDate")
    private Instant expectedDate;

    @Column(name = "orderedAt")
    private Instant orderedAt;

    @Column(name = "receivedAt")
    private Instant receivedAt;

    @Column(name = "items")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<PurchaseOrderItemSnapshot> items;

    @Column(name = "itemCount")
    private int itemCount;

    @Column(name = "sourceUploadId")
    private String sourceUploadId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supplierId", insertable = false, updatable = false)
    private Supplier supplier;

    protected PurchaseOrder() {
        // Required by JPA.
    }

    public static PurchaseOrder create(String pharmacyId, String supplierId, String orderNumber,
                                       ApprovalStatus approvalStatus) {
        PurchaseOrder po = new PurchaseOrder();
        po.assignId(Cuid.generate());
        po.pharmacyId = pharmacyId;
        po.supplierId = supplierId;
        po.orderNumber = orderNumber;
        po.status = PurchaseStatus.DRAFT;
        po.approvalStatus = approvalStatus;
        po.orderedAt = Instant.now();
        return po;
    }

    public void applyDraft(String invoiceNo, String notes, Instant expectedDate,
                           List<PurchaseOrderItemSnapshot> items, BigDecimal subtotal, BigDecimal totalGst) {
        this.invoiceNo = invoiceNo;
        this.notes = notes;
        this.expectedDate = expectedDate;
        this.items = items;
        this.itemCount = items.size();
        this.subtotal = subtotal;
        this.totalGst = totalGst;
        this.totalAmount = subtotal.add(totalGst);
    }

    public void approve(String approvedBy) {
        this.approvalStatus = ApprovalStatus.APPROVED;
        this.approvedBy = approvedBy;
        this.approvedAt = Instant.now();
        this.rejectionReason = null;
    }

    public void reject(String approvedBy, String rejectionReason) {
        this.approvalStatus = ApprovalStatus.REJECTED;
        this.approvedBy = approvedBy;
        this.approvedAt = Instant.now();
        this.rejectionReason = rejectionReason;
    }

    public void send() {
        this.status = PurchaseStatus.PENDING;
    }

    public void cancel() {
        this.status = PurchaseStatus.CANCELLED;
    }

    public void markPartiallyReceived() {
        this.status = PurchaseStatus.PARTIAL;
    }

    public void markFullyReceived() {
        this.status = PurchaseStatus.RECEIVED;
        this.receivedAt = Instant.now();
    }

    public void setSourceUploadId(String sourceUploadId) {
        this.sourceUploadId = sourceUploadId;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public String getOrderNumber() { return orderNumber; }

    public String getInvoiceNo() { return invoiceNo; }

    public PurchaseStatus getStatus() { return status; }

    public ApprovalStatus getApprovalStatus() { return approvalStatus; }

    public String getApprovedBy() { return approvedBy; }

    public Instant getApprovedAt() { return approvedAt; }

    public String getRejectionReason() { return rejectionReason; }

    public BigDecimal getSubtotal() { return subtotal; }

    public BigDecimal getTotalGst() { return totalGst; }

    public BigDecimal getTotalAmount() { return totalAmount; }

    public String getNotes() { return notes; }

    public Instant getExpectedDate() { return expectedDate; }

    public Instant getOrderedAt() { return orderedAt; }

    public Instant getReceivedAt() { return receivedAt; }

    public List<PurchaseOrderItemSnapshot> getItems() { return items; }

    public int getItemCount() { return itemCount; }

    public String getSourceUploadId() { return sourceUploadId; }

    public Supplier getSupplier() { return supplier; }
}
