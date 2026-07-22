package com.checkup.pharmacy.modules.supplierreturn;

import com.checkup.pharmacy.common.domain.BaseEntity;
import com.checkup.pharmacy.common.enums.SupplierReturnStatus;
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
import java.util.List;

/**
 * Maps the Prisma `SupplierReturn` model (table "supplier_returns") — a debit
 * note raised when the pharmacy sends goods back to a supplier. Confirming
 * decrements inventory and writes ADJUSTMENT/OUT movements (see
 * {@link SupplierReturnsService#confirm}).
 */
@Entity
@Table(name = "supplier_returns")
public class SupplierReturn extends BaseEntity {

    @Column(name = "pharmacyId")
    private String pharmacyId;

    @Column(name = "supplierId")
    private String supplierId;

    @Column(name = "returnNumber")
    private String returnNumber;

    @Column(name = "debitNoteNo")
    private String debitNoteNo;

    @Column(name = "status")
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    private SupplierReturnStatus status = SupplierReturnStatus.DRAFT;

    @Column(name = "notes")
    private String notes;

    @Column(name = "subtotal")
    private BigDecimal subtotal = BigDecimal.ZERO;

    @Column(name = "taxableAmount")
    private BigDecimal taxableAmount = BigDecimal.ZERO;

    @Column(name = "cgst")
    private BigDecimal cgst = BigDecimal.ZERO;

    @Column(name = "sgst")
    private BigDecimal sgst = BigDecimal.ZERO;

    @Column(name = "igst")
    private BigDecimal igst = BigDecimal.ZERO;

    @Column(name = "totalGst")
    private BigDecimal totalGst = BigDecimal.ZERO;

    @Column(name = "totalAmount")
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(name = "items")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<SupplierReturnItemSnapshot> items;

    @Column(name = "itemCount")
    private int itemCount;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "supplierId", insertable = false, updatable = false)
    private Supplier supplier;

    protected SupplierReturn() {
        // Required by JPA.
    }

    public static SupplierReturn create(String pharmacyId, String supplierId, String returnNumber, String debitNoteNo,
                                        String notes, List<SupplierReturnItemSnapshot> items, BigDecimal subtotal,
                                        BigDecimal cgst, BigDecimal sgst, BigDecimal totalGst) {
        SupplierReturn sr = new SupplierReturn();
        sr.assignId(Cuid.generate());
        sr.pharmacyId = pharmacyId;
        sr.supplierId = supplierId;
        sr.returnNumber = returnNumber;
        sr.debitNoteNo = debitNoteNo;
        sr.notes = notes;
        sr.status = SupplierReturnStatus.DRAFT;
        sr.items = items;
        sr.itemCount = items.size();
        sr.subtotal = subtotal;
        sr.taxableAmount = subtotal;
        sr.cgst = cgst;
        sr.sgst = sgst;
        sr.igst = BigDecimal.ZERO;
        sr.totalGst = totalGst;
        sr.totalAmount = subtotal.add(totalGst);
        return sr;
    }

    public void confirm() {
        this.status = SupplierReturnStatus.CONFIRMED;
    }

    public void cancel() {
        this.status = SupplierReturnStatus.CANCELLED;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public String getReturnNumber() { return returnNumber; }

    public String getDebitNoteNo() { return debitNoteNo; }

    public SupplierReturnStatus getStatus() { return status; }

    public String getNotes() { return notes; }

    public BigDecimal getSubtotal() { return subtotal; }

    public BigDecimal getTaxableAmount() { return taxableAmount; }

    public BigDecimal getCgst() { return cgst; }

    public BigDecimal getSgst() { return sgst; }

    public BigDecimal getIgst() { return igst; }

    public BigDecimal getTotalGst() { return totalGst; }

    public BigDecimal getTotalAmount() { return totalAmount; }

    public List<SupplierReturnItemSnapshot> getItems() { return items; }

    public int getItemCount() { return itemCount; }

    public Supplier getSupplier() { return supplier; }
}
