package com.checkup.pharmacy.modules.purchase;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.GRNStatus;
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

/**
 * Maps the Prisma `GoodsReceiptNote` model (table "goods_receipt_notes") —
 * tenant-scoped. Created when goods physically arrive; a PO may have multiple
 * GRNs (partial deliveries). Confirming a GRN atomically posts stock and writes
 * {@code InventoryMovement} rows (see {@link PurchasesService#confirmGrn}).
 */
@Entity
@Table(name = "goods_receipt_notes")
public class GoodsReceiptNote extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "supplierId")
    private String supplierId;

    @Column(name = "purchaseOrderId")
    private String purchaseOrderId;

    @Column(name = "grnNumber")
    private String grnNumber;

    @Column(name = "supplierInvoiceNo")
    private String supplierInvoiceNo;

    @Column(name = "supplierInvoiceDate")
    private Instant supplierInvoiceDate;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private GRNStatus status = GRNStatus.DRAFT;

    @Column(name = "notes")
    private String notes;

    @Column(name = "subtotal")
    private BigDecimal subtotal = BigDecimal.ZERO;

    @Column(name = "totalGst")
    private BigDecimal totalGst = BigDecimal.ZERO;

    @Column(name = "totalAmount")
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(name = "confirmedAt")
    private Instant confirmedAt;

    @Column(name = "paymentDueDate")
    private Instant paymentDueDate;

    @Column(name = "sourceUploadId")
    private String sourceUploadId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supplierId", insertable = false, updatable = false)
    private Supplier supplier;

    protected GoodsReceiptNote() {
        // Required by JPA.
    }

    public static GoodsReceiptNote create(String pharmacyId, String supplierId, String purchaseOrderId,
                                          String grnNumber, String supplierInvoiceNo, Instant supplierInvoiceDate,
                                          String notes, BigDecimal subtotal, BigDecimal totalGst) {
        GoodsReceiptNote grn = new GoodsReceiptNote();
        grn.assignId(Cuid.generate());
        grn.pharmacyId = pharmacyId;
        grn.supplierId = supplierId;
        grn.purchaseOrderId = purchaseOrderId;
        grn.grnNumber = grnNumber;
        grn.supplierInvoiceNo = supplierInvoiceNo;
        grn.supplierInvoiceDate = supplierInvoiceDate;
        grn.notes = notes;
        grn.status = GRNStatus.DRAFT;
        grn.subtotal = subtotal;
        grn.totalGst = totalGst;
        grn.totalAmount = subtotal.add(totalGst);
        return grn;
    }

    public void applyDraftEdit(String supplierInvoiceNo, Instant supplierInvoiceDate, String notes,
                               BigDecimal subtotal, BigDecimal totalGst) {
        this.supplierInvoiceNo = supplierInvoiceNo;
        this.supplierInvoiceDate = supplierInvoiceDate;
        this.notes = notes;
        this.subtotal = subtotal;
        this.totalGst = totalGst;
        this.totalAmount = subtotal.add(totalGst);
    }

    public void confirm(int supplierCreditDays) {
        this.status = GRNStatus.CONFIRMED;
        this.confirmedAt = Instant.now();
        this.paymentDueDate = this.confirmedAt.plus(java.time.Duration.ofDays(supplierCreditDays));
    }

    public void cancel() {
        this.status = GRNStatus.CANCELLED;
    }

    public void setSourceUploadId(String sourceUploadId) {
        this.sourceUploadId = sourceUploadId;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public String getPurchaseOrderId() { return purchaseOrderId; }

    public String getGrnNumber() { return grnNumber; }

    public String getSupplierInvoiceNo() { return supplierInvoiceNo; }

    public Instant getSupplierInvoiceDate() { return supplierInvoiceDate; }

    public GRNStatus getStatus() { return status; }

    public String getNotes() { return notes; }

    public BigDecimal getSubtotal() { return subtotal; }

    public BigDecimal getTotalGst() { return totalGst; }

    public BigDecimal getTotalAmount() { return totalAmount; }

    public Instant getConfirmedAt() { return confirmedAt; }

    public String getSourceUploadId() { return sourceUploadId; }

    public Instant getPaymentDueDate() { return paymentDueDate; }

    public Supplier getSupplier() { return supplier; }
}
