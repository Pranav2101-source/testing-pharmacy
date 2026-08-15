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

    /**
     * When the goods actually went back, i.e. when this debit note took effect.
     *
     * <p>Exists so the GSTR-3B input-credit tables are symmetrical. Credit is CLAIMED on
     * {@code GoodsReceiptNote.confirmedAt} — the moment the pharmacy accepted the goods —
     * so it must be REVERSED on the moment the pharmacy sent them back, not on the moment
     * somebody started typing the debit note. Keyed on {@code createdAt}, a return drafted
     * on 30 March and confirmed on 5 April reversed credit in March, against a claim that
     * was booked in April.
     *
     * <p>Null for DRAFT and CANCELLED returns, which is what makes it usable as the filter:
     * a return that was never confirmed has no date on which anything went back.
     */
    @Column(name = "confirmedAt")
    private java.time.Instant confirmedAt;

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
                                        BigDecimal cgst, BigDecimal sgst, BigDecimal igst, BigDecimal totalGst) {
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
        // KEEP THE IGST THAT WAS PASSED IN. This line used to be followed by an
        // unconditional `sr.igst = BigDecimal.ZERO;` — a dead store that threw the
        // computed value away one statement after it was assigned.
        //
        // SupplierReturnsService had already been fixed to derive inter-state tax from
        // the supplier's state and hand it down here, so the bug hid behind code that
        // looked correct at the call site. What actually got stored for an inter-state
        // debit note was cgst 0, sgst 0, igst 0 against a NON-ZERO totalGst — a document
        // whose own tax breakdown did not add up, and which reversed no input credit at
        // all in GSTR-3B Table 4(B) while still crediting the supplier ledger in full.
        sr.igst = igst != null ? igst : BigDecimal.ZERO;
        sr.totalGst = totalGst;
        sr.totalAmount = subtotal.add(totalGst);
        return sr;
    }

    /**
     * Marks the goods as gone back, stamping the moment it happened.
     *
     * <p>The timestamp is what GSTR-3B Table 4(B) reverses credit on — see
     * {@link #confirmedAt}. Set here rather than in the service so it cannot be
     * confirmed without being dated.
     */
    public void confirm() {
        this.status = SupplierReturnStatus.CONFIRMED;
        this.confirmedAt = java.time.Instant.now();
    }

    public void cancel() {
        this.status = SupplierReturnStatus.CANCELLED;
    }

    public String getPharmacyId() { return pharmacyId; }

    public String getSupplierId() { return supplierId; }

    public String getReturnNumber() { return returnNumber; }

    public String getDebitNoteNo() { return debitNoteNo; }

    public SupplierReturnStatus getStatus() { return status; }

    public java.time.Instant getConfirmedAt() { return confirmedAt; }

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
